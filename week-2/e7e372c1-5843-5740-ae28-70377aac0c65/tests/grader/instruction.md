# Vellichor Holdings Tracewell

Tracewell is the public treasury record for Vellichor Holdings, Inc., an invented Nasdaq-listed company (ticker VLCH) whose main asset is a fully staked ETH treasury. It has a public side and a staff side.

- **Public side.** A figure board where investors and analysts read four headline figures: total ETH held, cumulative staking rewards, ETH per 1,000 diluted shares, and mNAV. For each figure the board shows which clock each input runs on and how fresh that input is. Any figure can be traced down to the filing line it came from.
- **Staff side.** A governed weekly workflow:
  - A treasury analyst drafts the weekly holdings restatement and attaches the signed exhibit.
  - Disclosure counsel checks it.
  - A disclosure officer releases it, withdraws a queued release, or publishes a correction.
  - Every change is kept in an attributed audit trail that can only grow.

Tracewell uses two backend services:

- **Postgres** is the system of record for share-count events, restatements and their audit trail, staff sessions, the session calendar, price ticks and stored figure computations.
- **A MinIO bucket** is the filing vault. It holds every exhibit byte for byte.

Out of scope:

- public accounts and staff self-registration
- email and payments
- charts of price history
- any datastore other than those two services
- any connection to real market data or SEC systems

Every person, filing, accession number, price and amount in this brief is invented.

## Problem and users

Listed companies with a crypto treasury publish headline figures such as total ETH held, cumulative staking rewards, ETH per 1,000 diluted shares and mNAV. Each figure combines inputs that run on different clocks:

- The share price trades from 09:30 to 16:00 New York time and freezes at the official close.
- The ETH price never stops.
- Holdings and the diluted share count change only when the company files a weekly update or an 8-K exhibit.

Today these numbers sit on hand-built investor-relations pages and in third-party trackers. Each tracker picks its own share-count bucket, price time and source, so one company shows several different mNAVs. A visitor cannot tell which input is stale or which filing a number came from. When a weekly figure is corrected, the old number either disappears without notice or stays next to the new one with no marker.

The issuer's investor-relations, treasury and disclosure-counsel teams pay for this:

- They answer analysts and journalists by hand.
- They add caution language to every posting.
- They carry the legal risk when a website number does not match its filing, when a filing reaches the public before its release, or when nobody can show who changed a figure and when.

A posted exhibit also has to meet the same bar as a filed one: no scripts, no links, no embedded files and no passwords.

Users:

- **Treasury analyst** (weekly): drafts the weekly holdings restatement and the share-count events behind it, and attaches the signed 8-K exhibit. Does not lose work when the staff session ends mid-edit. The restatement has six rows: beginning balance, ETH acquired, staking rewards, ending balance, cumulative staking rewards and assumed diluted shares.
- **Disclosure counsel** (weekly): checks every drafted figure against its exhibit line, returns the draft or clears exactly the version they reviewed, and reads the attributed audit trail of every change.
- **Disclosure officer** (weekly): releases a cleared restatement knowing beforehand whether it will queue or publish, withdraws a queued release before its session close, or publishes a correction that supersedes a prior week and states its reason.
- **Public investor** (daily): reads the live figure board, often on a phone. Sees which clock each number runs on and how fresh it is, and traces any figure down to its filing line.
- **Sell-side analyst** (occasional): cites a figure as of a specific date through a permalink that shows the same number, inputs and filing every time it is opened.
- **Operator** (as needed): controls the replayable signed price tape and the rehearsal clock used to rehearse releases, and reads the server's tape position and market clock.

## Journeys

1. **Reading the board.** A public investor opens `/` on a weekday afternoon.
   - On a desktop, the board shows the three-clock rail: equity session open, ETH price live, and the holdings week ending on the latest published Sunday. Beside it are four figure tiles. Each tile has a large numeral, a clock badge, an as-of time and a filing citation.
   - On a phone, the rail is a compact strip. The investor taps `Equity session details` to read the full status line. The line stays open while the board keeps refreshing. It also stays open when the connection drops and the board says it is showing the last loaded figures.
   - The investor keeps the board open past the session close. The equity clock changes to market closed, and a polite announcement reads the session-close copy once. The mNAV tile's share-price input now reads as the official close.
   - The investor has tabbed to an exhibit link in the weekly history when a new week is published. Within a few seconds the new week appears at the top of the history; the rows already there stay put and focus stays on the link.
2. **Unspooling a figure.** The investor activates the "ETH per 1,000 diluted shares" tile.
   - The numeral splits into its operand chips (ending ETH balance ÷ assumed diluted shares × 1,000). The chips spread out beneath the tile, each showing its clock badge and as-of.
   - The input that sets the figure's as-of gets an outline.
   - A thread draws from each filed input's chip to that input's own row in the cited exhibit table in the trace panel. The panel also shows the accession number and SHA-256.
   - The board keeps refreshing underneath, but the open trace does not move or change.
   - The investor scrolls the page behind the panel, and the threads stay attached to their chips and rows. The investor narrows the browser window and the threads follow again. When the window drops below tablet width, the threads disappear and the panel becomes a bottom sheet, still open on the same input.
   - The investor opens the exhibit, which downloads the stored PDF without leaving the trace, then closes the trace. The sequence reverses, nothing of the trace is left behind for the keyboard or a screen reader, focus returns to the tile, and the tile catches up to the newest figure.
   - On a phone the same trace opens as a bottom sheet. With reduced motion set, the inputs appear at once as an ordered list.
3. **Drafting a week.** Tamsin Okafor, a treasury analyst, signs in at `/staff`.
   - Tamsin starts the draft for the week after the latest published week. With the seed data, that is the week ending 2026-11-01, which spans the change back to standard time.
   - Tamsin enters the six exhibit rows and one share-count event, with accession `0002093117-26-000052`, page 1. For example, a week Tamsin can file against the seed data:

     | Row | Value |
     |---|---|
     | Beginning ETH balance | 413,602.6875 |
     | ETH acquired | 26,716.0625 |
     | Staking rewards | 425.25 |
     | Ending ETH balance | 440,744 |
     | Cumulative staking rewards | 11,521.4375 |
     | Assumed diluted shares | 160,000,000 |
     | Share-count event | ATM settlement +9,850,000 effective 2026-10-29 |

   - Before saving, Tamsin steps away. Meanwhile Tamsin signs out in another tab. Tamsin presses `Save draft`, and an inline sign-in dialog appears with every typed value still in place. Tamsin signs in again, and the interrupted save goes through once, exactly as typed. Had a colleague signed in at that dialog instead, nothing would have been sent.
   - Saving changes only what an analyst may change: the rows, the share-count events, the accession, the exhibit page and, on a correction, its reason. Nobody can move the draft's state, preparer or exhibit by sending extra fields.
   - Tamsin first chooses a PDF exported from a spreadsheet tool that left a hyperlink in it. The editor refuses it at once and says how to fix it. Nothing reaches the vault, and the draft is unchanged.
   - Tamsin chooses the clean exhibit PDF, and the trackpad double-drops it. Both uploads are accepted; each adds its own pair of versions to the draft and its own two audit lines, and the published exhibit object is written once. The editor announces the vault-confirmed SHA-256, and the exhibit shows as verified.
   - Tamsin presses `Save draft` once more after a last check. It saves, because the editor carries the restatement's newest version. Tamsin then sends the draft to disclosure counsel.
   - Until the week is published, nobody outside the staff can download that exhibit, even with its hash, a conditional request or a partial request.
4. **Review, release and withdrawal.**
   - Rafe Lindqvist, disclosure counsel, opens the in-review week in a browser tab and starts ticking rows. Meanwhile Wren Adeyemi, also counsel, returns it with a note. Tamsin corrects a row and resubmits it.
   - Rafe, still in the old tab, presses `Clear for release`. The clear is refused with the version-conflict copy, Rafe's ticks stay in place, and the restatement stays in review at its newer version. Rafe reloads, checks all six rows again and clears it.
   - Noor Halvorsen, a disclosure officer, opens the release dialog by keyboard during the regular session. Noor's laptop clock is hours wrong, but the dialog's timing line, read from the server, says releasing now queues the week to today's session close. Noor confirms. The network drops before the answer arrives, so the dialog says the release could not be confirmed. Noor presses Release again in the same dialog and sees the stored queued confirmation. The restatement is released once.
   - The release is queued to that day's session close (13:00 on an early-close day). The public board keeps showing the prior week, and the new exhibit stays undownloadable, until the server publishes it.
   - Twenty minutes before the close, counsel spots a typo in the exhibit's cover page. Noor opens `Withdraw release`, types a note and withdraws. The restatement is cleared again, nothing reached the public, and it can be released again later without a new review.
   - Another day, Noor opens the release dialog a few seconds before the close and leaves it open. When the server reports the close, the timing line changes in place to say releasing now publishes at once; the ticked box and focus stay where they were.
   - Another day, an officer tries to withdraw a queued release a moment after its close instant. The close wins: the withdraw is refused, and the week publishes at its release time exactly once.
   - Another time, Noor presses Release, has second thoughts and presses Cancel before the answer arrives, then reopens the dialog at once. The reopened dialog stays open and clean. The late answer appears in the staff updates line instead, and the editor shows the restatement's new state. The withdraw dialog and the sign-in dialog behave the same way.
   - A page on another site that tries to post a release with Noor's signed-in cookie is refused, and nothing changes.
   - A release outside the session publishes at once. The new week then appears in the tiles and at the top of the weekly history.
5. **Correction, a correction of the correction, and the audit trail.** A reward export turns out to have been wrong.
   - Tamsin and Imre Castellanos, both treasury analysts, press `Start correction` at the same moment. Exactly one correction draft is created; the other analyst is told something went wrong and nothing was changed.
   - The analyst who owns the draft gives a reason. Counsel clears it, and an officer who neither prepared nor cleared it releases it.
   - The board shows the corrected figures. The superseded week stays in the history, marked Restated with its date and reason and linked to the superseding row. Its exhibit still downloads byte for byte.
   - A second error is found in the correction itself. The analyst corrects the correction through the same steps. The history now shows the newest row, then the first correction, then the original, each superseded row naming its own superseder and its own reason.
   - Rafe opens each of the three restatements and reads its audit trail: one line per version, each naming who made the change (or Tracewell, for the server's own publication and supersede steps), when, and why.
6. **Citing a date.** A sell-side analyst opens `/cite/eth-per-1000-diluted/2026-10-20?step=diluted-shares`.
   - The page shows the figure as it stood at the end of that New York day. It is marked Restated, because a correction later superseded that week.
   - The trace is open on the assumed-diluted-shares input. The analyst downloads the cited exhibit.
   - A week later, after a newer week with a new ATM settlement is published, the same URL shows the same digits, inputs and exhibit.
   - The analyst also opens today's mNAV citation. It shows a Provisional marker. Its numeral, as-of line and clock badge follow each new tick in place while the analyst reads.
   - Once the server's New York date moves on, the marker drops by itself and the page never changes again, even if a slow response from before midnight arrives late.
7. **Vault outage.** The filing vault becomes unreachable.
   - The public board still shows every figure, with the vault notice.
   - An investor with a trace open presses `Open exhibit`. The page stays on the open trace, focus stays on the link, and the trace itself says the exhibit cannot be downloaded right now. The message stays while the board keeps refreshing, until the investor presses the link again.
   - Exhibit links for published filings answer with the fixed outage response. A browser that already holds a published exhibit is still told its copy is current. A hash that no published filing cites still answers not found.
   - Tamsin's draft already has a verified exhibit, and Tamsin chooses a replacement file. While it uploads, the editor honestly shows the exhibit as pending and Send as unavailable.
   - The upload is refused with the vault-down copy. The draft on the server is exactly as it was. The editor returns straight to `Exhibit verified` with Send available again, and the file control is cleared. The vault-down copy stays on screen while Tamsin keeps editing, until Tamsin chooses a file again.
   - No page or response reveals anything about the vault's address or the failure behind it.
   - When the vault comes back, the notice clears and exhibit links work again without restarting the app.
8. **Stale tape and rehearsal.** Basil Ferreira, the operator, opens `/operator`.
   - The console shows the tape's state and position and the server's market clock, both refreshed every few seconds.
   - Basil pauses the tick tape. After the stale threshold passes, the ETH clock on the public board shows the stale copy, and the mNAV tile's ETH price chip shows its last tick time.
   - An external feeder redelivers a tick it already sent, at the same moment as the tape sends the same new tick id. The server stores one tick and one mNAV computation, and every other delivery gets the stored tick back.
   - Resuming the tape returns the clock to live on the next tick.
   - Basil sets the rehearsal clock past a session close that has a queued release. The console confirms the setting and keeps that confirmation through every refresh, while its market-clock line follows the server. The server stores that close's mNAV and publishes the queued restatement at the close instant, exactly once, however many board refreshes arrive at the same time. The tape keeps signing on the rehearsal clock, so its ticks are never refused as stale.
   - Basil mistypes a time. The console refuses it with the invalid-time copy, which also stays through every refresh.

## Mandatory requirements

This is the complete list of mandatory requirements; every check traces to one of these lines and the detailed sections below.

- **DP-01 — Run manifest and health check** Ship the run manifest described in Deployment and answer the health check described there, even while the filing vault is unreachable.
- **DP-02 — Credentials from the environment** Read every database and filing-vault credential and URL at start from the environment variables in Configuration and secrets, never hard-code them, and never send them to the browser.
- **DP-03 — Same-origin server boundary** Refuse cross-site writes, oversize or wrong-type bodies, and requests for source or configuration files exactly as Server boundary states.
- **DP-04 — Filing vault outage** While the filing vault is unreachable, the board keeps showing every figure with the vault notice, and exhibit downloads and uploads are refused with the outage response, as qualified in Services.
- **DP-05 — Figure board tiles** The public board at / shows the four figure tiles in the published order, each with its displayed value, clock badge, as-of time and filing citation read from that figure's current stored computation.
- **DP-06 — Server-decided clock rail** The three-clock rail shows the equity session, ETH price and holdings week exactly as the board API reports them, never recomputed from the device clock even when that clock is wrong, picks up server changes within the refresh limit in Business rules, and keeps the last loaded state through a failed refresh.
- **DP-07 — Stale and market-closed notices** The board shows the stale-ETH and market-closed copy from Feedback states verbatim whenever the server reports those states.
- **DP-08 — Session close announcement** When the server reports the equity session closing while the board is open, the board announces the session-close copy once in its polite live region and the share-price input relabels to the official close.
- **DP-09 — Weekly history with restated entries** The weekly history lists every published and superseded restatement newest first and keeps superseded rows visible, marked Restated with their date, reason and a link to the superseding row.
- **DP-10 — Responsive board layout** The figure grid has one column below 768 px wide, two from 768 px and four from 1280 px, and the clock rail is a fixed left column from 1280 px and a horizontal strip below that, with no horizontal page scrolling at 375, 768 or 1280 px.
- **DP-11 — Exact amounts and display rounding** ETH is kept as integer wei and USD as exact decimals, no figure is computed in floating point, and rounding happens only at display by the rule in Business rules.
- **DP-12 — One stored computation per figure** Each figure value is computed once and stored, and the tile, the weekly history row, the citation and the trace all show the same digits and as-of from that stored row.
- **DP-13 — As-of from the oldest input** The server sets each computation's as-of to the oldest as-of among its inputs and flags the input that sets it.
- **DP-14 — mNAV follows ticks and every session close** The server stores a new mNAV computation on every newly accepted price tick, on every publication, and once at every session close the market clock passes, catching up skipped closes in order as qualified in Business rules.
- **DP-15 — Signed tick ingestion** The internal tick endpoint accepts only ticks whose signature verifies and whose signed timestamp is within the window in API measured on the server's market clock, stamps them on that clock, and refuses share-price ticks outside the regular session.
- **DP-16 — Tick tape and staleness** The seeded tape plays and signs its ticks as described in Seed data until the operator pauses it, and the ETH clock turns stale when no ETH tick has arrived within the threshold set by ETH_STALE_SECONDS.
- **DP-17 — Rehearsal clock** An operator can set the server's market clock to a chosen instant or return it to real time, and every time rule in the product follows that clock.
- **DP-18 — 2026 session calendar** The server applies the published 2026 regular-session hours, holidays and early closes, and reports them through the session calendar endpoint.
- **DP-19 — Staff sign-in and roles** Seeded staff sign in with email and password, staff sessions end as Staff sessions in Business rules states, and the server enforces the role rules in Business rules on every staff endpoint.
- **DP-20 — Draft sequence rules** A treasury analyst can open a weekly draft only for the week after the latest published week, only after that week has ended, and only while no other restatement is open.
- **DP-21 — Holdings arithmetic checks** The server rejects a draft whose six exhibit rows do not reconcile exactly, to 18 fractional digits, with the prior week, with each other and with the share-count ledger, naming every failing field, and stores every row as typed.
- **DP-22 — Effective-dated share count** Share-count events take effect on their effective date once their restatement publishes, a week may carry several, an event that would take the count to zero or below is refused, and every computation uses the diluted share count in effect on its own week-ending date.
- **DP-23 — Vault-confirmed exhibit attachment** An exhibit counts as attached only after the server has staged it in the vault, read it back and found its SHA-256 equal to the hash the browser computed, and until then the editor shows the exhibit as pending and the draft cannot be sent to disclosure counsel.
- **DP-24 — Exhibits kept byte for byte** Only verified bytes are copied to the published exhibit key, which is never rewritten even when identical bytes are uploaded again, downloading an exhibit from a trace returns exactly those bytes with the SHA-256 the trace shows even after later restatements, and a visible exhibit answers conditional and range requests with the headers in API.
- **DP-25 — Exhibit upload announcements** The draft editor announces the upload's progress, verification, hash mismatch, filing-safe refusal, size refusal and vault-down results in its exhibit-upload live region with the copy in Feedback states.
- **DP-26 — Counsel review** Disclosure counsel either returns an in-review restatement with a note or clears the version they reviewed after confirming all six exhibit rows, as qualified in Business rules.
- **DP-27 — Two-person release rule** The server refuses a clear by the restatement's preparer, a release by its preparer or by the person who cleared it, and a withdraw by its preparer, whatever roles they hold.
- **DP-28 — Release timing by session** On the server's market clock, a release during the regular session is queued to that day's session close, and a release outside it publishes at once.
- **DP-29 — Queued release publishes at close** A queued restatement that is not withdrawn before its release time publishes with its release time as its publication time, including when the market clock jumps past that close, as qualified in Business rules, and appears on the public board only after the server reports it published.
- **DP-30 — Release replay and races** A release replayed with the same idempotency key returns the stored response, even after the release was withdrawn, and when the same restatement is released several times at once, exactly one release succeeds.
- **DP-31 — Guarded restatement transitions** Every action outside the restatement state machine is refused with the conflict response in Business rules and leaves the restatement unchanged.
- **DP-32 — Weekly restatement journey** A treasury analyst drafts a week and attaches a verified exhibit, counsel clears it, a different officer releases it, and the new week appears on the public board with its figures and downloadable exhibit.
- **DP-33 — Release dialog by keyboard** A disclosure officer can open, complete and cancel the release and withdraw dialogs with the keyboard alone, with Tab wrapping inside each dialog, Escape closing it and focus returning to the opener.
- **DP-34 — Release confirmation copy** The release dialog shows the queued, published, refused or unconfirmed outcome from Feedback states verbatim in its release-status live region.
- **DP-35 — Corrections supersede the latest week** A published correction supersedes the latest published week's current restatement, which may itself be a correction, records its reason, and leaves every earlier version readable as restated and linked to its direct superseder.
- **DP-36 — Correction journey** After an officer publishes a correction, the public board shows the corrected figures while the superseded week stays in the history, marked Restated with its reason, and its exhibit still downloads.
- **DP-37 — Dated citation permalinks** A citation page and its API return the figure's last computation stored before the New York midnight that ends the cited date, and return the same digits, inputs, as-of and exhibit every time once that date is final (only the restated marker may be added later by a correction), as qualified in Business rules.
- **DP-38 — Citation URL restores the trace** The citation URL carries the figure, the date and the open trace step, so reloading or sharing it restores exactly that view.
- **DP-39 — Analyst citation journey** A sell-side analyst opens a past-date citation, steps to the diluted share count, downloads the cited exhibit, and later sees the same view after a newer week is published.
- **DP-40 — Unspool trace sequence** Activating a figure tile runs the four-step Unspool sequence in Motion and effects, with each thread running from its chip to its own exhibit row and re-anchoring within 300 milliseconds on resize and on page or panel scroll without replaying its draw, threads removed without closing the trace when a resize crosses below 768 px, and closing the trace reverses it.
- **DP-41 — Unspool by keyboard** A keyboard-only user can open Unspool on any tile, step through its inputs, open the exhibit link and close with Escape back to the tile, with Tab wrapping inside the trace.
- **DP-42 — Unspool with reduced motion** With reduced motion set, Unspool shows the ordered input list at once, draws no threads, opens the panel in place and focuses the first input, and every value and link still works.
- **DP-43 — Unspool on a phone** Below 768 px wide, the trace opens as a scroll-locking bottom sheet with chips and input buttons at the touch size given in Visual design and no threads.
- **DP-44 — Ruled ledger look** The board reads as a ruled ledger sheet, with hairline rules under every figure row, decimal-aligned tabular numerals, the palette and type in Visual design, and the accent used only for a trace in progress.
- **DP-45 — Unspool visual craft** An open trace reads as one connected path from the figure through its chips and threads to the highlighted exhibit row.
- **DP-46 — Vault recovery without restart** When the filing vault becomes reachable again, the notice clears and exhibit downloads and uploads work again without restarting the app, as qualified in Services.
- **DP-47 — Collapsed clock details** Below 768 px wide, each clock item shows a short status and a details button, its full status line is absent from the page and the accessibility tree until expanded, and its expanded state survives every board refresh.
- **DP-48 — Instants across the daylight-saving change** Every session, week-end and day-end instant uses the America/New_York offset in force on its date, as the week ending 2026-11-01 example in Business rules shows.
- **DP-49 — Release retry reuses its key** A release whose response was lost can be retried in the same dialog with the same idempotency key and shows the stored outcome without releasing twice, while a reopened dialog uses a new key.
- **DP-50 — Citation day boundary** A citation is provisional exactly while the server's New York date is the cited date, a provisional citation page turns final on its own once the server reports it final, and a future date is not found, as qualified in Business rules.
- **DP-51 — Opaque error bodies** Every error response uses the published error shape and fixed messages, and no response or page ever reveals hosts, ports, driver errors, stack frames, file paths, SQL, environment variable names or credentials.
- **DP-52 — Open trace survives refresh** Board refreshes and new computations never close, re-run, refocus or change an open trace or its tile, and the tile shows the current figure within 5 seconds after the trace closes.
- **DP-53 — Half-away ties on every surface** The tile, history cell, trace, citation and API display of every figure round a tie at display precision away from zero from the stored 18-digit value, which keeps its trailing zeros, as Display rounding in Business rules shows.
- **DP-54 — Tick redelivery by id** A correctly signed tick whose id was already accepted returns the originally stored tick and stores nothing new, and the same id with a different instrument or price is refused, as qualified in API.
- **DP-55 — Version-checked edits and clears** Every restatement carries a version that rises by exactly one on each stored change, and a save, clear or withdraw that carries any other version is refused with the version conflict in Business rules and changes nothing.
- **DP-56 — Provisional citation follows in place** While a citation is provisional and its trace is closed, the page shows each newly resolved computation within 5 seconds on the same elements without moving focus, and an open trace stays pinned until it closes.
- **DP-57 — Refused upload changes nothing** An exhibit upload refused because the vault is unreachable leaves the restatement's exhibit, version and update time unchanged, and the editor returns to its prior exhibit state and Send availability with the file control cleared.
- **DP-58 — Exact replayed seed state** A fresh start replays the seeded history to exactly the versions, audit entries, computations and current figures in Seed data, and a later start against the same database replays and duplicates nothing.
- **DP-59 — Exactly-once ticks and closes** Simultaneous deliveries of one new tick id store exactly one tick and one mNAV computation and never answer 500, and each session close is processed exactly once however many requests or timers see the clock pass it.
- **DP-60 — Cross-site staff writes refused** A state-changing request with a foreign or null Origin, or with no Origin and a cross-site or same-site fetch site, is refused with the cross-origin response before any body check and changes nothing, as Server boundary states.
- **DP-61 — Late responses never win** The citation page applies only a response newer than the one on screen, so a late provisional response never undoes a final citation, and rapid input stepping leaves the URL step, the pressed input and the current exhibit row on the last input chosen.
- **DP-62 — Honest exhibit state through a refused upload** While an upload is in flight the editor shows the exhibit as pending with Send disabled, and after a vault refusal it shows only its exact prior state and keeps the vault-down announcement until the next file is chosen.
- **DP-63 — Only editable draft fields accepted** A create or save that carries any member, row key or share-event attribute outside its published list is refused with a validation failure naming each such field, reported together with any other failing fields, and changes nothing, as Draft validation states.
- **DP-64 — Unreleased exhibits stay unfindable** An exhibit downloads publicly only once a published or superseded restatement cites it, and every other hash answers exactly like an unknown hash, whatever conditional or range headers it carries, without contacting the vault, as Exhibit access in Business rules states.
- **DP-65 — One open restatement under simultaneous creates** Of several simultaneous weekly or correction creates exactly one draft is stored and every other request is refused with a conflict, never 500, and a correction naming a restatement that has just been superseded is refused, as Opening a draft states.
- **DP-66 — Dialog outcomes stay with their session** A release, withdraw or sign-in response that arrives after its dialog closed never changes a reopened dialog, release and withdraw outcomes show in the staff updates region instead, and a dialog reopened during its closing transition stays open with focus on its first control, as Interactions states.
- **DP-67 — Withdraw a queued release** A disclosure officer who did not prepare a queued restatement can withdraw it back to cleared with a note only while the market clock is before its release time, and at or after that instant the close wins and the restatement publishes exactly once, as Withdrawing a queued release in Business rules states.
- **DP-68 — Attributed append-only audit trail** Every stored change to a restatement, including the server's own publication and supersede steps and the seeded history, writes exactly one attributed audit entry whose version equals the new version, refused requests and replays write none, and the database rejects any change to an entry.
- **DP-69 — Filing-safe exhibits** An exhibit that is not a complete PDF or carries any of the active-content, link, embedded-file or encryption names in Business rules is refused before the vault is contacted, stores nothing and leaves the restatement unchanged, even while the vault is down.
- **DP-70 — Interrupted action resumes after sign-in** When a save, send or clear is refused because the staff session ended, the editor opens the inline sign-in dialog keeping every typed value and resends the interrupted request once with its original body only if the same user signs in, as qualified in Interactions.
- **DP-71 — Operator console keeps its own status** The operator console shows the server's tape state, tape position and market clock, refreshed in place at least every 5 seconds and kept as last loaded through a failed poll, and its Operator status changes only on the operator's own Pause, Resume, Set clock or Use real time action.
- **DP-72 — Simultaneous uploads to one draft** Simultaneous exhibit uploads to one restatement are each answered without 409 or 500 and each add their own consecutive pending and final versions and audit entries, and the published exhibit key is written once and never rewritten, as Exhibits in Business rules states.
- **DP-73 — Exhibit download outcome stays in the trace** Open exhibit in a trace downloads the stored bytes in the page as the accession's PDF, and a vault refusal or network failure keeps the page, the open trace, its selected input and focus, and shows the copy in Feedback states in the trace's Exhibit download region until the link is activated again or the trace closes.
- **DP-74 — A closed trace is gone** Closing a trace makes it inert at once and, within 600 milliseconds, leaves no trace dialog, control, chip or thread rendered, focusable or in the accessibility tree, at every viewport.
- **DP-75 — Server-decided release timing preview** The release dialog's Release timing line says whether releasing now queues or publishes from the board API alone, re-reads it at least every 5 seconds while open and updates in place without changing the checkbox, the Release button or focus.
- **DP-76 — Weekly history updates in place** A newly published or correcting week enters the weekly history in place within 5 seconds, with superseded rows moved beneath their superseder, unchanged rows kept as the same elements, and a focused history link and expanded clock items kept as they were.

## Frontend

### Screens and layout (DP-05, DP-09, DP-10, DP-43, DP-47, DP-71, DP-76)

**Public board (`/`).** From top to bottom:

1. A header with the Vellichor Holdings name, the Tracewell wordmark, "Nasdaq: VLCH" and a small "Staff sign in" link.
2. A notices region. It is empty unless the filing vault is unavailable.
3. The three-clock rail: Equity session, ETH price and Holdings week.
4. The figure grid of four tiles, always in this order: Total ETH held, Cumulative staking rewards, ETH per 1,000 diluted shares, mNAV. Each tile shows its label, a large numeral, a hairline rule, a clock badge, an as-of line and a filing citation.
5. The weekly history table.
6. A footer with the disclosure note.

Layouts by viewport:

- **1280x800 and wider.**
  - The clock rail is a fixed column on the left that stays in view while the page scrolls. Each clock item shows its full status line.
  - The figure grid sits to the right of the rail in four columns. The history table runs below the grid.
  - The trace panel opens on the right edge, about a third of the viewport wide and full height. The page behind it stays scrollable.
- **768x1024 up to 1279 px.**
  - The clock rail becomes a horizontal strip of three items side by side above the grid. Each item shows its full status line.
  - The grid has two columns, in reading order. Row one is Total ETH held and Cumulative staking rewards. Row two is ETH per 1,000 diluted shares and mNAV.
  - The trace panel still opens on the right, about half the viewport wide, and the page behind it stays scrollable.
- **375x812 up to 767 px.**
  - The strip keeps its three compact items in one row. Each item stacks its clock name, its short status word and a details button.
  - The full status line of an item appears below the strip, inside the same group, only while that item is expanded.
  - While an item is collapsed, its full status line is either not rendered or hidden, so that it is not visible, not focusable and not in the accessibility tree. Clipping the line, shrinking it to zero height, making it transparent or moving it off-screen does not count as hidden.
  - The grid is a single column in tile order.
  - Each history row becomes a stacked card that lists every column as a label and value pair.
  - The trace opens as a bottom sheet that covers up to about 85% of the screen height and scrolls on its own. While the sheet is open, the page behind it does not scroll.

Common rules:

- No viewport from 375 px up shows horizontal page scrolling.
- Breakpoints are exactly 768 px and 1280 px wide. No other breakpoint changes which layout these three viewports get.
- Resizing an open page applies the layout for the new width without reloading, closing a trace or losing an expanded clock item's state.

**Citation page (`/cite/<figure>/<date>`).**

- It uses the same header, followed by:
  - a heading
  - any Restated or Provisional marker
  - a single figure tile, one desktop grid column wide
  - the trace
- When the URL carries a `step`, the trace is already open on that step.
- The clock rail and the history do not appear on this page.
- An unknown figure or date shows the not-found heading from Feedback states, with a link back to the board.

**Staff sign-in (`/staff`).** Email and password fields in a narrow centred form.

**Restatement list (`/staff/restatements`).**

- A table of restatements, newest week first. Its columns are: week ending, state, preparer, whether it is a correction, and its release time or publication time.
- Treasury analysts also see a "New weekly draft" button and a "Start correction" button. Each creates a draft at once, without a form, as Starting a draft in Interactions describes.

**Restatement editor (`/staff/restatements/<id>`).** From top to bottom:

1. A heading with the week-ending date, and the correction reason if this is a correction.
2. Six row fields, in the order of the exhibit table.
3. The share-count events list.
4. The accession number and exhibit page.
5. The exhibit area, with its status line and file chooser.
6. The actions the signed-in user can take in the current state:
   - for treasury analysts: save and send
   - for counsel: the review checklist and the return note
   - for officers: the release button, or the withdraw button while the restatement is queued
7. The audit trail table.

On a phone the editor stacks in one column. From 768 px the six rows sit in a two-column form, and the audit trail table scrolls sideways inside its own region if it is wider than the screen.

**Operator console (`/operator`).** From top to bottom: the tape line and the market-clock line (copy in Feedback states), the pause and resume buttons, the rehearsal clock field with its set and reset buttons, and the operator status line.

### Public screens and controls (DP-05, DP-06, DP-07, DP-08, DP-09, DP-25, DP-33, DP-34, DP-38, DP-41, DP-47, DP-49, DP-55, DP-56, DP-57, DP-61, DP-62, DP-66, DP-67, DP-68, DP-70, DP-71, DP-73, DP-75, DP-76)

Only the roles and names in this table are public contract, plus its two hook attributes, `data-unspool-chip` and `data-unspool-thread`. Everything else is free.

Placeholders used in the table:

- `<label>` is the figure label from Business rules.
- `<input label>` is the input label from Business rules.
- `<accession>` is the restatement's accession number.
- `<clock name>` is `Equity session`, `ETH price` or `Holdings week`.

| Where | Role and accessible name | Visible copy or content |
|---|---|---|
| Board | `region "Notices"` | the vault notice from Feedback states when the vault is unavailable, otherwise empty |
| Board | `region "Clocks"` containing `group "Equity session"`, `group "ETH price"`, `group "Holdings week"` | each group's full status line from Feedback states; below 768 px, the short status word, plus the full line only while expanded |
| Board, below 768 px only | per group, `button "<clock name> details"` with `aria-expanded` `true` or `false` | the disclosure control; none exist at 768 px and wider |
| Board | `status "Board updates"` (polite) | the session-close announcement and refresh failures from Feedback states |
| Board | `region "Figures"` containing four tiles, each headed by `<label>` | numeral, clock badge (by the clock-badge rule in Business rules), as-of line, citation |
| Board, citation | `button "Unspool <label>"` (one per tile, the tile's activation control) | the tile itself |
| Board | `region "Weekly history"` containing `table "Weekly holdings restatements"` | columns: Week ending, Beginning balance, ETH acquired, Staking rewards, Ending balance, Cumulative rewards, Diluted shares, ETH per 1,000 diluted shares, Exhibit, Status |
| History row | `link "Exhibit <accession>"` | the accession number |
| History row (superseded) | text `Restated`, the restated line, `link "View superseding entry"` | copy from Feedback states |
| Board footer | text | `Figures are preliminary and unaudited. Each figure links to the filing it comes from; where they differ, the filing controls.` |
| Trace | `dialog "Trace: <label>"` | the trace panel or bottom sheet |
| Trace | `list "Inputs"` with one `button "<input label>"` per input, the selected one with `aria-pressed="true"` | each item also shows its clock badge and its as-of; a live input also shows `Last tick <time> ET`, and the as-of-setting input also shows `Sets as-of` |
| Trace | `table "Exhibit <accession> page <page>"` | the six exhibit rows of the cited exhibit, present whenever the figure has a filed input. Each row's first cell is its row label. The selected filed input's row is marked current with `aria-current="true"`; no row is current while a live or official-close input is selected |
| Trace | text `Accession <accession>` and `SHA-256 <sha256>` | full 64-character lowercase hash |
| Trace | `link "Open exhibit <accession>"` | address `/api/exhibits/<sha256>`; downloads the stored PDF in the page |
| Trace | `status "Exhibit download"` (polite) | the exhibit-download copy from Feedback states; empty until a download fails |
| Trace (live inputs) | text `Last tick <time> ET` (`HH:MM:SS`) | for the ETH price and for a last-trade share price: on its chip, on its list item, and in the panel while it is selected |
| Trace (official-close input) | text `Official close <date> at <time> ET` (`HH:MM`, that date's session close) | in the panel while that input is selected |
| Board, citation (open trace) | one element per input carrying `data-unspool-chip="<input key>"` | the operand chips beneath the tile, or the reduced-motion list items; hidden from assistive technology |
| Board, citation (open trace, 768 px and wider, normal motion) | one SVG path per filed input carrying `data-unspool-thread="<input key>"` | the threads; none exist for live or official-close inputs, below 768 px, or under reduced motion |
| Trace (board only) | `link "Cite this figure"` | goes to the citation URL for the board's market date and the selected step |
| Trace | `button "Close trace"` | `Close` |
| Citation | heading | `<label> as of the end of <date>` |
| Sign-in | `textbox "Email"`, `textbox "Password"`, `button "Sign in"` | |
| Staff (all pages) | `button "Sign out"` | |
| Restatement list | `button "New weekly draft"`, `button "Start correction"` | |
| Editor | `heading "Week ending <date>"` (level 1) | |
| Editor | `textbox "Week ending"` | read-only after creation |
| Editor | `textbox "Correction reason"` | corrections only |
| Editor | `textbox "Beginning ETH balance"`, `textbox "ETH acquired"`, `textbox "Staking rewards"`, `textbox "Ending ETH balance"`, `textbox "Cumulative staking rewards"`, `textbox "Assumed diluted shares"` | the six exhibit rows |
| Editor | `button "Add share-count event"`; per event `combobox "Event type"` (ATM settlement, Warrant exercise, Buyback), `textbox "Shares"`, `textbox "Effective date"`, `button "Remove event"` | |
| Editor | `textbox "Accession number"`, `spinbutton "Exhibit page"` | |
| Editor | file control named `Exhibit PDF` | |
| Editor | exhibit state text | `No exhibit attached` (no exhibit), `Exhibit pending verification` (an upload in flight), `Exhibit verified` (status `verified`) or `Exhibit rejected — SHA-256 mismatch` (status `rejected`) |
| Editor | `status "Exhibit upload"` (polite) | upload copy from Feedback states |
| Editor | `alert "There is a problem with this draft"` | one link per failing field that moves focus to that field |
| Editor | `button "Save draft"`, `button "Send to disclosure counsel"` | |
| Editor (counsel) | six `checkbox "Matches exhibit: <row label>"`, `textbox "Return note"`, `button "Return to analyst"`, `button "Clear for release"` | row labels from Business rules |
| Editor (officer, state `cleared`) | `button "Release restatement"` | opens the release dialog |
| Editor (officer, state `queued`) | `button "Withdraw release"` | opens the withdraw dialog |
| Editor | `table "Audit trail"` | columns: Version, Action, By, At (ET), Note; one row per audit entry in version order. Action is the entry's action name from API; By is the actor's name, or `Tracewell` when the actor is null; At is `YYYY-MM-DD HH:MM:SS` New York wall time |
| Release dialog | `dialog "Release restatement"` (modal), `checkbox "I confirm this restatement is cleared for release"`, `button "Release"`, `button "Cancel"` | the dialog shows the week ending, preparer, clearer and accession |
| Release dialog | `status "Release timing"` (polite) | release-timing copy from Feedback states |
| Release dialog | `status "Release status"` (polite) | release copy from Feedback states |
| Withdraw dialog | `dialog "Withdraw release"` (modal), `textbox "Withdraw note"`, `button "Withdraw"`, `button "Cancel"` | the dialog shows the week ending and the queued release time |
| Sign-in dialog | `dialog "Sign in to continue"` (modal), `textbox "Email"`, `textbox "Password"`, `button "Sign in"`, `button "Cancel"`, `status "Sign-in status"` (polite) | the dialog's text and sign-in copy from Feedback states |
| Staff pages | `status "Staff updates"` (polite) | save, send, return, clear, version-conflict, withdraw, session and late dialog-outcome copy from Feedback states |
| Operator | text lines for the tape and the market clock | the operator console lines from Feedback states |
| Operator | `button "Pause tape"`, `button "Resume tape"`, `textbox "Rehearsal clock"`, `button "Set clock"`, `button "Use real time"`, `status "Operator status"` | operator copy from Feedback states |

### Interactions (DP-06, DP-08, DP-33, DP-38, DP-40, DP-41, DP-42, DP-43, DP-47, DP-49, DP-50, DP-52, DP-55, DP-56, DP-57, DP-61, DP-62, DP-66, DP-67, DP-70, DP-71, DP-73, DP-74, DP-75, DP-76)

**Board refresh**

- The board asks the server for its state on load, and again on the board cadence in Business rules.
- It renders the server's clock statuses, short status words, figures, history and vault state exactly as returned.
- It never works out session open or closed, staleness, publication or provisional status from the device clock. The device clock may be wrong by hours.
- The session-close copy is announced once, when two successive successful responses show the equity session going from open to closed. It is not announced on first load. It is not announced after a failed refresh unless the session really closed between the two successful responses.
- A refresh updates values in place. It never rebuilds the strip, the tiles, the history or an open trace from scratch.
- When a refresh fails (no response, or any error status), the board shows the refresh-failed copy from Feedback states. Every tile, rail text, history row, expanded clock item and open trace stays exactly as last loaded. The next successful refresh clears that copy and applies the server state within 5 seconds.

**Weekly history in place**

- When the server reports a newly published week or a correction, the next successful refresh changes the history in place: the new current row is inserted at its place, and a row it supersedes moves directly beneath it with its Restated line.
- Rows for unchanged restatements stay the same elements and change no text.
- A focused `Exhibit <accession>` link in the history keeps focus, and an expanded mobile clock item stays expanded.

**Mobile clock details (below 768 px)**

- Activating `<clock name> details` with a click, a tap, Enter or Space toggles that item. `aria-expanded` changes to match, and the full status line shows or hides.
- Focus stays on the button.
- Each item's expanded or collapsed state survives every board refresh, every failed refresh and every change of clock status. The text inside an expanded item updates in place.

**Opening a trace**

- Clicking, tapping, or pressing Enter or Space on a tile's `Unspool <label>` button opens that figure's trace for the stored computation the tile is showing.
- The first input is selected, and focus moves to its input button.

**An open trace through refreshes**

- While a trace is open, board refreshes and newly stored computations never:
  - close the trace, move focus, change the selected input or re-run the opening sequence;
  - change the traced tile's numeral, or any value, highlight, accession or hash in the trace;
  - change the number of chips or threads.
- The other tiles, the rail and the history keep updating as usual.
- Within 5 seconds after the trace closes, the traced tile shows the figure's current computation.

**An open trace through a resize or a scroll**

- From 768 px wide, the page behind the side panel keeps scrolling by wheel, trackpad or touch while a trace is open. Below 768 px, the bottom sheet stops the page behind it from scrolling while it is open.
- At 768 px and wider, a resize, a scroll of the page or a scroll of the panel's own content re-anchors every thread to its chip and row within 300 milliseconds, as Motion and effects describes, without replaying the draw.
- A resize that crosses below 768 px removes every thread and turns the panel into the bottom sheet. The trace stays open, with the same selected input and the same focused control.
- A resize that crosses back to 768 px or wider turns the sheet back into the side panel. The threads are drawn in place at their end state, without replaying the opening sequence.

**Stepping through inputs**

- Activating an input button selects that input:
  - For a filed input, the exhibit table marks that input's row current.
  - For a live input, the panel shows the last tick time instead.
  - For an official-close share price, the panel shows that close instead.
- The chips beneath the tile echo the input list. Clicking a chip selects the same input. Because the input buttons in the panel carry the same action, the chips are hidden from assistive technology and skipped by Tab.
- Inside the trace, `]` selects the next input and `[` selects the previous one, wrapping at either end. This works whichever control in the trace has focus.
- Presses are applied in the order they are made, however fast they come. After the last press, the pressed input button, the current exhibit row and (on a citation page) the URL `step` all name the input that press selected.
- A selection does not move focus.

**Keyboard containment**

- While a trace, the release dialog, the withdraw dialog or the sign-in dialog is open, focus stays inside it. Tab from the last control goes to the first control, and Shift+Tab from the first control goes to the last.
- Escape closes the trace or dialog. Focus returns to the control that opened it: the tile's button, `Release restatement`, `Withdraw release`, or the action button whose request opened the sign-in dialog.

**Closing a trace**

- Escape, `Close trace`, or a click outside the panel on desktop runs the closing sequence and returns focus to the tile's button.
- The trace is inert from the moment its closing sequence starts, so nothing in it takes focus or clicks.
- Within 600 milliseconds of the closing sequence starting, the panel or sheet is removed from the page or hidden (not displayed): no `dialog "Trace: …"` remains in the accessibility tree, and no element carrying `data-unspool-chip` or `data-unspool-thread` remains in the document. Moving it off-screen, making it transparent or giving it zero height does not count as closed. This holds at every viewport and under reduced motion.

**Opening an exhibit**

- `Open exhibit <accession>` keeps its address. Activating it with a click, a tap or Enter fetches the exhibit inside the page instead of navigating.
- On 200, the browser saves exactly the received bytes as `<accession>.pdf`. The trace stays open with the same selected input, and focus stays on the link.
- On 503, or a network failure, nothing is saved and the page does not navigate. The trace stays open with the same selected input, focus stays on the link, and `status "Exhibit download"` shows the vault copy from Feedback states. Any other status shows the unexpected-error copy there instead.
- That copy stays through every board refresh, citation refresh and input step. Activating the link again clears it and starts a new download; closing the trace clears it. This region is the only part of an open trace that is not pinned to its computation, and refreshes never write to it.

**Citation URL**

- On a citation page, opening the trace or selecting an input replaces the URL's `step` query value with the selected input key. No history entry is added.
- Closing the trace removes `step`, also without adding a history entry, so Back never brings a removed `step` back.
- Loading a citation URL with a valid `step` shows the trace already open at its end state on that input, with no opening sequence, and focuses that input's button.
- An unknown `step` is ignored and the trace stays closed.

**Provisional citations follow the server**

- While the server reports the citation as provisional, the page re-fetches it on the board cadence.
- With the trace closed, the page shows the computation the server currently resolves within 5 seconds of it being stored. For example, a newly accepted tick changes today's mNAV citation.
  - The update is in place. The tile, its numeral, the as-of line, the clock badge, the citation line and the Provisional marker stay the same elements; nothing is removed and re-created.
  - Focus stays where it is.
- With the trace open, the tile and trace stay pinned to the computation they opened on, as on the board. Within 5 seconds after the trace closes, the tile shows the latest resolved computation.
- When the server reports the citation final, the page drops the Provisional marker within 5 seconds, without a reload and without closing an open trace. With the trace closed it shows the final computation; with the trace open, it does so within 5 seconds after the trace closes.
- The page applies a citation response only if its request was sent after the request whose result is on screen. A response to an earlier request that arrives later is discarded.
- Once any response has reported the citation final, the page stops re-fetching and never changes again. A provisional response that arrives afterwards, whenever it was sent, never brings back the Provisional marker or older digits.

**Release dialog**

- `Release restatement` opens the dialog with focus on the confirmation checkbox. `Release` stays disabled until the box is ticked.
- **Release timing.** When the dialog opens, and on the board cadence while it stays open, it reads `GET /api/board` and shows the release-timing copy from Feedback states in `status "Release timing"`: the queue copy while the board reports the equity session `open` (from its `closes_at`), the publish copy while it reports `closed`. The text changes in place when the server's report changes. A change never unticks the checkbox, changes whether `Release` is enabled, or moves focus. The device clock is never consulted, and the line stays as last loaded through a failed read. The server's answer to `Release` is authoritative even when the line has not caught up.
- Each opening of the dialog starts a new dialog session. A dialog session creates one idempotency key, and every press of `Release` in that session sends that same key.
- If a press gets no HTTP response (a network failure):
  - The release-status live region shows the unconfirmed copy from Feedback states.
  - `Release` stays enabled and the checkbox stays ticked.
  - Pressing `Release` again resends the same key, and the server's stored outcome is then shown.
- Once any HTTP response arrives, its copy is shown and `Release` stays disabled for the rest of this dialog session.
- The dialog stays open to show the outcome. `Cancel` or Escape closes it.
- **A response belongs to the dialog session that sent it.** The dialog may be closed (Cancel or Escape) while a release request is still waiting, with the response arriving later. In that case:
  - The response never writes into a dialog session opened since. It does not change that session's `Release status`, its checkbox or whether its `Release` button is enabled, and it never moves focus. A reopened dialog keeps its empty status, its unticked checkbox and its disabled `Release` until the officer ticks the box.
  - The outcome copy (queued, released, refused, unconfirmed or unexpected error) appears in `status "Staff updates"` instead. The editor re-reads the restatement and shows its current state.
  - If the restatement is then no longer cleared, pressing `Release` in the reopened dialog sends the new session's key, and the server's 409 shows the state-changed copy from Feedback states.
- **Reopening during the closing transition.** `Release restatement` may be activated again while the dialog is still fading out after Cancel or Escape. The dialog then opens as a new dialog session, fully visible and modal, with focus on the checkbox. No pending close from the earlier session ever hides it afterwards.

**Withdraw dialog**

- `Withdraw release` opens the dialog with focus on `Withdraw note`.
- `Withdraw` stays disabled until the note is 10 to 500 characters long.
- Pressing `Withdraw` sends the note together with the version the editor holds.
- On any HTTP response, the dialog closes, the outcome copy from Feedback states appears in `Staff updates`, the editor re-reads the restatement, and focus moves to the editor's heading.
- On a network failure, the dialog stays open with the note kept and `Withdraw` enabled, and `Staff updates` shows the unexpected-error copy. Pressing `Withdraw` again resends the same body.
- `Cancel` or Escape closes the dialog without sending anything.
- It follows the release dialog's session rules. A withdraw response that arrives after its dialog was closed only writes its outcome to `Staff updates` and makes the editor re-read; it never closes, fills or changes a withdraw dialog opened since, and never moves focus out of it. Activating `Withdraw release` during the fade-out opens a new session, fully visible and modal, with an empty note, `Withdraw` disabled and focus on `Withdraw note`, and no pending close hides it.

**Starting a draft**

- `New weekly draft` posts an empty JSON object `{}` to the create endpoint. The server chooses the week ending, as Opening a draft states.
- `Start correction` posts `{"supersedes":"<id>"}`, where `<id>` is the id of the latest published restatement in the list the page already loaded. No reason is typed at this point.
- On a 201 the browser opens the editor at `/staff/restatements/<id>` for the new draft. The six rows, the share-count events, the accession number and the exhibit page are empty.
- The analyst types `Correction reason` in the editor, fills the other fields and presses `Save draft`.
- If the create answers with a 409, `Staff updates` shows the unexpected-error copy from Feedback states and the list stays open.

**Versions in the editor**

- The editor remembers the `version` of the latest restatement it received in any response: the page load, a save, an exhibit upload, a submit, a return, a clear or a withdraw. When several uploads answer, it keeps the highest version among them.
- `Save draft`, `Clear for release` and `Withdraw` send that version.
- `Save draft` sends only the members a save accepts (see the PATCH row in API).
- On a 409 `version_conflict` for a save or clear, `Staff updates` shows the version-conflict copy from Feedback states. Typed field values and ticked checkboxes stay exactly as they were, and nothing reloads by itself.
- Row fields keep exactly what the analyst typed, and a saved row reloads exactly as the server returns it. For example, `425.250` stays `425.250`.

**Uploading an exhibit**

- Choosing or dropping a file makes the browser compute its SHA-256. It then uploads the file with that hash, always sent as a PDF. Every chosen or dropped file is uploaded, even when an earlier one is still in flight.
- From the moment the file is chosen until the server answers, the exhibit state reads `Exhibit pending verification` and `Send to disclosure counsel` is disabled. This holds even when a verified exhibit was attached before.
- **Verified upload or hash mismatch.** The editor re-reads the restatement and shows the stored exhibit state. The live region announces the result.
- **Refusal that stores nothing.** This covers the 503 outage body, a 413 size refusal, a 422 `file` refusal and a 422 `accession` refusal. The editor goes straight back to exactly what it showed before the file was chosen:
  - the same exhibit state text, for example `No exhibit attached`, or `Exhibit verified` if a verified exhibit was already attached;
  - the same enabled or disabled `Send to disclosure counsel`.

  No other exhibit state text appears between the pending text and that prior text. The file control is cleared, so choosing the same file again starts a new upload.
- The latest upload copy stays in `status "Exhibit upload"` until the next file is chosen. It survives every later repaint, editor re-fetch, save and field edit. Choosing a file again replaces it with the progress copy.

**An ended staff session**

- When `Save draft`, `Send to disclosure counsel` or `Clear for release` is answered 401 `unauthenticated`:
  - The editor opens `dialog "Sign in to continue"` with focus on its `Email` field.
  - Every typed value, share-count event and ticked checkbox stays exactly as it was.
  - The editor keeps the interrupted request exactly as it was sent, including its `version`.
- After a successful sign-in in that dialog, the dialog closes.
  - **Same user.** If the signed-in user is the one whose session ended, the editor resends the interrupted request once, with the identical body, and shows that action's normal outcome. For example, it shows `Draft saved.`, or the version-conflict copy if someone else changed the restatement meanwhile.
  - **Different user.** Nothing is resent. `Staff updates` shows the different-user copy from Feedback states, and the editor re-reads the restatement for the new user.
- A failed sign-in keeps the dialog open with its values and shows the sign-in-failed copy in `Sign-in status`.
- `Cancel` or Escape closes the dialog, sends nothing and keeps every value. `Staff updates` then shows the cancelled-session copy.
- The sign-in dialog follows the release dialog's session rules. A sign-in response that arrives after its dialog was cancelled never resends the interrupted request and never closes or changes a sign-in dialog opened since. Reopening it during its fade-out opens a new session, fully visible and modal, with focus on `Email`, and no pending close hides it.
- Any other staff action answered 401 sends nothing more and shows the cancelled-session copy in `Staff updates`. An exhibit upload answered 401 restores its prior state as a refusal that stores nothing.

**Touch**

- Every tile, chip, input button, details button and link can be tapped, and each is at least the touch size in Visual design.
- On a phone, the bottom sheet closes with `Close trace`, or with Escape on a connected keyboard.

**Operator console**

- On load and on the board cadence, the console reads `GET /api/operator/tape` and `GET /api/clock` and updates the tape line and the market-clock line in place. Nothing else on the console changes on a poll.
- The market-clock line shows the `now` of the latest successful clock response. It never ticks on its own and never reads the device clock.
- A failed poll leaves both lines exactly as last loaded.
- `status "Operator status"` changes only when the operator presses `Pause tape`, `Resume tape`, `Set clock` or `Use real time` in this tab. A poll, a failed poll or a change made in another operator tab never clears or replaces it, including the invalid-time copy. For example, when another tab pauses the tape, the tape line follows within 5 seconds and this tab's `Operator status` keeps what it last showed.

**Rehearsal clock**

- The operator types a New York wall time into `Rehearsal clock` as `YYYY-MM-DD HH:MM:SS` (24-hour, for example `2026-11-02 15:59:30`) and presses `Set clock`.
- The page sends that instant to the clock endpoint, with the America/New_York offset in force at that wall time.
- A wall time that occurs twice when clocks fall back means the earlier instant.
- Any other text, or a wall time that does not exist, is not sent. The page shows the invalid-time copy from Feedback states instead.
- `Use real time` sends null.

### Visual design (DP-43, DP-44, DP-45)

**Palette, in words**

- The page is a warm, slightly yellowed paper ground.
- Text and numerals are a near-black ink with a faint blue cast.
- Hairline rules are a warm stone grey.
- One saturated ultramarine blue is the trace accent, used only while a trace is in progress. It colours the threads, the outline of the selected input and the highlighted exhibit row. The threads and the selected input's outline are the same blue.
- A burnt orange marks staleness: the stale ETH clock, and the outline of the input that sets a figure's as-of while that input is shown in a trace.
- Nothing else is coloured.

**Type**

- Headings and the wordmark use Archivo, a grotesque with firm, slightly wide letters.
- Body text uses IBM Plex Sans.
- Every numeral on the board, in the history table, in the audit trail and in the trace uses IBM Plex Mono with tabular figures. Numerals are right-aligned so the decimal points line up down a column.
- Each heading level is about a third larger than the level below it, so a tile numeral is roughly two and a third times the body size.
- The app serves all fonts itself.

**Density and composition**

- Spacing is comfortable, with generous space around each tile and table row.
- The page reads as a ruled ledger sheet. Every figure row and table row sits on a single hairline rule.
- Tiles have no shadows, rounded cards or gradients.
- Clock badges are small labels outlined in ink.

**Targets and contrast**

- Every interactive control is at least 44 by 44 px. That includes the trace input buttons, the chips on touch screens and the clock details buttons.
- Text and controls meet WCAG 2.2 AA contrast on the paper ground, including the burnt-orange stale text.
- Focus is shown by a thick ink outline, never the accent blue.

### Motion and effects (DP-40, DP-42, DP-43, DP-45, DP-52, DP-66, DP-74)

Unspool is the only sequenced motion. Every motion starts quickly and settles softly at its end.

1. **Split and spread (from activation to about a quarter of a second).**
   - On activation, the tile's numeral splits into its operand chips in input order.
   - For Total ETH held and ETH per 1,000 diluted shares, the operators (+, ÷, ×) sit between the chips. For mNAV, a small formula line in words sits above its four chips.
   - Over about a quarter of a second, the chips spread out in a row beneath the tile.
2. **Badge and as-of (by the end of the spread).**
   - Each chip shows its clock badge and its as-of time, and a live input's chip shows its last tick time.
   - The input that sets the figure's as-of gets a burnt-orange outline.
3. **Threads and panel (starting about a sixth of a second after activation).**
   - The panel slides in from the right edge over about a quarter of a second, or up from the bottom on a phone. It opens with the first input selected and, when that input is filed, its exhibit row highlighted.
   - At the same time, at 768 px and wider, one ultramarine thread draws progressively over about four-tenths of a second for every filed input (any input whose source is an exhibit row). Each thread runs from its own chip to its own input's row in the exhibit table.
   - Once drawn, each thread starts inside its chip's box and ends inside the box of the exhibit table row whose first cell is that input's row label, whenever both are inside the viewport.
   - Every filed input has exactly one thread. For example, an mNAV trace during the session after a VLCH tick has four chips and exactly two threads: one for the ending ETH balance and one for the assumed diluted shares.
   - If the viewport is resized, or the page or the panel's content is scrolled, while the trace is open, the threads re-anchor to the chips' and rows' new positions within 300 milliseconds, without replaying the draw. A resize below 768 px removes them, as Interactions states.
   - These inputs get no thread:
     - Live inputs: the ETH price, and the share price while it is a last trade. They show their last tick time instead.
     - An official-close share price. It shows its close instead.
   - Below 768 px no threads are drawn, because the bottom sheet covers the tile. The chips still appear.
   - Chips and threads carry the hook attributes from Public screens and controls.
   - The whole opening finishes within six-tenths of a second of activation.
4. **Provenance.** The panel shows the accession number and SHA-256 for the cited exhibit.

Closing runs the steps in reverse, in about the same times, all within six-tenths of a second. The threads retract, the panel slides out, and the chips gather back into the numeral. Then the trace is removed or hidden as Interactions states, and focus returns to the tile.

The opening sequence runs only on activation. A board refresh, a citation update, a resize or a scroll never replays it or any part of it.

Small effects:

- Hovering over or pressing a tile thickens its hairline rule in ink within a tenth of a second.
- A figure value that updates on refresh changes in place with no animation. A history row that is inserted or moved appears in its place with no animation.
- The release, withdraw and sign-in dialogs fade in and out over about a sixth of a second. Reopening a dialog during its fade-out behaves as Interactions states.
- There are no idle, looping or decorative animations anywhere.

**Reduced motion.** When the user prefers reduced motion:

- Activation immediately replaces the tile's numeral with an ordered list of its inputs. Each list item shows its clock badge, its as-of time and its exhibit reference, or its last tick time for a live input.
- No threads are drawn, so no element carries the thread hook. Each list item carries the chip hook for its input.
- The panel appears in place without sliding.
- Focus moves to the first input button. Every value, highlight, accession, hash and exhibit link is present.
- Closing removes the list and the panel at once and returns focus to the tile.
- Every dialog appears and disappears at once, with no fade.

### Feedback states (DP-04, DP-07, DP-08, DP-09, DP-25, DP-34, DP-37, DP-47, DP-49, DP-50, DP-55, DP-57, DP-62, DP-66, DP-67, DP-69, DP-70, DP-71, DP-73, DP-75)

Every string in backticks renders character for character, with straight apostrophes and the em dashes shown.

Placeholders:

- `<time>` is a New York wall time at the offset in force on its date, as 24-hour `HH:MM:SS` or `HH:MM` as stated.
- `<date>` is `YYYY-MM-DD`.
- `<sha256>` is 64 lowercase hex characters.
- `<reason>` is the correction reason as stored.
- `<name>` is the signed-in staff member's name.
- `<n>` is the tape position from the tape endpoint.

Staff screens show only the copy below, plus the server's per-field messages in the error summary. They never show any other text from a server response.

Board and citation:

| State | Where | Copy |
|---|---|---|
| Board loading | `status "Board updates"` | `Loading figures...` |
| Refresh failed (the board keeps the last loaded state until the next success clears this) | `status "Board updates"` | `Figures could not be refreshed. Showing the last loaded figures.` |
| Equity session open | `group "Equity session"` full line | `Session open — closes at <time> ET` (`HH:MM`, the server's close time for today) |
| Market closed | `group "Equity session"` full line | `Market closed — share price is the <date> official close` |
| Session close announcement | `status "Board updates"` | `Equity session closed. Share price is now the <date> official close.` |
| ETH live | `group "ETH price"` full line | `Live — last tick <time> ET` (`HH:MM:SS`) |
| ETH stale | `group "ETH price"` full line | `Stale — no ETH tick since <time> ET` (`HH:MM:SS`), or `Stale — no ETH tick received` when no ETH tick exists |
| Holdings week | `group "Holdings week"` full line | `Week ending <date> — as of <date> 23:59:59 ET` |
| Short status words (below 768 px, always visible) | each group | Equity session `Open` or `Closed`; ETH price `Live` or `Stale`; Holdings week `Week <date>` (the week-ending date) |
| Tile as-of line | tile | `As of <date> <time> ET` (`HH:MM:SS`) |
| Tile citation | tile | `Accession <accession> · p. <page>` |
| Share-price input label when it is a last trade (in session, after the day's first VLCH tick) | chip and input button | `Share price — last trade` |
| Share-price input label when it is an official close (outside the session, or in session before the day's first VLCH tick) | chip and input button | `Official close <date>` (the close's date) |
| Filing vault unavailable | `region "Notices"` | `Filing vault unavailable — exhibits are temporarily unavailable. Figures shown are unchanged.` |
| Exhibit download refused by the vault, or no response | `status "Exhibit download"` in the trace | `Filing vault unavailable — this exhibit cannot be downloaded right now. Figures shown are unchanged.` |
| Exhibit download, any other error status | `status "Exhibit download"` in the trace | `Something went wrong. Nothing was changed.` |
| Restated marker | history row, citation page | `Restated`, then `Restated on <date>: <reason>` (the direct superseder's publication date and reason) and `link "View superseding entry"` |
| Provisional citation | citation page | `Provisional — <date> has not ended; this figure may still change.` |
| Citation not found | citation page heading | `No published figure for that date.` |

Staff (`status "Staff updates"` unless noted):

| State | Copy |
|---|---|
| Sign-in failed (on `/staff`, or in `status "Sign-in status"` inside the sign-in dialog) | `Email or password is incorrect.` |
| Session ended, sign-in dialog text | `Your session ended. Sign in again to finish this action.` |
| Session ended, sign-in cancelled or another action refused | `Your session ended. Sign in to save your changes.` |
| Different user signed in at the dialog | `Signed in as <name>. The interrupted action was not sent.` |
| Draft saved | `Draft saved.` |
| Draft has field errors | the `alert` heading `There is a problem with this draft`, with one link per field showing the server's message |
| Sent to counsel | `Sent to disclosure counsel.` |
| Send refused, exhibit not verified | `Attach a verified exhibit before sending to disclosure counsel.` |
| Returned | `Returned to the treasury analyst.` |
| Cleared | `Cleared for release.` |
| Save or clear refused, version conflict | `This restatement changed since you opened it. Reload to see the current version.` |
| Withdrawn | `Release withdrawn — the restatement is cleared again.` |
| Withdraw refused (any 409) | `This restatement has already published or changed. Refresh to see its current state.` |
| Upload in progress (`status "Exhibit upload"`) | `Uploading exhibit and checking SHA-256...` |
| Upload verified (`status "Exhibit upload"`) | `Exhibit verified — SHA-256 <sha256> matches the vault copy.` |
| Hash mismatch (`status "Exhibit upload"`) | `Exhibit rejected — the vault copy's SHA-256 does not match the file you chose.` |
| Not a complete PDF (`status "Exhibit upload"`) | `Choose a PDF file.` |
| Not filing-safe (`status "Exhibit upload"`) | `This PDF contains active content, links, embedded files or encryption. Print it to a new PDF and try again.` |
| Too large (`status "Exhibit upload"`) | `The exhibit is larger than the size limit.` |
| No saved accession (`status "Exhibit upload"`) | `Save the accession number before attaching an exhibit.` |
| Vault down on upload (`status "Exhibit upload"`) | `Filing vault unavailable — the exhibit was not stored. Try again when the vault is back.` |
| Release timing, session open (`status "Release timing"`) | `Releasing now queues it to the <time> ET session close on <date>.` (`HH:MM` and date of the board's `closes_at`) |
| Release timing, session closed (`status "Release timing"`) | `Releasing now publishes it at once.` |
| Release queued (`status "Release status"`) | `Release queued — publishes at the <time> ET session close on <date>.` (`HH:MM`) |
| Released now (`status "Release status"`) | `Released — published at <time> ET on <date>.` (`HH:MM:SS`) |
| Release unconfirmed, no response received (`status "Release status"`) | `The release could not be confirmed. Press Release to try again; it will not be released twice.` |
| Release refused, two-person rule (`status "Release status"`) | `You prepared or cleared this restatement, so another disclosure officer must release it.` |
| Release refused, state changed (`status "Release status"`) | `This restatement is no longer cleared. Refresh to see its current state.` |
| Release outcome arriving after its dialog closed (`status "Staff updates"`) | the same copy that outcome shows in `Release status` (any of the five release rows above, or the unexpected-error copy) |
| Any unexpected server error, in the live region of the action that failed | `Something went wrong. Nothing was changed.` |

A replayed release response shows the queued or released copy for the outcome it carries. For example, a release accepted at 2026-11-27 12:59:59 ET shows `Release queued — publishes at the 13:00 ET session close on 2026-11-27.`, and one accepted at 2026-11-27 13:00:00 ET shows `Released — published at 13:00:00 ET on 2026-11-27.`

Operator:

| State | Where | Copy |
|---|---|---|
| Tape line | console text | `Tape playing at position <n>` or `Tape paused at position <n>` |
| Market-clock line | console text | `Market clock <date> <time> ET` (`HH:MM:SS`, the server's `now`) |
| Tape paused | `status "Operator status"` | `Tape paused.` |
| Tape playing | `status "Operator status"` | `Tape playing.` |
| Clock set | `status "Operator status"` | `Clock set to <date> <time> ET.` (`HH:MM:SS`) |
| Clock reset to real time | `status "Operator status"` | `Clock follows real time.` |
| Invalid rehearsal clock entry | `status "Operator status"` | `Enter a time as YYYY-MM-DD HH:MM:SS in New York time.` |

## Backend

### API (DP-01, DP-15, DP-17, DP-18, DP-19, DP-23, DP-24, DP-30, DP-37, DP-51, DP-54, DP-59, DP-63, DP-64, DP-67, DP-68, DP-72)

**General conventions.**

- All bodies are `application/json; charset=utf-8` unless stated otherwise. Size limits are in Server boundary.
- Times in responses are ISO 8601, with the America/New_York offset in force at that instant: `-04:00` before 2026-11-01 02:00 and `-05:00` from then.
- Computation `value` strings are decimals with exactly 18 fractional digits.
- Restatement rows and share-event `shares` are returned exactly as typed and stored. For example, `"425.250"` reads back as `"425.250"`.
- A filed input's `value` is its row exactly as stored.
- Tick prices are returned as received.
- Share counts are integer strings.

**Error shape.**

- Every error is `{"error":{"code":"<code>","message":"<text>"}}`.
- A validation failure is 422 with code `validation_failed` and message `Some fields need attention.`. The `fields` object sits inside `error`, so the full body is `{"error":{"code":"validation_failed","message":"Some fields need attention.","fields":{"<field>":"<message>"}}}`.
- These codes always carry exactly these messages:
  - 503 `vault_unavailable`: `Filing vault unavailable.`
  - 422 `invalid_json`: `Request body is not valid JSON.`
  - 500 `internal`: `Something went wrong. Nothing was changed.`
- For example, the full vault outage body is `{"error":{"code":"vault_unavailable","message":"Filing vault unavailable."}}`.
- Every other code carries a short plain-English message of the app's choosing.
- An unknown `/api/` path is 404 `not_found`.

**Error precedence, for the whole API:**

1. 403 `cross_origin`
2. 413 or 415 body checks
3. 422 `invalid_json` for a JSON body that does not parse
4. 401 unauthenticated or bad signature, then 401 stale signature
5. an idempotent replay returns its stored response: a release with a known idempotency key, or a tick whose id is already stored (decided as Internal ticks states)
6. 404 unknown resource
7. 403 forbidden
8. 409 state conflict
9. 422 `validation_failed`
10. 503 for an unreachable filing vault

There is one exception. An exhibit hash mismatch can only be known after the vault has answered, so it returns 422 after the vault is reached. No request is ever answered 500 because another request raced it. Each endpoint row below names only that endpoint's extra errors.

**Session (staff).** The cookie `tw_session` is HttpOnly, SameSite=Lax and Path=/.

| Method and path | Request | Success | Extra errors |
|---|---|---|---|
| `POST /api/session` | `{"email","password"}` | 200 `{"user":{"id","name","email","roles":["treasury_analyst"\|"disclosure_counsel"\|"disclosure_officer"\|"operator"]}}`, sets the cookie | 401 `invalid_credentials`, 422 |
| `GET /api/session` | | 200 same body | 401 `unauthenticated` |
| `DELETE /api/session` | | 204, ends the session for every tab that shares the cookie | |

Every staff endpoint answers 401 `unauthenticated` when there is no session cookie, or when the cookie's session has ended under Staff sessions in Business rules.

**Public.**

| Method and path | Success |
|---|---|
| `GET /api/health` | 200 `{"status":"ok"}` |
| `GET /api/clock` | 200 `{"now":"<iso>","rehearsal":true\|false}` |
| `GET /api/session-calendar?date=YYYY-MM-DD` | 200 `{"date","trading_day":bool,"holiday":"<name>"\|null,"opens_at":"<iso>"\|null,"closes_at":"<iso>"\|null,"early_close":bool}`. A malformed date, or a date outside 2026, is 422. |
| `GET /api/board` | 200, with the body shape below |
| `GET /api/computations/{id}` | 200 `{"computation":<Computation>}`; 404 `not_found` |
| `GET /api/citations/{figure}/{date}` | 200 `{"citation":{"figure","date","provisional":bool},"computation":<Computation>}`; 404 `not_found` per the citation rule in Business rules |
| `GET /api/exhibits/{sha256}` | as Exhibit downloads below |

`GET /api/board` body:

```json
{
  "server_time": "<iso>",
  "market_date": "YYYY-MM-DD",
  "vault": "available | unavailable",
  "clocks": {
    "equity": {"status": "open | closed", "closes_at": "<iso> | null",
               "last_trade": {"id": "<tick id>", "price": "14.81", "at": "<iso>"},
               "official_close": {"date": "YYYY-MM-DD", "price": "14.77"}},
    "eth": {"status": "live | stale", "last_tick": {"id": "<tick id>", "price": "3418.27", "at": "<iso>"}},
    "holdings": {"week_ending": "YYYY-MM-DD", "as_of": "<iso>", "restatement_id": "<id>"}
  },
  "figures": ["<Computation> x4, in tile order"],
  "history": ["<HistoryRow>, newest week first, superseded rows directly below their superseding row"]
}
```

Field rules:

- `market_date` is the market clock's New York date.
- `closes_at` is today's close instant while the session is open, otherwise null.
- `last_trade` is null when there has been no VLCH tick in today's session, or when the session is closed.
- `official_close` is the most recent official close at or before now.
- `last_tick` is null when no ETH tick exists.

`<Computation>`:

```json
{"id": "<id>", "figure": "eth-held | staking-rewards | eth-per-1000-diluted | mnav",
 "label": "<figure label>", "value": "<18-decimal string>", "display": "<display string>",
 "as_of": "<iso>", "computed_at": "<iso>", "restatement_id": "<id>",
 "restated": null,
 "inputs": [{"key": "<input key>", "label": "<input label>", "clock": "equity | eth | holdings",
             "value": "<exact string>", "display": "<display string>", "as_of": "<iso>",
             "sets_as_of": true,
             "source": {"kind": "exhibit", "restatement_id": "<id>", "accession": "<accession>",
                        "sha256": "<sha256>", "page": 1, "row": "<row label>"}}]}
```

There are two other source kinds:

- `{"kind":"tick","id":"<tick id>","at":"<iso>"}`, for the ETH price and for a last-trade share price.
- `{"kind":"official_close","date":"YYYY-MM-DD"}`, for an official-close share price.

When a computation is restated, `restated` is `{"on":"YYYY-MM-DD","reason":"<reason>","superseded_by":"<restatement id>","superseding_computation_id":"<id>"}`. It names the direct superseder.

`<HistoryRow>`: `{"restatement_id","week_ending","state":"published|superseded","beginning_balance","eth_acquired","staking_rewards","ending_balance","cumulative_staking_rewards","diluted_shares","eth_per_1000_diluted":{"computation_id","value","display"},"exhibit":{"accession","sha256","page"},"published_at","restated":null|{"on","reason","superseded_by"}}`.

**Exhibit downloads.** `GET /api/exhibits/{sha256}` behaves as follows.

- **A hash the caller may not see.** This is decided under Exhibit access in Business rules. The answer is 404 `not_found`, and any `If-None-Match` or `Range` header is ignored. The status, body and headers are identical to those for a hash that was never uploaded. There is no `X-Exhibit-SHA256` and no `Content-Disposition`, and the body has the same length.
- **A hash the caller may see.**
  - Every answer carries `ETag: "<sha256>"`, `Accept-Ranges: bytes` and `X-Content-Type-Options: nosniff`.
  - `Cache-Control` is `public, max-age=31536000, immutable` when a `published` or `superseded` restatement cites the exhibit. Otherwise it is `private, no-store`.
  - Without a `Range` header, the answer is 200 with the stored bytes, `Content-Type: application/pdf`, `X-Exhibit-SHA256: <sha256>` and `Content-Disposition: attachment; filename="<accession>.pdf"`.
  - `If-None-Match` equal to the ETag (or `*`) is answered 304 with no body. This is decided from the database alone, so it is answered even while the vault is unreachable.
  - A single range `bytes=<a>-<b>`, `bytes=<a>-` or `bytes=-<n>` that overlaps the body is 206. It carries exactly those bytes and `Content-Range: bytes <first>-<last>/<size>`. A last position beyond the end is cut to the final byte.
  - A single range that does not overlap the body is 416 `range_not_satisfiable` with `Content-Range: bytes */<size>`. That is a range starting at or beyond the size, or a suffix of zero bytes. This is decided from the stored size, without the vault.
  - A `Range` header naming several ranges, or one that cannot be parsed, is ignored, and the answer is the full 200.
  - Any answer that must send bytes is 503 `vault_unavailable` while the vault is unreachable.

**Restatements (staff; cookie required).** `<Restatement>`:

```json
{"id": "<id>", "version": 1, "week_ending": "YYYY-MM-DD", "state": "draft | in_review | returned | cleared | queued | published | superseded",
 "supersedes": null, "correction_reason": null,
 "rows": {"beginning-balance": "...", "eth-acquired": "...", "staking-rewards": "...", "ending-balance": "...",
          "cumulative-staking-rewards": "...", "diluted-shares": "150150000"},
 "share_events": [{"id": "<id>", "kind": "atm_settlement | warrant_exercise | buyback", "shares": "1200000", "effective_date": "YYYY-MM-DD"}],
 "accession": "0002093117-26-000052", "exhibit_page": 1,
 "exhibit": null,
 "prepared_by": {"id", "name"}, "cleared_by": null, "released_by": null,
 "return_note": null, "release_at": null, "published_at": null, "superseded_by": null,
 "created_at": "<iso>", "updated_at": "<iso>"}
```

- `version` follows the version rule in Business rules.
- `exhibit` is null or `{"status":"verified|rejected","sha256","bytes","key"}`. In it:
  - `sha256` is the hash the browser claimed;
  - `bytes` is the body length;
  - `key` is the `exhibits/` object key once verified, otherwise null.

| Method and path | Request | Success | Extra errors |
|---|---|---|---|
| `GET /api/restatements` | | 200 `{"restatements":[<Restatement>]}`, newest week first | |
| `GET /api/restatements/{id}` | | 200 `{"restatement":<Restatement>}` | |
| `GET /api/restatements/{id}/audit` | | 200 `{"entries":[<AuditEntry>]}` in version order | |
| `POST /api/restatements` | for a weekly draft, `{}` or any of `week_ending`, `rows`, `share_events`, `accession`, `exhibit_page`; for a correction, `{"supersedes":"<id>"}` plus any of `correction_reason`, `rows`, `share_events`, `accession`, `exhibit_page`. These are the only accepted members. Every member except `supersedes` is optional at create, and a member that is present is validated as Draft validation states | 201 `{"restatement":<Restatement>}` in state `draft` | 403 `forbidden`; 409 `week_out_of_sequence`, `week_not_ended`, `not_latest_week`, `restatement_open`; 422 |
| `PATCH /api/restatements/{id}` | `{"version":<integer>}` plus any of `rows`, `share_events`, `accession`, `exhibit_page`, `correction_reason`, each replacing the stored value. These are the only accepted members | 200 `{"restatement":<Restatement>}` | 403 `not_preparer`; 409 `invalid_transition`, `version_conflict`; 422 (also `version` when missing or not a positive integer) |
| `PUT /api/restatements/{id}/exhibit` | raw PDF body, `Content-Type: application/pdf`, header `X-Exhibit-SHA256: <sha256>`; carries no version | 201 `{"restatement":<Restatement>}` with exhibit `verified` | 403 `not_preparer`; 409 `invalid_transition`; 422 fields `file` (as Filing-safe exhibits states), `accession` (the restatement has no saved accession, as Exhibits in Business rules states) or `sha256` (missing or malformed header, or hash mismatch); 503 `vault_unavailable` |
| `POST /api/restatements/{id}/submit` | `{}` | 200, state `in_review` | 403 `not_preparer`; 409 `exhibit_not_verified`, `invalid_transition`; 422 naming every missing or failing field of the whole draft |
| `POST /api/restatements/{id}/return` | `{"note"}` | 200, state `returned` | 403 `forbidden`, `preparer_cannot_clear`; 409 `invalid_transition`; 422 `note` |
| `POST /api/restatements/{id}/clear` | `{"checked":[six row keys],"version":<integer>}` | 200, state `cleared` | 403 `forbidden`, `preparer_cannot_clear`; 409 `invalid_transition`, `version_conflict`; 422 `checked`, `version` |
| `POST /api/restatements/{id}/release` | `{"confirm":true}`, optional header `Idempotency-Key` (1 to 100 visible ASCII characters) | 202 `{"outcome":"queued","restatement":<Restatement>}` with `release_at`, or 200 `{"outcome":"published","restatement":<Restatement>}` with `published_at` | 403 `forbidden`, `preparer_cannot_release`, `clearer_cannot_release`; 409 `invalid_transition`, `idempotency_conflict`; 422 `confirm` |
| `POST /api/restatements/{id}/withdraw` | `{"version":<integer>,"note":"<text>"}` | 200 `{"restatement":<Restatement>}` in state `cleared`, with `release_at` and `released_by` null | 403 `forbidden`, `preparer_cannot_release`; 409 `invalid_transition`, `version_conflict`; 422 `note`, `version` |

`<AuditEntry>`:

```json
{"version": 1, "action": "create | edit | exhibit_pending | exhibit_verified | exhibit_rejected | submit | return | clear | release_queued | publish | withdraw | supersede",
 "actor": {"id": "<id>", "name": "<name>"}, "at": "<iso>",
 "from_state": "<state> | null", "to_state": "<state>", "note": "<text> | null"}
```

**Operator.** These endpoints need a cookie with the operator role, otherwise 403 `forbidden`.

| Method and path | Request | Success |
|---|---|---|
| `GET /api/operator/tape` | | 200 `{"state":"playing\|paused","position":<step index>}` |
| `PUT /api/operator/tape` | `{"state":"playing\|paused"}` | 200 same shape; 422 for any other value |
| `PUT /api/operator/clock` | `{"at":"<iso>"}` or `{"at":null}` | 200 `{"now":"<iso>","rehearsal":bool}`; 422 for an unparsable instant |
| `GET /api/operator/tick-key` | | 200 `{"key":"<64 lowercase hex>"}` |

**Internal ticks.** `POST /api/internal/ticks`:

- **Request.** The body is `{"id":"<tick id>","instrument":"ETH-USD"|"VLCH","price":"<positive decimal, up to 8 fractional digits>"}`. A tick id is 1 to 64 characters, each an ASCII letter, a digit, an underscore or a hyphen. Any `at` in the body is ignored.
- **Signature.** The header is `X-Tick-Signature: t=<unix seconds>,v1=<hex>`. `v1` is the lowercase hex HMAC-SHA256 of the exact bytes `<t>.<raw body>`: the `t` value as sent, a full stop, then the raw request body. The HMAC key is the tick key's 64-character hex string, taken as ASCII bytes.
- **Signature checks, in this order.**
  1. A missing or malformed header, or a `v1` that does not match, is 401 `bad_signature`.
  2. A `t` more than 300 seconds before or after the server's market clock (in whole unix seconds) is 401 `stale_signature`. A difference of exactly 300 seconds is accepted. The market clock is the rehearsal clock when one is set, never the machine's real time.
- **Success.** 201 `{"tick":{"id","instrument","price","at":"<iso, server market clock at acceptance>"}}`. The tick and its mNAV computation are stored.
- **Redelivery.** When the body's `id` is well-formed and already stored, the request is decided at the replay step of the error precedence, before any session or validation check:
  - The same instrument and the same price (compared as exact decimal values) is 200 `{"tick":<the originally stored tick>}`, with its original `at`. Nothing new is stored and no computation is made. This holds even after the session has closed, for a VLCH tick.
  - Any other instrument or price is 409 `tick_id_conflict`, and nothing changes.
- **Simultaneous deliveries.** When several correctly signed requests carry the same new id at the same moment, exactly one is answered 201 and stores the tick and its one mNAV computation. Every other one is answered as a redelivery of that stored tick: 200 with the identical stored tick (same `at`) when its instrument and price equal the winner's, otherwise 409 `tick_id_conflict`. None is answered 500.
- **Other errors.**
  - A new VLCH tick outside the regular session is 409 `session_closed`.
  - A missing or malformed `id`, instrument or price is 422 with field `id`, `instrument` or `price`.

### Business rules (DP-06, DP-11 to DP-14, DP-16 to DP-22, DP-26 to DP-31, DP-35, DP-37, DP-48, DP-49, DP-50, DP-53, DP-55, DP-56, DP-59, DP-63, DP-64, DP-65, DP-67, DP-68, DP-69, DP-72, DP-75, DP-76)

**Market clock.**

- Every time rule uses the server's market clock, except Staff sessions below. By default the market clock is real time.
- After `PUT /api/operator/clock` with an instant, the clock runs forward from that instant at real speed. It keeps doing so until it is set again, or reset with `null`.
- The setting is stored, so it holds across restarts, for every request and for every app copy sharing the database.
- The browser's clock is never consulted.

**Wall times and offsets.**

- Every New York wall time becomes an instant using the America/New_York offset in force at that wall time on that date. This applies to session open, session close, week start, week end and day end.
- No instant is computed by adding fixed 24-hour or 7-day spans to another instant.

The 2026 change back to standard time happens at 02:00 on 2026-11-01. Around it:

- The 2026-10-30 session closes at `2026-10-30T16:00:00-04:00`.
- The 2026-11-02 session opens at `2026-11-02T09:30:00-05:00` and closes at `2026-11-02T16:00:00-05:00`.
- The holdings week ending 2026-11-01 runs from `2026-10-26T00:00:00-04:00` to `2026-11-01T23:59:59-05:00`, which is 169 hours. When that week is published, its exhibit inputs and the holdings clock carry `2026-11-01T23:59:59-05:00` as their as-of.
- The New York day 2026-11-02 ends at `2026-11-03T00:00:00-05:00`.

**Board cadence.** The board, a provisional citation page, an open release dialog and the operator console each fetch from the server at least every 5 seconds. Any server change they show is on screen within 5 seconds of the server reporting it.

**Session calendar.**

- The regular session runs on weekdays from 09:30:00 (inclusive) to 16:00:00 (exclusive) America/New_York.
- In 2026 the market is closed on these dates:

  | Date | Holiday |
  |---|---|
  | 2026-01-01 | New Year's Day |
  | 2026-01-19 | Martin Luther King Jr. Day |
  | 2026-02-16 | Washington's Birthday |
  | 2026-04-03 | Good Friday |
  | 2026-05-25 | Memorial Day |
  | 2026-06-19 | Juneteenth |
  | 2026-07-03 | Independence Day (observed) |
  | 2026-09-07 | Labor Day |
  | 2026-11-26 | Thanksgiving Day |
  | 2026-12-25 | Christmas Day |

- On 2026-11-27 and 2026-12-24 the session closes early at 13:00:00 (exclusive).
- The official close for a date is the last VLCH tick in that date's session. A date with no VLCH tick has no official close of its own.
- Outside the session, the share price is the most recent official close. For example, on the holiday 2026-11-26 the equity clock is closed all day. If VLCH ticks were accepted in the 2026-11-25 session, it shows the market-closed copy with the 2026-11-25 official close.

**ETH staleness.**

- The ETH clock is `stale` when there is no ETH tick, or when the market clock is more than `ETH_STALE_SECONDS` seconds past the last ETH tick.
- A gap of exactly the threshold still counts as live.
- The default threshold is 120 seconds.

**Tick tape.**

- While the tape is playing, the tape player submits the next step of the seeded tape every 5 seconds. It uses the same signed endpoint as external ticks, with `t` taken from the market clock.
- Each step is one ETH tick, plus one VLCH tick when the session is open.
- Steps are claimed through the database, so however many app copies share the database, one step is submitted per 5 seconds and each position is submitted once.
- Pausing stops the player only. Signed external ticks are still accepted.

**Staff sessions.**

- A staff session ends at once when `DELETE /api/session` is sent from any tab that shares its cookie.
- It also ends when more than `STAFF_SESSION_IDLE_SECONDS` seconds (default 1,800) pass after its last authenticated request. This is measured on real time, never on the market clock. A request exactly at the limit still counts.
- Every authenticated request restarts the idle period.
- A request carrying an ended session answers 401 `unauthenticated` and changes nothing.

**Roles.**

- `treasury_analyst` creates and edits drafts, uploads exhibits and submits.
- `disclosure_counsel` returns and clears.
- `disclosure_officer` releases and withdraws.
- `operator` uses the operator endpoints.
- A user may hold several roles.

The two-person rule applies to people, not roles. The preparer is whoever created the restatement.

- The preparer cannot return or clear it: 403 `preparer_cannot_clear`.
- The preparer cannot release or withdraw it: 403 `preparer_cannot_release`.
- The person who cleared it cannot release it: 403 `clearer_cannot_release`. That person may withdraw it if they hold the officer role.
- When several 403 checks apply, they are checked in this order: role first (403 `forbidden`), then preparer, then clearer.
- Only the preparer may edit, upload or submit (403 `not_preparer`, checked after role).

**State machine.**

| From | Action | To | Who |
|---|---|---|---|
| (none) | create | `draft` | treasury analyst |
| `draft`, `returned` | edit, upload exhibit | unchanged | preparer |
| `draft`, `returned` | submit (needs exhibit `verified`, otherwise 409 `exhibit_not_verified`) | `in_review` | preparer |
| `in_review` | return with note | `returned` | counsel who is not the preparer |
| `in_review` | clear (at the current version) | `cleared` | counsel who is not the preparer |
| `cleared` | release inside the session | `queued` | officer who neither prepared nor cleared it |
| `cleared` | release outside the session | `published` | same |
| `queued` | withdraw (at the current version, before `release_at`) | `cleared` | officer who did not prepare it |
| `queued` | its session close is processed | `published` | server |
| `published` | a correction of it publishes | `superseded` | server |

- Every other action on an existing restatement is 409 `invalid_transition` and changes nothing. That includes edit, upload, submit, return, clear, release or withdraw from any state not listed for that action.
- When requests race, the first committed transition wins and the others get 409 `invalid_transition`. Of N simultaneous releases of one cleared restatement, exactly one succeeds.

**Restatement versions.**

- Every restatement has an integer `version`. It is 1 at create and rises by exactly 1 on every stored change to the restatement. The stored changes are:
  - an edit
  - the exhibit pending step
  - the exhibit becoming `verified` or `rejected`
  - submit, return or clear
  - a release that queues
  - a withdraw
  - a publication
  - being marked superseded
- A release outside the session takes a restatement from `cleared` to `published` in one stored change, raising the version by exactly 1. The `version` in the 200 response, and in every later read, is that value.
- A release inside the session raises the version by 1 when it becomes `queued`. Its later publication at the session close raises it by 1 more.
- When a correction publishes, the correction's version rises by 1 for its own publication. The superseded restatement's version rises by 1 for being marked `superseded`.
- Nothing else changes a version.
- A successful exhibit upload therefore raises the version by 2 (pending, then verified), and so does a rejected one (pending, then rejected). For example, after a save that returns version n, a successful upload returns version n+2, and a later save sent with n is refused.
- An edit (PATCH), a clear and a withdraw must carry the restatement's current version. Any other value is 409 `version_conflict` and changes nothing.
- Inside the 409 step of the error precedence, `invalid_transition` is checked first, then `version_conflict`.
- The version comparison and the change happen as one indivisible step. Of N simultaneous edits, clears or withdraws sent with the same version, exactly one succeeds, and the others get 409 `version_conflict` or `invalid_transition`.
- `updated_at` changes exactly when `version` does.

**Audit trail.**

- Every stored change to a restatement writes exactly one audit entry in the same transaction. The entry's `version` equals the restatement's new version, so a restatement at version v has entries numbered 1 to v, with no gaps or repeats.
- Each entry records:
  - `action`: create, edit, exhibit_pending, exhibit_verified, exhibit_rejected, submit, return, clear, release_queued, publish, withdraw or supersede;
  - `actor`;
  - `at`, the market-clock instant of the change, taken when the change commits;
  - `from_state` and `to_state` (`from_state` is null on create);
  - `note`.
- `actor` is the signed-in person who made the request. The uploader is the actor of both exhibit entries. An officer's out-of-session release is a `publish` entry with that officer as actor.
- `actor` is null for the server's own steps:
  - a publication at a session close;
  - a `supersede`.
- `note` carries the return note, the withdraw note, or, on `supersede`, the superseding correction's reason. On every other entry it is null.
- When a correction publishes, its `publish` entry and the superseded restatement's `supersede` entry are written in one transaction with the same `at`.
- A publication at a session close carries the close instant as its `at`.
- These write no entry:
  - refused requests: any 4xx, a 503, or a 500;
  - an idempotent release replay.

  The one 4xx that stores changes is the hash-mismatch 422, which writes its two exhibit entries.
- Audit entries are append-only, and the database itself rejects any update or delete of an entry. No endpoint edits them.
- Any signed-in staff member may read any restatement's audit trail.

**Opening a draft.**

- At most one restatement may be open at a time (`draft`, `in_review`, `returned`, `cleared` or `queued`). Otherwise the answer is 409 `restatement_open`.
- A weekly draft's `week_ending` must be the next calendar Sunday after the latest published week's Sunday, otherwise 409 `week_out_of_sequence`. That week must also have ended on the market clock, otherwise 409 `week_not_ended`.
- A correction's `supersedes` must name the latest published week's current restatement (the one in state `published`, which may itself be a correction), otherwise 409 `not_latest_week`. The correction takes that restatement's week ending.
- On create, inside the 409 step of the error precedence, the sequence conflicts (`week_out_of_sequence`, `week_not_ended`, `not_latest_week`) are checked first, then `restatement_open`.
- The database itself guarantees "at most one open restatement" and "at most one current published restatement per week". It never relies on a read followed by a separate insert or update.
  - So of N simultaneous creates, exactly one is 201 and stores exactly one row. This holds for any mix of weekly drafts and corrections of the latest published restatement, from any analysts. Every other create is 409 `restatement_open`, and none is 500.
  - A correction create naming a restatement that is superseded at the same instant (because its correction publishes concurrently) is 409 `not_latest_week`, never a second draft.
- The holdings week runs from Monday 00:00:00 to Sunday 23:59:59 America/New_York. Whenever a week is published, its exhibit inputs carry that Sunday 23:59:59 as their as-of.
- Create checks only the sequence rules above and the members it carries.
  - A weekly create without `week_ending` takes the next Sunday after the latest published week. If `week_ending` is present it must equal that Sunday, otherwise 409 `week_out_of_sequence`.
  - Rows, events, accession, exhibit page and correction reason that are not supplied are stored empty: rows and exhibit page as null, the event list as empty.
- A correction create takes its week ending from the superseded restatement. Its correction reason is entered later in the editor and saved with `Save draft`.
- Arithmetic checks that involve a row not yet entered are skipped on create and save. They run in full on submit.

**Draft validation.**

- Create and save (PATCH) validate every member they carry.
- Submit validates the whole draft. It treats as failing a missing row, event field, accession, exhibit page or (on a correction) correction reason.
- A failing draft is answered 422 with every failing field named, and nothing is stored. Each failing field appears once in `fields`, under its key:
  - `rows.<row key>` for a row, for example `rows.ending-balance`;
  - `share_events.<index>.<attribute>` for a share event, with a zero-based index in request order, for example `share_events.0.shares`;
  - the request member's name for everything else, for example `week_ending`, `supersedes`, `accession`, `exhibit_page`, `correction_reason`, `note`, `checked`, `confirm`, `version`, `file` or `sha256`.
- The editor's error summary links each key to its field.

**Only editable members.** Create and save accept only the members their API rows list.

- Any other top-level member is a failing field, keyed by its own name, with the message `This field cannot be changed here.`. Examples:
  - `state`, `prepared_by`, `cleared_by`, `released_by`, `exhibit`, `published_at`, `release_at`, `superseded_by`, `id`, `created_at`, `updated_at`;
  - `version` on create;
  - `week_ending` or `supersedes` on save;
  - `week_ending` on a correction create;
  - `correction_reason` on a weekly create.
- Any key inside `rows` other than the six row keys fails as `rows.<key>` with the same message.
- Any share-event attribute other than `kind`, `shares` and `effective_date` fails as `share_events.<index>.<attribute>` with the same message. The one exception is `id` on a share event, which is accepted and ignored.
- These fields are reported in the same 422 as every other failing field of the request. For example, a save carrying `"state":"cleared"` and an ending balance that does not reconcile names both `state` and `rows.ending-balance`.
- A refused create stores no restatement. A refused save leaves the restatement byte-identical, including `version` and `updated_at`. Unknown members are never silently dropped.

The six rows, their keys and their row labels:

| Row key | Row label |
|---|---|
| `beginning-balance` | Beginning ETH balance |
| `eth-acquired` | ETH acquired |
| `staking-rewards` | Staking rewards |
| `ending-balance` | Ending ETH balance |
| `cumulative-staking-rewards` | Cumulative staking rewards |
| `diluted-shares` | Assumed diluted shares |

Validation rules:

- ETH rows are non-negative decimals with at most 18 fractional digits. `diluted-shares` is a positive integer.
- Rows are stored exactly as typed, trailing zeros included. They are compared by exact decimal value to all 18 fractional digits, never through a floating-point number.
- `beginning-balance` equals the ending balance of the prior week's current restatement. For a correction, the prior week is the week before the superseded one.
- `ending-balance` equals beginning + acquired + staking rewards. For example, after the week ending 2026-11-01 from Journey 3 is published, take a week ending 2026-11-08 with beginning `440744`, acquired `0.100000000000000001` and staking rewards `0.2`. It passes with ending `440744.300000000000000001`. It fails with ending `440744.3`, which names `rows.ending-balance` and no other row.
- `cumulative-staking-rewards` equals the prior week's cumulative + this week's staking rewards.
- `diluted-shares` equals the diluted share count in effect on the week-ending date. That count includes all of this draft's events and, for a correction, leaves out the superseded restatement's events. For example, with the seed data at start, a week ending 2026-11-01 carrying ATM settlement +9,850,000, warrant exercise +150,000 and buyback −200,000 requires `159950000`.
- Each share event has:
  - a kind: `atm_settlement` or `warrant_exercise` (adds shares), or `buyback` (removes shares);
  - a positive integer `shares`;
  - an `effective_date` from the Monday to the Sunday of the draft's week.
- The share count must stay above zero after every event. The draft's events are applied to the count in effect before the week, in effective-date order (ties in request order). The first event that takes the running count to zero or below fails at `share_events.<index>.shares`.
- `accession` is ten digits, a dash, two digits, a dash and six digits, for example `0002093117-26-000052`.
- `exhibit_page` is an integer from 1 to 500 inclusive.
- `correction_reason` is required on corrections and is 10 to 500 characters.
- `note` on return is 10 to 1,000 characters. `note` on withdraw is 10 to 500 characters.
- `checked` on clear contains each of the six row keys exactly once.
- `confirm` on release is `true`.
- `version` on edit, clear and withdraw is a positive integer.

A PATCH that changes `accession` detaches the exhibit, so `exhibit` becomes null.

**Share-count ledger.**

- The diluted share count in effect on date D is the opening count in Seed data, plus the signed shares of every event that has an effective date on or before D and belongs to a restatement currently `published`.
- Events of drafts, cleared, queued and superseded restatements do not count.
- Every computation uses the count in effect on its own week-ending date. A later event never changes a stored computation, even if it was recorded earlier in real time.
- A correction whose events differ from the week it supersedes changes the ledger only from its own publication. Citations for dates before that publication keep their old count.

**Filing-safe exhibits.** These checks are decided from the request body alone, before the vault is contacted:

- **Complete PDF.** The body must begin with `%PDF-`, and `%%EOF` must appear within its last 1,024 bytes. Otherwise the answer is 422 with field `file` and message `The exhibit is not a complete PDF.`.
- **No forbidden names.** The body must contain none of the PDF names `/JavaScript`, `/JS`, `/Launch`, `/EmbeddedFile`, `/Encrypt`, `/URI` and `/SubmitForm`, anywhere in its bytes. Otherwise the answer is 422 with field `file` and message `The exhibit contains active content, links, embedded files or encryption.`.

How a name is matched:

- A name is a `/`, followed by every byte up to the next whitespace byte or PDF delimiter (`(`, `)`, `<`, `>`, `[`, `]`, `{`, `}`, `/`, `%`).
- Each `#xx` hex escape is decoded before comparing, so `/J#61vaScript` counts as `/JavaScript`.
- Only whole names match, so `/JSON` and `/URIs` pass.

A refusal stores nothing. It writes nothing under `incoming/`, writes no audit entry, and leaves the restatement byte-identical. Because the vault is never contacted, these refusals answer 422 even while the vault is unreachable.

**Exhibits.** An upload first passes the body and header checks and the filing-safe checks. The restatement must also already hold a saved accession, because the published key is built from it. Without one the answer is 422 with field `accession` and message `Save the accession number before attaching an exhibit.`. It is decided from the database and the request body alone, before the vault is contacted, so nothing is staged, the restatement is byte-identical, no audit entry is written, and the answer is 422 even while the vault is unreachable. When the body also fails the filing-safe checks, `file` and `accession` are reported together in the same 422. Then:

1. The server stages the body in the vault, as described in Services.
2. The server reads the staged object back and hashes it.
3. If that SHA-256 equals `X-Exhibit-SHA256`, the object is copied to its published key and the exhibit becomes `verified`. If the published key already exists, the existing object is attached as it is.
4. On a mismatch, the exhibit becomes `rejected` and the response is 422 `sha256`.
5. The pending step and the final step (verified or rejected) are stored together only after the vault has answered every step of the upload. Each step raises the version by one and writes its audit entry.

If the vault cannot be reached at any step:

- The answer is the 503 outage body.
- Nothing about the restatement is stored: its `exhibit`, `version` and `updated_at` stay exactly as before.
- A later read of the restatement is byte-identical to the read before the request.

A rejected exhibit blocks submission.

**Simultaneous uploads.** Several uploads to one restatement at the same moment (a double drop, or the same draft open in two editor tabs) are serialised by the database:

- Each upload stores its pending and final steps in one transaction that locks the restatement row and takes the version current at that moment, never the version read when the request arrived. Its two steps get two consecutive versions and two consecutive audit entries, and the steps of different uploads never interleave.
- Uploads carry no version and are never refused for one. Every upload that passes the checks while the vault is reachable is answered 201, or 422 `sha256` on a mismatch. None is answered 409 or 500 because another upload raced it.
- After N completed uploads from version v, the restatement is at exactly v + 2N, its audit trail runs v+1 to v+2N in pending-then-final pairs, and its `exhibit` is the one whose final step committed last, which is the response carrying the highest `version`.

**Exhibit access.** Whether `GET /api/exhibits/{sha256}` may serve a hash is decided from the database alone, before and without contacting the vault.

- Anyone may download a hash that is the verified exhibit of a restatement in state `published` or `superseded`.
- A signed-in staff member may also download a hash that is the verified exhibit of any other restatement (`draft`, `in_review`, `returned`, `cleared` or `queued`), so counsel can check it.
- Every other request is answered as Exhibit downloads in API describes for a hash the caller may not see. That covers:
  - without a staff session, a hash cited only by a `draft`, `in_review`, `returned`, `cleared` or `queued` restatement;
  - for everyone, the hash (claimed or actual) of a rejected or in-flight upload;
  - for everyone, the hash of any `incoming/` object;
  - for everyone, a hash never uploaded.
- Because the decision never needs the vault, a hash the caller may not see is 404 even while the vault is unreachable.
- A queued restatement's exhibit becomes publicly downloadable once the restatement publishes, within 5 seconds of its session close being processed. A withdrawn restatement's exhibit stays unavailable to the public.

**Release timing.**

- A release accepted at market-clock instant t, inside the session of date D, becomes `queued`. Its `release_at` is D's session close instant: 16:00:00, or 13:00:00 on the two early-close dates.
- A release at any other instant publishes at t. That includes a release at exactly the close, and a release inside a session whose close has already been processed (possible only after a backward clock jump).
- For example:
  - a release at 2026-11-02 15:05:00 ET is queued with `release_at` `2026-11-02T16:00:00-05:00`;
  - a release at 2026-11-27 12:59:59 ET is queued to `2026-11-27T13:00:00-05:00`;
  - a release at 2026-11-27 13:00:00 ET publishes at once.
- Until a queued restatement publishes, the public surfaces do not show it.
- The release dialog's timing preview comes only from the equity status and `closes_at` that `GET /api/board` reports, so it states this same rule as the server sees it.

**Withdrawing a queued release.**

- A withdraw succeeds only when the restatement is `queued` and the market-clock instant of the withdraw is strictly before its `release_at`.
- The withdraw is decided inside the database transaction that locks the restatement. A withdraw and the close processing for the same restatement therefore never both succeed.
- At or after `release_at`, a withdraw is 409 `invalid_transition` and changes nothing, even if the server has not yet processed that close. The restatement then publishes at that close with `published_at` equal to `release_at`, within 5 seconds and exactly once.
- A successful withdraw does all of the following:
  - returns the restatement to `cleared`;
  - sets `release_at` and `released_by` to null;
  - keeps `cleared_by` and the clear, so the restatement can be released again without a new review;
  - raises the version by 1 and writes a `withdraw` audit entry with its note.
- When the close of a withdrawn release is processed, it stores the session-close mNAV and publishes nothing.
- Of N simultaneous withdraws, exactly one succeeds. The others get 409, never 500.
- A later release with a new idempotency key queues again with a fresh `release_at`.

**Session-close processing.**

- Each trading day's session close is processed exactly once.
- Whenever the market clock is at or past one or more unprocessed closes, the server processes all of them in date order within 5 seconds. This holds however the clock got there: by real time passing, by a forward rehearsal jump, or at start. It also holds however many requests, timers or app copies sharing the database see the clock pass the close at the same moment.
- For each close, the server:
  1. Stores the session-close mNAV at the close instant. None is stored before the first published week.
  2. Publishes any restatement still queued to that close, with `published_at` equal to its `release_at`.
- Setting the clock backward never re-processes a close, and moving forward again past a processed close stores nothing new.

**Idempotent release.**

- A successful release response (202 or 200) is stored against the user and its `Idempotency-Key` for at least 24 hours.
- A repeat with the same user, key and restatement returns the identical status and body, even after the restatement's state has moved on, including after a withdraw. It never queues or publishes again.
- Error responses are not stored.
- The same key sent with a different restatement is 409 `idempotency_conflict`.

**Publication and supersession.** Publishing a restatement does all of this in one transaction:

1. Applies the restatement's share events to the ledger.
2. For a correction, marks the superseded restatement `superseded` and sets its `superseded_by` to this correction.
3. Stores new computations for all four figures.
4. Writes the publication's audit entries.

Every computation whose exhibit inputs came from the superseded restatement becomes restated:

- `on` is the correction's publication date.
- `reason` is the correction reason.
- `superseded_by` is the correction.
- The superseding computation is the same figure's computation stored at that publication.

Corrections form a chain. When a correction is itself corrected, its own row and computations link to the newer correction. The older rows and computations keep the links they already had. Every superseded row and computation names its direct superseder, never a later one.

Nothing is deleted or overwritten. Setting `restated` on a superseded computation is the only change ever made to a stored computation, and it is made once.

In the weekly history, a chain is listed newest first, directly under the current row: the published row, then the restatement it superseded, then the one that one superseded.

**Figures and inputs (in input order).**

- `eth-held`, "Total ETH held" = `beginning-balance` + `eth-acquired` + `staking-rewards`. All three inputs are filed, on the holdings clock.
- `staking-rewards`, "Cumulative staking rewards" = `cumulative-staking-rewards`. One filed input.
- `eth-per-1000-diluted`, "ETH per 1,000 diluted shares" = `ending-balance` ÷ `diluted-shares` × 1,000. Both inputs are filed.
- `mnav`, "mNAV" = (`share-price` × `diluted-shares`) ÷ (`ending-balance` × `eth-price`). Its inputs, in input order, are `ending-balance`, `diluted-shares`, `share-price`, `eth-price`.
  - `share-price` is on the equity clock.
    - During the session, it is the latest VLCH tick of the day, or the most recent official close if there has been no VLCH tick yet that day.
    - Outside the session, it is the most recent official close.
    - A session-close computation uses that date's own official close when the date has a VLCH tick, and otherwise the most recent earlier one.
    - As a last trade, `share-price` has source kind `tick`, with its tick time as its as-of.
    - As an official close, it has source kind `official_close`, with that close date's session close instant as its as-of.
  - `eth-price` ("ETH price") is on the ETH clock and is the latest ETH tick.

Input labels match the row labels in Draft validation, plus the share-price labels in Feedback states and "ETH price".

**Clock badges.**

- An input's badge names its clock: `Holdings week` for the holdings clock, `Equity` for the equity clock, and `ETH live` for the ETH clock.
- A tile's badge is the badge of its computation's as-of-setting input.
- Total ETH held, Cumulative staking rewards and ETH per 1,000 diluted shares therefore always show `Holdings week`.
- mNAV shows the badge of whichever of its inputs sets its as-of. For example, with the seed data at start that badge is `Holdings week`.

**Computation.**

- Each figure is computed with exact integer and decimal arithmetic, never floating point.
- The stored `value` always has exactly 18 fractional digits, trailing zeros included. An exact result keeps its zeros, for example `2.754650000000000000`. A result with more digits is rounded half away from zero at the 18th digit, and only there.
- Computations are stored at these moments:
  - at each publication: all four figures;
  - on every newly accepted ETH or VLCH tick, never on a redelivery: mNAV;
  - at each processed session close: mNAV.
- No mNAV is stored before a week has been published.
- A tick computation's `computed_at` is the tick's `at`.
- A session-close computation's `computed_at` is the close instant.
- A publication's four computations carry the restatement's `published_at`. For a queued release, that is its `release_at`, not the moment the server acted.
- When a queued release publishes at a session close, the session-close mNAV is stored first and the publication's four computations after it. Both share the close instant, and the publication's mNAV is current.
- A figure's current computation is the one with the latest `computed_at`, with ties broken by later storage order.
- Every public surface reads stored computations and never recomputes them.

**As-of.**

- An input's as-of is:
  - for an exhibit input, the Sunday 23:59:59 week end;
  - for a tick, the tick time;
  - for an official close, the session close instant of that date.
- A computation's `as_of` is the oldest input as-of.
- `sets_as_of` is true on the first input, in input order, that has that oldest as-of, and false on all others.

**Display rounding.**

- Round half away from zero from the stored 18-digit value. Never round from another rounded value, and never round through a binary floating-point number.
- A stored value exactly halfway between two display values shows the one farther from zero. Rounding a tie to the even digit is wrong.
- Every `display` string, tile numeral, history cell, chip, input button and citation uses the formats below.
- The whole-number part has comma thousands separators, and there are no spaces other than those shown.

Formats:

- **ETH amounts** (Total ETH held, Cumulative staking rewards, and every ETH row and input): three decimals and the suffix ` ETH`, for example `413,602.688 ETH`.
- **ETH per 1,000 diluted shares:** four decimals and no suffix. For example, with the seed data at start it shows `2.7546` (413,602.6875 ETH ÷ 150,150,000 × 1,000 = 2.75459665…). A value of 1,234.56789 would show `1,234.5679`.
- **mNAV:** three decimals immediately followed by `×`, with no space. For example, a stored 1.569702… shows `1.570×`, and a stored `1.569500000000000000` also shows `1.570×`.
- **USD:** `$` then two decimals, for example `$3,415.90`.
- **Share counts:** whole numbers, for example `150,150,000`.

For example, when the week ending 2026-11-01 from Journey 3 is published, ETH per 1,000 diluted shares is 440,744 ÷ 160,000,000 × 1,000 = 2.75465 exactly. It is stored as `2.754650000000000000` and shows `2.7547` on the tile, the history row, the trace and the citation, never `2.7546`. Total ETH held shows `440,744.000 ETH`.

**Citations.**

- For figure F and date D, the citation resolves to F's computation with the greatest `computed_at` strictly earlier than D+1 00:00:00 America/New_York. Ties are broken by later storage order. For example, a tick stored at `2026-11-02T20:30:00-05:00` belongs to the citation for 2026-11-02, not for 2026-11-03.
- `provisional` is true exactly while the market clock's New York date is D. While provisional, the citation resolves afresh on every read, so it follows each newly stored computation.
- From D+1 00:00:00 onward the citation is final. The computation's id, value, display, as-of, computed_at, inputs and exhibit sources then never change. The only member that may change is `restated`, which is set once if a later correction supersedes the week the computation came from. Reads between corrections are byte-identical.
- These are 404 `not_found`:
  - an unknown figure;
  - a malformed date;
  - a date after the market clock's New York date;
  - a date before F's first computation.
- The citation page URL is `/cite/<figure>/<YYYY-MM-DD>`, with an optional `?step=<input key>`.

### Services (DP-04, DP-23, DP-24, DP-46, DP-51, DP-57, DP-72)

**Postgres** holds every table:

- staff users and sessions
- restatements with their versions, share events and audit entries
- exhibit records
- the share-count ledger
- the session calendar and its processed closes
- ticks keyed by tick id
- stored computations
- idempotency records
- the tape state
- the rehearsal clock
- the tick key

Two tables are published so a read-only observer can check them:

- `restatement_audit` has the columns `restatement_id`, `version`, `action`, `actor_id` (null for the server's own steps), `at`, `from_state`, `to_state` and `note`. It holds one row per audit entry, and the database refuses every update and delete of its rows.
- `computations` has the columns `id`, `figure`, `computed_at` and `restatement_id`. It holds one row per stored computation, and a stored row is never deleted.

The app applies its schema and seed idempotently on every start, as Seed data describes.

**MinIO (the filing vault)** uses the bucket named by `S3_BUCKET`.

- **Staging.** Every exhibit upload that passes the filing-safe checks is first written to `incoming/<restatement id>/<upload id>.pdf`. Each upload gets a new `<upload id>`, so simultaneous uploads each leave their own staged object.
- **Publishing.** Only verified bytes are copied to `exhibits/<accession>/<sha256>.pdf`, with `Content-Type: application/pdf`. That copy is a create-only write (`If-None-Match: *`), so the key is written at most once even when several uploads carry identical bytes at the same moment. A refusal because the object already exists (412 Precondition Failed, or the 304 some MinIO builds return instead) means the existing object is attached unchanged.
- **Contents.** Each object holds exactly the uploaded bytes, never re-encoded, stamped or normalised. Every object under `exhibits/` hashes to the SHA-256 in its own key.
- **After a mismatch,** the only new object is the one under `incoming/`. Nothing new appears under `exhibits/`.
- **After a filing-safe refusal,** no object is written anywhere.
- **No rewrites.** An existing `exhibits/` key is never written again. For example, when a correction uploads byte-identical bytes under the same accession, a new `incoming/` object is written and the existing `exhibits/` object is attached, with its ETag and last-modified time unchanged.
- **No deletes.** No object, staged or published, is ever overwritten or deleted.
- **Bucket.** Whenever the vault is reachable and the bucket does not exist, the app creates it as a private bucket before writing.
- **Seeded exhibits** are written under `exhibits/` on start if they are missing. If the vault is down at start, they are written within 10 seconds of the vault becoming reachable.

**Vault outage.** The server probes the vault in the background at least every 5 seconds, and also on every vault operation. It reports the latest probe result as `vault` in the board API, without needing a vault operation of its own.

- While the vault is unreachable:
  - `GET /api/board`, computations and citations still answer 200, and the board shows the vault notice.
  - `GET /api/exhibits/{sha256}` answers as Exhibit downloads and Exhibit access state: 404 for hashes the caller may not see, 304 on a matching `If-None-Match`, and the 503 outage body for anything that must send bytes. A trace's `Open exhibit` then shows the exhibit-download copy from Feedback states.
  - `PUT /api/restatements/{id}/exhibit` answers 422 for a body that fails the filing-safe checks. Otherwise it answers the 503 outage body and changes nothing, as Exhibits in Business rules states.
- Within 10 seconds of the vault becoming reachable again, `vault` returns to `available`, the notice clears, and downloads and uploads work, with no restart.

### Seed data (DP-05, DP-09, DP-16, DP-19, DP-22, DP-58)

Every person, company, filing, accession number, ticker and amount below is invented.

**Staff** (password `tracewell-rehearsal-26` for each):

| Name | Email | Roles |
|---|---|---|
| Tamsin Okafor | `tamsin.okafor@vellichor.example` | treasury_analyst |
| Imre Castellanos | `imre.castellanos@vellichor.example` | treasury_analyst, disclosure_counsel, disclosure_officer |
| Rafe Lindqvist | `rafe.lindqvist@vellichor.example` | disclosure_counsel |
| Wren Adeyemi | `wren.adeyemi@vellichor.example` | disclosure_counsel, disclosure_officer |
| Noor Halvorsen | `noor.halvorsen@vellichor.example` | disclosure_officer |
| Basil Ferreira | `basil.ferreira@vellichor.example` | operator |

**Opening diluted share count:** 148,250,000.

**Restatements.** All were prepared by Tamsin Okafor, cleared by Rafe Lindqvist and released by Noor Halvorsen outside the session, so each published at once (`release_at` null). Amounts are in ETH.

| Week ending | Accession | Page | Beginning | Acquired | Staking rewards | Ending | Cumulative rewards | Diluted shares | Share events | Published at (ET) | State | Version |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 2026-10-11 | 0002093117-26-000041 | 1 | 401,250 | 6,120.5 | 412.375 | 407,782.875 | 10,256.625 | 148,250,000 | none | 2026-10-12 17:30:05 | published | 7 |
| 2026-10-18 | 0002093117-26-000044 | 1 | 407,782.875 | 4,980.25 | 408.0625 | 413,171.1875 | 10,664.6875 | 150,650,000 | ATM settlement +2,400,000 effective 2026-10-14 | 2026-10-19 17:30:05 | superseded | 8 |
| 2026-10-18 (correction) | 0002093117-26-000046 | 1 | 407,782.875 | 4,980.25 | 418.0625 | 413,181.1875 | 10,674.6875 | 150,650,000 | ATM settlement +2,400,000 effective 2026-10-14 | 2026-10-21 18:00:05 | published | 7 |
| 2026-10-25 | 0002093117-26-000049 | 1 | 413,181.1875 | 0 | 421.5 | 413,602.6875 | 11,096.1875 | 150,150,000 | Buyback −500,000 effective 2026-10-22 | 2026-10-26 17:30:05 | published | 7 |

The correction's reason is `Staking rewards understated by 10 ETH; the validator reward export omitted epochs for 2026-10-17.`

**Seeded versions.** These follow the version rule. Each seeded restatement went through seven changes:

1. create
2. save
3. exhibit pending
4. exhibit verified
5. submit
6. clear
7. an out-of-session publication

The original week ending 2026-10-18 rose to version 8 when the correction marked it superseded.

**Timestamps.** Each seeded restatement's `created_at` equals its own publication instant. Its `updated_at` is the instant of its last change: its publication, or, for the superseded week, the correction's publication.

**Seeded audit trails.** Each seeded restatement carries exactly the audit entries for those changes, all with `at` equal to its own publication instant and `note` null:

| Version | Action | Actor | From state | To state |
|---|---|---|---|---|
| 1 | create | Tamsin Okafor | null | draft |
| 2 | edit | Tamsin Okafor | draft | draft |
| 3 | exhibit_pending | Tamsin Okafor | draft | draft |
| 4 | exhibit_verified | Tamsin Okafor | draft | draft |
| 5 | submit | Tamsin Okafor | draft | in_review |
| 6 | clear | Rafe Lindqvist | in_review | cleared |
| 7 | publish | Noor Halvorsen | cleared | published |

The superseded week ending 2026-10-18 adds an eighth entry:

- version 8, action `supersede`, actor null
- `at` `2026-10-21T18:00:05-04:00`
- from `published` to `superseded`
- `note` equal to the correction's reason

**Seeded exhibits.** Each is a one-page, filing-safe PDF shipped with the app, showing that week's six-row table under the accession number. It contains none of the names the filing-safe checks refuse. Its SHA-256 is the hash of those shipped bytes.

The next week a treasury analyst can draft is the week ending 2026-11-01.

**Seeded ticks.** Each date's VLCH tick at 15:59:00 ET is that date's official close. Seeded tick ids are `seed-<date>-vlch` and `seed-<date>-eth`, for example `seed-2026-10-30-eth`.

| Date | VLCH official close (USD) | ETH tick (USD, time ET) |
|---|---|---|
| 2026-10-12 | 13.94 | 3,382.40 at 17:30:00 |
| 2026-10-19 | 14.21 | 3,401.15 at 17:30:00 |
| 2026-10-21 | 14.35 | 3,396.80 at 18:00:00 |
| 2026-10-26 | 14.62 | 3,410.05 at 17:30:00 |
| 2026-10-27 | 14.71 | none |
| 2026-10-28 | 14.58 | none |
| 2026-10-29 | 14.90 | none |
| 2026-10-30 | 14.77 | 3,415.90 at 17:00:00 |

**Replay.** On a fresh database, the server replays the seeded ticks, session closes and publications in time order. It stores computations exactly as the Business rules would have stored them at those instants:

- four computations at each seeded publication;
- one mNAV for every seeded tick later than the first publication (2026-10-12 17:30:05). So the 2026-10-12 VLCH tick at 15:59:00 and ETH tick at 17:30:00 store none;
- one session-close mNAV at every trading-day close after the first publication, starting with 2026-10-13 at 16:00:00. The 2026-10-12 close stores none, because nothing was published yet;
- then every later session close up to the market clock's current instant, as Session-close processing states.

For example, with the seed data at start:

- `GET /api/citations/mnav/2026-10-27` resolves to the 2026-10-27 session-close computation. That computation has:
  - `computed_at` `2026-10-27T16:00:00-04:00`;
  - a share-price input of source kind `official_close`, dated 2026-10-27, at 14.71;
  - the 2026-10-26 ETH tick at 3410.05;
  - 413,602.6875 ETH and 150,150,000 diluted shares;
  - `sets_as_of` on `ending-balance`, and as-of `2026-10-25T23:59:59-04:00`;
  - display `1.566×`.
- The citation for 2026-10-11 is 404 for every figure, because nothing was computed before the first publication.
- The mNAV citation for 2026-10-12 is 200. It resolves to the computation stored at that publication, with `computed_at` `2026-10-12T17:30:05-04:00`.
- The board's holdings clock reads the week ending 2026-10-25.

A start against a database that already holds the seed replays nothing and duplicates nothing. Every stored restatement, audit entry, tick and computation keeps its id and values. The only new rows are session closes and ticks that are genuinely new since the last start.

**Tape.**

- It starts `playing` at position 0.
- `position` is the index of the next step. It is stored, survives pauses and restarts, and never wraps. It grows by exactly one each time a step is submitted, whether or not the session is open.
- The step at position p submits one ETH tick with id `tape-<p>`. Its price is entry (p mod 8) of this list, counting from 0: 3418.27, 3419.05, 3417.62, 3420.88, 3421.40, 3419.96, 3418.73, 3417.15.
- Only when the session is open at that moment, the step also submits one VLCH tick with id `tape-<p>-vlch`. Its price is entry (p mod 4) of this list: 14.81, 14.84, 14.79, 14.86.
- For example, position 9 submits ETH 3419.05 as `tape-9` and, in session, VLCH 14.84 as `tape-9-vlch`.
- Every tape tick is signed with `t` from the market clock, so a rehearsal jump never makes the tape's own ticks stale.

The rehearsal clock starts unset (real time). The tick key is generated randomly on first start.

## Technical requirements

### Deployment (DP-01)

Node.js 22 and npm are available. Write the app in TypeScript.

Put `/app/run.json` at the app root. It has string fields `install`, `build` and `serve`, and `"_schema":"run-manifest-v1"`. For example:

```json
{"_schema":"run-manifest-v1","install":"npm ci","build":"npm run build","serve":"node dist/server.js"}
```

- The server binds `0.0.0.0` on port 4173, or on `APP_PUBLIC_PORT` when it is set.
- `GET /api/health` returns HTTP 200 JSON `{"status":"ok"}` once the server accepts requests, whether or not the vault is reachable.
- The grader may start more copies of the app. Some share the primary copy's database. Some have their own database and bucket. A copy may have the vault pointed at an unreachable address, a lower `ETH_STALE_SECONDS`, or a lower `STAFF_SESSION_IDLE_SECONDS`.

### Configuration and secrets (DP-02)

Read these environment variables at start:

- `DATABASE_URL`
- `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_FORCE_PATH_STYLE`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`
- `APP_PUBLIC_PORT`
- `ETH_STALE_SECONDS` (whole seconds, default 120)
- `STAFF_SESSION_IDLE_SECONDS` (whole seconds, default 1,800)

Rules:

- Never hard-code credentials and never log them.
- Never send credentials or the tick key to the browser. The one exception is the tick key, which the operator tick-key endpoint returns.
- Session signing material and the tick key are generated on first start and kept in Postgres.

### Server boundary (DP-03, DP-04, DP-46, DP-51, DP-60)

- The browser talks only to the app's own origin. Exhibits download through the app, never through vault URLs.
- **Cross-site writes.** A state-changing request (POST, PUT, PATCH or DELETE) is refused with 403 `cross_origin`, before any body, authentication or state check, and changes nothing, when any of these holds:
  - its `Origin` header names an origin whose host and port differ from the request's `Host` header;
  - its `Origin` header is the literal `null`;
  - it has no `Origin` header and carries `Sec-Fetch-Site: cross-site` or `Sec-Fetch-Site: same-site`.

  For example, a cross-site `application/x-www-form-urlencoded` POST to `/api/restatements/{id}/release` carrying Noor's cookie is 403 `cross_origin`, not 415. Other requests are judged by their other rules. That covers a request whose `Origin` matches the `Host`, and a request with no `Origin` that carries `Sec-Fetch-Site: same-origin` or `none`, or no `Sec-Fetch-Site` at all (such as signed ticks).
- The server sends no cross-origin resource-sharing headers, so no other origin is ever granted access.
- **Body size limits.** JSON bodies are limited to 65,536 bytes, and exhibit bodies to 10,000,000 bytes. A body of exactly the limit is allowed. A larger body is 413 `payload_too_large`.
- **Content types.** A JSON endpoint given another content type is 415 `unsupported_media_type`. So is an exhibit upload whose content type is not `application/pdf`.
- A JSON body that does not parse is 422 `invalid_json`.
- Exhibit content is judged by the filing-safe checks in Business rules, never by a file name or extension.
- The server never serves anything outside the built browser assets. That includes source files, source maps of server code, `run.json`, package manifests, lockfiles and environment files. Such paths answer 404.
- **Nothing leaks.** During an outage or otherwise, no response body, response header or rendered page ever contains:
  - a vault or database host or port;
  - a driver or network error code such as `ECONNREFUSED` or `ENOTFOUND`;
  - a stack frame or a server file path;
  - SQL text;
  - an environment variable name;
  - any credential.

  Every failure answers with the error shape from API and its fixed messages. An unexpected failure answers 500 `internal`.
- If the vault is unreachable at boot, the server still starts and serves everything except exhibit transfers, then recovers as Services states. Postgres must be reachable for the app to serve.

### Browser support and performance (DP-10, DP-14)

- Support current Chromium, Firefox and WebKit at 375x812, 768x1024 and 1280x800, plus touch input.
- The board shows its figures within three seconds of navigation on a local connection.
- `GET /api/board` answers within 500 milliseconds with the seed data loaded.
- A trace opens within the motion timings above, with no visible stall.

## Working rules

- IF-01: `/app/run.json` exists with string `install`, `build` and `serve` fields and `"_schema":"run-manifest-v1"`, and nothing else is needed to install, build and serve the app.
- IF-02: `/app/THIRD_PARTY_NOTICES.md` lists every shipped package (the production dependency tree from `npm ls --omit=dev --all --json`) and every bundled font, each with its licence.
- IF-03: Shipped packages (the production dependency tree from `npm ls --omit=dev --all --json`) and fonts use only the MIT, ISC, BSD-2-Clause, BSD-3-Clause, Apache-2.0, 0BSD or OFL-1.1 licences.
- IF-04: The app stores data only in the provided Postgres database and MinIO bucket, with no other datastore (no SQLite, Redis, or files used as a database).
- IF-05: The app loads no script, style or font from a third-party origin at runtime.
- IF-06: Application source, server and browser, is TypeScript; only tool configuration files may be plain JavaScript.
- IF-07: The provided service definitions and their development credentials are left unchanged.

## Engineering standards

- Code is idiomatic, strictly typed TypeScript with no `any` escapes.
- Type, function and value names use this brief's domain terms: restatement, version, audit entry, exhibit, accession, computation, input, as-of, market clock, session close, share-count event, tick, withdraw.
- Each domain rule below is decided in exactly one place in the source, and every endpoint, timer and screen calls that single decision:
  - the restatement state machine, its version check, the two-person rule and the close-wins rule for withdraws
  - which request members a create or save accepts
  - the filing-safe exhibit check
  - who may download an exhibit, and how conditional and range requests are answered
  - session open or closed, including what the release dialog previews
  - converting a New York wall time to an instant
  - ETH staleness
  - staff session expiry
  - tick signature, freshness, redelivery and exactly-once storage
  - session-close processing
  - a computation's as-of
  - display rounding
  - citation resolution
  - the cross-site request check
- ETH and USD arithmetic uses integers and exact decimals throughout. No figure, amount or ratio passes through a floating-point number before display.
- The database guarantees every exactly-once outcome: one tick per id, one processing per session close, one open restatement, one winning release, withdraw or version-checked change, consecutive versions for simultaneous uploads, and one audit entry per version. None relies on a read followed by a separate write. Audit entries are protected against update and delete by the database itself.
- One error constructor builds every error response, using the error shape in API. It never copies a caught error's text into a response, and handlers never write ad hoc error bodies.
- There is no abstraction with only one implementation, no dead, commented-out or unreachable code, and no defensive check for a state that the state machine makes impossible.
- The browser renders server-reported statuses and stored computations. It never recomputes them from its own clock or from raw inputs. An async result is applied only to the screen state and dialog session that requested it.
- There are no features, endpoints or screens beyond this brief.
