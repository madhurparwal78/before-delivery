# Halfway Hollow Twohouse

Twohouse is a private workspace for two separated parents who share one child under a parenting plan. The planning parent creates the household, enters the plan's rules once and invites the other parent by email. The server works out who has the child on every night of the year and why, and shows the year as two colour fields, one per parent. Swap requests and reimbursements of shared costs run through bounded decisions with deadlines the server keeps, and either parent can produce a year record both can trust. Postgres holds every household, plan, request, projection, job and log entry; Mailpit receives every email; MinIO stores receipts and year-record PDFs; Gotenberg renders those PDFs. Out of scope: messaging between parents, moving money (a reimbursement is only recorded as settled), more than one child or two parents per household, any other datastore, any sign-in other than the email and password described here.

## Problem and users

Separated parents run a court-ordered or mediated parenting plan from a PDF: a base rotation, odd/even-year holiday rules, school-break splits and a percentage split of the child's costs. Every year they work out by hand who has which night, argue over which rule wins when Easter falls inside spring break, and chase each other by text for receipts. The tools they can buy keep a message log and an expense list, but neither computes the plan's precedence nor explains why a night belongs to one parent. Twohouse computes the year once, on the server, and explains every night.

- **Planning parent.** Creates the household, enters and amends the plan, invites the other parent, manages share links. Uses Twohouse daily.
- **Other parent.** Joins through the emailed invite, sees the same derived calendar, answers and sends requests, downloads the same record. Uses Twohouse weekly, often on a phone before a handover, often by opening a notice email while signed out.

Both parents see everything in their household. Only the planning parent can change the plan, send the invite or manage share links.

## Journeys

1. **Set up a household.** Signed out, the planning parent starts a household, lands on the Plan editor, adopts a first plan and invites the other parent twice. The older link is dead, even on a screen already holding it open. The other parent joins from the newest email, later opens a request email signed out, signs in and lands on the page the email named. End: both parents see the same year digest.
2. **Enter the plan and check a night.** Using only the keyboard, the planning parent adds a holiday inside a school break, reorders holidays quickly, watches the preview follow the latest edit, adopts, and moves through the month grid. End: the day answer names the holiday and the break it beat on both parents' screens.
3. **Check tonight in a car park.** On a phone with a wrong clock, the other parent reads the Tonight card, scrubs the year by scrolling and taps a day. End: field colour, counters and stickers match the derived year wherever the page arrived, by scroll, reload or Back. With reduced motion, the totals and day stepper give the same answers.
4. **Ask for a swap, with make-up nights.** The planning parent opens the dialog by shortcut, is refused for bad intervals, and sends a swap with make-up nights in the next year. The other parent sees it arrive live and accepts by keyboard. End: both years change, and if both parents claimed the same weekend, exactly one was sent and the other was told plainly.
5. **A request lapses.** A sent request goes unanswered; the answerer gets one reminder, then the deadline passes on the server clock. End: both screens show it lapsed, any answer is refused, each parent gets one lapsed email.
6. **Share a cost.** A parent logs a cost in the household's currency and sees exact shares as they type, attaches a receipt and sends. The two parents disagree over the split on two screens; one edit wins. The other parent accepts, the payer marks it settled. End: ledgers, Balance and a rebuilt statement agree exactly, and the receipt downloads byte for byte.
7. **Amend the plan.** From an adopted plan, the planning parent records an amendment from a future date. End: earlier nights and sent costs keep the old version, draft costs from that date move to the new one, and a pending swap whose nights moved can no longer be accepted.
8. **Produce and share the year.** A parent asks for the year record; the screen shows pending until the PDF is rendered and its stored copy confirmed, surviving outages and restarts. The planning parent makes a read-only link for the school. End: the PDF digest matches the year as requested, the share page keeps its year in the address, and a revoked link is dead on the school's open page.

## Mandatory requirements

This is the complete list of mandatory requirements; every check traces to one of these lines and the detailed sections below.

- **DP-01 — Start a household** Anyone without a session can create a household by naming it, its ISO 4217 currency, themselves as its planning parent and the other parent, and is then signed in as the planning parent.
- **DP-02 — Sessions** Both parents sign in with email and password to an opaque bearer token; signing out ends that session at once on every process, and every private page and endpoint refuses a missing or ended session.
- **DP-03 — Shared sign-in limit** Failed sign-ins for one email are limited in a sliding window shared by every app process on the database, as qualified in Business rules.
- **DP-04 — Invite the other parent** The planning parent emails the other parent a single-use join link whose lifetime comes from the environment, and sending again kills every earlier link.
- **DP-05 — Join by invite** The other parent opens the join link, sets a password and lands on the Calendar signed in; a used, replaced or expired link shows the dead-link page, and two simultaneous joins give exactly one success.
- **DP-06 — Onboarding journey** The planning parent is refused for giving the other parent the same email in different case, lands on the Plan editor with its landing copy, adopts a first plan and invites twice; failed sign-ins split across two processes lock the email, the replaced link is refused on the join screen already holding it open, two browsers racing the newest link give one join, a signed-out request link returns to Requests while a hostile return path lands on the Calendar, and both Calendars show the same year digest.
- **DP-07 — Plan rule model** A plan version holds an exchange zone, a first exchange instant, a base rotation, a cost split, a run limit and an ordered list of holiday, school-break and vacation rules, validated as specified in The API.
- **DP-08 — Derived-day precedence** The server derives each night's parent once, by the precedence in Business rules, and reports the winning rule and the rule it beat.
- **DP-09 — Holiday and break dates** Holiday occurrences (fixed dates, nth weekdays and offsets from Western Easter) and school-break halves follow the odd/even-year rules in Business rules.
- **DP-10 — Exchange instants** Every handover carries an RFC 3339 instant at the governing wall-clock exchange time in the governing IANA zone, with DST gaps and folds resolved as Business rules state.
- **DP-11 — One derived year** The derived year is one RFC 8785 canonical JSON document per household and year with a strong ETag, and that same digest appears on the Calendar, in share links and in year records.
- **DP-12 — Rule order list** The rule order list is a keyboard-operable listbox where a rule moves only within its own kind, and each move is saved to the plan draft as a conditional write.
- **DP-13 — Month grid** The month grid follows the WAI-ARIA APG grid pattern, and the focused day's parent and reason appear in the day answer region.
- **DP-14 — Live plan preview** Editing the plan draft updates each parent's night count in place from the server's preview, with no submit and no reload, including when Plan opens.
- **DP-15 — Precedence journey** Using only the keyboard, the planning parent is refused for a fixed holiday date that does not exist every year, adds a holiday inside a school break typed in the interface's forms and read back exactly from the API, saves two quick holiday moves, and is refused when moving a rule another screen changed; after adopting, the other parent's grid and day answer name the holiday and the rule it beat.
- **DP-16 — Field swap scroll** On the Calendar, the first 1200 pixels of page scroll sweep the shown year day by day, and the pinned stage takes the field colour of the parent who has the focused night, as qualified in Motion and effects.
- **DP-17 — Night counters** Two counters show each parent's nights from 1 January through the focused day, reach the exact derived values within the time in Motion and effects, and go up or down as the scroll moves.
- **DP-18 — Override stickers** A rule sticker settles into place at the first day of each override run when the sweep reaches it, leaves when the sweep moves back before that day, and never overlaps another sticker or the stage controls.
- **DP-19 — Reduced-motion year** Under reduced motion no transition runs at all, the year shows its end state at once, and the Day box and arrow-key stepping give the same per-day answer.
- **DP-20 — Tonight card** The Tonight card shows who has the child tonight and the next handover from the server's answer, refreshed as stated in Interactions.
- **DP-21 — Year strip journey** On a 375x812 touch phone with a wrong device clock, the other parent reads the server's Tonight card, taps a strip day, is refused for a day outside the year, reads a handover in a DST gap at its published instant, and scrubs forward and back with field, counters and stickers matching the derived year; a swap accepted on another screen recolours the strip within three seconds without moving the scroll, and reduced motion gives totals at once and arrow-key stepping.
- **DP-22 — Swap request lifecycle** Swap requests move only along the request edges in Business rules, and every other edge is refused with its stated code.
- **DP-23 — Swap nights** A swap names a half-open interval of nights that all belong to the giving parent and whose first handover is still in the future when sent, as qualified in Business rules.
- **DP-24 — Conditional writes** Every change to an existing plan draft, swap or cost is an RFC 9110 conditional request against a strong ETag, so exactly one of two writes against the same version succeeds.
- **DP-25 — Idempotent requests** Every state-changing POST honours an Idempotency-Key with stored-response replay and reuse refusal, as qualified in Business rules.
- **DP-26 — Swap by keyboard** The Request a swap dialog opens from a shortcut anywhere in the Calendar region, keeps Tab and Shift+Tab inside itself, closes on Escape and returns focus to the control that opened it.
- **DP-27 — Swap journey** The planning parent types inclusive nights in the dialog by keyboard, is refused for nights already theirs, and sends a swap whose half-open interval the API reports and whose display is unchanged in a negative-offset zone; it appears live for the other parent, a withdraw racing an accept across two processes lets exactly one win with the loser told the stale copy, an accepted swap changes both calendars, and each outcome is announced even when repeated.
- **DP-28 — One-winner overlapping swaps** Sends of swaps whose nights or make-up nights overlap are linearizable one-winner claims across every process, and every loser is refused naming the winning request.
- **DP-29 — Live household stream** Each household has a server-sent event stream of its record log that reaches every open screen within three seconds of a commit on any process, and resumes from Last-Event-ID without gaps or duplicates.
- **DP-30 — Swap race journey** Both parents send overlapping swaps for one weekend from two processes at once; exactly one is sent and the loser sees the overlap copy, the same key replays the stored refusal with its replay header while a different body under that key is refused, the winner appears on the other screen within three seconds, a reconnected stream misses and repeats no entry, and closing the tab releases the stream.
- **DP-31 — Answer window** The server stores a sent request's answer-by instant from the environment's window, and refuses any answer at or after it, as qualified in Business rules.
- **DP-32 — Sweeps act once** Lapsing, reminders and settling run on every process but act exactly once per request on its stored moments, each with its one record-log entry and its notices.
- **DP-33 — Device clock never decides** Every screen shows a request's status and deadline exactly as the server reports them, whatever the device clock says.
- **DP-34 — Lapse journey** On the short-window copies the planning parent sends a reimbursement request; the other parent sees the server's answer-by time despite a wrong device clock, is refused for a decline with no reason, gets exactly one reminder, and is refused with the lapsed copy for accepting after the deadline with a stale version, while both parents get exactly one lapsed email and the log holds one lapse entry across both processes.
- **DP-35 — Log a shared cost** A parent logs a cost they paid in exact integer minor units with a category, an incurred instant and a description, validated as specified in The API.
- **DP-36 — Largest-remainder split** Each cost is split by the version governing its custody day, or by its agreed split, using largest-remainder allocation in integer minor units with ties to the paying parent, so the two shares always add up to the amount.
- **DP-37 — Live cost quote** The cost form shows each parent's share in place from the server's quote as the amount, date or time changes.
- **DP-38 — Cost request lifecycle** Reimbursement requests follow the request edges in Business rules, and only the paying parent can confirm settlement.
- **DP-39 — Cost journey** The other parent types an amount in the household's money form while the split follows the latest input through reordered replies, and is refused for too many decimals; both parents edit one split under conditional writes with exactly one winner, the loser sees the stale copy, the answerer accepts, a stale second accept is refused, the planning parent is refused when settling the other's cost, the payer settles, and ledger, Balance and a byte-identical rebuilt statement agree on both screens.
- **DP-40 — Byte-exact receipts** A receipt is stored byte for byte and reported as stored only after the stored copy has been read back and matches.
- **DP-41 — Receipt storage outage** When storage is unreachable, a receipt upload is refused with nothing recorded and no key result kept, and the screen says so and offers a retry.
- **DP-42 — Receipt journey** On the storage-outage copy an upload shows the outage copy with nothing saved, and a retry with the same key on the working app stores one object; a file with no recognised signature is refused, the other parent downloads the receipt byte-identical under its non-ASCII name, a receipt id from another household returns nothing, deleting the draft on the outage copy changes nothing, and deleting it on the working app removes the stored object.
- **DP-43 — Effective-dated amendments** An adopted amendment applies only from its effective date, which is after the household's today, so earlier nights and every non-draft cost keep the earlier version on every surface.
- **DP-44 — Amendment journey** The planning parent drafts a 55/45 amendment and is refused for an effective date equal to the household's today and for a date with sent costs on or after it; they adopt from a later date, a draft on that custody day moves to the new split while one incurred that morning before the handover keeps the old, an accept racing the adoption across processes never accepts moved nights, and per-night versions read identically on every surface after a process restarts.
- **DP-45 — Year record job** A year record is a resumable job with recorded progress and cancellation that any process may run but only one completes, pinned to the derived year as requested, and shown pending until its PDF is rendered and the stored copy is confirmed.
- **DP-46 — Year record PDF** The year record PDF carries the published lines for the pinned year, its swaps and its cost ledger, and downloads byte-identical to the stored copy.
- **DP-47 — Year record journey** On the PDF-outage copy the planning parent requests a year record, is refused for a second request for the same year, and watches it move through waiting to failed while their typed share-link label and focus survive every refresh, then cancels another; on the working app a record requested just before an amendment keeps its pinned digest, a stopped worker's record finishes on another process, and the other parent sees it stored live and downloads the PDF.
- **DP-48 — Read-only share links** The planning parent creates share links that expire, can be revoked and can be regenerated, and that answer reads only; every dead link looks exactly like an unknown one.
- **DP-49 — Share page contents** A share link shows a year's handover dates, instants, parent names and year digest, and nothing about costs, receipts, notes or requests.
- **DP-50 — Share journey** The planning parent types an expiry in the plan's zone and creates a share link; the school opens it bare and its address gains the year without a new history entry, its digest hashes the canonical year bytes, it moves to the next year and back and is refused for a write; regenerating kills the old link, revoking kills the new one and reaches the other parent's open screen within three seconds, an expiry passes on the server clock whatever the page clock says, and the other parent is refused when creating one.
- **DP-51 — Transactional notices** Every email notice is committed with its state change through a transactional outbox, fanned out as one notice per recipient, sent at least once by whichever process claims it, carries only the household name and a link, and stays queued while mail is down.
- **DP-52 — Append-only record log** Every state change writes exactly one entry in a gapless per-household sequence in commit order, and a refused or replayed action writes none.
- **DP-53 — Notices journey** On the isolated mail-outage copy a parent sends a swap and sees success copy that stays true, a second invite replaces the first in the Notices table, a refused send adds no log entry, and the mail-down copy shows; on the shared mail-outage copy a fan-out notice reaches each parent in Mailpit exactly once after delivery recovers, and the log pages without repeats while entries arrive live.
- **DP-54 — Problem details** Every error, including unknown routes and server faults, is an RFC 9457 problem details body with a stable code, chosen by the single error ladder in The API.
- **DP-55 — Household isolation** A parent reaches only their own household's records, and another household's id, in a path or in a body, is answered as if it did not exist.
- **DP-56 — Input hygiene** Request bodies refuse unknown fields, inexact numbers and hidden characters, keep built-in property names as ordinary data, and count NFC-normalised text in graphemes, as stated in The API.
- **DP-57 — Server boundary** State-changing requests must carry the app's own Origin, request bodies have the stated size limits, and the server never serves its source, configuration or credentials.
- **DP-58 — Published layouts** Each screen shows its published arrangement at 375x812, 768x1024 and 1280x800 with no page-level horizontal scrolling, and the Household bar and the ledger's own scroller both keep working at 768.
- **DP-59 — Two-field look** Every screen is built from equal mint and pink fields on a near-white ground, with Dela Gothic One headlines, white rounded cards and green on the control button only, and colour is never the only carrier of a status.
- **DP-60 — Configuration from the environment** Every service URL, credential and duration is read from the environment at start, and is never written into the source or sent to the browser.
- **DP-61 — Landing routes** Every sign-in, join, sign-out and household creation lands on its published route, and a return path is followed only to a published private page, as qualified in Interactions.
- **DP-62 — Share page year in the URL** The share page keeps its year in the address, replaces a missing or bad year with the default without a new history entry, and offers Previous year and Next year links that Back and Forward restore.
- **DP-63 — Deleting a draft cost deletes its receipts** Deleting a draft cost removes its stored receipt objects in the same decision, and when storage is unreachable nothing is deleted and nothing is logged.
- **DP-64 — Latest quote wins** The Cost split and Plan preview regions only ever show the server's reply to the latest input, and discard any reply to an earlier input that arrives later.
- **DP-65 — Today is the plan zone's date** A household's today is the server clock's date in the plan's zone, and it decides amendment dates, the cost date range and Tonight.
- **DP-66 — Accept rechecks the nights** Accepting a swap rechecks that every night and make-up night still belongs to its giver under the versions in effect now, linearized with adoptions and other accepts in the household, and a moved night makes the accept fail with its stated code and copy.
- **DP-67 — Drafts move to the new version** Adopting an amendment re-splits every draft cost whose custody day is on or after its effective date by the new version, with a new ETag, in the same transaction as the adoption.
- **DP-68 — Bounded lists** Every list endpoint takes keyset pages with a bounded limit and valid cursors only, never repeats or skips an entry under concurrent commits, and the Record log screen shows every entry once.
- **DP-69 — Polling never resets the user's work** The Records screen's background refreshes update its lists and status in place without resetting typed text, chosen values or focus.
- **DP-70 — Cost statement projection** The household's cost statement is a canonical document kept in step with every cost change, and rebuilding it from the costs gives byte-identical output on any process.
- **DP-71 — Make-up nights** A swap may carry make-up nights that go back to the giver, and both intervals form one claim that is checked, overlap-tested, accepted and settled together.
- **DP-72 — Consecutive-night limit** A swap that would leave a moved night in a same-owner run longer than the plan's limit, measured across year and version boundaries, cannot be sent or accepted.
- **DP-73 — Make-up journey** By keyboard the planning parent is refused for a make-up length mismatch and a run over the limit that crosses a year end, then sends a swap with make-up nights in the next year; the other parent accepts, both year documents change and the PDF shows both lines, an amendment moving only a make-up night blocks another accept, and of two adjacent swaps that together break the limit exactly one accept wins with the run-limit copy for the loser.
- **DP-74 — Stage state from any arrival** Reload, Back or a one-frame jump to any scroll position shows the exact stage state before any scroll event, and turning reduced motion on or off and receiving a live swap take effect at once without a reload or a scroll move.
- **DP-75 — Ordered rule moves** Quick rule moves are written in order, each with the previous reply's ETag, and a refused move restores the server's order with the stale copy and focus on that rule.
- **DP-76 — Hidden rule fields** Rule fields for another kind or date type are out of the accessibility tree and Tab order, and their values are never sent.
- **DP-77 — Focus and announcements after actions** When an action removes the focused button, focus moves to its list item or row and never to the page body, focus is never hidden under the fixed bars, and each outcome is announced even when the words repeat and is never overwritten by a later refresh.
- **DP-78 — Expired session keeps entries** A 401 sends the parent to sign in, and signing in as the same parent reopens an interrupted swap or cost dialog with its entries and sends nothing.
- **DP-79 — Share page re-reads every view** Every year view of a share page, Back and Forward included, reads the server, so a dead link shows the dead-link heading on its next view whatever offset its expiry was written in.
- **DP-80 — Lost upload races leave nothing** A receipt upload that loses to another write on its cost leaves no stored object, and within five seconds the bucket's receipt prefix holds exactly one object per receipt row.
- **DP-81 — Superseded notices** A queued invite killed by a newer invite, or a queued reminder whose request is no longer sent, is superseded in the same transaction and never reaches SMTP.
- **DP-82 — Streams end with their session** An open stream closes within three seconds of its session ending on any process, and abandoned streams release their database resources.
- **DP-83 — Dates and night ranges on screen** Dates are typed and read as the interface states and night ranges read inclusively on screen, while the API reports the forms it states, in both directions and in every zone.
- **DP-84 — Wall-clock handovers** A handover recurs at the plan's wall-clock time in its zone across clock changes, whichever offset the first exchange was written in.
- **DP-85 — Custody day** A custody day starts at the handover, so a cost incurred before that day's handover belongs to the previous custody day, which decides its governing version and its statement year.
- **DP-86 — Money by currency** Money reads and is typed in the interface's form with the household currency's own decimals, and the API holds integer minor units, for currencies with zero, two and three decimals.
- **DP-87 — Split percentages** The screen shows whole percentages that always sum to 100 and the API holds integer basis points, as stated in each section.
- **DP-88 — Exact numbers and ids** Amounts and totals beyond 32-bit range are JSON numbers, ids are JSON strings kept exact beyond 2^53, and an id out of any range is a plain 404.
- **DP-89 — Names and labels** API fields are camelCase and enums use the API's words, while the screen shows the interface's words for the same values.
- **DP-90 — Partial cost edits** A cost PATCH leaves absent fields unchanged and clears null ones, so clearing a note or an agreed split on screen clears it in the API, and any split change is re-allocated with a new ETag.
- **DP-91 — Receipt file contract** A receipt's type comes from its leading bytes alone, its size limit is exact to the byte, and its download carries a strong ETag and its original name.
- **DP-92 — Bearer-only API** The API accepts the bearer token only, on every route including the event stream, and never a cookie.
- **DP-93 — Database recovery** When the database connection is cut, the process stays up, answers 503 with its code and copy, and the next request after recovery succeeds without a restart.

## Frontend

This section, The interface, describes every value as a parent reads and types it. The device clock may be wrong by hours or days and never changes what a screen says: statuses, deadlines, lapses, today and Tonight always come from the server's latest reply.

### How values read on screen (DP-83, DP-84, DP-86, DP-87, DP-89)

- **Dates.** Every date box is a plain text box, typed `DD/MM/YYYY`. A date that isn't real shows `Enter a real date as DD/MM/YYYY.` Elsewhere a date reads `<Ddd D Mon YYYY>`: English, three-letter weekday and month, for example the pattern `Fri 12 Jun 2026`.
- **Night ranges.** "First night" and "Last night" name the first and last night the child sleeps there, both included. A list item reads `<first night> until <last night>` and a make-up range reads `Make-up <first night> until <last night>`.
- **Times.** "Exchange time" and "Time" are typed `HH:MM`, 24-hour, as a wall clock in the household's zone; otherwise `Enter a time as HH:MM.` A time that doesn't exist on that date shows `That time doesn't exist on that date. Choose another.` A time that occurs twice means the earlier one. An instant reads `<HH:MM> on <Ddd D Mon YYYY> (<zone>)` in the zone that governs it, where `<zone>` is the IANA name.
- **Expires** is typed `DD/MM/YYYY HH:MM` as a wall clock in the household's zone.
- **Money.** `<money>` is an optional U+2212 minus, the whole part grouped in threes with U+202F, a comma and exactly the currency's decimals when it has any, one space and the ISO code: the patterns `1 234,56 CAD`, `8,000 KWD`, `123 456 JPY`. "Amount" takes digits with optional U+202F or space grouping and a comma with at most that many decimals, so whatever the app printed reads back. A full stop, a sign, a currency code or too many decimals shows `Enter the amount using a decimal comma, with at most <n> decimal places.` and sends nothing, `<n>` being the currency's decimals.
- **Shares.** "Cost share for <planning name> (%)" and "Agreed share for <planning name> (%)" take 0 to 100 with a comma and at most two decimals; otherwise `Enter a share from 0 to 100 with at most two decimals, using a comma.` The Split cell shows two whole percentages, planning parent first, as `<n>/<n>`, that sum to 100: each is rounded down and the leftover point goes to the larger fraction, or to the planning parent on a tie.
- **Sizes.** A receipt's size reads `<n> MiB`, two decimals with a comma. A chosen file over 5 MiB shows `Receipts can be up to 5 MiB.` and sends nothing; exactly 5 MiB goes through.
- **Words for states.** Request: Draft, Waiting for an answer, Accepted, Declined, Lapsed, Withdrawn, Settled. Year record: Queued, Being made, Ready, Failed, Cancelled. Notice: Waiting to send, Sent, Replaced. Rule kinds: Swap, Holiday, School break, Vacation, Base rotation. Categories: Medical, School, Activities, Childcare, Clothing, Other.

Other forms belong to the API alone: the browser never sends this section's forms there.

### Screens and layout (DP-05, DP-13, DP-16, DP-20, DP-58)

Every private page has a `navigation "Household"` with links in this order: Calendar, Plan, Requests, Costs, Records. At 768x1024 and 1280x800 it is a bar fixed to the top, right of the Twohouse wordmark. At 375x812 it is a bar fixed to the bottom with five equal links. The page itself never scrolls sideways at any viewport.

| Screen (path) | Shows | 375x812 | 768x1024 | 1280x800 |
|---|---|---|---|---|
| Sign in (`/`) | Two-field hero, headline, sign-in card at the join | Fields stacked, mint above pink; card below the headline, full width | Fields in equal halves; card centred on the join | Same as 768 |
| Start (`/start`) | One card with the household form | One column | Centred, half width | Centred, a third of the width |
| Join (`/join/<token>`) | Household and parent name with a password field, or the dead-link page | One column | Centred card | Centred card |
| Calendar (`/calendar`, optional `?year=YYYY`) | Year stage, Tonight, month grid, Requests summary | One column in that order | Stage, grid full width, then Tonight and Requests summary in two equal columns | Stage; below it grid at about two-thirds width, with Tonight above Requests summary on the right |
| Plan (`/plan`) | Rule order, Rule editor, Plan preview, Versions | One column in that order | Rule order and Rule editor in equal columns; Plan preview then Versions full width | Three columns: Rule order, Rule editor, Plan preview above Versions |
| Requests (`/requests`) | Waiting for you, Sent by you | One column, Waiting for you first | Same as 375 | Equal columns, Waiting for you on the left |
| Costs (`/costs`) | Log a cost, Cost ledger, Balance | Button, ledger rows as stacked cards of labelled cells, Balance | Balance, button, then the full-column ledger in its own sideways scroller while the Household bar stays at the top as the page scrolls | Ledger at about two-thirds width; button above Balance on the right |
| Records (`/records`) | Year records, Share links, Notices, Record log | One column in that order | Same as 375 | Year records above Share links on the left; Notices above Record log on the right; equal columns |
| Share page (`/share/<token>?year=YYYY`) | Household name, year, digest, year links, handovers | One column | One column | One centred column |
| Not found (any other path) | Not-found card | One column | Centred card | Centred card |

**Year stage.** The stage is first on the Calendar, and fills the viewport. On `/calendar` the Household bar is fixed over it at the larger viewports; the stage's top edge stays at y=0 for scroll positions from 0 to 1200 and its content starts below the bar. The document is always tall enough to reach 1200 at all three viewports; after 1200 the stage scrolls away. It holds the headline, two night counters (planning left, other right; side by side above the strip at 375), the year strip, the stickers, the Day box and day answer, and the green "Request a swap" pill at the join.

### Public screens and controls (DP-12, DP-13, DP-16, DP-17, DP-18, DP-19, DP-20, DP-26, DP-37, DP-58, DP-62, DP-69, DP-76)

Only these are public. Accessible names are exactly the label: a count or badge beside one never joins the name. Every `combobox` is a native single-choice list, except "Exchange time zone" and "Vacation exchange zone", which are text boxes with suggestions where the full IANA name is typed. `<planning name>` and `<other name>` are as entered; `<year>` is four digits.

| Where | Role and name | Content |
|---|---|---|
| Every private page | `navigation "Household"`, links "Calendar", "Plan", "Requests" (with a waiting count beside it), "Costs", "Records"; `button "Sign out"` | |
| Every page | `status "Activity"` | Results of async actions; the last one survives in-app navigation and dialog close |
| Sign in | `textbox "Email"`, password field "Password", `button "Sign in"`, `link "Start a household"` | Headline `Two houses. One plan.` |
| Start | `textbox "Household name"`, `textbox "Currency"`, `textbox "Your name"`, `textbox "Your email"`, password field "Password", `textbox "Other parent's name"`, `textbox "Other parent's email"`, `button "Create household"` | Heading `Start a household` |
| Join | password field "Password", `button "Join household"` | Heading `Join <household name>` |
| Stage | `region "Year <year>"` with `data-field` (`split`, `planning`, `other`) and `data-day` (the focused day as `YYYY-MM-DD`) | Headline `Who has tonight, and why.` |
| Stage | `status "Nights with <planning name>"`, `status "Nights with <other name>"`, not announcing during scroll | Only the integer |
| Stage | `img "<winner rule name> beats <beaten rule name>"`, one per override run that beat another rule (see Motion and effects), with `data-state` `settling` or `resting` | A sticker with the same words |
| Stage | `slider "Year strip"`, one Tab stop, at least 44 pixels tall, `aria-valuemin` 0, `aria-valuemax` last day index, `aria-valuenow` focused index, `aria-valuetext` `<Ddd D Mon YYYY>` | One thin bar per day in date order, each with `data-date` (`YYYY-MM-DD`) and `data-owner` (`planning`, `other`, `none`), not separate accessibility objects |
| Stage | `textbox "Day"`, `status "Day answer"`, `button "Request a swap"` | |
| Calendar | `region "Tonight"` | `Tonight: <name>`, then the next-handover line |
| Calendar | `region "Requests summary"` with `link "Open requests"` to `/requests` | Two lines, `Waiting for you: <n>` and `Sent by you: <n>`: the number of sent requests awaiting the signed-in parent's answer, and of sent requests the signed-in parent created that are still unanswered. They update on every stream entry. |
| Calendar | `region "Calendar"` holding `grid "<Month YYYY>"`, `button "Previous month"`, `button "Next month"` | `gridcell` named `<Ddd D Mon YYYY>, <parent name>`; visible line `Year digest <digest>` that wraps at 375 |
| Swap dialog | `dialog "Request a swap"`: `textbox "First night"`, `textbox "Last night"`, `textbox "Make-up first night"`, `textbox "Make-up last night"`, `radiogroup "Who has the child"`, `textbox "Note"`, `button "Save draft"`, `button "Send request"`, `button "Cancel"`, `alert` | |
| Requests | `list "Waiting for you"`, `list "Sent by you"`; buttons "Accept", "Decline", "Withdraw", "Send", "Delete draft" | State in words, ranges, answer-by line |
| Decline dialog | `dialog "Decline request"`: `textbox "Reason"`, `button "Decline"`, `button "Cancel"` | |
| Plan | `listbox "Rule order"`, one `option` per rule, grouped; `button "Move up"`, `button "Move down"` | Groups `Holidays`, `School breaks`, `Vacations` |
| Plan | `region "Rule editor"`: `textbox "Rule name"`; `combobox "Kind"` (Holiday, School break, Vacation); `combobox "Date type"` (Fixed date, Weekday of month, Easter); `spinbutton "Month"`, `spinbutton "Day of month"`, `spinbutton "Weekday"`, `spinbutton "Week of month"`, `spinbutton "Start offset (days)"`, `spinbutton "Nights"`; `textbox "First night"`, `textbox "Last night"`; `combobox "Odd years"`, `combobox "Even years"`, `combobox "Split"` (Halves, Whole), `combobox "First half in odd years"`, `combobox "Parent"`; `textbox "Vacation exchange time"`, `combobox "Vacation exchange zone"`; `button "Save rule"`, `button "Add rule"` | Only the fields of the chosen kind and date type exist |
| Plan | `textbox "Effective from"`, `textbox "Exchange time"`, `combobox "Exchange time zone"`, `textbox "Base pattern"`, `textbox "Base anchor"`, `textbox "Cost share for <planning name> (%)"`, `spinbutton "Most nights in a row"`, `button "Save draft"`, `button "Adopt plan"` | The other share is shown read-only. "Base pattern" takes 1 to 28 letters, `P` for a night with the planning parent and `O` for the other parent, typed as shown. "Base anchor" is the date the pattern starts on, typed `DD/MM/YYYY`. |
| Plan | `status "Plan preview"`, `list "Versions"` | Version number, state, effective date |
| Costs | `button "Log a cost"`; `dialog "Log a cost"`: `textbox "Description"`, `combobox "Category"`, `textbox "Amount"`, `textbox "Date"`, `textbox "Time"` (starts at `12:00`), `textbox "Note"`, `status "Cost split"`, `button "Save draft"`, `button "Send request"`, `button "Cancel"` | |
| Costs | `dialog "Edit split"`: `textbox "Agreed share for <planning name> (%)"`, `button "Save split"`, `button "Use plan split"`, `button "Cancel"` | |
| Costs | `table "Cost ledger"`, columns Incurred, Custody day, Description, Amount, Paid by, Split, `<planning name>'s share`, `<other name>'s share`, Status; row buttons as allowed: "Edit draft", "Edit split", "Attach receipt", "Send", "Accept", "Decline", "Withdraw", "Settle", "Delete draft"; `link "Receipt <n>"` | Incurred reads `DD/MM/YYYY HH:MM`, Custody day `DD/MM/YYYY` |
| Costs | `region "Balance"` | Balance lines |
| Records | `region "Year records"`: `combobox "Year"`, `button "Make year record"`, `list "Year record list"`, `status "Record status"`; items have `link "Download PDF"` when stored, `button "Try again"` when failed, `button "Cancel record"` while queued or being made | |
| Records | `region "Share links"`: `textbox "Label"`, `textbox "Expires"`, `button "Create share link"`; per link `button "Copy link"`, `button "Regenerate"`, `button "Revoke"` | |
| Records | `region "Notices"` with `table "Notices"` (Sent to, Subject, Status, Queued, Sent); `region "Record log"` with `list "Log entries"` (`seq`, type, time), `button "Load more"` | |
| Share page | `heading` `<household name>: handovers in <year>`, `link "Previous year"`, `link "Next year"`, `list "Handovers"` | Visible line `Year digest <digest>` |

### Interactions (DP-12, DP-13, DP-14, DP-19, DP-20, DP-26, DP-29, DP-33, DP-37, DP-61, DP-62, DP-64, DP-68, DP-69, DP-74, DP-75, DP-76, DP-77, DP-78, DP-79)

**Routes.**
- Creating a household lands on `/plan`, with focus in `textbox "Rule name"` and `Household created. Enter your plan.` in `status "Activity"`. Joining lands on `/calendar`. Signing out lands on `/`. `/` or `/start` with a live session goes to `/calendar`. Reloading any landing shows the same screen.
- A private page (`/calendar`, `/plan`, `/requests`, `/costs`, `/records`) without a live session goes to `/?next=<path and query>`, percent-encoded as a URI component.
- After sign-in, `next` is followed only when its path is exactly one of those five, query kept as given. Anything else lands on `/calendar` and never leaves the origin: a missing value, protocol-relative or backslash forms, absolute or script URLs, `/share/…`, `/api/…`, unknown paths.

**Interrupted session.** A private read, write or stream answering 401 goes to `/?next=<path>`. With a swap or cost dialog open, its fields are kept in that tab's session storage with the user id. Signing in as the same parent reopens the dialog with those values, focus on its first field and `You were signed out. Your entries are still here. Check them and send again.` in `status "Activity"`; nothing is sent automatically. A different parent signing in, or pressing Sign out, clears them.

**Keyboard.**
- Every action works by keyboard alone with a visible focus ring. Pending controls say so in words, keep focus, report `aria-disabled="true"` and ignore further presses, so one press sends one request.
- Dialogs ("Request a swap", "Decline request", "Log a cost", "Edit split") are modal. Opening moves focus to the first field; Tab and Shift+Tab wrap inside; Escape or "Cancel" closes and returns focus to the opener. A refused submit moves focus to the first invalid field. The app's own field copy always shows, never a browser validation bubble.
- `S` with focus anywhere in `region "Calendar"` or the stage opens "Request a swap", including on a button or grid day, and does nothing in a text field. Enter on a grid day opens it with "First night" set to that day.
- The month grid is the WAI-ARIA APG grid pattern with roving tabindex. Home and End go to the ends of the focused week; Page Up and Page Down to the same day in the adjacent month, clamped. Moving past the month's edge moves into the adjacent month, and past the year's edge changes the shown year. Each move writes `status "Day answer"`.
- `listbox "Rule order"` has one Tab stop. Alt+Up and Alt+Down move the focused rule; "Move up" and "Move down" move the selected rule. Selection follows the rule by its identity. A rule stays within its kind; past the boundary it stays put and writes `A rule moves only within its own kind.`
- Each move saves at once. Moves queue in order, each using the ETag of the previous reply, so two moves within 50 milliseconds both save. A refused move restores the server's order and writes the stale copy, with focus staying on that rule. Fields of another kind or date type are absent from the Tab order and the accessibility tree, and their values are not sent.
- When an action removes the focused button on Requests, Costs or Records, focus moves to its `listitem` or row. At 375 and 1280, Tabbing never leaves focus under a fixed bar (WCAG 2.2 SC 2.4.11).

**Previews and quotes.**
- A new first-plan draft starts with Effective from set to the household's today, Exchange time `17:00`, the household's zone, Base pattern `PO`, Base anchor the household's today, Cost share 50 for each parent, no run limit and no rules. A draft for an amendment starts as a copy of the newest adopted version with Effective from empty. The first exchange sent to the API is Effective from at Exchange time as a wall clock in the zone, written with that zone's offset; a vacation's is built the same way from its first night and its own time and zone.
- Plan requests a preview when it opens (the draft, or else the newest adopted version) and within 300 milliseconds of each edit; the reply shows in `status "Plan preview"` within one second, with no submit. The preview year is the year of the household's today, or of the draft's effective date before any adoption.
- While Amount, Date and Time are valid, the cost dialog asks for a quote within 300 milliseconds of the last change; the reply shows in `status "Cost split"` within one second. The browser never computes a share.
- Each of those regions shows only the reply to the most recent input. An earlier reply arriving later is discarded, aborted or not. While a newer request is outstanding the region keeps its previous text. When the input turns invalid, any reply in flight is discarded and the region shows the input's copy.

**Year stage and days.**
- Scrolling drives the stage by mouse or touch. Tapping a point on the slider focuses it and makes the day under the point the focused day, writing its answer. Left and Right on the slider step a day and stop at the year's ends.
- Typing a date in "Day" writes that day's answer and leaves the focused day; a date outside the shown year writes `Choose a day in <year>.`
- A tap or step jumps the page at once to the smallest whole scroll position whose day index is that day. Under reduced motion the page does not scroll; only the slider's value, `data-day` and the answer change.

**Live updates.**
- Every private screen keeps one connection to the household stream and re-reads what it shows when an entry arrives: new requests, the derived year, the ledger and Balance, record items and share links. A screen writes with the ETag of the copy it shows. If the stream drops it reconnects with the last `seq` and shows `Live updates paused. Reconnecting...` until it is back.
- A stale write (412) re-reads the record, shows it and writes `This changed while you were looking. It now shows the latest version.`
- The Tonight card reads the server on load, on every stream entry and at least every 60 seconds.
- While a year record is queued or being made, Records re-reads the records at least every 2 seconds; while open it re-reads the notices at least every 2 seconds. Matching copy appears within 3 seconds of the server state changing.
- Those refreshes and stream repaints never remount `combobox "Year"` or change its value, clear or move the caret in Label or Expires, move focus or close a control. Focus on a record's button stays while its item updates. A refresh never overwrites an outcome already written to a live region. Writing the same outcome twice mutates `status "Activity"` again, clearing and rewriting it.
- `list "Log entries"` shows ascending `seq`, opening on 10 entries; "Load more" reads the next 10. A live entry directly following the last shown is appended; one further ahead waits for "Load more", so there are no gaps and no `seq` twice. "Load more" exists only while the last `next` was not null or a live entry has arrived beyond the loaded end.

**Costs.** "Edit draft" reopens the dialog with the stored values in this section's forms; Save draft sends only changed fields, and a box the parent emptied sends null. In "Edit split", saving an empty box or pressing "Use plan split" sends null.

**Share page.** `/share/<token>` reads `?year=`. A missing, malformed or out-of-range year is replaced in the current history entry with the default year's address before any data shows, with no new entry. "Previous year" and "Next year" are real links, absent at 2000 and 2100. Every year view, Reload, Back, Forward and a restored page included, fetches the server; a dead link shows the dead-link heading and no `list "Handovers"`.

### Visual design (DP-59)

**Type.** Headlines use Dela Gothic One, a heavy rounded display face; all other text uses DM Sans. Each heading step is a quarter larger than the one below; the page headline is about twice body size and the stage headline about three times.

**Colour by role.** A near-white page ground; a light grey secondary surface for inputs and table headers; near-black ink; mid-grey muted text; a deep green accent with white on it, used only for each screen's main control pill. Soft mint always means the planning parent and soft pink always means the other parent, both light enough for near-black text at WCAG 2.2 AA.

**Fairness.** Each colour means the same parent on the stage, strip, grid, ledger rows, chips and stickers. Neither parent's field, counter or column is ever larger. Every coloured day, row or chip also names its parent or status in words.

**Composition and hero.** Every screen opens on two flat fields, mint and pink, with a crisp edge and no gap, under a large centred display headline; dense content sits on white cards with corners rounded to about 28 pixels, with generous padding. On sign-in and the Calendar top, the viewport splits into equal mint and pink halves, the headline reads across both and the green pill sits on the join. At 375 the fields stack, mint above pink.

**Working screens.** Lists, forms and tables use the same cards. An empty state is one large display line over one sticker. Error and outage states use the same card with one plain sentence and a "Try again" button where retry makes sense. Stickers are flat badges drawn in code (rounded blobs, scalloped circles, tags) in the winning parent's colour with a thick dark outline.

**Targets.** Every control, including those on dense rows, is at least 44 by 44 pixels (WCAG 2.2 SC 2.5.8). No paper or cream texture, hairline rules, monospace labels, index numbering or glass effects.

### Motion and effects (DP-16, DP-17, DP-18, DP-19, DP-74)

Two speeds: quick, about a fifth of a second, for counters and presses; settling, under half a second, for stickers. Both start fast and come to rest gently, with no overshoot. Only fading, moving and turning animate; nothing else does.

**Field swap.** The window's scroll position `s`, 0 to 1200 pixels, drives everything. With `N` days in the shown year and 1 January as day 0, the focused index is the smaller of `N − 1` and `floor(s × N / 1200)`.
- **Field.** At `s` = 0 the stage shows the two equal fields, `data-field` `split`, with the edge in the middle of the viewport (horizontal at 375). Above 0 the whole stage is the field of the parent with the focused night, or `split` for an ownerless night. The colour swaps instantly at each handover day with no fade or blended colour in any frame.
- **Counters.** They show nights from 1 January through the focused day inclusive, counting through in-between values to the exact count within a quarter of a second of the scroll stopping, moving steadily with no overshoot.
- **Stickers.** An override run is consecutive nights with the same winning rule id and the same non-null beaten rule name. A stretch whose `beats` is null, such as a swap or holiday over the plain rotation, is not an override run: it has no sticker, and nothing stands in its place. When the focused day reaches its first day, its sticker drops onto the strip and turns from flat to a resting tilt of 2 to 6 degrees, alternating left and right, settling in under half a second and staying still. Visible stickers never overlap each other, the slider, the Day box or the counters, at all three viewports.
- **Scrolling back and arriving.** At any `s` the field, `data-day`, counters and sticker set are the same going forwards or backwards. Stickers for later runs are absent from the accessibility tree. Reload or Back at any `s` shows the exact state before any scroll event, with stickers resting and no replayed settle; a one-frame jump from 0 to 1200 and back gives the full set, then none.
- **Live.** A live swap while scrubbed updates field, counters and stickers without moving the scroll position.

**Other motion.** Dialogs fade and rise in about a fifth of a second. A pressed button sits slightly lower while held. A new request slides in once in under half a second. Nothing loops: no idle animation or pulsing, and the pending indicator stops when its action resolves.

**Reduced motion.** No transition or animation runs at all, not even a near-zero one. The stage stays `split` at once, ignores scroll, shows full-year counts, every sticker at rest and the year's rule list. The Day box and strip stepping give the same answer. Turning reduced motion on takes effect at once with no reload; turning it off returns to the sweep at the current `s`.

### Feedback states (DP-14, DP-20, DP-33, DP-45, DP-51, DP-61)

Outcomes go to `status "Activity"` unless a region is named. Field errors appear beside their field, and in a dialog's `alert` too, using the API's `errors` message exactly. Refusal copy sits with its rule in The API. Copy is character for character: straight apostrophes, three full stops, dashes as shown. Placeholders: `<when>` is the instant form from How values read on screen.

- **General.** Any `500`: `Something went wrong. Try again.` Dead invite or share link, as heading: `This link no longer works.` Not-found heading: `We couldn't find that page.`
- **Calendar.** No adopted plan on Calendar or Plan: `No plan yet.` Day answer: `<Ddd D Mon YYYY>: <parent name> — <rule name> (<kind word>)`, plus `, beats <beaten rule name>` when it beat a rule; an ownerless night reads `<Ddd D Mon YYYY>: no plan`. Next handover: `Next handover: <when>, <from name> to <to name>`, or `No handover in the next 60 days.`
- **Plan.** Preview: `<planning name>: <n> nights, <other name>: <n> nights in <year>`. First adoption: `Plan adopted. The calendar now uses it.` Amendment: `Amendment recorded. It applies from <Ddd D Mon YYYY>.` Any draft: `Draft saved.`
- **Requests.** Empty: `Nothing to answer.` Sent: `Request sent. An email notice is on its way.` Accepted swap: `Swap accepted. The calendar now shows it.` Accepted cost: `Reimbursement accepted.` Then `Request declined.`, `Request withdrawn.`, `Marked as settled.`, `Draft deleted.` Answer-by line: `Answer by <when>`.
- **Costs.** Empty: `No shared costs yet.` Cost split: `<planning name> pays <money>, <other name> pays <money>`. Split saved: `Split saved.` Balance: `<owing name> owes <owed name> <money>` and `Your balance: <money>`, negative when the signed-in parent owes; `All square.` when there is none. Receipt uploading: `Uploading receipt...` Stored: `Receipt stored.`
- **Records**, in `status "Record status"`: empty `No year records yet.`, then `Year record requested.`, `Rendering the year record...`, `Year record stored. Download is ready.`, `The year record couldn't be made. Try again.`, `Year record cancelled.`
- **Share links.** `Link created. Anyone with it can see handover times only.`, `New link made. The old link no longer works.`, `Link revoked.` Share item: `<Ddd D Mon YYYY> <HH:MM> (<zone>): <from name> to <to name>`.

## Backend

This section, The API, describes the same product as the server stores and speaks it.

### Values on the wire (DP-07, DP-10, DP-83, DP-84, DP-85, DP-86, DP-87, DP-88, DP-89)

- **JSON** is `application/json; charset=utf-8` with camelCase keys. `…` stands for `/api/households/{hid}`.
- **Dates** are `YYYY-MM-DD`, calendar values with no zone; `Enter a real date as YYYY-MM-DD.`
- **Night intervals** are ISO 8601 half-open date intervals, `YYYY-MM-DD/YYYY-MM-DD`; the end date's night is outside.
- **Instants** are RFC 3339 with an offset. Input accepts any offset or `Z`, with no fractional seconds: `Enter an RFC 3339 instant with an offset and no fractional seconds.` Output has no fractional seconds, carries the governing zone's numeric offset at that instant, never `Z` (`+00:00` for UTC), and uses the household's zone where no rule names another.
- **Money** is an integer count of the household currency's minor units, whose exponent is ISO 4217's. `amountMinor`, shares and every total are JSON numbers, even beyond 32 bits.
- **Splits** are integer basis points summing to 10000.
- **Ids** are JSON strings of decimal digits and may exceed 2^53. An id that isn't known, including one that is non-numeric or beyond every integer range, is `404 not_found`.
- **Parents** are the roles `planning` and `other` in `owner`, `toParent`, `createdBy`, `paidBy`, `owedBy`, `owedTo` and `from`/`to` of Tonight.
- **Enums.** Requests: `draft`, `sent`, `accepted`, `declined`, `lapsed`, `withdrawn`, `settled`. Rule and day kinds: `swap`, `holiday`, `school_break`, `vacation`, `base`. Categories: `medical`, `school`, `activities`, `child_care`, `clothing`, `other`. Records: `requested`, `rendering`, `stored`, `failed`, `cancelled`. Notices: `queued`, `sent`, `superseded`.

### API (DP-01, DP-02, DP-04, DP-05, DP-07, DP-11, DP-14, DP-20, DP-24, DP-25, DP-29, DP-35, DP-37, DP-40, DP-45, DP-46, DP-48, DP-49, DP-51, DP-52, DP-54, DP-55, DP-56, DP-57, DP-62, DP-65, DP-68, DP-70, DP-88, DP-90, DP-91, DP-92, DP-93)

**Contracts.** Status codes follow RFC 9110: 201 creates, 202 queues work (an invite, a record request, a retry), 204 answers removals and sign-out, 304 a matching `If-None-Match`, 200 otherwise. Every error is RFC 9457 `application/problem+json`: `{"type":"urn:twohouse:problem:<code>","title":"<text>","status":<status>,"code":"<code>"}`. A `422 validation_failed` adds `"errors":{"<field path>":"<message>"}`, with dots and brackets in paths (`rules[2].date.day`). Unknown `/api` routes are `404 not_found`; a fault is `500 internal_error` with no detail. A malformed query parameter is a 422 on it with `This value is out of range.` unless stated.

**Authentication.** `POST /api/households`, `POST /api/session` and `POST /api/join` return an opaque `token`, sent as `Authorization: Bearer <token>` on every private route, the event stream included. Cookies are neither set nor accepted. The browser keeps the token across tabs and reloads.

**Error ladder.** The first rung that applies answers:
1. `413 payload_too_large`, then `415 unsupported_media_type`, then `400 malformed_json` (invalid JSON or a duplicate key).
2. `405 read_only`.
3. `403 origin_mismatch`.
4. `401 unauthenticated`.
5. `422 validation_failed` for shape: a body that isn't an object, an unknown field (`This field is not accepted.`), a malformed `Idempotency-Key`.
6. `404 not_found` for what the caller may not see: unknown or other-household ids, in the path or the body.
7. `403` roles: `planning_parent_only`, `not_your_request`, `not_your_answer`.
8. Idempotent replay or `409 idempotency_key_reused`.
9. `428 precondition_required` (RFC 6585).
10. `409 request_lapsed` on accept, decline or withdraw once `answerBy` has passed.
11. `412 precondition_failed`.
12. Other `409` state conflicts.
13. `422 validation_failed` for values.

**Bodies.** Routes marked "none" take an empty body or `{}`, with no 415; any key is an unknown field. `__proto__`, `constructor` and `prototype` as keys are unknown fields; as values (`constructor`, `toString` as a rule id or description) they are ordinary data.
- Text is never trimmed. First, these are refused with `Remove hidden or control characters.`: C0 and C1 controls including U+0085 (line feed allowed inside `note`, `description` and `reason`, never as the final character), U+2028, U+2029, U+200B, U+2060, U+FEFF, U+202A to U+202E, U+2066 to U+2069. Length comes next, then format. Text is NFC-normalised, lengths count extended grapheme clusters (UAX #29), and duplicate checks compare NFC forms.
- JSON types are strict: integer fields accept only plain integers, and `1e3`, `1000.0`, `-0` and `"1000"` get the field's message.
- JSON bodies are limited to 65,536 bytes and receipts to 5,242,880 bytes, each limit allowed.

**Conditional requests.** Plan drafts, swaps and costs change only through RFC 9110 conditional requests against a strong quoted ETag, returned on every read and write of one. `If-Match` is required on every PUT, PATCH, DELETE and action on an existing one, and on receipt upload, which changes its cost's ETag. Creating the draft uses `If-None-Match: *`. Other POSTs take no precondition. Year documents and receipts honour `If-None-Match`.

**Idempotency.** Every state-changing POST takes `Idempotency-Key`, 1 to 64 letters, digits, `-` and `_`, scoped to user, method and path, kept 24 hours. The same key and body bytes replay the stored first response for any status below 500, with `Idempotent-Replayed: true` on replays only and no second effect. A different body is `409 idempotency_key_reused`. A duplicate in flight waits, then replays. A 5xx stores nothing, so the same key may run again.

**Lists.** Keyset pagination: `?after=<cursor>&limit=<n>` answers `{"items":[...],"next":"<cursor>"|null}`. `limit` defaults to 50 and is a plain integer literal from 1 to 100: `Use a limit from 1 to 100.` Cursors are opaque, except on the log where `after` is the last `seq` read, a non-negative integer literal. A malformed or foreign cursor: `This cursor is not valid.` `next` is null exactly when the page reached the end at reading time. A `state` filter outside the enum is a 422.

**Endpoints.** "Who" is either parent unless noted.

| Method and path | Who | Request | Response |
|---|---|---|---|
| `GET /api/health` | anyone | | `{"status":"ok"}` |
| `POST /api/households` | anyone | `householdName, currency, yourName, email, password, otherParentName, otherParentEmail` | `householdId, userId, role, token` |
| `POST /api/session` | anyone | `email, password` | `userId, role, token` |
| `DELETE /api/session` | signed in | | |
| `GET /api/me` | signed in | | `userId, name, role, household:{id, name, planningName, otherName, otherJoined, today, zone, currency, currencyExponent}` |
| `POST …/invite` | planning | none | `noticeId` |
| `GET /api/join/{token}` | anyone | | `householdName, otherParentName` |
| `POST /api/join` | anyone | `token, password` | `householdId, userId, role, token` |
| `GET …/plan` | | | `versions`, newest first |
| `PUT`, `DELETE …/plan/draft` | planning | `<version body>` | `<version>` |
| `POST …/plan/draft/adopt` | planning | none | `<version>` |
| `POST …/plan/preview?year=` | planning | `<version body>` | `year, nights:{planning, other}` |
| `GET …/years/{year}` | | | year document |
| `GET …/tonight` | | | `date, owner, ruleName, nextHandover:{at, zone, from, to}|null` |
| `GET …/swaps?state=`, `POST …/swaps`, `GET`, `DELETE …/swaps/{id}` | delete: creator | `nights, makeupNights, toParent, note` | `<swap>` |
| `POST …/swaps/{id}/send`, `/withdraw` | creator | none | `<swap>` |
| `POST …/swaps/{id}/accept` | answerer | none | `<swap>` |
| `POST …/swaps/{id}/decline`, `…/costs/{id}/decline` | answerer | `reason` | the request |
| `GET …/costs?state=`, `POST …/costs`, `GET`, `DELETE …/costs/{id}` | delete: creator | `description, category, amountMinor, incurredAt, note` | `<cost>` |
| `PATCH …/costs/{id}` | see Partial edits | any of those fields, `agreedSplitBp` | `<cost>` |
| `POST …/costs/quote` | | `amountMinor, incurredAt` | `splitBp, shares, versionId, custodyDay` |
| `POST …/costs/{id}/send`, `/withdraw`, `/settle` | creator | none | `<cost>` |
| `POST …/costs/{id}/accept` | answerer | none | `<cost>` |
| `POST …/costs/{id}/receipts?filename=` | creator | raw bytes, any `Content-Type` | `id, contentType, bytes, sha256, filename, storedAt` |
| `GET …/costs/{id}/receipts/{rid}` | | | stored bytes |
| `GET …/statement`, `POST …/statement/rebuild` | | none | statement document |
| `GET`, `POST …/records` | | `year` | `<record>` |
| `GET …/records/{id}`, `POST …/records/{id}/retry`, `/cancel` | | none | `<record>` |
| `GET …/records/{id}/pdf` | | | `application/pdf` |
| `GET`, `POST …/share-links` | post: planning | `label, expiresAt` | `id, label, url, expiresAt, createdAt` |
| `POST …/share-links/{id}/regenerate`, `DELETE …/share-links/{id}` | planning | none | the link, new `url` |
| `GET /api/share/{token}?year=` | anyone | | `householdName, year, yearDigest, handovers:[{date, exchangeAt, zone, from, to}]` |
| `GET …/notices` | | | list of `id, kind, to, subject, status, attempts, queuedAt, sentAt`, plus `mail: ok|degraded` |
| `GET …/log` | | | list of `seq, at, actor, type, subjectId`, ascending `seq` |
| `GET …/events` | | `Last-Event-ID` | `text/event-stream` |

**Field rules**, each a 422 on the field.
- `householdName`, `yourName`, `otherParentName`, `label`: `Use 1 to 80 characters.`
- `email`, `otherParentEmail`: at most 254 (`Use at most 254 characters.`), valid (`Enter a valid email address.`). Emails match case-insensitively everywhere and are kept and displayed as typed. Equal emails: `The other parent needs their own email.` An email already used: `409 email_taken`.
- `currency`: an active ISO 4217 code: `Choose an ISO 4217 currency code.`
- `password`: `Use 12 to 128 characters.`
- `description`: `Use 1 to 500 characters.` `note`: null or 1 to 500, `Use at most 500 characters.`; private, never in email, share links or PDFs. `reason`: `Give a reason in 1 to 200 characters.`
- `category`: the enum. `amountMinor`: 1 to 100000000000: `Enter the amount as whole minor units from 1 to 100000000000.`
- `incurredAt`: the instant rules; its custody day must lie from the first version's `effectiveFrom` to today plus 366 days, both allowed: `Choose a date from the plan start to one year ahead.`
- `nights`: 1 to 28 nights: `Enter a first and last night, at most 28 nights.`
- `expiresAt`: the instant rules; after now, at most 90 days after now, exactly 90 allowed: `Choose a time in the next 90 days.`
- `year` and `?year`: four digits, 2000 to 2100: `Choose a year from 2000 to 2100.` `GET …/years/{year}` outside it is 404.

**`<version body>`.** The seed household's plan shows the shape:

```json
{"effectiveFrom":"2026-01-01","exchangeZone":"America/St_Johns","firstExchangeAt":"2026-01-01T17:00:00-03:30",
 "base":{"pattern":"PPOOPPPPPOOOOO","anchor":"2026-01-05"},"splitBp":{"planning":6000,"other":4000},"maxConsecutiveNights":null,
 "rules":[
  {"id":"easter","kind":"holiday","name":"Easter","date":{"type":"easter"},"startOffset":-2,"nights":3,"oddYears":"planning","evenYears":"other"},
  {"id":"thanksgiving","kind":"holiday","name":"Thanksgiving","date":{"type":"nth_weekday","month":11,"weekday":4,"n":4},"startOffset":-1,"nights":4,"oddYears":"planning","evenYears":"other"},
  {"id":"xmas-eve","kind":"holiday","name":"Christmas Eve","date":{"type":"fixed","month":12,"day":24},"startOffset":0,"nights":1,"oddYears":"other","evenYears":"planning"},
  {"id":"spring-2027","kind":"school_break","name":"Spring break","nights":"2027-03-20/2027-03-28","split":"halves","firstHalfOddYears":"planning"},
  {"id":"summer-2027","kind":"vacation","name":"Summer in Boston","parent":"other","nights":"2027-07-10/2027-07-24","exchangeZone":"America/New_York","firstExchangeAt":"2027-07-10T10:00:00-04:00"}]}
```

Validation, each a 422 on its path:
- `exchangeZone`: any IANA name, links included: `Choose a time zone from the list.`
- `firstExchangeAt`: the instant rules, on the minute (`The exchange must be on the minute.`), and its local date in the zone must equal `effectiveFrom`, or the vacation's first night: `The first exchange must fall on the effective date.` The local time it reads in that zone is the daily exchange time, and handovers recur at that wall clock whatever offset it was written in. A vacation's `exchangeZone` and `firstExchangeAt` come together. Output writes this field in the zone's offset.
- `base.pattern`: `Use 1 to 28 letters P and O.` `splitBp`: `The two shares must add up to 100%.` `maxConsecutiveNights`: 2 to 60 or null: `Use 2 to 60 nights.`
- `rules`: at most 60. Each `id` is 1 to 40 lowercase letters, digits and `-`; ids and names are unique, `base` is reserved: `Each rule needs its own name.`
- `date.type`: `fixed` with `month` and `day`, existing every year, so 29 February is refused on `date.day` with `Enter a date that exists every year.`; `nth_weekday` with `month`, ISO `weekday`, `n` 1 to 5 or −1; `easter`. `startOffset` −7 to 7; `nights` 1 to 14.
- A school break covers 1 to 120 nights, `split` `halves` or `whole`. A vacation covers 1 to 42 nights. Other values: `This value is out of range.`

`<version>` adds `id`, `number` (from 1) and `status` (`draft` or `adopted`).

**Canonical documents.** The year document and statement are each served as RFC 8785 serialisation; the strong ETag is `"<digest>"`, the lowercase hex SHA-256 of those bytes. The same inputs give identical bytes on any process. The year digest is the year document's digest everywhere.
- Year: `householdId, year, days:[{date, owner, ruleId, kind, ruleName, beats, exchangeAt, exchangeZone}], nights:{planning, other}`, one entry per date in order, null where unset. Swaps use `ruleId` `swap:<swap id>` and `ruleName` `Swap`; the rotation uses `base` and `Base rotation`.
- Statement: `householdId, currency, balance:{owedBy, owedTo, minor}|null, years:[{year, costs, amountMinor, shares:{planning, other}}]`, ascending, one entry per custody-day year holding an accepted or settled cost.

**Requests.** `<swap>`: `id, nights, makeupNights, toParent, createdBy, note, state, sentAt, answerBy, answerZone, answeredAt, declineReason, createdAt`. `<cost>`: `id, description, category, note, amountMinor, incurredAt, custodyDay, paidBy, versionId, agreedSplitBp, splitBp, shares, owedMinor, state, sentAt, answerBy, answerZone, answeredAt, declineReason, receipts:[{id, contentType, bytes, sha256, filename}]`. `owedMinor` is the non-paying parent's share.

**Records.** `<record>`: `id, year, state, attempts, stepsDone (0 to 3), waitingOn (null, renderer, storage), failure (null, renderer_unavailable, storage_unavailable), yearDigest, bytes, sha256, requestedAt, storedAt`.

**Stream.** The HTML server-sent events model: each log entry is an event with `id:` its `seq`, `event:` its `type`, `data:` its JSON. On connect it first sends every entry above `Last-Event-ID` in order, then each new one; a comment goes at least every 15 seconds.

**Share API.** Only GET and HEAD; others are `405 read_only` with `Allow: GET, HEAD`, and every response carries `Cache-Control: no-store`. An unknown, revoked, replaced or expired token is `404 not_found`, byte-identical, checked before `year`. With no `year` it answers for today's year. `from` and `to` here are names as entered.

### Business rules (DP-03, DP-04, DP-08, DP-09, DP-10, DP-11, DP-22, DP-23, DP-24, DP-28, DP-31, DP-32, DP-36, DP-38, DP-40, DP-43, DP-45, DP-48, DP-51, DP-52, DP-55, DP-63, DP-65, DP-66, DP-67, DP-68, DP-70, DP-71, DP-72, DP-75, DP-80, DP-81, DP-82, DP-85, DP-90)

**One clock.** The server's clock is the only clock, and every window is half-open, so at its end instant it is closed. A household's **today** is that clock's date in the household's zone: the zone of the adopted version with the latest `effectiveFrom` on or before its own local date; before that, the earliest adopted version's; with none, the draft's; with neither, `UTC`. Today decides amendments, the cost range, Tonight, `me.household.today` and the share default.

**Deriving a night.** Night D uses the adopted version with the latest `effectiveFrom` on or before D; earlier nights have no owner. Precedence: accepted or settled swap, holiday occurrence, school break, vacation, base rotation; within a kind, the earlier rule in `rules`. `beats` is the `name` of the highest-ranked other rule covering D, excluding the rotation, or null. The rotation gives the letter at the Euclidean `(D − anchor) mod length` position.

**Occurrences.** A holiday occurs once per calendar year at its anchor (Western Easter by the Gregorian computus; no occurrence without a fifth weekday), covers `nights` from `anchor + startOffset`, may cross a year boundary, and takes `oddYears` or `evenYears` by the anchor year's parity. School-break parity is the first night's year: `whole` goes to `firstHalfOddYears` in odd years and the other parent in even years; `halves` gives the first ⌈n/2⌉ nights that way and the rest to the remaining parent.

**Handovers.** D has a handover when D and D − 1 have different owners. Zone and time come from the rule owning D if it carries them, otherwise the rule owning D − 1, otherwise the version in effect on D. Local times follow Temporal's `compatible` disambiguation, across gaps of any length: a gap moves forward by its length, a fold takes the earlier offset.

**Custody day.** Custody day D runs from the exchange time of the version in effect on D to that of D + 1, half-open, in that version's zone, ignoring vacation exceptions. A cost's `custodyDay` is the one containing `incurredAt`.

**Request edges**, shared by swaps and costs; anything else is `409 invalid_transition`. Draft: send or delete by the creator. Sent: accept or decline by the answerer, withdraw by the creator, each before `answerBy`; at `answerBy` the system lapses it. Accepted swap: the system settles it at the handover instant on the later interval's end date. Accepted cost: settle by the creator. Lapsing and swap settling belong to the system, so `POST …/swaps/{id}/lapse`, `…/swaps/{id}/settle` and `…/costs/{id}/lapse` are `409 invalid_transition`. A deleted draft answers 404.
- The creator made the request; the answerer is the other parent. Wrong role: `403 not_your_request` or `403 not_your_answer`.
- Creating needs an adopted plan (`409 no_adopted_plan`) and a joined other parent (`409 other_parent_not_joined`).
- At or after `answerBy`, an answer or withdrawal is `409 request_lapsed` even before the sweep, and reads already report `lapsed`. The screen writes `This request lapsed at <when>.`, also shown on the lapsed item.
- Two writes against one ETag give one success and one complete `412`.

**Stored moments.** `answerBy`, the reminder moment and invite expiry are stored when created, from the creating process's environment; sweeps act only on those stored moments, so processes with different durations agree. A cost's `answerBy` is `sentAt` plus `ANSWER_WINDOW_SECONDS`; a swap's is the earlier of that and the earliest first-night handover of its intervals. `answerZone` is the zone of the version in effect on the swap's first night or the cost's custody day. One reminder moment is `answerBy` minus `REMINDER_LEAD_SECONDS`, stored only if later than `sentAt`.

**Swaps.** `toParent` receives `nights`; the other parent is the giver. Every night must belong to the giver with accepted swaps counted and sent ones ignored, at create and send: `Every night in a swap must be with the parent giving it.` on `nights`. Each interval's first handover must be after the moment of sending: `The first night's handover has already passed.`

`makeupNights`, null or an interval, goes to the giver on acceptance. All its nights must belong to `toParent`. On that field, in this order: `Make-up nights must match the number of nights swapped.`, `Make-up nights can't overlap the nights swapped.`, `Take make-up nights within one year.` (more than 365 days between the end of the earlier interval and the first night of the later), `Every make-up night must be with the parent receiving the swap.` Both intervals are one claim: applied together on accept, or neither, across two year documents if needed.

**Overlap.** A send overlapping any night of a sent or accepted swap, in either interval on either side, is `409 swap_overlaps` with `conflictingRequestId`; the screen writes `Those nights are already in another request.` These sends are linearizable one-winner claims across every process. A draft holds no nights.

**Run limit.** Applied with accepted swaps over derived nights, across year and version boundaries, a swap is refused if any moved night sits in a same-owner run longer than the `maxConsecutiveNights` of the version in effect on that night. A run the plan alone creates, with no moved night, is never refused. Send: a 422 on `nights`. Accept: `409 swap_run_too_long`. Both read `That swap would keep the child with one parent for more than <n> nights in a row.`

**Accept recheck.** Accepting rechecks both intervals under the versions in effect now, with accepted swaps counted. A moved night is `409 swap_nights_changed`, the screen writing `Those nights changed when the plan was amended. This request can't be accepted.`; this comes before the run limit, the request stays `sent` and no entry is written. Accepts and adoptions in one household are linearizable across processes, so two accepts that together break the limit give one success, and an accept never commits on nights a concurrent adoption moved.

**Cost split.** A non-draft cost keeps the version in effect on its custody day when sent; a draft follows the current one. `splitBp` is `agreedSplitBp` when set, otherwise the version's. Shares use largest-remainder (Hamilton) allocation of `amountMinor` by `splitBp`, ties to the paying parent. A quote applies the same rule.

**Partial edits.** PATCH: absent means unchanged, null clears; null on a required field gets its message. The creator may change `description`, `category`, `amountMinor`, `incurredAt` and `note` on a draft. Either parent may change `agreedSplitBp` (two integers summing to 10000, or null, `The two shares must add up to 100%.`) on a draft or sent cost; any other state is `409 invalid_transition`. Any split change reallocates and gives a new ETag. Each PATCH writes `cost.edited`.

**Statement.** A read model updated in the same transaction as every cost state change, so commits on different processes never drift. `balance` nets `owedMinor` over accepted unsettled costs; null at zero. `years` totals accepted and settled costs by custody-day year. Rebuild recomputes from the costs alone and answers bytes identical to the `GET` before it, writing no entry.

**Amendments.** Adoption gives the next `number`. The first version may start on any date. A later `effectiveFrom` must be after today, checked at adoption only: `An amendment must start after today.` Adoption is `409 costs_logged_after_effective_date` while any non-draft cost has a custody day on or after it, with the screen writing `Costs are already sent on or after that date. Choose a later date.` In the adoption transaction every draft with a custody day on or after it takes the new `versionId`, split and ETag; `plan.adopted` covers this. Earlier nights and non-draft costs keep the earlier version on every surface. There is at most one draft; adopted versions are frozen.

**Sign-in limit.** Failures per email, known or unknown, in a sliding 60-second window shared by every process. At 5 failures inside the window, every attempt is `429 too_many_attempts`, right password or not, with `Retry-After` the remaining whole seconds rounded up, at least 1. The screen writes `Too many tries. Try again in <n> seconds.` A wrong email or password is `401 invalid_credentials`: `That email and password don't match.`

**Sessions and invites.** Signing out deletes the session server-side. `POST …/invite` after joining is `409 already_joined`. Each invite makes a new token and kills all earlier ones; a token works once until its stored expiry from `INVITE_TTL_SECONDS`. Simultaneous joins give one success. Dead tokens are `404 not_found`.

**Share links.** A token is 32 random bytes in base64url; `url` is `<APP_PUBLIC_URL>/share/<token>`. Regenerating kills the old token at once. At and after `expiresAt` the link is dead, comparing instants whatever offset was written.

**Background work.** Every process runs the notice relay, request sweep and year-record worker at least every 2 seconds. Work is claimed with row claims that skip rows locked elsewhere, each with a 30-second lease and fencing token; a worker whose lease was taken over cannot commit. A lapse, reminder or settlement is persisted within 5 seconds of its moment, with its entry and notices, exactly once across processes.

**Year records.** `POST …/records` pins the derived year at that moment: `yearDigest` is its digest and the PDF renders the pinned document. While one for that year is requested or rendering, another is `409 record_in_progress` with `recordId`: `A record for that year is already being made.`
- A claim moves it to `rendering` and runs three idempotent steps, committing `stepsDone` after each: render through Gotenberg, write to MinIO, read back and compare size and SHA-256. Only then is it `stored`. A stopped worker's record resumes on any process from the next step; `stepsDone` never decreases.
- An attempt that can't reach a service sets `waitingOn`, adds one to `attempts` and returns to `requested`, retried after 2 seconds; the failing process doesn't reclaim it for 6 seconds. Screen copy: `The PDF service is down. Your record is waiting and will retry.` or `Storage is down. Your record is waiting and will retry.` The third failed attempt makes it `failed`, naming the service; where every process fails, within 20 seconds of the request.
- `retry` on a failed record returns it to `requested` with `attempts` 0, keeping `stepsDone`. `cancel` on requested or rendering makes it `cancelled`. Elsewhere both are `409 invalid_transition`. A fenced worker can't store a cancelled record, and any object it wrote is removed within 5 seconds while storage is reachable. The PDF of an unstored record is `409 record_not_stored`.

**Notices.** A transactional outbox: each is written in the transaction of its state change, one per recipient. The relay hands it to SMTP, then marks it `sent`. A failed hand-off keeps it `queued`, adds one to `attempts` and retries after 2 seconds indefinitely, the failing process waiting 6 seconds. `mail` is `degraded` while the household's latest attempt failed, shown as `Email is down. Notices are queued and go out when it is back.` `Message-ID` is `<notice id>@twohouse.local`. A queued `invite` killed by a newer invite, or a queued `reminder` whose request is no longer `sent`, becomes `superseded` in that same transaction and never reaches SMTP. A refused action writes none.

**Record log.** Every state change writes exactly one entry in its transaction; `seq` runs 1, 2, 3 per household with no gaps, in commit order, across processes. `actor` is `planning`, `other` or `system`. Refused and replayed requests write nothing. Types: `household.created`, `household.joined`, `invite.sent`; `plan.draft_saved`, `plan.draft_deleted`, `plan.adopted`; `swap.` and `cost.` each with `drafted`, `deleted`, `sent`, `accepted`, `declined`, `withdrawn`, `reminded`, `lapsed`, `settled`; `cost.edited`; `receipt.stored`; `record.requested`, `record.stored`, `record.failed`, `record.retried`, `record.cancelled`; `share_link.created`, `share_link.regenerated`, `share_link.revoked`.

**Streams and resources.** An open stream closes within 3 seconds of its session ending on any process. After 200 streams open and abort, or ten closed mid-way, no app session stays active or idle in transaction beyond 5 connections over baseline within 5 seconds, and `/api/health` keeps answering within 1 second.

**Database.** When the database connection is cut the process stays up and answers `503 database_unavailable`, the screen writing `Couldn't reach the household data – try again`. The next request after recovery succeeds with no restart.

**Isolation.** Every id, in a path or body, is looked up inside the signed-in parent's household: households, versions, swaps, costs, nested receipts, records, share links. Share-link management is `403 planning_parent_only` for the other parent.

### Services (DP-04, DP-40, DP-41, DP-45, DP-46, DP-51, DP-63, DP-80, DP-91)

**Postgres** (`DATABASE_URL`) holds everything except stored objects. Schema and seed apply idempotently on every serve.

**Mailpit.** SMTP at `SMTP_HOST` and `SMTP_PORT`, no authentication, from `MAIL_FROM` (`Twohouse <notices@halfwayhollow.test>`), to the recipient's email. The plain-text body is `<household name>: open Twohouse to see the details.` and a line with one link under `APP_PUBLIC_URL`. No amounts, notes, reasons, night dates or the other parent's details.

| Kind | Recipients | Subject | Link |
|---|---|---|---|
| `invite` | other parent | `You're invited to <household name> on Twohouse` | `/join/<token>` |
| `request_sent` | answerer | `Swap request in <household name>` or `Reimbursement request in <household name>` | `/requests` |
| `reminder` | answerer | `Answer needed in <household name>` | `/requests` |
| `answered` | creator | `Your request was accepted in <household name>` or `Your request was declined in <household name>` | `/requests` |
| `lapsed` | both | `A request lapsed in <household name>` | `/requests` |
| `amendment` (version 2 on) | other parent | `Plan amendment recorded in <household name>` | `/plan` |
| `record_ready` | both | `Year record ready in <household name>` | `/records` |

While mail is unreachable, actions still succeed with their usual status and copy, and notices stay queued.

**MinIO** (`S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_FORCE_PATH_STYLE`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`), private bucket. Receipts live at `households/<household id>/receipts/<receipt id>`, records at `households/<household id>/records/<record id>.pdf`. An object counts as stored only after it is read back and its size and SHA-256 match. Downloads stream through the app.
- **Receipt type.** It comes only from leading bytes (JPEG FF D8 FF; PNG 89 50 4E 47 0D 0A 1A 0A; PDF `%PDF-`), never extension or `Content-Type`; it is stored and served as `image/jpeg`, `image/png` or `application/pdf`. Otherwise a 422 on `receipt`: `The file isn't a JPEG, PNG or PDF.` `filename` is 1 to 200 characters, percent-encoded in the query; the download has `Content-Disposition: attachment` with an ASCII `filename` and an RFC 5987 `filename*`, and strong ETag `"<sha256>"`. A sixth receipt is `409 receipt_limit`. Uploads are open to the creator while draft, sent or accepted.
- **Upload.** ETag and state are checked before writing. If the commit then loses, its object is removed; within 5 seconds of an upload settling, the prefix holds exactly one object per row, even when uploads and deletions race. So 8 parallel uploads under one ETag give one 201 and seven complete 412s.
- **Storage down on upload or download.** `503 storage_unavailable`, nothing recorded or logged, no key result stored; the screen writes `Couldn't reach storage – nothing was saved. Try again.`
- **Deleting a draft cost.** Its objects and rows go before the `204`, with one `cost.deleted`; the receipts then answer 404. If storage is unreachable at any point, `503 storage_unavailable`: draft, ETag and rows stay, nothing is logged, and the screen writes `Couldn't reach storage – nothing was deleted. Try again.` An already absent object counts as removed. Receipts of non-draft costs are kept.

**Gotenberg** (`GOTENBERG_URL`). The app posts one HTML file to Gotenberg's Chromium HTML route and keeps the PDF reply. It shows the pinned year as twelve month calendars with each night's parent name and colour, plus these lines, read at the render step, each on its own line:
- `Twohouse year record <year>`
- `<household name>`
- `Year digest <digest>`
- `Nights: <planning name> <n>, <other name> <n>`
- per accepted or settled swap with a night in the year: `Swap <first night> to <last night> with <to parent name>`, and for its make-up interval `Make-up <first night> to <last night> with <giver name>`, each night reading `<Ddd D Mon YYYY>`
- per accepted or settled cost with a custody day in the year: `<custody day> <description> <money> paid by <payer name>: <planning name> <money>, <other name> <money>`, the day reading `<Ddd D Mon YYYY>`

### Seed data (DP-01, DP-02, DP-11, DP-36, DP-55, DP-86)

Every person, household and address is invented. Passwords are as typed.

| Household | Id | Currency, zone | Planning parent | Other parent (joined) |
|---|---|---|---|---|
| `Maple & Fern` | `9007199254740993` | CAD, `America/St_Johns` | Robin Okafor, `robin@maple-fern.test`, `Hollow-Robin-2026` | Sam Lindqvist, `sam@maple-fern.test`, `Hollow-Sam-2026` |
| `Birch Lane` | `9007199254740995` | KWD, `Australia/Lord_Howe` | Kai Moreno, `kai@birch-lane.test`, `Hollow-Kai-2026` | Ari Moreno, `ari@birch-lane.test`, `Hollow-Ari-2026` |
| `Cedar Court` | `9007199254740997` | JPY, `Pacific/Pago_Pago` | Noor Haddad, `noor@cedar-court.test`, `Hollow-Noor-2026` | Tove Aalto, `tove@cedar-court.test`, `Hollow-Tove-2026` |

**Maple & Fern version 1 (adopted).** Effective `2026-01-01`, exchange 17:00 (`firstExchangeAt` as in The API), pattern `PPOOPPPPPOOOOO` anchored `2026-01-05`, split 6000/4000, no run limit. Rules in order: `easter`, `thanksgiving`, `xmas-eve` as in the shape above; `xmas-day`, Christmas Day, holiday, fixed 12-25, offset 0, 1 night, odd years planning, even years other; `winter-2026`, Winter break, school break `2026-12-19/2027-01-04`, halves, first half planning in odd years; `spring-2027` as above; `winter-2027`, Winter break 2027, school break `2027-12-18/2028-01-03`, halves, first half planning in odd years; `summer-2027` as above.

**Maple & Fern requests.**
- Swap `9007199254741031`: nights `2026-06-12/2026-06-14` to other, by Robin, `settled`.
- Cost `9007199254741021`: `School shoes`, `clothing`, `amountMinor` 4999, incurred `2026-09-02T18:00:00-02:30`, paid by Robin, `settled`.
- Cost `9007199254741022`: `Swim lessons term`, `activities`, 12501, incurred `2026-10-01T18:00:00-02:30`, paid by Sam, `accepted`.

**Birch Lane.** Version 1 (adopted): effective `2026-01-01`, `firstExchangeAt` `2026-01-01T18:00:00+11:00`, pattern `PPPPPPPOOOOOOO` anchored `2026-01-05`, split 5000/5000, no rules. Cost `9007199254741012`: `Piano lessons`, `activities`, 8000, incurred `2026-10-05T12:00:00+11:00`, paid by Kai, `accepted`.

**Cedar Court.** Version 1 (adopted): effective `2026-01-01`, `firstExchangeAt` `2026-01-01T09:00:00-11:00`, pattern `PPOO` anchored `2026-01-05`, split 3333/6667, no rules. Cost `9007199254741013`: `Uniforms`, `school`, 123456, incurred `2026-10-05T12:00:00-11:00`, paid by Noor, `accepted`.

No receipts, records, share links or notices are seeded. Each log holds `household.created`, `household.joined`, `plan.adopted`, then one entry per seeded request for the state shown. The statement matches the seeded costs.

## Technical requirements

### Deployment (DP-57)

TypeScript on Node.js 22. `/app/run.json` holds string commands `install`, `build`, `serve` and `"_schema":"run-manifest-v1"`:

```json
{"_schema":"run-manifest-v1","install":"npm ci","build":"npm run build","serve":"node dist/server.js"}
```

`serve` listens on `0.0.0.0` at port 4173, or `APP_PUBLIC_PORT` when set. `GET /api/health` answers HTTP 200 `{"status":"ok"}` once the schema is applied. The grader runs several processes on one database and restarts them, plus copies with a dependency pointed at an unreachable address, with shorter durations, or with their own empty database and bucket. Each behaves as this brief says.

### Configuration and secrets (DP-60)

Read at start: `DATABASE_URL`; `SMTP_HOST`, `SMTP_PORT`, `MAIL_FROM`; `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_FORCE_PATH_STYLE`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`; `GOTENBERG_URL`; `APP_PUBLIC_PORT`; `APP_PUBLIC_URL`, the origin for links and the Origin check, `http://localhost:<port>` when unset; and durations in seconds: `ANSWER_WINDOW_SECONDS` (default 172800), `REMINDER_LEAD_SECONDS` (default 21600), `INVITE_TTL_SECONDS` (default 604800). Those three are the only literal defaults. No credential is sent to the browser or logged.

### Server boundary (DP-54, DP-57, DP-92)

No CORS headers. Every POST, PUT, PATCH and DELETE under `/api` must carry an `Origin` equal to that of `APP_PUBLIC_URL`; missing or different is `403 origin_mismatch`. The server serves only built browser assets and page routes. These answer the not-found page with 404: `/run.json`, `/package.json`, `/.env`, anything under source folders, source maps. With Postgres unreachable at boot it retries every second and answers once connected. With Mailpit, MinIO or Gotenberg unreachable it starts normally, and those features recover with no restart.

### Browser support and performance (DP-58)

Current Chromium on desktop and touch emulation at 375x812, 768x1024 and 1280x800. The Calendar is usable within three seconds of navigation, `GET …/years/{year}` answers within one second, and the stage keeps up with continuous scrolling with no visible stalls.

## Working rules

- IF-01: `/app/run.json` exists and holds exactly the string fields `_schema` (`run-manifest-v1`), `install`, `build` and `serve`.
- IF-02: `/app/THIRD_PARTY_NOTICES.md` lists every shipped package with its licence, plus both typefaces with theirs; shipped packages means the production dependency tree, as `npm ls --omit=dev --all --json` reports it.
- IF-03: Every shipped package is licensed under MIT, ISC, BSD-2-Clause, BSD-3-Clause, Apache-2.0 or 0BSD, and fonts may also be under SIL OFL 1.1; nothing else is allowed, so MIT-0 and any LGPL build, wasm included, are out.
- IF-04: The app keeps state only in the provided Postgres and MinIO: no other database, cache, queue or on-disk state file.
- IF-05: All server, browser and script source is TypeScript with `strict` enabled in `tsconfig.json`.
- IF-06: The app serves its own fonts, scripts and styles, and at runtime contacts no host other than the four provided services.
- IF-07: The app loads the seed at serve time, idempotently, and the build step writes nothing to any service.

## Engineering standards

- The code is idiomatic strict TypeScript whose names use this brief's domain terms: household, plan version, night, custody day, handover, swap, make-up nights, cost, share, answer-by, statement, year record, notice.
- Each domain rule is decided in exactly one place: night ownership and precedence, today, custody day, the split, the run limit, request transitions, deadline checks, the error ladder; the browser shows the server's answers and holds no copy of these.
- One error builder, with one shape, produces every error path: each problem details status, the static 404 page and the 500 fault.
- Configuration is read only from the environment at start, and the only literal fallbacks are the three published durations.
- Money is integers throughout, with no floating-point amounts in server or browser code.
- There are no abstractions with a single implementation, no pass-through wrappers, and no checks for states that types or database constraints rule out.
- There is no dead, commented-out or unreachable code, and no feature, endpoint or screen beyond this brief.
- Each state change writes its rows, log entry, projection update and notices in one transaction.
