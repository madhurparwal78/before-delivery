# Tallwind Business Banking Cockpit

Build Tallwind, a business banking cockpit for the founder of a small company, together with its public marketing site.

Signed-in users watch three things for each of their company's checking and savings accounts: the booked balance, the available balance, and a live transaction feed. The available balance is the booked balance minus money held for payments that are waiting for approval. Every figure in one answer is read at the same moment, so the figures always agree with each other. The feed's filters live in the page address. Its search matches the literal text typed and always shows the answer for the latest text. Its periodic refresh never drops the rows a user has paged in and never moves their focus. Its stream catches up by itself after a reconnect, a server restart or a database outage. It shares a small fixed set of database connections however many tabs are open, and it closes the moment its session signs out. After sign-out, nothing from that session acts again, and nothing of one company survives into the next sign-in on the same tab. The cockpit's accounts rail sits inline from exactly 1024 pixels wide and becomes a drawer below that width. A closed drawer cannot be reached at all.

Users save payment recipients. Names are counted character by character exactly as typed and are kept free of hidden text-direction controls. Users remove stale recipients by keyboard through a confirmation dialog without rewriting history, even while someone else is sending to them. They type amounts as ordinary dollars and cents and send ACH, wire, real-time and check payments. A half-finished send lives in the page address and reopens on its review step after a forced sign-out. Each payment posts in a single step on the server and gets a settlement date from its method's same-day cutoff in New York. The send form previews that date as the server decides it, whatever the browser's clock or time zone says. A large payment holds its money and waits for one or two approvers on an Approvals page. That page updates live, keeps the user's focus in place, names every row action in full for screen readers, and shows each row's "Approve by" deadline exactly as the server dates it. A held payment nobody decides expires on its own at a New York midnight on the Federal Reserve calendar, and its hold is released exactly once. The outcome stays correct when approvers act at the same moment. Scheduled payments post on their own shortly after midnight New York time, on the correct side of every daylight-saving change. That timing is driven by a business clock the operator can set.

Owners settle customer invoices, draw on a venture credit line, move money between their own accounts and download monthly statements for their bookkeeper. Every result is announced afresh, even when it repeats. Retried requests return their first answer, even across restarts. A withdrawal whose answer was lost is retried with its own key, so it never draws twice. Every payment step lands in an audit trail that the database itself refuses to edit.

The API accepts only JSON. It answers only its published methods and paths, and marks every answer as not to be stored. It refuses a forbidden role before saying anything about a record's state, and its errors reveal nothing about the server. Every session change lands on a published page. A session signed out elsewhere returns the user to exactly where they were after they sign back in. Tallwind starts even while its database is unreachable and writes its starting data the moment the database first answers.

Visitors read the marketing pages with mouse or keyboard alone. They compare plans and share annual pricing by its address, open a sample-data demo, send a sales inquiry and sign up into an empty company of their own.

Everything is stored in the one PostgreSQL database named under Services. These are out of scope: any other datastore, any mail transport, any model provider, any third-party service, real card capture, real bank rails, and taking payment for a plan. Money never moves "on screen only": every balance and feed change you show is the stored result of a server operation.

## Problem and users

Founders of small companies move real money between tools that disagree with each other:

- A double click sends a payment twice, and a retry after a restart sends it again.
- A withdrawal whose answer was lost on a flaky connection draws a second time when pressed again.
- Typing "1,234.56" sends one dollar, or a fee is rounded the wrong way on an exact half cent.
- A vendor gets saved twice and then paid twice.
- A vendor name full of emoji is cut in half, a pasted control character breaks the page, or hidden direction marks make one vendor's name read as another's.
- A deleted vendor takes its payment history with it, or gets paid while it is being deleted.
- A confirmation dialog lets Tab wander into the page behind it, and a keyboard shortcut does nothing while the cursor sits in a text field.
- A big wire leaves because one person pressed a button.
- Money that is "waiting for approval" gets spent a second time.
- A payment waiting for approval sits forever, or its deadline shows a day early because the laptop is in another time zone.
- Two approvers pressing at once leave a payment stuck, or paid twice.
- A screen reader announces a column of identical "Approve" buttons. Focus vanishes after each decision, and the list goes stale while a colleague decides payments elsewhere.
- A payment sent at 4:05 in the afternoon is promised for today, because the laptop's clock or time zone was wrong.
- A half-typed payment is lost when the session ends.
- A "Friday" payment lands on a bank holiday, or posts an hour early because a server counted midnight with last season's clock.
- A search for "50%" returns every row, a search ending in a backslash crashes, or a slow answer for earlier text replaces the answer for what is typed now.
- A filtered view or a pricing comparison vanishes on reload, so nobody can share it.
- After paging deep into the feed, the next automatic refresh throws the paged-in rows away and steals focus.
- Two figures on one screen disagree because they were read a moment apart.
- A live feed silently stops after a network blip or a restart, keeps streaming on a shared laptop after sign-out, or a pile of open tabs exhausts the server.
- On a shared laptop, the next person to sign in glimpses the last company's balances. Or a request still in flight from the old session pulls the home page back to Log in.
- A phone's "hidden" navigation drawer still traps the Tab key in invisible links.
- A confirmation that repeats the last one is never read aloud.
- A server started during a database blip never sets itself up, or dates its history from the wrong day.
- A sign-in page reveals which emails have accounts, by its words or by how long it takes to answer. Signing back in after a forced sign-out dumps the user on a page they were not on.
- A colleague without permission is told a payment's status instead of being told they may not touch it.
- An error page prints the database's internals.
- A vendor's name or memo in the bookkeeper's spreadsheet runs as a formula.

Tallwind gives them one calm screen where:

- every balance is exact to the cent, held money is visibly set aside, and every figure in one view agrees with the others
- every payment posts exactly once or not at all, with an honest settlement date decided by the server
- large payments need a second pair of eyes before a deadline the server dates
- every screen keeps the user's place, focus and words through refreshes, outages, sign-outs and colleagues' actions
- the history cannot be edited
- no request can set what only the server decides
- one company's data never reaches anyone outside it, not even the next person on the same browser tab

| Role | Goal and limits |
|---|---|
| Visitor | Reads the marketing site by mouse or keyboard alone, compares plans and shares annual pricing by its address, opens the sample-data demo, sends a sales inquiry, then signs up into a new empty company or signs in. Sees no company data, including nothing of whoever used the same browser tab before. |
| Owner | Watches each account's balance and available balance from a desk or a phone, and every figure in one view agrees with the others. Filters, searches and shares the feed by its address, and pages deep into it without the live refresh losing their place. Adds and removes recipients by keyboard. Pays vendors before each method's cutoff, typing amounts as dollars, with a settlement date the server promises. Resumes a half-finished send on its review step after being signed out elsewhere. Schedules payments, marks invoices paid, draws on the venture line without a lost answer ever drawing twice, and moves money between accounts, hearing every result announced. Downloads monthly statements. Gives final approval on held payments created by someone else before their server-dated deadline. Signs out of a shared laptop knowing every open view stops at once and nothing from the old session acts afterwards. After a sign-out from another device, signs back in to exactly where they were. |
| Admin | Pays vendors, adds and removes recipients, marks invoices paid and moves money. Approves or rejects held payments created by someone else from an Approvals page that works fully by keyboard and screen reader. That page shows each row's server-dated "Approve by" deadline and updates live without losing focus. Large payments still need a second distinct approver, even when the owner or a member acts at the same moment or a payment expires while the admin looks at it. Cannot draw on the venture line. |
| Member | Adds recipients, by keyboard when they like, and finds vendors in the command palette, whose matches always fit the text typed. Creates payments and transfers. A payment over the approval threshold is held against the available balance and waits for owners or admins until it is decided or expires, whatever extra fields the request carries. May cancel only their own scheduled payments. A send racing a recipient's removal never pays a removed vendor. Cannot remove recipients, approve, reject, mark invoices paid, draw on the loan or read the audit trail. |
| Outsider | A signed-in owner of a different company, Outpost Goods. Must never see or touch Larkspur Studio data through any page, address parameter, list, search, stream, statement, quote, idempotency key, id (well-formed or not), body field, string holding a NUL or a lone surrogate, content type, or unpublished method or path. This includes a browser tab the Larkspur owner just signed out of. Learns nothing about the server from its errors or from how long sign-in takes. |

## Journeys

1. **Visitor to cockpit.**
   - **Header menus.** A visitor lands on the home page. Using only the keyboard, they focus "Products" in the header and press Down Arrow: the panel opens with its first link focused. Arrow keys, Home and End move through the links and wrap around. Escape closes the panel and returns focus to "Products". No link of a closed panel can be reached with Tab.
   - **Pricing by address.** They open Pricing and switch on "Annual Pricing (15% off)". The address now carries the annual setting, and they copy it. Opening the copied address in a new tab shows annual prices at once. Back in the first tab, pressing Back returns to monthly prices.
   - **Demo and sign-up.** They press "Launch demo" to see the sample-data demo. Then they press "Open account" to sign up, and land on `/app` in a new company of their own. It holds one Checking account at $0.00 with a flat sparkline and an empty feed, and no recipients, invoices or loans.
   - **Owner sign-in.** Signing in as the Larkspur Studio owner instead lands on the cockpit home. The Total cash card and one card per account each show a balance and an "Available" figure. Each account card has a thirty-day sparkline that steps through the seeded history on New York calendar dates. The history is dated from the day the starting data was written, even when Tallwind was started before its database could be reached. The transaction feed sits below. Opening Log in again while signed in goes straight back to the cockpit.
   - **Exact widths.** In a window exactly 1024 pixels wide the accounts rail sits inline and all the snapshot cards share one row. At 1023 pixels the rail hides behind "Accounts menu" and the cards sit two across. Tabbing through the page never lands on a hidden account link, Profile or Log out. Opening the drawer puts focus on the active account, Tab wraps inside it, and Escape returns focus to "Accounts menu". Widening the window back to 1024 pixels while the drawer is open closes it and leaves focus on the active account in the inline rail.
2. **Recipients.**
   - **Save and duplicate.** The owner opens Recipients, presses "Add recipient" and saves a new business vendor with an ACH account. It appears in the list showing only the last four digits of its account. The owner then tries to save another vendor with Northwind Supply's routing number and full account number. The form keeps the typed values and names Northwind Supply as already saved. A vendor whose different account number merely ends in the same four digits saves normally.
   - **Names as typed, by keyboard.** The member is typing in "Display name" and presses Control+K, and the command palette opens. They type "no", pause, then type "rt". The Recipients group only ever lists recipients matching "nort", even when the server's answer for "no" arrives last. Escape returns them to the field. They save a vendor whose name is 120 emoji by pressing Enter, and the list shows exactly those 120 emoji. Each of these is refused on its own field: one more character, a NUL, a lone surrogate, a hidden text-direction override, or account and routing numbers written in fullwidth or Arabic-Indic digits. Nothing is saved, and focus lands on the first failing field. A name written in Arabic script without such controls saves exactly as typed.
   - **Remove by keyboard and save again.** The owner tabs to a test vendor's "Remove" button and presses Enter. The confirmation dialog opens on "Keep", and Tab and Shift+Tab move only between "Keep" and "Remove". They confirm. The vendor vanishes from the list, from search, from the command palette and from Send payment. Its past feed rows and payments still show its name. Saving its bank details again creates a fresh recipient.
   - **Removal racing a send.** The admin removes a stale vendor at the same moment the member sends it a payment, and exactly one of them wins. Either the payment is stored (and a held one keeps the vendor in place), or the vendor is removed and the send is refused. No waiting payment ever names a removed vendor.
3. **Filter, search, page, export, many tabs.**
   - **Filter.** On the cockpit home the owner filters the feed to ACH and then to Money out. The address now carries both filters. Reloading keeps them. Pressing Back once returns to ACH with "In and out".
   - **Search.** With memos "50% deposit", "500 deposit", "net_30" and "net30" in the feed, searching "0%" finds only "50% deposit", and searching "t_3" finds only "net_30".
   - **Page deep and keep it.** With 160 transactions in Checking, the owner presses "Show more transactions" twice and sees 150 rows, with focus still on the button and the search results for "net" still open. Over the next half minute three payments arrive and the ten-second refresh runs twice. The list grows to 153 rows with the three new ones on top. No row disappears or repeats, focus stays on "Show more transactions", the search stays open, and the row count is not re-announced. Later pages never repeat rows when new payments arrive.
   - **Statement.** The owner opens Checking, picks the current month under "Statement month" and downloads the statement under the account's own name. A vendor saved as `=SUM(A1:A9)` and a memo starting with `@` appear in the file as harmless text, and every amount stays a plain signed number.
   - **Outage.** The cockpit stays open while the database briefly refuses connections and then accepts them again. The app keeps running throughout. During the outage the cards keep their last figures, the cockpit says Tallwind can't be reached, and nothing can be paid. Right after the database returns, another session pays a vendor before the cockpit's stream has reconnected. The open cockpit announces that Tallwind is back, refreshes its figures and shows that payment without a reload, keeping every row already shown.
   - **Many tabs.** The owner's team leaves a hundred cockpit tabs open. Each still receives a new payment within two seconds, and the rest of Tallwind stays quick. Closing the tabs releases everything they held within seconds.
4. **Send at the cutoff, resume after a forced sign-out, then schedule.**
   - **Wrong laptop clock.** The owner's laptop is set to a far-off date and time zone. The business clock reads Friday 2 July 2027 at 15:59:40 New York time. They press "Send payment", pick Checking (its option shows the available amount), a recipient and ACH. Under Method the form reads "Settles Fri, Jul 2, 2027". They type "1,234.56" as the amount. The address now carries the draft, with the amount exactly as typed. They open the review step, which restates "$1,234.56" and the same settlement line, and the address gains the review step. As 16:00 New York time passes, the review step changes in place to "Settles Tue, Jul 6, 2027" within a few seconds and keeps everything typed.
   - **Signed out elsewhere, mid-send.** The owner's session is signed out from another device while the review step is open. The page lands on Log in, carrying the draft address. This happens either within a few seconds, when a background refresh or the stream discovers the revocation, or at the latest when they press "Confirm and send". After signing in they are back on the same review step. Every value is as typed, the settlement line comes fresh from the server, and no payment has been sent. They press "Confirm and send" once:
     - exactly 123456 cents leave Checking
     - a debit row with the recipient's name and an ACH chip tops the feed
     - "Payment sent Settles on Tue, Jul 6, 2027" is announced
     - a short shower of falling notes passes over the snapshot
     - the address returns to a plain, empty Send payment form
   - **Over the limit.** An amount larger than the available balance, or one written with three decimals, is refused in the form before the review step opens. A valid amount over $5,000.00 shows "Settles once approved".
   - **Scheduled.** With the business clock on Friday 2 July 2027, the owner fills in "Send on" with Saturday 3 July 2027 and confirms. The settlement line disappears while "Send on" is filled. The payment is stored as scheduled and the balance does not change. The announced confirmation names Tuesday 6 July 2027 as the date it takes effect. That is the next Federal Reserve business day, because the Sunday Independence Day is observed on Monday.
   - **Posting at midnight.** At 23:59 New York time on Monday 5 July the payment is still scheduled. Shortly after midnight New York time on Tuesday 6 July it posts on its own and Checking drops. It also posts if the server was down at that midnight: it catches up as soon as the server is healthy again.
   - **Daylight saving.** A payment scheduled in winter for Monday 15 March 2027 posts just after midnight New York daylight time, not an hour late. One for Monday 8 November 2027 posts just after midnight standard time, not an hour early. Real-time payments scheduled for the transition Sundays themselves post just after those Sundays' own midnights.
5. **Holds, dual approval, deadlines and a live Approvals page.** These steps run in this order on the seed data.
   - **Held.** The member sends $50,001.00 from Savings. The request also carries fields claiming the payment is already posted and needs no approvals, and the server ignores them. The payment waits in Approvals as needing two approvals. Savings' balance is unchanged, but its "Available" figure falls by $50,001.00 at once, while Total cash stays the same. Every cockpit page's rail now reads "Approvals, 1 waiting".
   - **Held money cannot move.** The owner tries to transfer $10,000.00 of that held money from Savings to Checking, and the transfer is refused.
   - **First approval by keyboard.** The admin works the Approvals page by keyboard and screen reader. Their laptop's clock and time zone are wrong. The row shows "Approve by" with the date the server set, five Federal Reserve business days after the payment's New York creation date. The row's Approve button is announced with its amount, recipient and source account. The admin approves. The row now reads one of two approvals with the admin's name, focus sits on that row's Reject button, and no money has moved. A second press by the admin is refused.
   - **Second approval.** The owner approves. Only then does Savings drop and the debit top the feed. The row leaves the list. The owner's focus lands on the next row's Approve button, or on the Approvals heading when no row is left.
   - **Decisions made elsewhere.** The member creates two held $6,000.00 payments from Checking to Northwind Supply and one held $6,400.00 payment from Checking to Northwind Supply. With the seed data, Checking's available balance covers all three holds and leaves $20.50 available. The admin keeps Approvals open with focus on the second $6,000.00 row's Approve button. The owner rejects the first $6,000.00 payment from another device. Within five seconds:
     - that row leaves
     - the focused button's name drops its "payment 2 of 2" suffix while focus stays on it
     - "Payments waiting for approval: 2" is announced
     - the rail reads "Approvals, 2 waiting"

     When the owner then rejects the focused payment elsewhere, the admin's focus moves to the $6,400.00 row's Approve button. When the owner rejects that last payment too and its row goes, focus lands on the Approvals heading, never on the page itself.
   - **Simultaneous approvals.** The owner draws $50,000.00 from the venture line into Checking. The member sends another $50,001.00 payment, this time from Checking. The admin and the owner press Approve at the same moment. Both approvals count, the payment posts, and Checking drops exactly once. While this and other approvals and transfers run, every snapshot the owner's cockpit reads agrees with itself: each available figure and total matches the balances in the same answer.
   - **Approval against rejection.** The member sends $6,000.00 from Checking. The admin's approval and the owner's rejection arrive at the same moment. The payment ends up either posted or rejected, never both. Every "Available" figure still equals its balance minus the payments still waiting.
   - **Expiry.** On a Tallwind whose business clock has moved on, a held payment nobody decided reaches midnight New York time on its fifth business day. Within a minute it is marked expired. Its hold is released once, its row leaves the open Approvals page within five seconds with focus following the published rule, and Payments shows it as Expired. A late approval is refused.
   - **Forbidden whatever its status.** The member tries to cancel a payment the owner scheduled, and later one the owner already sent. Both times the answer is that the member may not, never a remark about the payment's status.
   - **Audit.** Every step, including the expiry, appears in the owner's audit trail, attributed to whoever acted or to the system, and the database refuses any attempt to change it.
6. **Money in and between accounts.**
   - **Invoices.** On Invoicing, the owner marks Fieldstone's sent invoice paid into Checking. Even with a double click, one request is sent. Checking rises by the invoice total exactly once, one credit row appears and "INV-1004 marked paid" is announced once. The draft invoice cannot be marked paid until it is sent.
   - **Venture line.** On Loans, the owner types "$0.29" as a withdrawal. Checking rises by exactly 29 cents, and the line's remaining credit falls by the same amount at the moment "$0.29 credited to Checking" is announced. A second identical withdrawal is announced again as a separate message. A withdrawal larger than the remaining credit is refused, and refused again on a second press, with each refusal announced.
   - **Lost answer.** On a flaky connection, the next $0.29 withdrawal reaches the server, but its answer never comes back. The figures stay as they were and the page says Tallwind can't be reached. Pressing "Request withdrawal" again with the same text replays the stored answer instead of drawing again, so the line is drawn once. A client that retries a withdrawal with its original key, even after a later withdrawal and a server restart, gets back the first answer's figures and no second credit.
   - **Everything at once.** Three invoices are marked paid into Checking, the owner draws on the line into Checking, and the admin pays a vendor from Checking and moves money in from Savings, all at the same moment. No update is lost: Checking equals its credits minus its debits.
   - **Opposite transfers.** The admin moves money from Checking to Savings while the owner moves money from Savings to Checking at the same moment. Both settle, each as a pair of rows, and total cash is unchanged.
7. **Sales inquiry.**
   - A visitor opens "Contact sales" and fills in the inquiry form. A live counter shows how much of the message limit they have used, counting an emoji or an accented letter as one character. It counts the way the server does, including text that grows when normalised. Mistakes are reported field by field.
   - A valid inquiry shows the thank-you copy.
   - Repeated inquiries from one address are refused after the published number within the rate window. This holds however the address is capitalised or padded with spaces, even when the inquiries are sent all at once, and even when a crafted request claims it was sent long ago. Malformed inquiries are answered quickly and never use up that allowance.
8. **Sessions and the outsider.**
   - **Sign-in probes.** Before signing in, the outsider tries addresses on Log in. An address with no account is refused with exactly the same message as a wrong password, in about the same time. After five tries it is locked out just like a real address, even when the tries are sent all at once and even after the server restarts. A Log in link whose `next` points away from Tallwind, or climbs out of the cockpit with dot segments or encoded slashes in its path, lands on the cockpit home instead.
   - **Shared laptop.** The Larkspur owner is signed in on two browsers. On one of them, while a refresh is still in flight, they sign out from the avatar menu. It lands on the home page and stays there: no late answer, timer or stream reconnect from the old session turns it into Log in or shows outage copy, and the page sends no further request with the old token. Its live feed stops at once, and Back reveals no cockpit data. The other browser keeps receiving new transactions.
   - **Next user on the same tab.** The outsider then signs in on that same tab. They never see one Larkspur name, figure or Approvals count, even for a moment, and the cockpit never requests a Larkspur account. Signing up on that tab instead shows only an empty Checking account.
   - **Own data only.** Signed in as the owner of Outpost Goods, the outsider sees only Outpost data: their own balances, live feed, search results and statements. Opening the cockpit with a Larkspur account id in the address shows their own unfiltered feed. Larkspur Studio's ids are unknown in every request and body field, and nothing moves.
   - **Malformed requests.** Garbled ids, fractional or text amounts, strings holding a NUL or a lone surrogate, and plain-text bodies get the published error answers. No answer reveals anything about the server.
   - **Unpublished methods and paths.** Changing, deleting or querying options on Larkspur accounts and payments is refused as a method Tallwind does not offer. Guessed reset, seed and debug addresses do not exist.
   - **Sign-up.** A sign-up carrying Larkspur's company id and an admin role creates an ordinary new company owned by the new user.
   - **Signed out elsewhere.** The owner has the feed filtered to ACH money out on one browser, and their session there is signed out from another device. Within five seconds the cockpit is replaced, once, by Log in carrying that filtered address. Signing in lands straight back on the same filtered feed.

## Mandatory requirements

This is the complete list of mandatory requirements; every check traces to one of these lines and the detailed sections below.

- **DP-01 — Snapshot from integer cents** Every balance and amount is stored and returned as integer cents. GET /api/snapshot reports total cash and total available equal to the sums over the accounts, with each account's balance, available balance and a thirty-day sparkline of end-of-day New York balances ending at its current balance.
- **DP-02 — Cockpit home** Signing in lands on the cockpit home. Its snapshot shows a Total cash card, one card per account with its balance, its "Available" figure and a small sparkline, and a fully rounded "Send payment" pill.
- **DP-03 — Accounts rail and top bar** The cockpit shows a left accounts rail whose active account is a raised near-black row marked as the current page, and a top bar with the universal search field and a round avatar menu.
- **DP-04 — Read balances aloud** A "Read balances aloud" button beside the snapshot speaks the total cash and each account balance through the browser's speech synthesis, and is disabled when the browser has none.
- **DP-05 — Live transaction stream** GET /api/stream delivers every new transaction of the caller's company as a transaction event carrying an event id within two seconds.
- **DP-06 — Feed order and filters** The transaction feed lists transactions newest first, and its account, method and direction filters return only matching transactions.
- **DP-07 — Feed paging, search and statements** The feed pages by a cursor bound to its filters that never repeats or skips a row even when new transactions arrive, and answers fifty rows when no limit is given. Search finds only the caller's own recipients and transactions, as qualified in DP-69. Each account has a CSV statement dated by New York calendar day with a running balance; its counterparty and memo cells can never run as spreadsheet formulas, while amounts stay plain signed numbers.
- **DP-08 — Feed rows on screen** The cockpit feed is a list with one row per transaction, each amount carrying a sign and a direction word in a monospace face, and a filter change is announced.
- **DP-09 — Recipients show only the last four digits** A saved recipient returns only the last four digits of its account and keeps its display name exactly as typed after trimming, and an email invite creates a pending recipient.
- **DP-10 — Recipient validation** Each of these is refused on its own field, and nothing is stored: a blank or over-long display name, an account or routing number that is not a string of ASCII digits, an account number outside four to seventeen digits, or a routing number that fails the ABA checksum.
- **DP-11 — One recipient per bank account** Saving a routing number and full account number the company already holds as an active recipient is refused with the existing recipient's id, and so is inviting an email that already has a pending invite, even when the requests arrive at the same moment. An account that only shares the last four digits is saved.
- **DP-12 — Recipient form and list** The add-recipient form saves a recipient into the list. For a duplicate, it keeps the typed values and names the existing recipient on the Account number field. Each row's remove button, shown to owners and admins, confirms in a dialog and announces the result.
- **DP-13 — Command palette** Control+K or Command+K in the cockpit opens the "Command palette" dialog. It finds cockpit pages, and active recipients from the server's search, and opens the highlighted match on Enter.
- **DP-14 — Atomic payment posting** A payment within the approval threshold and the source account's available balance is completed in one server operation: it drops the stored balance, writes a debit at the top of the feed and is stored as posted with its effective date.
- **DP-15 — Payment refusals** These payments are refused with nothing moved: one over the source account's available balance, one with a zero or negative amount, one to a pending or removed recipient, and one scheduled for today or earlier in New York. An unknown payment answers 404.
- **DP-16 — Idempotent and race-safe sends** A replayed Idempotency-Key within 24 hours of its first success moves money once. A reused key with a different body is refused. Simultaneous sends never take an account's available balance below zero.
- **DP-17 — Federal Reserve business days** A scheduled ACH, wire or check payment takes effect on the first Federal Reserve business day on or after its chosen date, with Sunday holidays observed on Monday and Saturday holidays not moved to Friday. A scheduled RTP payment takes effect on its chosen date. Either kind can be cancelled until it posts.
- **DP-18 — Currency quotes** A currency quote converts at the published fixed rate, rounding half up, and adds a one percent fee. It is debited once, by one wire, and is usable only while the business clock is before its expiry instant.
- **DP-19 — Send payment screen** The send-payment form lists each source account with its available balance and restates the payment on a review step. After "Confirm and send" it announces the result, including a moved effective date or a later settlement day. It shows the insufficient-funds message while keeping the typed values.
- **DP-20 — Send celebration** A successful send drops a short shower of falling notes that fades, never blocks a click and is absent under reduced motion.
- **DP-21 — Approval threshold** A payment over $5,000.00 waits as pending_approval, with nothing debited and no effective date, until it collects its required approvals, is rejected or expires. Acting on a payment that is no longer pending is refused.
- **DP-22 — Who may approve or reject** Only an owner or admin who did not create a held payment may approve it. Any owner or admin may reject it. A member can do neither. A rejection marks the payment rejected and moves nothing.
- **DP-23 — Dual approval above $50,000** A held payment over $50,000.00 needs two distinct approvers. The first approval moves nothing, a repeat by the same approver is refused, and only the second distinct approval posts it.
- **DP-24 — Hash-chained audit trail** Every payment step, expiry and money movement writes one event into the company's hash-chained audit trail in the same transaction, and a refused request writes none.
- **DP-25 — Approvals screen** The approvals page lists each held payment as a readable row naming its creator, recipient, method, source account, amount and approval progress, with Approve and Reject acting on it.
- **DP-26 — Invoices settle once** Marking a sent invoice paid credits its total into the chosen account exactly once, even under retries and simultaneous requests. A paid or draft invoice is refused with nothing moved.
- **DP-27 — Venture line draws** A draw on the venture line credits its funding account and raises the drawn amount in one operation. It never goes beyond the remaining credit and happens only once per idempotency key.
- **DP-28 — Transfers between own accounts** A transfer moves money between two accounts of one company as a paired debit and credit, judged against the source's available balance. A transfer to the same account is refused.
- **DP-29 — Invoicing and loan screens** The invoices page marks a sent invoice paid into a chosen account, and the loans page requests a withdrawal, each announcing its result. Repeated presses while a request is pending send one request and credit once. A withdrawal press after an answer arrives is a new withdrawal, as qualified in DP-92.
- **DP-30 — Company money is private** Anonymous callers get 401. A signed-in user outside the company finds none of its accounts, payments, recipients, invoices or loans by id, list or search. A member cannot read the audit trail.
- **DP-31 — Derived surfaces stay inside the company** Another company's stream events, statements, quotes and idempotency keys, and any of its ids inside a request body, are unknown to the caller. Nothing moves, nothing is stored and no audit event is written.
- **DP-32 — Sessions and sign-up** Sign up starts a session that survives a reload and sign out ends it. A taken email is refused, and a wrong password is refused as invalid credentials.
- **DP-33 — Sign-in and sign-up screens** The sign-up and log-in forms show their inline error copy. Log in returns only to a safe cockpit path named in next, with its query kept, and otherwise to /app. After signing out, the back button reveals no cockpit data.
- **DP-34 — Sales inquiries** A valid inquiry is stored with its source, a server-issued id and the business clock's time. An invalid one is refused field by field. A honeypot inquiry is answered as a success and not stored.
- **DP-35 — Inquiry limits** Inquiry fields are trimmed, normalised to NFC and measured in Unicode code points against published limits. A body over 32,768 bytes is refused. A sixth inquiry within the rate window from one email, ignoring letter case and surrounding spaces, is refused even when the inquiries arrive together.
- **DP-36 — Contact form** The contact page form marks Email, First name, Last name, Company and Message "(Required)", counts message characters live, and shows the thank-you copy or a message per failing field.
- **DP-37 — Home page** The home page carries the "Calm banking for companies on the move" hero with its calls to action, a captioned product tour with a transcript, and a "Launch demo" link to the sample-data demo.
- **DP-38 — Pricing and product pages** The pricing page shows three plans whose prices count up as they enter view, with an annual toggle and a jump list. The payments, treasury and spend pages show their fee and speed table, rate table and budget cards.
- **DP-39 — Marketing chrome** The marketing header is fixed and frosted, with Products, Solutions, Resources and About menus and an "Open Menu" toggle on narrow screens. The footer carries its link groups and the partner-bank disclaimer.
- **DP-40 — Routes and health** GET /api/health answers 200 only while the database is reachable and the schema applied, and 503 otherwise. An unknown page address answers 404 with a not-found page that links home.
- **DP-41 — One accent on bright surfaces** Every clickable action wears one blue accent on near-white surfaces, with a muted violet tint on the credit card page and a warm sand tint on the payments and spend pages.
- **DP-42 — Phone layout** The public and cockpit pages reflow at 320, 375, 768 and 1280 pixels wide without sideways scrolling. Hero buttons go full width on phones, and the cockpit rail becomes a drawer as qualified in DP-76.
- **DP-43 — WCAG 2.2 AA pages** The public pages and the cockpit pages listed under Browser support and performance pass the WCAG 2.2 AA checks.
- **DP-44 — Visible keyboard focus** Every control reached by keyboard shows a visible outline at least 2 pixels wide.
- **DP-45 — Quiet motion** Cockpit panels fade in with a small upward slide in under half a second. The home page product still uncovers with scroll and re-covers on scroll back. A reduced-motion preference removes all movement, as qualified in Motion and effects.
- **DP-46 — Exact starting state** The seeded company's sparklines match the published seeded history index for index. A new sign-up's company holds only one empty Checking account and nothing else. Restarting the app changes no row except due effective-date postings and failures and due approval expiries.
- **DP-47 — Feed filters live in the address** The cockpit feed's account, method and direction filters are mirrored in the address, so reloading or opening it restores them and Back undoes each change. An unknown or foreign value falls back to the default and leaves the address.
- **DP-48 — Simultaneous approval decisions** Approvals and rejections of one payment are applied one at a time. Two distinct approvers acting together both count and post the payment once, and a final approval racing a rejection leaves exactly one outcome with the other refused.
- **DP-49 — Server-owned fields** Keys a request body carries beyond those its endpoint reads are ignored. No body, inquiries included, can set an id, timestamp, status, role, company, approval count, creator, deadline, balance, total or funding account.
- **DP-50 — Enumeration-safe lockout** Sign-in with an unknown email answers exactly like a wrong password and in comparable time. Five failures for any email within the lockout window lock it, counted one at a time even when attempts arrive together, and kept across restarts.
- **DP-51 — Controlled business clock** The business clock starts at APP_NOW when it is set and then advances in real time. Every business time reads that clock rather than the database's, from row timestamps and the New York date to windows, expiries and scheduled postings.
- **DP-52 — Available balance and approval holds** Each account's available balance is its balance minus the total debits of its payments waiting for approval, and every funds check uses it. A hold is placed when a payment starts waiting and is released only by its final approval, its rejection or its expiry.
- **DP-53 — Monthly statements** A statement for a chosen month lists that account's transactions whose New York date falls in the month, with a running balance carried from the end of the previous New York month. A malformed or future month is refused. The statement downloads from the account page's "Statement month" picker under a file name that keeps the account's name in any script.
- **DP-54 — Resumable stream and outage recovery** A stream reconnect naming its last event id, even one issued before a restart, first replays the company's missed transactions oldest first. When the database refuses connections while the app runs and then accepts them again, the API recovers within ten seconds without a restart. The cockpit reconnects and shows the transactions created after the database returned, within the deadline stated under Interactions.
- **DP-55 — Removing a recipient** An owner or admin removing a recipient makes it unknown everywhere except its past feed and statement rows, and cancels its scheduled payments. Removal is refused while one of its payments waits for approval. Once removed, its bank account can be saved again.
- **DP-56 — Scheduled posting at New York midnight** A scheduled payment posts or fails against the available balance within sixty seconds after midnight New York time on its effective date. Each midnight, including on the daylight-saving transition days, is resolved by that date's own rule. A start after that midnight catches up every due payment in order within sixty seconds of becoming healthy.
- **DP-57 — Append-only audit enforced by the database** The database refuses every update, delete or truncate of the audit trail issued with the app's own credentials. Each company's chain stays gapless and correctly linked when events are written at the same moment.
- **DP-58 — Paired transfers without deadlocks** Both legs of a transfer share one transfer id and one timestamp. Simultaneous transfers in opposite directions between the same accounts each settle or are refused for funds, never failing with a server error.
- **DP-59 — Only the published API** Under /api only the listed methods and paths exist. Any other method answers 405 with an Allow header, any other path answers 404, and no source maps are served.
- **DP-60 — Keyboard-complete header menus** Each marketing header menu opens with Enter, Space or Down Arrow. It moves and wraps through its links with the arrow keys, Home and End, and closes on Escape, on Tab past its last link or on an outside click. Only one menu is open at a time, and no link of a closed panel can be reached or clicked.
- **DP-61 — Same-day cutoffs by method** A direct send or a final approval stamps the payment's effective date from its posting instant in New York local time, on either side of a daylight-saving change: today for ACH before 16:00 and for wires before 17:00 on a business day, otherwise the next business day; always today for RTP; and the next business day for checks. A scheduled payment keeps the effective date set when it was scheduled, as stated in DP-17.
- **DP-62 — Removal and send are serialised on the recipient** A recipient's removal and a send naming it are applied one at a time. Either the send is stored first and a held one blocks the removal, or the removal wins and the send answers 404. No waiting or scheduled payment ever names a removed recipient.
- **DP-63 — Holds release exactly once** After any mix of simultaneous held creations, approvals, rejections and expiries, every account's available balance equals its balance minus its still-waiting payments. Each hold is released once or not at all. When two held payments only fit one at a time, exactly one is stored.
- **DP-64 — Idempotency replays are stored, durable and endpoint-scoped** An idempotency key is scoped to its company and endpoint. Its replay returns the byte-identical first answer even after later changes and restarts, and compares every read key, including the memo. A key stops replaying exactly 24 hours after its first success.
- **DP-65 — Opaque errors and JSON-only bodies** Malformed ids answer like unknown ids, and non-integer or out-of-range amounts fail validation. A non-empty /api body that is not application/json answers 415. No error ever reveals a stack trace, SQL, a constraint name, a file path or the database's name.
- **DP-66 — Sign-out revokes every use of the token** Signing out closes that session's open streams within two seconds with no later event delivered. A reconnect with its token answers 401, and other sessions keep streaming.
- **DP-67 — Typed and bounded inquiry validation** An inquiry field that is not a JSON string fails validation on that field. Lengths are counted after NFC, even when normalisation lengthens text. Any body up to the cap is answered within two seconds, and only stored inquiries use a rate-limit slot.
- **DP-68 — Pricing billing period lives in the address** The pricing page mirrors annual prices as billing=annual in the address, with one history entry per toggle. Opening or reloading that address shows annual prices, Back restores monthly, and an unknown value is removed in place.
- **DP-69 — Literal bounded search** Search matches its 2-to-100-code-point query as literal case-insensitive text, so %, _, \ and * match only themselves. It returns at most 20 recipients and 20 transactions, and answers within two seconds without a server error, even for a query ending in a backslash.
- **DP-70 — Code-point names and clean text** A recipient display name is up to 120 code points as typed and is returned exactly. Every string the API reads refuses NUL and lone surrogates, single-line fields also refuse control characters and text-direction controls, and bank numbers must be strings of ASCII digits. Each refusal is on its own field, with nothing stored.
- **DP-71 — Exact dollar entry** The Amount and Withdrawal amount fields turn typed dollars such as "1,234.56" into exactly that many cents and refuse anything outside the published dollar format. Currency quotes round exact halves up.
- **DP-72 — Seed when the database first becomes reachable** An app started while its database is unreachable keeps answering health with 503 without exiting. Within ten seconds of the database becoming reachable, it applies its schema and writes the seed, dated from the New York date at that moment. An open cockpit keeps its last figures through a later outage and refreshes by itself after it.
- **DP-73 — Role checks answer before state** Inside one company, a forbidden role gets 403 before any malformed-body, validation, state-conflict or money answer. So a member cancelling another user's payment, or acting on a decided one, is refused as forbidden whatever its status. Another company's ids answer 404.
- **DP-74 — Named row actions and focus on Approvals** Each Approvals row's Approve and Reject buttons are named with the payment's amount, recipient and source account. When rows share those values, each name gains a position suffix, so every name on the page is unique. After a decision removes a row, focus lands on the next row's Approve button, else the previous row's, else the Approvals heading.
- **DP-75 — No lost updates on money in** Simultaneous invoice settlements, draws, sends and transfers on one account each succeed or are refused by their own rule, with every balance equal to its credits minus its debits. Two draws that only fit one at a time leave one credit, and a draft invoice is never settled while it is being sent.
- **DP-76 — Exact cockpit breakpoints** The cockpit lays itself out by the window's inner width in CSS pixels. The accounts rail sits inline from exactly 1024 pixels and is a drawer behind "Accounts menu" below that. Snapshot cards sit one per row below 600 pixels, two across from 600 to 1023, and all in one row from 1024. Approvals rows stack below 600 pixels.
- **DP-77 — Collapsed panels are unavailable** A closed accounts drawer, avatar menu, search results region or command palette is absent from the accessibility tree, unreachable by Tab and unclickable. The open drawer starts on the active account, keeps Tab inside, closes on Escape back to "Accounts menu", and closes itself when the window widens to 1024 pixels.
- **DP-78 — Feed refresh keeps the user's place** The cockpit's ten-second, stream-triggered and post-outage refreshes keep every row already shown and add new rows only at the top, without repeats. They keep focus, the search text and its open results, the statement month and the filter values, and never announce the row count.
- **DP-79 — Streams share a bounded set of connections** The app never holds more than ten database connections. A hundred open streams each receive their company's transactions within two seconds while other requests answer within two seconds. Everything a stream holds is released within five seconds of its client leaving.
- **DP-80 — Keyboard-complete recipients** The "Remove recipient" dialog opens on Keep, with Tab and Shift+Tab wrapping between Keep and Remove. Control+K or Command+K opens the command palette from any focused cockpit control, including text fields. A refused save moves focus to the first failing field, marked invalid and described by its message.
- **DP-81 — Settlement preview decided by the server** GET /api/me reports the business clock's instant, the settlement date each method would get now, and the next instant any of them changes. Send payment shows that settlement line under Method and on the review step, updating it in place within five seconds of that instant without using the browser's clock or time zone.
- **DP-82 — Live Approvals without losing focus** The Approvals page and the rail's Approvals link reflect any user's or the system's held creation, approval, rejection, posting or expiry within five seconds. Remaining rows update in place, so focus stays on the same payment's same button. When the focused row is decided elsewhere, focus follows the published rule, and the new count is announced.
- **DP-83 — Every result announced afresh** Each cockpit page's status region is present and empty from page load and is emptied before every message. Each result, refusal included, is announced exactly once even when it repeats the previous message, and a double-clicked action announces once.
- **DP-84 — Landing routes after every session change** Sign-in lands on its valid next or /app, sign-up on /app and sign-out on /. A signed-in user opening Log in or Sign up is replaced by the cockpit. A session revoked elsewhere replaces the cockpit page once with Log in, carrying its address as next, and returns there after sign-in.
- **DP-85 — Send payment draft lives in the address** The Send payment draft is mirrored in the address in a published order. Typing and choosing replace the history entry in place, and a successful review adds exactly one entry. Opening a draft address restores the draft and opens the review step only when its checks pass. Foreign or unknown values are removed in place.
- **DP-86 — A revoked send resumes on its review step** When the session is revoked elsewhere while Send payment's review step is open, the page is replaced by Log in carrying the draft address. This happens whether a background request or "Confirm and send" discovers the revocation. Signing back in lands on the same review step, with every typed value and a fresh settlement line. No payment exists until the owner confirms once more.
- **DP-87 — Held payments expire on the New York business calendar** A held payment expires at 00:00 New York time on the fifth Federal Reserve business day after its New York creation date. Within sixty seconds of that instant it is marked expired, with its hold released once. A decision at or after that instant is refused, even before the expiry is processed.
- **DP-88 — Approve-by deadline decided by the server** Each held payment carries server-set expires_at and approve_by. Each Approvals row shows "Approve by" with the date from approve_by, whatever the browser's clock or time zone, and leaves the list within five seconds of its expiry being processed.
- **DP-89 — Signed-in state is request-scoped** Every API answer is marked not to be stored, and concurrent requests from different companies each receive only their caller's data. After a sign-out, the next user in the same tab never sees or requests anything of the previous company.
- **DP-90 — Consistent snapshot reads** Each snapshot and accounts answer is read from one database snapshot, so its balances, available figures and totals agree with each other even while approvals and transfers commit.
- **DP-91 — Latest search answer wins** The command palette's recipients and the top-bar search results always belong to the text currently typed, and any answer for earlier text is discarded whenever it arrives.
- **DP-92 — Lost withdrawal answers retry with their own key** When a withdrawal gets no answer, or a 503 or 500, the Loans page keeps its figures and announces the failure. It reuses the same idempotency key on the next press with the same amount text, so a draw the server already made is replayed rather than repeated.
- **DP-93 — Nothing from a signed-out session acts afterwards** After Log out is pressed, the page sends no further request with the old token, closes its stream, cancels its timers and ignores late answers. Several simultaneous 401s after a revocation elsewhere replace the page only once.

## Frontend

### Screens and layout (DP-02, DP-03, DP-08, DP-12, DP-19, DP-25, DP-29, DP-37, DP-38, DP-39, DP-42, DP-46, DP-47, DP-53, DP-68, DP-72, DP-74, DP-76, DP-81, DP-85, DP-88)

**Cockpit shell.**

- **Mark.** The Tallwind mark heads the cockpit at the top left and links to `/app` on every cockpit page.
- **Accounts rail.** The accounts rail sits below the mark. Each account row links to `/app/accounts/<account id>` and shows the account name and its balance in tabular monospace figures.
- **Active account.** The active account is a raised near-black row with near-white text and is marked as the current page. On `/app` the first account is active: Checking, for both the seeded company and a new company. On an account page, that account is active.
- **Page links.** Below the accounts are links to Payments, Recipients, Approvals, Invoicing, Loans, Cards, Treasury and Bill Pay. The Approvals link's name carries the waiting count, as stated under Public screens and controls.
- **Top bar.** The top bar carries the universal search field, and its results panel opens beneath it. At the right is a round avatar badge with the user's initials. It opens a menu with Profile and Log out.

**Cockpit breakpoints.** Every cockpit width rule is judged on the window's inner width in CSS pixels, with these exact edges:

| Element | Below 600 | 600 to 1023 | 1024 and wider |
|---|---|---|---|
| Accounts rail | drawer behind "Accounts menu" | drawer behind "Accounts menu" | inline at the left, always visible; no "Accounts menu" button exists |
| Snapshot cards (Total cash plus one per account) | one per row | two per row | all in one row |
| Approvals rows | details stacked above full-width Approve and Reject buttons | details and buttons side by side | details and buttons side by side |

So with four snapshot cards, the cards form four rows at 599 pixels, two rows at 600 and at 1023 pixels, and one row at 1024 pixels.

**Cockpit home `/app`.**

- **Snapshot row.**
  - A Total cash card shows the total in large figures, with "Available $<total available>" beneath.
  - One card per account follows. Each shows its balance, "Available $<available>" beneath it, and a small sparkline of its last thirty days.
  - The "Send payment" pill and the "Read balances aloud" button sit at the right.
  - The placeholders are defined under Feedback states.
- **Transaction feed.** The feed sits below the snapshot, newest first. Each row shows:
  - a round avatar with the counterparty's two-letter initials
  - the counterparty name
  - a method chip: ACH, Wire, RTP, Check, Card or Transfer
  - the New York calendar date, such as "Oct 27"
  - the signed amount, right-aligned in monospace figures
- **Signed amounts.** A credit reads like "+$4,200.00" in calm green beside the words "Money in". A debit reads like "−$1,250.00" in burnt orange beside "Money out". The minus may be the true minus sign or the ASCII hyphen-minus.
- **Filters and paging.**
  - A filter bar above the feed holds three dropdowns: account, method and direction. Their values are mirrored in the page address, as described under Interactions.
  - The feed first shows one page of 50 rows, the API default. A "Show more transactions" button appends the next page and is absent when there is none.
  - A company with no transactions shows the line "No transactions yet."
- **When values update.** The snapshot (balances, available figures, sparklines), the rail balances and the feed refresh:
  - at once when the user's own action succeeds
  - within two seconds of any `transaction` event on the stream
  - at least every ten seconds while the cockpit home or an account page is open

  So another user's held payment lowers an available figure within ten seconds without a reload, and a payment posting at midnight appears within two seconds of its event. Feed refreshes in Interactions states how each refresh treats rows, focus and open controls. A refresh that fails never replaces a shown figure. The outage behaviour is under Interactions.

**Account page `/app/accounts/<account id>`.** It shows:

- the account's balance and its "Available $<available>" line
- its feed, limited to that account
- a filter bar with only the method and direction dropdowns
- a "Statement month" dropdown, followed by a "Download statement" button

"Statement month" lists twelve months, newest first. The first is the current New York month on the business clock, which is the month of `business_date` from `GET /api/me`. The eleven months before it follow. Each option reads the month name and year, such as "October 2026", and carries the value `YYYY-MM`. The current month is selected when the page opens.

**Recipients `/payments/recipients`.**

- Each row shows the recipient's display name and its kind (Person or Business). It also shows a masked hint such as "Checking 6612" and its method, or "Invite pending" for a pending invite.
- For owners and admins, each row ends with a "Remove" button. Members see no such button.
- "Add recipient" opens `/payments/recipients/new`. That page holds the recipient form, whose fields run in this order: Display name, Kind, Method, Account number, Routing number. Beside it is a short invite form that asks only for an email.
- The list loads when the page opens and reloads after each save or removal.

**Send payment `/payments/new`.**

- The form holds these fields, in this order:
  - the source account, with its available balance
  - a saved active recipient
  - a method
  - the settlement line
  - an amount
  - an optional memo
  - an optional "Send on" date
- The settlement line sits directly under "Method". Its copy is stated under Feedback states, and how it updates is stated under Interactions.
- "Review payment" replaces the form with a review step. The review step restates the source, recipient, method and amount, the settlement line when one is shown, and the chosen date when given. "Confirm and send" and a "Back" button sit below.
- The draft's values and step are mirrored in the address, as stated under Send payment draft and the address in Interactions.

**Payments `/payments`.**

- Lists the company's payments newest first. Each row shows:
  - the recipient's name, taken from the payment's `recipient_name`, so a payment to a since-removed recipient still shows that name
  - the amount
  - the method
  - the status word
  - its effective date, when the payment has one
- The status words are:

  | Status | Word |
  |---|---|
  | `pending_approval` | Awaiting approval |
  | `scheduled` | Scheduled |
  | `posted` | Posted |
  | `rejected` | Rejected |
  | `cancelled` | Cancelled |
  | `failed` | Failed |
  | `expired` | Expired |

- A scheduled payment also shows a "Cancel payment" button.
- The list loads when the page opens and after each cancel.

**Approvals `/approvals`.**

- The page opens with the level-1 heading "Approvals".
- There is one row per held payment, naming the creator, the recipient, the method, the source account and the amount. Rows are listed oldest created first, with ties broken by payment id.
- Each row shows "<given> of <required> approvals" inside the row itself. Once at least one approval exists, it also shows "Approved by <names>". `<given>` is the number of approvals so far, `<required>` is 1 or 2, and `<names>` lists the approvers' names joined by commas.
- Each row shows "Approve by <effective date>". The date is formatted from the payment's `approve_by`, as stated under Feedback states.
- Owners and admins see Approve and Reject on each row. Members see the rows without them.
- The list loads on open, reloads after each Approve or Reject on the page, and stays live as stated under Approvals in Interactions.

**Invoicing `/invoices`.**

- A table has one row per invoice: number, customer, total in dollars, and status (Draft, Sent or Paid).
- A Sent row carries a "Deposit to" dropdown of the company's accounts and a "Mark paid" button.
- A Draft row carries a "Send invoice" button.
- A Paid row shows "Paid".
- The table loads on open and reloads after each action.

**Loans `/loans`.**

- There is one card per loan, showing its name, principal, drawn amount, remaining credit and funding account.
- Each card has a "Withdrawal amount" field and a "Request withdrawal" button.
- The figures update from the server's answer after each withdrawal.

**Cards `/cards`, Treasury `/treasury-account` and Bill Pay `/bill-pay`.** Each shows its heading and the line "Nothing here yet for <company name>.", where `<company name>` is the signed-in user's company.

**Marketing pages.** All are public, load directly and are addressable:

- `/`
- `/business-banking`
- `/business-payments`
- `/credit`
- `/treasury`
- `/invoicing`
- `/spend-management`
- `/payroll`
- `/books`
- `/venture-debt`
- `/working-capital-loans`
- `/pricing`
- `/contact`
- `/demo`
- `/login`
- `/signup`

**Cockpit pages.** These need a session:

- `/app`
- `/app/accounts/<account id>`
- `/payments`
- `/payments/new`
- `/payments/recipients`
- `/payments/recipients/new`
- `/approvals`
- `/invoices`
- `/loans`
- `/cards`
- `/treasury-account`
- `/bill-pay`

Sessions in Interactions states what happens when a cockpit page is opened without a session, or loses its session.

**Demo `/demo`.** The demo is a read-only rendering of the cockpit home filled with invented sample figures. It opens with or without a session and calls no cockpit API. A banner reads "This is a demo with sample data", beside an "Open account" link.

**Home `/`.**

- **Announcement strip.** "New: Tallwind Payroll runs pay day from the same account that funds it".
- **Hero.** A centred hero with:
  - the headline "Calm banking for companies on the move"
  - the lede "Open an account in one sitting and see every dollar your company holds, owes and is owed on one quiet screen."
  - an email field with an "Open account" pill beside it
  - a "Launch demo" text link to `/demo`
  - a legal line naming the partner banks
- **"One ledger for the whole company."** Four feature blocks sit beside the scroll-revealed cockpit still:
  - Accounts and treasury (up to 3.75% on idle cash)
  - Lift Card and spend controls (1.5 percent cashback)
  - Payments and invoicing (no fees on USD payments)
  - Books and reconciliation
- **Social proof.** "Chosen by 38,000 small companies that would rather build than reconcile", with the testimonial "Tallwind replaced four tools with one calm screen; I see every dollar and move it in seconds." from Jordan Ames, founder of Fieldstone.
- **"Less admin, more runway."** Feature rows:
  - Issue a virtual card before the meeting ends
  - Schedule bills around bank holidays
  - Settle each invoice into the account you choose
  - Match receipts as they arrive
- **"Set up in one sitting."**
  - Open an account without a branch visit
  - Start spending with a virtual Lift Card the same day
  - Find any payment or recipient from the search bar
- **"Keep more of what you earn."**
  - No fees on USD payments
  - 1.5 percent cashback
  - Up to 3.75% on idle cash in Treasury
- **"Grown-up controls from day one."**
  - Every account in view
  - Rules that move money for you
  - Roles and approvals for your team
  - Pilot for quick answers
- **Trust stats.** 38,000 companies, $4B+ moved each month, 40+ currencies for wires, and a 4.8 average app rating.
- **Security.** Deposits are held at our partner banks, and every sign-in to move money is checked against your team's roles.
- A closing call to action, then the footer.

**Product tour on the home page.**

- A video element whose poster is a rendered still of the cockpit. It needs no video file.
- It carries a captions track in English, labelled "English", whose source is `/media/tour.vtt`.
- `/media/tour.vtt` is served as `text/vtt` in WebVTT format and holds three cues, in order:
  1. "Watch every account in one calm view."
  2. "Send a payment and see the balance move at once."
  3. "Large payments wait for a second approver."
- A "Show transcript" button beside the tour reveals the same three lines as page text.

**Business banking `/business-banking`.**

- **Hero.** "Accounts that keep up with the company", with the lede "Free checking and savings, virtual cards and same-day payments, run from one screen." and an email field with "Open account".
- **"Everything you need to bank with less effort".** An "Explore demo" link to `/demo`, then:
  - free checking and savings
  - corporate cards
  - free wires
  - transparent pricing
  - payments by ACH, wire, real-time payment or check
  - AI built into your account
- **"Let routine money move itself".**
  - scheduled payments
  - auto-transfer rules
  - approve payments via chat
  - accounting integrations
  - an API
- **"Spend limits your team can see".**
  - user-level permissions
  - approval rules for large payments
  - customisable card limits
- **Transparent-pricing panel.**
  - free checking and savings
  - zero monthly fees
  - free ACH
  - free domestic and USD international wires
  - 1 percent for non-USD international wires
  - free real-time payments
  - free checkbooks and mailed checks
  - 1.5 percent cashback

**Business payments `/business-payments`.** This page uses the warm sand tint.

- **Hero.** "Pay anyone, keep the fees", with the proof line "Most domestic Tallwind payments reach the recipient's bank by the next business day."
- **Fee and speed table.** Every row costs $0:

  | Method | Speed |
  |---|---|
  | Real-time payments | Instant |
  | ACH | 0 to 1 business days |
  | Domestic wires | 0 to 1 business days |
  | Checkbooks | N/A |
  | Mailed checks | 7 to 14 business days |
  | USD international wires | 1 to 3 business days |

- **Cutoff note.** "ACH sent before 4 p.m. and wires sent before 5 p.m. New York time on a business day settle the same day; real-time payments settle every day of the year."
- **Approval note.** "Payments that need approval wait five business days for a decision before they expire."
- **Global payments.**
  - a 1 percent fee for non-USD international wires
  - $0 for USD international wires
  - 40+ local currencies
  - 200+ countries and regions
- An FAQ that begins "Do ACH and domestic wires cost anything?".

**Credit `/credit`.** This page uses the muted violet tint.

- **Hero.** "A card that grows with your balance", for the Lift Card.
- **"From first hire to fiftieth".**
  - 1.5 percent cashback on all spend
  - limits that scale with the balance
  - build business credit
  - no personal guarantee
- An FAQ headed "Card questions, answered".

**Treasury `/treasury`.**

- **Hero.** "Put idle cash to work and keep it within reach.", with "Earn up to 3.75% on balances from $250K, with same-day access to most of it."
- **Rate table by balance tier.** It has same-day and 1-to-2-day liquidity columns, running from "$250K to $2M" at 3.30 percent up to "$20M to $50M" at 3.75 percent.
- A personalised-portfolio note for balances above $25M.

**Invoicing `/invoicing`.**

- **Hero.** "Invoices that land in the right account", with "Bill customers, see who has paid and settle each invoice into the account you choose, without leaving the cockpit."
- Payment options: card, Apple Pay, Google Pay, wire, ACH transfer and ACH debit.
- Recurring invoicing and reminders.
- A note that unlimited invoicing is free.

**Spend management `/spend-management`.** This page uses the warm sand tint.

- **Hero.** "Budgets your cards already know", with "Set a cap once, and every card swipe, reimbursement and receipt counts against it as it happens."
- **Four sample budget cards**, each showing a cap, a spent total, a remaining figure and a reset date:
  - Work meals
  - Office equipment
  - Wellness
  - Business travel

**Payroll `/payroll`.**

- **Hero.** "Payroll that runs from your checking account", with "Contact sales" and "Open account".
- **Onboarding checklist.** Five steps: Offer letter, Personal details, Direct deposit, Tax withholding and I-9 verification. Each step shows one of the states Signed, Done, In progress or Upcoming.

**Books `/books`.**

- **Hero.** "Bookkeeping that reads straight from your ledger".
- A $35/month pricing note.
- An FAQ that begins "What is Tallwind Books?".

**Venture debt `/venture-debt`.** "More months of runway, drawn when you need them", with "Check eligibility" and "Contact sales".

**Working capital loans `/working-capital-loans`.** "Inventory money for online sellers", with "Check eligibility".

"Check eligibility" buttons link to `/contact`.

**Pricing `/pricing`.**

- **Hero.** "Plans that start at zero", with "Core banking costs nothing each month; add Plus or Pro only when your team needs more."
- **Annual toggle.** An "Annual Pricing (15% off)" control. The label is fixed marketing copy. The annual figures it switches to are each plan's published `annual_cents`, printed as given and never computed from the monthly price. The toggle's state lives in the address, as described under Interactions.
- **Jump list.** Links to the page's sections: Banking, Sending and receiving money, Access to Treasury, Company cards, Expense management, Invoicing, Bill pay, Accounting, Taxes.
- **Three plans.**

  | Plan | Monthly | Annual | For |
  |---|---|---|---|
  | Tallwind | $0/mo. | $0 | banking and finance essentials |
  | Tallwind Plus | $23.90/mo. | $295.90 | more efficiencies and streamlined invoicing |
  | Tallwind Pro | $349.90/mo. | $2,399.90 | complex operations with a relationship manager |

- **Add-ons.** Books at $35/mo; Payroll at $100/mo plus $50 per person each month.
- Selecting a paid plan opens `/signup` and takes no payment.

**Marketing header.**

- A white bar fixed to the top with a frosted, blurred backdrop.
- **Left.** The logo mark and wordmark.
- **Centre.** The menu triggers Products, Solutions, Resources and About, then a Pricing link.
- **Right.** Dashboard and Log in links, and a filled "Open account" pill.
- **Menu panels.** Each trigger opens a white panel with large rounded corners and a soft, wide shadow. It holds these links, in this order:

  | Menu | Links, in order |
  |---|---|
  | Products | "Business banking" (`/business-banking`), "Payments" (`/business-payments`), "Credit card" (`/credit`), "Treasury" (`/treasury`), "Invoicing" (`/invoicing`), "Spend management" (`/spend-management`), "Payroll" (`/payroll`), "Books" (`/books`) |
  | Solutions | "Venture debt" (`/venture-debt`), "Working capital loans" (`/working-capital-loans`) |
  | Resources | "Demo" (`/demo`), "Plans and pricing" (`/pricing`) |
  | About | "Contact sales" (`/contact`), "Open an account" (`/signup`) |

- **Narrow windows.** Below 1024 pixels of window width, the centre and right groups collapse behind an "Open Menu" toggle. It slides in a full-height panel from the right, where the four menus appear as expandable groups with the same links.

**Footer.**

- **Banking:** Business Checking and Savings, Treasury, Business Credit Cards, Working Capital Loans, Venture Debt.
- **Platform:** Pricing, API, Security, Status.
- **Resources:** Help Center, Blog, Events.
- **Finance Ops:** Payments, Bill Pay, Invoicing, Spend Management.
- **Disclaimer:** "Tallwind Labs builds the software. Your deposits are held by our partner banks, Harbor Financial and Keystone N.A., each a Member FDIC."

**Not found.** An unknown page address answers with a not-found page carrying a link home.

**Layout at each viewport.** These layouts follow from the cockpit breakpoints above and the marketing header's 1024-pixel edge.

| Viewport | Layout |
|---|---|
| 1280 by 800 (desktop) | The cockpit rail sits inline at the left, taking about a fifth of the width. Snapshot cards sit in one row. Marketing feature rows sit side by side. The content column stops at a comfortable reading width and centres on wider screens. |
| 768 by 1024 (tablet) | The marketing header shows "Open Menu". The cockpit rail is a drawer opened from "Accounts menu" in the top bar. Snapshot cards sit two across. Feed filters sit in one row. Fee and rate tables show all columns. Approvals rows keep Approve and Reject side by side. |
| 375 by 812 (phone) | Everything stacks in one column. Hero buttons and the hero email field go full width. Snapshot cards stack one per row. Feed filters stack full width. Each feed row keeps its amount visible while the name wraps. Approvals rows stack their details above full-width Approve and Reject buttons. Tables scroll inside their own frame rather than widening the page. |

Every public and cockpit page also reflows at 320 pixels wide. At no width does the page scroll sideways. That includes a page showing a 120-emoji recipient name, which wraps.

### Public screens and controls (DP-02, DP-04, DP-08, DP-12, DP-13, DP-19, DP-25, DP-29, DP-33, DP-36, DP-37, DP-38, DP-39, DP-40, DP-47, DP-53, DP-60, DP-68, DP-69, DP-74, DP-76, DP-77, DP-80, DP-81, DP-82, DP-83, DP-88)

Only these roles and names are public; everything else is yours to choose. A "textbox" may be any labelled text input. A "select" is a native dropdown with that label.

| Screen | Role and accessible name | Visible copy |
|---|---|---|
| Home | heading level 1 | "Calm banking for companies on the move" |
| Home | textbox "Enter your email"; link or button "Open account"; link "Launch demo" | hero calls to action |
| Home | a video with a captions track; button "Show transcript" | the three tour cues |
| Demo | link "Open account" | "This is a demo with sample data" |
| Marketing header | banner landmark; buttons "Products", "Solutions", "Resources", "About", each with `aria-expanded` and `aria-controls` naming its panel; links "Pricing", "Dashboard", "Log in"; link or button "Open account" | as named |
| Marketing header menu panels | each panel is a region or list holding only links, with the names and order given under Screens and layout; present in the accessibility tree only while open | link names |
| Marketing header, narrow | button "Open Menu" with `aria-expanded`; inside the panel, buttons "Products", "Solutions", "Resources", "About", each with `aria-expanded` | a menu glyph |
| Footer | contentinfo landmark | link groups and the disclaimer |
| Pricing | switch or checkbox "Annual Pricing (15% off)" exposing its checked state; navigation "Jump to section" holding the jump-list links; one polite `status` region | plan names and prices; the pricing announcements from Feedback states |
| Contact | textboxes "Email (Required)", "First name (Required)", "Last name (Required)", "Company (Required)", "Message (Required)"; button "Send inquiry"; polite `status` region | counter "<n> / 5000" |
| Log in | textboxes "Email" and "Password"; button "Log in" | the log-in errors from Feedback states |
| Sign up | textboxes "Name", "Email" and "Password"; button "Open account" | the sign-up errors from Feedback states |
| Cockpit top bar | searchbox or textbox with the placeholder "Search transactions, recipients, or jump to a payment"; region "Search results", present only while open, holding one link or option per match; button "Account menu" with `aria-expanded`; menu items, links or buttons "Profile" and "Log out", present only while that menu is open | the user's initials; match names |
| Cockpit top bar, narrow | button "Accounts menu" with `aria-expanded`, present only while the window is narrower than 1024 pixels | a menu glyph |
| Cockpit top left | link "Tallwind home" to `/app` | the Tallwind mark |
| Cockpit rail | one link per account, the active one with `aria-current="page"`; link "Approvals, <waiting> waiting" while at least one payment waits, otherwise link "Approvals" | account name and balance |
| Cockpit home | button "Read balances aloud"; link or button "Send payment" | "Total cash" card; "Available $<available>" on every card |
| Cockpit home and account page | list whose accessible name contains "transaction", with one listitem per transaction; button "Show more transactions" while a next page exists | signed amount and "Money in" or "Money out"; "No transactions yet." when empty |
| Cockpit home | group "Filter transactions" holding selects "Filter by account" (options "All accounts", then one per account name), "Filter by method" (options "All methods", "ACH", "Wire", "RTP", "Check", "Card", "Transfer") and "Filter by direction" (options "In and out", "Money in", "Money out") | "<n> transactions shown" |
| Account page | group "Filter transactions" holding only "Filter by method" and "Filter by direction", with the options above; select "Statement month"; button "Download statement" | "Available $<available>"; "<n> transactions shown" |
| Every cockpit page | one polite `status` live region, in the page from load | the messages from Feedback states |
| After a send | an element with `aria-hidden="true"` and the attribute `data-celebration` | none |
| Command palette | dialog "Command palette", present only while open; textbox "Search commands"; one option per match | group labels "Recipients" and "Pages" |
| Recipients list | button "Remove <display name>" on each row, for owners and admins | the recipient rows |
| Remove recipient | dialog "Remove recipient"; buttons "Keep" and "Remove", in that Tab order | "<display name> will no longer appear in Recipients or Send payment. Past payments keep its name." |
| Add recipient | textbox "Display name"; select "Kind" (options "Business", "Person"); select "Method" (options "ACH", "Wire", "RTP", "Check"); textboxes "Account number" and "Routing number"; button "Save recipient"; textbox "Recipient email"; button "Send invite"; a failing field carries `aria-invalid="true"` and `aria-describedby` pointing at its message | field errors under each field |
| Send payment | selects "Source account", "Recipient", "Method" (options "ACH", "Wire", "RTP", "Check"); textboxes "Amount" and "Memo"; a date input "Send on"; buttons "Review payment", "Back" and "Confirm and send" | the settlement line; the review summary |
| Payments | button "Cancel payment" on each scheduled row | recipient names, status words and effective dates |
| Approvals | heading level 1 "Approvals", focusable from script but not in the Tab order; on each row, for owners and admins, button "Approve $<amount> to <recipient name> from <source account name>" and button "Reject $<amount> to <recipient name> from <source account name>", each followed by the position suffix described below when another row shares the same amount, recipient and source account; exactly one button on the page has each name | visible button text "Approve" and "Reject", each name beginning with its visible word; "<given> of <required> approvals", "Approved by <names>", "Approve by <effective date>" |
| Invoicing | one table row per invoice; on Sent rows, a select "Deposit to" and a button "Mark paid"; on Draft rows, a button "Send invoice" | invoice number, customer, total, status |
| Loans | textbox "Withdrawal amount"; button "Request withdrawal" | "Remaining" figure |
| Not found | at least one link to `/` | a link home |

`<waiting>` is the number of the company's payments in `pending_approval`, as a whole number.

In the Approvals names:

- `$<amount>` is the payment's `amount_cents` in the dollar format from Feedback states.
- `<recipient name>` is the payment's `recipient_name`.
- `<source account name>` is its source account's name.

Sometimes two or more rows on the page share the same `$<amount>`, `<recipient name>` and `<source account name>`. Then each of those rows' Approve and Reject names ends with " (payment <k> of <m>)". `<m>` is the number of rows sharing those values, and `<k>` is the row's position among them in list order, counting from 1. A row with no such twin carries no suffix. Suffixes are recomputed whenever the list changes, so a row's name can lose or change its suffix after another row leaves.

For example, two held $6,000.00 payments from Checking to Northwind Supply are named "Approve $6,000.00 to Northwind Supply from Checking (payment 1 of 2)" and "Approve $6,000.00 to Northwind Supply from Checking (payment 2 of 2)". Once one of them leaves, the other is named "Approve $6,000.00 to Northwind Supply from Checking".

For example, with the seed data at start, the member's $50,001.00 payment from Savings to Northwind Supply has the buttons "Approve $50,001.00 to Northwind Supply from Savings" and "Reject $50,001.00 to Northwind Supply from Savings".

### Interactions (DP-04, DP-08, DP-12, DP-13, DP-19, DP-25, DP-29, DP-33, DP-36, DP-39, DP-47, DP-53, DP-54, DP-60, DP-66, DP-68, DP-69, DP-70, DP-71, DP-72, DP-74, DP-77, DP-78, DP-80, DP-81, DP-82, DP-84, DP-85, DP-86, DP-88, DP-89, DP-91, DP-92, DP-93)

**Feed filters and the address.**

1. **Address form.** On `/app` the three filters are mirrored in the page address as `account=<account id>`, `method=<method>` and `direction=<in or out>`, in that order.
   - `<method>` is one of `ach`, `wire`, `rtp`, `check`, `card` or `transfer`.
   - `in` means "Money in" and `out` means "Money out".
   - A filter at its default ("All accounts", "All methods", "In and out") is left out. So with every filter at its default the address is plain `/app`.
2. **Changing a filter.** Each change reloads the feed with only matching transactions, announces the count, and adds exactly one browser history entry carrying the new address.
3. **Opening a filtered address.** Reloading, or opening an address that carries these parameters, sets the selects to match, shows only matching transactions and announces the count.
4. **Back and Forward.** Back returns to the previous address and restores its selects and feed, announcing the count. Forward redoes the change. Back from the first cockpit address leaves the cockpit as usual.
5. **Bad values.** A parameter with an unknown value is treated as its default, and so is an `account` the signed-in company does not own. The address is corrected in place by removing that parameter, without adding a history entry. Nothing about another company appears: no name, no row and no count.
6. **Account pages.** On `/app/accounts/<account id>` the same rules apply to `method` and `direction`. The account comes from the path, and an `account` parameter there is removed in place.
7. **No storage.** Filters are never written to browser storage. The address is their only home.
8. **Show more.** "Show more transactions" fetches the next page after the last row shown, with the current filters, and appends it. Appended pages never repeat a row already shown.

**Feed refreshes.** These rules apply on the cockpit home and account pages, to the ten-second refresh, the refresh after a stream event and the refresh after an outage.

1. Each refresh re-reads every row already shown under the current filters, across the whole span the user has loaded, plus any newer rows.
2. The number of rows shown never decreases, except on a filter change, Back, Forward or a reload.
3. New rows enter only at the top, in feed order, and no row ever appears twice. Rows already shown stay where they are, as the same elements.
4. Focus stays on the control that had it. With focus on "Show more transactions", it stays there.
5. The top-bar search text and its open results region, the selected "Statement month" and every filter select's value are kept.
6. These refreshes never announce the row count. Only a filter change, a reload, Back, Forward and "Show more transactions" announce it.
7. **Worked example.** Checking holds 160 rows. The owner presses "Show more transactions" twice, so 150 rows show. They leave focus on that button, with search results for "net" open. Three payments arrive over the next 25 seconds, while at least two timed refreshes run. Afterwards:
   - the feed shows 153 unique rows, with the three new ones first
   - every earlier row is still present
   - focus is still on "Show more transactions"
   - the search field still holds "net", with its results open
   - no "transactions shown" message was written after the last press

**Universal search.**

- Once the trimmed text in the top-bar search field reaches the minimum query length from Search in Business rules, the "Search results" region opens. It lists the matching recipients, then the matching transactions, from `GET /api/search`. The results refresh when typing pauses for about a quarter of a second.
- Shorter text closes the region, shows no results and sends no request. Text longer than the maximum is not sent, and the field keeps it.
- Choosing a recipient opens `/payments/new?recipient=<id>`, with that recipient chosen. Choosing a transaction opens the cockpit home filtered to that transaction's account.
- Escape clears the field and closes the region, keeping focus in the field.

**Latest answer wins.** These rules apply to the "Search results" region and to the command palette's "Recipients" group.

1. The matches shown always belong to the text currently in the field. Any answer for earlier text is discarded, whenever it arrives, even after the answer for the current text.
2. While the answer for the current text is still pending:
   - the "Recipients" group shows no options
   - the palette's highlight sits on the first matching page, or on nothing when no page matches
   - the "Search results" region shows no match belonging to earlier text
   - Enter never opens a match for text that is no longer in the field
3. The final keystroke is never dropped. Once typing pauses, a request for the current text is always sent, provided the text is within the length limits.
4. **Worked example.** Recipients "Snow Peak Supply" and "Northwind Supply" exist. The member types "no" into the palette, and the server's answer for "no" is delayed by one and a half seconds. They pause 400 milliseconds, then type "rt". At no moment does "Snow Peak Supply" appear, and once the answer for "nort" arrives the Recipients group lists exactly "Northwind Supply".

**Collapsed panels.** These rules cover the accounts drawer, the avatar menu, the "Search results" region and the command palette.

1. **Closed means gone.** While a panel is closed:
   - it is absent from the accessibility tree
   - none of its links or buttons is reachable by Tab or Shift+Tab
   - none of them receives clicks

   Moving a panel off-screen or making it transparent does not count as closing it. A panel becomes unavailable the moment it starts closing, even while its closing motion plays.
2. **Reopening during a close.** Reopening a panel while its closing motion plays leaves it open; no leftover timer hides it again.
3. **The drawer.** Below 1024 pixels, "Accounts menu" opens the drawer, which holds the whole rail: the account links and the page links.
   - On opening, focus moves to the active account link, the one marked `aria-current="page"`.
   - Tab from the drawer's last control wraps to its first, and Shift+Tab from its first wraps to its last.
   - Escape closes it and returns focus to "Accounts menu".
   - Choosing a link closes it and navigates.
   - "Accounts menu" reports `aria-expanded` "true" exactly while the drawer is open.
4. **Widening while open.** When the window widens to 1024 pixels or more while the drawer is open, the drawer state closes, "Accounts menu" disappears and the rail shows inline. If focus was inside the drawer, it moves to the active account link in the inline rail.
5. **The avatar menu.** "Account menu" opens it with focus on "Profile". Escape closes it and returns focus to "Account menu". While it is closed, neither "Profile" nor "Log out" can be reached.

**Live updates and reconnecting.**

- The cockpit keeps one stream open.
- When the stream closes or errors, the cockpit reconnects by itself, retrying every two seconds or sooner. It sends the id of the last event it received, so transactions created during the gap appear without a reload.
- When a reconnect answers `401`, the cockpit stops retrying and follows the revoked-session rule under Sessions.
- After a database outage, each transaction created once the database accepts connections again appears in the open cockpit by a deadline. The deadline is the later of two moments: twelve seconds after the database became reachable, or two seconds after the transaction's creation. That includes transactions created before the cockpit's stream has reconnected. No transaction can be created while the database is unreachable.

**Cockpit during an outage.**

1. When a snapshot, feed or rail refresh answers `503` or cannot reach the server, every card, sparkline, rail balance and feed row keeps exactly the figures it last showed. No card ever shows $0.00 in place of a known figure, a blank, or "NaN".
2. The status region shows the outage copy from Feedback states, once per outage.
3. The cockpit keeps trying. Within twelve seconds of the database accepting connections again, every figure refreshes from the server without a reload, following the Feed refreshes rules, and the recovery copy from Feedback states is announced once.

**Typing dollar amounts.** "Amount" on Send payment and "Withdrawal amount" on Loans read text the same way.

1. **Accepted form.** After trimming, the text is an optional `$`, then ASCII digits, then optionally a `.` followed by one or two digits. The digits are either ungrouped (`1234`) or grouped by commas in exact threes (`1,234`).
2. **Exact conversion.** The text becomes cents by exact digit arithmetic, never through a fractional number:

   | Typed | Cents sent |
   |---|---|
   | `1,234.56` | 123456 |
   | `$0.29` | 29 |
   | `4.35` | 435 |
   | `12.5` | 1250 |
   | `5,000.00` | 500000 |
   | `5,000.01` | 500001 |

3. **Refused text.** `12.345`, `1,23`, `-5`, `1e3`, `12.` and `abc` are refused with the dollar-format message at the field, before any request is sent, and every typed value stays. Text in the accepted form that comes to zero, and an empty field, get the amount message instead.
4. **Order of checks** on "Review payment": the dollar format, then zero, then the available balance, then the "Send on" date.
5. The review step restates the converted amount in the dollar format, so `1,234.56` reads "$1,234.56".

**Send payment.**

1. **The form.**
   - "Source account" options read the account name and its available balance, such as "Checking — $18,420.50 available".
   - "Recipient" lists active recipients by display name.
   - "Method" starts on ACH.
   - "Amount" takes dollars, as stated under Typing dollar amounts.
   - "Send on" is optional.
2. **The settlement line.** It always reflects the method currently chosen, using the copy rules in Feedback states.
   - Its dates come only from `settlement_dates` in the latest `GET /api/me` answer. The page never works out a date, a weekday, a cutoff or a holiday itself, and neither the browser's clock nor its time zone affects what it shows.
   - The page reads `GET /api/me` when it opens. Each answer gives the gap between `business_now` and `settlement_dates_change_at`. Starting when the answer is received, the page waits that long, using a timer that counts elapsed time rather than reading the wall clock. It then reads `GET /api/me` again within 5 seconds after that instant.
   - Each new answer updates the line in place, on the form and on the review step. It never clears a typed value, never leaves the review step and never moves focus.
3. **Checks on "Review payment".** Before the review step opens:
   - An amount over the selected account's available balance shows the insufficient-funds message.
   - A "Send on" date that is not after `business_date` from `GET /api/me` shows the date message.

   On any refusal, the review step does not open and every typed value stays.
4. **The review step.** It restates the recipient's display name, the method, the source account, the amount in dollars, the settlement line when one is shown, and the chosen date when given.
5. **Back.** "Back" does what the browser's Back does, returning to the form with the values kept.
6. **Confirm and send.** "Confirm and send" disables itself while the request is pending, so a double press sends one request. A new `Idempotency-Key` is generated each time the review step opens, including when it reopens after a sign-in, and reused on any retry of that step.
7. **The answer.** The page announces the matching success copy. Any settlement or scheduled suffix comes from the answer's own `effective_date`, so it tells the truth even when a change instant passed between the last preview and the send. On a refusal, the form returns with the typed values kept and the refusal copy at the matching field.
8. **After a posted payment.** The new debit row tops the cockpit feed, the balances update, and the celebration plays on the cockpit home.

**Send payment draft and the address.**

1. **Address form.** The draft is mirrored in the address as `/payments/new?source=<id>&recipient=<id>&method=<method>&amount=<typed text>&memo=<text>&send_on=<YYYY-MM-DD>&step=review`, with the parameters in that order.
   - `<method>` is `ach`, `wire`, `rtp` or `check`.
   - `amount` and `memo` hold the text exactly as typed, before any conversion. For example, `1,234.56` appears as `amount=1%2C234.56`.
   - Each value is encoded as a URL query value, so decoding the query gives back the exact text.
2. **Left out.** A field that is empty is left out, and so is `method=ach`. `step` is absent while the form is showing. So a fresh form is plain `/payments/new`.
3. **Typing and choosing.** Each change to a field replaces the current history entry in place. Typing never adds history entries.
4. **Reviewing.** A "Review payment" that passes its checks adds exactly one history entry, which carries `step=review`. Browser Back, or the page's "Back", returns to the form entry with every value kept. Forward reopens the review step.
5. **Bad values.** Opening or reloading a draft address removes these values in place, without a history entry, and leaves the other fields filled:
   - a `source` that is unknown or belongs to another company
   - a `recipient` that is unknown, belongs to another company, is removed or is a pending invite
   - a `method` that is not one of the four
6. **Opening the review step from an address.** An address carrying `step=review` runs the "Review payment" checks in their published order once `GET /api/me` has answered. The review step opens only when every check passes. Otherwise the form opens with the values and the refusal messages, and `step` is removed in place.
7. **After a success.** When "Confirm and send" succeeds, whether posted, held or scheduled, the current history entry is replaced by plain `/payments/new` before the success copy is announced. Back then never reopens the sent draft's review step.
8. **No storage.** The draft is never written to browser storage. The address is its only home.
9. **Resuming after a revoked session.** Sometimes the session is signed out elsewhere while the review step is open. The page may learn this in two ways, and both are the same event:
   - a background request, such as the rail's Approvals count refresh or a stream reconnect, answers `401`, usually within a few seconds
   - "Confirm and send" answers `401`

   Either way, the page is replaced once by `/login?next=<the encoded draft address, including step=review>`, as stated under Sessions.
   - Signing in lands on that exact draft address. The review step reopens with every value as typed and a settlement line from a fresh `GET /api/me`.
   - No payment was stored. A background discovery sends no payment, and a `401` answer stores nothing. The owner's single press of "Confirm and send" after signing in then sends the payment, with the new key that step generated.
10. **Worked example.** On `/payments/new?source=<Checking id>&recipient=<Northwind id>&amount=1%2C234.56&step=review`, the session is revoked from another device. The page lands on Log in, either by itself within a few seconds or when "Confirm and send" is pressed. After signing in, the address is that draft address again, the review step shows "$1,234.56" and Northwind Supply, and the company still has no new payment. One press of "Confirm and send" stores exactly one payment of 123456 cents. A memo such as `Invoice 7/2` survives the round trip unchanged.

**Add and remove recipients.**

- "Display name" accepts the full display-name limit from Business rules, counted in code points, so a name of 120 emoji can be typed and saved whole. The field never caps typing by a count that treats an emoji as two characters.
- Enter in any text field of the recipient form submits it, as "Save recipient" does. Enter in "Recipient email" submits the invite form.
- "Save recipient" disables while pending. On success it returns to `/payments/recipients`, with the new recipient listed and the saved copy announced.
- **Refused fields.** These rules apply whenever a save is refused for one or more fields, whether the browser caught the problem or the server answered `validation`:
  - each failing field shows its message under it and carries `aria-invalid="true"` and `aria-describedby` pointing at that message
  - focus moves to the first failing field in form order (Display name, Kind, Method, Account number, Routing number)
  - every typed value is kept
  - fields that no longer fail lose their invalid mark on the next attempt
- **Duplicate bank account.** Every typed value is kept. The duplicate copy, naming the existing recipient the server returns, shows under "Account number" and focus moves there. The copy is announced in the status region.
- "Send invite" behaves the same way for "Recipient email".
- **Removing.**
  1. "Remove <display name>" opens the "Remove recipient" dialog with focus on "Keep".
  2. The dialog's only focusable controls are "Keep" then "Remove". Tab from "Remove" wraps to "Keep", and Shift+Tab from "Keep" wraps to "Remove". Focus never reaches the page behind the dialog or the browser's own controls. A native modal dialog element does not keep Tab inside on its own, so the dialog must keep Tab inside itself.
  3. "Keep" or Escape closes the dialog and returns focus to the button that opened it.
  4. "Remove" disables itself while pending.
  5. On success the dialog closes, the row leaves the list, the success copy is announced and focus moves to the "Add recipient" control.
  6. On the held-payment refusal the dialog closes, the row stays, the refusal copy is announced and focus returns to the row's remove button.

**Approvals.**

1. Approve and Reject on each row are reachable by Tab in row order and operated by Enter or Space.
2. Pressing either button disables both buttons on that row until the answer arrives, and the row's pending copy is announced.
3. **First of two approvals.** The row stays and shows its new progress, and focus moves to that row's Reject button.
4. **A row leaves.** After a final approval, a rejection, or a refresh that drops the row, focus moves to the next row's Approve button. With no next row it moves to the previous row's Approve button. With no row left it moves to the "Approvals" heading.
5. **Already decided.** If a press is refused because the payment was already decided or has expired, the page announces the refusal copy and reloads the list. When the row is gone, step 4 applies.
6. **Live.** While the page is open, it re-reads `GET /api/approvals` at least every 5 seconds, or sooner on stream events. So these changes show within 5 seconds without a reload:
   - a held creation, approval, rejection or posting by any user
   - an expiry processed by the system
7. **In place.** A remaining row keeps its element, and its progress text, its "Approve by" line, its names and its suffixes are updated in place. A new row is inserted at its place in list order. A departed row is removed.
8. **Focus stays put.** With focus on a remaining row's Approve or Reject button, focus stays on that same payment's same button. That holds even when the button's accessible name gains, loses or changes its position suffix.
9. **Focused row decided elsewhere.** When the row holding focus leaves because of someone else's decision or its expiry, focus moves by step 4.
10. **Own requests win.** A refresh never removes or re-enables a row whose own request is pending; the row waits for its own answer.
11. **Announcing the count.** When the number of waiting payments changes because of someone else's action or an expiry, the page announces the waiting-count copy from Feedback states.
12. **Rail count.** On every cockpit page, the rail's Approvals link name follows Public screens and controls and is brought up to date within 5 seconds of any change.
13. **The deadline.** "Approve by <effective date>" is formatted from `approve_by` as a calendar date. Neither the browser's clock nor its time zone can shift it by a day.
14. Focus never falls to the page body, at any moment.

**Invoicing and loans.**

- "Mark paid" sends the account chosen in "Deposit to" and disables until the answer arrives. A double click sends at most one request.
- "Request withdrawal" reads "Withdrawal amount" as stated under Typing dollar amounts. It disables while pending, so a double click sends one request and credits once.
- **Withdrawal keys.** Each withdrawal carries an `Idempotency-Key`. The page keeps keys in memory only: a reload starts fresh, and nothing is written to browser storage.
  1. A key belongs to one loan and one "Withdrawal amount" text, compared after trimming.
  2. **No answer.** Sometimes a press gets no answer: the network fails, or the server answers `503` or `500`. Then:
     - Remaining and every balance keep exactly the figures they showed
     - the page announces the outage copy for a network failure or `503`, or the server-error copy for a `500`, both from Feedback states
     - the page keeps that key
  3. **Pressing again, same text.** The next press with the same text, on the same loan, sends the same key. If the server had already made that draw, its stored answer is replayed. Remaining then shows the replayed figures, and the success copy is announced once.
  4. **Pressing again, changed text.** A press with changed text uses a new key.
  5. **After an answer.** Once a press gets a `200` or any `4xx` answer, its key is spent, and the next press is a new withdrawal with a new key.
  6. **Worked example.** The first $0.29 draw reaches the server and commits, but the connection resets before its answer arrives. Remaining is unchanged and the outage copy shows. The second press sends the same key, and `drawn_cents` rises by 29 exactly once. A third press uses a new key and draws another 29.
- Each action announces its success or refusal copy by the announcement rules in Feedback states.

**Download statement.** The button fetches the account's statement for the month chosen in "Statement month", using the session. It saves the file under the full UTF-8 name the server gives in `filename*` (see Statements in Business rules), such as `Checking-statement-2026-10.csv`.

**Voice readout.**

- "Read balances aloud" carries a speaker glyph and speaks through the browser's speech synthesis.
- The first utterance begins "Total cash is" followed by the total in dollars with comma thousands separators and two decimals, such as "Total cash is $18,420.50". It then names each account with its balance.
- With no speech synthesis available, the button is disabled.

**Command palette.**

1. Control+K, or Command+K on a Mac, opens the "Command palette" dialog from anywhere in the cockpit, with focus in "Search commands". It works whichever control has focus: a text field such as "Display name" or the top-bar search, a select such as "Kind", or a button. The browser's own action for that key is prevented.
2. The shortcut does nothing while another dialog, such as "Remove recipient", is open.
3. Typing lists matches under two groups:
   - **"Pages".** These are matched in the page by the literal, case-insensitive rule from Search in Business rules. The pages are Approvals, Send payment, Recipients, Payments, Invoicing and Loans, and one matches when its name contains the trimmed text.
   - **"Recipients".** Once the trimmed text is at least 2 code points, these are the active recipients from `GET /api/search`, requested after a pause of about a quarter of a second. Pending invites in the answer are left out. With 0 or 1 code points, the palette lists pages only and sends no request.

   The Latest answer wins rules apply.
4. The first match is highlighted. Up and Down move the highlight.
5. Tab and Shift+Tab stay inside the palette.
6. Enter opens the highlighted match. A recipient opens `/payments/new?recipient=<id>` with that recipient chosen, and a page opens that page.
7. Escape closes the palette and returns focus to the element that had it before.
8. Removed recipients and pending invites never appear.

**Header menus by keyboard and pointer.** Each of Products, Solutions, Resources and About works as a disclosure that reveals a panel of links.

1. **Opening.**
   - Enter or Space on a closed trigger opens its panel and keeps focus on the trigger.
   - Down Arrow on a trigger opens its panel, if closed, and moves focus to the panel's first link.
   - Enter or Space on an open trigger closes its panel.
2. **Moving.** Inside a panel:
   - Down Arrow moves to the next link, and from the last link wraps to the first.
   - Up Arrow moves to the previous link, and from the first link wraps to the last.
   - Home moves to the first link and End to the last.
3. **Closing.**
   - Escape on a trigger or inside its panel closes the panel and puts focus on its trigger.
   - Tab from the panel's last link closes the panel and moves focus to the next control in the header.
   - Shift+Tab from the first link returns focus to the trigger and leaves the panel open.
   - A click or tap anywhere outside the open panel and its trigger closes it without moving focus.
4. **One menu at a time.** Opening a menu by keyboard or pointer closes any other open menu.
5. **State.** Each trigger's `aria-expanded` reads "true" exactly while its panel is shown.
6. **Closed panels.** At every width, a closed menu panel and the closed "Open Menu" panel follow the closed-means-gone rule from Collapsed panels. No link inside them is in the accessibility tree, reachable by Tab or clickable.
7. **Narrow windows.** In the "Open Menu" panel, each menu is an expandable group with the same links, opened by Enter, Space or click. The open panel keeps Tab inside it. Escape closes it and returns focus to "Open Menu".

**Pricing and the address.**

1. **Address form.** Annual prices are mirrored in the address as `/pricing?billing=annual`. Monthly is the default and is left out, so monthly prices live at plain `/pricing`.
2. **Toggling.** Each press of "Annual Pricing (15% off)" does all of this at once:
   - switches Plus and Pro to the other set of figures
   - flips the control's checked state
   - announces the new period
   - adds exactly one browser history entry carrying the new address
3. **Opening or reloading.** Opening or reloading `/pricing?billing=annual` shows the control checked and the annual figures. The count-up, as cards enter view, runs to the annual figures.
4. **Back and Forward.** Back restores the previous period's figures and control state, and Forward redoes it. Each announces the period shown.
5. **Bad values.** Any `billing` value other than `annual`, including `monthly`, is removed from the address in place, without a history entry, and monthly prices show.
6. **Jump list.** While annual prices show, every jump-list link's address carries `billing=annual`, so following one keeps annual prices.
7. **No storage.** The billing period is never written to browser storage. The address is its only home.

**Other keyboard rules.**

- Every interactive element is reachable by Tab in visual order and operable by Enter or Space.
- Every dialog and drawer keeps Tab inside while open, closes on Escape and returns focus to its opener, as detailed above.

**Sessions.** Every move below called a replacement swaps the current history entry rather than adding one.

1. **Signing in.** "Log in" lands on the address named in `next`, with its query string, when `next` passes the rule under Server boundary. Otherwise it lands on `/app`.
2. **Signing up.** "Open account" on the sign-up page lands on `/app` in the new company.
3. **Signing out.** "Log out" in the avatar menu ends the session, clears the stored token and opens `/`. After that, any cockpit page reached with Back shows no cockpit data and is replaced as in step 5.
4. **Signed in already.** Opening `/login` or `/signup` while signed in is replaced by `/app`. On `/login?next=<value>` with a valid `next`, it is replaced by that address instead. `/demo` stays open to everyone.
5. **No session.** Opening any cockpit page without a session is replaced by `/login?next=<current path and query>`.
6. **Session revoked mid-use.** A session can be revoked mid-use: it is signed out elsewhere, or a cockpit API request answers `401`. Then the page clears the stored token and is replaced by `/login?next=<current path and query>`.
   - On `/app` this happens within 5 seconds of the revocation, through the stream's `401` reconnect or the next refresh.
   - On every other cockpit page it happens on that page's next API request, whichever request that is. It may be a background request, such as the rail's Approvals count refresh or a stream reconnect, or a request the user triggers. On Send payment, `next` carries the full draft address whichever request discovers the revocation first, as stated under Send payment draft and the address.
7. **One replacement only.** When several requests answer `401` together, the page is replaced exactly once and the history length is unchanged. `next` always names the cockpit address the user was on, never a `/login` address.
8. **Back where they were.** Signing in from such a page lands on that exact path and query.
9. **Encoding.** `<current path and query>` is written as one URL-encoded query value, so `/`, `?`, `&` and `=` appear as `%2F`, `%3F`, `%26` and `%3D`.
10. **Worked example.** On `/app?method=ach&direction=out`, a session is revoked from another device. The page is replaced by `/login?next=%2Fapp%3Fmethod%3Dach%26direction%3Dout`, the stored token is gone, and the history length is unchanged. Signing in lands on `/app?method=ach&direction=out` with "Filter by method" on ACH.
11. **Other browsers.** Another browser signed in as the same user keeps its session and its live feed.

**Signing out stops everything.** These rules apply from the moment "Log out" is pressed.

1. The page sends no `/api` request with that session's token except `POST /api/auth/logout`.
2. Its stream is closed and never reconnected, and every refresh and retry timer of the page is cancelled.
3. Answers to requests already in flight are ignored. None of them may replace the page with Log in, write outage copy, or paint a figure.
4. **Worked example.** A snapshot refresh is still in flight when the owner presses "Log out". Twelve seconds later the address is still `/`. No `/api` request with the old token was sent after the logout answer, no stream reconnect was attempted, and the status region holds no outage copy.

**The next user on the same tab.** Signing out, and a revoked session, discard every company-scoped value the page holds: accounts, figures, feed rows, recipients, the Approvals count, open search results, the draft, and the stored last-opened account. When someone else then signs in or signs up on the same tab:

- the page never renders the previous company's name, figure or Approvals count, not even for one frame
- it sends no request naming any of the previous company's ids
- right after a sign-up, the rail shows only "Checking" at $0.00

**Contact.**

- "Contact sales" links open `/contact`.
- The Message counter updates on every keystroke. It counts the way the server does: trimmed, normalised to NFC, then counted in code points. So an emoji counts as 1, an `e` followed by a combining accent counts as 1, and a character that NFC splits in two counts as 2.
- "Send inquiry" disables while pending, so a double click sends one inquiry.

### Visual design (DP-03, DP-08, DP-41)

**Character.** The companion direction is a calm, bright workplace that feels like a trusted colleague. Surfaces are near-white with a lot of air, one confident blue marks everything clickable, and money figures line up like a ledger. The product commits to light mode.

**Colour roles.**

- **Page and surfaces.** The page is a near-white cool neutral. Cards and panels sit on white.
- **Text.** Headings and the darkest text are a deep near-black ink. Body text is mid charcoal grey. Secondary text is a lighter grey that still meets AA contrast.
- **Actions.** A single vivid mid blue marks every primary action, every link and the focus outline. White text appears on that blue only at button size and weight.
- **Money.** Money in is a deep, soft teal that reads as calm green. Money out is a strong burnt orange.
- **Available figures.** These show in the secondary grey under each balance, so held money reads as set aside, not spent.
- **Deadlines.** The "Approve by" line on each Approvals row is secondary grey text with a small clock glyph.
- **Errors.** Field errors and error borders are a vivid magenta-pink.
- **Never colour alone.** Direction is never shown by colour alone: every amount pairs its colour with a sign and the words "Money in" or "Money out". An invalid field pairs its border colour with its message text.
- **Page tints.** The credit card page tints its surfaces pale lavender, with muted violet for link hover. The payments and spend pages use a warm sand tint, with a deeper sand for link hover. The cockpit stays neutral.
- **Feature panels.** These run from near-black at the bottom to a deep violet at the top, with a fine grain overlay.
- **Avatars.** Fills rotate through soft cyan, lime, indigo and amber.

**Type.**

- A variable humanist sans is used for headings and interface text, falling back to the system interface font.
- A serif with italics is used for the largest editorial headlines on the marketing site.
- IBM Plex Mono, or another open monospace face, sets every balance and amount so columns line up.
- Body copy is a comfortable reading size, with lines spaced about one and a half times the text height.
- Marketing hero headlines are roughly three to four times body size. Section headings are about one and a half to two times body size.
- Cockpit feed text is slightly smaller than body text, and field captions smaller still.

**Density and composition.**

- The marketing site alternates wide hero bands with two-column feature rows, with generous vertical spacing.
- The cockpit is denser: a fixed rail, a snapshot row, a filter bar and a long feed. Rows are separated by hairline dividers rather than boxes.
- Sparklines are thin single lines in the action blue. They step flat across days with no money movement and have no axis or labels.
- The settlement line on Send payment is a quiet line of secondary text with a small clock glyph, so it reads as information, not as an action.

**Shape and depth.**

- Corners are gently rounded on inputs and chips, rounder on cards, and roundest on navigation panels, the drawer and dialogs.
- Primary actions are full pills that stay fully round at any height. Avatars and round triggers are circles.
- Floating cards carry a faint shadow, and menus a wide soft shadow.
- Sticky bars, the command palette, the open drawer and dialogs sit on a frosted, blurred backdrop.

**Icons and mark.**

- Icons are original single-colour line glyphs in the current text colour: a right arrow, an up-right arrow for "opens elsewhere", a clock, a chevron, a play triangle, a speaker, a copy glyph, a three-line menu glyph and a bin for Remove.
- The Tallwind mark is an original looping knot beside an uppercase wordmark.

**Tap targets and contrast.**

- Every control is at least 44 pixels tall and wide, or has that much space to tap.
- Text meets WCAG 2.2 AA contrast on every surface, including the tinted pages.
- Decorative grain and avatars are hidden from assistive technology. Meaningful icons carry text alternatives.

### Motion and effects (DP-20, DP-38, DP-45)

**What motion means.**

- **Entrance.** Cockpit snapshot cards and feed rows fade in while rising a short distance, about the height of a line of small text. They settle in under half a second. Only rows that are new to the page enter this way; a refresh never replays the entrance for rows already shown.
- **New transaction.** A row arriving from the stream enters the same way at the top of the feed.
- **Opening.** Header menu panels, the command palette and dialogs fade and scale up very slightly in about a quarter of a second. They close faster than they opened.
- **Drawer and mobile menu.** They slide in from their edge in about a third of a second and slide back out on close.
- **Live updates.** A row leaving the Approvals list fades out in about a fifth of a second. A changed approval progress, deadline or settlement line swaps its text at once.
- **Hover and press.** On hover-capable pointers, header menu triggers fade to a pale wash of the accent, and buttons darken slightly, each in about a tenth of a second. A pressed button sinks very slightly.
- **Progress.** A pending button shows a small spinning ring beside its pending copy. The ring stops when the answer arrives.
- **Exact figures.** When a balance or available figure changes, including on the refresh after an outage, it changes at once with no animation, so the number is always exact.

**Pricing count-up.** As each plan card enters view, its price counts up from zero to the figure for the billing period shown. The visible figure is page text that passes through intermediate values and settles on its final price within about one second. A later billing change switches the figures at once, as stated under Interactions.

**Signature scroll reveal on the home page.**

1. In the "One ledger for the whole company." section, a rendered cockpit still starts covered by a panel in the section's background colour. The still may be built from an `img`, `svg`, `canvas` or plain markup, and it is the largest box in that section. Checks compare screenshots of the section's largest boxes at several scroll positions, so neither the still nor the cover needs a particular role, name or attribute.
2. As the user scrolls, the cover recedes from left to right, uncovering the still in step with the scroll position. Uncovering starts when the top of the still enters the bottom of the window. It finishes when the top of the still reaches the middle of the window.
3. Scrolling back up re-covers the still step by step along the same path.
4. Nothing else in the section moves with scroll.

**Celebration.**

- A successful posted send drops a short shower of falling notes, drawn in the money-in teal and the action blue, over the snapshot.
- All notes live in one element appended for the shower. That element carries `aria-hidden="true"` and `data-celebration`, and clicks pass through it to the controls beneath.
- Each note falls more than half the window height, turning gently as it fades to nearly invisible. Its animation is finite and ends within three seconds.
- The container is removed within three seconds.

**No decorative loops.** No element animates in an endless loop, except the pending spinner while a request is pending.

**Reduced motion.** When the system asks for reduced motion:

| Motion | Substitute |
|---|---|
| Entrance and new-row slides | appear instantly |
| Panel scale, dialog, drawer and menu slide | open and close instantly |
| Approvals row leaving | removed instantly |
| Hover darkening | stays as an instant colour change |
| Pending spinner | replaced by the pending copy alone |
| Pricing count-up | each price shows its final value at once |
| Signature scroll reveal | the still is fully uncovered at all times |
| Celebration | no container is appended and nothing falls |

With reduced motion on, nothing slides, scales, animates a blur or counts on any page. Static backdrop blur, such as the frosted header, stays. A pressed button does not sink; its darker press colour is the only feedback.

### Feedback states (DP-12, DP-15, DP-19, DP-25, DP-29, DP-33, DP-36, DP-40, DP-47, DP-50, DP-53, DP-54, DP-55, DP-61, DP-68, DP-70, DP-71, DP-72, DP-74, DP-81, DP-82, DP-83, DP-88, DP-92)

**Announcement rules.**

- Every message below is written into the page's polite `status` live region. Field messages also appear under their field.
- On every cockpit page the status region is in the page from the moment it loads, empty, before any message is written. It is never added together with its first message.
- Each result is written exactly once. Before each write the region is first emptied, so a message that repeats the previous one is still announced afresh. For example, two $0.29 withdrawals in a row give the region text sequence "", "$0.29 credited to Checking", "", "$0.29 credited to Checking".
- Refusals follow the same rule: "That's more than the remaining credit" twice in a row is announced twice.
- One request gives one announcement, so a double-clicked action that sends one request announces its result once.
- On Loans, the card's "Remaining" figure updates from the server's answer at the same moment its message is written.

**General rules.**

- During any pending state, the triggering button is disabled and its label changes to the pending copy. On the Approvals page the visible label changes while the button keeps its full accessible name from Public screens and controls.
- When a request fails because the server answers `503` or the network is unreachable, the page shows "Tallwind can't be reached right now. Try again in a moment." in the status region, once per outage. It keeps every typed value and every figure already shown.
- When the cockpit's figures refresh after such a failure, it announces "Tallwind is back online." once.
- When a request answers `500`, the page shows "Something went wrong. Try again." in the status region and keeps every typed value and figure.

**Placeholders.**

| Placeholder | Meaning |
|---|---|
| `<effective date>` | A date written as three-letter weekday, three-letter month, day without a leading zero and four-digit year, such as "Tue, Jul 6, 2027". |
| `<existing name>` | The display name the server returns for the duplicate. |
| `<email>` | The trimmed, lowercased email sent. |
| `<invoice number>` | The invoice's number. |
| `$<amount>`, `$<available>`, `$<total available>` | Dollars with comma separators and two decimals. `<available>` comes from the account's `available_cents` and `<total available>` from the snapshot's `total_available_cents`. |
| `<account name>` | The credited account's name. |
| `<n>` | The whole number of transaction rows currently listed in the feed. |
| `<waiting>` | As defined under Public screens and controls. |

**Approve-by line on Approvals rows.** This is visible row text, updated in place, and never written to the status region. It reads "Approve by <effective date>", with the payment's `approve_by` date in the `<effective date>` format. For example, a payment with `approve_by` `2027-07-11` reads "Approve by Sun, Jul 11, 2027".

**Settlement line on Send payment.** This is visible text, updated in place, and never written to the status region.

| Form state | Line |
|---|---|
| "Send on" empty, and "Amount" empty, not yet in the dollar format, or at most $5,000.00 | "Settles <effective date>", where the date is the chosen method's entry in `settlement_dates` |
| "Send on" empty, and "Amount" a valid amount over $5,000.00 | "Settles once approved" |
| "Send on" filled | no line |

**Settlement suffix.** This applies when "Confirm and send" or "Approve" answers a `posted` payment whose `effective_date` differs from `business_date` (from `GET /api/me`). The success copy is followed by exactly one space and "Settles on <effective date>". For example, "Payment sent Settles on Tue, Jul 6, 2027". An answer with no effective date, such as a first of two approvals, carries no suffix.

**Scheduled suffix.** This applies when "Confirm and send" answers a `scheduled` payment whose `effective_date` differs from its `scheduled_for`. The success copy "Payment scheduled" is followed by exactly one space and "Scheduled for <effective date>", as one message in the status region, with no other punctuation and no line break. For example, a payment scheduled for Saturday 3 July 2027 is announced as "Payment scheduled Scheduled for Tue, Jul 6, 2027". When the two dates are equal, the copy is "Payment scheduled" alone.

**Messages by action.**

| Action | Pending | Success | Refusal copy |
|---|---|---|---|
| Log in | "Logging in…" | lands as stated under Sessions | Wrong email or password, including an email with no account: "Email or password is incorrect.". Locked: "Too many attempts. Try again later." |
| Sign up | "Opening account…" | lands on the cockpit | "Enter your name"; "Enter a valid email"; "Password must be at least 8 characters"; email taken: "An account with this email already exists" |
| Save recipient | "Saving…" | "Recipient saved" | Display name too short or too long: "Enter a name of up to 120 characters"; display name with a refused character: "Remove control or direction characters from this name"; account number: "Enter 4 to 17 digits"; routing number: "Enter a valid 9-digit routing number"; duplicate, on Account number: "This recipient is already saved as <existing name>." |
| Send invite | "Sending invite…" | "Invite sent to <email>" | "Enter a valid email"; duplicate: "An invite to this email is already pending." |
| Remove recipient | "Removing…" | "Recipient removed" | Held payment: "This recipient has a payment waiting for approval." |
| Review payment | none | the review step opens | Dollar format: "Enter an amount in dollars and cents, such as 12.50". Amount: "Enter an amount greater than $0.00". Over the available balance: "You don't have enough in this account". Date: "Choose a date after today". Memo: "Keep the memo to 140 characters of plain text" |
| Confirm and send | "Sending…" | Posted: "Payment sent", with the settlement suffix when it applies. Held: "Payment awaiting approval". Scheduled: "Payment scheduled", with the scheduled suffix when it applies | The review-step messages above for the matching refusal. A scheduled amount over the approval threshold: "Scheduled payments can be at most $5,000.00". A used or expired quote: "This quote is no longer available. Get a new quote." A removed recipient: "This recipient is no longer available." |
| Cancel payment | "Cancelling…" | "Payment cancelled" | Not scheduled: "This payment can no longer be cancelled.". Forbidden: "You can only cancel payments you created." |
| Approve | "Approving…" | First of two: "Approval recorded". Final: "Payment approved and sent", with the settlement suffix when it applies | Same approver again: "You've already approved this payment.". No longer pending, expiry included: "This payment is no longer waiting for approval." |
| Reject | "Rejecting…" | "Payment rejected" | "This payment is no longer waiting for approval." |
| Someone else changes the Approvals list, or a payment expires | none | "Payments waiting for approval: <waiting>" | none |
| Send invoice | "Sending…" | "<invoice number> sent" | "This invoice has already been sent." |
| Mark paid | "Marking paid…" | "<invoice number> marked paid" | Already paid: "This invoice is already paid". Draft: "Send this invoice before marking it paid" |
| Request withdrawal | "Requesting…" | "$<amount> credited to <account name>", also for a replayed answer | Dollar format: "Enter an amount in dollars and cents, such as 12.50". Over the remaining credit: "That's more than the remaining credit". Empty or zero: "Enter an amount greater than $0.00". No answer: the outage copy or the server-error copy from General rules |
| Download statement | "Preparing statement…" | "Statement downloaded" | none |
| Filter feed, reload, Back or Forward | none | "<n> transactions shown" | none |
| Show more transactions | "Loading…" | "<n> transactions shown" | none |
| Pricing toggle, Back or Forward | none | "Showing annual prices" or "Showing monthly prices" | none |
| Send inquiry | "Sending…" | "Thanks for reaching out, our team will get back to you shortly." | "Enter a valid email"; "Enter your first name"; "Enter your last name"; "Enter your company"; "Enter a message"; a name or company too long: "Keep this to 120 characters or fewer"; a message too long: "Keep your message to 5,000 characters or fewer"; rate limit: "You've sent several inquiries recently. Please try again in a few minutes."; body cap: "Your message is too long to send." |

## Backend

### API (DP-01, DP-05, DP-06, DP-07, DP-09, DP-10, DP-11, DP-14, DP-15, DP-16, DP-17, DP-18, DP-21, DP-22, DP-23, DP-24, DP-26, DP-27, DP-28, DP-30, DP-31, DP-32, DP-34, DP-35, DP-40, DP-46, DP-48, DP-49, DP-50, DP-52, DP-53, DP-54, DP-55, DP-58, DP-59, DP-61, DP-64, DP-65, DP-66, DP-67, DP-69, DP-70, DP-72, DP-73, DP-81, DP-87, DP-88, DP-89, DP-90)

**Conventions.**

- The JSON API lives under `/api`, on the same origin as the pages. Requests and responses use `application/json` unless an endpoint says otherwise. The content-type gate and the body cap are stated under Server boundary.
- Every `/api` response, on every status, carries `Cache-Control: no-store`.
- Health, sign-up, log-in, plans and inquiries are public. Every other endpoint needs a session sent as `Authorization: Bearer <token>`. The stream takes the token as a query parameter instead.
- Each endpoint row lists the body keys it reads. Every other key is ignored, as stated under "Server-owned fields" in Business rules.
- Every string a body key reads, and `q`, follows Text in requests in Business rules.
- Ids are opaque strings the server issues. The handling of malformed ids and amounts is stated under Tenancy and Money in Business rules.

**The published surface.**

- The tables below list every method and path under `/api`, and nothing else exists there.
- A literal path segment wins over an id segment, so `/api/recipients/invite` is the invite path and never a recipient id.
- A request whose path matches a listed path, with a method not listed for it, answers `405 {"error":"method_not_allowed"}`. Its `Allow` header names exactly the listed methods for that path, comma-separated. For example, `/api/accounts/{account_id}` answers `Allow: GET`. `OPTIONS` and `HEAD` count as unlisted methods.
- Any `/api` path that matches no listed path answers `404 {"error":"not_found"}`. This includes reset, seed, debug, test, admin and user-listing addresses.

**Error shape.** Every error body is `{ "error": "<code>" }`, plus the extra keys named for that code. The shared codes are:

| Status | Body |
|---|---|
| `400` | `{"error":"invalid_json"}` for a body that is not valid UTF-8 or not a JSON object |
| `400` | `{"error":"validation","fields":{"<field>":"<message>"}}`, naming every failing field; message text is free |
| `401` | `{"error":"unauthorized"}` |
| `403` | `{"error":"forbidden"}` |
| `404` | `{"error":"not_found"}` |
| `405` | `{"error":"method_not_allowed"}` with `Allow` |
| `413` | `{"error":"payload_too_large"}` |
| `415` | `{"error":"unsupported_media_type"}` |
| `500` | `{"error":"internal"}` for any unexpected failure |
| `503` | `{"error":"service_unavailable"}` when the database cannot be reached |

**Opaque errors.** No response body or header, on any status, ever contains any of these:

- a stack trace
- SQL text
- a constraint or table name
- a file path
- a database driver's message, such as text about byte sequences or encodings
- the word `postgres`, in any letter case

**Error precedence.** One order applies to every endpoint, and the first rule that applies decides the answer:

1. The body cap (`413`).
2. An unlisted method (`405`) or an unlisted `/api` path (`404`).
3. The content-type gate (`415`).
4. `503 service_unavailable` while the database cannot be reached. Health has its own body.
5. `401` for a missing, invalid or signed-out session.
6. An idempotent replay returns its stored response, and a reused key answers `422`, as stated in Business rules.
7. `404` for any unknown, malformed, removed or other-company id. This applies in the path, in the query, or in a body key the endpoint reads (the keys listed under Tenancy). A body key the endpoint does not read never causes a `404`.
8. `403` for a role that may not take the action, as stated under Roles inside one company.
9. `400` `invalid_json` or `validation`.
10. `429` for rate limits and lockout.
11. `409` for state conflicts.
12. `400` for money refusals: `insufficient_funds` and `exceeds_available_credit`.

Endpoint rows list only their own extra errors.

**Envelopes.** A list endpoint answers an object holding one named array. A single object is returned at the top level, except for the named envelopes listed below.

**Objects.** Dates are `YYYY-MM-DD`, and instants are UTC ISO 8601.

| Object | Fields |
|---|---|
| Account | `id`, `name`, `kind` (`checking`, `savings` or `treasury`), `balance_cents`, `available_cents`, `currency` (`USD`) |
| Transaction | `id`, `account_id`, `direction` (`credit` or `debit`), `amount_cents` (positive integer), `method` (`ach`, `wire`, `rtp`, `check`, `card` or `transfer`), `counterparty`, `memo` (string or null), `status` (`posted`), `transfer_id` (the transfer's id on both legs of a transfer, otherwise null), `created_at` |
| Recipient | `id`, `display_name`, `kind` (`person` or `business`, or null for a pending invite), `method` (`ach`, `wire`, `rtp`, `check`, or null for a pending invite), `status` (`active` or `pending`), `account_last4` (string or null), `email` (string or null). A pending invite's `display_name` is its email. The full account number and routing number are write-only and never appear in a response. |
| Payment | `id`, `source_account_id`, `recipient_id`, `recipient_name` (the recipient's display name at the moment the payment was created, kept unchanged even after the recipient is removed), `method`, `amount_cents`, `memo`, `status` (`pending_approval`, `scheduled`, `posted`, `rejected`, `cancelled`, `failed` or `expired`), `scheduled_for` (date or null), `effective_date` (date or null, as stated under Settlement dates and cutoffs), `expires_at` (instant or null) and `approve_by` (date or null), both as stated under Approval expiry, `fx_quote_id` (or null), `total_debit_cents`, `approvals_required` (0, 1 or 2), `approvals` (a list of `{ user_id, name, at }`), `created_by`, `created_at` |
| Invoice | `id`, `number`, `customer_name`, `total_cents`, `status` (`draft`, `sent` or `paid`), `paid_into_account_id` (or null) |
| Loan | `id`, `name`, `principal_cents`, `drawn_cents`, `remaining_cents`, `funding_account_id` |

**Health and sessions.**

| Method and path | Request | Success | Extra errors |
|---|---|---|---|
| `GET /api/health` | none | `200 {"status":"ok"}` while the database is reachable and the schema, the audit protection and the seed are in place | `503 {"status":"unavailable"}` at every other moment, at boot or later |
| `POST /api/auth/signup` | `{ email, name, password }` | `201 { token, user }` | `409 {"error":"email_taken"}` |
| `POST /api/auth/login` | `{ email, password }` | `200 { token, user }` | `401 {"error":"invalid_credentials"}`; `429 {"error":"too_many_attempts"}`, which a locked email receives whatever the password |
| `POST /api/auth/logout` | none | `204`; the token stops working everywhere, as stated under Sessions in Business rules | none |
| `GET /api/me` | none | `200 { user, business_date, business_now, settlement_dates, settlement_dates_change_at }` | none |

- `user` carries `id`, `email`, `name`, `role` and `company_id`.
- `business_date` is the current New York date on the business clock.
- `business_now` is the business clock's current instant.
- `settlement_dates` is `{ "ach": <date>, "wire": <date>, "rtp": <date>, "check": <date> }`, and `settlement_dates_change_at` is an instant. Both are defined under Settlement preview in Business rules.
- **Sign-up fields.**
  - `name` is a string of 1 to 120 code points after trimming.
  - `email` is a string holding a valid address of at most 254 code points after trimming. It is stored lowercased.
  - `password` is a string of 8 to 128 code points and is never trimmed.

**Money reads.**

| Method and path | Success | Notes |
|---|---|---|
| `GET /api/accounts` | `200 { "accounts": [...] }` | the caller's company only; read from one database snapshot |
| `POST /api/accounts` | `201` account | reads `{ name, kind }`; `name` is 1 to 60 code points after trimming and may hold any printable characters in any script; owner or admin only; starts at 0 |
| `GET /api/accounts/{account_id}` | `200 { account, recent_transactions }` | the ten newest transactions |
| `GET /api/snapshot` | `200 { total_cash_cents, total_available_cents, per_account }` | each `per_account` entry is `{ account_id, balance_cents, available_cents, sparkline }`, in the order of `GET /api/accounts`; read from one database snapshot |

**Feed, search, statements and stream.**

| Method and path | Success |
|---|---|
| `GET /api/transactions?account_id=&method=&direction=&limit=&cursor=` | `200 { "transactions": [...], "next_cursor": <string or null> }` |
| `GET /api/search?q=<text>` | `200 { "recipients": [...], "transactions": [...] }` |
| `GET /api/accounts/{account_id}/statement.csv?month=<YYYY-MM>` | `200`, content type `text/csv`, with the `Content-Disposition` header stated under Statements |
| `GET /api/stream?token=<token>&last_event_id=<id>` | `200`, content type `text/event-stream`, kept open |

- **Transactions.**
  - Every parameter is optional, and filters combine.
  - `method` is one of the six transaction methods, and `direction` is `credit` or `debit`. Any other value is `validation` on that parameter.
  - `limit` is 1 to 100 and defaults to 50. Any other value is `validation` on `limit`.
  - A cursor that cannot be read, or that does not match the request's filters, is `validation` on `cursor`.
- **Search.** `q` must be 2 to 100 code points after trimming; otherwise it is `validation` on `q`. Matching, caps and timing are under Search in Business rules.
- **Statements.** `month` is optional. A malformed `month`, or a month after the current New York month, is `validation` on `month`. The statement format is in Business rules.
- **Stream.**
  - A missing, invalid or signed-out token answers `401`.
  - Each new transaction of the caller's company arrives as an event named `transaction`. Its data is the transaction's JSON, and its `id:` line is an opaque event id.
  - The last seen id may be sent as the `Last-Event-ID` header or as the `last_event_id` query parameter. Resume behaviour is in Business rules, and connection limits are under Services.

**Recipients.**

| Method and path | Request | Success | Extra errors |
|---|---|---|---|
| `GET /api/recipients` | none | `200 { "recipients": [...] }` | none |
| `POST /api/recipients` | `{ display_name, kind, method, account_number, routing_number }` | `201` recipient, `active` | `409 {"error":"duplicate_recipient","recipient_id":"<id>","display_name":"<name>"}` |
| `POST /api/recipients/invite` | `{ email }` | `201 { invite_id, recipient }`, recipient `pending` | `409` with the same `duplicate_recipient` body naming the pending recipient |
| `GET /api/recipients/{recipient_id}` | none | `200` recipient | none |
| `DELETE /api/recipients/{recipient_id}` | none | `204` | `403` for a member; `409 {"error":"recipient_has_pending_payments"}` |

Every role may add recipients. Only owners and admins may remove them.

**Payments.**

| Method and path | Request | Success | Extra errors |
|---|---|---|---|
| `POST /api/payments` | `{ source_account_id, recipient_id, method, amount_cents, memo, scheduled_for, fx_quote_id }` (the last three optional); optional `Idempotency-Key` header | `201` payment in `posted`, `pending_approval` or `scheduled` | `400 {"error":"insufficient_funds"}`; `409 {"error":"quote_used"}`; `409 {"error":"quote_expired"}`; `422 {"error":"idempotency_key_reused"}` |
| `GET /api/payments` | none | `200 { "payments": [...] }`, newest first, including payments whose recipient has since been removed | none |
| `GET /api/payments/{payment_id}` | none | `200` payment | none |
| `POST /api/payments/{payment_id}/cancel` | none | `200` payment, `cancelled` | `403`; `409 {"error":"payment_not_scheduled"}` |
| `GET /api/approvals` | none | `200 { "approvals": [...] }` | none |
| `POST /api/payments/{payment_id}/approve` | none | `200` payment: `pending_approval` after the first of two approvals, `posted` after the final one | `403`; `409 {"error":"payment_not_pending"}`; `409 {"error":"already_approved"}` |
| `POST /api/payments/{payment_id}/reject` | none | `200` payment, `rejected` | `403`; `409 {"error":"payment_not_pending"}` |

- **Payment validation.**
  - `source_account_id` and `recipient_id` are required; a missing key is `validation` on it.
  - A pending recipient is `validation` on `recipient_id`.
  - `method` is `ach`, `wire`, `rtp` or `check`.
  - `amount_cents` follows the amount rule under Money.
  - `memo` is null or a string of at most 140 code points.
  - `scheduled_for` is null or a date after today in New York.
  - `fx_quote_id` may be null or absent. Otherwise it is allowed only with `wire`, and only when `amount_cents` equals the quote's amount; any other use is `validation` on `fx_quote_id`.
- **Approvals list.** Every role may read it. Each entry is a `pending_approval` payment, with its `recipient_name`, `expires_at` and `approve_by`. Each entry also carries `creator_name` and `source_account_name`. Entries are ordered oldest created first, with ties broken by id.

**Currency quotes.** `POST /api/fx/quotes` reads `{ currency, amount_cents }`.

- It answers `201 { id, currency, amount_cents, rate, foreign_amount_minor, fee_cents, total_debit_cents, expires_at }` for `EUR`, `GBP` or `CAD`.
- Any other currency, including a different letter case, is `validation` on `currency`.

**Invoices, loans and transfers.**

| Method and path | Request | Success | Extra errors |
|---|---|---|---|
| `GET /api/invoices` | none | `200 { "invoices": [...] }` | none |
| `POST /api/invoices/{invoice_id}/send` | none | `200` invoice, `sent` | `403`; `409 {"error":"invoice_not_draft"}` |
| `POST /api/invoices/{invoice_id}/mark-paid` | `{ account_id }` | `200` invoice, `paid` | `403`; `409 {"error":"invoice_already_paid"}`; `409 {"error":"invoice_not_sent"}` |
| `GET /api/loans` | none | `200 { "loans": [...] }` | none |
| `POST /api/loans/{loan_id}/draw` | `{ amount_cents }`; optional `Idempotency-Key` | `200` loan with the new figures | `403`; `400 {"error":"exceeds_available_credit"}`; `422 {"error":"idempotency_key_reused"}` |
| `POST /api/transfers` | `{ from_account_id, to_account_id, amount_cents, memo }`; optional `Idempotency-Key` | `201 { id, from_account_id, to_account_id, amount_cents, memo }` | `400 {"error":"insufficient_funds"}`; `422 {"error":"idempotency_key_reused"}` |

- **Roles.** Owners and admins may send invoices and mark them paid. Only owners may draw on a loan. Every role may transfer.
- **Validation.**
  - `amount_cents` follows the amount rule under Money.
  - A transfer `memo` is null or a string of at most 140 code points.
  - The same account on both sides of a transfer is `validation` on `to_account_id`.

**Audit and plans.**

| Method and path | Success | Extra errors |
|---|---|---|
| `GET /api/audit` | `200 { "events": [...] }`, oldest first, each `{ seq, action, payment_id, amount_cents, actor_email, prev_hash, hash, created_at }` | `403` for a member |
| `GET /api/plans` | `200 { "plans": [...] }`, each `{ id, name, monthly_cents, annual_cents, features }` | none |

**Inquiries.** `POST /api/inquiries` reads `{ email, first_name, last_name, company, message, source, website }`.

- A valid inquiry answers `201 { id, created_at }`, both issued by the server.
- An invalid inquiry answers `validation`.
- An inquiry over the rate limit answers `429 {"error":"rate_limited"}` and stores nothing.
- An inquiry whose `website` counts as filled (see Sales inquiries in Business rules) answers `201` with a fresh `id` and stores nothing. This check comes before validation and rate counting.

### Business rules (DP-01, DP-07, DP-09, DP-10, DP-11, DP-14, DP-15, DP-16, DP-17, DP-18, DP-21, DP-22, DP-23, DP-24, DP-26, DP-27, DP-28, DP-30, DP-31, DP-32, DP-34, DP-35, DP-46, DP-48, DP-49, DP-50, DP-51, DP-52, DP-53, DP-54, DP-55, DP-56, DP-57, DP-58, DP-61, DP-62, DP-63, DP-64, DP-65, DP-66, DP-67, DP-69, DP-70, DP-71, DP-73, DP-75, DP-81, DP-87, DP-88, DP-89, DP-90)

**Business clock.**

- The server keeps one business clock.
- `APP_NOW` may hold an ISO 8601 UTC instant such as `2027-07-02T16:00:00Z`. Then the clock reads that instant at the moment `serve` starts and advances in real time from there. A later restart with a different `APP_NOW` jumps the clock to the new instant.
- When `APP_NOW` is unset or empty, the clock is the system clock.
- Every business time reads this one clock:
  - the `created_at` of every row
  - today's New York date
  - settlement cutoffs, effective dates and the settlement preview
  - approval expiry and `approve_by`
  - quote `expires_at` and expiry checks
  - the lockout and inquiry windows
  - idempotency retention
  - sparkline and statement day bounds
  - seed timing
  - effective-date posting
- The database's own clock and column defaults never decide a business time.

**Money.**

- Every balance and amount is an integer number of cents, and no floating-point arithmetic touches money.
- **Amounts in requests.** Every `amount_cents` in a request must be a JSON number written as plain digits, with no sign, decimal point or exponent, whose value is 1 to 9007199254740991. Anything else is `validation` on `amount_cents`. That covers `0`, negatives, `1.5`, `"100"`, `true`, `null`, `1e30`, `-0` and `9007199254740992`.
- Money arriving is a `credit` and money leaving is a `debit`.
- An account's balance always equals its credits minus its debits.

**Text in requests.**

- This applies to every string value a body key reads, and to `q`.
- **Everywhere.** A string holding U+0000, or a JSON escape of an unpaired surrogate (such as `"\ud83d"` with no partner, or `"\udc00"` alone), is `validation` on that field, and nothing is stored. This includes `memo`, `message`, `password` and `q`. Such a string in an id key follows the malformed-id rule under Tenancy instead.
- **Single-line fields.** These are `display_name`, the account `name`, the sign-up `name`, every `email` (sign-up, log-in, invite and inquiry), and the inquiry `first_name`, `last_name` and `company`. Each is `validation` on that field when it holds:
  - any of U+0001 to U+001F or U+007F
  - a text-direction embedding, override or isolate control, U+202A to U+202E or U+2066 to U+2069

  Right-to-left text without such controls is accepted and returned identical. For example, "مؤسسة النور" saves and reads back byte for byte, while "Northwind\u202Eylppus" is `validation` on `display_name`.
- **Multi-line fields.** These are `memo` and the inquiry `message`. They allow tab (U+0009), line feed (U+000A) and carriage return (U+000D), and refuse every other character in U+0001 to U+001F and U+007F.
- `password` refuses only what is refused everywhere, and is never trimmed.
- A body that is not valid UTF-8 is `invalid_json`.
- A refusal never reaches the database, so it never surfaces as a server error.

**Available balance and holds.**

- An account's `available_cents` is its `balance_cents` minus the sum of `total_debit_cents` over that account's payments in `pending_approval`.
- **Placing a hold.** A payment created as `pending_approval` places its hold in the same transaction that stores it.
- **Releasing a hold.** The final approval turns the hold into the debit. A rejection or an expiry releases it. Nothing else releases a hold; in particular, a recipient with a held payment cannot be removed.
- Scheduled payments place no hold.
- **Funds checks.** Every funds check compares against `available_cents`: a direct send, the creation of a held payment, a transfer and an effective-date posting. Neither a balance nor an available balance ever goes below zero.
- **Final approvals never fall short.** Held money is reserved, so a final approval always covers its debit.
- **What stays booked.** Sparklines, statements and `total_cash_cents` are booked balances. `total_available_cents` is the sum of the accounts' `available_cents`.
- **Worked example.** With the seed data at start, the member's $50,001.00 payment from Savings leaves Savings at `balance_cents` 6000000 and `available_cents` 999900. `total_cash_cents` is unchanged. An owner transfer of 1000000 cents from Savings answers `insufficient_funds`. After a rejection, Savings' `available_cents` is 6000000 again.

**Holds stay exact under concurrency.**

- Holds are derived from the stored `pending_approval` payments, inside the same database transaction as every decision. Available balances are never kept in process memory.
- After any mix of held creations, approvals, rejections, expiries, sends, transfers and posts, including simultaneous ones, every account satisfies all of these:
  - `available_cents` equals `balance_cents` minus the sum of `total_debit_cents` of its `pending_approval` payments.
  - `GET /api/approvals` lists exactly the company's `pending_approval` payments.
  - The snapshot's `total_available_cents` equals the sum of the accounts' `available_cents`.
- Each hold is released exactly once, by the decision or expiry that ends it, or not at all. A rejection after the first of two approvals releases the full hold once. A decision that loses a race and answers `payment_not_pending` releases nothing and moves nothing.
- Held creations against one account are judged one at a time against its available balance. Two held payments may each fit the available balance alone but not together. When both arrive at once, exactly one answers `201` `pending_approval` and the other answers `insufficient_funds`.

**Consistent reads.**

- Each `GET /api/snapshot` answer and each `GET /api/accounts` answer is read from one database snapshot. Its balances, holds and totals never mix states from before and after a concurrent commit.
- So these hold for every answer, even while approvals, transfers and other money movements commit:
  - `total_available_cents` equals the sum of the answer's own `per_account` available figures.
  - `total_cash_cents` equals the sum of the answer's own `per_account` balances.
  - Suppose k held payments of H cents each from one account with balance B are finally approved one after another. Every `available_cents` read for that account meanwhile equals B − kH.
  - While transfers run between two accounts of one company, every answer's `total_cash_cents` is unchanged.

**Request-scoped state.**

- Nothing about a request lives beyond it on the server. No per-process variable, cache or memo holds a current user, company or answer shared between requests.
- For example, 100 requests run interleaved at the same moment, half with the Larkspur owner's token and half with the outsider's, across `GET /api/snapshot`, `GET /api/accounts`, `GET /api/approvals`, `GET /api/search` and `GET /api/me`. Each answer holds only its own caller's ids and names.

**Snapshot and sparklines.**

- `total_cash_cents` is the sum of the company's balances at the moment of the request.
- Each `sparkline` is thirty integers, oldest first.
  - Index 29 is today's New York date. Index `i` is the New York calendar date `29 − i` days before it, stepping by calendar dates and never by 24-hour periods.
  - Each entry is the account's balance at 23:59:59.999 New York time on that date, counting every transaction created at or before that moment.
  - A date before the account's first transaction reads 0, and index 29 equals the current `balance_cents`.
- **Daylight-saving examples.** A transaction at `2026-11-01T04:30:00Z` (00:30 New York time) counts on 1 November 2026. A transaction at `2026-11-02T04:30:00Z` (23:30 New York time) also counts on 1 November 2026.
- The snapshot is computed on every read.

**New companies.**

- Sign-up always creates a new company whose name is the trimmed sign-up `name`, with the user as owner.
- The new company holds exactly one account: `Checking`, kind `checking`, `balance_cents` 0. Its snapshot shows `total_cash_cents` 0 and a sparkline of thirty zeros.
- It has no transactions, recipients, payments, invoices, loans or audit events.

**Feed paging.**

- Transactions are ordered newest first by `created_at`, with ties broken by `id` descending.
- A cursor marks the position just after the last row of its page and carries the filters it was issued for. The next page holds the matching rows strictly after that position.
- So transactions created after the first page was read never appear on later pages, and paging to the end lists every older matching row exactly once.
- `next_cursor` is `null` when no further row matches.

**Search.**

- Search covers the caller's company only. It returns active and pending recipients whose display name contains the query, and transactions whose counterparty or memo contains it. Removed recipients never appear.
- **Literal matching.** The trimmed query is matched as a literal substring, ignoring letter case. Every character matches only itself: `%`, `_`, `\` and `*` are never wildcards or escapes.
- **Caps and order.** At most 20 recipients and at most 20 transactions are returned. Transactions come newest first, in feed order.
- **Bounded work.** Every query within the length limit is answered within 2 seconds, also when ten such queries arrive together. A query ending in a backslash answers `200`, never a `5xx`.
- **Worked example.** With memos "50% deposit", "500 deposit", "net_30" and "net30": `0%` finds only "50% deposit", `t_3` finds only "net_30", and `%%` finds nothing.

**Statements.**

- **Format.** RFC 4180: comma-separated fields, lines ending in LF or CRLF, and the header `date,counterparty,memo,direction,amount,balance`.
- **Rows.** One row per transaction of the account, oldest first.
- **Columns.**
  - `date` is the transaction's New York calendar date as `YYYY-MM-DD`.
  - `counterparty` is the transaction's counterparty.
  - `memo` is the transaction's memo, or empty when it is null.
  - `direction` is `credit` or `debit`.
  - `amount` is signed dollars with two decimals, negative for a debit, such as `-1250.00`.
  - `balance` is the account balance after that row, in the same format.
- **Without `month`.** The file lists every transaction of the account, and the running balance starts from 0.
- **With `month`.** The file lists only transactions whose New York date falls in that month. The running balance starts from the opening balance, which is the account's balance at 23:59:59.999 New York time on the last day of the previous month, by the sparkline's end-of-day rule. A month with no rows answers the header alone. The current New York month is allowed.
- **Worked example.** A payment created at 00:30 New York time on 1 November 2026 is absent from the October 2026 file. It appears in the November 2026 file dated `2026-11-01`.
- **Formula neutralisation.** A `counterparty` or `memo` value beginning with `=`, `+`, `-`, `@`, a tab (U+0009) or a carriage return (U+000D) is written with one leading apostrophe `'`. For example, `=SUM(A1:A9)` becomes `'=SUM(A1:A9)`. `date`, `direction`, `amount` and `balance` are never prefixed.
- **Quoting.** After neutralisation, a field containing a comma, a double quote or a line break is wrapped in double quotes, with each inner double quote doubled.
- **File name.** The name is `<account name>-statement-<YYYY-MM>.csv` for a month, or `<account name>-statement-all.csv` without one, where `<account name>` is the stored account name. The response carries `Content-Disposition: attachment; filename="<ascii fallback>"; filename*=UTF-8''<encoded name>`.
  - `<ascii fallback>` is the name with every non-ASCII code point, every `"` and every `\` replaced by one `_`. For example, `Réserve ☕-statement-2026-11.csv` falls back to `R_serve _-statement-2026-11.csv`.
  - `<encoded name>` is the name's UTF-8 bytes, percent-encoded as RFC 8187 requires, so decoding it gives the exact name.
- Only the statement is altered. Everywhere else, display names, memos and account names are stored and returned exactly as typed after trimming.

**Stream resume.**

- A connection may name a last event id, by header or query. It then first receives every transaction of the caller's company that comes after that event in feed order, sent oldest first, with no duplicates, and then receives live events.
- **Durable ids.** An event id names a stored transaction, so it stays valid across `serve` restarts. A reconnect after a restart may name an id issued before it. It then replays every company transaction after that event, oldest first, including transactions created since the restart, and then goes live. An event id never comes from a counter kept in process memory.
- An unknown id, or an id from another company, gets live events only.
- A stream connection carries only its own company's transactions.

**Database outages.**

- **Two kinds of outage.**
  - The database may be unreachable when `serve` starts. That case is stated under Server boundary.
  - The database may also become unreachable while `serve` runs. Then it ends every open connection and refuses new ones for a while. Later it accepts connections again at the same `DATABASE_URL`, holding the same data.
- **How the verifier produces the second kind.** It starts a copy of `serve` itself, from `/app` with the same run manifest, as described under Deployment. That copy's `DATABASE_URL` points at a scratch database the verifier creates with the app's own credentials. The connection goes through a relay the verifier runs on a local TCP port, so the address looks like any other database address. The verifier cuts the relay, which ends every open connection and refuses new ones. Later it restores the relay at the same address, with the same data. It never stops or restarts that `serve` while doing this.
- **While unreachable.** Health answers its `503` body. Every API request that needs the database answers `503` `service_unavailable` and changes nothing, so no payment, transfer or other transaction is created during an outage.
- **Recovery.** Within 10 seconds of the database accepting connections again, health answers `200` and requests succeed. This happens in the same running `serve` process, with no restart. Every connection the app held before the outage is treated as dead and replaced.
- **The stream.** An open stream either keeps delivering or closes. A client that reconnects with its last event id receives the transactions created after the database returned, as stated under Stream resume. That includes transactions created before the client reconnected.

**Recipients.**

- **Display name.** A string that, after trimming, is 1 to 120 Unicode code points exactly as typed.
  - It is not normalised. It is stored and returned exactly as typed after trimming.
  - So 120 copies of U+1F4B8 are accepted and returned identical, and 121 code points are `validation` on `display_name`.
  - It may contain any printable characters, including `=`, `+`, `-`, `@`, commas and double quotes, under the single-line rule in Text in requests.
- **Bank numbers.** `account_number` and `routing_number` must be JSON strings of the ASCII digits 0 to 9 only. A JSON number such as `123456612`, fullwidth digits such as "１２３４", or Arabic-Indic digits such as "٠٢١٠٠٠٠٢١" are `validation` on that field.
- **Account number.** 4 to 17 digits. Leading zeros count, so `000123456612` and `123456612` are different accounts. `account_last4` is always its last four digits.
- **Routing number.** Nine digits whose ABA checksum holds: 3 × (d1 + d4 + d7) + 7 × (d2 + d5 + d8) + (d3 + d6 + d9) is a multiple of 10. So `021000021` is valid and `123456789` is not.
- **Duplicates.**
  - A new recipient is a duplicate when both its routing number and its full account number equal those of an active recipient of the same company.
  - Accounts that differ but share their last four digits are not duplicates.
  - Another company may save the same bank details.
  - An invite is a duplicate when its email, trimmed and lowercased, equals that of a pending invite in the same company.
  - When identical saves arrive at once, exactly one is stored and every other answers the duplicate `409`.

**Removing a recipient.**

- Removal applies to active recipients and pending invites.
- **Gone everywhere.** A removed recipient answers `404` by id. It is absent from the recipients list, search, the command palette and the send-payment picker. A payment naming it answers `404`.
- **History stays.** Its existing feed rows and statements keep the counterparty name as stored, and its existing payments keep their `recipient_name`.
- **Held payments block removal.** While any of its payments is `pending_approval` and before that payment's `expires_at`, removal answers `recipient_has_pending_payments` and nothing changes. That answer is never given while the recipient has no such payment.
- **Expired payments do not block.** A held payment whose `expires_at` has passed never blocks removal. If the payment has not yet been expired when the removal runs, the removal first records its expiry in the same transaction, as stated under Approval expiry.
- **Scheduled payments are cancelled.** On a successful removal, the recipient's `scheduled` payments become `cancelled` in the same transaction. Each writes `payment.cancelled`, with the remover as actor.
- **Saving again.** Afterwards, the same routing number and full account number may be saved again as a new recipient with a new id. A removed invite's email may be invited again.

**Removal racing a send.** A removal and a send naming the same recipient are applied one at a time, each judged against the recipient's stored state as the other left it. Locking only the payment or the account does not achieve this. The outcomes are exactly these:

| Send kind | Send stored first | Removal first |
|---|---|---|
| Held (over the approval threshold) | the send answers `201` `pending_approval` and the removal answers `409` `recipient_has_pending_payments`; the recipient stays active and the hold stands | the removal answers `204` and the send answers `404`; no payment row, no hold, no audit event |
| Scheduled | the send answers `201` `scheduled`; the removal answers `204` and cancels it with a `payment.cancelled` event by the remover | the removal answers `204` and the send answers `404` |
| Direct | the send answers `201` `posted` and the removal answers `204` | the removal answers `204` and the send answers `404` |

No `pending_approval` or `scheduled` payment ever references a removed recipient.

**Payment states.**

- **Creation.**
  - `posted` when `amount_cents` is at most the approval threshold and there is no `scheduled_for`. The debit is applied at once.
  - `pending_approval` when `amount_cents` exceeds the approval threshold and there is no `scheduled_for`. The hold is placed, and `expires_at` and `approve_by` are set.
  - `scheduled` when `scheduled_for` is given. Nothing moves.
  - In every case, `recipient_name` is set from the recipient's display name at that moment.
- **Legal edges.**
  - `pending_approval` to `pending_approval`, on a first of two approvals
  - `pending_approval` to `posted`, on the final approval
  - `pending_approval` to `rejected`, on a rejection at any point before posting
  - `pending_approval` to `expired`, at its expiry instant
  - `scheduled` to `cancelled`, on a cancel or a recipient removal
  - `scheduled` to `posted` or `failed`, on its effective date
- **Refused edges.** Approve or reject on any other status answers `payment_not_pending`. Cancel on any other status answers `payment_not_scheduled`. Each of these comes after the role check under Roles inside one company.

**Approval expiry.**

- **`expires_at`.** It is set when a payment is created as `pending_approval`. It is 00:00 America/New_York on the fifth Federal Reserve business day strictly after the New York date of the payment's `created_at`. Business days count by the calendar under Federal Reserve business days. That midnight is resolved on its own date by that date's daylight-saving rule, as for effective-date posting.
- **`approve_by`.** It is the New York date of the last instant before `expires_at`, which is the calendar day before the expiry date.
- On a payment created in any other state, both fields are null. Both are server-owned.
- **Worked examples.**

  | `created_at` | New York creation date | `expires_at` | `approve_by` |
  |---|---|---|---|
  | `2027-07-02T19:00:00Z` | Fri 2 July 2027 | `2027-07-12T04:00:00Z` | `2027-07-11` |
  | `2027-07-02T03:30:00Z` | Thu 1 July 2027 (23:30) | `2027-07-09T04:00:00Z` | `2027-07-08` |
  | `2027-03-08T15:00:00Z` | Mon 8 March 2027 | `2027-03-15T04:00:00Z` (daylight time) | `2027-03-14` |
  | `2027-11-01T14:00:00Z` | Mon 1 November 2027 | `2027-11-08T05:00:00Z` (standard time) | `2027-11-07` |
  | `2027-11-05T15:00:00Z` | Fri 5 November 2027 | `2027-11-15T05:00:00Z` (Veterans Day, Thu 11 November, skipped) | `2027-11-14` |

  In the second row, counting from the UTC date, 2 July, would wrongly give 12 July.
- **Processing.** Within 60 seconds after `expires_at`, a payment still `pending_approval` is expired in one transaction. That transaction:
  - stores the status `expired`
  - releases its hold exactly once
  - writes `payment.expired`, with actor `system@tallwind.invalid` and the payment's `amount_cents`

  Nothing is debited and no effective date is set.
- **Between the instant and processing.** For at most 60 seconds after `expires_at`, reads may still show the payment as `pending_approval`, with its hold still counted.
- **Late decisions.** An approve or reject arriving at or after `expires_at` answers `payment_not_pending`, even if the expiry has not been processed yet. If it has not, that same transaction records the expiry as stated above. A decision racing the expiry leaves exactly one outcome. The payment is either decided before `expires_at`, or expired, with one `payment.expired` event and one hold release.
- **Catch-up.** A `serve` start whose clock is already past a payment's `expires_at` expires it within 60 seconds of health first answering `200`. It works through these together with due effective-date postings, in order of due instant (posting midnight or `expires_at`), then `created_at`.
- **Each payment once.** A payment is expired exactly once, even when the regular run, catch-up and a late decision overlap.

**Posting.**

- Posting debits the source by `total_debit_cents`: `amount_cents`, or the quote's total debit for a quoted wire.
- Posting does all of this in the same database transaction:
  - writes a `debit` transaction whose `counterparty` is the payment's `recipient_name`, whose method is the payment's method and whose `memo` is the payment's memo
  - stamps the payment's `effective_date`, as stated under Settlement dates and cutoffs
  - stores the payment as `posted`

  The posting-instant rule applies only to direct sends and final approvals. A scheduled payment keeps the effective date stored when it was scheduled.
- A direct send, and the creation of a held payment, are refused with `insufficient_funds` when the source's `available_cents` is smaller than `total_debit_cents`. Because the funds check comes before the hold, an amount over both the available balance and the threshold is refused.
- USD payments carry no fee.

**Settlement dates and cutoffs.** These are Tallwind's own customer cutoffs, judged in America/New_York local time on the business clock, using that day's own daylight-saving rule. Posting always debits the balance at once. The effective date is the day the money settles at the recipient's bank.

- **Direct sends and final approvals.** For these two cases only, the `effective_date` comes from the posting instant: the moment of a direct send, or the moment of the final approval for a held payment.
  - `ach`: today's New York date when today is a Federal Reserve business day and the New York time is before 16:00:00.000; otherwise the next business day.
  - `wire`: the same rule with a 17:00:00.000 cutoff.
  - `rtp`: always today's New York date, every day of the year, weekends and holidays included.
  - `check`: always the first business day strictly after today.
  - The cutoff edge is exclusive: a send is same-day only while the time is before the cutoff.
- **Held payments.** `effective_date` is null while `pending_approval`, and stays null on rejection or expiry. The final approval stamps it by the rule above at the approval instant, never at creation.
- **Scheduled payments.** `ach`, `wire` and `check` take the first Federal Reserve business day on or after `scheduled_for`, as stated under Federal Reserve business days. `rtp` takes `scheduled_for` itself, even on a weekend or holiday. The effective date is stored at scheduling and kept when the payment posts.
- **Worked examples.** 2 July 2027 is a Friday, and Monday 5 July 2027 is an observed holiday. Daylight time begins on Sunday 14 March 2027 and ends on Sunday 7 November 2027.

  | Method | Posting instant | `effective_date` |
  |---|---|---|
  | `ach` | `2027-07-02T19:59:59Z` (15:59:59 New York) | `2027-07-02` |
  | `ach` | `2027-07-02T20:00:00Z` (16:00:00 New York) | `2027-07-06` |
  | `wire` | `2027-07-02T20:59:59Z` | `2027-07-02` |
  | `wire` | `2027-07-02T21:00:00Z` | `2027-07-06` |
  | `rtp` | any instant on Saturday 3 July 2027 New York | `2027-07-03` |
  | `check` | any instant on Friday 2 July 2027 New York | `2027-07-06` |
  | `ach` | `2027-03-12T20:30:00Z` (15:30 New York, standard time) | `2027-03-12` |
  | `ach` | `2027-03-15T20:30:00Z` (16:30 New York, daylight time) | `2027-03-16` |
  | `wire` | `2027-11-08T21:30:00Z` (16:30 New York, standard time) | `2027-11-08` |

  A held $6,000.00 ACH payment is created at 15:59 New York time on 2 July 2027 and finally approved at 16:00. It gets `2027-07-06`.

**Settlement preview.** `GET /api/me` reports what a direct send would get at the moment of the request. It uses the same settlement rule above, never a second copy of it.

- `settlement_dates` holds the `effective_date` a direct send posted at `business_now` would get, for each of `ach`, `wire`, `rtp` and `check`.
- `settlement_dates_change_at` is the earliest instant after `business_now` at which at least one of those four dates would differ. It is always either a 16:00 or 17:00 New York cutoff or a New York midnight. Each is resolved on its own date by that date's daylight-saving rule, never by adding 24 hours to an earlier midnight.
- **Worked examples.**

  | `business_now` | `settlement_dates` | `settlement_dates_change_at` |
  |---|---|---|
  | `2027-07-02T19:59:40Z` | ach `2027-07-02`, wire `2027-07-02`, rtp `2027-07-02`, check `2027-07-06` | `2027-07-02T20:00:00Z` |
  | `2027-03-13T23:00:00Z` | ach `2027-03-15`, wire `2027-03-15`, rtp `2027-03-13`, check `2027-03-15` | `2027-03-14T05:00:00Z` (midnight, standard time) |
  | `2027-11-06T23:00:00Z` | ach `2027-11-08`, wire `2027-11-08`, rtp `2027-11-06`, check `2027-11-08` | `2027-11-07T04:00:00Z` (midnight, daylight time) |

**Approvals.**

- **Thresholds.** The approval threshold is 500000 cents ($5,000.00). The dual-approval threshold is 5000000 cents ($50,000.00).
- **Approvals required.** `approvals_required` is:
  - 0 for an amount at or under the approval threshold
  - 1 for an amount over the approval threshold and at or under the dual-approval threshold
  - 2 for an amount over the dual-approval threshold
- **Who may approve.** An owner or admin of the company who is not the payment's creator. A member, or the creator, gets `403`.
- **Distinct approvers.** Each approval is stored with its approver's id. The same user approving again answers `already_approved`. A payment that is no longer pending answers `payment_not_pending` before this check.
- **Before the last approval.** The answer is `200`, status `pending_approval`, with the approvals list grown by one. Nothing moves.
- **The last approval.** The approval that reaches `approvals_required` converts the hold into the debit and posts the payment.
- **Who may reject.** Any owner or admin, including the creator. A member gets `403`. A rejection releases the hold and moves nothing, even after a first approval.

**Roles inside one company.** A role check is answered before anything about the record's state or the request body, following the error precedence.

- **Cancel.** Allowed for the payment's creator, an owner or an admin. A member cancelling a payment created by another user gets `403` whatever its status, posted included, never `payment_not_scheduled`. A member cancelling their own posted payment gets `payment_not_scheduled`.
- **Approve and reject.** A member gets `403` on a payment in any status. The creator approving their own payment gets `403` in any status, including after it was rejected or expired.
- **Invoices.** A member sending an invoice or marking one paid gets `403`, even with a body that is not valid JSON or fails validation.
- **Draws.** An admin or member drawing on a loan gets `403`, even with a body such as `{"amount_cents":"x"}`.
- **Other role refusals.** A member removing a recipient, creating an account or reading the audit trail gets `403`.
- **Nothing happens.** A `403` moves nothing, stores nothing and writes no audit event.
- **Other companies.** Every id of another company answers `404` before any role check. So the outsider using these Larkspur ids gets `404`, never `403`.

**Simultaneous approval decisions.** All approvals and rejections of one payment are applied one at a time, each judged against the state the one before left.

- **Two distinct approvers together.** When both eligible approvers of a two-approval payment approve at once, both approvals are recorded:
  - one answers `200` `pending_approval` with one approval
  - the other answers `200` `posted` with two approvals
  - the source is debited once
  - the audit trail gains `payment.approved`, `payment.approved`, `payment.posted`
- **Several final approvals together.** Exactly one answers `200` `posted`. Every other answers `payment_not_pending`. There is one debit.
- **A final approval racing a rejection.** Exactly one answers `200` and the other answers `payment_not_pending`. The stored state matches the winner: either `posted`, with one debit and a `payment.posted` event, or `rejected`, with no debit and no `payment.posted` event.

**Idempotency.**

- `POST /api/payments`, `POST /api/transfers` and `POST /api/loans/{loan_id}/draw` accept `Idempotency-Key`.
- **Scope.** A key is scoped to the caller's company and the endpoint, meaning the method plus the full path including the loan id. Two companies using one key run two independent operations, and so does one key used on a transfer and on a draw.
- **What is stored.** Only a successful answer is stored against its key, in the database, together with the request body. A refused request, including a `401`, stores nothing and may be retried.
- **Comparing bodies.** Bodies are compared on every key the endpoint reads, including `memo`, `scheduled_for` and `fx_quote_id`.
- **Replay.** The same key with the same body returns the stored status and the byte-identical stored body of the first success. The answer is not rebuilt from current state, so a replayed draw shows `drawn_cents` as of its first success, even after later draws. A replay makes no second debit, credit, feed row or audit event.
- **Durability.** Stored keys survive a `serve` restart.
- **Conflict.** The same key with a different body answers `idempotency_key_reused`, and nothing moves.
- **Simultaneous duplicates.** Requests with one key and one body produce one operation, and every answer is that operation's stored answer, carrying its `id`.
- **Retention.** A key replays while the business clock is before its first success plus 24 hours. From exactly 24 hours after the first success, the same key with any body is a new operation.

**Concurrent sends.** Payments, held-payment creations, transfers and effective-date postings against one account are applied one at a time. When two of them together exceed the available balance, exactly one succeeds. The other answers `insufficient_funds`, or, for a posting, becomes `failed`.

**Federal Reserve business days.**

- "Today" is the current New York date on the business clock. A `scheduled_for` of today or earlier is `validation` on `scheduled_for`.
- A scheduled `amount_cents` must be at most the approval threshold; otherwise it is `validation` on `amount_cents`. Scheduling does not check funds.
- A business day is a Monday to Friday that is not an observed Federal Reserve holiday.
- **The eleven holidays.**
  - New Year's Day (1 January)
  - Martin Luther King Jr. Day (third Monday of January)
  - Washington's Birthday (third Monday of February)
  - Memorial Day (last Monday of May)
  - Juneteenth National Independence Day (19 June)
  - Independence Day (4 July)
  - Labor Day (first Monday of September)
  - Columbus Day (second Monday of October)
  - Veterans Day (11 November)
  - Thanksgiving Day (fourth Thursday of November)
  - Christmas Day (25 December)
- **Weekend holidays.** A fixed-date holiday falling on a Sunday is observed the following Monday. A fixed-date holiday falling on a Saturday is not observed on any other day, so the Friday before stays a business day.
- **Rolling.** "The first business day on or after" a date rolls forward one day at a time until it reaches a business day.
- **2027.** The observed holidays are 1 January, 18 January, 15 February, 31 May, 5 July, 6 September, 11 October, 11 November and 25 November. 19 June and 25 December fall on Saturdays and are not observed.
- **Worked examples for scheduled ACH, wire and check payments.**

  | `scheduled_for` | `effective_date` |
  |---|---|
  | `2027-07-03` | `2027-07-06` |
  | `2027-07-04` | `2027-07-06` |
  | `2027-06-18` | `2027-06-18` |
  | `2027-12-24` | `2027-12-24` |
  | `2027-12-25` | `2027-12-27` |
  | `2027-11-25` | `2027-11-26` |
  | `2027-01-01` | `2027-01-04` |
  | `2027-01-16` | `2027-01-19` |
  | `2027-12-31` | `2027-12-31` |

**Effective-date posting.**

- **When it runs.** Every calendar day, weekends and holidays included. Within 60 seconds after 00:00 New York time on its effective date, a `scheduled` payment either posts as a direct send, judged against `available_cents`, or becomes `failed` and moves nothing.
- **Resolving midnight.** Each New York midnight is resolved on its own date by the America/New_York daylight-saving rules for that midnight instant. It is never derived from an offset captured when the payment was scheduled, from the offset at noon or at the current moment, or from a fixed 24-hour step after an earlier midnight.
- **Daylight-saving examples.**
  - A payment created at `2027-03-12T15:00:00Z` with effective date `2027-03-15` is still `scheduled` at `2027-03-15T03:59:50Z`. It posts after `2027-03-15T04:00:00Z`.
  - A payment with effective date `2027-11-08` is still `scheduled` at `2027-11-08T04:59:50Z`. It posts after `2027-11-08T05:00:00Z`.
- **Transition Sundays.**
  - A scheduled `rtp` payment effective `2027-03-14` is still `scheduled` at `2027-03-14T04:59:50Z` and posts after `2027-03-14T05:00:00Z`, because that midnight is still standard time.
  - One effective `2027-11-07` is still `scheduled` at `2027-11-07T03:59:50Z` and posts after `2027-11-07T04:00:00Z`, because that midnight is still daylight time.
- **Catch-up.** A `serve` start whose clock is already past a payment's effective-date midnight posts or fails every such due payment within 60 seconds of health first answering `200`. These are handled together with due approval expiries, in order of due instant, then oldest `created_at`.
- **Each payment once.** A payment is processed exactly once, even when catch-up and the midnight run overlap.
- **Worked example.** With the clock at 23:59:30 New York time on 5 July 2027, a payment effective `2027-07-06` is still `scheduled` 20 seconds later. It is `posted` within 90 seconds of that instant.

**Currency quotes.**

- **Rates.** The fixed rates, in foreign units per dollar, are `EUR` `0.9200`, `GBP` `0.7900` and `CAD` `1.3600`.
- **Amounts.** `foreign_amount_minor` is `amount_cents` times the rate. `fee_cents` is one percent of `amount_cents`. Each is computed exactly and rounded half up to a whole unit, so an exact half always rounds up. `total_debit_cents` is `amount_cents` plus `fee_cents`.
- **Worked examples.**

  | Currency | `amount_cents` | `foreign_amount_minor` | `fee_cents` | `total_debit_cents` |
  |---|---|---|---|---|
  | `GBP` | 12350 | 9757 | 124 | 12474 |
  | `GBP` | 250 | 198 | 3 | 253 |
  | `EUR` | 150 | 138 | 2 | 152 |
  | `CAD` | 350 | 476 | 4 | 354 |

- **Expiry.** `expires_at` is the creation time plus `FX_QUOTE_TTL_SECONDS` (600 seconds when unset). A quote is usable while the clock is before `expires_at`. A use at or after `expires_at` answers `quote_expired`.
- **One use.** A quote is used by exactly one posted or held payment. Any later use answers `quote_used`, and simultaneous uses leave one payment.
- **Thresholds.** Threshold and approval rules compare `amount_cents`.

**Invoices.**

- **Edges.** `draft` moves to `sent` by send. `sent` moves to `paid` by mark-paid.
- **Refused edges.**
  - Send on `sent` or `paid` answers `invoice_not_draft`.
  - Mark-paid on `paid` answers `invoice_already_paid`.
  - Mark-paid on `draft` answers `invoice_not_sent`.
- **Marking paid.** In one transaction, mark-paid:
  - writes one `credit` of the stored `total_cents` into `account_id`, with the customer name as `counterparty` and method `ach`
  - raises that account's balance
  - sets `paid_into_account_id`
  - stores the invoice as `paid`
- **Simultaneous calls on one invoice.**
  - Several mark-paid calls on one sent invoice: exactly one answers `200` and the rest answer `invoice_already_paid`, with one credit row.
  - Several sends of one draft: exactly one answers `200` and the rest answer `invoice_not_draft`.
  - A send and a mark-paid of one draft: the mark-paid answers `invoice_not_sent`, unless the send committed first. In that case it is judged as a mark-paid on a sent invoice. An invoice is never left `sent` with a credit row.

**Loans.**

- `remaining_cents` is `principal_cents` minus `drawn_cents`.
- A draw over `remaining_cents` answers `exceeds_available_credit` and moves nothing.
- A valid draw writes one `credit` into the loan's stored funding account, with the loan name as `counterparty` and method `wire`. It raises `drawn_cents` in the same transaction.
- Simultaneous draws are applied one at a time. When two draws each fit `remaining_cents` alone but not together, exactly one answers `200` and the other answers `exceeds_available_credit`. `drawn_cents` never exceeds `principal_cents`.

**Credits without lost updates.**

- Every credit and debit on an account is applied one at a time against that account's stored balance, whichever endpoint writes it: mark-paid, draw, send, transfer or effective-date posting.
- **Worked example.** With the seed data at start, these requests arrive at the same moment:
  - mark-paid of `INV-1002`, `INV-1004` and `INV-1005` into Checking
  - an owner draw into Checking
  - an admin direct send from Checking
  - an admin transfer from Savings to Checking

  Each succeeds or is refused by its own rule, and each invoice is credited exactly once. Checking's `balance_cents` equals its stored credits minus its debits, and the audit `seq` has no gaps.

**Transfers.**

- A transfer writes a `debit` with method `transfer` on the source and a `credit` with method `transfer` on the destination. Each leg names the other account as `counterparty` and carries the transfer's `memo`.
- Both legs carry the transfer's `id` as `transfer_id` and share one `created_at`. Both balances change in one transaction.
- **Opposite directions.** Transfers in opposite directions between the same two accounts may arrive together. Each answers `201` or `insufficient_funds`. None answers a `5xx`, none is lost to a database deadlock, and none is applied twice by a retry.
- **Invariants.** After any mix of concurrent transfers, sends, draws and settlements:
  - every balance equals its credits minus its debits
  - every transfer has exactly two legs
  - total cash changes only by money entering or leaving the company

**Audit chain.**

- **What writes an event.** Every money movement and payment state change writes exactly one event per action below, in the same transaction:

  | Action | Written when |
  |---|---|
  | `payment.created` | a payment is created, in any state |
  | `payment.approved` | each approval |
  | `payment.posted` | a payment posts: directly, after approval or on its effective date |
  | `payment.rejected` | a rejection |
  | `payment.expired` | a held payment expires |
  | `payment.cancelled` | a cancel, or a cancellation by recipient removal |
  | `payment.failed` | an effective-date failure |
  | `transfer.posted` | a transfer |
  | `invoice.paid` | an invoice is marked paid |
  | `loan.drawn` | a loan draw |

- **Order.**
  - A direct send writes `payment.created` then `payment.posted`.
  - A held or scheduled payment writes `payment.created` when it is created.
  - A final approval writes `payment.approved` then `payment.posted`.
- **`amount_cents`.**
  - On `payment.posted` it is the payment's `total_debit_cents`.
  - On the other payment actions it is the payment's `amount_cents`.
  - On `transfer.posted`, `invoice.paid` and `loan.drawn` it is the amount moved.
- **`payment_id`.** Null for transfer, invoice and loan events.
- **`actor_email`.** The signed-in user acting at that moment, or `system@tallwind.invalid` for an effective-date posting or failure and for an expiry.
- **`seq`.** Counts 1, 2, 3 onward within the company with no gaps, even when approvals, expiries, transfers, draws and settlements are written at the same moment.
- **Hashes.**
  - `hash` is the lowercase hex SHA-256 of `prev_hash|seq|action|payment_id|amount_cents|actor_email`, with an empty string for a null `payment_id`.
  - The first `prev_hash` is sixty-four zeros. Each later `prev_hash` is the previous `hash`.
- **Append-only, enforced by the database.** `UPDATE`, `DELETE` and `TRUNCATE` on `audit_events`, issued through `DATABASE_URL` with the app's own role, fail with a database error and leave every row unchanged. The schema step installs this protection on every start without error.
- **Refusals.** A refused request writes no event. The one exception is a late decision that records an expiry: that writes the expiry's own `payment.expired` event.

**Tenancy.**

- Every record belongs to one company, and every read and write is limited to the caller's company. This covers:
  - accounts, transactions, recipients, payments, approvals, invoices, loans, quotes and audit events
  - search, snapshot totals, statements and stream events
  - idempotency keys
- An id of another company is treated exactly like an id that does not exist. This applies:
  - in the path
  - in the `account_id` query parameter
  - in the body keys `source_account_id`, `recipient_id`, `fx_quote_id`, `account_id`, `from_account_id` and `to_account_id`

  Nothing moves, nothing is stored and no audit event is written.
- **Malformed ids.** A path segment, query value or read body key in an id position may not be a string of the form the server issues. Examples: `abc`, `1 OR 1=1`, a 5,000-character string, `../`, a string holding a NUL, a number, `null` or an object. It answers `404` `not_found`, exactly like an unknown id, never a `5xx`. A missing required id key is `validation` instead, and a null or absent `fx_quote_id` means no quote.

**Server-owned fields.**

- A body may carry keys beyond those its endpoint reads. They are ignored: they never change state, never cause a `404` and never cause `validation`.
- These are never taken from any body: `id`, `company_id`, `user_id`, `role`, `status`, `approvals_required`, `approvals`, `created_by`, `created_at`, `effective_date`, `expires_at`, `approve_by`, `total_debit_cents`, `account_last4`, `balance_cents`, `available_cents`, `drawn_cents`, `principal_cents`, `total_cents`, `paid_into_account_id`, `funding_account_id` and `transfer_id`.
- The rule covers inquiries too, as stated under Sales inquiries.
- **Examples.**
  - A member's $50,001.00 payment is sent with `"status":"posted"`, `"approvals_required":0`, `"created_by":"<admin id>"` and `"expires_at":"2099-01-01T00:00:00Z"`. It is stored `pending_approval`, with two approvals required, created by the member, and with the server's own `expires_at`. The admin may approve it.
  - A sign-up carrying `"company_id":"<Larkspur id>"` and `"role":"admin"` creates a new company, as stated under New companies. Larkspur Studio's memberships are unchanged.
  - `POST /api/accounts` carrying `balance_cents` starts at 0.
  - `POST /api/recipients` carrying `"status":"pending"`, `"account_last4":"9999"` and `"company_id":"<Outpost id>"` stores an active recipient of the caller's company. Its `account_last4` comes from its account number.
  - A mark-paid carrying `"total_cents":1` credits the stored total.
  - A draw carrying `funding_account_id` credits the loan's stored funding account.

**Sessions.**

- Emails are trimmed and lowercased before every comparison.
- A session lasts until sign-out and survives a reload.
- A taken email on sign-up answers `email_taken`. That is the only answer anywhere in the product that reveals whether an email has an account.
- **Sign-out revokes every use.** After `POST /api/auth/logout`:
  - every request with that token answers `401`
  - within 2 seconds, the server closes every open stream authenticated by that token
  - no event for a transaction created after the logout answer is delivered on those streams
  - a stream reconnect with that token answers `401`
  - the same user's other sessions, and their streams, are unaffected

**Sign-in refusal and lockout.**

- **Identical refusals.** A sign-in with an email that has no account, and one with a known email and a wrong password, answer the identical `401` `invalid_credentials`: same status, same body, same headers apart from Date. Each counts as one failure for that email.
- **Equal work.** Passwords are stored with scrypt, bcrypt or Argon2, at a cost of at least 50 milliseconds per check. A sign-in with an unknown email performs the same password-hash work as a wrong password. So over ten of each, the median answer time for unknown emails is at least half the median for wrong passwords.
- **Every email locks.** Lockout applies to every email, whether or not it has an account.
  - Once one email has five failures within the lockout window, every further sign-in for it answers `too_many_attempts`, even with the right password, until the oldest of those five falls outside the window.
  - A `too_many_attempts` answer is not itself counted.
- **Window.** The window is `LOGIN_LOCKOUT_WINDOW_SECONDS` (900 seconds when unset), measured on the business clock.
- **One attempt at a time.** Attempts for one email are counted one at a time. So of ten wrong sign-ins for one email arriving together, exactly five answer `401` and five answer `429`.
- **Durable.** Failures are kept in the database, so a restart of `serve` keeps them. Five failures, then a restart, then a sign-in with the right password answers `429`.
- **Clearing.** A successful sign-in before the fifth failure clears that email's failures.

**Sales inquiries.**

- **Types.** `email`, `first_name`, `last_name`, `company`, `message` and `source` must each be a JSON string. A number, array, object, boolean or null in any of them is `validation` naming that field, and nothing is stored.
- **Honeypot.** `website` counts as empty when it is absent, null, or a string that is empty after trimming. Any other value, string or not, counts as filled.
- **Text fields.** Each text field is trimmed of leading and trailing whitespace, normalised to Unicode NFC, and then measured in code points. An emoji counts as 1. An `e` followed by a combining acute accent becomes one `é` and counts as 1. A field that is only whitespace is blank.
- **NFC can lengthen text.** Lengths are measured after normalising, even when normalising adds code points. For example, 2,600 copies of U+0958 are 2,600 code points as sent and 5,200 after NFC. So that message is too long and is `validation` on `message`.
- **Limits.**
  - `first_name`, `last_name` and `company` are 1 to 120 code points.
  - `message` is 1 to 5,000 code points, and 5,000 is allowed.
- **Email.** `email` is trimmed and lowercased before validation, storage and rate counting. It must be at most 254 code points, with one `@`, a non-empty part before it, and a domain after it that contains a dot and no spaces.
- **Source.** `source` is exactly `contact` or `sales`, compared with letter case, so `Contact` is `validation` on `source`.
- **Server-owned keys.** `id`, `created_at` and any other key the endpoint does not read, such as `rate_count`, are ignored. The stored row's `id` is issued by the server and its `created_at` comes from the business clock. The `201` body returns those two values. So five valid inquiries carrying `"created_at":"2000-01-01T00:00:00Z"` still fill the window, and a sixth answers `rate_limited`.
- **Bounded work.** Every inquiry body up to the body cap is answered within 2 seconds. That includes bodies built to be slow to check, such as 500 characters of repeated `a.` with no `@`, or a message of 5,000 combining marks. It also holds when ten such bodies arrive together.
- **Storage.** The trimmed NFC values are stored.
- **Rate limit.**
  - When five inquiries are already stored for one normalised email within the inquiry window, the next valid inquiry from that email answers `rate_limited` and stores nothing.
  - Only stored inquiries count. An invalid, honeypot or refused inquiry never uses a slot.
  - The window is `INQUIRY_RATE_WINDOW_SECONDS` (600 seconds when unset), measured on the business clock against the stored `created_at`.
  - Inquiries for one email are counted one at a time. So when ten valid inquiries arrive together into an empty window, exactly five answer `201`, five answer `429`, and five rows are stored.

### Services (DP-01, DP-05, DP-14, DP-26, DP-40, DP-46, DP-49, DP-50, DP-54, DP-57, DP-64, DP-66, DP-72, DP-79, DP-87)

**Connection and schema.** PostgreSQL is reached through `DATABASE_URL` as a non-superuser that owns its database. The app applies its schema, including the audit protection, every time it serves and whenever the database first becomes reachable, so a fresh, empty database works. Times are stored in UTC.

**Connections and open streams.**

- At no moment does the app hold more than 10 connections to the database. This counts every connection it opens for any purpose: requests, streams, effective-date posting, approval expiry and schema work.
- A stream never keeps a database connection to itself for its whole life, so the number of open streams does not raise the number of connections.
- With 100 streams open at once, from any mix of companies, each still receives its own company's new transactions within 2 seconds, and every other API request is still answered within 2 seconds.
- When a stream's client disconnects, or its session signs out, everything the server holds for that stream is released within 5 seconds. That means its timers, its listener registrations and any database work started for it. No app connection is then left active, or idle inside a transaction, on its behalf.
- **Worked example.** After 200 streams have been opened and dropped, within 5 seconds the app holds at most 10 database connections, health answers `200`, and a newly opened stream receives a new transaction within 2 seconds.

**What the database keeps.** Besides the tables below, sessions, sign-in failures and idempotency records live in the database, so a restart keeps them.

**Seeding and restarts.**

- Seeds are written only when the database holds none, at the first moment the database is reachable.
- Restarting `serve` against the same database adds, changes or removes no row in any table listed below. The exceptions are due effective-date postings and failures and due approval expiries, with their transaction, balance, payment and audit rows.

**Tables tests read.** These tables have exactly these names; other tables are yours to choose:

`users`, `companies`, `memberships`, `accounts`, `transactions`, `recipients`, `payments`, `invoices`, `loans`, `plans`, `inquiries`, `audit_events`, `fx_quotes`.

| Table | Contents |
|---|---|
| `memberships` | `user_id`, `company_id`, `role` (`owner`, `admin` or `member`) |
| `accounts` | `company_id`, `name`, `kind`, `balance_cents` |
| `transactions` | `account_id`, `direction`, `amount_cents`, `method`, `counterparty`, `memo`, `transfer_id`, `created_at` |
| `recipients` | `company_id`, `display_name`, `status`, `account_last4`. The full account number is never stored in readable form. |
| `payments` | `company_id`, `source_account_id`, `recipient_id`, `amount_cents`, `total_debit_cents`, `status`, `approvals_required`, `created_by`, `effective_date`, `expires_at`, `created_at` |
| `invoices` | `company_id`, `number`, `total_cents`, `status` |
| `loans` | `company_id`, `principal_cents`, `drawn_cents`, `funding_account_id` |
| `inquiries` | exactly `id`, `email`, `first_name`, `last_name`, `company`, `message`, `source`, `created_at` |
| `audit_events` | one row per audit event, with `company_id`, `seq`, `action`, `payment_id`, `amount_cents`, `actor_email`, `prev_hash`, `hash`, `created_at` |

Passwords are stored only as a one-way hash, as stated under Sign-in refusal and lockout.

**When the database is down.** The behaviour at boot is stated under Server boundary. The behaviour while running is stated under Database outages in Business rules. The pages show the outage and recovery copy from Feedback states.

### Seed data (DP-01, DP-09, DP-11, DP-26, DP-27, DP-30, DP-46, DP-52, DP-72)

On first start, the app seeds the records below and writes the logins to `/app/USER_README.md`. Every seeded person and business is invented.

**First start.** First start is the moment the seed is written: the first moment `serve` reaches an empty database. That may be later than the moment `serve` started (see Server boundary). Its New York date on the business clock is the first-start date.

**Seed timing.** Each transaction listed as "N days before first start" is created at 12:00 noon America/New_York on the New York calendar date N days before the first-start date. Dates step by calendar date.

**Larkspur Studio.**

- **Users.** Every seeded user has the password `deku-demo-pw-2026`.

  | Role | Email | Name |
  |---|---|---|
  | owner | `owner@example.com` | Rowan Pike |
  | admin | `admin@example.com` | Imani Cole |
  | member | `member@example.com` | Theo Marsh |

- **Accounts**, in this order:
  - `Checking`: kind `checking`, `balance_cents` 1842050
  - `Savings`: kind `savings`, `balance_cents` 6000000
- **Checking transactions**, oldest first:

  | Days before first start | Direction | `amount_cents` | Counterparty | Method |
  |---|---|---|---|---|
  | 20 | credit | 1555690 | `Larkspur Studio` | ACH |
  | 12 | credit | 420000 | `Brightline Media` | ACH |
  | 6 | debit | 125000 | `Northwind Supply` | ACH |
  | 2 | debit | 8640 | `Corner Print Shop` | card |

- **Savings transaction.** One credit of 6000000 from `Larkspur Studio` by ACH, 25 days before first start.
- Seeded transactions have a null `memo` and a null `transfer_id`.
- **Recipient.** `Northwind Supply`: kind `business`, method `ach`, status `active`, account number `000123456612`, routing number `021000021`, `account_last4` `6612`.
- **Invoices.**

  | Number | Customer | `total_cents` | Status |
  |---|---|---|---|
  | `INV-1002` | `Brightline Media` | 275000 | `sent` |
  | `INV-1003` | `Brightline Media` | 90000 | `draft` |
  | `INV-1004` | `Fieldstone` | 61875 | `sent` |
  | `INV-1005` | `Harbor Row Cafe` | 12500 | `sent` |

- **Loan.** `Larkspur Venture Line`: `principal_cents` 25000000, `drawn_cents` 0, funding account `Checking`.

**Outpost Goods.**

- **User.** Owner `outsider@example.com` (Sasha Reyes), with the same password.
- **Account.** `Outpost Checking`: kind `checking`, `balance_cents` 250000. It has one credit of 250000 from `Outpost Goods` by ACH, 10 days before first start.
- **Recipient.** `Cedar Freight`: kind `business`, method `ach`, status `active`, account number `000987654321`, routing number `021000021`, `account_last4` `4321`.
- No invoices and no loans.

**Seeded sparklines.** For example, with the seed data at start, on the first-start date and before any further money moves, the sparklines read exactly as follows (index 0 is the oldest, index 29 is today):

| Account | Indexes and values |
|---|---|
| `Checking` | 0–8: 0; 9–16: 1555690; 17–22: 1975690; 23–26: 1850690; 27–29: 1842050 |
| `Savings` | 0–3: 0; 4–29: 6000000 |
| `Outpost Checking` | 0–18: 0; 19–29: 250000 |

Every seeded account starts with `available_cents` equal to its `balance_cents`.

**Shared.**

- **Plans.**

  | `name` | `monthly_cents` | `annual_cents` |
  |---|---|---|
  | `base` | 0 | 0 |
  | `plus` | 2390 | 29590 |
  | `pro` | 34990 | 239990 |

- Both audit trails start empty.
- Nothing else is seeded: no payments, no inquiries, and no extra users, companies or recipients.

## Technical requirements

### Deployment (DP-40, DP-46, DP-56, DP-72, DP-87)

- **Runtimes.** Node.js (current LTS) and Python 3 are available; choose any stack. For a Python stack, the app is installed and run as an unprivileged user. Dependencies go into a `.venv` inside `/app`, and the manifest calls tools by path (`.venv/bin/<tool>`) or as `python -m <tool>`.
- **Run manifest.** `/app/run.json` holds the string fields `install`, `build` and `serve`, and `"_schema": "run-manifest-v1"`. Use an empty string for a step you do not need. For example:

  ```json
  {"_schema":"run-manifest-v1","install":"npm ci","build":"npm run build","serve":"npm run start"}
  ```

  The verifier runs the three steps in order from `/app`. It may stop `serve` and rerun it against the same database with a different `APP_NOW`. `install` and `build` need no database.
- **Extra copies of `serve`.** Besides the main instance, these copies run from the same `/app` build, each on its own port given by `APP_PUBLIC_PORT`:
  - Two copies started alongside the main instance. One has a `DATABASE_URL` naming an address where no database ever answers. The other has a database of its own that starts empty.
  - Copies the verifier starts itself for the relay checks. Each gets a scratch database the verifier creates with the app's own credentials. The connection goes through a relay the verifier runs on a local TCP port, so the `DATABASE_URL` looks like any other database address. The verifier cuts and restores that relay, as stated under Server boundary and under Database outages in Business rules, and may set `APP_NOW` on these copies.

  Every copy behaves exactly like the main instance. Nothing in the app may depend on running as the only copy or on a particular database name.
- **Listening.** The server binds `0.0.0.0`, never a loopback address. It listens on `APP_PUBLIC_PORT` when set, otherwise on 4173. Its public address is `APP_PUBLIC_URL`.
- **Health.** Health behaves as stated in API.
- **Production.** The app serves a production build, never a dev server, and starts with no manual steps. Effective-date posting and approval expiry run inside the served app, with no separate scheduler process.
- **Lifetime.** The server keeps running after your session ends and is not a child of your shell.
- **Files.** `/app/USER_README.md` lists the seeded logins. The empty directories `.browser_screenshots/` and `.downloads/` exist at `/app`.
- **Clean database.** The verifier starts from an empty database. Rows you create while trying the app are not left behind.
- **No container extras.** No persistent volumes, fixed container names or custom networks.

### Configuration and secrets (DP-17, DP-18, DP-35, DP-50, DP-51)

The app reads these variables at start:

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | the database |
| `APP_PUBLIC_PORT` | the listening port |
| `APP_PUBLIC_URL` | the public address |
| `APP_NOW` | the business clock's starting instant |
| `LOGIN_LOCKOUT_WINDOW_SECONDS` | the lockout window |
| `INQUIRY_RATE_WINDOW_SECONDS` | the inquiry rate window |
| `FX_QUOTE_TTL_SECONDS` | the quote lifetime |

The clock rule and the duration defaults are stated in Business rules. Credentials are never hard-coded, never sent to the browser, and never written into any page, script or response.

### Server boundary (DP-30, DP-31, DP-33, DP-35, DP-40, DP-47, DP-49, DP-54, DP-59, DP-65, DP-68, DP-70, DP-72, DP-84, DP-85, DP-89)

- **Same origin.** Pages and API share one origin. The server sends no header that lets another origin read API responses. `OPTIONS` gets the `405` from API, with no `Access-Control-Allow-Origin` header.
- **Body cap.** Every request body to `/api` is limited to 32,768 bytes, counted as the raw bytes received. Exactly 32,768 bytes is allowed. A larger body answers `413` `payload_too_large` and stores nothing.
- **JSON only.** A request to `/api` with a non-empty body is accepted only when its `Content-Type` media type is `application/json`. The media type is compared without regard to letter case, and optional parameters such as `charset=utf-8` are allowed. A non-empty body with any other content type, or with none, answers `415` `unsupported_media_type`, and nothing moves or is stored. A request with an empty body is not checked.
- **Never served.** Source files, source maps (`.map` files), the run manifest, environment files, lockfiles and credentials all answer `404`.
- **Unknown page addresses** answer `404` with the not-found page.
- **Database unreachable at boot.**
  - Two kinds of copy from Deployment exercise this. The copy whose database never answers stays unreachable for its whole life. A relay copy the verifier starts itself has a fresh, empty scratch database behind a relay that the verifier cuts before `serve` starts and restores later at the same address.
  - While the database is unreachable, the server still listens and serves pages. It answers health with its `503` body, and answers API requests that need the database with `503` `service_unavailable`. It retries the connection every few seconds and never exits because of the database.
  - Within 10 seconds of the database becoming reachable, health answers `200`. By then the schema, the audit protection and the seed are all in place, with no restart.
  - The seed is dated from the moment it is written, as stated under Seed data. For example, take a relay copy started with `APP_NOW=2026-12-01T04:59:00Z` (23:59 New York time on 30 November 2026), with the relay restored 90 seconds later. The first-start date is 1 December 2026. Checking's card debit, two days before first start, is created at 12:00 New York time on 29 November 2026. On 1 December 2026 the sparklines match the seeded table index for index.
  - Due scheduled payments and approval expiries then catch up as stated in Business rules.
- **Stored client data.** The browser stores at most the session token and the id of the last opened account. Feed filters, the Send payment draft and the pricing billing period live only in the address. Signing out, or a revoked session, clears both stored values.
- **Sign-in redirects.** After sign-in, `next` is taken after its single standard decoding as a query value. It is honoured only when all of these hold:
  - It starts with a single `/`, and its second character is not `/`.
  - It contains no backslash, control character or whitespace anywhere.
  - Its path part, everything before the first `?`, contains no `%2F`, `%5C` or `%2E` in any letter case.
  - No segment of its path part is `.` or `..`.
  - The first segment of its path part is exactly `app`, `payments`, `approvals`, `invoices` or `loans`, followed by `/`, `?` or the end.

  The query part, after the first `?`, may carry `%2F`, `%5C`, `%2E` and other escapes. So a Send payment draft whose memo reads "Invoice 7/2" survives sign-in.

  Anything else lands on `/app`. That includes `//evil.example`, `/\evil.example`, `/appx`, `/app.evil.example`, `https://evil.example/app`, `/app/../login`, `/app/..//evil.example`, `/payments/..%2F` and `/payments/./x`. A valid `next` keeps its query string, so feed filters and drafts survive sign-in. The redirect never leaves the current origin.

### Browser support and performance (DP-42, DP-43, DP-76)

**Browsers.** Current desktop and mobile Chromium are supported at these sizes: 320 pixels wide; 375 by 812, 768 by 1024 and 1280 by 800; and the cockpit edge widths 599, 600, 1023 and 1024 pixels. The cockpit reads correctly whatever the device's clock and time zone are set to.

**Pages checked for WCAG 2.2 AA.**

- `/`
- `/business-banking`
- `/business-payments`
- `/pricing`
- `/contact`
- `/login`
- `/signup`
- `/credit`
- `/treasury`
- `/app`
- `/payments/new`
- `/approvals`
- `/payments/recipients`
- `/payments/recipients/new`
- `/invoices`
- `/loans`

**Loading.**

- Marketing pages show their content in under about one and a half seconds on a mid-range laptop.
- The cockpit home is usable within three seconds of signing in, and within three seconds of opening a filtered address.
- Search results appear within about half a second of typing pausing, apart from the server's own time.
- Web fonts never leave text invisible.
- Imagery is rendered mock-ups or compressed images sized to their slot, never large video files or 3D scenes.

## Working rules

- IF-01: `/app/USER_README.md` lists the seeded logins `owner@example.com`, `admin@example.com`, `member@example.com` and `outsider@example.com` with the password `deku-demo-pw-2026`.
- IF-02: the empty directories `.browser_screenshots/` and `.downloads/` exist at the app root.
- IF-03: `/app/run.json` is a JSON object with `"_schema": "run-manifest-v1"` and string fields `install`, `build` and `serve`.
- IF-04: `/app/THIRD_PARTY_NOTICES.md` names every shipped package with its licence. Shipped packages means the production dependency tree (`npm ls --omit=dev --all --json`, or the lockfile's non-dev group).
- IF-05: every shipped package is licensed MIT, ISC, BSD-2-Clause, BSD-3-Clause, Apache-2.0, 0BSD or BlueOak-1.0.0, and every bundled font is OFL-1.1.
- IF-06: application data lives only in the PostgreSQL database at `DATABASE_URL`. No SQLite file, Redis, document store or in-memory store is a source of truth.
- IF-07: the agent downloads, installs and starts no PostgreSQL server or other backing service; the provided database is used as is.

## Engineering standards

- Money is integer cents everywhere on the server, and typed dollars become cents by exact digit arithmetic in the browser. No floating-point arithmetic touches a balance, amount, fee or quote.
- The business clock is defined once, and every business time reads it. No database clock default decides a business time. The browser never computes a settlement date, cutoff, holiday, weekday or approval deadline from its own clock.
- Each of these is defined once, and every check reads that one definition:
  - the approval and dual-approval thresholds
  - the per-method cutoffs
  - the approval expiry rule
  - the lockout count
  - the Federal Reserve holiday rule
  - the New York midnight rule
  - the dollar-input format
  - the available-balance computation
  - the cockpit breakpoints
- Each domain rule is decided in exactly one place in the source:
  - the payment, invoice and quote state transitions
  - the role checks
  - the settlement-date rule and its preview
  - the duplicate-recipient rule and recipient removal
  - the text-input rule and the code-point length rules
  - literal search matching and the latest-answer rule
  - CSV neutralisation
  - the New York end-of-day rule
  - the server-owned field list, id well-formedness and tenant scoping
  - the safe-`next` rule and the draft-address rule
  - the status-region announcement rule
- Every balance change, its feed row, its status change and its audit event are written in one database transaction. Concurrent decisions on one payment, recipient, invoice, loan, account or email are serialised by the database, never by in-process state. No request's user, company or answer is kept in process scope.
- Names in the code match the domain terms in this brief: recipient, payment, hold, available balance, approval, approve-by, expiry, effective date, cutoff, settlement preview, draft, invoice, draw, transfer, statement, inquiry, lockout.
- Every API error uses the one error shape from API, through one shared way of answering errors. Request bodies are read through an explicit list of accepted keys with checked types, never spread into stored records. No defensive checks guard states the rules make impossible.
- There is no dead, commented-out or unreachable code, no abstraction with a single implementation, and no feature or endpoint beyond this brief.
