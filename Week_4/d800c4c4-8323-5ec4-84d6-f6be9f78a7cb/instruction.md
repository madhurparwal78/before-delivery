# Pegworth Desk

Pegworth Desk is the counter, catalogue and back office for a neighbourhood tool library. The library is a nonprofit storefront that lends drills, tile saws, ladders and multi-part kits to members a few days a week. One coordinator runs it, and volunteers take turns at the desk.

Members use it to:

- browse a live pegboard that shows what is on the wall;
- place holds;
- join on a sliding-scale annual membership;
- see their own loans, due dates, overdue charges so far and fees.

Desk volunteers check tools out and back in on a shadow board, where every part of a kit has its own traced outline. The coordinator sets opening days, fee rules and inventory, and decides damage disputes and waiver requests.

Build it as one web app backed by four services:

- **Postgres** is the system of record. It also holds user accounts and sessions; there is no outside sign-in provider.
- **Kill Bill** holds membership subscriptions, fee charges, payments and waiver credits.
- **S3-compatible object storage** keeps condition photos.
- **An SMTP mail sink** receives every email the app sends.

Out of scope:

- real card processing (payments are recorded in Kill Bill as external payments taken at the desk or online);
- editing membership tiers;
- rejoining after a membership lapses;
- more than one library;
- label printing and SMS;
- any datastore beyond these four services.

## Problem and users

Tool libraries lend hundreds of tools from a shop that opens only a few days a week. The people at the desk are volunteers on a rota, and most of them are new. Today's software was built for books or rentals, and it fails them in six ways:

- **Incomplete kits count as returned.** It marks a six-part kit "returned" while two parts are still missing.
- **Late fees use the wrong calendar.** It counts late fees on calendar days, but the library's rules count only the days the shop is open, so some desks work out fees by hand. It also mishandles time in several ways:
  - a drop-box return keyed in on a laptop set to another time zone lands on the wrong day;
  - a return dropped in during the hour that repeats when the clocks go back is read as the wrong hour;
  - a member's phone with a wrong clock shows an overdue figure the library never charges;
  - when the coordinator changes the fee or a tool's replacement cost, it re-prices loans taken out under the old terms.
- **Damage claims have no evidence.** Condition notes are kept on paper, so there is nothing to show when a member disputes a damage charge.
- **Payments are counted twice.** Fees and memberships are recorded in different places, so the treasurer counts them twice. A second click on a slow screen, or a retry after a crash, also records a payment twice.
- **Desks drift apart.** When two volunteers work at once, each screen drifts from the other. A closure declared in the office never reaches the volunteer holding that loan, and half-typed work vanishes when a screen refreshes.
- **Shared laptops stay signed in.** The counter laptop is left signed in between shifts. When the library's tool finally signs it out, it throws away whatever the next person had typed.

Coordinators pay high subscriptions and lose volunteer evenings fixing tallies and chasing parts. Members get wrong overdue charges and borrow kits that come back incomplete.

- **Coordinator** (daily): runs the inventory. Sets the time zone, opening hours, closures and fee rules on the Office screen, and changes an existing tool's replacement cost through the inventory API. Settles damage disputes and waiver requests, often from a phone.
- **Desk volunteer** (weekly): checks tools out and in during a shift at the counter. Often has a barcode scanner in one hand and works from the keyboard, sometimes on a phone with a keyboard attached. Records condition and missing kit parts quickly and correctly, often while a second volunteer works at another screen.
- **Member** (weekly): finds an available tool, places a hold, sees their loans, due dates and fees, and pays or asks for a waiver. Often does this on a phone at the shop door, and often arrives from a link in an email.

## Journeys

1. **Joining.**
   - A visitor opens the join page on a phone with a keyboard attached and uses only the keyboard. They pick a sliding-scale tier with the arrow keys, type their name, email and password, and press Enter.
   - They mistyped the email, so focus jumps to the problems summary. Its link takes them back to the field.
   - They press Enter again, and then twice more out of impatience while the join is pending. Only one join is sent, and Kill Bill records one payment.
   - They land on their account page, which shows the membership as pending payment. Within seconds it changes to active. The change is announced once, and the announcement stays on screen while the page keeps refreshing. The visitor can now place holds.
   - Later they open the cancel dialog and leave it open while they think. Tab stays inside it, Escape returns them to the button they came from, and the page's refresh never closes it.
   - They confirm. Focus lands on the membership heading, and the page shows the date their membership ends.
2. **Checkout and shadow-board check-in.**
   - In the morning a volunteer at the counter, on a phone with a keyboard attached, opens New loan. They type part of the member's name, arrow down to the right member and press Enter. Focus moves to the tag field. They scan the cordless drill kit's tag, mistype a second tag and see it refused under the field, then pick the checkout photo and press Enter on Check out.
   - Within a few seconds the back-room laptop's board shows the drill kit's outlines as dashed and out, while the scan its volunteer was typing stays in place.
   - At the same moment, the back-room laptop tries to lend the same kit to someone else. One desk gets the kit. On the other desk the dialog stays open with its photo and member, and focus goes back to Member.
   - Pressing Escape in a half-filled dialog asks before throwing the work away.
   - Days later the member brings the kit back. With the counter view open, the volunteer scans the kit's tag, and the loan opens with one tag card per part.
   - The volunteer hangs each part on its traced outline, by dragging it or with the keyboard. They grade each tool's condition, take a check-in photo and confirm.
   - The board shows solid outlines where the parts hang, the header count rises, and the result is announced.
3. **Partial kit return.**
   - A socket set comes back without two parts. The volunteer hangs four parts and confirms.
   - The two empty outlines stay dashed and are labelled missing. The loan is returned partial and the kit cannot be lent. A reload shows the same board.
   - Later the member drops off the two missing parts. A volunteer at the counter drags one onto its outline while a volunteer in the back room, on a phone, hangs the other with the keyboard, at the same moment.
   - Each screen announces only its own hang, and exactly one of them says the return is complete.
   - Within a few seconds both boards show the same counts. The next member in the hold queue has their account page open on a laptop. Within seconds it tells them, once, that their hold is ready, and they get one hold-ready email.
4. **Late return and fee.**
   - A member travelling with a phone set to another time zone, and a clock that is days off, opens their account. The overdue line on their loan shows the open days late and the late fee so far exactly as the library counts them. When the phone's date rolls over, nothing on the line changes.
   - The coordinator adds Monday opening hours for the winter. Within seconds the member's open overdue line counts the extra open days, without announcing anything.
   - The coordinator raises the late fee mid-season on the Office screen, and lowers a tool's replacement cost through the inventory API (`PATCH /api/items/<id>`; there is no screen for that step). Neither touches the member's loan.
   - A volunteer working on a laptop set to another time zone checks in overdue drop-box returns. They type each return time in library time.
   - One was dropped in during the hour that repeats when the clocks go back, so the volunteer ticks the box for the second time round. The server counts each return against the closing time, to the second, on the library's own calendar.
   - The library raises one itemised fee at the terms recorded on that loan, records it in Kill Bill and emails the member a receipt.
   - The member, signed out on their phone, opens the receipt's fee link, signs in and lands back on that fee page.
   - Billing is down, so Pay is refused. The refusal stays on screen, the button is ready again, and the banner appears.
   - When billing is back they press Pay on their phone and again on their laptop. The fee is settled with one payment.
5. **Damage dispute.**
   - A member disagrees with a damage fee. Using only the keyboard, they ask for a waiver and type a two-line reason. The page's refresh never clears it.
   - The coordinator opens the fee on a phone. The checkout and check-in photos are stacked there, and side by side on a laptop, each with its capture time and fingerprint. A loan from before photos shows an empty slot that says so.
   - With focus on Open original, they leave the page open across several refreshes. The photos never flicker or reload, and focus and scroll stay put.
   - They approve or decline from the keyboard. Approving clears the fee in Kill Bill with one credit, even if they click twice.
   - The member still has the fee page open with focus on Pay. Within seconds it shows the fee as waived, tells them so once, removes Pay and puts focus on the fee's heading.
6. **Storage outage on shift.**
   - Photo storage goes down mid-shift, and every desk screen shows the storage banner.
   - At the counter, a check-in is saved as pending photo and nothing is charged.
   - In the back room, the second volunteer was about to hang a part of the same loan. Their hang is refused and the card springs back. Within seconds their screen shows the loan as pending photo with its photo controls, and nothing they typed or picked is lost.
   - Finish check-in stays unavailable while storage is down. Within a few seconds of storage coming back it is ready on both desks, with each desk's picked photo still in place.
   - Both volunteers press Finish check-in at the same moment. One finishes it. The other is told it is no longer waiting, and that message replaces whatever their screen said before.
   - The bucket holds one photo. If the finish raised a fee, the member gets one receipt. Nobody restarts anything.
7. **Opening calendar.**
   - The coordinator declares the day before a holiday a closure, and loans due that day move to the next open day. A back-room volunteer has one of those loans open. Within seconds their desk shows the new due date and announces the move once, without losing the scan they were typing.
   - On a phone with a keyboard attached, each weekday is a stacked block with large controls. They tab through the weekdays, press Space to open Monday, and start shortening Thursday evenings. Then they pause while different Sunday hours are saved from another screen. The Office refresh shows the new Sunday hours and keeps the half-typed Thursday row.
   - They type a time that is not on the quarter hour and save. Focus jumps to the problems summary, which lists the problems in weekday order, and each link takes them to its field. They fix them and save.
   - Every loan due on a Thursday now shows the new closing time on the desk, including on a back-room desk where that loan is open, within seconds and without a reload. It also shows on the member's loan page. A return after that time counts as late. Fees already raised do not change.
   - Later they step away from the Office for longer than the idle time, with a closure reason half typed. When they press Declare closure they are told their session has ended. They follow the Sign in again link, sign in, and land back on the Office with the closure date and reason still typed in.
8. **Phone at the shop door and the hold queue.**
   - A member on a phone opens the pegboard and types "saw" into Find a tool. The table narrows as they type, and the match count is announced.
   - They tap the tile saw's row and read that it is out and how many people are queued (a count, never names). Then they place a hold.
   - Another member queues for the same tool from another device at the same moment. Each gets their own place in the queue, and a volunteer's desk showing that tool updates its queue count within seconds without losing the scan they were typing.
   - When the tool comes back, the first member in the queue cancels their ready hold. The next member, whose account page is open, is told once that their hold is ready.

## Mandatory requirements

This is the complete list of mandatory requirements; every check traces to one of these lines and the detailed sections below.

- **DP-01 — Sliding-scale join** A visitor joins by choosing one of the three published tiers, which creates their account and exactly one Kill Bill account, annual subscription and first-year payment for that email.
- **DP-02 — Active only once Kill Bill confirms** A new membership stays pending payment, and its member cannot place holds, until Kill Bill shows the subscription active and its first invoice paid, as qualified in Business rules.
- **DP-03 — Cancel at end of term** An active member can cancel at end of term and stays active until the billing end date Kill Bill reports, which the account page shows unchanged across refreshes and reloads.
- **DP-04 — Join journey** A visitor picks a tier, pays, watches the account page move from pending to active with a single announcement, and can then place a hold.
- **DP-05 — Hold queue** An active member places at most one hold per tool on a tool that is not available on the wall, joins the back of its queue, and can cancel the hold.
- **DP-06 — Hold-ready notice** When a returned tool is fully hung back, the first queued hold whose member is active becomes ready and that member gets exactly one hold-ready email, as qualified in Business rules.
- **DP-07 — Hold journey** A member finds a tool that is out, places a hold and sees their queue position, and a tool with no queue shows the published empty-queue line.
- **DP-08 — Reserve and check out** Desk staff reserve available tools for an active member and check the loan out with a condition photo, which sets its due date.
- **DP-09 — One winner per tool** When reservations or checkouts race for the same tool, or check-ins or finishes race for the same loan, exactly one succeeds across all app processes and the rest get the published conflict.
- **DP-10 — Checkout journey** A desk volunteer scans a member's tools into a new loan, takes the checkout photo, and sees those tools' outlines turn to dashed empties on the board.
- **DP-11 — Hanging parts on the board** During a check-in each part hangs only on its own outline, a wrong outline is refused with the published message, and a hung part can be taken down before confirming.
- **DP-12 — Check-in outcome** Confirming a check-in grades each tool and records the loan as returned complete when every part is hung, or as returned partial naming each unhung part.
- **DP-13 — Keyboard-only check-in** A desk volunteer can find a loan, hang every part, grade condition and confirm using only the keyboard, with the published shortcuts and a confirm dialog that keeps focus.
- **DP-14 — Announced check-in results** Every hang, refusal and check-in outcome, including any fee raised, is announced in the desk announcements region with the published copy.
- **DP-15 — Shadow-board hang motion** Dragging a tag card thickens, springs and fills its own outline with the published timings and snap radius, and springs back when dropped anywhere else.
- **DP-16 — Check-in journey** A volunteer scans a returned kit, hangs its parts, grades and photographs it and confirms, and the board, header counts and announcement show the result.
- **DP-17 — Late parts complete a return** Hanging the last missing part of a partially returned loan makes it returned complete exactly once and frees the tool for lending and holds.
- **DP-18 — Board counts match loans** The on-the-wall, out-on-loan and missing counts, on every read and in every hang response, equal the counts recomputed from every part's state.
- **DP-19 — Partial return journey** A volunteer confirms a kit with parts unhung, those outlines stay dashed and labelled missing after a reload, and a later hang completes the return.
- **DP-20 — Fee and inventory settings** The coordinator sets the library time zone, which every date and cutoff uses from then on, and the late fee per open day, damage fee, loan period and each tool's replacement cost, which apply to loans checked out from then on, and adds tools with their parts.
- **DP-21 — Open-day lateness** Lateness counts only open days after the due date in the library time zone, ignores closures, and treats a return by the closing time currently set for the due date's weekday as on time.
- **DP-22 — Exact fee lines** A check-in raises at most one fee whose lines are exact cents computed from the loan's recorded fee rules, with each tool's late fee capped at the replacement cost recorded for that tool at checkout, recorded once as Kill Bill charges on the member's account.
- **DP-23 — Late return journey** A volunteer checks in an overdue loan, and the member sees the itemised fee on their fee page with the same lines and total that Kill Bill holds.
- **DP-24 — Paying a fee** A member pays a raised fee, and it becomes settled only after Kill Bill records exactly one payment against its invoice, however often Pay is pressed.
- **DP-25 — Waiver decisions** A member requests a waiver with a reason, and the coordinator either declines it or approves it, which posts exactly one Kill Bill credit that clears the fee's invoice.
- **DP-26 — Fee receipt email** Once Kill Bill records a fee's charges, the member gets exactly one itemised receipt email.
- **DP-27 — Fee settlement journey** A member opens a raised fee from their account, pays it, and sees it settled on the fee page and account page.
- **DP-28 — Photos kept as submitted** Every checkout and check-in photo is stored byte for byte with its submitted type and capture time, and served back unchanged.
- **DP-29 — Members see only their own** A member's requests for any loan, fee, hold or photo that is not theirs answer not found.
- **DP-30 — Damage dispute journey** A member disputes a damage fee, and the coordinator compares the checkout and check-in photos with capture times and fingerprints before deciding.
- **DP-31 — Pending photo during a storage outage** When photo storage is down a check-in is held as pending photo with nothing charged, and it can be finished once storage is back without restarting the app.
- **DP-32 — Storage outage journey** During a storage outage every desk shows the published banner, a check-in becomes pending photo on both desks' screens, and a volunteer finishes it after storage returns.
- **DP-33 — Billing outage leaves nothing half-done** When Kill Bill is down, joins, payments, waiver approvals and fee-raising check-ins are refused with nothing created in Pegworth or Kill Bill while other desk work continues, as qualified in Services.
- **DP-34 — Due dates land on open days** A loan is due on the first open day on or after its checkout date plus the loan period in the library time zone, by the closing time currently set for that day's weekday.
- **DP-35 — Calendar changes move due dates** Declaring a closure or closing a weekday moves every out loan due on a day that is no longer open to the next open day.
- **DP-36 — Due-tomorrow reminders** Each out loan gets one reminder email on the calendar day before its due date in the library time zone, as qualified in Business rules.
- **DP-37 — Opening calendar journey** The coordinator declares a closure and shortens a weekday's hours, and sees the affected loans' due dates and closing times change on the desk and on the members' loan pages.
- **DP-38 — Published breakpoints** The desk and pegboard screens show three, two and one panes at the published widths in the published order, with no sideways scrolling.
- **DP-39 — Touch and reduced motion** On touch screens every board control is a comfortable tap target, and with reduced motion on, hanging a part fills its outline instantly with the same results.
- **DP-40 — Phone browse journey** A member on a phone at the shop door browses the pegboard, taps a tool that is out and places a hold.
- **DP-41 — Sign-in and roles** Coordinator, volunteers and members sign in with email and password, and each role reaches only its own screens and endpoints.
- **DP-42 — Health and run manifest** The app installs, builds and serves from its run manifest and answers the health check.
- **DP-43 — Server boundary** The server is same-origin only, enforces its body limits, never serves source or credentials, and starts and recovers when a provider is down.
- **DP-44 — Credentials from the environment** Every service URL and credential is read from the environment at start and is never hard-coded or sent to the browser.
- **DP-45 — Workshop look** Every screen sits on the kraft pegboard with heavy headings, ruled ledgers, and statuses shown as a word plus an outline shape.
- **DP-46 — Account page keeps what the member sees** On the account and fee pages, the page's own pending check and refresh never clear or repeat an announcement, close a dialog, move focus or discard typed text, and the pending check stops once the membership is active.
- **DP-47 — Last parts hung at two desks** When hangs of a returned-partial loan's last missing parts run at the same moment on different app processes, all succeed, exactly one response reports returned complete, and exactly one hold promotion and hold-ready email follow, as qualified in Business rules.
- **DP-48 — Fee rules fixed at checkout** Each loan records the late fee, damage fee and each tool's replacement cost in force when its checkout succeeds, and every fee line, cap and overdue figure for that loan uses them however the settings or tools change later.
- **DP-49 — Other desks follow in place** A loan status change or service-status change made elsewhere shows on every open Desk screen within the published delays, with no reload and without losing the scan text, focus, dialog, grades or picked photo there.
- **DP-50 — One Kill Bill write per fee and per join** Repeated or simultaneous pays, waiver approvals and joins across app processes produce exactly one Kill Bill payment, credit, or account with one subscription and first payment, reusing one that an earlier unfinished attempt left in Kill Bill, and the rest get the published conflict.
- **DP-51 — Hours edits change every due-by** Changing a still-open weekday's hours moves no loan but changes the closing time shown and enforced for every out loan due on that weekday, while raised fee lines and sent reminders stay as they were.
- **DP-52 — Keyboard-only join and cancel** A visitor joins using only the keyboard, and the cancel-membership dialog keeps Tab inside it, returns focus to its opener on Escape, and moves focus to the membership heading after a confirmed cancel.
- **DP-53 — Simultaneous holds** Simultaneous holds from one member on one tool give exactly one hold across all app processes, and simultaneous holds from different members get distinct, gap-free queue positions that renumber after any cancel.
- **DP-54 — Return-time edges in library time** The on-time cutoff is inclusive to the second at the closing time in library time for a return time sent in any offset, the desk's Return time is typed as library-local time whatever the browser's time zone, and the cap wording appears only when the late fee strictly exceeds the recorded replacement cost.
- **DP-55 — Keyboard-only fee settlement** A member pays a fee or requests a waiver, and the coordinator decides it, using only the keyboard, with Tab wrapping inside the waiver dialog and focus landing on the published control after each action.
- **DP-56 — Photo comparison at every width** On Fee and Loan pages the checkout and check-in photos sit side by side at 1280 and 768 and stack at 375, with scaled images, wrapping fingerprints, the published empty-slot copy and no sideways scrolling.
- **DP-57 — Rival desk wins honestly** A hang or confirm the server refuses because another desk changed the loan first leaves the board, counts and status as the server says, announces the refusal, and shows the loan's current controls within 2 seconds.
- **DP-58 — Office keeps unsaved edits** The Office's own refresh never discards hours, closure or fee-rule text edited since the last save, a validation message, an announcement or focus, while untouched hour rows pick up changes saved elsewhere.
- **DP-59 — Live tool filter** Typing in Find a tool filters the tools table in place on every input, announces the published match count, and keeps the filter through the pegboard's refresh.
- **DP-60 — Server-decided overdue line** Every loan read carries the open days late and late fee so far that the server decides from its own clock and the library time zone, and every overdue line on Account, Loan and Desk shows those values whatever the browser's clock or time zone, as qualified in Business rules.
- **DP-61 — Back to the record after sign-in** A visitor sent to sign in from a protected screen, or by a screen's Sign in again link, returns to that screen after signing in only when its path is the Pegboard or a published screen their role may use, and otherwise lands on their role's landing path.
- **DP-62 — Photo comparison survives refresh** On Loan and Fee pages the refresh never reloads or blanks a photo already shown, keeps focus and scroll position, and fills a newly stored check-in photo into its empty slot in place within 10 seconds.
- **DP-63 — Racing photo saves leave one object** Racing finishes, check-ins or checkouts of one loan across app processes leave exactly one photo object and photo record, and at most one fee and receipt, for that event, and a refused or losing request stores nothing.
- **DP-64 — Billing refusals stay on screen** After a billing-down refusal of Pay, Approve waiver or Cancel membership, the refusal copy, the re-enabled button, focus and any open dialog stay through every poll while the billing banner appears.
- **DP-65 — Opening hours on every width** The Opening hours table shows one aligned line per weekday at 768 and 1280 and a stacked block per weekday at 375 with 44-pixel controls, validation messages under the right field, and no sideways scrolling.
- **DP-66 — Keyboard join on a phone** At 375 by 812 and every other width a visitor completes the join by keyboard alone in the published Tab order, a refused join moves focus to the problems summary, and pressing Enter or the button again while the join is pending sends nothing more.
- **DP-67 — Join refusal order** A join request that breaks several rules at once gets the first refusal that applies in the published order: cross-site, content type, size, validation, email taken, then billing down.
- **DP-68 — Holds follow across desks and accounts** A hold placed or cancelled through any app process updates another Desk's Queued holds line within 10 seconds without moving its focus, and a member whose hold becomes ready while their Account page is open is told once.
- **DP-69 — New loan dialog keeps focus and contents** The New loan dialog keeps focus inside it starting on Member, asks before discarding entered work, returns focus to its opener, keeps its contents with focus on Member when a rival desk wins the tool, and fills a phone screen with 44-pixel controls.
- **DP-70 — Two desks finish a partial return** When one desk drags and another hangs by keyboard the last missing parts at once, each desk announces only its own hang, exactly one reports returned complete, both show the server's counts within 3 seconds, and under reduced motion the fills are instant.
- **DP-71 — Return times across the clock change** A return time in the hour the library's clocks repeat is read as the first occurrence unless the second is ticked, lateness and cutoffs use library wall-clock dates, and returned times are echoed in the offset in force at that instant.
- **DP-72 — Storage return reaches every desk** Every Desk with a pending-photo loan selected keeps Finish check-in disabled while its status reads storage down and enables it within 3 seconds of the status reading storage up, or of selecting the loan when it already does, keeping its picked photo and focus, and racing finishes give one success and one conflict whose announcement replaces the previous one.
- **DP-73 — Open desks follow hours edits** An hours change saved through any app process updates the due line of a selected loan on every open Desk within 10 seconds with no reload and no loss of focus.
- **DP-74 — Hours refusal order and quarter hours** Saving hours gets the first refusal that applies in the published order, and every opening and closing time must be on the quarter hour, with field errors listed in weekday and field order.
- **DP-75 — Keyboard checkout on a phone** At 375 by 812 and every other width a desk volunteer completes New loan by keyboard alone, picking the member from the filtered list with the arrow keys and Enter, adding tools by tag with Enter, picking the photo and checking out, with an unknown tag refused under its field.
- **DP-76 — Other desks see a checkout** A checkout made through any app process turns that loan's outlines to dashed out outlines on every other open Desk within 3 seconds, with no reload and no change to focus or scan text.
- **DP-77 — Loan request refusal order** A loan request that breaks several rules at once gets the first refusal that applies in the published order, with field errors listed as member, tools, then checked-out time.
- **DP-78 — Completed return reaches the waiting member** When two desks hang a partial loan's last missing parts at once on different app processes, the first active queued holder's open Account page on any process shows the hold ready within 10 seconds and announces it once, and exactly one hold-ready email is sent.
- **DP-79 — Keyboard finishing hang on a phone** At 375 by 812 a desk volunteer hangs a late part by keyboard alone with Space, the arrow keys and Enter, with the outline under the card kept in view, and focus moves to the next unhung card or back to the scan field.
- **DP-80 — Overdue line follows the server** Every open overdue line on Account, Loan and Desk changes in place within 10 seconds when the server's open days late or late fee so far changes, announces nothing, and never changes because the browser's clock or date moves.
- **DP-81 — Waiver reaches the member's open fee page** When the coordinator approves a waiver through any app process, the member's open Fee page shows the fee as waived within 10 seconds, announces it once, removes Pay, and moves focus from a removed button to the fee heading.
- **DP-82 — Desks follow a moved due date** When a closure or a closed weekday moves the due date of a loan selected on any open Desk, that Desk's due line shows the new date within 10 seconds and announces the move once, keeping focus and scan text.
- **DP-83 — Keyboard hours editor on a phone** The opening hours editor works by keyboard alone at every width, 375 by 812 included, in the published Tab order, with Space toggling a weekday and a refused save moving focus to the problems summary, whose links reach each field in weekday order.
- **DP-84 — Sessions end after idle time** A session ends after the idle time set by SESSION_IDLE_SECONDS, the next write answers the published 401, and signing in again from the screen's link returns to that screen with the typed text restored, as qualified in Business rules.
- **DP-85 — One refusal order for every write** Every write endpoint answers a request that breaks several rules at once with the first refusal in the one published order: cross-site, sign-in, unknown record, role, content type, size, validation, conflict, then provider down.

## Frontend

### Screens and layout (DP-04, DP-07, DP-10, DP-16, DP-19, DP-23, DP-27, DP-30, DP-32, DP-37, DP-38, DP-40, DP-41, DP-56, DP-61, DP-65, DP-66, DP-69, DP-73, DP-75, DP-79, DP-81, DP-83)

**Top bar.** Every screen has a top bar containing:

- the wordmark "Pegworth";
- the board-counts group;
- the links the signed-in role may use: "Pegboard" for everyone, "Account" for members, "Desk" for staff, and "Office" for the coordinator;
- "Sign in" or "Sign out".

Whenever the service-status banner has text, it sits directly under the top bar on every screen.

**Screens.**

| Screen | Path | Who | What it shows |
|---|---|---|---|
| Pegboard | `/` | anyone | The tool list, the pegboard and item detail. No member names. |
| Sign in | `/signin` | anyone not signed in | Email and password form |
| Join | `/join` | anyone not signed in | Tier picker and account form, in one column at every width |
| Account | `/account` | member | Membership panel, plus ruled tables of the member's loans, holds and fees |
| Loan | `/loans/<loan id>` | owning member, staff | Loan ref, status, the recorded fee rules, items with grades and recorded caps, parts with states, due date and closing time, the overdue line, the photo comparison, and a link to the loan's fee |
| Fee | `/fees/<fee id>` | owning member, staff | The fee heading, fee lines table, total, status, waiver state, and the loan's photo comparison |
| Desk | `/desk` | volunteer, coordinator | Counter view: loan queue, pegboard and item detail |
| Office | `/office` | coordinator | Sections headed "Fee rules", "Opening calendar", "Inventory", "Waiver requests" and "Fees" |
| Not found | any unknown path, or a record or screen the viewer may not see | anyone | Not-found heading and a link back to the pegboard |

**Landing paths and access.**

- **Landing paths.** The coordinator lands on `/office`, a volunteer on `/desk` and a member on `/account`. Joining goes to `/account`.
- **Signed in.** A signed-in user who opens `/signin` or `/join` is sent to their landing path. A user whose session has ended (see Business rules, Sessions) counts as signed out for every screen.
- **Signed out.** A signed-out visitor who opens `/account`, `/desk`, `/office`, `/loans/<id>` or `/fees/<id>` is sent to `/signin?next=<path>`.
  - `<path>` is the path they opened, percent-encoded so every `/` reads `%2F`. For example, `/fees/12` sends them to `/signin?next=%2Ffees%2F12`.
  - The top-bar link and "Sign in to place a hold" open `/signin` with no `next`. `link "Sign in again"` opens `/signin?next=<path>` for the screen it appears on (see Feedback states).
- **The sign-in form** never displays `next`. A refused sign-in leaves the address, including `next`, unchanged, so a later successful sign-in still honours it.
- **After a successful sign-in,** the browser goes to `next` only when every one of these holds for its decoded value:
  - it starts with exactly one `/`, and the character after it is neither `/` nor `\`;
  - it has no scheme, host, query string or fragment;
  - it is exactly `/` (the Pegboard), or exactly one of the five protected screen paths above, with `<id>` a whole number;
  - the signed-in role may use that screen: `/`, `/loans/<id>` and `/fees/<id>` for every role, `/account` for members, `/desk` for volunteers and the coordinator, and `/office` for the coordinator.

  Otherwise, including when there is no `next`, it goes to the role's landing path. For example, a member signing in with `next` set to `//evil.example/x`, `https://evil.example`, `/\evil.example` or `/office` lands on `/account`. A volunteer with `next` set to `/account` lands on `/desk`. A member whose session ended on the Pegboard and who follows `link "Sign in again"` (`/signin?next=%2F`) lands back on `/`.
- **Wrong role or wrong record.** A signed-in user who opens a screen their role may not use stays on that URL and sees the Not found screen. Examples: a member opening `/desk` or `/office`, a volunteer opening `/office` or `/account`, or the coordinator opening `/account`. The same applies to a loan or fee the user may not see, including one reached through `next`. A member whose `next` names another member's fee lands on that URL and sees Not found.

**Pane layout.** The Desk and Pegboard screens share a three-pane composition. The number of panes depends on the viewport width:

| Viewport width | Panes |
|---|---|
| below 700 pixels | one |
| 700 up to and including 1,099 pixels | two |
| 1,100 pixels and wider | three |

At the published viewports this gives:

- **1280×800: three panes side by side.** All three tops line up under the top bar.
  - Left, about a quarter of the width: the "Loan queue" region on Desk, or the "Tool list" region on Pegboard.
  - Middle: the "Pegboard" region.
  - Right, about a quarter of the width: the "Item detail" region.
- **768×1024: two columns.**
  - Left, about a third of the width: the loan queue or tool list.
  - Right: the pegboard, with item detail stacked directly below it.
- **375×812: one column, top to bottom.**
  - Desk: scan field, loan queue, pegboard, item detail.
  - Pegboard: pegboard, item detail, tool list.

At all three sizes nothing scrolls sideways at the page level. The pegboard is 10 holes wide, with holes 32 pixels apart, and it fits inside its pane at 375 wide. Rows grow downward as tools are added, with no maximum.

**Other screens.** Account, Loan, Fee and Office are single-column ruled ledgers at every width, and none of them scrolls sideways at any of the three sizes.

**Join at 375×812.**

- The tier radios, the three text fields and "Pay and join" stack in one column inside the viewport width.
- Each radio (with its hit area), each text field and the button measures at least 44 by 44 pixels.
- The page never scrolls sideways.

**New loan dialog.**

- **At 768×1024 and 1280×800,** the dialog is a centred sheet no wider than the viewport.
- **At 375×812,** it fills the whole viewport: its box starts at the top-left corner and is 375 pixels wide and 812 pixels tall. Its contents scroll up and down inside it, and nothing scrolls sideways. Every control in it measures at least 44 by 44 pixels, including:
  - `combobox "Member"` and each `option` of `listbox "Members"`;
  - each `button "Remove <tag>"`;
  - the buttons of the discard prompt.
- At every width, `listbox "Members"` opens directly under `combobox "Member"`, inside the dialog, and a field message for "Add tool by tag" sits directly under that field.

**Desk at 375×812 during a keyboard hang.** While a tag card is picked up, the outline it hovers over is scrolled into view inside the viewport, top to bottom and left to right, at every keyboard step.

**Opening hours (Office).** `table "Opening hours"` lists Monday to Sunday in that order at every width. It keeps its table and row roles; only the arrangement changes.

- **768×1024 and 1280×800:** each weekday is one line. Its `checkbox "Open on <weekday>"`, `textbox "<weekday> opens"` and `textbox "<weekday> closes"` sit left to right in that order, with tops within 2 pixels of each other.
- **375×812:** each weekday is a stacked block. The checkbox and the weekday name sit on the first line. Below them, opens is on the left and closes on the right, with tops within 2 pixels of each other.
- **Every width:**
  - each checkbox (its hit area included), each time field, `button "Save hours"`, `button "Declare closure"`, `textbox "Closure date"` and `textbox "Closure reason"` measure at least 44 by 44 pixels;
  - a Save hours field message sits directly below its own field (that weekday's opens or closes), horizontally inside the viewport;
  - the page never scrolls sideways.

**Fee heading.** The Fee page opens with `heading "Fee <fee id>"` above the fee lines, at every width.

**Photo comparison (Loan and Fee).** The Loan page shows the comparison once the loan is out or later. The Fee page always shows it. It has two slots: the checkout slot comes first and the check-in slot second.

Each slot holds, top to bottom:

1. the photo;
2. its capture line, its byte size and its 64-character SHA-256 in mono numerals;
3. `link "Open original"`, which opens that photo through the API.

Placement by width:

- **768×1024 and 1280×800:** the slots sit side by side. The checkout slot is the left column and the check-in slot the right column. Each column is at most half the content width, and the two tops line up within 2 pixels.
- **375×812:** the checkout slot stacks directly above the check-in slot, each at full content width.

Photo and text behaviour:

- **Scaling.** Each photo scales down to fit its column and keeps its aspect ratio. A photo larger than its column, such as a 3000×2000 upload, never widens the page.
- **Wrapping.** The SHA-256 and the capture line wrap inside their own column.
- **Empty slots.** A slot with no photo record keeps its column or position and shows its empty-slot copy from Feedback states in place of the photo. A lone check-in photo therefore stays in the right column, or in the lower position at 375.
- **No sideways scroll.** The page never scrolls sideways at any of the three sizes.

### Public screens and controls (DP-04, DP-05, DP-07, DP-08, DP-10, DP-11, DP-12, DP-13, DP-16, DP-20, DP-24, DP-25, DP-30, DP-31, DP-35, DP-37, DP-40, DP-41, DP-48, DP-51, DP-52, DP-53, DP-55, DP-56, DP-59, DP-60, DP-62, DP-65, DP-66, DP-68, DP-69, DP-71, DP-72, DP-73, DP-75, DP-81, DP-83, DP-84)

Only the controls and regions below are public. Tests and judges find them by ARIA role and accessible name, and everything else is up to you.

- In names, `<…>` stands for the record's value.
- `<date>`, `<due by>`, `<total>`, `<amount>`, `<cost>`, `<tag>` and `<n>` follow the placeholder formats in Feedback states.
- Weekday names in accessible names are capitalised, for example "Thursday".

| Where | Role and accessible name | Visible copy and notes |
|---|---|---|
| Every screen | `group "Board counts"` | Three labelled numerals: "On the wall <n>", "Out on loan <n>", "Missing <n>" |
| Every screen | `status "Service status"` | Shows the outage banners from Feedback states. Empty when all is well. |
| Every screen | `alert "Form problems"` | Error summary with one link per invalid field, in field order. There is exactly one in the page; while a dialog is open, it sits inside that dialog. It takes focus when told to but is not in the Tab order. |
| Desk, Office | `status "Desk announcements"` | Results of desk and office actions, and the due-date-moved news |
| Pegboard, Sign in, Join, Account, Loan, Fee | `status "Account updates"` | Results for members, visitors and staff on these screens, including the sign-in refusal, the tool filter count, hold-ready news and waiver news |
| Every screen with a write action | `link "Sign in again"` | Present only after a write on that screen is refused with the session-ended 401; it sits directly after the screen's announcement region and opens `/signin?next=<path>` for that screen |
| Sign in | `textbox "Email"`, `textbox "Password"`, `button "Sign in"` | |
| Join | `radiogroup "Membership tier"` with `radio "Pay what you can — $15.00 a year"`, `radio "Standard — $40.00 a year"` and `radio "Supporter — $75.00 a year"` | No tier is chosen when the page opens |
| Join | `textbox "Name"`, `textbox "Email"`, `textbox "Password"`, `button "Pay and join"` | |
| Account | `heading "Your membership"` | Takes focus when told to but is not in the Tab order. Next to it: the membership status word, the tier, and `Active until <date>` when the membership is ending, where `<date>` is `active_until`. |
| Account | `button "Cancel at end of term"` | Present only while the membership is active and `ends_at_term` is false |
| Account | `dialog "Cancel membership"` with `button "Confirm cancel"`, then `button "Keep membership"` | |
| Account | `table "Your loans"`, `table "Your holds"`, `table "Your fees"` | Each loan and fee row links to its page. Each unreturned loan row shows `Due <date> by <due by>`, followed for an overdue out loan by the overdue line. Each hold row shows the tool name and tag, the hold status word ("queued", "ready", "collected" or "cancelled"), and `position` while the hold is queued. |
| Account | `button "Cancel hold <item name>"` | One per queued or ready hold |
| Pegboard, Desk | `region "Pegboard"` | The SVG board |
| Pegboard, Desk | `button "<item name> — <part name>, <state word>"` | One per part outline. The state word comes from the outline mapping in Visual design. |
| Pegboard | `region "Tool list"`, `searchbox "Find a tool"`, `table "Tools"` | One row per tool showing tag, name and status word. When nothing matches, a single row with the no-match copy from Feedback states. |
| Pegboard, Desk | `region "Item detail"` | For a tool: name, tag, status, parts and their states, replacement cost, the due date when the tool is out, and either the queued-holds line or the empty-queue line from Feedback states. On Desk it also holds the selected loan's due line and the selected loan's controls listed below. |
| Pegboard | `button "Place hold"`, `link "Sign in to place a hold"` | |
| Desk | `searchbox "Scan or find a loan"` | Accepts an item tag, a loan ref or a member name |
| Desk | `region "Loan queue"` containing `list "Open loans"` | One `listitem` per reserved, out, pending-photo or returned-partial loan. Each shows the ref, the member name, the loan status word and, for out loans, `Due <date> by <due by>`, followed for an overdue out loan by the overdue line. |
| Desk, out or pending-photo loan selected | Due line in item detail | `Due <date> by <due by>`, followed for an overdue out loan by the overdue line |
| Desk | `button "New loan"`, `dialog "New loan"` | The dialog holds, in this order: `combobox "Member"`, `textbox "Add tool by tag"`, `list "Tools on this loan"` with one `button "Remove <tag>"` per tool, `button "Take or choose photo"`, `button "Check out"` and `button "Discard"`. The coordinator also sees `textbox "Checked out at"`, directly after the tools list. |
| Desk, New loan | `listbox "Members"` with one `option "<member name> (<email>)"` per matching member | Controlled by `combobox "Member"`; shown while the combobox has focus and its text matches at least one member |
| Desk | `alertdialog "Discard this loan?"` with `button "Keep editing"`, then `button "Discard loan"` | Text: `Discard this loan? The member, tools and photo you entered will be cleared.` |
| Desk, reserved loan selected | `button "Take or choose photo"`, `button "Check out <ref>"`, `button "Cancel loan <ref>"` | In item detail, in this order |
| Desk, out or returned-partial loan selected | `button "Tag card <part name>"` | In the loan pane, one per part of the selected loan that is not yet hung |
| Desk, out loan selected | `button "Take down <part name>"` | In item detail, for a part hung during the current check-in |
| Desk, out loan selected | `radiogroup "Condition of <item name>"` with `radio "Good"`, `radio "Worn"` and `radio "Damaged"` | One group per item on the loan |
| Desk, out loan selected | `button "Take or choose photo"`, `textbox "Return time"` | The photo button opens the camera or file chooser and shows a thumbnail once a photo is picked. Return time is optional and takes library-local `YYYY-MM-DD HH:MM`. Empty means now; it is used for drop-box returns. |
| Desk, out loan selected | `checkbox "Second <h> o'clock hour (<zone>)"` | Directly after Return time, present only while the Return time text names a repeated wall-clock time (see Interactions). With the seed data at start, its name for `2026-11-01 01:30` is `Second 1 o'clock hour (CST)`. |
| Desk, out loan selected | `button "Confirm check-in"`, `dialog "Confirm check-in"` with `button "Confirm"` and `button "Back"` | The dialog lists the hung parts, the parts that will be missing, and the grades |
| Desk, pending-photo loan selected | `button "Take or choose photo"`, `button "Finish check-in"` | In item detail, in this order. Finish check-in is disabled while the service status reports storage down. |
| Loan | Recorded fee rules line | `Late fee $<late fee> per open day, damage fee $<damage fee>` in mono numerals, from the loan's `fee_rules` in dollars with two decimals. Absent while the loan is reserved. |
| Loan | Item rows | Each item row shows its name, tag, grade and `Cap $<cost>` in mono numerals. The cap is absent while the loan is reserved. |
| Loan | Due line | `Due <date> by <due by>`, followed for an overdue out loan by the overdue line |
| Fee | `heading "Fee <fee id>"` | Takes focus when told to but is not in the Tab order. Next to it: the fee status word and its stamp shape. |
| Fee | `table "Fee lines"` | Takes focus when told to but is not in the Tab order |
| Fee (owning member, fee raised) | `button "Pay $<total>"`, `button "Request a waiver"` | "Request a waiver" is present only while no waiver is requested. Both are absent once the fee is settled or waived. |
| Fee | `dialog "Request a waiver"` with `textbox "Reason"`, then `button "Send request"` | Reason is multi-line |
| Fee, Loan | `img "Checkout photo, captured <time>"`, `img "Check-in photo, captured <time>"`, `link "Open original"` | `<time>` is the capture time in library time as `YYYY-MM-DD HH:MM`. The byte size and SHA-256 show under each photo in mono numerals. |
| Fee (coordinator) | `button "Approve waiver"`, `button "Decline waiver"` | Present only while a waiver is requested on a raised fee |
| Office | `region "Fee rules"` with `textbox "Late fee per open day"`, `textbox "Damage fee"`, `textbox "Loan period in days"`, `combobox "Time zone"` and `button "Save fee rules"` | Money in dollars with two decimals |
| Office | `table "Opening hours"` with one row per weekday, and `button "Save hours"` | Each row has `checkbox "Open on <weekday>"`, `textbox "<weekday> opens"` and `textbox "<weekday> closes"` |
| Office | `textbox "Closure date"`, `textbox "Closure reason"`, `button "Declare closure"`, `table "Closures"` | |
| Office | `region "Inventory"` with `button "Add tool"` and `dialog "Add tool"` | There is no screen control for editing an existing tool. A tool's name or replacement cost changes through `PATCH /api/items/<id>` only, and building such a control is not required. |
| Office | `table "Waiver requests"` | Each row links to its fee |
| Not found | `heading` with the not-found copy | |

Dates on every screen are library-local `YYYY-MM-DD`. Times are 24-hour `HH:MM`. Both are set in mono numerals.

### Interactions (DP-07, DP-10, DP-11, DP-13, DP-16, DP-19, DP-39, DP-40, DP-52, DP-54, DP-55, DP-58, DP-59, DP-61, DP-66, DP-69, DP-70, DP-71, DP-75, DP-79, DP-83, DP-84)

**Board order.** Part outlines are ordered by their top row, then by their left column. No two parts share a top-left hole.

**Signing in from the keyboard.** Tab order on Sign in is Email, Password, then "Sign in". Enter in either field submits. Where the browser goes afterwards follows "Landing paths and access".

**Join from the keyboard.** The order and keys are the same at every width, 375×812 included.

- **Tab order.** `radiogroup "Membership tier"` (a single Tab stop), then Name, Email, Password and `button "Pay and join"`. Shift+Tab walks back through the same stops.
- **Picking a tier.** Tabbing into the group lands on the first radio while none is chosen, or on the chosen one otherwise. Space chooses the focused radio. Arrow keys move between the three radios and choose the one they land on, wrapping at both ends.
- **Submitting.** Enter in Name, Email or Password submits the form, exactly like pressing "Pay and join".
- **One request at a time.** While a join is pending, pressing Enter in any join field, or activating "Pay and join" by Enter, Space, click or tap, sends nothing more. A single press therefore produces a single join request, however many times the keys are pressed before the answer.
- **Problems.** A refused join (422) shows the form-problems summary and moves focus to it. Each of its links moves focus to its field. A missing tier links to the radio group.

**Cancelling a membership.**

- `button "Cancel at end of term"` opens `dialog "Cancel membership"`, and focus starts on "Confirm cancel".
- "Keep membership" or Escape closes the dialog with nothing sent, and focus returns to "Cancel at end of term".
- After a successful "Confirm cancel":
  - the dialog closes;
  - "Cancel at end of term" is removed;
  - focus moves to `heading "Your membership"`.
- A refused cancel keeps the dialog open, with focus on "Confirm cancel". The session-ended 401 is the exception, under "Session ended" below.

**Desk scan field.** The scan field has focus when Desk loads. A scanner types into it and presses Enter. You can also type a tag, a loan ref or a member name.

- **A loan's ref, or the tag of an item on an unreturned loan,** selects that loan. Focus then moves according to the loan's status:
  - out or returned-partial: the loan pane shows its tag cards in board order, and focus moves to the first tag card. If an out loan has no unhung parts, focus moves to the first condition radio group instead.
  - reserved or pending-photo: focus moves to the loan's "Take or choose photo" button in item detail.
- **The tag of an item that is on the wall, or held for a member,** opens the New loan dialog with that tool already listed.
- **A member name** filters the open loans list. With focus in the list, Up and Down move between loans, and Enter selects one. Focus then moves by the same rule as above.
- **Selecting a tool.** Clicking, tapping or pressing Enter on an outline whose tool is on no unreturned loan selects that tool in item detail.

**New loan.** Every step works by keyboard alone at every width, 375×812 included. The Tab order is the dialog's control order in the controls table.

1. **Member.** Focus starts on `combobox "Member"`.
   - Typing filters `listbox "Members"` to members whose name or email contains the typed text, ignoring letter case, in name order. The list shows while the combobox has focus and at least one member matches.
   - ArrowDown opens the list if it is closed, and otherwise makes the next option active. ArrowUp makes the previous option active. Both wrap at the ends. The combobox's `aria-activedescendant` names the active option, and the active option is visibly marked; focus stays in the combobox.
   - Enter, or a click or tap on an option, picks it: the combobox shows the member's name, the list closes, and focus moves to `textbox "Add tool by tag"`.
   - Escape while the list is open closes only the list. The dialog stays open.
2. **Tools.** Type or scan a tag into "Add tool by tag" and press Enter. Tags match ignoring letter case.
   - A tag of a tool on the board joins "Tools on this loan" with its `button "Remove <tag>"`. The field empties and keeps focus.
   - A tag that matches no tool, or one already on this loan, stays in the field with focus. Its field message from Feedback states shows directly under the field. The next keystroke in the field clears the message.
   - Enter in an empty field does nothing.
   - Whether a listed tool may be lent is decided by the reservation, not by this field.
3. **Photo.** Tab reaches `button "Take or choose photo"`; Enter or Space on it opens the camera or file chooser.
4. **Check out.** Enter or Space on `button "Check out"` makes two requests in turn: it reserves the loan, then checks it out.

The dialog **has entries** while it holds a chosen member, any tool (a tool listed by the scan counts) or a picked photo.

**Leaving the dialog.**

- **No entries:** Escape or `button "Discard"` closes it at once.
- **With entries:** Escape or "Discard" opens `alertdialog "Discard this loan?"` on top, with focus on "Keep editing".
  - "Keep editing", or Escape in the prompt, closes the prompt. Focus returns to the New loan control that had focus before, and every entry is kept.
  - "Discard loan" closes both and creates nothing.
- **Focus on close.** Whenever the New loan dialog closes without a loan going out, focus returns to its opener: `button "New loan"`, or the scan field when a scan opened it.

**When something goes wrong.**

- **Missing entries.** If the member, a tool or the photo is missing, nothing is sent. The form-problems summary inside the dialog appears and takes focus.
- **Reservation refused (409).** Nothing is created. The dialog stays open with its member, tools and picked photo exactly as they were. The 409 text is announced, and focus moves to `combobox "Member"`. This is what the losing desk sees when another desk's reservation of the same tool wins.
- **Reservation refused (422).** The dialog stays open with its contents, and its summary takes focus.
- **Reservation succeeds but checkout is refused.** The dialog closes and the reserved loan stays selected in the queue, with the picked photo kept. Focus moves to `button "Check out <ref>"`.

A reservation's tools cannot be changed. To change them, cancel the reserved loan with `button "Cancel loan <ref>"` and start again.

**Checking out a reserved loan.** Select the reserved loan in the queue, pick a photo with "Take or choose photo", and activate `button "Check out <ref>"`.

**Hanging by pointer or touch.** Press on a tag card and drag it toward the board. All closeness is measured from the pointer position, not from the card's edges. A release is decided by the first of these that applies:

1. **Within the snap radius of the part's own outline,** meaning inside the outline or within the distance in Motion and effects of its edge. While the pointer is there, the outline thickens. Releasing hangs the part, even when the pointer is also over a neighbouring outline.
2. **Inside another part's outline.** Releasing is refused, and the card springs back.
3. **Anywhere else.** Releasing springs the card back, with no message.

On touch, tapping a card and then tapping an outline counts as a release with the pointer at the tapped point. Every release on an outline sends a hang request naming the outline it landed on. The refusal, and the board's change, come only from the server's answer.

**Hanging by keyboard.** These keys work the same at every width, 375×812 included.

- Tab reaches the tag cards in board order. Space or Enter on a card picks it up, and it starts over its own part's outline.
- While the card is picked up, Right or Down moves it to the next outline in board order, and Left or Up moves it to the previous one. The arrows cycle through every part outline on the board, of every item and in any state, and wrap at both ends.
- The card visibly hovers over the outline it is on, and that outline has a visible focus ring. At 375×812 that outline is kept in view as set out in Screens and layout.
- Enter drops the card on that outline. Escape puts it back and leaves focus on the card.
- After a hang, focus moves to the next unhung card. When no cards are left, focus moves to the first condition radio group on an out loan, or back to the scan field on a returned-partial loan.

**Taking down.** During the current check-in, activating a hung part's outline selects that part in item detail, which then shows `button "Take down <part name>"`. Activating that button puts the part's card back in the loan pane.

**Grading and photo.**

- Arrow keys move within each condition group.
- The photo button opens the device camera on phones and the file chooser elsewhere. Every `button "Take or choose photo"` controls its own `<input type="file" accept="image/*">`, which stays in the page while the button is shown and whose `id` the button names in `aria-controls`; picking a file in that input is the same as choosing it through the button. The browser sends the file's last-modified time as the capture time.

**Return time.** Return time is read as library-local wall-clock time, whatever time zone the browser is set to. The browser sends it as ISO 8601 with the library time zone's offset for that local date and time.

- **A wall-clock time that happens once** is sent with its only offset. For example, `2026-10-22 20:00` is sent as `2026-10-22T20:00:00-05:00`.
- **A repeated wall-clock time** is one that happens twice because the clocks go back. While the text names such a time, `checkbox "Second <h> o'clock hour (<zone>)"` appears directly after Return time, unticked. `<h>` is the typed hour without a leading zero. `<zone>` is the library time zone's abbreviation for the later offset.
  - Unticked, the text is sent with the earlier occurrence's offset. Ticked, it is sent with the later one's. For example, with the seed data at start, `2026-11-01 01:30` is sent as `2026-11-01T01:30:00-05:00`, or as `2026-11-01T01:30:00-06:00` when ticked.
  - The checkbox is removed, and forgets its tick, as soon as the text names a time that is not repeated.
- **A wall-clock time that never happens** is one skipped when the clocks go forward. It is a problem field, like malformed text (see Confirming).

**Confirming.**

- `button "Confirm check-in"` opens `dialog "Confirm check-in"`.
- Ctrl+Enter, or Cmd+Enter on a Mac, also opens the dialog while an out loan is selected. This works with focus on any control on Desk, including text fields and the scan field.
- The dialog does not open if any of these is missing or wrong:
  - a condition group with no grade;
  - no picked photo;
  - Return time text that is not empty and not `YYYY-MM-DD HH:MM`;
  - Return time text naming a skipped wall-clock time.

  Instead, the form-problems summary appears with links to each problem field and takes focus.
- After a successful Confirm, the dialog closes and focus moves to the scan field.

**Shortcuts.** `/` moves focus to the scan field from any control on Desk except a text field.

**Dialogs.** These rules apply in every dialog: New loan, the discard prompt, Confirm check-in, Cancel membership, Request a waiver and Add tool.

- **Starting focus.** Focus starts on the first control: "Member" in New loan, "Keep editing" in the discard prompt, "Confirm" in Confirm check-in, "Confirm cancel" in Cancel membership, and Reason in Request a waiver.
- **Tab wraps.** Tab from the last control wraps to the first, and Shift+Tab from the first wraps to the last. Focus never leaves an open dialog, including when the page's refresh or any poll runs. While the discard prompt is open, Tab stays inside the prompt.
- **Escape.** Escape closes the dialog without acting. New loan with entries, and New loan with its member list open, are the exceptions described above.
- **Focus on close.** Closing returns focus to the control that opened the dialog, or to the control that had focus when the shortcut was pressed, except in these published cases:

  | Case | Focus moves to |
  |---|---|
  | New loan, reservation succeeded but checkout refused | `button "Check out <ref>"` |
  | New loan, checkout succeeded | the scan field |
  | Confirm check-in succeeded | the scan field |
  | Confirm check-in refused with a 409 | the first control of the loan's new item detail |
  | Cancel membership confirmed | `heading "Your membership"` |
  | Request a waiver sent | `button "Pay $<total>"` |
  | Any dialog's write refused with the session-ended 401 | `link "Sign in again"` |

- **Refusals inside a dialog.** A 422, 409 or 503 inside New loan, Cancel membership or Request a waiver keeps the dialog open with its contents.
  - A 422 moves focus to the summary inside the dialog.
  - A 409 or 503 moves focus to Reason in Request a waiver, to "Confirm cancel" in Cancel membership, and to Member in New loan.

**422 focus everywhere.** Outside dialogs, every 422 and every refused client-side check moves focus to `alert "Form problems"`. The wrong-peg refusal and the "Add tool by tag" field message are the exceptions, set out under Feedback states and New loan.

**Paying and waivers from the keyboard.**

- On `/fees/<id>`, Tab reaches "Pay $<total>" and "Request a waiver". Enter on either activates it.
- In `textbox "Reason"`, Enter inserts a new line. Only "Send request" sends.
- **After a successful pay,** both buttons are removed and focus moves to `table "Fee lines"`.
- **After a refused pay,** the button stays, and focus stays on it.
- **The coordinator** reaches "Approve waiver" and "Decline waiver" by Tab. After either decision succeeds, both buttons are removed and focus moves to `table "Fee lines"`. After a refused decision, both buttons stay, and focus stays on the one pressed.
- **Changes from elsewhere.** When a refresh removes "Pay $<total>" or "Request a waiver" because the fee changed elsewhere, and the removed button had focus, focus moves to `heading "Fee <fee id>"`.

**Office editing.**

- Coordinators type hours, closure details and fee rules directly into their fields.
- A row of `table "Opening hours"` counts as edited from the first change to any of its three controls until a Save hours that the server accepts.
- A Fee rules field or closure field counts as edited from its first change until its own save succeeds.
- A refused save leaves those fields edited.

**Opening hours from the keyboard.** The keys and order are the same at every width, 375×812 included.

- **Tab order.** For each weekday from Monday to Sunday: `checkbox "Open on <weekday>"`, then `textbox "<weekday> opens"`, then `textbox "<weekday> closes"`. Then `button "Save hours"`.
- **Toggling a weekday.** Space on a checkbox toggles it. While a weekday is unticked, its opens and closes fields stay in place showing their last text, are disabled, and are skipped by Tab. Ticking it enables them again.
- **Saving.** Enter in any opens or closes field saves hours, exactly like pressing "Save hours". Unticked weekdays are left out of the request.
- **Problems.** A refused save (422) shows the form-problems summary and moves focus to it. Its links follow the 422's field order, weekday by weekday, and each link moves focus to its field.

**Pegboard (public).**

- **Selecting a tool.** Clicking or tapping an outline, or pressing Enter on it, selects its tool and fills item detail.
- **Filtering.** Typing in `searchbox "Find a tool"` filters `table "Tools"` on every keystroke, with no submit and no page navigation.
  - A row stays when the typed text appears anywhere in its tag or name, ignoring letter case. For example, with the seed data at start, `saw` keeps PW-102 Tile saw and PW-112 Jigsaw kit.
  - Clearing the box restores every row.
- **Choosing a row.** Choosing a row, filtered or not, selects that tool's outlines on the board and fills item detail.
- **At 375 wide,** selecting a tool either way scrolls item detail into view.
- **Holds.** "Place hold" shows only to an active signed-in member, and only for a tool they may hold. Anyone else sees "Sign in to place a hold" or the membership message from Feedback states.

**Session ended.** When any write on a screen is refused with the session-ended 401 (see API):

- The screen's announcement region shows that 401 text, and `link "Sign in again"` appears directly after the region.
- An open dialog closes without acting, and focus moves to `link "Sign in again"`. Outside a dialog, focus also moves to that link.
- Nothing else on the screen is cleared: typed text, Office rows and checkboxes, the tool filter and the scan field all stay as they were.
- **The draft.** At that moment the screen keeps a draft for this browser tab only, in the browser's session storage, labelled with the screen's path and the signed-in user. The draft holds:
  - the text of every `textbox` and `searchbox` outside a dialog that was typed into since the screen loaded, including the scan field, Find a tool, Return time, the Fee rules fields and the closure fields;
  - every row of `table "Opening hours"` that counts as edited, with its checkbox;
  - when the refused write came from `dialog "Request a waiver"`, its Reason text;
  - on Desk, the id of the selected loan, if any;
  - on Desk and Pegboard, the board's selected tool, if any.

  Picked photos, grades, a picked-up card and New loan's contents are not kept.
- **Back from sign-in.** When "Sign in again" leads to a successful sign-in by the same user and the browser lands back on the same path, the screen restores the draft once:
  - first, the kept selected tool is selected again, and on Desk the kept loan is selected again if it is still in `list "Open loans"`. Reselecting from a draft makes none of the focus moves that selecting a loan normally makes: focus stays where the screen's load put it, which on Desk is the scan field. A kept loan that is no longer in the list is not reselected;
  - each kept field shows its kept text, and kept Office rows and fields count as edited. Kept Return time text is restored only when the reselected loan is still `out`; otherwise it is dropped;
  - a kept Reason reopens `dialog "Request a waiver"` with that text and focus in Reason;
  - nothing is sent until the user acts.

  The draft is then deleted. It is also deleted, unused, when a different user signs in, or when sign-in lands on another path.
- **Background reads.** A refresh or poll answered with a 401 changes nothing on the screen and writes no announcement.

**Live updates.** Screens refresh themselves and follow other desks as set out under "Live updates and refreshes" in Feedback states.

### Visual design (DP-45)

**Colour.**

- **Ground.** A warm kraft-paper tan sits behind every screen.
- **Ink.** Text and lines are a near-black, warm ink.
- **Accent.** A burnt orange fills primary buttons, which carry white text, and marks the snap highlight. Never use it for small text on kraft.
- **Olive-grey.** Draws the 1-pixel ruled table lines, the pegboard holes and the empty outlines. Use it only for lines and large text, never for body text.
- **Workshop green.** A deep green marks settled and complete states.
- **Contrast.** Text meets WCAG 2.2 AA, at least 4.5 to 1 for body text. Non-text outlines and focus rings reach at least 3 to 1 against the kraft.

**Statuses.** A status is never shown by colour alone. It is always a word plus an outline shape:

| Status word | Shape |
|---|---|
| "on the wall" | solid filled silhouette |
| "out" | dashed outline |
| "missing" | dashed outline with a small cross at its corner and the word "missing" inside |
| "pending photo" | dotted outline |
| "reserved" | outline with a single notch |
| "held" | double outline |
| "incomplete" | half-filled outline |
| "settled" | solid stamp box |
| "raised" | open stamp box |
| "waived" | struck-through stamp box |

**Where each word appears.**

- **Tools** (rows in `table "Tools"` and the status in item detail) use the item's status:

  | Item status | Word |
  |---|---|
  | `on-wall` | "on the wall" |
  | `reserved` | "reserved" |
  | `out` | "out" |
  | `pending-photo` | "pending photo" |
  | `incomplete` | "incomplete" |
  | `held` | "held" |

- **Loans** (list items in `list "Open loans"`) use the loan's status:

  | Loan status | Word |
  |---|---|
  | `reserved` | "reserved" |
  | `out` | "out" |
  | `pending-photo` | "pending photo" |
  | `returned-partial` | "incomplete" |

- **Fees** use "raised", "settled" and "waived", on the Fee page next to its heading, on Account, and in Office.
- **Part outlines.** The state word at the end of an outline's accessible name, and the outline's shape, come from the part's state and its tool's status. The first matching row wins:

  | Part state | Tool status | State word | Example accessible name |
  |---|---|---|---|
  | `missing` | any | "missing" | `Socket set kit — Spark plug socket, missing` |
  | `out` | `pending-photo` | "pending photo" | `Pressure washer kit — Hose, pending photo` |
  | `out` | any other | "out" | `Tile saw — Tile saw, out` |
  | `hung` | `reserved` | "reserved" | `Claw hammer — Claw hammer, reserved` |
  | `hung` | `held` | "held" | `Tile saw — Tile saw, held` |
  | `hung` | any other: `on-wall`, `out` (a part hung during the current check-in), `pending-photo` or `incomplete` | "on the wall" | `Step ladder — Step ladder, on the wall` |

  An outline never reads "incomplete": an incomplete tool's hung parts read "on the wall" and its missing parts read "missing".

  With the seed data at start, every outline reads "on the wall" or "out". The other examples appear after the matching actions. For example, the Spark plug socket reads "missing" after L-0003 is checked in without it.

**Type.**

- Headings use Archivo Black, a heavy grotesque. Each heading level is about a third larger than the level below it.
- Body text uses IBM Plex Sans.
- Every numeral in ledgers, counts, dates, money, byte sizes, caps and fingerprints uses IBM Plex Mono, so columns line up.

**Density.** The layout is compact: tight ledger rows with 1-pixel rules, and narrow gutters between panes.

**Composition.**

- A perforated pegboard, drawn in SVG with holes 32 pixels apart, anchors every screen. On Desk and Pegboard it is the working board; the other screens open with a strip of it.
- Tools hang on that grid as traced silhouettes. Each silhouette is drawn from its part's shape kind and its size in holes, not from image files.
- Icons come from a single line-icon set, all at one stroke weight.

**Touch.** Every control, every table row link, every listbox option and every part outline is at least 44 by 44 pixels. The smallest outline, 2 by 2 holes, meets this.

### Motion and effects (DP-15, DP-39, DP-57, DP-70)

**Snap.** The snap radius is 24 pixels. While the pointer is inside the part's own outline, or within 24 pixels of its edge, that outline thickens over 0.1 to 0.2 seconds. It thins again when the pointer leaves that area.

**Hang.** A part hangs only once the server has answered 200. Then, at the same time:

- The silhouette springs onto its peg and settles within 0.3 to 0.45 seconds, with one small overshoot and no visible bounce after it.
- The outline turns from dashed to a solid ink fill over 0.18 to 0.26 seconds, quick at first and then gentle.
- The "On the wall" numeral counts up to its new value within 0.26 seconds.

While the hang request is in flight, the card waits over the outline and nothing on the board fills or counts.

**Refusal or miss.** A refused or missed drop springs the card back to where it started within 0.3 to 0.45 seconds. The outline it landed on keeps its state, and no numeral moves.

**Other motion.**

- A picked-up card glides between outlines in under 0.2 seconds per keyboard step.
- Dialogs, including the discard prompt, fade and rise into place in under 0.2 seconds, and leave in under 0.15 seconds. The member list under the combobox appears and closes at once.
- A pending button shows a static pressed look, not a spinning loop.
- A refresh, a poll, a filter, a newly arrived photo or another desk's change updates outlines, rows, words, images and numerals with no motion at all.

**No idle motion.** Nothing moves when nobody is acting. There is no looping or decorative animation anywhere: no shimmer, pulsing or drifting.

**Reduced motion.** When the user asks for reduced motion:

- There is no spring, slide, glide, fade or counting.
- After the server's 200, the outline fills solid instantly whether the part was hung by picking the card and pressing Enter on its outline, tapping the outline, or dropping the card. Nothing about an outline is animated or eased, so its change takes no time at all.
- A refused card reappears in place instantly.
- Numerals change straight to their new value, and dialogs appear and disappear at once.
- Scrolling an outline into view at 375×812 jumps rather than glides.
- Announcements, focus movement and server state stay exactly the same as with motion on.

### Feedback states (DP-02, DP-03, DP-05, DP-07, DP-12, DP-14, DP-19, DP-24, DP-25, DP-31, DP-32, DP-33, DP-35, DP-46, DP-49, DP-55, DP-56, DP-57, DP-58, DP-59, DP-60, DP-62, DP-64, DP-66, DP-68, DP-70, DP-72, DP-73, DP-74, DP-75, DP-76, DP-78, DP-80, DP-81, DP-82, DP-84)

**Rules for every action.**

- **Pending.** While a request is pending, its button stays in place with its pending label from the table below, aria-busy true and aria-disabled true. It keeps focus if it had it. It ignores further activation by click, tap, Enter or Space, and Enter in a field of the same form sends nothing more.
- **Answer arrives.** When the answer arrives, whatever it is, a button that is still present returns to its own label, with aria-busy and aria-disabled removed.
- **Where results go.** Results go to "Desk announcements" on Desk and Office. They go to "Account updates" on Pegboard, Sign in, Join, Account, Loan and Fee, for every role. The Not found screen has no announcement region.
- **Replace, never append.** Every write to a live region replaces its whole text. A new announcement is never appended to an earlier one.
- **401, 403, 409 and 503 answers.** The screen's region shows the response's `error` text exactly. On Sign in, the 401 copy goes into "Account updates" and "Form problems" stays empty. A session-ended 401 also brings `link "Sign in again"`, as set out under "Session ended" in Interactions.
- **422 answers.**
  - The form-problems summary shows the summary copy, with one link per field in the order the response's `fields` lists them. Each link moves focus to its field, and each field shows its message directly under it.
  - Focus moves as set out in Interactions.
  - For a Save hours 422, each `hours.<weekday>.opens` message shows under that row's opens field and each `hours.<weekday>.closes` message under its closes field. The structural `hours` message shows under `button "Save hours"`.
  - The one exception is the wrong-peg hang refusal. Its `error` text is announced in "Desk announcements" and is never shown in the summary or under a field.

**Placeholders.**

| Placeholder | Format |
|---|---|
| `<total>` | dollars with two decimals and a comma thousands separator |
| `<amount>` | the loan's `late_fee_so_far_cents`, in the `<total>` format |
| `<cost>` | the item's replacement cost recorded in the loan's `fee_rules`, in the `<total>` format |
| `<date>`, `<end date>` | `YYYY-MM-DD` |
| `<due by>` | `HH:MM` |
| `<tag>` in the Add tool by tag messages | the typed text with surrounding spaces removed, in upper case |
| `<fee id>` | the fee's id, as a plain integer |
| `<part names>` | the unhung part names in board order, joined by a comma and a space |
| `<n>` in the tool filter copy | the number of rows left in `table "Tools"`, as a plain integer |
| `<n>` in the overdue line | the loan's `open_days_late`, as a plain integer |
| `<n>` in the queued-holds line | the item's `hold_queue_length`, as a plain integer |

**Action copy.**

| Action | Pending | Success | Errors and outage |
|---|---|---|---|
| Sign in | `Signing in...` | Goes where "Landing paths and access" says | 401: `Email or password is incorrect.` |
| Join | `Starting your membership...` | `Payment pending — your membership starts when billing confirms it.`, then `Your membership is active.`, on Account as set out under "Joining announcements" below | Billing down: `Billing is down. Nothing was charged; try again when it is back.` |
| Cancel membership | `Cancelling...` | `Your membership ends on <end date>.` where `<end date>` is `active_until` | Billing down: same as join |
| Place hold | `Placing hold...` | `Hold placed. You are number <position> in the queue.` | 409 text |
| Cancel hold | `Cancelling...` | `Hold cancelled.` | 409 text |
| Check out (New loan dialog) | `Reserving...` while reserving, then `Checking out...` | `Loan <ref> is out. Due <date> by <due by>.` | Reservation 409 text; checkout outage as below |
| Check out `<ref>` (reserved loan) | `Checking out...` | Same as above | 409 text. Storage down: `Photo storage is down. The loan stays reserved; check it out when storage is back.` |
| Cancel loan `<ref>` | `Cancelling...` | `Loan <ref> cancelled.` | 409 text |
| Hang | no pending label | `<part name> is on its peg.` If this hang completes a partial loan, add a space and `Returned complete.` | Wrong outline: the exception above. 409 text. |
| Take down | no pending label | `<part name> is off its peg.` | 409 text |
| Check in (Confirm) | `Checking in...` | `Returned complete.` or `Returned — partial. Missing: <part names>.` If a fee was raised, add a space and `Fee raised: $<total>.` | Storage down: `Saved as pending photo. Nothing has been charged.` Billing down: `Billing is down. This check-in was not saved; try again when it is back.` 409 text. |
| Finish check-in | `Checking in...` | Same as check in | Storage down: `Photo storage is down. This check-in is still pending photo; finish it when storage is back.` Billing down: same as check in. 409 text. |
| Pay | `Paying...` | `Fee settled.` | Billing down: same as join. 409 text. |
| Request a waiver | `Sending...` | `Waiver requested. The coordinator will decide.` | 409 text |
| Approve or decline | `Saving...` | `Fee waived.` or `Waiver declined.` | Approve with billing down: `Billing is down. The waiver was not posted; try again when it is back.` 409 text. |
| Save fee rules | `Saving...` | `Fee rules saved. They apply to loans checked out from now on.` | 422 fields |
| Save hours | `Saving...` | `Opening hours saved. <n> loans moved to the next open day.` where `<n>` is `moved_loans` | 403 text; 422 fields |
| Declare closure | `Saving...` | `Closure saved. <n> loans now due <date>.` where `<date>` is the next open day after the closure | 409 or 422 |
| Add tool | `Adding...` | `<tag> added to the board.` | 422 fields |
| Add tool by tag (Enter in New loan) | none | The tool joins "Tools on this loan"; nothing is announced | Field message under the field: `No tool has tag <tag>.` for an unknown tag, `<tag> is already on this loan.` for a listed one |
| Tool filter (typing in Find a tool) | none | `<n> tools match.`, or `1 tool matches.` when `<n>` is 1, written in "Account updates" within 1 second of the last keystroke. With no matches, `table "Tools"` shows the single row `No tools match that search.` and the region reads `0 tools match.` Clearing the box announces the full count. | — |
| Any write refused because the session ended | — | — | 401 text from API, plus `link "Sign in again"` |

A hang's announcement on a desk reports only that desk's own hang response. Another desk's hang, seen through a refresh or a poll, is never announced.

**Joining announcements.** A join's two success messages appear in "Account updates" on `/account`, never on `/join`.

- **First landing.** After `POST /api/members` answers 202, the browser goes to `/account`. On that first landing, "Account updates" shows the Payment pending copy. If the first `GET /api/me` on landing already reports `active`, it shows the active copy instead.
- **Reloading while pending.** Reloading `/account`, or opening it again, while the membership is still pending payment leaves "Account updates" empty. The membership panel still shows "pending payment".
- **Becoming active.** When the pending check on an open Account page sees the membership turn `active`, "Account updates" changes to `Your membership is active.` once. This applies on the first landing and on any later Account page opened while the membership was pending.
- **Already active.** An Account page opened after the membership is already active shows no announcement.

**Hold-ready announcement.**

- When a read on an open Account page shows one of the member's holds changing from `queued` to `ready`, "Account updates" changes to `Your hold on <item name> is ready.` This applies whichever app process made the change, and whichever process serves the page.
- When several holds turn ready in one read, their sentences are written together in hold id order, separated by a space.
- Each hold's sentence is written at most once per Account page.
- An Account page opened when the hold is already ready shows no announcement for it. The hold's row still reads "ready".

**Waiver announcement on the member's Fee page.**

- When a read on the owning member's open Fee page shows the fee changing from `raised` to `waived-by-coordinator`, the page shows the "waived" word and struck-through stamp. "Account updates" changes to `Fee <fee id> was waived.`, written at most once per Fee page.
- "Pay $<total>" and "Request a waiver" are removed, and focus moves as set out under "Paying and waivers from the keyboard".
- A Fee page opened when the fee is already waived shows no announcement. Staff Fee pages never show this announcement.

**Due-date-moved announcement on Desk.** When a read on an open Desk shows that the selected loan's `due_date` changed, its due line shows the new date. "Desk announcements" changes to `Due date moved to <date>.`, where `<date>` is the new due date, written at most once per change on that Desk. A change of `due_by` alone is shown but never announced. A loan that is not selected is never announced.

**Fixed copy.**

| Where | Copy |
|---|---|
| Form-problems summary | `Check the highlighted fields.` |
| Storage banner | `Photo storage is down. Check-ins are held as pending photo until it is back.` |
| Billing banner | `Billing is down. Joins, payments, waivers and check-ins that raise a fee will wait until it is back.` |
| A photo slot on Loan or Fee whose photo record exists but whose own image load failed | `Photo storage is down. Photos will show again when it is back.` |
| Empty checkout slot in the photo comparison | `No checkout photo — this loan predates photos.` |
| Empty check-in slot in the photo comparison | `No check-in photo yet.` |
| Overdue line, for an out loan whose `open_days_late` is more than 0 | `Overdue — <n> open days late, $<amount> so far`, or when `<n>` is 1, `Overdue — 1 open day late, $<amount> so far` |
| Item detail for a tool with one or more queued or ready holds | `Queued holds <n>` |
| Item detail for a tool with no queued or ready holds | `No one is waiting for this tool.` |
| A signed-in member who is not active, trying to hold from the pegboard | `Holds open once your membership is active.` |
| Discard prompt text | `Discard this loan? The member, tools and photo you entered will be cleared.` |
| Return time field message for a skipped wall-clock time | `That time does not exist in library time because the clocks go forward.` |
| Return time field message for malformed text | `Use YYYY-MM-DD HH:MM in library time.` |
| Not-found heading | `We couldn't find that page.` |

The Account page shows the membership status as the word "pending payment", "active" or "lapsed".

**The overdue line is the server's.**

- The browser builds the overdue line only from the loan's `open_days_late` and `late_fee_so_far_cents` as the API returns them.
- It never counts days or works out money from its own clock, calendar or time zone. Moving the browser's clock or date, including across library midnight, changes nothing on the line.
- The line appears, changes and disappears only when a read of the loan returns new values, within the refresh delay below. These changes are never announced.

**Refused board actions on Desk.** Outlines, the board-count numerals, loan status words and the selected loan's controls change only from a 200 or 202 answer, or from a read of server state. When a hang, take-down, Confirm or Finish gets a 409:

- The card springs back, or under reduced motion reappears at once. The board, the numerals and the loan's status stay exactly as the server last reported them.
- The 409 `error` text replaces the text in "Desk announcements".
- The Desk reads that loan again at once, without waiting for the refresh, and within 2 seconds shows the controls for its current status:
  - a pending-photo loan shows "Take or choose photo" and "Finish check-in", with any picked photo kept;
  - a returned-complete loan leaves the open loans list.
- A refused Confirm closes `dialog "Confirm check-in"`, and focus moves to the first control of the new item detail.

**Billing-down refusals.** After a 503 on Pay, Approve waiver or Cancel membership:

- The screen's region keeps the matching billing-down copy, written once.
- The pressed button returns to its own label (for example `Pay $<total>`), with aria-disabled and aria-busy removed, and focus stays on it.
- A refused Cancel membership keeps `dialog "Cancel membership"` open, with focus on "Confirm cancel".
- The billing banner appears beside them within the banner timing in Services.

No refresh, pending check or status poll clears or repeats that copy, removes or disables that button, closes that dialog or moves that focus. They stay until the user's next action on that screen.

**Live updates and refreshes.**

- **Own actions.** The screen where an action happens updates the board, counts and lists from that action's response.
- **Refresh.** Every open Desk, Pegboard, Office, Account, Loan and Fee screen reads its data again at most every 10 seconds. A change made on another screen, by another app instance or by the server's clock therefore shows within 10 seconds, in place, with no page reload. This includes:
  - an overdue line's count and amount, including after a calendar change that alters an out loan's open days late;
  - the queued-holds line and the selected loan's due line in item detail;
  - hold positions and status words in `table "Your holds"`;
  - a fee's status, stamp and buttons on the Fee page;
  - status words in filtered rows of `table "Tools"`.

  On Account, once the membership is active, the screen sends `GET /api/me` no more than once every 10 seconds.
- **Desk board poll.** Every open Desk also reads `GET /api/board` every 2 seconds. A checkout, check-in, hang or take-down made through any app process therefore shows in that Desk's outlines and board-count numerals within 3 seconds.
- **Selected check-in poll.** While an out or returned-partial loan is selected on Desk, that Desk also reads that loan every 2 seconds. Another desk's hang on that loan then shows in its outlines, tag cards and the board-count numerals within 3 seconds.
- **Selected pending-photo poll.** While a pending-photo loan is selected on Desk, that Desk also reads `GET /api/status` every second.
  - **Storage down.** "Finish check-in" is disabled while the latest status read reports storage down.
  - **Storage back.** It becomes enabled within 3 seconds of the first status read that reports storage up.
  - **Storage already up.** On a Desk whose status already reads storage up, it is enabled within 3 seconds of the pending-photo loan being selected, or of the selected loan turning pending photo. One example is a desk on an instance whose storage is reachable, while the check-in was saved as pending photo through an instance whose storage is not.
  - **Nothing else moves.** In every case, the picked photo thumbnail and focus stay exactly where they were.
- **Pending check.** While the membership is pending payment, Account checks every 3 seconds and shows the change within 3 seconds of the server reporting it. The check stops for good once the membership reads `active`.
- **Announcements.** A live region's text changes only for these:
  - a result of the user's own action on that screen, including the tool filter count and a session-ended refusal;
  - the join result shown on the first Account landing;
  - the single pending-to-active change on Account;
  - the hold-ready announcement on Account;
  - the waiver announcement on the member's Fee page;
  - the due-date-moved announcement on Desk.

  The text stays exactly as written until the user's next action on that screen, or until one of these writes replaces it. A refresh or poll never clears, rewrites or repeats an announcement. `Your membership is active.` is written at most once per Account page.
- **What refreshes never disturb.** A refresh, a status poll, any Desk poll, or another desk's change never does any of the following, on any screen:
  - close or reopen a dialog, close the member list, or change a dialog's typed contents;
  - move focus or change the page's scroll position;
  - clear text typed into a text field, search box or the scan field;
  - clear the tool filter, its filtered rows or the selected tool;
  - clear chosen grades, a picked photo thumbnail, or a picked-up card;
  - clear a form-problems summary or a field message;
  - clear the Return time text or the second-hour tick of a loan whose status did not change;
  - replace, blank or reload a photo whose id is unchanged;
  - undo anything under "Billing-down refusals".

  The published exceptions are the focus moves set out in Interactions, when a refresh removes the control that had focus. Data behind an open dialog may refresh, but Tab still wraps inside the dialog. `Active until <date>` shows `active_until` exactly as `GET /api/me` returns it, across refreshes and reloads.
- **Photo comparison.** On Loan and Fee:
  - A photo already shown stays fully loaded through every refresh. Focus on either `link "Open original"` stays where it is.
  - When a check-in photo is stored after the page opened (for example, another desk finishes a pending-photo loan), the check-in slot changes in place within 10 seconds. `No check-in photo yet.` becomes the image with its capture line, byte size and SHA-256, while the checkout slot and focus stay where they were.
  - A photo already shown is never replaced by the storage-down copy because the banner reports storage down. Only a slot whose own image load fails shows that copy.
- **Office refresh.**
  - A row of `table "Opening hours"` edited since its last accepted save keeps every typed time and its checkbox exactly as the coordinator left them. Rows not edited show the server's current hours, in place.
  - Fee rules fields and closure fields that are edited keep their typed text. Those not edited show the server's values.
  - A Save hours or Save fee rules summary and its field messages stay until the coordinator's next action.
- **Other desks on Desk.** When a loan's status or due date changes on another desk or another instance, every open Desk screen shows the change within 10 seconds, or within the faster polls above:
  - The loan's list item shows its new loan status word, shape and due line.
  - Its outlines on the board take the words and shapes that the outline mapping in Visual design gives for the new part states and tool status.
  - If the loan is selected, item detail shows its new due line, announced only as set out under "Due-date-moved announcement on Desk". If its status changed, item detail swaps to the controls for the new status. A pending-photo loan shows "Take or choose photo" and "Finish check-in" and keeps an already picked photo. A returned-complete loan leaves the open loans list, and item detail falls back to the board's selected tool.
  - If such a swap removes the control that had focus, focus moves to the first control in the new item detail. Otherwise focus stays where it was, including in the scan field.
- **Banner.** The service-status banner appears and clears in place on the timing in Services. It never reloads the page or resets anything listed above.

## Backend

### API (DP-01, DP-03, DP-05, DP-08, DP-11, DP-12, DP-20, DP-24, DP-25, DP-28, DP-29, DP-31, DP-35, DP-41, DP-42, DP-48, DP-53, DP-54, DP-60, DP-67, DP-71, DP-74, DP-77, DP-84, DP-85)

**Conventions.**

- All endpoints are under `/api`. Bodies are JSON in and out (`application/json; charset=utf-8`), except that the photo upload endpoints take `multipart/form-data` and photo reads return the stored bytes.
- Sessions use an HttpOnly, SameSite=Lax cookie, set by sign-in or by join.
- Ids are integers.
- Timestamps are ISO 8601 with an offset. Requests may use any offset or `Z`. Responses write every timestamp with the library time zone's offset in force at that instant.
- Dates are `YYYY-MM-DD` in the library time zone.
- Money is integer cents.
- Emails are compared without regard to letter case and stored lowercased.

**Error shape.**

- Every error body is `{"error":"<message>"}`. A 422 adds `"fields":{"<field>":"<message>"}`, listing its keys in the order the endpoint's request names its fields in the table below, unless a different order is published for that endpoint.
- Field message text is up to you unless it is printed here.
- A 422's `error` is the form-problems summary copy, except for the wrong-peg hang 422, whose `error` and field message are both `That peg belongs to a different tool.`

**Error precedence, for the whole API.** A request gets the first of these that applies:

1. 403 `{"error":"Cross-site request refused."}` for a cross-site write (see Server boundary).
2. 401 when the endpoint needs a signed-in caller and there is none:
   - a session that ended through idleness: `{"error":"Your session has ended. Sign in again."}`
   - no session cookie, or an unknown one: `{"error":"Sign in to continue."}`

   Endpoints open to anyone, and `POST /api/members` and `POST /api/session`, treat an ended session as signed out.
3. 404 `{"error":"Not found."}` for any unknown id, or any id the caller may not see, whether it is in the path or the body.
4. 403 when the caller's role may not use the endpoint, or may not send a field it sent:
   - staff-only endpoints: `{"error":"Only desk staff can do that."}`
   - coordinator-only endpoints, and a volunteer's `POST /api/loans` that names `checked_out_at`: `{"error":"Only the coordinator can do that."}`
   - member-only endpoints called by staff: `{"error":"Only members can do that."}`
   - `POST /api/members` from a signed-in caller: `{"error":"Sign out before joining."}`
5. 415 for a wrong content type (see Server boundary).
6. 413 for a body over its limit (see Server boundary and the photo rule below).
7. 422 for validation.
8. 409 for a conflict with the current state of existing records, with the messages and ordering in Business rules. This includes the uniqueness conflicts: the join email already used, and a closure date already closed.
9. 503 when a provider the request needs is unreachable. The `error` is the matching outage copy from Feedback states.

Steps 3 and 4 look inside the body only when it is within its size limit and its text parses as a JSON object, whatever its content type, and only at ids that are whole numbers. Otherwise the later steps decide.

For example:

- **Join.** A `POST /api/members` sent cross-site, as `text/plain`, over 100,000 bytes, with a taken email, while billing is down, answers the cross-site 403. The same request from the app's own origin answers 415. With JSON content type it answers 413. Within the size limit but with a 9-character password it answers 422. With valid fields it answers the email-taken 409. With a new email it answers 503.
- **Loans.** A signed-out `POST /api/loans` answers 401. A volunteer's request from the app's own origin, sent as `text/plain` with body `{"member_id":<id>,"item_ids":[],"checked_out_at":"2026-10-30T10:00:00-05:00"}`, where `<id>` is a seeded member's id, answers the coordinator-only 403. Without `checked_out_at` it answers 415. As JSON it answers 422 with `item_ids`. With `item_ids` naming a tool that is out, it answers that tool's 409.

**Resource shapes.**

- **User:** `{"id","name","email","role":"coordinator"|"volunteer"|"member"}`
- **Membership:** `{"status":"pending-payment"|"active"|"lapsed","tier":"pay-what-you-can"|"standard"|"supporter","active_until":"YYYY-MM-DD"|null,"ends_at_term":bool}`
- **Member summary:** `{"id","name","email","membership_status":"pending-payment"|"active"|"lapsed"}`
- **Part:** `{"id","item_id","name","shape","col","row","width","height","state":"hung"|"out"|"missing"}`
  - `col` and `row` are 0-based hole positions. `width` and `height` are in holes.
  - `shape` is one of `drill`, `saw`, `ladder`, `hammer`, `wrench`, `case`, `battery`, `cable`, `blade` or `generic`.
- **Item:** `{"id","tag","name","replacement_cost_cents","status":"on-wall"|"reserved"|"out"|"pending-photo"|"incomplete"|"held","due_date":null|"YYYY-MM-DD","hold_queue_length","parts":[Part]}`
  - `replacement_cost_cents` is the tool's current cost.
  - `hold_queue_length` is the number of the tool's holds that are queued or ready.
- **Counts:** `{"on_wall","out","missing"}`
- **Photo:** `{"id","event":"checkout"|"checkin","content_type","byte_size","sha256","captured_at","received_at","url":"/api/photos/<id>"}`
- **Loan:** `{"id","ref","member_id","member_name","status":"reserved"|"out"|"pending-photo"|"returned-partial"|"returned-complete","checked_out_at","due_date","due_by":"HH:MM"|null,"fee_rules":null|{"late_fee_cents":int,"damage_fee_cents":int,"replacement_costs_cents":{"<item id>":int}},"open_days_late":int|null,"late_fee_so_far_cents":int|null,"returned_at","items":[{"id","tag","name","grade":null|"good"|"worn"|"damaged"}],"parts":[Part],"missing_parts":["<part name>"],"photos":[Photo],"fee_id":null|id}`
  - `due_date`, `due_by`, `fee_rules`, `open_days_late` and `late_fee_so_far_cents` are null while the loan is reserved.
  - `replacement_costs_cents` has one key per item on the loan, with the item id written as a string.
- **Fee:** `{"id","loan_id","loan_ref","member_id","status":"raised"|"settled"|"waived-by-coordinator","total_cents","lines":[{"item_id","kind":"late"|"damage","open_days":int|null,"amount_cents","description"}],"killbill_invoice_id","waiver":null|{"status":"requested"|"approved"|"declined","reason","requested_at","decided_at"|null}}`
- **Hold:** `{"id","item_id","member_id","status":"queued"|"ready"|"collected"|"cancelled","position":int|null,"placed_at"}`

**Endpoints.** In the "Who" column, "member" and "owning member" endpoints are member-only, so staff get the members-only 403.

| Method and path | Who | Request | Success | Endpoint-specific errors |
|---|---|---|---|---|
| `GET /api/health` | anyone | — | `200 {"status":"ok"}` | — |
| `GET /api/status` | anyone | — | `200 {"storage":"up"\|"down","billing":"up"\|"down"}` | — |
| `POST /api/session` | anyone | `{"email","password"}` | `200 {"user":User}`, and the cookie is set | 401 with the sign-in copy |
| `DELETE /api/session` | anyone | — | `204`, and any session on the cookie ends | — |
| `GET /api/me` | signed in | — | `200 {"user":User,"membership":Membership\|null}`; membership is null for staff | — |
| `POST /api/members` | not signed in | `{"name"` (1–80 chars)`,"email","password"` (at least 10 chars)`,"tier"}` | `202 {"user":User,"membership":Membership}` with status `pending-payment`, and the caller is signed in | 422 fields `name`, `email`, `password`, `tier`; 409 `{"error":"An account with this email already exists."}`; 503 |
| `GET /api/members` | staff | — | `200 {"members":[Member summary]}`, every member, in name order | — |
| `POST /api/membership/cancel` | member | — | `200 {"membership":Membership}` | 409; 503 |
| `GET /api/board` | anyone | — | `200 {"counts":Counts,"columns":10,"rows":int,"items":[Item]}` | — |
| `GET /api/items/<id>` | anyone | — | `200 {"item":Item}`; staff also get `"queue":[{"position","member_name","status"}]` | — |
| `POST /api/items` | coordinator | `{"tag","name","replacement_cost_cents","parts":[{"name","shape","width","height"}]}` | `201 {"item":Item}` | 422 fields `tag` (`PW-` followed by 3 to 5 digits, unique), `name`, `replacement_cost_cents` (1 to 1,000,000), `parts` (1 to 8 parts; width and height each 2 to 10) |
| `PATCH /api/items/<id>` | coordinator | `{"name"?,"replacement_cost_cents"?}` | `200 {"item":Item}` | 422 |
| `GET /api/settings` | staff | — | `200 {"time_zone","late_fee_cents","damage_fee_cents","loan_period_days"}` | — |
| `PUT /api/settings` | coordinator | the same four fields | `200`, same shape | 422: `time_zone` must be an IANA zone name; `late_fee_cents` 0 to 10,000; `damage_fee_cents` 0 to 100,000; `loan_period_days` 1 to 28. All ranges are inclusive whole numbers. |
| `GET /api/calendar` | anyone | — | `200 {"time_zone","hours":[{"weekday","opens":"HH:MM","closes":"HH:MM"}],"closures":[{"date","reason"}],"next_open_days":["YYYY-MM-DD"]}`; `next_open_days` lists the next 10 open days from today | — |
| `PUT /api/calendar/hours` | coordinator | `{"hours":[{"weekday":"monday".."sunday","opens","closes"}]}`; weekdays not listed are closed | `200 {"hours":[...],"moved_loans":int}` | 422, as set out below |
| `POST /api/closures` | coordinator | `{"date","reason"}`; reason 1–120 chars | `201 {"closure":{"date","reason"},"moved_loans":int,"new_due_date":"YYYY-MM-DD"}` | 422 `date` when it is before today or not on a weekday the library opens; 409 `{"error":"That day is already closed."}` |
| `DELETE /api/closures/<date>` | coordinator | — | `204` | 409 `{"error":"Past closures cannot be removed."}` |
| `GET /api/holds` | members get their own; staff get all, filterable by `?item_id=` | — | `200 {"holds":[Hold]}` | — |
| `POST /api/holds` | member | `{"item_id"}` | `201 {"hold":Hold}` | 409 |
| `DELETE /api/holds/<id>` | owning member | — | `200 {"hold":Hold}` | 409 |
| `GET /api/loans` | members get their own; staff get all, filterable by `?status=&member_id=` | — | `200 {"loans":[Loan]}` | 404 when a member passes another member's `member_id` |
| `GET /api/loans/<id>` | owning member, staff | — | `200 {"loan":Loan}` | — |
| `POST /api/loans` | staff | `{"member_id","item_ids":[1–10 ids],"checked_out_at"?}` | `201 {"loan":Loan}` with status `reserved` | 404 when `member_id` names no user, or names a staff user (only members borrow, so a staff user's id counts as an unknown id); the coordinator-only 403 for a volunteer naming `checked_out_at`; 422 fields in the order `member_id` (missing or not a whole number), `item_ids` (empty, repeating an id, more than 10, or not whole numbers), `checked_out_at` (malformed, in the future, or more than 120 days ago); 409 |
| `DELETE /api/loans/<id>` | staff | — | `204` | 409 |
| `POST /api/loans/<id>/checkout` | staff | multipart: `photo` (file), `captured_at` | `200 {"loan":Loan}` with status `out` | 413; 422 `photo`, `captured_at`; 409; 503 storage |
| `POST /api/loans/<id>/hang` | staff | `{"part_id","peg_part_id"}` | `200 {"loan":Loan,"counts":Counts}` | 404 when `part_id` is not on this loan or `peg_part_id` is unknown; 422 `{"error":"That peg belongs to a different tool.","fields":{"peg_part_id":"That peg belongs to a different tool."}}` when `peg_part_id` ≠ `part_id`; 409 |
| `DELETE /api/loans/<id>/hang/<part_id>` | staff | — | `200 {"loan":Loan,"counts":Counts}` | 409 |
| `POST /api/loans/<id>/checkin` | staff | multipart: `grades` (JSON text `{"<item id>":"good"\|"worn"\|"damaged"}` covering every item), `returned_at` (optional), `captured_at`, `photo` | `200 {"loan":Loan,"fee":Fee\|null}`, or `202 {"loan":Loan,"fee":null}` with status `pending-photo` when storage is down | 413; 422 `grades`, `returned_at`, `captured_at`, `photo`; 409; 503 billing |
| `POST /api/loans/<id>/finish` | staff | multipart: `captured_at`, `photo` | `200 {"loan":Loan,"fee":Fee\|null}` | 413; 422; 409; 503 storage or billing |
| `GET /api/photos/<id>` | owning member of the loan, staff | — | `200` with the stored bytes, `Content-Type` as submitted, and `Cache-Control: private, no-store` | 503 storage |
| `GET /api/fees` | members get their own; staff get all, filterable by `?status=` | — | `200 {"fees":[Fee]}` | — |
| `GET /api/fees/<id>` | owning member, staff | — | `200 {"fee":Fee,"photos":[Photo]}` | — |
| `POST /api/fees/<id>/pay` | owning member | — | `200 {"fee":Fee}` with status `settled` | 409; 503 |
| `POST /api/fees/<id>/waiver-request` | owning member | `{"reason"}`; 1–500 chars, line breaks allowed | `201 {"fee":Fee}` | 422 `reason`; 409 |
| `POST /api/fees/<id>/waiver-decision` | coordinator | `{"decision":"approve"\|"decline"}` | `200 {"fee":Fee}` | 422 `decision`; 409; 503 on approve only |

**Hours validation (`PUT /api/calendar/hours`).** The general precedence applies: the coordinator-only 403 comes before 415, then 413, then 422.

- **Structure.** The 422 field `hours` covers:
  - a body that is not a list of weekday entries;
  - an unknown weekday;
  - a weekday that appears twice;
  - no weekday open.

  When it applies, no per-weekday field is reported.
- **Times.** Every `opens` and `closes` must be a 24-hour `HH:MM` whose minutes are 00, 15, 30 or 45.
  - A time that is not gets field `hours.<weekday>.opens` or `hours.<weekday>.closes` with `Use a 24-hour time on the quarter hour, like 18:15.`
  - When both times of a weekday are valid but `closes` is not later than `opens`, field `hours.<weekday>.closes` gets `Closing time must be later than opening time.`
- **Field order.** The `fields` object lists weekdays Monday to Sunday, and within a weekday `opens` before `closes`, whatever order the request used. The form-problems summary links follow the same order.
- **Example.** A coordinator sending Thursday 16:10–16:00 and Saturday 10:00–09:00 gets `{"error":"Check the highlighted fields.","fields":{"hours.thursday.opens":"Use a 24-hour time on the quarter hour, like 18:15.","hours.saturday.closes":"Closing time must be later than opening time."}}`. A volunteer sending the same body gets the coordinator-only 403.

**Photo and time fields.**

- **Photo format.** `photo` must be JPEG, PNG or WebP. Its part content type must be `image/jpeg`, `image/png` or `image/webp`, and its first bytes must carry that format's signature. Otherwise the answer is 422 `photo`.
- **Photo size.** A photo of exactly 5,000,000 bytes is allowed. A larger one answers 413 `{"error":"Photo must be 5,000,000 bytes or smaller."}`.
- **`captured_at`** is required. It must be ISO 8601 with an offset, and no more than 10 minutes after server time. Otherwise the answer is 422 `captured_at`.
- **`returned_at`** is optional. When given, it must be ISO 8601 with an offset or `Z` and no later than now, and, when the loan has a `checked_out_at`, no earlier than it (equal is allowed). Otherwise the answer is 422 `returned_at`. It is echoed in responses with the library offset in force at that instant (see Business rules, Clock changes).

### Business rules (DP-02, DP-03, DP-05, DP-06, DP-08, DP-09, DP-11, DP-12, DP-17, DP-18, DP-21, DP-22, DP-24, DP-25, DP-29, DP-34, DP-35, DP-36, DP-41, DP-47, DP-48, DP-51, DP-53, DP-54, DP-60, DP-63, DP-68, DP-70, DP-71, DP-78, DP-80, DP-82, DP-84)

**Roles.**

- **Members** use only their own membership, holds, loans, fees and photos. Anything else answers 404 as though it did not exist, whether its id is in the path or in the body. Only members place holds, cancel holds or memberships, pay, or request waivers, and only for themselves.
- **Staff** are the volunteers and the coordinator. They see every loan, fee, hold, photo and member summary, and may reserve, check out, hang and check in.
- **The coordinator** alone changes settings, the calendar and inventory, sends `checked_out_at`, and decides waivers.

**Sessions.**

- A session starts at sign-in or join. It ends when `SESSION_IDLE_SECONDS` seconds pass with no activity on it. With the default, that is 30 minutes.
- **Activity** is:
  - its own sign-in or join;
  - any POST, PUT, PATCH or DELETE under `/api` made with it and answered with anything other than a 401;
  - a full page load of any screen path made with it.

  `GET` requests under `/api`, including every refresh and poll, are not activity.
- An ended session never comes back. Every request made with it that needs sign-in answers the session-ended 401, and a page load of a protected screen with it goes to sign-in as for a signed-out visitor.
- Each app instance judges idleness by its own `SESSION_IDLE_SECONDS`, from the last activity recorded in Postgres by any instance.

**Membership: `pending-payment` → `active` → `lapsed`.**

- **Join** creates a pending-payment membership.
- **Becoming active.** A membership becomes `active` only after the server has seen Kill Bill report two things: the subscription is ACTIVE, and its first invoice has a zero balance with a successful payment. The server checks Kill Bill on every `GET /api/me` and in the background, and records the membership as active within 30 seconds of Kill Bill reporting it.
- **Cancelling** needs a membership that is `active` and not already ending. Otherwise it answers 409:
  - not active: `{"error":"Only an active membership can be cancelled."}`
  - already ending: `{"error":"This membership already ends at the end of its term."}`
- **After cancelling,** the membership stays `active`, with `ends_at_term` true and `active_until` set to the billing end date Kill Bill returns. On the first library-local day after `active_until`, it becomes `lapsed`.
- Only `active` members can place holds or be lent tools.

**Holds: `queued` → `ready` → `collected`; `queued` or `ready` → `cancelled`.**

- **Placing a hold** answers 409 when:
  - the member is not active: `{"error":"Your membership is not active."}`
  - the tool is `on-wall` with no ready hold: `{"error":"This tool is on the wall. Ask at the desk to borrow it."}`
  - the same member already has a queued or ready hold on the tool: `{"error":"You already have a hold on this tool."}`
- **Queue position.** A new hold goes to the back of the queue.
  - `position` is worked out on every read from the tool's queued holds in `placed_at` order, with ties broken by hold id. The queued holds are therefore always numbered exactly 1 to n, with no duplicates or gaps.
  - Cancelling, promoting or collecting a hold moves every later queued hold up by one on the next read.
  - `position` is null once a hold is no longer queued.
- **Cancelling** a hold that is collected or cancelled answers 409 `{"error":"This hold is no longer active."}`.
- **Promotion.** The tool's first queued hold whose member is active becomes `ready` in two cases:
  - a loan of that tool becomes returned-complete;
  - the tool's ready hold is cancelled while the tool is on the wall and complete.

  Holds whose members are not active are skipped and stay queued. Each promotion sends exactly one hold-ready email, and the promoted member's open Account page announces it as set out in Feedback states.
- **Held tools.** A tool with a ready hold has status `held`, and only the holder may be lent it.
  - **Reserving.** Reserving it for the holder keeps the hold `ready`. The tool shows `reserved` while that loan is reserved.
  - **Checkout.** The hold becomes `collected` when the holder's loan of that tool is checked out.
  - **Deleting the reservation.** Deleting the holder's reserved loan leaves the hold `ready`, and the tool returns to `held`.
  - **Cancelling the hold first.** If the holder cancelled the ready hold while the loan was reserved, deleting the loan returns the tool to `on-wall` and promotes the next queued hold as for a cancelled ready hold.

**Loans.** Legal transitions:

| From | To | By |
|---|---|---|
| `reserved` | `out` | checkout |
| `reserved` | deleted | DELETE |
| `out` | `returned-complete` or `returned-partial` | check-in |
| `out` | `pending-photo` | check-in while storage is down |
| `pending-photo` | `returned-complete` or `returned-partial` | finish |
| `returned-partial` | `returned-complete` | hanging the last missing part |

Illegal edges answer 409:

- **Checkout** on a loan that is not reserved: `{"error":"This loan is already checked out."}`
- **DELETE** on a loan that is not reserved: `{"error":"Only a reserved loan can be cancelled."}`
- **Check in or take down:**
  - on a reserved loan: `{"error":"This loan has not been checked out."}`
  - on a pending-photo loan: `{"error":"This check-in is waiting for its photo."}`
  - on a returned loan: `{"error":"This loan is already checked in."}`
- **Hang**, with the first message that applies:
  1. a reserved loan: the not-checked-out message;
  2. a pending-photo loan: the waiting-for-photo message;
  3. the named part is in state `hung`: `{"error":"<part name> is already on its peg."}`
  4. a returned-complete loan: the already-checked-in message.
- **Finish** on a loan that is not pending-photo: `{"error":"This loan is not waiting for a photo."}`

**Reserving.**

- The member must be active. Otherwise the answer is 409 `{"error":"This member's membership is not active."}`.
- Each tool must be `on-wall`, or `held` for this member. Otherwise the answer is 409 for the first offending tool in request order, with the first message that applies:
  1. out, reserved or pending photo: `{"error":"<tag> is not on the wall."}`
  2. incomplete: `{"error":"<tag> is missing parts."}`
  3. held for someone else: `{"error":"<tag> is held for another member."}`
- The member check comes before the tool checks.
- Reserved tools show as `reserved` and stay physically on the wall.
- Refs are `L-` plus a four-digit sequence. Seeded loans use L-0001 to L-0004, and new loans continue from L-0005.

**Checkout.**

- `checked_out_at` is the coordinator's `checked_out_at` from the reservation (for a paper slip entered late). Without one, it is the moment of checkout.
- Checkout sets the due date (see Opening calendar and time) and turns every part of the loan's tools to `out`.

**Fee rules recorded at checkout.**

- At the moment a checkout succeeds, the loan records as `fee_rules`:
  - the late fee per open day and the damage fee then in the settings;
  - each of its items' replacement cost then on the item.
- This happens at the checkout request even when `checked_out_at` is backdated. It uses neither the backdated time nor the time of reservation.
- Later setting changes and `PATCH /api/items/<id>` never alter a loan's `fee_rules`. A changed replacement cost applies only to loans checked out afterwards.

**Hanging.**

- During a check-in, a hang moves a part from `out` to `hung` at once, and the change survives reloads. A part hangs only on its own outline.
- Taking a part down, allowed only while the loan is `out`, returns it to `out`.
- On a returned-partial loan, hanging a `missing` part makes it `hung`. When no missing parts remain, the loan becomes returned-complete, the tool can be lent again, and holds are promoted.

**Check-in outcome.**

- Every item needs a grade.
- If every part is hung, the loan becomes `returned-complete`.
- Otherwise it becomes `returned-partial`. Unhung parts become `missing`, `missing_parts` lists them in board order, and their tools show `incomplete`.
- `returned_at` is the request's `returned_at` (a drop-box return), or otherwise the moment of the request.
- Missing parts raise no fee.
- **Pending photo.** When a check-in is accepted as pending photo, it records its grades, `returned_at`, hung set, open days late and late fee so far. Finishing uses those recorded values, so time spent in an outage adds no lateness. Unhung parts of a pending-photo loan stay `out` until the finish marks them missing.

**Board counts.** Each count is derived from part states when it is read:

| Count | Parts counted |
|---|---|
| On the wall | parts in state `hung`, including parts of tools that are reserved, held or not on any loan |
| Out on loan | parts in state `out` |
| Missing | parts in state `missing` |

The three counts always add up to the total number of parts. The counts in a hang response are the counts after that hang's own commit. For example, with the seed data at start: on the wall 10, out on loan 16, missing 0.

**Opening calendar and time.**

- **Library time.** All dates use the library time zone setting. Every `returned_at`, whatever offset it was sent in, is converted to library wall-clock date and time before any date or cutoff below is decided.
- **Open day.** A date whose weekday has opening hours and is not a closure.
- **Due date.** The first open day on or after the library-local checkout date plus the loan period in days. A loan stores its due date as a date only. Its `due_by` is always the closing time currently set for that date's weekday.
- **Moving due dates.** Whenever hours change or a closure is declared, every out loan whose due date is no longer an open day moves to the next open day after it. `moved_loans` counts only these date moves. Removing a closure, or opening a weekday that was closed, moves nothing earlier.
- **Changing hours on a weekday that stays open:**
  - moves no loan;
  - changes `due_by` at once for every out loan due on that weekday, in every API read and on the Desk queue, the Desk item detail, the Loan page and the Account loans table;
  - changes the on-time cutoff used by every check-in made after the change, and every overdue figure read after it;
  - makes reminders sent after the change print the new closing time.

  Fee lines already raised, their Kill Bill invoice items, and reminders already sent never change.
- **Calendar changes and overdue figures.** An out loan's `open_days_late` and `late_fee_so_far_cents` always follow the calendar as it stands at the read. Opening a weekday that was closed therefore adds that weekday's dates after the due date to the count, and a new closure on today removes today from it.
- **Closures** can only be declared for today or later. Seeded past closures stay.
- **Closing instant.** For a date, the instant `HH:MM:00` exactly in library wall-clock time, where `HH:MM` is the closing time currently set for that date's weekday, at the offset in force at that wall-clock time.
- **Effective return day.** The library-local date of `returned_at`, when that date is an open day and `returned_at` is at or before that date's closing instant. Otherwise, the next open day after that date. The cutoff is inclusive to the second: a return at exactly the closing instant is on time that day, and a return one second later is not.
- **Open days late.** The number of open days strictly after the due date, up to and including the effective return day. A return at or before the closing instant on the due date is 0 days late. Closures and closed weekdays never count.

**Clock changes.** The library time zone follows its own daylight-saving rules, and every rule above works on library wall-clock dates and times:

- When the clocks go back, a repeated wall-clock time belongs to the same library date both times. Two returns at the same wall-clock time in either occurrence therefore have the same effective return day and the same open days late.
- A loan's due date never moves because of a clock change.
- Every timestamp in a response carries the offset in force at that instant. For example, `returned_at` sent as `2026-11-01T06:30:00Z` is echoed as `2026-11-01T01:30:00-05:00`, and `2026-11-01T07:30:00Z` is echoed as `2026-11-01T01:30:00-06:00`.

**Overdue so far.** Every loan read carries `open_days_late` and `late_fee_so_far_cents`, decided only by the server:

| Loan status | `open_days_late` | `late_fee_so_far_cents` |
|---|---|---|
| out | the open days late a return at the server's current instant would have, worked out afresh on every read | the sum, over the loan's items, of the late-line amounts that return would raise under the Fees rules (rate and caps from `fee_rules`), worked out afresh on every read |
| pending-photo | the value recorded at its check-in, which never changes while it waits, however much time passes | the value recorded at its check-in, which never changes while it waits |
| returned | the open days late used at its check-in outcome | the sum of its late lines, or 0 when it has none |
| reserved | null | null |

The browser's clock and time zone play no part in either value.

**Worked examples**, with the seed data at start:

- **L-0001.** The tile saw is due 2026-10-10.
  - Returned at 2026-10-18 14:00 library time, it is 3 open days late (Oct 11, Oct 15 and Oct 18). Oct 17 is a closure.
  - Returned at 2026-10-10 15:59, it is 0 days late.
  - Returned at 2026-10-10 20:00, it is 1 day late, because the effective return day is Oct 11.
  - If the coordinator opens Monday 10:00–12:00, a return at 2026-10-18 14:00 is 4 open days late, because Monday Oct 12 now counts. The loan's due date stays Oct 10.
- **L-0002.** It is due Thursday 2026-10-22 and shows `due_by` "20:00".
  - `returned_at` `2026-10-23T01:00:00Z`, which is 2026-10-22 20:00:00 library time, is 0 days late, and so is `2026-10-22T20:00:00-05:00`.
  - `returned_at` `2026-10-23T01:00:01Z` is 1 open day late, because the effective return day is Saturday Oct 24.
  - If the coordinator sets Thursday to 16:00–18:00, `moved_loans` is 0 and L-0002 shows `due_by` "18:00". A return at 2026-10-22 18:30 is then 1 open day late, because the effective return day is Saturday Oct 24. Under the seed hours, the same return is 0 days late.
- **L-0004 and the clock change.** In America/Chicago, daylight saving ends on Sunday 2026-11-01 at 02:00, when the clocks go back to 01:00, so 01:00–01:59 happens twice. L-0004 is due Saturday 2026-10-31 by 16:00.
  - Returned at `2026-11-01T01:30:00-05:00` or at `2026-11-01T01:30:00-06:00`, it falls on library date Sunday Nov 1. That is an open day, and both times are before its 16:00 closing instant, so the effective return day is Nov 1 and the loan is 1 open day late.
  - Graded good, either return raises one late line `Late fee — Pressure washer kit (PW-108) — 1 open day late` of 250 cents, with no cap wording.

**Fees.**

- **When.** The fee is computed once, at the check-in outcome: the check-in itself, or the finish for a pending-photo loan.
- **Which rules.** The loan's recorded `fee_rules`: its late fee, damage fee and each item's recorded replacement cost. Never the current settings or the item's current cost.
- **Lines** are made per item, in the item order on the loan:
  - **Late line**, when open days late is more than 0:
    - When the recorded late fee × open days late is strictly greater than the item's recorded replacement cost, the amount is that recorded cost and the description ends with `, capped at replacement cost`.
    - Otherwise, including when the two are exactly equal, the amount is the late fee × open days late and the description has no suffix.
    - The description is `Late fee — <item name> (<tag>) — <n> open days late`. When `<n>` is 1, it reads `1 open day late`.
  - **Damage line**, when the grade is `damaged`. The amount is the recorded damage fee and is never capped. The description is `Damage fee — <item name> (<tag>)`.
- **Totals.** All arithmetic is in whole cents, so nothing is ever rounded. The total is the sum of the lines.
- **One fee.** If there are no lines, there is no fee and `fee_id` is null. Otherwise the loan has exactly one fee, in status `raised`.

**Fee example**, with the seed data at start. L-0002 returned at 2026-10-29 18:00 library time is 3 open days late, which gives two late lines of $7.50 each.

- **Changed settings and a changed cost.** Suppose the coordinator first sets the late fee to $10.00 and the damage fee to $25.00, patches PW-106's replacement cost to $5.00, and PW-106 is graded damaged. L-0002's lines are still $7.50, $7.50 and $15.00, with no cap wording, because L-0002 records the seed rules and PW-106's seed cost of $18.00.
- **A backdated loan under the new rules.** Suppose instead the coordinator only sets the late fee to $10.00, leaving every item cost as seeded. They then reserve PW-106 and PW-107 (with both on the wall) and check them out with `checked_out_at` 30 days before today. That loan records the $10.00 rule and the costs $18.00 and $32.00. Returned today:
  - the claw hammer's late line is $18.00, with the capped wording;
  - the stud finder's late line is the smaller of $10.00 × `<n>` and $32.00, where `<n>` is its open days late, with the capped wording only if $10.00 × `<n>` is more than $32.00.

**Fee transitions.** `raised` → `settled` (pay), or `raised` → `waived-by-coordinator` (approve).

**Fee conflicts**, each answered with 409:

- pay, request or approve on a settled fee: `{"error":"This fee is already settled."}`
- pay, request or approve on a waived fee: `{"error":"This fee has been waived."}`
- a request while a waiver is already requested: `{"error":"A waiver request is already waiting."}`
- a decision when no waiver is requested: `{"error":"There is no waiver request to decide."}`

**Declining and paying during a waiver.**

- Declining sets the waiver to `declined` and leaves the fee `raised`. The member may request again.
- Paying is allowed while a waiver is requested. The request stays `requested`, and any later decision gets the settled conflict.

**All-or-nothing check-in.** A check-in outcome ends in exactly one of two ways, and nothing in between ever persists:

1. The loan is returned, its check-in photo is stored, and its fee, if any, is recorded in Kill Bill.
2. Storage is down, so the loan becomes pending-photo, with nothing charged and no photo stored.

If Kill Bill fails while the fee is being recorded:

- the server deletes the photo object it just stored;
- the loan keeps its previous status, `out` or `pending-photo`;
- hung parts stay hung;
- the answer is 503.

**Concurrency.** These rules hold across every app process that shares the database:

- **Reservations and checkouts.** When several include the same tool, exactly one succeeds. The rest get the conflict that the winner's new state produces.
- **Check-ins and finishes.** When several target the same loan, exactly one succeeds, and Kill Bill records its fee once. The rest get the conflict that the winner's new state produces.
- **Hangs and take-downs racing a check-in or finish.** These are decided by commit order, one after another. Both requests can succeed.
  - **Committed before the check-in.** A hang or take-down that commits before the check-in or finish succeeds, and the check-in includes its result: a part hung first counts as hung, and a part taken down first counts as unhung.
  - **Arriving after the check-in.** A hang or take-down that arrives after the check-in or finish gets the answer that the loan's new status gives under the Loans rules:
    - on a pending-photo loan, the waiting-for-photo 409;
    - a hang on a returned-complete loan gets the already-on-its-peg 409, because every part is hung;
    - a take-down on any returned loan gets the already-checked-in 409;
    - on a returned-partial loan, a hang of a part the check-in left `missing` succeeds as a late-part hang under Hanging, and a hang of a part already hung gets the already-on-its-peg 409.
- **Photo writes.** A checkout, check-in or finish writes its photo object only after it has won its loan's transition.
  - After racing checkouts, check-ins or finishes of one loan, there is exactly one object under `loans/<ref>/<event>/` for that event, whose bytes are the winner's upload, and one photo record.
  - There is at most one fee. Only when the winner raises a fee is there one Kill Bill invoice for it and one receipt. A checkout, or a check-in or finish that raises no fee, leaves no invoice and no receipt.
  - A request that loses the race, or is answered 409, 413, 422, 503 or 202, leaves no object in the bucket.
- **Hangs of the same part.** Exactly one answers 200. The rest get the already-on-its-peg 409.
- **Hangs of different parts of one loan.** Every one succeeds, applied one after another, and each response shows the loan and counts as they stood after its own commit.
  - When the hangs together hang the last missing parts of a returned-partial loan, the loan becomes returned-complete exactly once.
  - Exactly one response shows `"status":"returned-complete"`: the one whose commit hung the last missing part. Every other response shows `returned-partial`, with the parts still missing at its own commit.
  - A returned-partial loan with an empty `missing_parts` never exists, in any response or read.
- **Holds from one member.** Simultaneous holds by one member on one tool give exactly one 201. The rest get the already-have-a-hold 409. A member never has more than one queued or ready hold per tool.
- **Holds from different members.** Simultaneous holds from different members on one tool all succeed. Their positions are distinct and continue the queue without gaps, in `placed_at` order. `hold_queue_length` always equals the count of queued and ready holds that `GET /api/holds?item_id=` returns.
- **Hold promotion.** A tool's hold is promoted exactly once per triggering event, with exactly one hold-ready email.
- **Pay, approve and join** follow Services → Kill Bill.

**Due-tomorrow reminders.**

- A background sweep runs at boot and then every `REMINDER_SWEEP_SECONDS` seconds.
- On each run it sends one reminder for every out loan whose due date is tomorrow in library time, unless a reminder has already gone for that loan and due date.
- A loan whose due date moves gets one reminder for its new date.
- Several app processes sharing the database never send the same reminder twice.

### Services (DP-01, DP-02, DP-03, DP-06, DP-22, DP-24, DP-25, DP-26, DP-28, DP-31, DP-33, DP-36, DP-50, DP-63, DP-64, DP-72)

**Kill Bill** (`KILLBILL_*`) is the one ledger for memberships and fees.

- **Catalog.** On serve, if the tenant has no catalog, upload one with three products. Each has a single evergreen annual plan in USD, billed in advance, with no trial and the default price list:

  | Product | Plan | Price | Tier |
  |---|---|---|---|
  | `PayWhatYouCan` | `pegworth-pay-what-you-can-annual` | $15.00 | `pay-what-you-can` |
  | `Standard` | `pegworth-standard-annual` | $40.00 | `standard` |
  | `Supporter` | `pegworth-supporter-annual` | $75.00 | `supporter` |

- **Accounts.**
  - Each member has one Kill Bill account, with `externalKey` set to the member's lowercased email, plus their name and email, and currency USD.
  - Its default payment method is external, and it carries Kill Bill's automatic-payment-off control, so the only payments are the ones the app records.
  - If an account with that external key already exists, reuse it. If it already has an active subscription to the same plan, reuse that subscription instead of making a second one.
- **Join.** Create the subscription to the tier's plan. Once its first invoice exists, record one external payment for that invoice's balance, unless the invoice already carries a successful payment, which is reused. Business rules say when the membership becomes active.
- **Cancel.** Cancel the subscription at end of term. `active_until` is the subscription's `billingEndDate` as Kill Bill returns it, which equals its `chargedThroughDate`.
- **Fees.** Each fee is one Kill Bill invoice on the member's account, with one external charge item per fee line, in the same order, with the same description and amount, in USD. Store the invoice id as `killbill_invoice_id`. The invoice stays unpaid until the member pays.
- **Pay.** The fee's payment carries `paymentExternalKey` `pegworth-fee-<fee id>`.
  - Before recording anything, the server looks up Kill Bill's payment with that external key. If one exists with a successful purchase (for example, left by an earlier attempt that wrote to Kill Bill but never finished in Pegworth), it records no new payment.
  - Otherwise it records one external payment of the invoice balance against that invoice, with that key.
  - The fee becomes `settled` once the invoice balance reads zero, and Pay answers 200.
- **Waiver approval.** The waiver is one Kill Bill credit equal to the fee total against that invoice, described `Waiver for fee <fee id>`.
  - Before posting, the server looks on the fee's invoice for a credit item with that description, and posts none if one exists.
  - The fee becomes `waived-by-coordinator` once the invoice balance reads zero, and approval answers 200.
- **One write each.** These hold across all app processes, repeated clicks and earlier unfinished attempts:
  - **Pays.** Of simultaneous or repeated pays of one fee, exactly one answers 200 `settled` and the rest get the settled conflict. The invoice carries exactly one payment.
  - **Approvals.** Of simultaneous approvals of one fee, exactly one answers 200 and the rest get the waived conflict. The invoice carries exactly one credit.
  - **Joins.** Of simultaneous joins with the same email, in any letter case, exactly one answers 202 and the rest get the join 409. Kill Bill ends up with exactly one account with that external key, one subscription and one payment for the first invoice.
  - **After a 503.** A pay or approve that answered 503 left no Kill Bill payment or credit. Retrying once billing is back records exactly one.
- **When Kill Bill is unreachable:**
  - Join, cancel, pay and approve answer 503 and change nothing in Pegworth or Kill Bill. In particular, a failed join creates no Pegworth account.
  - A check-in or finish that would raise a fee answers 503 and leaves its loan as it was, under the all-or-nothing rule.
  - Everything that needs no new Kill Bill write keeps working, using membership state already confirmed and stored: check-ins and finishes that raise no fee, reservations, checkouts, hangs, holds, waiver requests and declines.
  - The screens keep the refusal as set out under "Billing-down refusals" in Feedback states.
  - When Kill Bill answers again, the same requests succeed without a restart.

**Object storage** (`S3_*`, a private bucket) keeps condition photos.

- **Keys.** Each checkout or check-in photo is one object with key `loans/<loan ref>/<event>/<photo id>`, where `<event>` is `checkout` or `checkin`. Objects are written only as the photo-writes rule in Business rules → Concurrency allows.
- **Bytes.** The object body is exactly the uploaded bytes, never re-encoded, resized, rotated or stripped.
- **Metadata.** The object's content type is the submitted one, and its user metadata `captured-at` is the submitted capture time.
- **Database record.** Postgres keeps each photo's byte size and SHA-256 hex, both computed from the received bytes, plus `captured_at` and `received_at`.
- **Serving.** Photos reach browsers only through `GET /api/photos/<id>`, which applies the ownership rules.
- **When storage is unreachable:**
  - checkout answers 503, and the loan stays reserved;
  - check-in answers 202 with the loan pending-photo;
  - finish and photo reads answer 503, each with its storage-down copy;
  - everything else keeps working.

**Service status.**

- The server probes storage and Kill Bill every 10 seconds while they are up, and every second while they are marked down. Any failed call marks that service down at once.
- `GET /api/status` reports the current state.
- Every screen fetches it on load and then every 10 seconds, so a banner appears or clears within 15 seconds of the change. A Desk with a pending-photo loan selected fetches it every second, as set out in Feedback states.

**Mail** (SMTP at `SMTP_HOST`:`SMTP_PORT`).

- Every message is from `MAIL_FROM`, which is `Pegworth Desk <desk@pegworth.example>`, and goes to the member's email.
- A message is sent only after the change it reports has been committed.
- If SMTP refuses a message, the server retries every 30 seconds until it is accepted. Each event gives exactly one accepted message.

| Event | Subject | Body includes |
|---|---|---|
| Hold promoted to ready | `Your hold is ready: <item name> (<tag>)` | The tool, the date it was hung back, and the next open day with its hours |
| Fee recorded in Kill Bill | `Pegworth fees for loan <loan ref>: $<total>` | Every line description with its amount, the total, the Kill Bill invoice number, and a link to `/fees/<fee id>` built from `APP_PUBLIC_URL` |
| Due-tomorrow reminder | `Due tomorrow at Pegworth: <loan ref>` | Each item's name and tag, the due date, and the closing time in force when the reminder is sent |

### Seed data (DP-05, DP-08, DP-18, DP-20, DP-21, DP-34, DP-48)

Every person, address and organisation below is invented.

- On every serve, apply the schema and insert this seed only where it is missing. Do this idempotently, and safely when several app processes start together on one database.
- Seeded members' Kill Bill accounts, subscriptions and first payments are created on serve by the Services rules. Their memberships are active within 60 seconds of the first boot that can reach Kill Bill.

**Settings.** Time zone `America/Chicago`; late fee 250 cents per open day; damage fee 1500 cents; loan period 7 days.

**Opening hours.** Thursday 16:00–20:00, Saturday 10:00–16:00 and Sunday 12:00–16:00. Every other weekday is closed.

**Closures.**

| Date | Reason |
|---|---|
| 2026-10-17 | Volunteer training day |
| 2026-11-26 | Thanksgiving |
| 2026-12-24 | Christmas Eve |
| 2026-12-26 | Winter stocktake |

**Staff.**

| Name | Email | Password | Role |
|---|---|---|---|
| Rosalind Okafor | coordinator@pegworth.example | coordinator-pass-1 | coordinator |
| Tomasz Brennan | tomasz@pegworth.example | volunteer-pass-1 | volunteer |
| Priya Halloran | priya@pegworth.example | volunteer-pass-2 | volunteer |

**Members.**

| Name | Email | Password | Tier |
|---|---|---|---|
| Ada Mwangi | ada@members.example | member-pass-ada | standard |
| Ben Castillo | ben@members.example | member-pass-ben | pay-what-you-can |
| Cleo Danforth | cleo@members.example | member-pass-cleo | supporter |
| Eli Nakamura | eli@members.example | member-pass-eli | standard |

**Items.** Parts are placed on the 10-hole-wide board in the order listed below.

- Each part goes at the first position where its whole rectangle fits without overlapping an earlier part, scanning row by row from the top and, within a row, column by column from the left. Rectangles may touch.
- Tools the coordinator adds later are placed by the same rule.
- A part is at most 10 holes wide, so a tool always fits on a new row.

| Tag | Name | Replacement cost | Parts (name, shape, width × height in holes) |
|---|---|---|---|
| PW-101 | Cordless drill kit | $189.00 | Drill body (drill 3×3), Battery A (battery 2×2), Battery B (battery 2×2), Charger (case 3×2) |
| PW-102 | Tile saw | $240.00 | Tile saw (saw 4×3) |
| PW-103 | Step ladder | $95.00 | Step ladder (ladder 2×8) |
| PW-104 | Socket set kit | $68.00 | Case (case 4×2), Ratchet (wrench 2×3), Extension bar (generic 2×4), Metric socket tray (case 3×2), Imperial socket tray (case 3×2), Spark plug socket (generic 2×2) |
| PW-105 | Orbital sander kit | $79.00 | Sander (generic 3×3), Dust bag (generic 2×2), Sandpaper pack (blade 2×2) |
| PW-106 | Claw hammer | $18.00 | Claw hammer (hammer 2×4) |
| PW-107 | Stud finder | $32.00 | Stud finder (generic 2×3) |
| PW-108 | Pressure washer kit | $310.00 | Washer unit (generic 4×4), Hose (cable 3×3), Lance (generic 2×6), Nozzle set (case 2×2) |
| PW-109 | Hedge trimmer | $120.00 | Hedge trimmer (saw 5×2) |
| PW-110 | Pipe wrench | $26.00 | Pipe wrench (wrench 2×5) |
| PW-111 | Laser level | $85.00 | Laser level (generic 3×2) |
| PW-112 | Jigsaw kit | $99.00 | Jigsaw (saw 3×3), Blade case (blade 2×2) |

**Loans.** All four are `out`, with no photos, because they were recorded before photos existed. Each records `fee_rules` of 250 late and 1500 damage, with its items' replacement costs from the Items table.

| Ref | Member | Items | Checked out (library time) | Due date |
|---|---|---|---|---|
| L-0001 | Ada Mwangi | PW-102 | 2026-10-03 11:00 | 2026-10-10 |
| L-0002 | Ben Castillo | PW-101, PW-106 | 2026-10-15 17:00 | 2026-10-22 |
| L-0003 | Eli Nakamura | PW-104 | 2026-10-18 13:00 | 2026-10-25 |
| L-0004 | Cleo Danforth | PW-108 | 2026-10-24 10:30 | 2026-10-31 |

**Holds.** Cleo Danforth has one queued hold on PW-102, at position 1.

**Fees.** None at start.

## Technical requirements

### Deployment (DP-42)

- The runtime is Node.js 22 with npm. Write the app in TypeScript.
- At the root of `/app`, provide `run.json` with the string fields `install`, `build` and `serve`, plus `"_schema":"run-manifest-v1"`. For example:

  ```json
  {"_schema":"run-manifest-v1","install":"npm ci","build":"npm run build","serve":"npm run start"}
  ```

- The grader runs `install` and `build` once, then `serve`.
- The server binds `0.0.0.0` on port 4173, or on `APP_PUBLIC_PORT` when that is set. One process serves both the browser app and the API.
- `GET /api/health` answers HTTP 200 JSON `{"status":"ok"}` once the server is listening and connected to Postgres, whether or not the other providers are reachable.
- The grader may start extra instances, each at its own address. An instance may share the main database and bucket while one of its providers points at an unreachable address, or while it has its own `SESSION_IDLE_SECONDS`. Each instance behaves correctly alongside the others, including for every concurrency rule in Business rules and Services and every cross-desk update in Feedback states.

### Configuration and secrets (DP-44)

Read all of these from the environment at start:

| Purpose | Variables |
|---|---|
| Postgres | `DATABASE_URL` |
| Kill Bill | `KILLBILL_URL`, `KILLBILL_USERNAME`, `KILLBILL_PASSWORD`, `KILLBILL_API_KEY`, `KILLBILL_API_SECRET` |
| Object storage | `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_FORCE_PATH_STYLE`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` |
| Mail | `SMTP_HOST`, `SMTP_PORT`, `MAIL_FROM` |
| App | `APP_PUBLIC_PORT`; `APP_PUBLIC_URL`, used only to build links in emails |
| Reminders | `REMINDER_SWEEP_SECONDS`, a whole number from 1 to 60 inclusive, default 60 |
| Sessions | `SESSION_IDLE_SECONDS`, a whole number from 10 to 86,400 inclusive, default 1,800 |

Never hard-code credentials. Never put a credential, a provider URL or a bucket name in anything the browser receives. Every provider call happens on the server.

### Server boundary (DP-43)

- **Same origin only.**
  - The server sends no cross-origin sharing headers.
  - For each request, the app's own origin is `http` or `https` plus the host and port in that request's `Host` header. `APP_PUBLIC_URL` plays no part in this.
  - A POST, PUT, PATCH or DELETE whose `Origin` header is present and differs from the own origin is the cross-site write refused in the API's error precedence.
- **Body size.**
  - JSON bodies up to and including 100,000 bytes are allowed. Larger ones answer 413 `{"error":"Request is too large."}`.
  - Multipart bodies up to and including 5,100,000 bytes are allowed. Larger ones answer 413 with the photo-size copy from API.
- **Content type.** A request that carries a body to a JSON endpoint with any content type other than `application/json` answers 415 `{"error":"Send JSON."}`. A request with no body (no `Content-Length` above zero and no chunked body) skips this check. A multipart endpoint answers the same 415 for any content type other than `multipart/form-data`.
- **What is served.** The server serves only the built browser assets and the API. Every other path answers 404, including:
  - server source, and source maps of server code;
  - `run.json`, package manifests and lockfiles;
  - environment files;
  - any file outside the built assets, including dot-paths and encoded traversal.
- **Redirects.** The server and the browser app never redirect to another origin, whatever a `next` value says. The sign-in rule in Screens and layout decides every post-sign-in destination.
- **Providers down at boot.**
  - If Kill Bill, storage or SMTP is unreachable at boot, the server still starts, answers health with 200 and shows the matching banner. It starts using the provider within one probe interval of it becoming reachable, without a restart.
  - If Postgres is unreachable at boot, the server retries every 2 seconds and answers health with 503 `{"status":"starting"}` until it connects.

### Browser support and performance (DP-38, DP-39)

- **Coverage.** Current Chromium, Firefox and WebKit at 375×812, 768×1024 and 1280×800, with mouse, keyboard and touch, with and without reduced motion, and with the browser set to any time zone and any clock setting.
- **Load time.** With the seed data, the Desk and Pegboard screens show the board and counts within three seconds of navigation.
- **Hang feedback.** A hang's announcement appears within one second of the drop.
- **Member list.** The New loan member list filters within a quarter of a second of each keystroke.
- **Fonts** are self-hosted from shipped font files.

## Working rules

- IF-01: `/app/run.json` holds exactly the string fields `install`, `build`, `serve` and `"_schema":"run-manifest-v1"`, and `serve` starts the app with no interactive steps.
- IF-02: `/app/THIRD_PARTY_NOTICES.md` names every shipped package with its version and licence, and every bundled font; shipped packages are the production dependency tree reported by `npm ls --omit=dev --all --json`.
- IF-03: Every shipped package is licensed MIT, ISC, BSD-2-Clause, BSD-3-Clause, Apache-2.0 or 0BSD; fonts are OFL-1.1, and icons are ISC or MIT.
- IF-04: The app stores state only in the provided Postgres database, Kill Bill tenant and object-storage bucket, with no SQLite, Redis, in-process persistence file or other datastore; the browser's session storage holding a sign-in draft is the only browser-side store.
- IF-05: The provided service compose files, their seeded credentials, and the tenant and bucket settings are left unchanged.
- IF-06: `/app/package-lock.json` is committed, and `install` uses it.
- IF-07: The browser loads nothing from another origin; fonts, scripts, styles and icons are all served by the app.

## Engineering standards

- The code is idiomatic, strict TypeScript, with no `any` in domain code and no suppressed type errors.
- Names in code follow the domain terms in this brief: loan, part, hang, peg, outline, open day, closure, closing instant, fee rules, replacement cost, fee line, overdue so far, waiver, hold, queue position, membership, session, draft.
- Each domain rule is decided in exactly one place in the source:
  - the loan, fee, hold and membership transitions;
  - the open-day lateness count, the closing instant and the conversion of a return time to library wall-clock time;
  - the due date and `due_by`;
  - the fee rules and replacement costs a loan records, and the per-item cap;
  - the open days late and late fee so far of a loan;
  - the hold queue position;
  - the outline state word;
  - the board counts;
  - whether a session has ended;
  - whether a sign-in `next` path is followed;
  - the API error precedence.
- The browser contains no lateness, date-counting or money calculation. It formats values the API returns, and converts typed Return time text to an offset only for sending.
- No abstraction has a single implementation, and no wrapper only forwards calls.
- There is no dead, commented-out or unreachable code, and no defensive check for a state the rules make impossible.
- Every API error leaves through one shared error shape, in the one precedence order given in API.
- No feature, endpoint, screen or setting goes beyond this brief.
