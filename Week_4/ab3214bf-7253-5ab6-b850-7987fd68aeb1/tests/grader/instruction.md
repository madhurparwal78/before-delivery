# Kelvingate Clearing Hourproof Settlement Desk

Hourproof Settlement Desk is the place where a multi-site industrial buyer turns one calendar month of metered electricity and granular energy certificates into an exact hour-by-hour reconciliation, gets those certificates cancelled, and hands an independent verifier a closed window to test and sign, ending in a signed PDF attestation that anybody can check on a public page. It serves four people: the energy analyst, the independent verifier, the group sustainability lead and the statement reader. It stores its records in PostgreSQL, calls a certificate registry, a meter data hub and a grid-factor feed over HTTP (WireMock stands in for all three in this build, and all of their data is invented), renders the attestation through Gotenberg and keeps every issued PDF in MinIO. Out of scope: self-registration, password reset, email, certificate trading, certificate purchasing, and any datastore beyond those named.

## Problem and users

A company can buy enough renewable certificates to cover a year of electricity and report 100 percent while its night shifts ran entirely on a fossil-heavy grid. Proposals in the Scope 2 revision of the main greenhouse-gas reporting standard would bring hourly matching and deliverability into its market-based method, and although those proposals are contested and not final, granular certificate standards already name a Matcher and a Claim Verifier, so large buyers are being asked to prove their figure hour by hour. Meter data arrives late, in mixed units and with gaps. Certificates sit in a registry by production hour and bidding zone. Surplus at noon cannot rescue a deficit at 3am. An outside verifier has to confirm that certificates were really cancelled against measured consumption. Certificate platforms are built around portfolios and meter systems stop at the meter, so nothing joins the two into one closed month a verifier can sign and a stranger can check.

- **Energy analyst** (daily): brings each site's month of metered hours and certificate lots to an exact hourly reconciliation, fixes gaps, sets lot merit order and gets the certificates cancelled.
- **Independent verifier** (weekly): works for an outside firm, tests a drawn sample of hours, records agreement or exceptions and signs an attestation for the closed window, without being able to change any figure.
- **Group sustainability lead** (weekly): sees every site's score at each time grain, sets matching policy per site and assigns verifiers.
- **Statement reader** (occasional): opens a public check page for a statement code, downloads the signed attestation PDF and confirms that the score, opinion and signature hold against it.

## Journeys

1. **Repair and reconcile a month.** The analyst signs in and lands on the window board, filters it, opens Rotterdam Press Works for October with ten Missing hours, runs automatic repair, then either types a substitution for each of the two hours repair refuses or selects a run of hours on the wall and spreads one typed total across it, and sees the window read zero Missing hours with its scores recomputed in place. If the session ends while a substitution is being saved, the analyst signs in again over the open panel and the save completes once. If another analyst got there first, the panel keeps the typed value and offers a retry on the latest revision.
2. **Set the merit order.** From a reconciled window the analyst moves a wind lot above a solar lot by keyboard, by touch or by pointer, excludes a lot from its drawer, and sees the wall, the four scores and the unmatched total change without a reload, each new rank announced.
3. **Break the month.** Anyone with access to a window opens it at MONTH and drags, taps or arrows through WEEK, DAY and HOUR, watching the blocks split, the surplus-funded part fall away and the numeral count down, opening any bucket's list of where its score went, and ending on a wall of every hour where any cell opens that hour.
4. **Review a drawn sample.** The analyst submits a window with no Missing hours. The verifier assigned to it signs in, lands on the review queue, opens the window, reads each drawn hour's evidence, records agreement or an exception on each of the 25 drawn hours by pointer or by keyboard alone, and completes the review, or returns the window with a reason. A review left too long comes back to the analyst at the server's deadline, and a dialog open when that happens keeps its typed text.
5. **Cancel certificates.** The analyst presses the cancel button on a window whose review is complete. Every lot reads Cancelling until the registry confirms each line, and then reads Cancelled, while a count of confirmed lines climbs on screen. A rejected line turns unmatched and sends the window back to reconciliation with its new score; the analyst reruns, resubmits, the sample is redrawn, and the second pass sends only the new lines.
6. **Sign and seal.** The verifier signs a Cancelled window. When the PDF press and store confirm, the verifier lands on the new public statement. When the press is down, the signature is kept, the published banner shows, and the seal finishes by itself after the press returns, under the key that was in force at signing even if the firm has replaced its key since.
7. **Check a statement.** A reader with no account opens the public check page, enters a statement code, sees the scores, the opinion and whether the signature holds, and downloads the PDF. A window restated by a late meter correction keeps its statement checkable, stamped Restated, with a pointer to its immediate successor, and each successor can be driven to its own sealed statement, and restated again, without cancelling anything twice.
8. **Oversee the group.** The lead signs in, lands on the group page, walks the site tree, reads every window's four scores cut at each site's own midnight and each month's group totals, sets a site's matching policy and assigns a verifier firm to a window. Windows already signed keep the target they were signed under. Reassigning a Returned window ends the former firm's access at once.

## Mandatory requirements

This is the complete list of mandatory requirements; every check traces to one of these lines and the detailed sections below.

- **DP-01 — Sign-in and landing routes.** Each role signs in and lands on its published route, as detailed in Public screens and controls.
- **DP-02 — Landing routes survive reload.** Reloading or directly opening any published route shows the same screen for a signed-in user with access to it.
- **DP-03 — Verifier firm boundary.** A verifier can read and act only on windows assigned to their own firm, and any other window answers exactly as an unknown one does.
- **DP-04 — Role refusals at the server.** Every role-restricted action is refused by the server for any other role, whatever the browser shows.
- **DP-05 — Server-decided window opening.** A window opens for meter intake only when the server's clock has passed its published opening instant.
- **DP-06 — Exact meter conversion.** Meter readings in every published unit and interval convert to integer watt-hours exactly, and a line that is not a whole watt-hour refuses the whole pull with that line named.
- **DP-07 — Meter hub outage.** When the meter hub is unreachable, a pull changes nothing and shows the published banner.
- **DP-08 — Automatic gap repair.** Gaps of two hours or less fill by straight line and longer gaps by the same local clock hour one week earlier, as qualified in Business rules.
- **DP-09 — Estimates never seed estimates.** An Estimated hour is never the source of another estimate, and an hour with no permitted source stays Missing.
- **DP-10 — Typed substitutions.** The analyst replaces a Missing or Estimated hour with a typed whole watt-hour value and a reason, and the hour reads Substituted.
- **DP-11 — Hour Wall grid.** The Hour Wall is one keyboard-walkable grid holding exactly one cell per window hour, each cell stating its date, hour, consumed, matched and quality in words.
- **DP-12 — Hour panel survives live refresh.** An open hour panel and its typed value stay intact while the window refreshes behind it, and a live refresh keeps focus on the same wall hour.
- **DP-13 — Gap repair journey.** An analyst takes a window from ten Missing hours to none using only the desk, and the scores update in place.
- **DP-14 — Merit order by every input.** Lots reorder by keyboard, touch and pointer, change position only on the server's reply, persist, and each new rank is announced.
- **DP-15 — Competing reorders.** When two analysts change one window from the same revision, exactly one wins and the other gets the published refusal naming who wrote and when.
- **DP-16 — Closed lot drawer is gone.** A closed lot drawer, like every other closed overlay and collapsed panel, is hidden and takes no focus or tap at every viewport width.
- **DP-17 — Lot exclusion in place.** Excluding or including a lot updates the wall, the four scores and the unmatched total without a reload and announces the result.
- **DP-18 — Same-hour same-zone matching.** A certificate matches only consumption in its own production hour at a site in its own bidding zone, and hourly surplus stays in holdings.
- **DP-19 — Battery-shifted lots.** Battery-shifted lots match on the discharge hour at the published round-trip factor, with the remainder posted to a named loss line.
- **DP-20 — Exact bundle splits.** Every bundle splits only on its watt-hour range, and its pieces are contiguous and sum exactly to the original.
- **DP-21 — Repeatable allocation.** Allocation is greedy by lot rank, runs on the server, and produces the same lines and digest for the same inputs.
- **DP-22 — Paired watt-hour ledger.** Every movement is one equal pair of entries, corrections are reversals, and the published balances always equal the registry's opening total.
- **DP-23 — Residual emissions on unmatched hours.** Unmatched hours carry whole grams of residual emissions from decimal grid factors, rounded per hour as qualified in Services.
- **DP-24 — Holdings sync.** A holdings sync imports registry bundles the desk does not yet hold, gives each same-zone bundle to the first window that synced it, and posts each import to the ledger.
- **DP-25 — Announced allocation results.** Each allocation result is announced once with the new hourly score and unmatched-hour count on the server's reply, and another person's change is announced once per revision.
- **DP-26 — Four grain scores.** The server publishes month, week, day and hour scores in integer basis points computed at read time, and they never rise toward hour.
- **DP-27 — Break the Month control.** A four-detent slider moves between MONTH, WEEK, DAY and HOUR by drag, tap and keyboard, holds its grain in the address, and opens hours from its wall.
- **DP-28 — Break the Month sequence.** Each detent move runs split, then fall, then count, reverses on the way back, and an interrupted move ends on the latest detent's server value with only that detent announced.
- **DP-29 — Reduced motion and thumb use.** With reduced motion, including a change made while the page is open, or by thumb at phone width, Break the Month gives the same four server scores, the same cells and the same announcement.
- **DP-30 — Submission gate.** A window enters review only when it has no Missing hour, has an assigned firm and is Reconciling.
- **DP-31 — Deterministic sample.** The 25 sampled hours are drawn by the published hash, and nobody can choose or swap them.
- **DP-32 — Recording the sample.** A verifier records agreement or an exception on every sampled hour and completes the review.
- **DP-33 — Server-fixed opinion.** The server fixes the opinion as Qualified above the published non-Actual share or with any exception, and nobody can set it.
- **DP-34 — Review layouts at published widths.** The review screen changes layout exactly at the two published widths and at no other, and its evidence collapses on the phone as qualified in Interactions.
- **DP-35 — Returned windows.** A verifier returns a window with a reason, the analyst resumes it, and every other action is refused while it is Returned.
- **DP-36 — Review time limit.** From the exact deadline instant every read reports the window Returned with the published line and every verifier write is refused, whatever the device clock shows.
- **DP-37 — Server-decided lot expiry.** A lot past its cancel-by instant reads Expired from the server's clock and leaves allocation on the next computation.
- **DP-38 — One cancellation per line.** One allocation line produces one accepted registry cancellation, however many times the button is pressed, and a successor window never re-sends a copied Confirmed line.
- **DP-39 — Cancelled only on confirmation.** A lot reads Cancelled only after the registry confirms every one of its lines, never on submission, and the confirmed-lines count always equals the recorded confirmations.
- **DP-40 — Rejected lines.** A rejected line becomes unmatched, recomputes the scores and sends the window back to Reconciling, as qualified in Business rules.
- **DP-41 — Registry outage.** When the registry is unreachable, submission changes no line it could not send and shows the published banner.
- **DP-42 — Signing by the verifier.** Only the assigned verifier signs a Cancelled window, by typing their own name, and the signature is kept even when the press is down.
- **DP-43 — Three-part seal.** A window reads Sealed only with its signature recorded, its PDF rendered and the store's returned bytes matching the recorded digest.
- **DP-44 — Held seal recovery.** A seal held by a press or store outage finishes by itself once the service returns, with no restart.
- **DP-45 — Attestation PDF contents.** The issued PDF carries the published statement lines for its window with names exactly as written, and never carries working notes.
- **DP-46 — Seal journey.** A verifier signs a window and, after sealing, lands on the new statement's public route.
- **DP-47 — Public check page.** The public check verifies the signature over the bytes the store returns on every request, states the result, and exposes no working notes.
- **DP-48 — Restatement.** A late meter correction to a Sealed window makes it Restated and opens a successor, while the old statement and its exact PDF bytes stay checkable.
- **DP-49 — Statement reader journey.** A reader with no account finds a statement by code, reads the result and downloads the PDF.
- **DP-50 — Site-zone day and week cuts.** Day and week buckets cut at the site's own midnight with Monday week starts, while hours stay keyed in UTC.
- **DP-51 — Matching policy and verifier assignment.** The lead sets each site's matching target and assigns a verifier firm to a window within the published state limits, and a signed window keeps its frozen target.
- **DP-52 — Group score table.** The lead reads every window's four scores and its on-target word on one screen.
- **DP-53 — Server time on every screen.** Every time-based screen state comes from the server, so a wrong device clock changes nothing.
- **DP-54 — Dialog keyboard contract.** Every dialog takes focus, keeps Tab inside itself, closes on Escape recording nothing, shows its refusals inside itself, and returns focus to its opener, as qualified in Interactions for a successful spread.
- **DP-55 — Responsive layouts.** Every screen follows the published layout matrix, switching exactly at 768 and 1200 pixels, with no sideways page scrolling down to 320 pixels.
- **DP-56 — Motion restraint.** Motion follows the published timing attributes, nothing unnamed loops, and reduced motion, applied at once when it changes, removes all movement while keeping every function.
- **DP-57 — Server boundary and boot.** The server serves only the published surface, enforces the published size limit and starts when any dependency except its own database is down.
- **DP-58 — Hero poster.** The public home page is the published full-bleed poster with the cropped meter and headline.
- **DP-59 — Poster language on working screens.** Every working screen carries the published flat colour fields, large figures and blunt copy.
- **DP-60 — Credentials and real integrations.** Service credentials come only from the environment, and every provider result shown is one the server really received.
- **DP-61 — Lifetime ranges stay exact.** Registry ranges above the largest whole number a browser number holds exactly travel as digit strings, show exactly with thousands commas, and reach the registry as the same exact integers.
- **DP-62 — Exact text and field errors.** Reasons and notes are stored and shown exactly as written, limits count Unicode code points, and each refused field shows its published message, as qualified in Business rules.
- **DP-63 — Server-derived countdowns.** Every countdown runs from the server's remaining seconds by elapsed time, asks again once at zero and shows what the server answers.
- **DP-64 — Session ends mid-task.** When a session ends during work, a sign-in dialog opens over the current screen, typed work stays, and the refused write is resent once after sign-in.
- **DP-65 — Board filter in the address.** The window board filters in place from a sheet, keeps the filter in the address through reload and back, and the closed sheet is hidden and inert.
- **DP-66 — Resizing keeps work.** Crossing either published width keeps open panels, typed values, wall selection and focus, as qualified in Interactions.
- **DP-67 — Break the Month to scale.** Every block and hour cell publishes its server watt-hours and is drawn to scale, and each falling piece publishes the server's detached watt-hours for its parent bucket.
- **DP-68 — Group site tree.** The lead walks sites and their windows in one tree with a single tab stop, closed children are absent, and choosing a site filters the table in place.
- **DP-69 — Hour Wall range selection.** Shift+Arrow, Shift+click and a touch mode select the UTC-ordered run of hours between anchor and focus, and the selection survives live refreshes.
- **DP-70 — Spread a total.** A typed total spread across 2 to 168 consecutive Missing or Estimated hours follows the published weights and remainder rule and always sums exactly to the total.
- **DP-71 — Stale panel recovery.** A stale hour panel offers a retry on the latest revision with the typed body unchanged, and its read-only figures follow live refreshes while its typed fields never change.
- **DP-72 — Remote changes keep focus.** Another analyst's reorder or exclusion keeps focus on the same lot's equivalent control, with no extra announcement.
- **DP-73 — Versioned corrections.** The highest version per hour wins whatever the arrival order, a later meter pull never overwrites a corrected hour, and any refused pull applies nothing.
- **DP-74 — Restatement chain.** One pull opens exactly one successor for a restated window, every successor keeps the base window id and takes the next statement code, and each statement points only to its immediate successor.
- **DP-75 — Second-pass cancellation.** A kept Pending line rejected during a later pass follows the published transitions, and the next pass sends only lines never accepted.
- **DP-76 — Review deadline capped by cancel-by.** The review deadline is the earlier of the review period's end and the earliest cancel-by among lots holding an Unsubmitted line.
- **DP-77 — Settlement time on every desk screen.** Every desk screen shows the settlement time, running from the latest server time by elapsed time.
- **DP-78 — Row timers share one re-ask.** The board and the queue show a countdown on each In review row, and rows reaching zero together share one re-ask.
- **DP-79 — Review by keyboard.** A verifier records all 25 sampled hours from the keyboard with the published keys, one request per result and focus moving on the server's reply.
- **DP-80 — Where it went.** Each bucket below HOUR opens a list of its worst finer buckets from the server, hidden and inert when closed at every width.
- **DP-81 — Grain replies carry revision.** A grain reply older than the highest revision seen is discarded and asked again once, a failed grain returns the slider to its last settled detent, and a live change while settled updates the numeral in place.
- **DP-82 — Hour panel in browser history.** An hour panel is one browser history entry, so Back closes it recording nothing and returns focus to that hour's cell, and Forward reopens it with empty fields.
- **DP-83 — Dialogs survive the deadline.** An open dialog and its typed text survive a deadline passing behind it, and its save then renders the server's refusal inside the dialog.
- **DP-84 — Signing across a session end.** A signature refused by an ended session is resent once after sign-in and produces one signature, and a held seal finishing during sign-in still lands on its statement.
- **DP-85 — Signing-key replacement.** A firm's verifier replaces its signing key, every signature records the key in force at signing, and the public check uses only that recorded key.
- **DP-86 — Sync every touched month.** A holdings sync asks for every UTC month its window's hours touch, ascending, and imports each bundle id once.
- **DP-87 — Battery timing checks.** A battery bundle with an unusable discharge hour is deposited and never allocates or posts loss, and one discharging outside the window stays in holdings with no line or loss.
- **DP-88 — Exact MWh on the statement.** Statements and the signed payload carry consumed and hour-matched watt-hours, and the PDF prints them in MWh with exactly six decimals built from integer digits.
- **DP-89 — Meter pull result.** A finished meter pull announces how many hours were read and how many are still Missing before the allocation line.
- **DP-90 — Group totals.** Each month's group totals are summed matched over summed consumed at each grain, never an average of window scores, counting a successor in place of its Restated predecessor.
- **DP-91 — Lot confirmation counts.** Each lot publishes its confirmed and total line counts, computed at read and shown in place with no reload.
- **DP-92 — Reassignment ends access.** Reassigning a window to another firm ends the former firm's access at its next read and on any open page, and clears the sample and its results even when the digest is unchanged.
- **DP-93 — Provider error text stays out.** Raw provider error text never reaches an API body or a screen, and only published copy does.
- **DP-94 — Hour detail unclipped.** Hour detail opened from the far right of the sideways-scrolled wall at phone width is wholly in view, unclipped and above the sticky headers.
- **DP-95 — One outcome at the deadline.** A review completed as its deadline arrives gets one outcome, and simultaneous reads at the deadline raise the window's revision exactly once.
- **DP-96 — Already-received lines stay Pending.** A registry answer that a line was already received keeps that line Pending under the same line id, and every other 4xx rejects it.
- **DP-97 — Signing fixes everything but the name.** Any opinion, signing time or statement code sent with the typed name changes nothing the server fixes.
- **DP-98 — Group totals stay with the lead.** A verifier is refused the group totals, and every list a verifier can read counts only their own firm's windows.

## Frontend

### Screens and layout (DP-01, DP-02, DP-11, DP-16, DP-27, DP-34, DP-49, DP-52, DP-55, DP-58, DP-59, DP-65, DP-66, DP-68, DP-77, DP-90)

The layout switches exactly at 768 and 1200 pixels of viewport width: a viewport 767 pixels wide takes the first layout column below, 768 to 1199 the second, 1200 and up the third. No other width changes which layout a published viewport gets. The published viewports are 375x812, 768x1024 and 1280x800. No screen scrolls sideways at any width from 320 pixels up, including when a user types a long unbroken word in a note, which wraps.

The desk's navigation is a left rail from 1200 pixels up. Below 1200 pixels, including at 768x1024, the rail is replaced by a `button "Menu"` in the top bar that opens a `dialog "Menu"` sheet. The top bar of every desk screen holds `timer "Settlement time"`.

Regions are listed in their order, top to bottom or left to right.

| Route | Screen | Who | Below 768 | 768 to 1199 | 1200 and up |
|---|---|---|---|---|---|
| `/` | Home poster, then marquee | Public | Marquee, meter across the upper part, headline, sentence, button | Full poster | Full poster |
| `/sign-in` | Sign-in | Public | One column | One column, centred | One column, centred, with no rail |
| `/windows`, optional `?state=` | Window board | Analyst | One column of window rows | One column, rail replaced by Menu | Rail, then board |
| `/windows/<id>`, optional `?grain=` and `&hour=` | Window desk | Analyst, lead, assigned verifier | One column: `region "Score panel"`, slider, wall or `list "Buckets"`, `region "Window actions"` | One column in that same order, rail replaced by Menu | Rail; score panel with slider above wall or buckets; `region "Window actions"` to the right |
| `/windows/<id>/lots` | Lots and merit order | Analyst | One column: `list "Merit order"`, then `region "Lot list"`; lot drawer is a bottom sheet | Merit order and Lot list side by side; drawer from the right | Rail, then Merit order and Lot list side by side; drawer from the right |
| `/windows/<id>/ledger` | Ledger | Analyst, lead | `region "Balances"`, then entries | Balances beside entries | Rail, Balances, entries |
| `/review` | Review queue | Verifier | One column | One column, rail replaced by Menu | Rail, then queue |
| `/review/<id>` | Sampled-hour review | Assigned verifier | One column: `region "Review summary"`, `list "Sampled hours"`, `region "Hour evidence"` when revealed | Two columns: sampled hours left; summary above evidence right | Rail, then three regions in a row: sampled hours, evidence, summary |
| `/group`, optional `?site=` | Group scores | Lead | One column: `tree "Sites"`, `table "Group totals"`, `table "Site scores"` | That same one column, rail replaced by Menu | Rail, `tree "Sites"`, then the two tables stacked to its right |
| `/check` | Statement search | Public | One column | One column | One column |
| `/check/<code>` | Public statement | Public | One column | Two columns | Two columns |

The window desk at HOUR grain shows the wall inside `region "Hour Wall"`, the one panel that scrolls sideways when its days exceed the width. The page itself never scrolls sideways. The wall has one column per local day and one row per local clock hour. In a month where the clocks go back it has one extra row, headed with the repeated local hour and the word `again`. In a month where the clocks go forward, the skipped hour's row has no cell on that day, and that position is not a cell and cannot take focus.

Signed-out visitors opening a desk route are sent to `/sign-in`. A signed-in user opening a route for a window they cannot read sees the same not-found screen as for an unknown address.

### Public screens and controls (DP-01, DP-11, DP-14, DP-16, DP-27, DP-32, DP-42, DP-47, DP-51, DP-63, DP-64, DP-65, DP-68, DP-69, DP-70, DP-71, DP-77, DP-78, DP-80, DP-85, DP-90, DP-91)

Only the controls and regions listed here are public. Every `button` and `link` has an accessible name equal to its visible text exactly once: no visually hidden duplicate, no extra label on top of visible text, and any decorative copy of a label hidden from assistive technology. Sliders, regions, grids, tables, lists, timers, trees, dialogs and live regions carry the names published here and need not repeat them as visible text. Hour cells have no visible text, and their name is published below. Live regions may be visually hidden, and each is present in the page before any text arrives in it. All overlays are the last element in the page body, outside every scrolling area and above every other layer.

Landing routes after sign-in: an analyst goes to `/windows`, a verifier to `/review`, a lead to `/group`.

| Screen | Role and accessible name | Visible copy or content |
|---|---|---|
| Home | `heading "EVERY HOUR"` | Headline, set on two lines |
| Home | `link "OPEN THE DESK"` | Goes to `/sign-in` |
| Home | Paragraph | `A year of clean power means nothing at 3am.` |
| Public pages | `region "Sealed scores"` | Marquee items in the form `<site name> <month> HOUR <hour score>%` |
| Public pages | `button "Stop scores"`, then `button "Run scores"` | Stops and restarts the marquee |
| Sign-in | `heading "SIGN IN."` | |
| Sign-in | `textbox "Email"`, `textbox "Password"`, `button "Sign in"` | |
| Desk | `navigation "Desk"` | Rail or inside the Menu sheet |
| Desk | `button "Menu"`, `dialog "Menu"`, `button "Close"` | Below 1200 pixels |
| Desk | `button "Sign out"` | |
| Desk | `timer "Settlement time"` | Top bar of every desk screen; its text reads `YYYY-MM-DD HH:MM:SS UTC`, for example `2026-11-09 12:00:04 UTC` |
| Desk | `status "Desk status"`, `alert "Desk alert"` | See Feedback states |
| Any desk screen | `dialog "Sign in again"`, `textbox "Password"`, `button "Sign in"`, `button "Cancel"` | `Your session ended. Sign in to finish.` |
| Board | `heading "YOUR WINDOWS."`, `table "Window board"` | One row per window with its link, state word, four scores, target word, and `timer "Review time left"` inside the row while In review |
| Board | `button "Filter windows"`, `dialog "Filter windows"`, `combobox "State"`, `button "Apply"`, `button "Close"` | The combobox lists `All` and the nine state words |
| Board | `status "Board status"` | See Feedback states |
| Board and queue | `link "<site name> <month>"` | For example `Rotterdam Press Works 2026-10` |
| Window desk | `region "Window desk"` | The whole working area |
| Window desk | `region "Score panel"` | Blocks and the giant numeral, with the attribute `data-phase` |
| Window desk | `slider "Break the Month"` | Value 0 to 3; value text `MONTH`, `WEEK`, `DAY` or `HOUR` |
| Window desk | `status "Grain score"` | See Feedback states |
| Window desk | `list "Buckets"`, `button "Where it went"`, `list "Worst of <key>"` | Below HOUR grain; each bucket holds its own button and list, and each list row reads `<key> <n> Wh unmatched` |
| Window desk | `region "Hour Wall"`, `grid "Hour Wall"`, `row`, `columnheader`, `rowheader`, `gridcell` | At HOUR grain; the grid carries `aria-multiselectable="true"` and each selected cell `aria-selected="true"` |
| Window desk | `button "Select hours"` | Inside `region "Hour Wall"`, above the grid and never scrolled away with it; carries `aria-pressed` |
| Window desk | `status "Wall selection"` | See Feedback states |
| Window desk | `region "Window actions"` holding `button "Pull meters"`, `button "Repair gaps"`, `button "Spread a total"`, `button "Rerun allocation"`, `button "Sync holdings"`, `button "Submit for review"`, `button "Resume reconciling"`, `button "Cancel certificates"` | Each shown only in a state that permits it, except that `Pull meters` also shows on an Awaiting meters window before its opening instant; `Spread a total` shows only with 2 or more hours selected while Reconciling |
| Window desk | `link "Lots"`, `link "Ledger"` | |
| Window desk | `timer "Review time left"` | While In review |
| Window desk | `timer "Opens in"` | While Awaiting meters and not yet open |
| Window desk | Text | State word; `Missing hours <n>`; `Unmatched <n> Wh`; `Unmatched hours <n>`; `Residual <n> g CO2`; and, from Cancelling on, `Confirmed <confirmed> of <total> lines` |
| Hour detail | `dialog "Hour detail"` | UTC hour, local hour, consumed, matched, quality, the substitution reason when there is one, and one row per allocation line |
| Hour detail | `textbox "Substitution value in watt-hours"`, `textbox "Reason"`, `button "Save substitution"`, `button "Close"` | The two fields and Save are shown when the panel opens on a Missing or Estimated hour while Reconciling, and once shown stay until the panel closes; Reason is multi-line |
| Hour detail | `button "Retry on latest"` | Present only after a `STALE_REVISION` refusal in this dialog |
| Spread | `dialog "Spread a total"`, `textbox "Total in watt-hours"`, `textbox "Reason"`, `button "Spread"`, `button "Cancel"` | Reason is multi-line |
| Lots | `heading "RANK YOUR LOTS."`, `list "Merit order"`, `listitem` | One per lot, in rank order, with name, rank, status word and opening watt-hours |
| Lots | `button "Move up"`, `button "Move down"`, `button "Details"` | Inside each listitem |
| Lots | `region "Lot list"` | Each lot's name, technology, zone, status word, cancel-by instant, bundle count and `Confirmed <confirmed> of <total> lines`, in rank order |
| Lots | `status "Merit order status"` | See Feedback states |
| Lots | `dialog "Lot drawer"`, `timer "Cancel-by time left"`, `button "Exclude lot"`, then `button "Include lot"`, `button "Close"` | The timer shows while `cancel_seconds_left` is not null |
| Ledger | `heading "EVERY WATT-HOUR, ACCOUNTED."`, `region "Balances"`, `table "Ledger entries"`, `button "Next page"`, `button "Previous page"` | |
| Queue | `heading "YOUR REVIEW QUEUE."`, `table "Review queue"` | Lists every window assigned to the verifier's firm that is In review, Cancelling, Cancelled or Signed, in that state order, then month ascending, then id ascending. Columns: `link "<site name> <month>"`, state word, `<n> of 25 recorded`, and `timer "Review time left"` inside the row while In review. Each link opens that window's review screen |
| Queue | `button "Replace signing key"`, `dialog "Replace signing key"`, `button "Replace key"`, `button "Cancel"` | |
| Review | `region "Review summary"` | Window state, allocation digest, `<n> of 25 recorded`, opinion, and `timer "Review time left"` while In review |
| Review | `list "Sampled hours"`, `listitem` | 25 items, ascending UTC hour |
| Review | `button "Agree"`, `button "Exception"`, `button "Evidence"` | Inside each listitem |
| Review | `region "Hour evidence"`, `button "Hide evidence"` | The chosen sampled hour's UTC and local hour, consumed, matched, quality and line rows; `Hide evidence` exists only below 768 pixels |
| Review | `dialog "Record exception"`, `textbox "Exception note"`, `button "Save exception"`, `button "Cancel"` | The note is multi-line |
| Review | `button "Complete review"`, `button "Return window"`, `button "Sign attestation"` | Each shown only in a state that permits it; `Sign attestation` shows on a Cancelled window |
| Review | `dialog "Return window"`, `textbox "Reason"`, `button "Send back"`, `button "Cancel"` | The reason is multi-line |
| Review | `dialog "Sign attestation"`, `textbox "Type your full name"`, `button "Sign"`, `button "Cancel"` | |
| Review, and Statement after sealing | `status "Seal status"` | The Review screen hosts it while a seal is held; the Statement screen hosts it once the seal finishes. See Feedback states |
| Group | `heading "EVERY SITE. EVERY GRAIN."`, `table "Site scores"` | One row per window |
| Group | `table "Group totals"` | One row per entry of `rollups`, in that order: month, window count, consumed watt-hours, four scores, residual grams. It ignores `?site=` |
| Group | `tree "Sites"`, `treeitem "<site name>"`, `treeitem "<site name> <month>"`, `button "Show every site"` | Window items are children of their site's item and start collapsed |
| Group | `status "Group status"` | See Feedback states |
| Group | `combobox "Target grain"`, `textbox "Target percent"`, `button "Save policy"` | Inside `region "<site name> policy"`. The combobox has four options whose text and value are both `MONTH`, `WEEK`, `DAY` and `HOUR`. `Target percent` is typed as a percent with up to two decimals, for example `80.00`, and is sent as `target_bp` equal to the percent times 100, converted digit by digit with no binary floating point, so `4.35` is sent as exactly 435. One `region "<site name> policy"` is rendered for every site in `tree "Sites"`, in that tree's order, always present and placed after `table "Site scores"`; `?site=` filters the two tables only and never changes which policy regions are present |
| Group | `combobox "Verifier firm"`, `button "Assign"` | Inside each row for an assignable window |
| Check | `heading "CHECK A STATEMENT."`, `textbox "Statement code"`, `button "Check statement"` | |
| Statement | `region "Statement result"` | Code, site, month, four scores, opinion, verifier firm, state word, signature result |
| Statement | `link "Download attestation PDF"` | |
| Statement | `link "Open the successor statement"` | Only when `successor_statement_code` is set; goes to `/check/<successor_statement_code>` |
| Any form or open dialog with errors | `alert "Problems to fix"` | One link per field, whose name is the field's error message, and activating it moves focus to that field; a refusal that names no field is plain text here |

Every timer except `timer "Settlement time"` reads `<d>d <hh>h <mm>m <ss>s left`, for example `9d 23h 59m 58s left`.

Each `gridcell` is named `<local date> <local hour> local, <UTC hour> UTC, consumed <consumed> Wh, matched <matched> Wh, <quality>`. `<local date>` is the site-zone date as `YYYY-MM-DD`. Both hours are in `HH:00` form and watt-hours are plain digits. A Missing hour replaces `consumed <consumed> Wh` with `consumed none`, and the second pass of a repeated hour has the word `again` between the local hour and `local`. With the seed data, for example, an ordinary hour reads `2026-10-12 09:00 local, 07:00 UTC, consumed 1200000 Wh, matched 1200000 Wh, Actual`; the repeated second-pass hour reads `2026-10-25 02:00 again local, 01:00 UTC, consumed 800000 Wh, matched 500000 Wh, Actual`; and a Missing hour reads `2026-10-13 05:00 local, 03:00 UTC, consumed none, matched 0 Wh, Missing`.

Each allocation line row, in Hour detail and in Hour evidence, reads `<lot name> <wh> Wh, range <start> to <end>, <status>`, with thousands commas on all three figures. For example, with the seed data at start, the first `tpe-2026-09` line reads `Pirkanmaa Wind September 500,000 Wh, range 9,007,199,254,740,993 to 9,007,199,255,240,993, Unsubmitted`.

Apart from the cell names, every watt-hour and gram figure on screen uses thousands commas, including `<n>` in `Unmatched <n> Wh`, `Residual <n> g CO2` and `<key> <n> Wh unmatched`.

### Interactions (DP-11, DP-12, DP-14, DP-16, DP-17, DP-27, DP-34, DP-54, DP-64, DP-65, DP-66, DP-68, DP-69, DP-70, DP-71, DP-72, DP-79, DP-80, DP-82, DP-83, DP-84, DP-94)

**Hour Wall.** The wall has one tab stop. Tab enters at the last focused cell or the first cell. Arrow keys move one cell and skip positions with no cell. Home and End go to the first and last cell of a row. Ctrl+Home and Ctrl+End go to the first and last cell of the grid. Page Up and Page Down go to the same hour on the previous and next day. Enter or Space opens `dialog "Hour detail"` and writes that hour into the address as `&hour=<UTC hour>`. Clicking or tapping a cell does the same. Opening an address with `&hour=` opens the panel. From any cell, `m` moves focus to the next Missing cell and Shift+M to the previous one, in chronological order and wrapping at the ends; with no Missing cell the region announcement from Feedback states is made and focus stays.

The focused cell always scrolls into view inside `region "Hour Wall"`, and sticky wall headers never fully cover it. A live refresh keeps focus on the same hour, and that cell's name changes to the new values without focus leaving it.

**Wall selection.** The anchor is the focused cell at the first Shift+Arrow or Shift+click, or the first tap in touch mode. Shift+Up and Shift+Down move focus one cell and Shift+Left and Shift+Right one day, skipping positions with no cell as plain arrows do. The selection is every window hour in UTC order between anchor and focus, so it crosses day columns and includes an `again` hour; it is never the rectangle between them. Shift+click extends from the anchor by pointer and does not open a panel. `button "Select hours"` turns on touch mode: the first tap on a cell sets the anchor, each later tap extends from that anchor, and neither opens a panel. Turning the mode off keeps the selection. Plain movement, meaning the unshifted arrows, Home, End, Ctrl+Home, Ctrl+End, Page Up, Page Down, `m` and Shift+M, and Escape on the grid clear the selection. Opening Hour detail leaves it alone. A live refresh keeps the selection, and moving focus out of the grid, for example to `button "Spread a total"`, keeps it.

**Spread a total.** `button "Spread a total"` opens its dialog. `button "Spread"` sends every selected hour in ascending UTC order. A successful spread closes the dialog, clears the selection and removes `button "Spread a total"` from the page, so focus cannot return to it: focus goes instead to the wall cell that was the grid's roving-focus cell when the dialog opened, which is the focus end of the selection, and that cell's name shows its new values. This is the one exception to returning focus to the opener. `button "Cancel"`, Escape and a refused spread keep the selection and the opener, and return focus to `button "Spread a total"` as every other dialog does.

**Hour detail.** Live refreshing behind the open panel never closes it, never clears or changes a typed value, and never moves focus. While the panel is open its consumed and quality text follow live refreshes, and the typed fields never change. The panel's Save sends the revision the panel opened with, so a panel left open across another analyst's write keeps its value and, on Save, shows the `STALE_REVISION` copy inside the dialog with the typed value intact, together with `button "Retry on latest"`. Each press of Retry on latest reads the window once and resends the typed body once at the latest revision. A retry refused as stale again shows the same refusal and button. A retry on an hour that has since become Actual shows the `HOUR_IS_ACTUAL` copy inside the dialog with the typed values kept until the panel closes.

The panel opened from anywhere in the sideways-scrolled wall, including its far right at 320 and 375 pixels of width, is wholly inside the viewport, unclipped and above the sticky wall headers, and every control in it can be hit at its centre.

**Hour panel history.** Opening a panel adds one browser history entry holding `&hour=`. Back while it is open closes it, records nothing and returns focus to that hour's cell. Forward reopens it with empty fields. Close or Escape writes the address without `&hour=`. A deep-linked panel has no opener, so on closing it focus goes to that hour's cell, or to the slider below HOUR grain. An `&hour=` naming no window hour opens nothing and is removed from the address by replacement.

**Break the Month.** The track shows four tappable labels, MONTH, WEEK, DAY and HOUR, hidden from assistive technology because the slider covers them. Right or Up moves one detent toward HOUR, Left or Down one detent toward MONTH, Home goes to MONTH and End to HOUR. Dragging the thumb snaps to the nearest detent, by pointer and by touch. The address holds `?grain=month`, `week`, `day` or `hour`, and any other value reads as `month`. The numeral and buckets at every detent come from the server's published values and the browser never computes a score. A slow reply to an older detent never changes the panel, the numeral or the address.

A grain reply whose `revision` is older than the highest revision this page has seen is discarded and asked for again once. A live change while settled updates the numeral in place, with `data-phase` staying `settled`. A grain request that answers 5xx returns the slider to the last settled detent, leaves the address unchanged, announces nothing in `status "Grain score"`, and shows the orange grain-failure line from Feedback states.

**Where it went.** `button "Where it went"` reveals that bucket's list. A closed list is hidden and inert at 375, 768 and 1280 pixels of width. An open list stays open through a live refresh and resets to closed on a grain change.

**Merit order.** Move up and Move down shift a lot one place and keep focus on the same button, or on the opposite button when the lot reaches the end of the list. `Move up` on the first lot and `Move down` on the last carry `aria-disabled="true"` and send nothing. A pointer drag or a touch drag of a listitem drops the lot at the release position. While a move is pending, every `Move up` and `Move down` carries `aria-disabled="true"` and stays focusable, further activations and drags send nothing, and focus does not move. Lots do not move on screen until the server's reply arrives. A refusal leaves the server's order on screen.

When another analyst's reorder moves a lot while focus is on that lot's `Move up` or `Move down`, focus stays on the same control of the same lot. When another analyst's exclusion changes a lot while its drawer is open, the state changes in place, and focus on `Exclude lot` lands on `Include lot`, or the reverse. Neither produces an announcement beyond the published per-revision line.

**Lot drawer.** `button "Details"` opens it. `button "Exclude lot"` or `button "Include lot"` acts immediately, and the drawer stays open showing the new state. Below 768 pixels it is a bottom sheet; from exactly 768 pixels it comes from the right.

**Filter windows.** `button "Filter windows"` opens the sheet, a bottom sheet below 768 pixels and from the right at 768 pixels and up. `button "Apply"` closes it, updates the table in place with no page load, and writes `?state=<state>` into the address as a new history entry; choosing `All` removes the parameter. Reloading keeps the filter, Back and Forward restore the earlier filter and table, and a value that names no state reads as `All`.

**Sampled hours by keyboard.** From any control in `list "Sampled hours"`, with no modifier held: `y` records agree on that item, and on the server's reply focus moves to `Agree` on the next item in list order with no result, searching past the end from the top, or to `button "Complete review"` when none remains. A second `y` during a pending reply sends nothing. `x` opens `dialog "Record exception"` for that item. `n` and `p` move focus to the same-named control on the next and previous item and stay put at the ends. Pressing `button "Agree"` itself keeps focus on that button.

**Hour evidence.** `button "Evidence"` shows that sampled hour in `region "Hour evidence"`. From 768 pixels the region is always visible, showing the first sampled hour until another is chosen, and `Hide evidence` is absent. Below 768 pixels the region starts collapsed; `Evidence` reveals it and moves focus to `button "Hide evidence"`, which collapses it and returns focus to the `Evidence` button that opened it. Pressing `Evidence` again during the collapse leaves the region open, and no earlier timer hides it later.

**Site tree.** `tree "Sites"` has one tab stop. Right opens a closed site or moves from an open site to its first child. Left closes an open site or moves from a child to its parent. Up, Down, Home and End move through visible items. Enter or a tap on a site toggles it and filters `table "Site scores"` in place, writing `?site=<site id>` into the address. Enter or a tap on a window opens `/windows/<id>`. `button "Show every site"` clears the filter and removes the parameter. Reloading keeps the filter with that site open, and a value that names no site shows every site.

**Closed means gone.** A closed drawer, sheet, Menu, filter sheet, a collapsed Hour evidence region, a closed Where it went list and the children of a closed tree item are hidden and inert at 375, 768 and 1280 pixels of width: nothing inside is visible, focusable, tappable or in the accessibility tree.

**Every dialog** (`Menu`, `Filter windows`, `Hour detail`, `Spread a total`, `Lot drawer`, `Record exception`, `Return window`, `Sign attestation`, `Replace signing key`, `Sign in again`) moves focus to its first field when it opens, or to its first control if it has no field. It keeps Tab and Shift+Tab inside itself, closes on Escape recording nothing, and returns focus to the control that opened it, which held focus immediately before it opened, except after a successful spread, where focus lands as stated under Spread a total. `button "Cancel"` and `button "Close"` behave exactly like Escape. Escape closes only the top dialog when two are open. Save, Spread, Send back, Sign and Replace key close the dialog only after a successful reply. On refusal the dialog stays open with its fields intact, and the refusal renders in that dialog's own `alert "Problems to fix"`, never only in the page behind it.

**Deadlines behind a dialog.** When a deadline passes behind an open `Record exception`, `Return window` or `Hour detail`, the dialog and its typed text stay. Its save then renders the server's `WRONG_STATE` refusal inside the dialog, for example `This window is Returned. That can't be done now.`

**Session ends.** Any 401 on a signed-in screen opens `dialog "Sign in again"` over the current screen, with every typed value and open dialog intact; the desk never redirects to `/sign-in` for this. The dialog signs in with the same account's email. A wrong password shows the sign-in refusal from Feedback states and leaves the dialog open. On success the refused write is resent once with its original body, and a resend that is refused shows that refusal in the normal way. A background refresh that receives 401 opens the dialog once and pauses all refreshing until sign-in succeeds. Cancel leaves the typed work in place, sends nothing, and the next 401 opens the dialog again. A 401 on Sign follows this rule and produces one signature and one statement code. If a held seal finishes while `dialog "Sign in again"` is open, successful sign-in goes to `/check/<code>`.

**Crossing a breakpoint.** At 767 to 768 and at 1199 to 1200 pixels, in either direction, an open Hour detail, Lot drawer or Spread a total dialog stays open with its typed values and focus, and the wall selection stays. An open Menu crossing from 1199 to 1200 closes and focus moves to the first link in `navigation "Desk"`. From 767 to 768, focus on `Hide evidence` moves to the `Evidence` button of that hour. From 768 to 767 the Hour evidence region collapses, and focus inside it moves to the `Evidence` button of that hour.

**Shortcut.** Pressing `a` reruns the allocation from any control in `region "Window desk"` while the window is Reconciling. It does nothing while focus is in a text field, with any modifier key held, or while a dialog is open.

**Marquee.** Hovering over it or focusing inside it pauses it. `button "Stop scores"` stops it until `button "Run scores"` is pressed.

### Visual design (DP-58, DP-59)

The direction is a loud flat poster. The mood is blunt: headlines are spoken sentences of six words or fewer. It is exact: every figure on screen is a whole watt-hour or a two-decimal percent, with whole grams of CO2 for residual emissions and the statement's six-decimal MWh as the only other units. It is unembarrassed: a failing score is set as large as a passing one.

**Colour.** The ground is a warm saturated yellow, with a slightly deeper mustard yellow as the alternating surface band. Ink is near-black. Muted text is a very dark olive brown. The one accent is a hot magenta, with near-black type on it, and it appears only on buttons. Each area owns one flat field: yellow for the window board and Break the Month, white for lots and ledger tables, pink for hour detail and gap repair, cyan for the verifier's review and the public check page, orange for outage and error panels. All type is black on these fields.

**Type.** Headlines and working figures use Unbounded in its heaviest weight, in capitals where the copy is in capitals. Body text and tables use Onest at a large reading size with tabular figures. Each heading step is one and a half times the step below it. There is no monospace type anywhere.

**Composition.** Pages are built from edge-to-edge square-cornered panels, each one flat candy field with black type, with that panel's working figure as the largest thing on it. Density is comfortable. A text marquee of real sealed scores runs along the top edge of public pages. Every corner is square. There are no shadows, no outlines, no hairline rules and no paper or cream ground.

**Hero.** A yellow field fills the viewport. The small wordmark Hourproof sits top right. A fixed magenta rectangular button sits bottom right. A procedural flat black-and-white drawing of a disc electricity meter, about one and a half times the hero's height, is rotated about 14 degrees and cropped by the top, left and bottom edges. The headline, in capitals, sits right-aligned just in from the edge, enormous at roughly an eighth of the viewport's width with its two lines almost touching, and it runs behind the meter so that the meter's right contour tucks over its first letters. The one sentence sits right-aligned beneath it, in a narrow column. On a phone the same arrangement has the meter across the upper half of the screen. All drawings are generated in code; there are no photographs or copied imagery. Two or three procedural meter and pylon cut-outs on public pages are the only rotated elements.

**Working screens.** Tables are large plain lists separated by alternating surface bands instead of rules, and state is written in a word, never by colour alone. A selected wall cell carries a written mark as well as a flipped field, so selection never depends on colour alone. Empty states are one spoken sentence in Unbounded. Loading replaces the panel's own figure with the word from Feedback states. Outage panels fill the width in orange. Hover turns a button a shade deeper. Keyboard focus flips a control to near-black with yellow type, so focus is always visible without an outline. Every control is at least 44 pixels in each dimension. All text meets WCAG 2.2 AA contrast.

### Motion and effects (DP-28, DP-29, DP-56, DP-67)

Motion contract: the root element reads `data-motion="reduced"` when the system asks for reduced motion and `data-motion="full"` otherwise, and follows a change in that preference at once with no reload. Three elements inside `region "Score panel"` carry `data-phase-part` and `data-motion-ms`: `split` reads 180, `fall` reads 320 and `count` reads 480. Every dialog and `region "Hour evidence"` carry `data-motion-ms` reading 200. `region "Sealed scores"` carries `data-motion-ms` reading 45000, its loop duration. Every published `data-motion-ms` reads 0 under reduced motion. `region "Score panel"` carries `data-phase`, which reads `split`, `fall`, `count` or `settled`. Motion only moves or fades things.

**The panel's drawing.** Each panel shows matched blocks in flat black against unfilled consumption height, with surplus as white slabs above the consumption line. The element holding the blocks carries `data-block-area`. Every block, and every HOUR cell, carries the server's values for its bucket: `data-bucket-key`, `data-matched-wh`, `data-consumed-wh` and `data-surplus-wh`. Inside each block below HOUR grain, one element with `data-block-part="matched"` is the black part and one with `data-block-part="surplus"` is the white slab. Heights are to scale: the view's largest `consumed_wh + surplus_wh` fills the height of `data-block-area`, and every part is its watt-hours in that same proportion, with no minimum height. Inside each HOUR cell one element with `data-block-part="matched"` is the black fill, and its height against the cell's own height is the hour's `matched_wh` against the window's largest hourly `consumed_wh + surplus_wh`, within one pixel. The giant numeral carries `data-score-numeral`, and once `settled` its text reads `<score>%`.

**Break the Month, moving toward HOUR, in order:**

1. In under a fifth of a second the black blocks divide into the new bucket count: one block at MONTH, one per calendar week touched at WEEK, one per local day at DAY, and a cell for every window hour at HOUR.
2. Over about a third of a second, the part of each block that only another bucket's surplus had paid for detaches and falls off the bottom of the panel. During `fall`, one element carrying `data-fall-parent` with the parent's key exists for each parent whose `detached_wh` is above zero, and it carries that value in `data-detached-wh`.
3. Over about half a second the giant numeral counts in fixed-width digit cells to the server's published score for that grain.

`data-phase` reads `split`, then `fall`, then `count`, then `settled`. Moving back toward MONTH runs the sequence in reverse, `count`, then `fall`, then `split`, then `settled`, and the blocks re-form. Home, End or a long drag runs one sequence directly to the target detent. If the user moves again mid-sequence, the running sequence is dropped and the panel ends on the latest detent showing exactly that detent's server value, with `data-phase` at `settled`. All motions ease out quickly and settle softly.

**Everything else:** dialogs and the drawer enter in under a quarter of a second and leave faster. A button press dips in under a tenth of a second. The marquee moves at a constant slow speed, one full pass every 45 seconds. No other element loops, and nothing unnamed here animates.

**Reduced motion:** no split, fall or count. Buckets and the final numeral change in a single frame, `data-phase` goes straight to `settled` and never reads an intermediate value, no `data-fall-parent` element appears, the marquee stands still and shows its items as a wrapped list, the browser's list of running animations is empty once the page has settled, the slider and every cell work identically, and the same announcement is made. A preference change while a sequence runs sends that sequence straight to `settled`.

### Feedback states (DP-07, DP-13, DP-17, DP-25, DP-29, DP-36, DP-41, DP-42, DP-44, DP-47, DP-62, DP-64, DP-65, DP-69, DP-70, DP-72, DP-73, DP-79, DP-81, DP-85, DP-89, DP-93)

Every string in backticks renders, and is announced in its named region, character for character. Announcements are made on the server's reply, never on the click, exactly once per event, and identically under reduced motion. An API error's own `message` is shown on screen character for character. `status` regions are polite and `alert` regions assertive. Placeholders: `<score>` and `<points>` are percentages with exactly two decimals; `<n>`, `<rank>`, `<count>`, `<confirmed>` and `<total>` are whole numbers. Published sentences do not change wording for a count of one.

Loading: the panel's own figure is replaced by the word `COUNTING`.

Empty states: `NO METERS YET.` on a window with no readings; `NO WINDOWS TO REVIEW.` on an empty queue; `NO WINDOWS MATCH.` on a filtered board with no rows; `NO LOTS HERE.` on a window with no lots; `NO MOVEMENTS YET.` on an empty ledger; `NO SEALED HOURS YET.` in the marquee with no sealed window. Unknown address: `THAT PAGE DOES NOT EXIST.` A page already open on a window its reader has lost shows that same line within five seconds.

| Event | Region | Copy |
|---|---|---|
| Detent settled; interrupted detents announce nothing | `status "Grain score"` | `<Grain> grain. <score> percent matched. <points> points gone since month.` where `<Grain>` is `Month`, `Week`, `Day` or `Hour`, and `<points>` is the month score less this grain's score. For example, with made-up figures: `Hour grain. 71.42 percent matched. 28.58 points gone since month.` |
| Any allocation result (rerun, exclusion, inclusion, substitution, repair, spread, merit order change, holdings sync, meter pull) | `status "Desk status"` | `Allocation done. Hour score <score> percent. <n> unmatched hours.` |
| Merit order saved | `status "Merit order status"` | `<lot name> is now rank <rank> of <count>.` |
| Meter pull finished, where the first `<n>` counts the window hours the pull held a complete reading for and the second is the window's Missing hours after it | `status "Desk status"`, immediately before the allocation line | `Pull done. <n> hours read. <n> hours still Missing.` |
| Repair finished | `status "Desk status"`, immediately before the allocation line | `Repair done. <n> hours filled. <n> hours still Missing.` |
| Spread finished | `status "Desk status"`, immediately before the allocation line | `Spread done. <n> hours filled.` |
| Sync found bundles another window holds | `status "Desk status"`, immediately before the allocation line | `<n> bundles are held by another window.` |
| `m` or Shift+M with no Missing hour | `status "Desk status"` | `No Missing hours.` |
| Selection changed | `status "Wall selection"` | `<n> hours selected.` |
| Selection cleared while one existed | `status "Wall selection"` | `Selection cleared.` |
| Another person changed the open window, once per revision, never for this tab's own write or for a change the server made by itself | `status "Desk status"` | `<name> changed this window. Hour score <score> percent.` where `<name>` is `last_writer_name` |
| Confirmed count changed during Cancelling; an unchanged refresh announces nothing | `status "Desk status"` | `Registry confirmed <confirmed> of <total> lines.` |
| Submitted for review | `status "Desk status"` | `Sent for review. The verifier has 25 hours to test.` |
| A sample result saved with fewer than 25 recorded | `status "Desk status"` | `<n> of 25 recorded.` |
| Sample complete | `status "Desk status"` | `All 25 hours recorded.` |
| Certificates submitted | `status "Desk status"` | `Sent to the registry. Lots read Cancelled once it confirms.` |
| A line rejected and the window went back to Reconciling | `alert "Desk alert"` | `The registry rejected a line — back to reconciling.` |
| Signing key replaced | `status "Desk status"` | `Signing key replaced. Earlier statements still check.` |
| Seal finished | `status "Seal status"` | `Sealed. Statement <code> is live.` |
| Board filtered | `status "Board status"` | `<n> windows shown.` |
| Group table filtered | `status "Group status"` | `<n> windows shown.` |
| Policy saved | `status "Group status"` | `Policy saved for <site name>.` |
| Verifier firm assigned | `status "Group status"` | `Verifier firm assigned.` |
| Sign-in refused, on the sign-in screen or in `dialog "Sign in again"` | `alert "Problems to fix"` | `That email and password don't match — try again.` |

**Field errors.** Each message is the value in the API's `fields` and the link text in `alert "Problems to fix"`. The browser shows the same message without sending when a typed substitution value or total is not all digits or a typed target percent has more than two decimals or lies outside the range.

| Field | Message |
|---|---|
| `value_wh` and `total_wh` | `Enter a whole number of watt-hours.` |
| `reason` | `Enter a reason of 1 to 500 characters.` |
| `note` | `Enter a note of 1 to 2,000 characters.` |
| `hours` | `Select 2 to 168 consecutive hours.` |
| `target_bp` | `Enter a percent from 0.00 to 100.00 with at most two decimals.` |
| `target_grain` | `Choose MONTH, WEEK, DAY or HOUR.` |
| `lot_ids` | `Send every lot exactly once.` |
| `result` | `Choose agree or exception.` |
| `excluded` | `Send true or false.` |
| `revision` | `Send the window's revision as a whole number.` |
| `typed_name` | `Type your name exactly as it appears on your account.` |

**Outage and refusal copy.** Banners are full-width orange panels. Each is also announced once in `alert "Desk alert"`, or in `status "Seal status"` for a held seal. While a dialog is open, a refusal to that dialog's own action renders in its `alert "Problems to fix"` instead.

| Code or condition | Copy |
|---|---|
| `REGISTRY_UNAVAILABLE`, on submission | `REGISTRY IS DOWN. NOTHING WAS CANCELLED.` |
| Registry unreachable during a holdings sync | `REGISTRY IS DOWN. HOLDINGS ARE UNCHANGED.` |
| Registry unreachable while confirmations are awaited | `REGISTRY IS DOWN. WAITING ON <n> LINES.` |
| `METER_HUB_UNAVAILABLE` | `METER HUB IS DOWN. NO READINGS CHANGED.` |
| Grid feed unreachable | `GRID FACTORS ARE LATE. SCORES DID NOT CHANGE.` |
| Seal held by the press | `PDF PRESS IS DOWN. YOUR SIGNATURE IS SAFE.` |
| Seal held by the store | `THE STORE IS DOWN. YOUR SIGNATURE IS SAFE.` |
| `STORE_UNAVAILABLE`, on the public check | `THE STORE IS DOWN. TRY THIS CHECK AGAIN.` |
| A grain failed to load, shown inside `region "Score panel"` | `THAT GRAIN DID NOT LOAD. MOVE AGAIN.` |
| Review timed out, shown on the window and its board row | `REVIEW TIME RAN OUT. SENT BACK TO THE ANALYST.` |
| Unknown statement | `NO STATEMENT HAS THAT CODE.` |
| Signature verifies | `SIGNATURE HOLDS.` |
| Signature fails | `SIGNATURE DOES NOT HOLD.` |
| Restated stamp | `RESTATED. SEE THE SUCCESSOR WINDOW.` followed by the successor window id |
| `STALE_REVISION` | `<name> changed this window at <HH:MM> UTC. Your change was not saved.` where `<name>` is the writer's full name and `<HH:MM>` is from `wrote_at` |
| `HOURS_MISSING` | `<n> hours are still Missing. Fix them first.` |
| `WINDOW_NOT_OPEN` | `This window opens at <opens_at>.` where `<opens_at>` is printed exactly as the API gives it |
| `NOT_WHOLE_WATT_HOUR` | `Line <n> is not a whole watt-hour.` |
| `CONFLICTING_CORRECTION` | `Line <n> conflicts with an earlier line.` |
| `SAMPLE_INCOMPLETE` | `<n> sampled hours still need a result.` |
| `NO_VERIFIER` | `Assign a verifier firm first.` |
| `LOT_EXPIRED` | `A lot passed its cancel-by time — back to reconciling.` |
| `HOUR_IS_ACTUAL` | `This hour has an Actual reading.` |
| `HOUR_NOT_SPREADABLE` | `Only Missing or Estimated hours can take a spread.` |
| `WRONG_STATE` | `This window is <state>. That can't be done now.` |

A pending action marks its own button with `aria-disabled="true"`, keeps focus on it, sends nothing further from it, and sets its panel's figure to the loading word. A follow-up repaint never overwrites a status or error message the action just showed, a held-seal message stays through every refresh until the seal finishes, and a late reply to an older request never replaces the newer state.

## Backend

### API (DP-01, DP-03, DP-04, DP-06, DP-10, DP-14, DP-17, DP-21, DP-24, DP-26, DP-31, DP-32, DP-38, DP-42, DP-47, DP-48, DP-51, DP-53, DP-61, DP-62, DP-67, DP-70, DP-73, DP-80, DP-81, DP-85, DP-88, DP-90, DP-91, DP-93, DP-97, DP-98)

All endpoints take and return JSON (`application/json; charset=utf-8`) except the two PDF routes. Every JSON response body carries `server_now`, the server's time as `YYYY-MM-DDTHH:MM:SSZ`, except the health check. Sessions are an HTTP-only same-site cookie set at sign-in. A session lasts until sign-out, and sign-out ends it at the server, so any copy of that cookie stops working at once. All hours are UTC instants in `YYYY-MM-DDTHH:00:00Z` form and are keyed in UTC. Every other instant in JSON, including `opens_at`, `cancel_by`, `wrote_at`, `signed_at`, `confirmed_at` and ledger `at`, uses `YYYY-MM-DDTHH:MM:SSZ`.

Every error has one shape: `{"error":{"code":"...","message":"...","fields":{}},"server_now":"..."}`. `fields` maps a field name to its message and is present only on 422 errors. `STALE_REVISION` also adds `wrote_by` and `wrote_at` inside `error`. Error bodies carry only published copy, and never a stack trace, SQL, a file path, a library name or a provider's own error text.

**Error order for every endpoint.** When several problems are true at once, the first in this list is reported: `BODY_TOO_LARGE` 413; `UNAUTHENTICATED` 401; `NOT_FOUND` 404 for an unknown resource or any resource outside the caller's scope, including ids inside the request body; `FORBIDDEN` 403 for a role not permitted; state conflicts 409; `VALIDATION`, `NOT_WHOLE_WATT_HOUR` or `CONFLICTING_CORRECTION` 422; dependency failures 503. Endpoint rows name only their own extra errors.

**Order among 409s on analyst writes.** `WRONG_STATE`, then `STALE_REVISION`, then the endpoint's own 409s in the order its row lists them.

Every mutating analyst call on a window requires the integer `revision` in its body, and its 409s include `STALE_REVISION` and `WRONG_STATE`, with two exceptions: cancellation submission and the corrections pull take `{}` and carry no revision. The server serialises concurrent cancellation presses on one window, so each line is sent to the registry once and a second press only sends lines still Unsubmitted. `Window` below is the object from `GET /api/windows/<id>`.

Unknown keys in a request body are ignored and never change anything.

**Who may act** (403 for any other role):

| Action | Role |
|---|---|
| Meter pull, gap repair, substitution, spread, merit order, exclusion, allocation, holdings sync, submit, resume, cancellation submission, corrections pull | Analyst |
| Sample results, return, complete, sign | Verifier assigned to the window |
| Signing-key replacement | Verifier of that firm |
| Policy, verifier assignment, firm list, group scores | Lead |

Any signed-in analyst or lead reads all windows. A verifier reads only windows assigned to their firm, and every list that verifier can read holds only those.

| Method and path | Request | Success | Extra errors |
|---|---|---|---|
| `POST /api/auth/sign-in` | `{"email","password"}` | 200 `{"user":{"id","name","role","firm_id"},"landing_url"}`; `role` is `analyst`, `verifier` or `lead` | 401 `INVALID_CREDENTIALS` |
| `POST /api/auth/sign-out` | `{}` | 200 `{"signed_out":true}` | |
| `GET /api/me` | | 200 `{"user":{...}}` | |
| `GET /api/windows` | optional `?state=` | 200 `{"windows":[Window]}`, month newest first, then site name ascending, then id descending | |
| `GET /api/windows/<id>` | | 200 Window | |
| `GET /api/windows/<id>/grains/<grain>` | `grain` is `month`, `week`, `day` or `hour` | 200 `{"grain","revision","score_bp","buckets":[{"key","start_utc","end_utc","consumed_wh","eligible_wh","matched_wh","surplus_wh","quality","worst":[{"key","unmatched_wh"}]}],"falls":[{"parent_key","detached_wh"}]}`; `quality` only at hour and omitted at other grains; `worst` omitted at hour | 404 for an unknown grain |
| `GET /api/windows/<id>/hours/<hour>` | | 200 `{"hour_utc","local_label","consumed_wh","matched_wh","quality","substitution_reason","lines":[Line]}`; `substitution_reason` is null unless the hour is Substituted | |
| `POST /api/windows/<id>/meters/pull` | `{"revision"}` | 200 Window | 409 `WINDOW_NOT_OPEN`; 422 `NOT_WHOLE_WATT_HOUR`; 503 `METER_HUB_UNAVAILABLE` |
| `POST /api/windows/<id>/gaps/repair` | `{"revision"}` | 200 `{"filled":[hour],"unfilled":[hour],"window":Window}` | |
| `PUT /api/windows/<id>/hours/<hour>/substitution` | `{"revision","value_wh","reason"}` | 200 Window | 409 `HOUR_IS_ACTUAL`; 422 |
| `POST /api/windows/<id>/hours/spread` | `{"revision","hours":[hour],"total_wh","reason"}` | 200 Window | 404 for an hour outside the window; 409 `HOUR_NOT_SPREADABLE`; 422 |
| `GET /api/windows/<id>/lots` | | 200 `{"lots":[Lot]}`, rank ascending | |
| `PUT /api/windows/<id>/merit-order` | `{"revision","lot_ids":[...]}`, every lot exactly once | 200 `{"lots":[Lot],"window":Window}` | 422 |
| `PUT /api/windows/<id>/lots/<lot id>/exclusion` | `{"revision","excluded":bool}` | 200 `{"lot":Lot,"window":Window}` | 422 |
| `POST /api/windows/<id>/allocation` | `{"revision"}` | 200 `{"lines":[Line],"allocation_digest","window":Window}` | |
| `GET /api/windows/<id>/ledger` | `?page=` from 1, 200 per page | 200 `{"opening_wh","balances":{"holdings_wh","allocated_wh","cancelled_wh","loss_wh"},"entries":[{"movement_id","kind","account","wh","lot_id","bundle_id","line_id","label","at"}],"page","page_count"}`, newest first, then movement id descending, debit row before credit | |
| `POST /api/windows/<id>/holdings/sync` | `{"revision"}` | 200 `{"added","opening_wh","held_elsewhere":[{"bundle_id","window_id"}],"window":Window}` | 503 `REGISTRY_UNAVAILABLE` |
| `POST /api/windows/<id>/submit` | `{"revision"}` | 200 Window | 409 `NO_VERIFIER`, `HOURS_MISSING` |
| `POST /api/windows/<id>/resume` | `{"revision"}` | 200 Window | |
| `GET /api/windows/<id>/sample` | | 200 `{"allocation_digest","hours":[{"hour_utc","consumed_wh","matched_wh","quality","lines":[Line],"result","note"}]}` in draw order; `result` is `agree`, `exception` or null | 409 `WRONG_STATE` when no sample exists |
| `PUT /api/windows/<id>/sample/<hour>` | `{"result","note"}`; `note` is required for `exception` | 200 `{"hour_utc","result","note"}` | 404 for an hour outside the sample; 422 |
| `POST /api/windows/<id>/review/return` | `{"reason"}` | 200 Window | 422 |
| `POST /api/windows/<id>/review/complete` | `{}` | 200 Window | 409 `SAMPLE_INCOMPLETE` |
| `POST /api/windows/<id>/cancellations` | `{}` | 200 `{"submitted":<n>,"lines":[Line],"window":Window}` | 409 `LOT_EXPIRED`; 503 `REGISTRY_UNAVAILABLE` |
| `GET /api/windows/<id>/cancellations` | | 200 `{"lines":[Line]}`, hour ascending, then bundle id | |
| `POST /api/windows/<id>/sign` | `{"typed_name"}` | 200 `{"window":Window,"statement_code","landing_url"}` when sealed, or 202 `{"window":Window,"statement_code","message"}` when held, `message` being the held copy | 422 |
| `GET /api/windows/<id>/attestation.pdf` | | 200 PDF from the store | 409 `WRONG_STATE` before Sealed; 503 `STORE_UNAVAILABLE` |
| `POST /api/sites/<site id>/corrections/pull` | `{}` | 200 `{"applied":[{"window_id","hour_utc"}],"restated":[{"window_id","successor_id"}],"skipped":[{"hour_utc","state"}]}` | 422 `NOT_WHOLE_WATT_HOUR`, `CONFLICTING_CORRECTION`; 503 `METER_HUB_UNAVAILABLE` |
| `PUT /api/sites/<site id>/policy` | `{"target_grain","target_bp"}`, `target_grain` one of `MONTH`, `WEEK`, `DAY` or `HOUR` in capitals, `target_bp` an integer 0 to 10000, both ends allowed | 200 `{"site_id","target_grain","target_bp"}` | 422 |
| `PUT /api/windows/<id>/verifier` | `{"firm_id"}` | 200 Window | 409 `WRONG_STATE` |
| `GET /api/firms` | | 200 `{"firms":[{"id","name"}]}` | |
| `POST /api/firms/<firm id>/keys/rotate` | `{}` | 200 `{"firm_id","key_id","public_key"}` | 404 for another firm |
| `GET /api/group/scores` | | 200 `{"windows":[Window],"rollups":[{"month","window_count","consumed_wh","scores":{"month_bp","week_bp","day_bp","hour_bp"},"residual_emissions_g"}]}`; `windows` in the `GET /api/windows` order, `rollups` newest month first | |
| `GET /api/public/statements/<code>` | public | 200 Statement | 404 `NOT_FOUND`; 503 `STORE_UNAVAILABLE` |
| `GET /api/public/sealed-scores` | public | 200 `{"items":[{"statement_code","site_name","month","hour_bp"}]}`, windows in state Sealed only, sealed instant newest first, then code descending, at most 20 | |
| `GET /check/<code>/attestation.pdf` | public | 200 PDF from the store, `application/pdf` | 404; 503 `STORE_UNAVAILABLE` |
| `GET /api/health` | public | 200 `{"status":"ok"}` | |

**Window:** `{"id","site":{"id","name","zone","time_zone","meter_id"},"month":"YYYY-MM","state","revision","hour_count","opens_at","opens_seconds_left","review_seconds_left","scores":{"month_bp","week_bp","day_bp","hour_bp"},"consumed_wh","unmatched_wh","unmatched_hours","missing_hours","non_actual_bp","residual_emissions_g","opinion","target":{"grain","bp","met"},"verifier_firm":{"id","name"},"returned_reason","registry_reachable","seal_status","statement_code","allocation_digest","predecessor_id","successor_id","last_writer_name","lines_confirmed","lines_total"}`. `state` is one of the strings in Business rules. `opens_seconds_left` is null once the server's time has reached `opens_at`. `review_seconds_left` is null unless In review. `seal_status` is null, `held_press`, `held_store` or `sealed`. `residual_emissions_g` may be null. `opinion` is `Unqualified` or `Qualified`. `unmatched_wh` is `consumed_wh` less hour-matched watt-hours. `unmatched_hours` counts hours with a known consumption above matched. `verifier_firm` may be null. `last_writer_name` is the full name of the last person whose action raised `revision`, null if none has. `lines_total` and `lines_confirmed` count this window's lines and its Confirmed lines, computed at read, and match `GET /api/windows/<id>/cancellations` exactly.

**Lot:** `{"id","name","technology","zone","rank","status","excluded","battery_shifted","production_month","cancel_by","cancel_seconds_left","opening_wh","bundle_count","lines_confirmed","lines_total"}`. `cancel_seconds_left` is null once the server's time has reached `cancel_by`. `lines_total` and `lines_confirmed` count that lot's lines on this window and its Confirmed lines, computed at read.

**Line:** `{"line_id","hour_utc","lot_id","lot_name","bundle_id","range_start_wh","range_end_wh","wh","status","reason"}`. `range_start_wh` and `range_end_wh` are JSON strings of decimal digits. `status` is `Unsubmitted`, `Pending`, `Confirmed` or `Rejected`.

**Statement:** `{"code","state","site_name","month","scores":{...},"opinion","firm_name","consumed_wh","hour_matched_wh","allocation_digest","pdf_url","pdf_object_key","pdf_sha256","key_id","public_key","attestation_payload","attestation_signature","pdf_signature","signature_valid","successor_window_id","successor_statement_code"}`. `state` is `Sealed` or `Restated`. `key_id` and `public_key` are those recorded at signing. `public_key` is the base64 of the 32-byte raw Ed25519 key, and both signatures are the base64 of 64 raw bytes. `attestation_payload` is a JSON string holding the exact signed text, whose UTF-8 bytes `attestation_signature` covers, and its `signed_at` is `YYYY-MM-DDTHH:MM:SSZ`. `successor_window_id` is null unless Restated. `successor_statement_code` is null unless Restated and the successor is Sealed.

### Business rules (DP-05, DP-06, DP-08 to DP-10, DP-15, DP-18 to DP-24, DP-26, DP-30, DP-31, DP-33, DP-35 to DP-40, DP-42 to DP-44, DP-48, DP-50, DP-51, DP-53, DP-62, DP-63, DP-67, DP-70, DP-73 to DP-76, DP-78, DP-80, DP-85 to DP-88, DP-90, DP-92, DP-95 to DP-97)

**Clocks:** the device clock may be wrong by hours. Every API response carries the server's time and every time-based screen state is derived from it, so a device clock wrong by up to 24 hours, or changed during a countdown, changes nothing on screen. Every countdown counts from the server's remaining seconds by elapsed time and never from an instant compared with the device's date. At zero it asks the server once (`GET /api/windows/<id>` for a window timer, `GET /api/windows/<id>/lots` for a lot timer, and one shared `GET /api/windows` for all board or queue rows reaching zero together), holds at zero meanwhile, and shows what the server answers: if the server still reports time left, the timer restarts from that value, and it never shows a negative. `timer "Settlement time"` runs from the latest `server_now` by elapsed time and updates once a second. The page never decides from the device clock whether a window is open, a lot has expired or a review has run out. Each `*_seconds_left` field is the ceiling of the time remaining, so it is at least 1 while the time has not passed.

**Settlement clock.** The server's time starts at `SETTLEMENT_CLOCK_START` when the process starts and advances in real time. All time rules below use this clock.

**Window states.** These are the exact strings: `Awaiting meters`, `Reconciling`, `In review`, `Returned`, `Cancelling`, `Cancelled`, `Signed`, `Sealed`, `Restated`. Any request not listed as legal for a state answers `WRONG_STATE`. This rule covers mutating requests only: every `GET` read in the API contract is legal in every state for a caller whose role and firm may see that window. Recording a sample result with `PUT /api/windows/<id>/sample/<hour>` is legal only in `In review`; in every other state it answers `WRONG_STATE`.

| From | Event | To | Who |
|---|---|---|---|
| Awaiting meters | Meter pull, once open | Reconciling | Analyst |
| Reconciling | Meter pull, repair, substitution, spread, merit order, exclusion, allocation, sync | Reconciling | Analyst |
| Reconciling | Submit | In review | Analyst |
| In review | Return | Returned | Verifier |
| In review | Review time runs out | Returned | Server |
| In review | A kept Pending line is Rejected | Reconciling, sample and results cleared, `revision` raised once | Server |
| Returned | Resume | Reconciling | Analyst |
| Returned or Reconciling | A kept Pending line is Rejected | State unchanged, allocation recomputed, `revision` raised once | Server |
| In review | Complete review with an Unsubmitted or Pending line | Cancelling | Verifier |
| In review | Complete review with no Unsubmitted or Pending line | Cancelled | Verifier |
| Cancelling | Cancellation submission | Cancelling | Analyst |
| Cancelling | Every line Confirmed | Cancelled | Server |
| Cancelling | A line Rejected, or an Expired lot at submission | Reconciling | Server |
| Cancelled | Sign | Signed, then Sealed | Verifier, then server |
| Sealed | Late correction | Restated, with a successor | Analyst pull |

A verifier firm can be assigned while a window is Awaiting meters, Reconciling or Returned only. Assigning a window to another firm ends the former firm's access at its next read, which answers 404, and clears the sample and its results even when the allocation digest is unchanged. Assigning the firm already assigned changes nothing.

**Opening.** `opens_at` is the instant the window's last hour ends, plus 48 hours. A pull earlier than that answers `WINDOW_NOT_OPEN`; from that instant the pull is allowed.

**Window hours.** A window is one calendar month in the site's time zone, stored as UTC hours, half-open, so a European site has 743 hours in March and 745 in October.

**Units.** All energy is integer watt-hours. A hub reading in `kWh` or `MWh` is a decimal string multiplied exactly. A line that is not a whole watt-hour after conversion refuses the whole pull, changes nothing and names its 1-based line in the message, counting each run as one line. A 60-minute hour is one reading, a 30-minute hour is the sum of its two readings and a 15-minute hour the sum of its four, and if any is absent the hour stays as it was. A pull writes Actual values only, and an Actual reading replaces a Missing, Estimated or Substituted hour, except that a pull never overwrites an hour whose correction version is above 0.

**Hour quality** is `Actual`, `Estimated`, `Substituted` or `Missing`. A Missing hour counts as zero consumed in every figure until it is filled.

**Gap repair.** A gap is a maximal run of consecutive Missing hours in UTC order, processed in ascending time.

- For a gap of two hours or less, each hour is the straight line, by UTC position, between the Actual or Substituted hour just before the gap and the one just after, rounded half up to the watt-hour.
- For a longer gap, each hour copies the hour on the local date seven days earlier at the same local clock hour, taking the first pass of a repeated hour. It is never 168 UTC hours back.
- An Estimated hour is never a source. If a straight-line anchor is absent or Estimated, or the week-earlier hour is absent, Missing or Estimated, that hour stays Missing and is reported in `unfilled`.
- Repair writes `Estimated`.
- A substitution writes `Substituted` and is accepted for a Missing or Estimated hour. On an Actual hour it answers `HOUR_IS_ACTUAL`.

**Spread a total.** `hours` lists 2 to 168 consecutive UTC hours in ascending order, each Missing or Estimated. An `hours` value that is not a list, or holds an entry that is not an hour instant, skips the window lookup and is reported at the 422 step.

- Each hour's weight is the consumption of the same local clock hour on the local date seven days earlier, taking the first pass of a repeated hour, and only an Actual or Substituted source in this window counts.
- If any hour lacks such a source, or the weights sum to zero, every weight is 1.
- With `W` the sum of the weights, each hour's share is `floor(total_wh × w / W)`. The watt-hours left over go one each to the hours with the largest `(total_wh × w) mod W`, ties to the earliest UTC hour.
- The shares always sum exactly to `total_wh`. Every hour becomes `Substituted` with the one reason, in one write that raises `revision` once.
- For example, with the seed data at start, `vnl-2026-10` 28 October local hours 08 to 10 with total 1,563,271 gives 521,080, 521,090 and 521,101. On `rtm-2026-10` after automatic repair, 20 October local hours 04 to 06 with total 2,800,001 use equal weights, because two sources are Estimated, and give 933,334, 933,334 and 933,333.

**Input validation.** Failures answer 422 `VALIDATION` with the field's message from Feedback states.

- `revision`, `value_wh`, `total_wh` and `target_bp` accept JSON integers only. `true`, `false`, `1.0` and digit strings are refused. `value_wh` and `total_wh` run from 0 to 1,000,000,000,000, both allowed.
- `reason` holds 1 to 500 characters, 500 allowed. `note` holds 1 to 2,000 characters, 2,000 allowed. The server counts Unicode code points, so a single-code-point emoji counts as 1, and the browser never caps or refuses by any other count.
- A `reason` or `note` that is empty or only whitespace is refused.
- Every `reason` and `note` is stored and shown exactly as written, multi-line, with surrounding spaces and line breaks intact and nothing trimmed.

**Lot status** is decided in this order: `Out of zone` when the lot's bidding zone differs from the site's; `Cancelled` when it has at least one line and every line is Confirmed; `Expired` when the server's time is at or past `cancel_by`; `Excluded`; `Cancelling` when any of its lines is Pending; otherwise `Available`.

**Cancel-by.** `cancel_by` is the first UTC instant of the fourth calendar month after the lot's production month. An Expired lot leaves allocation on the next computation. An Expired or Excluded lot keeps every Confirmed and Pending line it already has; only its watt-hours that carry no line leave allocation, and those watt-hours are left out of `eligible_wh` while the lot is Expired or Excluded.

**Allocation** runs on the server whenever an input changes (meter pull, repair, substitution, spread, merit order, exclusion, inclusion, holdings sync, correction, explicit rerun, or a rejected line).

- For each UTC hour ascending, it takes allocatable lots by rank ascending, and within a lot, bundles by id ascending, drawing `min(remaining consumption, bundle's available watt-hours)`.
- A lot is allocatable when it is `Available`, or has Pending or Confirmed lines kept in place.
- Confirmed and Pending lines are fixed first. A Rejected range is never allocated again.
- Each bundle with a positive draw yields one line. Surplus stays in holdings and never reaches another hour.
- Battery-shifted bundles match on `discharge_hour`, every other bundle on `production_hour`. A battery bundle's available amount is `floor(gross × 88 / 100)`.
- When a battery bundle yields a line, its remainder `gross − available` posts to `loss`, named `Battery loss <lot name>`.
- A battery bundle whose `discharge_hour` is null or not later than its `production_hour` is deposited and never allocates, posts loss or counts as eligible. A battery bundle discharging outside the window stays in holdings with no line and no loss.

**Bundle ranges.** A bundle holds the half-open range `[range_start_wh, range_end_wh)`. Ranges are lifetime counters and may exceed 9,007,199,254,740,991, so the browser never passes them through a binary floating-point number. A line takes the lowest unused watt-hours. For a battery bundle the loss piece is the top of the range. Line, remaining and loss pieces are contiguous and sum exactly to the original.

**Allocation digest.** Lowercase hex SHA-256 of the lines, one per row, in the form `<hour_utc>|<bundle_id>|<range_start_wh>|<range_end_wh>`, sorted by hour then bundle id, joined with a line feed and with no trailing line feed.

**Line id.** `<window id>_<bundle id>_<range_start_wh>`.

**Ledger.** Accounts are `registry`, `holdings`, `allocated`, `cancelled` and `loss`. Each movement is exactly two rows, one negative and one positive, of equal size. Kinds:

- `deposit`: registry to holdings.
- `allocate`: holdings to allocated.
- `battery_loss`: holdings to loss.
- `cancel`: allocated to cancelled.
- `return`: allocated or loss back to holdings.

A rerun whose lines equal the standing lines writes nothing. Otherwise each standing unfixed line is reversed with `return` rows and each new line posted. Rows are never edited or deleted. `holdings + allocated + cancelled + loss` always equals `opening_wh`, the sum of deposited watt-hours.

**Holdings sync and claims.** The registry account is shared, so several windows can see one bundle. A sync asks for every UTC month its window's hours touch, in ascending order, and imports each bundle id once, whichever month returned it, so `rtm-2026-10` asks for `2026-09` and then `2026-10`. It imports each bundle this window does not hold. An imported bundle whose zone equals the site's zone belongs to the first window that synced it, and seeded bundles belong to their seeded window. A later sync from another window adds no lot, deposit or line for it, and lists it in `held_elsewhere` with the claiming window's id. An imported bundle in another zone claims nothing. A successor's copied bundles stay in the same claim as its predecessor and are never listed as held elsewhere on that chain. Among simultaneous syncs one window wins each bundle, every other lists it, and no request answers 5xx. A bundle this window already holds is ignored and not listed.

**Scores.**

- For one grain, each bucket's `eligible_wh` is the sum over its bundles of the watt-hours an allocatable lot could deliver in that bucket, excluding Rejected ranges.
- `matched_wh` is `min(consumed_wh, eligible_wh)` and `surplus_wh` is `eligible_wh − matched_wh`.
- The score in basis points is `round_half_up(sum of matched_wh over buckets × 10000 / total consumed_wh)`, and is 0 when consumption is zero.
- Scores are computed on each read and never stored. `MONTH >= WEEK >= DAY >= HOUR` always holds.
- `month` is one bucket, `week` cuts at local Monday midnight including partial weeks, `day` cuts at local midnight in the site's time zone, and `hour` uses UTC instants.
- Bucket `key` is the local date of the bucket's first day for `week` and `day`, `YYYY-MM` for `month`, and the UTC hour for `hour`. Buckets ascend by time.
- `falls` has one entry per bucket of the next coarser grain (the local day for `hour`, the local week for `day`, the month for `week`), and `parent_key` is that bucket's key. `detached_wh` is the parent's `matched_wh` less the sum of its children's `matched_wh`, zero included. `falls` is empty at `month`.
- `worst` holds up to three buckets of the next finer grain inside this bucket, each with `unmatched_wh` (`consumed_wh − matched_wh` at that finer grain) above zero, by `unmatched_wh` descending and then key ascending.

**Group totals.** Each `rollups` entry covers one month. Each grain's score is the summed `matched_wh` over the summed `consumed_wh` of that month's windows at that grain, in basis points rounded half up, never an average of window scores. Restated windows are left out and their successors counted in their place. `residual_emissions_g` is the sum of the members' residuals, or null if any member's is null. For example, with the seed data at start, 2026-09's hour score is `4510` (649,500,000 of 1,440,000,000).

**Non-Actual share.** `non_actual_bp` is the rounded share of consumed watt-hours whose quality is not `Actual`.

**Opinion.** `Qualified` when non-Actual energy exceeds 5 percent of consumption (exactly 5 percent stays `Unqualified`; compare `non_actual × 100 > consumed × 5` in integers) or any sampled hour records an exception, otherwise `Unqualified`.

**Target.** `target.met` is true when the score at the target's grain is at least its basis points. The board writes `On target` or `Off target`. `target.grain` uses the same capitals as `target_grain`. An unsigned window's target is its site's current policy. At signing the target is frozen on the window, so Signed, Sealed and Restated windows keep it on every surface through later policy changes. A successor window takes the site's current policy.

**Submission.** Submit needs state `Reconciling`, then a verifier firm (`NO_VERIFIER`), then no Missing hours (`HOURS_MISSING`).

**Sample.** Drawn on submission from the hours with consumption above zero, ascending by UTC hour, count `n`. For `i = 0, 1, 2…`, compute the SHA-256 of `<window id>|<allocation digest>|<i>`, take its first 16 hex digits as an unsigned integer, reduce it modulo `n`, and take that hour unless already drawn, until 25 are drawn. No endpoint can choose or swap an hour. A resubmission with a new digest redraws and clears old results.

**Review.** A return's `reason` shows on the window. Complete needs a result on all 25 hours.

**Review time.** The deadline is the earlier of `submitted_at + REVIEW_SECONDS` on the server clock and the earliest `cancel_by` among lots holding an Unsubmitted line on this window, and the deadline instant itself is past time. From that instant every read, `GET /api/windows/<id>`, the lists and the board included, reports `Returned` with `returned_reason` holding the review-timeout copy from Feedback states, and every verifier write answers `WRONG_STATE`, whether or not any background work has run. No response ever reads `In review` once no time remains. That return counts as one state change and its raised `revision` is visible from the first read at or after the deadline; simultaneous reads at the deadline raise it exactly once and none answers 5xx. A Complete racing the deadline gets one outcome: either it succeeds and the window never reads Returned, or it answers `WRONG_STATE` and the window reads Returned.

**Cancellation.**

- Submission first checks the lots: if any Unsubmitted line belongs to a lot past its cancel-by, it answers `LOT_EXPIRED` and sends the window back to Reconciling, submitting nothing.
- Otherwise it sends one registry request per Unsubmitted line, in hour order. On acceptance the line becomes Pending and is never sent again.
- A registry answer of 409 with `{"status":"ALREADY_RECEIVED"}` makes the line Pending under the same line id. Every other 4xx makes it Rejected.
- A repeated press sends only lines still Unsubmitted, and `submitted` counts them.
- An unreachable or 5xx registry stops the run; lines not accepted stay Unsubmitted and the call answers `REGISTRY_UNAVAILABLE`. A later retry uses the same line id. `registry_reachable` is false from the moment a send or a confirmation poll fails to reach the registry, and true again on the next registry call that answers; it is set by that latest call alone. The `REGISTRY IS DOWN. WAITING ON <n> LINES.` banner shows exactly while `registry_reachable` is false and the window has at least one line that is not Confirmed, and clears as soon as either stops holding; `<n>` counts that window's lines that are not Confirmed, Unsubmitted and Pending together.
- The server polls each Pending line about every two seconds, in every window state. `CONFIRMED` makes the line Confirmed and writes a `cancel` movement. `REJECTED` makes it Rejected, stores the registry's `reason`, writes a `return` movement and recomputes the allocation, and the window then moves as the state table says. Polling continues for its other Pending lines.
- With every line Confirmed and none Rejected a Cancelling window becomes Cancelled.
- A later pass sends only lines still Unsubmitted, and a line already Pending or Confirmed is never sent again.
- `lines_confirmed` never falls while a window stays in Cancelling.

**Signing and sealing.**

- `typed_name` must equal the signed-in verifier's full name character for character. Everything else sent with it, such as an opinion, a time or a code, is ignored.
- At signing the server assigns the statement code `HP-<YYYY>-<MM>-<site code>-<n>`, where `n` is the number of signatures for that site and month. It signs `attestation_payload` (compact JSON with no spaces after commas or colons, keys sorted, non-ASCII characters written as themselves, holding `window_id`, `site_name`, `month`, `month_bp`, `week_bp`, `day_bp`, `hour_bp`, `opinion`, `firm_name`, `consumed_wh`, `hour_matched_wh`, `allocation_digest`, `signed_at`) with the firm's Ed25519 key in force at that moment over its UTF-8 bytes, records it and that key, and sets the window to Signed.
- It then renders the PDF, computes its SHA-256 and an Ed25519 signature over the PDF bytes with that same recorded key, adds both to the signature record, writes the object, reads the object back and compares the digest.
- Only then is the window Sealed and the code resolvable. The opinion is fixed at signing.
- A held seal retries about every five seconds without limit, reusing the signature and recorded key, even after the firm has replaced its key, and stays Signed until it finishes. A code for a window not yet Sealed answers 404.
- After sealing, the verifier's open page goes to `/check/<code>` at once, whether the seal finished in the request or later, without waiting for any announcement. The statement page then makes the sealed announcement from Feedback states in its own `status "Seal status"`. While a seal is held, the Review screen announces the held copy there instead.

**Signing-key replacement.** `key_id` is the first 16 hex digits of the SHA-256 of the raw public key. Replacing a key makes the new one the key in force for later signatures. Earlier keys stay on record for their signatures.

**Public check.** Each request fetches the object by key, verifies `pdf_signature` over the returned bytes with the public key recorded on that signature and no other, and sets `signature_valid` from that alone. A failed verification states the failing copy and still serves the page.

**Public artefacts.** PDFs, statement JSON, public pages and the marquee never contain exception notes, substitution or return reasons, or analyst names.

**Late corrections.** `corrections/pull` reads the hub for the site.

- Each hour keeps its highest applied version, starting at 0. A correction applies only if its version is above that.
- Within one pull only the highest version per hour applies, whatever the line order. Every line that does not apply because an equal or higher version exists, stored or in this pull, is listed in `skipped` with state `Superseded`, one entry per line.
- The same hour and version with a different value refuses the whole pull with `CONFLICTING_CORRECTION`, naming the later line. When a pull has several bad lines the lowest-numbered is reported, and on one line `NOT_WHOLE_WATT_HOUR` comes first. Any 422 applies nothing and opens no successor.
- For each applying line, the newest window in that hour's chain receives the value.
- Reconciling windows apply it in place as `Actual`.
- A Sealed window whose value differs becomes `Restated` and opens exactly one successor, however many lines apply to it, with id `<base window id>-r<n>` (`n` from 2 and rising along the chain), in Reconciling, copying its hours with their versions, its lots, ranks, verifier firm and fixed Confirmed lines, with the corrections applied as `Actual`. For example `rtm-2026-03-r3` follows `rtm-2026-03-r2`, never `rtm-2026-03-r2-r2`.
- A Sealed successor can itself be Restated in the same way, and takes the next statement code, for example `HP-2026-03-RTM-3`. Each statement points only to its immediate successor.
- The predecessor's scores and signed payload stay as signed. `successor_statement_code` fills once the successor is Sealed.
- Copied Confirmed lines are never sent to the registry again. In its own ledger the successor posts one `deposit` per copied bundle for its whole range, one `battery_loss` where the predecessor had one, and one `allocate` and one `cancel` per copied Confirmed line.
- The successor's next signature takes the next statement code, for example `HP-2026-03-RTM-2`, and a new object.
- Windows in other states are listed in `skipped` under their state and unchanged.
- An equal value at a higher version stores the version only, opens no successor and appears in no list.
- Confirmed watt-hours above a corrected consumption stay cancelled and count as surplus.

**Revision.** `revision` starts at 1 and rises by one on every analyst write, every window state change and every rejection that recomputes allocation; sample results, line confirmations and verifier assignment alone do not raise it. A write carrying an older revision answers `STALE_REVISION` naming the last writer and when. Among simultaneous writes carrying one revision, exactly one succeeds, every other answers `STALE_REVISION`, and no request under contention answers 5xx. An open view updates with no reload within five seconds of another person's change.

### Services (DP-06, DP-07, DP-22 to DP-24, DP-38 to DP-41, DP-43 to DP-45, DP-47, DP-48, DP-61, DP-73, DP-86, DP-88, DP-93, DP-96)

**PostgreSQL** holds all records. Apply the schema idempotently on serve. The ledger is a table named `ledger_entries` with columns `movement_id` text, `kind` text, `account` text, `wh` bigint (signed), `window_id` text, `lot_id` text, `bundle_id` text, `line_id` text and `at` timestamptz; each `movement_id` has exactly two rows summing to zero.

**WireMock** at `WIREMOCK_URL` plays three invented third-party services. All requests have a timeout of five seconds. The data is invented. The published baseline answers:

| Service | Request | Baseline response |
|---|---|---|
| Registry holdings | `GET /registry/v2/holdings?account=KG-HOLD-01&production_month=<YYYY-MM>` | 200 `{"account":"KG-HOLD-01","bundles":[]}` |
| Registry cancellation | `POST /registry/v2/cancellations` with `{"client_line_id","bundle_id","range_start_wh","range_end_wh","hour_utc","beneficiary"}`; `client_line_id` is the line id, `beneficiary` is the site name, and the header `Idempotency-Key` equals the line id | 202 `{"status":"PENDING"}` |
| Registry confirmation | `GET /registry/v2/cancellations/<line id>` | 200 `{"status":"CONFIRMED","confirmed_at":"2026-11-09T12:00:00Z"}`; other answers are `{"status":"PENDING"}` and `{"status":"REJECTED","reason":"<text>"}` |
| Meter readings | `GET /hub/v1/readings?meter=<meter id>&from=<first hour>&to=<end instant>` | 200 `{"runs":[]}`, except for `meter=NL-RTM-01` with `from=2026-10-31T23:00:00Z` |
| Meter corrections | `GET /hub/v1/corrections?meter=<meter id>&since=<earliest window start>` | 200 `{"corrections":[]}` |
| Grid factors | `GET /grid/v1/factors?zone=<zone>&from=<first hour>&to=<end instant>` | 200 with `{"zone","runs":[{"start","count","g_per_kwh"}]}`: `NL` start `2026-01-01T00:00:00Z`, count 17520, `"328.4125"`; `FI` the same start and count, `"61.0365"`; other zones `{"runs":[]}` |

The registry contract carries `range_start_wh` and `range_end_wh` as JSON integers of exact value, both in holdings bundles and in cancellation requests. A holdings bundle is `{"bundle_id","lot_ref","lot_name","technology","zone","battery_shifted","production_hour","discharge_hour","range_start_wh","range_end_wh"}`. `discharge_hour` may be null. `lot_ref` matches a lot id on this window, or a new lot is created at last rank with status from the rules. A new lot's `production_month` is the UTC month of its bundle's `production_hour`, and every bundle the registry returns is imported whatever month was queried, so a bundle produced long ago yields a lot whose `cancel_by` has already passed and which reads Expired.

A readings response is `{"runs":[{"start","interval_minutes","count","unit","value"}]}`, where `interval_minutes` is 15, 30 or 60, `unit` is `kWh` or `MWh`, and `value` is a decimal string applied to each of `count` readings. The baseline answer for `NL-RTM-01` from `2026-10-31T23:00:00Z` is two runs: 60-minute, count 480, `kWh`, `1000.000`; then from `2026-11-20T23:00:00Z`, 15-minute, count 960, `kWh`, `250.000`.

A correction is `{"hour_utc","unit","value","version"}`, in `{"corrections":[...]}`, where `version` is a whole number of at least 1. Line numbers count corrections from 1.

A registry 4xx on cancellation other than the already-received answer makes the line Rejected with the body's `reason`. The `reason` of a registry rejection is the one provider text the desk keeps, and it shows only on that line in the desk.

Grid factors are fetched once per allocation for hours with no stored factor and kept in PostgreSQL. `g_per_kwh` is a decimal string of up to four places. `residual_emissions_g` is the sum over unmatched hours of `round_half_up(unmatched_wh × g_per_kwh / 1000)`, rounded half up per hour in integer arithmetic, never by a binary floating-point number and never on the month's total. It is null while any unmatched hour has no factor. The feed never changes a score. The `GRID FACTORS ARE LATE. SCORES DID NOT CHANGE.` banner shows exactly while `residual_emissions_g` is null and clears as soon as it is a number. While it is null the window desk line `Residual <n> g CO2` reads `Residual unknown g CO2`, and a group table cell for that window reads `unknown`.

**Gotenberg** at `GOTENBERG_URL` renders the attestation with `POST /forms/chromium/convert/html`, sending the page as `index.html`. Names are escaped for the page so they print exactly as written. The PDF's text carries these lines, in this order, each on its own line, where `<mwh>` is the watt-hours divided by 1,000,000 with exactly six decimals built from integer digits (for example, with the seed data at start, `rtm-2026-03` reads `743.000000` and `186.000000`):

- `Statement <code>`
- `Site <site name>`
- `Month <YYYY-MM>`
- `Month score <score>%`
- `Week score <score>%`
- `Day score <score>%`
- `Hour score <score>%`
- `Consumed <mwh> MWh`
- `Hour matched <mwh> MWh`
- `Opinion <opinion>`
- `Verifier firm <firm name>`
- `Allocation digest <digest>`

**MinIO** at `S3_ENDPOINT`, bucket `S3_BUCKET`, private, holds the only copy of each PDF under the key `attestations/<statement code>.pdf`, with content type `application/pdf`. The browser never contacts it; the server fetches and streams the stored bytes on every download and never renders again for a download. Objects are never overwritten or deleted, including a Restated window's object, so its digest and entity tag never change.

**Outage behaviour.** A provider counts as unavailable when it cannot be reached, times out, or answers 5xx or an unreadable body. Registry and hub failures use the codes and copy above. A press or store failure during a seal holds it. A dependency's recovery needs no restart. Raw text from any provider failure never reaches an API body or a screen.

### Seed data (DP-01, DP-08 to DP-11, DP-18 to DP-21, DP-23, DP-26, DP-33, DP-43, DP-50, DP-61, DP-70, DP-76, DP-90)

Apply this seed once, on the first serve against an empty database. Every seeded person, business, site, firm and lot is invented. Allocation for every seeded window is computed by the same rule the app uses. Every seeded hour has correction version 0, and a seeded lot's `production_month` is its window's month. Password for all users: `hourproof-demo-1`.

Users: Anouk Visser (`anouk@verhoeven.example`, analyst), Joris Bakker (`joris@verhoeven.example`, analyst), Mirthe Claes (`mirthe@verhoeven.example`, lead), Vera Lindqvist (`vera@aldermoor.example`, verifier at firm `aldermoor`, named Aldermoor Assurance), Bram Okafor (`bram@brightlock.example`, verifier at firm `brightlock`, named Brightlock Prüfung & Söhne). The buyer is Verhoeven Stamping Group. Each firm gets its own Ed25519 key, generated on first serve and kept in PostgreSQL.

| Site id | Name | Code | Zone | Time zone | Meter | Target grain | Target bp |
|---|---|---|---|---|---|---|---|
| `rtm` | Rotterdam Press Works | RTM | NL | Europe/Amsterdam | `NL-RTM-01` | HOUR | 8000 |
| `ein` | Eindhoven Casting Hall | EIN | NL | Europe/Amsterdam | `NL-EIN-01` | MONTH | 9000 |
| `tpe` | Tampere Foundry | TPE | FI | Europe/Helsinki | `FI-TPE-01` | DAY | 5000 |
| `vnl` | Venlo Coil Shop | VNL | NL | Europe/Amsterdam | `NL-VNL-01` | HOUR | 5000 |

| Window id | Month | Hours | State at start | Firm |
|---|---|---|---|---|
| `rtm-2026-10` | 2026-10 | 745 | Reconciling | aldermoor |
| `ein-2026-10` | 2026-10 | 745 | Reconciling | aldermoor |
| `tpe-2026-10` | 2026-10 | 745 | Reconciling | brightlock |
| `vnl-2026-10` | 2026-10 | 745 | Reconciling, no lots | none |
| `rtm-2026-11` | 2026-11 | 720 | Awaiting meters, no readings | aldermoor |
| `ein-2026-09` | 2026-09 | 720 | In review, submitted at the first serve's settlement time, sample drawn, no results, every line Unsubmitted | aldermoor |
| `tpe-2026-09` | 2026-09 | 720 | Cancelling, 25 results `agree`, 3 lines Unsubmitted | brightlock |
| `ein-2026-08` | 2026-08 | 744 | Cancelled, every line Confirmed, 25 results `agree` | aldermoor |
| `rtm-2026-03` | 2026-03 | 743 | Sealed through the normal seal path, code `HP-2026-03-RTM-1`, signed by Vera Lindqvist | aldermoor |

On first serve the Sealed seed window passes through the same render, store and digest steps, in the background, so it reads Signed until they succeed. Bundle ids are `<lot id>-<YYYYMMDDHH>` in UTC. Except in `tpe-2026-09`, ranges start at 0 and the range's end equals the quantity. In the rules below, "local hour" is the hour shown on the site's clock, and every UTC hour with that local clock hour gets a bundle, so a repeated hour gets two.

**`rtm-2026-10`.** Consumption per hour: 1,200,000 Wh for local hours 06 to 21, otherwise 800,000 Wh. Quality is Actual except these ten hours, which are Missing:

- 13 October local hours 05 and 06.
- 20 October local hours 04, 05 and 06.
- 20 October local hours 10, 11, 12, 13 and 14.

| Lot id | Name | Tech | Zone | Rank | Bundles |
|---|---|---|---|---|---|
| `lot-rtm-solar-2026-10` | Maasvlakte Solar | solar | NL | 1 | Every local date, local hours 09 to 14. Quantity per hour: 8,000,000 for 1 to 4 Oct; 2,000,000 for 5 to 11 Oct; 6,000,000 for 12 to 16 Oct; 1,000,000 for 17 and 18 Oct; 2,000,000 for 19 to 25 Oct; 3,000,000 for 26 to 31 Oct |
| `lot-rtm-wind-2026-10` | Noordzee Wind | wind | NL | 2 | Every local date, local hours 00 to 03, 500,000 each; plus, on 5 to 11 Oct, local hour 09, 1,000,000 each, under bundle ids with the suffix `-b` |
| `lot-rtm-battery-2026-10` | Zeeland Battery | solar | NL | 3 | Battery-shifted. Every local date, discharge at local hour 19, gross 1,000,001 each; `production_hour` is six hours before `discharge_hour` |
| `lot-rtm-hydro-2026-10` | Ardennes Hydro | hydro | BE | 4 | Every local date, local hour 20, 1,000,000 each |

For example, with this seed:

| Measure | At start, ten hours Missing | After all ten hours are filled to the formula's consumption |
|---|---|---|
| Consumed Wh | 783,600,000 | 794,400,000 |
| Month | 96.58 | 95.26 |
| Week | 79.21 | 78.39 |
| Day | 74.94 | 74.18 |
| Hour | 38.87 | 39.10 |
| Hour matched Wh | 304,580,000 | 310,580,000 |
| Unmatched Wh | 479,020,000 | 483,820,000 |
| Unmatched hours | 566 | 571 |
| `opening_wh` | 791,500,031 | 791,500,031 |
| `holdings_wh` | 483,200,000 | 477,200,000 |
| `loss_wh` | 3,720,031 | 3,720,031 |

The straight-line fill of the 13 October hours yields 933,333 and 1,066,667 Wh and leaves those totals as shown. After automatic repair, 20 October local hours 05 and 06 stay Missing because their week-earlier hours are Estimated, and substituting 800,000 and 1,200,000 Wh completes the table's right column.

**`ein-2026-10`, `ein-2026-09`, `ein-2026-08`.** 1,000,000 Wh every hour, all Actual except in `ein-2026-10`, where every hour of local dates 15 to 18 October is `Estimated`. One lot each, rank 1, NL, wind, with a 900,000 Wh bundle every hour: `lot-ein-wind-2026-10` named Brabant Wind October, `lot-ein-wind-2026-09` named Brabant Wind September, `lot-ein-wind-2026-08` named Brabant Wind August. All four scores read 90.00. `ein-2026-10` has non-Actual share 12.89 percent.

**`tpe-2026-10`.** 1,000,000 Wh every hour, all Actual. One lot `lot-tpe-wind-2026-10` named Pirkanmaa Wind, FI, wind, rank 1, with bundles at local hours 02, 03, 04 and 05 on odd local dates, 8,000,000 Wh each. Scores at start: month 69.80, week 69.80, day 51.68, hour 8.72.

**`tpe-2026-09`.** 1,000,000 Wh every hour, all Actual. One lot `lot-tpe-wind-2026-09` named Pirkanmaa Wind September, FI, wind, rank 1, with three bundles of 500,000 Wh at UTC hours `2026-09-10T00:00:00Z`, `01:00:00Z` and `02:00:00Z`. Their contiguous ranges are `[9007199254740993, 9007199255240993)`, `[9007199255240993, 9007199255740993)` and `[9007199255740993, 9007199256240993)`.

**`rtm-2026-03`.** 1,000,000 Wh every hour, all Actual. One lot `lot-rtm-solar-2026-03` named Maasvlakte Solar March, NL, solar, rank 1, with bundles at local hours 09 to 14 on every local date, 2,000,000 Wh each. Scores: month 50.07, week 50.07, day 50.07, hour 25.03. Opinion `Unqualified`.

**`vnl-2026-10`.** Each hour consumes `500,000 + 1,000 × local day + 10 × local hour` Wh, plus 5 more on the repeated second pass, all Actual except these nine Missing hours: 1 October local hour 00; 3 October local hours 08, 09 and 10; 25 October local hour 02 on its second pass and local hour 03; 28 October local hours 08, 09 and 10. For example, with this seed, automatic repair fills 28 October with 521,080, 521,090 and 521,100 Wh and the 25 October gap with 525,027 and 525,033 Wh, and leaves the 1 and 3 October hours Missing.

## Technical requirements

### Deployment (DP-57)

Python 3.12 with `pip` and `venv` is available. The app is installed and run as an unprivileged user: dependencies go into a `.venv` inside `/app`, and the manifest calls its tools by path (`.venv/bin/<tool>`) or as `python -m <tool>`. `/app/run.json` holds string `install`, `build` and `serve` commands and `"_schema":"run-manifest-v1"`, for example:

```json
{"_schema":"run-manifest-v1","install":"python3 -m venv .venv && .venv/bin/pip install -r requirements.txt","build":"true","serve":".venv/bin/python -m hourproof"}
```

The server binds `0.0.0.0` on port 4173, honouring `APP_PUBLIC_PORT` when it is set. `GET /api/health` is the health check.

### Configuration and secrets (DP-36, DP-53, DP-60, DP-76)

Read at start, never hard-code and never send to the browser: `DATABASE_URL`; `WIREMOCK_URL`; `GOTENBERG_URL`; `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_FORCE_PATH_STYLE`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`.

Two settings have defaults: `SETTLEMENT_CLOCK_START`, default `2026-11-09T12:00:00Z`; `REVIEW_SECONDS`, in seconds, default `864000` (10 days). With the default clock, `rtm-2026-11` opens at `2026-12-02T23:00:00Z`; a run that sets `SETTLEMENT_CLOCK_START` to a later instant sees that window open and its pull allowed.

### Server boundary (DP-04, DP-57, DP-93)

The app is same-origin only and sends no cross-origin permission headers. A JSON body may be up to 1,000,000 bytes, that size allowed, and larger bodies answer `BODY_TOO_LARGE`. The server never serves source files, the run manifest, dependency folders, environment contents or credentials. Fonts, drawings and scripts are served from the app itself, and the browser makes no request to any other origin.

The app starts and answers its health check when WireMock, Gotenberg or MinIO is unreachable at boot, and it recovers each dependency as it returns, with no restart. It waits for PostgreSQL at boot, retrying until it connects.

### Browser support and performance (DP-55)

Support current Chromium, Firefox and WebKit at 320 to 1920 pixels of width, by mouse, touch and keyboard. The board is usable within three seconds on a loaded dev machine, the 745-cell wall within four seconds. A detent's numeral lands within one second of input. Open screens reflect server changes within five seconds.

## Working rules

- IF-01: `/app/run.json` exists with string `install`, `build` and `serve` commands and `"_schema":"run-manifest-v1"`.
- IF-02: `THIRD_PARTY_NOTICES.md` at `/app` lists every shipped package with its licence, plus the Unbounded and Onest typefaces with their licence; shipped packages means the production dependency tree, that is, the non-dev group of the Python lockfile or requirements.
- IF-03: Every shipped package and typeface is under MIT, Apache-2.0, BSD, ISC, PSF or the SIL Open Font License.
- IF-04: The app uses no datastore beyond the PostgreSQL and MinIO services named in this brief.
- IF-05: The provided service configuration and the published WireMock baseline stay untouched.
- IF-06: Python dependencies are installed into `.venv` inside `/app`, and no manifest command relies on a globally installed package.

## Engineering standards

- The code is idiomatic, type-annotated Python, and browser code follows the conventions of whichever language it is written in.
- Names in the code use this brief's domain terms: window, lot, bundle, line, grain, merit order, ledger movement, seal.
- Each domain rule, including every state transition, score computation, gap-repair rule and opinion decision, is decided in exactly one place in the source.
- There is no abstraction with a single implementation and no feature beyond this brief.
- There is no dead, commented-out or unreachable code and no defensive check for an impossible state.
- All API errors are produced through one consistent error shape, and energy arithmetic uses integers throughout, with no binary floating-point on any watt-hour, gram or basis-point path.
- Every provider result the app displays is one the server received from that provider, and provider failures are handled at the call that can fail.
