# Merrowfield Coach Hire Wayticket

Wayticket is the working desk of one independent coach-hire arranger who works alone from Coventry, owns no vehicles and earns the margin between what a small partner operator charges and what a school, wedding couple, company or club will pay. It covers the public site and quote form, the private bid page, the private quote page, statements brought in from a file, the duty ribbon, the phone run sheet, documents and aftercare. It uses Postgres, MinIO, Mailpit, WireMock (five invented third-party APIs printed in full below), Gotenberg and ntfy. Out of scope: card payments or any payment gateway, staff accounts and roles, a fleet of the arranger's own, extra datastores, video, WebGL and 3D.

## Problem and users

Each hire today is scattered across a web form, mail threads to several operators, a spreadsheet of margins, a folder of licences and a bank statement read by eye. Comparison services connect customers with about 250 independent operators, who lose about two days a month writing quotes, while customers wait to collect comparable prices and meet overpricing and underquoting. Coach software is mostly sold to fleet owners and assumes vehicles and drivers on the books. The arranger pays personally for the gaps: a margin rounded a penny wrong, an operator whose cover ended the day before the hire's last day, a run that breaks drivers' hours across a clock change, a deposit nobody matched to the statement, or a driver on the road who reads no mail and was never told of a change.

- **Arranger** (daily, every desk screen): runs one desk alone, with no staff and no roles, through the 19 workflows: desk access, public site, quote request, address lookup, enquiries, trip plan, operators, operator bids, quote building, customer page, payments, diary, drivers' hours, passenger list and seat plan, driver run sheet, changes and cancellations, documents, aftercare, cross-cutting.
- **Customer** (occasional, only the public quote form and the private quote page): asks for a coach or minibus, reads and accepts a quote page in English, Polish or Urdu, and says the deposit has been sent.
- **Operator** (occasional, only the private bid page): prices, changes or withdraws a bid per vehicle on a page that shows only that hire's route, dates, vehicles and party size.
- **Driver** (on the day, only the private run sheet): follows one run sheet in English or Polish on a phone with no signal and presses Arrived, Boarded and Left at each stop.
- **Visitor** (occasional, only the public site): reads the site, finds the right occasion and starts a quote with that occasion already chosen.

A second seeded independent arranger exists only to prove that one desk's data never reaches another.

## Journeys

1. **A request becomes a ticket.** A visitor on a School trips page presses `Get a free quote`. The form opens on the Route step with School chosen. As each answer is given it travels into the Journey ticket. They go through `When and who` and `Your details`, press `Send request`, and see a thanks page with a reference. The arranger finds the enquiry at the top of `/enquiries`, holding what the ticket showed.
2. **From enquiry to priced plan.** The arranger opens a New enquiry, orders the stops, accepts or overrules the suggested vehicles and asks chosen operators. Each operator gets one mail, opens the private page without signing in and enters one price per vehicle. The arranger sees the bids sorted by price and awards the hire to one `Clear` operator. The losers each get one closing mail.
3. **From bought price to accepted quote.** The arranger adjusts the margin per vehicle, watching totals change in place, and sends the quote. The customer opens the private page in their language on a phone, types their full name to accept and presses `I've sent the deposit`. The page then shows that the payment is being checked, and no money has moved.
4. **The statement tells the truth.** The arranger brings a bank statement file in, reads the preview and presses `Bring in`. Matched money goes to deposits and balances per vehicle, paired ledger lines are written and `Money held` equals the ledger. Bringing the same file again changes nothing.
5. **A legal, known run.** The arranger moves a hire in the diary across a clock change and its wall time stays. They fix a breach on the duty ribbon by moving a break, confirm the run, assign a driver and see `Driver told` with a time only after ntfy has accepted the message. The passenger list and seat plan are ready to print.
6. **On the road with no signal.** The driver opens the run sheet on a phone with no signal and presses at each stop, with the waiting count growing on screen. Back in signal, the presses arrive in order and each counts once. The arranger sees waiting charges and presses `Accept charges`, and they land on the balance once.
7. **Things change.** The customer moves the date or the arranger reprices, and the old and new show side by side. A moved price gives a fresh private page and the old address has ended. A written cancellation, typed in UK time, gets its charge by UK calendar days, and refunds due show per vehicle.
8. **Paper and aftercare.** The arranger issues an invoice and sees its strip reach `Stored` only after the PDF is safely kept. They log a complaint with its reply date around Easter, log a found item with its holding date, bring in an old customer sheet, and close a customer who can be brought back for 7 days and is then erased.

## Mandatory requirements

This is the complete list of mandatory requirements; every check traces to one of these lines and the detailed sections below.

- **DP-01 — Desk access journey** A new desk signs up, signs in and out, changes its password so that the person's other sessions end, and creates, reads, renames and deletes a customer, with the status codes published in API.
- **DP-02 — Desks kept apart** One desk naming another desk's customer, hire, file, invoice or run by its identifier, in an address or inside a request body, gets the not-found answer and nothing from it, however many requests from two desks interleave.
- **DP-03 — Public site journey** The visitor reads the home, occasion, Fleet and Terms pages, while the slim bar, search overlay, Menu panel, question accordions, section rises, client marks, Message us ring and `On this page` rail follow Interactions and `Get a free quote` from an occasion page opens the form with that occasion chosen, and its screen meets the screen rules.
- **DP-04 — Public pages in the first response** Every public page answers from the server with its text in the first response, visible with no script, in print and under reduced motion.
- **DP-05 — Bounded public search** Search runs on the server over the public pages only, and over-long search text or over-deep JSON is refused within a second as API publishes.
- **DP-06 — Journey ticket journey** The customer walks three steps with one address each, with Back, Forward and reload keeping everything typed, each value travelling as one element into its ticket line and carrying on from where it is when changed in flight, the ticket moving from side panel to bottom bar and sheet at exactly 1024 px, and journey types keeping what was typed, and its screen meets the screen rules.
- **DP-07 — Pick-up clock rules** Today and Tomorrow, the hour list, short notice, the missing hour, the repeated hour and the return-after-pick-up rule follow the server's UK clock as Business rules publishes, whatever the device clock says.
- **DP-08 — Request limit, trap field and stored as sent** The sixth request in the window for one folded email is refused with a UK time, a filled `website` field stores nothing behind a normal thanks, and an accepted request is kept byte for byte as sent.
- **DP-09 — Address lookup journey** From, To and each stop use one combobox that asks once after the typing pauses, reuses what the page already has, ignores older replies, follows the combobox pattern, closes only the list on Escape and carries on when the provider fails, and its screen meets the screen rules.
- **DP-10 — Address provider rules** Address lookups go through the app's server to the published provider paths with at most a 5-second wait, a typed address is stored unchecked and marked on the desk, and postcodes print in the published form.
- **DP-11 — Enquiries journey** Filters, search and paging live in the address, an older search reply never shows, a refused state change goes back with its copy and focus kept, and Back returns to the same filters and scroll with focus on the row opened, and its screen meets the screen rules.
- **DP-12 — Stable list and merging** The enquiry list keeps 25 per page in the published stable order so a row added while reading neither repeats nor skips one, and requests sharing a folded email or telephone merge under the earlier reference.
- **DP-13 — Trip plan journey** Stops reorder by drag, touch and `Move up` and `Move down` with focus kept, one provider call per reorder and older replies ignored, a failed route keeps the last good one, and a typed plan is kept or refused in the published order, and its screen meets the screen rules.
- **DP-14 — Fewest vehicles plan** The suggested plan and the miles follow the published ordering and worked examples exactly, and a larger plan is kept and marked.
- **DP-15 — Operators journey** The arranger refreshes the directory, uploads and reads back papers, sees each operator's standing for a hire and meets the file-store outage copy with nothing half-written, and its screen meets the screen rules.
- **DP-16 — Directory all or nothing** `Refresh directory` reads every provider page, one failing page leaves the list exactly as it was, and an operator the directory no longer names stays marked.
- **DP-17 — Operator papers kept exactly** Papers are judged by their first bytes and never their name or stated type, kept byte for byte in MinIO, and limited by the published file-part size answered before authentication.
- **DP-18 — Clear for the hire's last day** An operator is `Clear` only if every required paper covers the hire's last day, with the school DBS date at exactly three years, and one expiry mail goes per paper as Business rules publishes.
- **DP-19 — Operator bids journey** The arranger asks chosen operators, each operator prices, changes or withdraws by private address, the table's sort stays in the address and scrolls in its own named frame at 375, an operator not `Clear` cannot be awarded and losers get one closing mail each, and its screen meets the screen rules.
- **DP-20 — Bid page shows one hire** The private bid page and every response behind it show only that hire's route, dates, vehicles and party size, work by address alone, accept only the published prices and refuse every misformed price.
- **DP-21 — Bid window edge** The server alone decides the bid window at each read and press, so a press in the second of `closesAt` is accepted, a press in any later second gets the published refusal and the page has ended from then on.
- **DP-22 — One award wins** Of two awards at once exactly one wins and the other reads the published line, and pressing `Award` twice sends no extra mail.
- **DP-23 — Quote building journey** Totals change in place on every input with one announcement and no older reply winning, and the arranger sends the quote from a screen that keeps what was typed, and its screen meets the screen rules.
- **DP-24 — Exact quote money** Selling price, VAT per vehicle and deposit at and over each limit match the worked examples to the penny on screen and in the API.
- **DP-25 — Rate tables by date** A rate table takes effect on its chosen date, so an edit changes the future only, a sent quote keeps its sending day's rates and two tables with one date are refused.
- **DP-26 — Stale quote edit** Saving over a newer quote is refused with the published line and what was typed stays on screen.
- **DP-27 — Customer page journey** The customer uses the page by touch at 375x812 in English, Polish or Urdu with `lang` and `dir` from the server before any script, the language held in the address, a typed-name acceptance refused as typed and `I've sent the deposit` changing no money, and its screen meets the screen rules.
- **DP-28 — Quote end decided at the server** A quote ends at the end of the fifth UK calendar day after sending, across a clock change, decided at each read and press with no sweep and never by the device clock.
- **DP-29 — Customer copies stay private** Bought-in prices, margin, operator names and unsigned notes reach no customer page, response field, mail or PDF, and an acceptance request can change only what is published.
- **DP-30 — Published customer strings** The customer page and run sheet print the published table of strings, date forms, money form and Polish and Urdu counts character for character, and a replaced page, an ended page and an unknown address each answer as published.
- **DP-31 — Payments journey** The arranger brings a statement in through a preview, sees matched, unmatched, money-out, already-seen and refused rows, presses `Bring in` and sees money per vehicle and `Money held` change, and its screen meets the screen rules.
- **DP-32 — Statement reading** Statement encoding, dates, quoted amounts, the reference grammar and the already-seen rule follow Business rules, and bringing the same file twice changes nothing.
- **DP-33 — Allocation and paired ledger** Money goes to vehicles by departure then list order to the penny as worked, every movement writes two ledger lines, each booking's lines sum to zero and `Money held` always equals the ledger.
- **DP-34 — Balance reminder** One reminder mail goes at the first daily check from 10 days before departure in UK dates while a balance is owed, as qualified in Business rules.
- **DP-35 — Safe downloads** Passenger and payment files neutralise risky cell starts with a straight apostrophe, are in UTF-8 with a byte order mark and carry Polish file names correctly.
- **DP-36 — Diary journey** The week lives in the address with one roving Tab stop, Alt with an arrow moves a hire and keeps focus through the refresh, drag works by pointer and touch with Escape putting it back, a driver clash is refused and the grid becomes an agenda at 375, and its screen meets the screen rules.
- **DP-37 — Wall time kept** A hire moved across a clock change keeps its local wall time with the published instants, and a week holding a change shows its 23 or 25 hour day.
- **DP-38 — Duty ribbon journey** One CSS pixel stands for one real minute, the break moves by drag, touch and arrows, blocks reflow once and carry on when interrupted, the breach shows from its exact minute without relying on colour, the table says the same as the ribbon and a breached run cannot be confirmed, and its screen meets the screen rules.
- **DP-39 — Hours limits in real minutes** Each published limit is judged in real elapsed minutes across clock changes and read at `GET /api/runs/<id>/hours`, and `Add second driver` clears them.
- **DP-40 — Passenger list and seat plan journey** The arranger brings in or types names, swaps people by keys, pointer and touch with focus on the seat dropped on and the published announcement, and prints the plan, and its screen meets the screen rules.
- **DP-41 — Seat grid and per-head split** Every size's grid adds up as published, wheelchair users take only the seats by the lift, adults short shows its published count, and a per-head split sums to the vehicle's total with earlier names taking the extra pennies.
- **DP-42 — Driver run sheet journey** The driver follows one private run sheet at 375x812 and 812x375 in English or Polish with big presses at each stop, and the arranger accepts charges once, and its screen meets the screen rules.
- **DP-43 — Driver told only when accepted** `Driver told` appears only after ntfy has accepted the message, one message per press on the published topic, and with ntfy down nothing is marked as told.
- **DP-44 — Queued presses counted once** With no signal the page and its queue survive a reload, presses are sent in order with their own repeat key and `secondsAgo`, and a replay returns the first answer and counts nothing twice.
- **DP-45 — Waiting charges** Waiting, the airport rule from the flight provider and comfort stops follow the worked amounts, and charges reach the booking only after `Accept charges`, once, by paired ledger lines.
- **DP-46 — Changes and cancellations journey** A change shows old and new side by side, a moved price gives a fresh private page while the old address has ended, refunds and amounts owed show per vehicle, and `Cancel booking` pressed twice records one, and its screen meets the screen rules.
- **DP-47 — Cancellation charges** Days are counted between UK calendar dates from the typed notice, each band gives its worked amount with the deposit floor and total cap, and a departure already gone cannot be cancelled.
- **DP-48 — Documents journey** The strip follows the server with each step's check drawn once and never again on a refresh, an issued invoice lists its history in order, and the PDF holds Polish letters and no margin or bought-in price, and its screen meets the screen rules.
- **DP-49 — PDFs kept only when confirmed** A document reads `Stored` only after Gotenberg has answered and MinIO has confirmed, and either outage saves nothing, shows its copy and takes no number.
- **DP-50 — Gapless numbers per desk** Invoice and credit note numbers run with no gaps per desk by UK calendar year, two issued at the same moment take consecutive numbers, and the sixth download in the window is refused with a UK time.
- **DP-51 — Aftercare journey** The arranger logs complaints and found items, returns an item only after recording the owner's details, closes and brings back a customer and brings in an old sheet, and its screen meets the screen rules.
- **DP-52 — Complaint and holding dates** Complaint reply dates count working days in England and Wales with the holiday provider's good, failing, last-good and none states, and holding dates and `Past holding date` follow the worked month ends at each read.
- **DP-53 — Close, bring back, erase** A closed customer comes back exactly as it was during the wait, then is erased with its MinIO objects gone, private pages ended, invoices marked `Erased customer` and ledger sums intact, and with MinIO down it stays `Erasing`.
- **DP-54 — Old customer sheet** Sheet rows match by folded email or telephone, a no-match row adds, a one-match row fills only empty fields, a two-match row goes to the review list and changes nothing, and a re-import creates nothing.
- **DP-55 — Cross-cutting journey** The route sweep holds on every signed-in route and private page, sign-in takes focus on its heading and lands on `/enquiries`, and returning after an ended session keeps the address and the draft.
- **DP-56 — One error shape and ladder** Every error uses the one published body with no stack trace, SQL, path or library name, one ladder decides every multi-fault request, and only published endpoints and pages exist.
- **DP-57 — Exact starting state** The first sign-in shows exactly the customers, operators, enquiries, bookings, runs, seat plan, ledger and invoice that Seed data prints.
- **DP-58 — Motion system** Every motion in the app runs on the browser's animation timeline at exactly one of the three published durations, nothing loops forever, and reduced motion gives the same end states at once.
- **DP-59 — Bands and counter-top look** Public and desk screens carry the card's full-bleed plum and cyan bands, square shapes, type and named seed components as Visual design describes, with the floor-to-ceiling cyan form as the working centrepiece.
- **DP-60 — Real services behind the screens** The source reads every credential from the environment and stores files, mail, PDFs and pushes through the real providers, with each stated rule decided on the server.

## Frontend

### Screens and layout (DP-03, DP-04, DP-06, DP-11, DP-13, DP-15, DP-19, DP-23, DP-27, DP-31, DP-36, DP-38, DP-40, DP-42, DP-46, DP-48, DP-51, DP-55, DP-59)

No screen scrolls sideways at 375x812, 768x1024 or 1280x800; only the frames named below do. "Below 768 px" is the phone layout, and from 768 px the wider layout applies. The Journey ticket has its own breakpoint at exactly 1024 px, as do the public headers.

Each screen has this level-one heading and page title:

| Address | Level-one heading | Page title |
|---|---|---|
| `/` | `Coaches and minibuses with a driver` | `Coach and minibus hire from Coventry \| Merrowfield Coach Hire` |
| `/occasions/school` | `School trips` | `School trips \| Merrowfield Coach Hire` |
| `/occasions/weddings` | `Weddings` | `Weddings \| Merrowfield Coach Hire` |
| `/occasions/company` | `Company travel` | `Company travel \| Merrowfield Coach Hire` |
| `/occasions/festivals` | `Festivals and sport` | `Festivals and sport \| Merrowfield Coach Hire` |
| `/fleet` | `Our fleet` | `Our fleet \| Merrowfield Coach Hire` |
| `/terms` | `Terms` | `Terms \| Merrowfield Coach Hire` |
| `/quote/route` | `Route` | `Route \| Get a free quote` |
| `/quote/when` | `When and who` | `When and who \| Get a free quote` |
| `/quote/details` | `Your details` | `Your details \| Get a free quote` |
| `/quote/thanks` | `Thank you` | `Thank you \| Get a free quote` |
| `/sign-in` | `Sign in` | `Sign in \| Wayticket` |
| `/sign-up` | `Start a desk` | `Start a desk \| Wayticket` |
| `/enquiries` | `Enquiries` | `Enquiries \| Wayticket` |
| `/enquiries/<id>` | `Enquiry <reference>` | `Enquiry <reference> \| Wayticket` |
| `/enquiries/<id>/trip` | `Trip plan <reference>` | `Trip plan <reference> \| Wayticket` |
| `/enquiries/<id>/bids` | `Operator bids <reference>` | `Operator bids <reference> \| Wayticket` |
| `/hires/<id>/quote` | `Quote <reference>` | `Quote <reference> \| Wayticket` |
| `/hires/<id>/hours` | `Drivers' hours <reference>` | `Drivers' hours <reference> \| Wayticket` |
| `/hires/<id>/seats` | `Seat plan <reference>` | `Seat plan <reference> \| Wayticket` |
| `/hires/<id>/changes` | `Changes <reference>` | `Changes <reference> \| Wayticket` |
| `/operators` | `Operators` | `Operators \| Wayticket` |
| `/payments` | `Payments` | `Payments \| Wayticket` |
| `/diary` | `Diary` | `Diary \| Wayticket` |
| `/documents` | `Documents` | `Documents \| Wayticket` |
| `/rates` | `Rate tables` | `Rate tables \| Wayticket` |
| `/customers` | `Customers` | `Customers \| Wayticket` |
| `/aftercare/complaints` | `Complaints` | `Complaints \| Wayticket` |
| `/aftercare/lost-property` | `Lost property` | `Lost property \| Wayticket` |
| `/q/<token>` answering 200, including a quote past its end | the `Your quote <reference>` string in the page's language | the same text |
| `/b/<token>` | `Price this hire` | `Price this hire` |
| `/b/<token>` once ended | `This bid page has closed` | `This bid page has closed` |
| `/r/<token>` | the `Run <number>` string in the page's language | the same text |
| `/q/<token>` answering 410 (replaced quote or erased customer), or `/r/<token>` answering 410 (cancelled booking or erased customer) | the `This page has ended.` string in the page's language (English for an erased customer) | the same text |
| any unknown address | `Page not found` | `Page not found` |

**Public site.** From 1024 px the top of every public page is the Masthead call block, then the Underlined main navigation. Below 1024 px the Phone top bar replaces both. The home page runs in butting bands: the Full-bleed coach drawing hero, the Client marks strip, the Plum promise band, four Occasion split panels whose drawing side swaps row by row, the Occasion cards in four columns from 1024 px and one column below that, a cyan band holding the Journey quote form's title and `link "Start your quote"` to `/quote/route`, and the Plum legal footer. Each occasion page has the rail `On this page` to the side of its sections from 1024 px and above them, as a list of links, below that. Below 1024 px `link "Get a free quote"` sits directly under the page's level-one heading; from 1024 px it is the one in the Masthead call block or, once showing, the slim bar. It holds the sections `What we arrange`, `What to tell us`, `How payment works` and `Questions` and three accordion questions: `How early should we ask?` (fragment `#how-early`), `Who checks the driver?` (fragment `#who-checks`) and `What happens if plans change?` (fragment `#plans-change`). Fleet shows the seven sizes, each with a generated side view, its seats and its bag units. Terms is plain text in the same bands.

**Quote form.** The form fills a floor-to-ceiling cyan field. From 1024 px the Journey ticket sits beside the form; at 1023 px and below it is a bar fixed to the bottom. `Route` holds `Occasion`, `Journey type`, `From`, `To`, the stops and `Stop details`. `When and who` holds `Today`, `Tomorrow`, the out and return dates and times, any `Which <time>?`, `People`, the three bag fields and `Wheelchair users`. `Your details` holds `Name`, `Email`, `Telephone` and `Language for your quote`. `Back` shows on the last two steps, `Next` on the first two and `Send request` on the last. Ticket lines, in order, are `Occasion`, `Journey`, `From`, `To`, `Stops` (only with a stop added), `Details` (only for `Several stops`), `Out`, `Return` (only for `Return` and `Same day return`), `People`, `Bags`, `Wheelchair users`, `Name`, `Email`, `Telephone`.

**Desk screens.** Every desk screen opens with a plum band holding the level-one heading and, from 768 px, the `Desk` navigation; below 768 px the navigation is in a `Menu` sheet from a top bar. The line for a failed refresh (`data-part="refresh-line"`) sits directly under the plum band, and on the private pages directly under the level-one heading. Below 768 px each screen's main action sits in a bar fixed to the bottom, and wide tables scroll inside their own named frame, which takes keyboard focus.

| Screen | Shows | Main action |
|---|---|---|
| Enquiries | filters, search, list of 25, paging | `Add enquiry` |
| Enquiry | the ticket's lines as sent, `Not checked` marks, state bar, duplicates, links to trip, bids, quote, hours, seats, changes | `Plan this trip` |
| Trip plan | ordered stops, legs in miles and minutes, suggested and typed plan | `Save plan` |
| Operator bids | table of bids in the frame named `Bids`, each operator's standing | `Ask operators` |
| Quote | per-vehicle rows, totals, sending state, rates in force | `Send quote` |
| Drivers' hours | run chooser held in the address as `?run=<id>`, ribbon in the frame named `Duty ribbon`, the `Duty blocks` table, driver and told line | `Confirm run` |
| Seat plan | passenger list, one seat grid per vehicle, adults line, per-head split | `Add passengers` |
| Changes | old and new side by side, per-vehicle lines, cancellation | `Change booking` |
| Operators | table in the frame named `Operators list` with papers and DBS date | `Refresh directory` |
| Payments | `Money held`, bookings and per-vehicle money in the frame named `Bookings` | `Bring in statement` |
| Diary | week grid from 768 px; below 768 px an agenda with sticky day headings | `Later week` |
| Documents | list with its three-step strip, next numbers | `Make document` |
| Rate tables | tables by date | `Add rate table` |
| Customers | list, closed customers under the `Closed` filter, review list | `Add customer` |
| Complaints | list with received and reply-due dates | `Log complaint` |
| Lost property | list with found and held-to dates | `Log found item` |

**Private pages.** The customer page is built for 375x812 touch first: heading, stepper, route, dates, party and vehicles as counts, totals, valid-until line, and a bottom bar holding `Accept` or `I've sent the deposit`. From 768 px the same content sits in one centred column on the same bands. The bid page lists route, dates, vehicles and party size, then one price field per vehicle. The run sheet lists stops in order with big presses, at 375x812 and in a cradle at 812x375, where stops scroll under a fixed count of waiting presses. A private page open when its re-read answers 410 changes in place to its ended heading and title, with focus on that heading. A quote not yet accepted and past its end answers 200 and is not such a page: it keeps the `Your quote <reference>` heading and title, shows the `This quote ended on <date>. Ask us for a new one.` line and still offers `Accept`, which the server refuses as Business rules publishes. A quote accepted before its end and read after it also answers 200 and keeps that heading and title, shows no ended line and offers `I've sent the deposit` exactly as it did before the end. A cancelled booking's page also answers 200 and keeps that heading and title, shows the `This booking was cancelled.` line and no ended line, and offers neither `Accept` nor `I've sent the deposit`, whether or not its quote was accepted or has passed its end.

Long names and addresses wrap and never widen a page.

### Public screens and controls (DP-03, DP-06, DP-09, DP-11, DP-13, DP-15, DP-19, DP-23, DP-27, DP-31, DP-36, DP-38, DP-40, DP-42, DP-46, DP-48, DP-51, DP-55)

Only these are public; everything else is free. Published `data-part` names are `ticket-flight` (the travelling value), `ticket-line`, `page-wipe`, `stepper`, `slim-bar`, `block`, `ruler-mark`, `breach`, `seat`, `refresh-line`.

| Where | Role and name | Visible copy or note |
|---|---|---|
| Every page | `region "Announcements"` | polite live region, in the document from first paint; the name stays English in all languages |
| Every form | `group "Problems"` | heading `Problems`, one link per refused field |
| Masthead call block | `link "Call 01632 960140"`, `link "Get a free quote"` | |
| Public | `navigation "Main"` | links `Home`, `School trips`, `Weddings`, `Company travel`, `Festivals and sport`, `Fleet`, `Terms`; the current one has `aria-current="page"` |
| Public | `button "Search"`, `dialog "Search"`, `searchbox "Search the site"`, `list "Search results"` | |
| Phone top bar | `link "Call 01632 960140"`, `button "Menu"`, `dialog "Menu"`, `button "Close"` | |
| Client marks strip | `button "Earlier"`, `button "Later"` | |
| Public | `link "Message us"`, `link "Back to top"` | |
| Occasion page | `navigation "On this page"`, one `button` per question with its question as name | current section has `aria-current="true"` |
| Quote form | `radiogroup "Occasion"`: `School`, `Weddings`, `Company`, `Festivals and sport` | |
| Quote form | `radiogroup "Journey type"`: `One way`, `Return`, `Same day return`, `Several stops` | Journey type bar |
| Quote form | `combobox "From"`, `combobox "To"`, `combobox "Stop <n>"`, `button "Add a stop"`, `button "Remove stop"`, `textbox "Stop details"` | |
| Quote form | `button "Today"`, `button "Tomorrow"`, `textbox "Out date"`, `button "Choose out date"`, `combobox "Out hour"`, `combobox "Out minutes"`, and `Return date`, `Choose return date`, `Return hour`, `Return minutes` | |
| Quote form | `dialog "Choose a date"` with `grid`, `button "Previous month"`, `button "Next month"` | |
| Quote form | `radiogroup "Which <time>?"`: `First <time> (BST)`, `Second <time> (GMT)` | only in the repeated hour |
| Quote form | `spinbutton "People"`, `"Large (23 kg)"`, `"Medium (15 kg)"`, `"Hand (7 kg)"`, `"Wheelchair users"` | |
| Quote form | `textbox "Name"`, `"Email"`, `"Telephone"`, `combobox "Language for your quote"` (`English`, `Polski`, `اردو`) | hidden trap field `website` |
| Quote form | `button "Back"`, `button "Next"`, `button "Send request"` | |
| Journey ticket | `complementary "Journey ticket"`, below 1024 px `button "Journey ticket, <n> answered"` and `dialog "Journey ticket"` | unanswered lines read `Not yet given` |
| Sign-in, sign-up | `textbox "Email"`, a masked input of type password found by its label `Password` (it has no textbox role), `button "Sign in"`; on sign-up also `textbox "Desk name"` and `button "Start desk"` | |
| Desk | `navigation "Desk"`: `Enquiries`, `Operators`, `Payments`, `Diary`, `Documents`, `Rate tables`, `Customers`, `Complaints`, `Lost property`; `button "Change password"`, `button "Sign out"`, below 768 px `button "Menu"` | |
| Desk | `dialog "Change password"`: masked inputs of type password found by their labels `Current password` and `New password`, `button "Save password"` | |
| Desk | `link "Sign in again"` | only with the ended-session line |
| Enquiries | `radiogroup "Filter by state"`: `All`, `New`, `Priced`, `Quoted`, `Won`, `Lost`; `combobox "Occasion"`; `searchbox "Search enquiries"`; `link "Next page"`, `link "Previous page"`; `button "Add enquiry"`, `dialog "Add enquiry"` with the quote form's `radiogroup "Occasion"`, `radiogroup "Journey type"`, `combobox "From"`, `combobox "To"`, `button "Add a stop"`, `combobox "Stop <n>"`, `button "Remove stop"`, `textbox "Stop details"`, `textbox "Out date"`, `combobox "Out hour"`, `combobox "Out minutes"`, `textbox "Return date"`, `combobox "Return hour"`, `combobox "Return minutes"`, `radiogroup "Which <time>?"`, `spinbutton "People"`, `"Large (23 kg)"`, `"Medium (15 kg)"`, `"Hand (7 kg)"`, `"Wheelchair users"`, `textbox "Name"`, `"Email"`, `"Telephone"`, `combobox "Language for your quote"`, shown by the same journey-type and repeated-hour rules, and `button "Save enquiry"` | each row's link is named by its reference |
| Enquiry | `radiogroup "State"`, `button "Merge"`, `dialog "Merge enquiries"`, `button "Merge enquiries"`, `link "Plan this trip"` | |
| Trip plan | `button "Move up"`, `button "Move down"`, `textbox "Plan"`, `button "Save plan"`, `button "Try route again"` | |
| Operators | `button "Refresh directory"`, `button "Upload paper"`, `dialog "Upload paper"` with `combobox "Paper"`, `textbox "Ends on"`, file input `"File"`, `button "Store paper"`; `button "Set DBS date"`, `dialog "Set DBS date"` with `textbox "Checked on"`, `button "Save date"` | |
| Operator bids | `region "Bids"`, `button "Ask operators"`, `dialog "Ask operators"`, one `checkbox` per operator, `button "Send asks"`, `button "Award"`, `link "Sort by price"` | |
| Bid page | `textbox "Price for vehicle <n>"`, `button "Send price"`, `button "Change price"`, `button "Withdraw bid"`, `dialog "Withdraw bid"`, `button "Confirm withdrawal"` | |
| Quote | `spinbutton "Margin for vehicle <n>"`, `group "Totals"`, `button "Send quote"`, `dialog "Send quote"`, `button "Send now"`, `button "Reload"` | |
| Rate tables | `button "Add rate table"`, `dialog "Add rate table"` with `textbox "Takes effect on"`, `textbox "Default margin"`, `textbox "Waiting rate per hour"`, `textbox "Second driver charge"`, `textbox "Minibus deposit"`, `textbox "Higher minibus deposit"`, `textbox "Coach deposit"`, `textbox "Higher coach deposit"`, each value starting at the table in force's value, and `button "Save table"` | |
| Customer page | `combobox "Language"`, `list "Progress"` (`data-part="stepper"`, current step `aria-current="step"`), `button` strings from the table, `dialog` with `Accept this quote` string | |
| Payments | `button "Bring in statement"`, `dialog "Bring in statement"` (a sheet), file input `"Statement file"`, `button "Read file"`, `button "Bring in"`, `link "Download payments"` | |
| Diary | `grid "Week"`, `button "Earlier week"`, `button "Later week"`, `button "Assign driver"`, `dialog "Assign driver"` with `textbox "Driver name"`, `textbox "Driver telephone"`, `button "Tell driver"`; `button "Tell driver again"` | |
| Drivers' hours | `region "Duty ribbon"`, `slider "Break <n>"`, `table "Duty blocks"`, `button "Confirm run"`, `button "Add second driver"`, `dialog "Add second driver"` showing the charge, with `button "Add charge"` to confirm and `button "Close"`; `button "Accept charges"` | |
| Seat plan | `button "Add passengers"`, `dialog "Add passengers"` with file input `"Passenger file"`, `textbox "Name"`, `textbox "Group"`, `textbox "Needs"`, `button "Add name"`, `button "Bring in list"`; `grid "Seats <n>-seat vehicle"`, `link "Download passengers"`, `button "Print plan"` | each seat is `gridcell "Seat 12A: <name>"`, or `gridcell "Seat 1D: empty"` with nobody in it |
| Run sheet | `group` strings `Stop <i> of <n>`, buttons by the table's strings, `button` and `dialog` by the `Run details` string, `combobox` by the `Language` string (`English`, `Polski`) | |
| Changes | `button "Change booking"`, `dialog "Change booking"` with `textbox "Departure date"`, `combobox "Departure hour"`, `combobox "Departure minutes"`, `combobox "Stop <n>"`, `textbox "Bought price for vehicle <n>"`, `spinbutton "Margin for vehicle <n>"`, each starting at the booking's current value, `group "Old"` and `group "New"` side by side, and `button "Save change"`, `button "Cancel booking"`, `dialog "Cancel booking"` with `textbox "Notice date"`, `combobox "Notice hour"`, `combobox "Notice minutes"`, `radiogroup "Notice"` (`From the customer`, `From us`) and its own `button "Cancel booking"` | |
| Documents | `button "Make document"`, `dialog "Make document"` with `combobox "Hire"` (every hire past `enquiry`, each option reading its reference), `combobox "Kind"`, `button "Make"`; `list "Steps"` per document; `link "Download"`; `button "History"`, `dialog "History"` | |
| Complaints | `button "Log complaint"`, `dialog "Log complaint"` with `combobox "Customer"` (every active customer, each option reading the name, followed by the email only where two share a name), `textbox "Summary"`, `textbox "Received date"`, `combobox "Received hour"`, `combobox "Received minutes"`, `button "Save complaint"` | |
| Lost property | `button "Log found item"`, `dialog "Log found item"` with `textbox "Item"`, `textbox "Found on"`, `button "Save item"`; `button "Return item"`, `dialog "Return item"` with `textbox "Owner's details"`, `button "Record return"` | |
| Customers | `radiogroup "Filter customers"`: `Active`, `Closed`; `button "Add customer"`, `dialog "Add customer"` with `textbox "Name"`, `textbox "Email"`, `textbox "Telephone"`, `combobox "Language"` (`English`, `Polski`, `اردو`), `button "Save customer"`; on each row `button "Rename"`, which opens `dialog "Rename customer"` with `textbox "Name"` and `button "Save name"`; on each row `button "Remove customer"`, which opens `dialog "Remove customer"` with `button "Confirm removal"`; on each active row `button "Close customer"`, which acts at once; on each closed row `button "Bring back"`, which acts at once; `button "Bring in old sheet"`, `dialog "Bring in old sheet"`, file input `"Customer sheet"`, `button "Read sheet"`, `heading "Review list"` | |

**Strings on the customer page and run sheet.** `Working…` stays as printed in every language. `<date>` follows the page's date form.

| English | Polish | Urdu |
|---|---|---|
| `Your quote <reference>` | `Twoja wycena <reference>` | `آپ کا کوٹیشن <reference>` |
| `Quote sent` | `Wycena wysłana` | `کوٹیشن بھیج دیا گیا` |
| `Accepted` | `Zaakceptowana` | `قبول کر لیا گیا` |
| `Deposit` | `Zaliczka` | `پیشگی رقم` |
| `Balance` | `Pozostała kwota` | `بقایا رقم` |
| `Travel` | `Podróż` | `سفر` |
| `Route` | `Trasa` | `راستہ` |
| `Out` | `Wyjazd` | `روانگی` |
| `Return` | `Powrót` | `واپسی` |
| `Party` | `Grupa` | `مسافر` |
| `Vehicles` | `Pojazdy` | `گاڑیاں` |
| `Total` | `Razem` | `کل رقم` |
| `Deposit due` | `Zaliczka do zapłaty` | `واجب الادا پیشگی رقم` |
| `Valid until <date>` | `Ważna do <date>` | `<date> تک کارآمد` |
| `Pay by bank transfer quoting <reference>` | `Zapłać przelewem, podając numer <reference>` | `<reference> کا حوالہ دے کر بینک ٹرانسفر سے ادائیگی کریں` |
| `Accept` | `Akceptuję` | `قبول کریں` |
| `Accept this quote` | `Akceptacja wyceny` | `یہ کوٹیشن قبول کریں` |
| `Your full name` | `Imię i nazwisko` | `آپ کا پورا نام` |
| `Confirm acceptance` | `Potwierdzam` | `قبولیت کی تصدیق کریں` |
| `Close` | `Zamknij` | `بند کریں` |
| `That name does not match this quote.` | `To nazwisko nie zgadza się z tą wyceną.` | `یہ نام اس کوٹیشن سے مطابقت نہیں رکھتا۔` |
| `Quote accepted.` | `Wycena zaakceptowana.` | `کوٹیشن قبول کر لیا گیا۔` |
| `I've sent the deposit` | `Zaliczka wysłana` | `میں نے پیشگی رقم بھیج دی ہے` |
| `We're checking your payment` | `Sprawdzamy Twoją płatność` | `ہم آپ کی ادائیگی کی جانچ کر رہے ہیں` |
| `This quote ended on <date>. Ask us for a new one.` | `Ta wycena wygasła <date>. Poproś nas o nową.` | `یہ کوٹیشن <date> کو ختم ہو گیا۔ ہم سے نیا کوٹیشن مانگیں۔` |
| `This booking was cancelled.` | `Ta rezerwacja została anulowana.` | `یہ بکنگ منسوخ کر دی گئی۔` |
| `Download quote` | `Pobierz wycenę` | `کوٹیشن ڈاؤن لوڈ کریں` |
| `Language` | `Język` | `زبان` |
| `Couldn't refresh. Trying again.` | `Nie udało się odświeżyć. Próbujemy ponownie.` | `تازہ نہیں ہو سکا۔ دوبارہ کوشش جاری ہے۔` |
| `This page has ended.` | `Ta strona wygasła.` | `یہ صفحہ ختم ہو چکا ہے۔` |
| `The PDF service is unavailable right now. Nothing was saved.` | `Usługa PDF jest teraz niedostępna. Niczego nie zapisano.` | `پی ڈی ایف سروس اس وقت دستیاب نہیں۔ کچھ محفوظ نہیں ہوا۔` |
| `The file store is unavailable right now. Nothing was saved.` | `Magazyn plików jest teraz niedostępny. Niczego nie zapisano.` | `فائل اسٹور اس وقت دستیاب نہیں۔ کچھ محفوظ نہیں ہوا۔` |

Run sheet, English and Polish:

| English | Polish |
|---|---|
| `Run <number>` | `Kurs <number>` |
| `Stop <i> of <n>` | `Przystanek <i> z <n>` |
| `Arrived` | `Na miejscu` |
| `Boarded` | `Wsiedli` |
| `Left` | `Odjazd` |
| `Comfort stop` | `Postój` |
| `Back on the road` | `W trasie` |
| `Run details` | `Szczegóły kursu` |
| `Close` | `Zamknij` |
| `<n> waiting to send` | `Do wysłania: <n>` |
| `All sent` | `Wszystko wysłane` |
| `Waiting charge <amount>` | `Opłata za oczekiwanie <amount>` |
| `Flight times unavailable. Waiting counts from the booked pick-up.` | `Brak danych o locie. Oczekiwanie liczone od zamówionej godziny odbioru.` |
| `Language` | `Język` |
| `Couldn't refresh. Trying again.` | `Nie udało się odświeżyć. Próbujemy ponownie.` |
| `This page has ended.` | `Ta strona wygasła.` |

### Interactions (DP-03, DP-06, DP-09, DP-11, DP-13, DP-19, DP-23, DP-27, DP-31, DP-36, DP-38, DP-40, DP-42, DP-46, DP-48, DP-51, DP-55)

**Public site.**
- From 1024 px the Masthead call block and Underlined main navigation scroll away with the page. Once the page has scrolled 200 px or more a slim bar (`data-part="slim-bar"`) holding the same navigation and `Get a free quote` slides down from the top and stays, already in place on arrival at a scrolled position.
- Below 1024 px the Phone top bar stays fixed to the top and gains its shadow once the page has scrolled 25 px or more.
- `Search` opens a full-screen overlay and focus moves into the search field. Enter runs the server search and lists results in place. Escape closes it with focus back on the button.
- Below 1024 px `Menu` opens a panel from the right edge, 480 px wide from 768 px and full width below that.
- Sections rise and fade in once, the first time they scroll into view. A section already passed on arrival shows at once with no animation.
- The client marks move one step only on `Earlier` and `Later`, never by themselves. At either end the button keeps focus and carries `aria-disabled="true"`.
- Occasion cards lift on pointer hover and on keyboard focus, and not on touch.
- `Message us` sits at the bottom left. Its ring plays exactly three times after load and stops, and never plays under reduced motion.
- `Back to top` appears at the bottom right after 600 px of scroll. It and `Message us` never overlap each other, and neither ever covers the control that has focus.
- In the rail `On this page` the current section follows the scroll position, and the last section is current once the page is at its end, whatever its height. A press jumps there with no animated scrolling and holds the pressed section until the next scroll.
- A question's address fragment opens that question on arrival, with the question under the sticky header and not behind it.
- `Get a free quote` from an occasion page opens `/quote?occasion=school` (or that page's occasion: `school`, `weddings`, `company`, `festivals`), which goes to `/quote/route` with that occasion chosen.

**Quote request.**
- There are three steps at one address each, so Back and Forward walk the steps and a reload stays on the step with what was typed. The draft stays through a reload and a refused send, and is cleared only after the server has answered with a reference.
- The count and the flights are per ticket line, not per control. A line counts as answered when its value below is complete, and each answer that completes or changes a line makes one flight of the whole line's value, from the control just left or chosen. A text field left empty is not answered. Clearing a line's required answer returns it to `Not yet given` with no flight. `<n>` counts answered lines among those showing, so a hidden `Return` line does not count until it shows again.
- Line values: `Occasion` and `Journey` read the chosen label. `From`, `To` read the address as shown, and `Stops` the stops in order joined by `; `. `Details`, `Name`, `Email` and `Telephone` read as typed. `Out` and `Return` read `Mon 29 Mar 2027, 14:05` once the date, hour and minutes are given, with ` (BST)` or ` (GMT)` added once a repeated hour's answer is given, for example `Sun 31 Oct 2027, 01:30 (GMT)`; under `Same day return` the date is already given. `People` reads `47 people` or `1 person`. `Bags` reads `2 large, 0 medium, 10 hand` as soon as any one of its three fields has been left. `Wheelchair users` reads the number, for example `0`.
- `People` starts empty. The three bag fields and `Wheelchair users` start at 0 and count as answered once left, even at 0; never touched, their lines read `Not yet given` and the request sends 0.
- The `Journey` line starts answered as `One way`, so a fresh form counts 1, and a form opened with an occasion chosen counts 2. Neither makes a flight on arrival.
- From 1024 px an answered value lifts from its field and travels as one element (`data-part="ticket-flight"`) to its `ticket-line`, replacing `Not yet given`. Below 1024 px with the sheet closed it travels to the bar instead, and the bar's count rises. With the sheet open it travels to its line in the sheet.
- A second change to the same field while its value is still travelling carries on from where it is, showing the new value, with no jump.
- Pressing `Journey ticket, <n> answered` opens the ticket as a sheet. Below 1024 px the bar holds both that button and the step's main action.
- `Next` checks only its own step. Moving forward slides the step left, `Back` slides it right, and focus goes to the step's level-one heading.
- Opening a later step's address with an earlier required answer missing goes to the first step with one missing, replacing the history entry.
- Changing journey type never loses anything typed: a return date hidden by `One way` is back as typed when `Return` is chosen again. `Same day return` locks the return date to the out date, which it follows. `Several stops` shows the required `Stop details` box.
- `Add a stop` allows up to 5 stops and focus moves into the new one. `Remove stop` moves focus to the next stop's `Remove stop`, or to `Add a stop` if none follows.
- `Today` and `Tomorrow` set the out date by the server's UK date. The chosen one is plum and underlined, with `aria-pressed`.
- Dates are typed as DD/MM/YYYY or picked from the calendar, whose keyboard follows the WCAG date grid pattern: arrows move by day and week, Page Up and Page Down by month, Home and End to the week's ends, Enter chooses, Escape closes the calendar only. It is never cut off.
- On the quote form and in `Add enquiry` hours are 00 to 23 and minutes are 00, 15, 30 and 45. Every other hour list on the desk is 00 to 23 and every other minute list 00 to 59.

**Address lookup.**
- Three typed characters ask the app 300 ms after the last key, and choosing a suggestion asks for the full address.
- The reply to an older input never replaces a newer one. The same text asked again within the page uses what it already has with no second call, so typing A, B, A makes two calls.
- The list follows the ARIA combobox pattern with `aria-activedescendant`. Escape closes the list and keeps the text. Inside a dialog Escape closes only the list. The list is never cut off inside a frame or dialog.

**Enquiries.**
- Filters, search and the page position are all held in the address, so a reload, Back or a copied address shows the same list. Search text is sent 300 ms after the last key and the reply to an older search never shows.
- The `State` bar is a five-part segmented control. A change shows at once with `Saving…` and goes back with its refusal copy if the server refuses, with focus still on the control. SR11's button text does not apply to it.
- Going into an enquiry and back returns to the same filters and scroll position with focus on the row's link, and each visit makes one history entry.

**Trip plan.** Stops reorder by drag, by touch and with `Move up` and `Move down` on each row. These are `aria-disabled` at the ends and focus stays on the pressed button. A drag starts from anywhere on the row outside its buttons, and by touch as soon as the finger moves, so a swipe that starts on a stop row, diary card, `Break` block or occupied seat drags and one that starts anywhere else, including any other duty block, scrolls. Rows slide to their new places and an interrupted move carries on from where it is. A plan is typed as sizes, for example `49, 12`.

**Operator bids.** Sorting is held in the address (`?sort=priceLowest` by default, or `?sort=priceHighest`). `Award` acts at once on its row.

**Quote building.** Totals change in place on every input with no submit button and no reload, each change is announced once, and the reply to an older input never replaces a newer one.

**Customer page.** `Accept` opens the dialog in which the customer types their full name. A refused name leaves the dialog open as typed with focus on the message. `?lang=pl` and `?lang=ur` hold a language switch in the address. In Urdu the page runs right to left and its stepper runs from the right.

**Diary.**
- One roving Tab stop covers the grid. Arrow keys move through cells, Home and End go to the week's ends, and a press of `Earlier week` or `Later week` keeps focus on that button.
- Alt with Left or Right Arrow moves a hire by a day and keeps focus on that hire afterwards, through the following refresh. A drag does the same by pointer and by touch from anywhere on the card outside its buttons, by touch as soon as the finger moves, and Escape during a drag puts the card back and changes nothing.
- A refused move returns the card. Sticky agenda headings never cover the focused control.

**Duty ribbon.** A `Break` block moves by pointer, by touch or by Left and Right Arrow in 15-minute steps, with Shift in 5-minute steps. A drag starts from anywhere on the block, and by touch as soon as the finger moves. Moving it later takes that many minutes from the `Drive` after it and gives them to the `Drive` before it; moving it earlier does the reverse. Everything else reflows at once in one movement, and an interrupted move carries on from where it is.

**Seat grid.** One Tab stop covers the grid. Arrows move by the grid and cross the aisle, and Space picks up or drops, so the same keys swap two people with focus kept on the seat dropped on. By pointer or touch a person is dragged to a seat, by touch as soon as the finger moves, and Escape during a drag puts the person back. Two swapped people cross.

**Run sheet.** The page opens in English. `Language` switches it, and Polish is held in the address as `?lang=pl`, with `lang` on the document decided by the server before any script runs. The page re-reads under SR1. With no signal a re-read is a failed refresh, so the failed-refresh line shows beside the waiting count until the next good refresh, and a refresh never removes a press still waiting. A press shows at once on the page, so these presses never read `Working…` and SR11 does not apply to them. With no signal it is stored on the phone, the waiting count shows, and a reload with no signal keeps the page and the queue, because the page is served by a service worker (the app runs on 127.0.0.1, where service workers run). Back in signal the presses go in order.

**Desk moves.** Moving between desk screens plays one wipe (`data-part="page-wipe"`). Focus lands on the new level-one heading only once the new screen shows. Sign-in pages take focus on their level-one heading on load. A session ended by the server leaves any open dialog as typed, and the ended-session line shows with `link "Sign in again"`, inside the open dialog or sheet if there is one and otherwise directly under the plum band. The link opens the sign-in page with the return address that Sessions in Business rules publishes. Signing in again returns to the same address with the draft kept: every field typed on that screen, and the dialog or sheet it was typed in open again as typed.

**Typed dates.** Every date typed into any screen, including `Out date`, `Return date`, `Ends on`, `Checked on`, `Takes effect on`, `Departure date`, `Notice date`, `Received date` and `Found on`, is typed as DD/MM/YYYY. Anything else, or a date that does not exist, is refused with `Enter a date as DD/MM/YYYY.`

#### Screen rules

- **SR1** Every signed-in screen, the customer page, the bid page and the run sheet re-read their data from the server every 5 seconds while open. A refresh changes only what changed, in place: focus stays on the same control, an open dialog, sheet, menu or popover stays open with what was typed and does not play its opening again, a refused dialog keeps its message, an open accordion stays open, an expanded row stays expanded and the scroll position stays.
- **SR2** Closing a dialog, sheet or popover (Escape, its Close button or a tap outside a sheet) returns focus to the control that opened it at once and leaves the page behind usable at once while the closing animation still runs. Pressing that control again during the closing animation opens it again, which no leftover close timer may undo.
- **SR3** Under reduced motion every dialog, sheet, menu, popover and accordion opens and closes at once (a closed one is gone from the screen and the accessibility tree within 100 ms), every loop stops and every sequence shows its end state at once with the same function.
- **SR4** At 375x812 every control offers a touch area of at least 44 by 44 CSS pixels: buttons, links (including links in list rows, table cells, navigation rows and back links), form fields, file inputs, menu items, accordion headers and the label of each radio and checkbox. Links inside a sentence of running text are the only exception.
- **SR5** An automated WCAG 2.2 AA check (axe-core, tags wcag2a, wcag2aa, wcag21aa, wcag22aa) reports no violation on every screen at 375x812 and 1280x800 with its dialog or sheet open and closed. A wide table at 375 scrolls sideways inside its own frame, and that frame takes keyboard focus and has an accessible name.
- **SR6** At 375x812 the main action of each desk screen, the customer page, the bid page (`Send price`, or `Change price` once a bid is in) and each quote step (`Next`, or `Send request` on the last) sits in a bar fixed to the bottom, and a screen with no action left shows no bar. The public pages, `/quote/thanks`, sign-in, sign-up, the run sheet and pages answering 410 or 404 have no main action and no such bar. On every screen a control that receives focus by Tab or tap is scrolled fully into view between the top bar and any bottom bar.
- **SR7** All motion runs as style-sheet transitions, style-sheet animations or element animations with exactly the durations 160, 320 and 640 ms, never frames timed by script, never any other duration (no library or browser default), and nothing loops forever.
- **SR8** Every Tab stop shows a visible focus ring. Opening a dialog or sheet moves focus inside it to its first field (otherwise its first control) on every opening, not only the first. Every dialog and sheet keeps Tab and Shift+Tab inside it (a native dialog element alone does not), closes on Escape, even when it holds only links, and returns focus to its opener.
- **SR9** A closed accordion panel, menu, sheet or popover is hidden and inert: its controls leave the Tab order the moment it starts closing and it leaves the accessibility tree when its closing animation ends. Collapsing to zero height or moving off-screen is not closing.
- **SR10** Pointer and touch behaviour follow each event's pointer type, never hover or pointer media queries.
- **SR11** While a button's request is open its visible text and its accessible name both read `Working…`. It carries `aria-disabled="true"` and never the disabled attribute (a disabled button drops keyboard focus), a further press does nothing, focus stays on it, and it reads its own name again afterwards.
- **SR12** When an action closes a dialog or removes the control that opened it, focus moves to the screen's level-one heading if that control is gone, otherwise back to that control, and stays there through the following refresh and any list reload.
- **SR13** A menu, popover, date picker or combobox list opened inside a scrolling frame or at the end of a list is never cut off: every one of its items is fully on screen and can be pressed where it shows, at 375 and 1280.
- **SR14** Every screen prints the same characters whatever the browser's language, time zone and clock: opened with German as the language, Pacific/Auckland as the zone and a device clock three days ahead, the same address shows the same visible text, because every date, number, count and time-dependent state is formatted in the published form and decided by the server.
- **SR15** At 320x568 no page scrolls sideways (only the published frames do) and a name of up to 80 characters with no spaces wraps wherever it prints.
- **SR16** No text is ever cut off, with an ellipsis or by clipping, on any screen at 375x812 or 1280x800, also with text spacing overridden (line height 1.5, letter spacing 0.12em, word spacing 0.16em, paragraph spacing 2em).
- **SR17** At 812x375 every screen works: an open dialog or sheet scrolls inside itself so that each of its controls can be reached, and no bar covers the focused control.
- **SR18** With forced colours on, every Tab stop still shows a ring and each selected, current, checked or pressed state still shows by a mark that is not a background colour (a border, outline, glyph or underline).
- **SR19** The Announcements region is on the page from first paint, before any action, and one message made twice in a row is announced twice (the region's content changes each time).
- **SR20** When one refresh fails (network or a 5xx, whatever address the screen refreshes from) everything on the screen stays where it is, focus stays, no dialog opens, the single line for a failed refresh shows in its published place, and the next good refresh clears it.
- **SR21** Escape closes only the innermost open thing: a combobox list, calendar, menu or tip inside a dialog closes first, and the dialog stays open with focus inside it.
- **SR22** What a screen shows on arrival is right with no scroll or pointer event: after a reload or Back at a scrolled position sticky and scroll-linked parts are already in their scrolled state.
- **SR23** Turning reduced motion on or off while a page is open applies from the next animation, with no reload.
- **SR24** Every sheet rises from the bottom edge at 375x812 and slides from the right edge from 768 px wide (from the left edge in Urdu), and every dialog grows from its centre at 1280. The public site's `Menu` panel is exempt: it opens from the right edge at every width where it exists, 375 included. The desk's `Menu` is a sheet and follows this rule.
- **SR25** The box of every picture and drawing is reserved before its file arrives, so no text or control moves when a held image finally loads.
- **SR26** Printing a customer page, a seat plan, a run sheet or a quote shows only its content: no header, rail, bottom bar, open sheet or live region prints, and nothing runs past the width of an A4 page.
- **SR27** A dialog or sheet reopened or closed while it is still moving carries on from where it is, with no jump to its start or end.
- **SR28** The Announcements region stays in the accessibility tree while a dialog or sheet is open, so whatever makes the page behind inert or hidden leaves that region out.
- **SR29** Back from any detail screen returns to the list with the same filters and scroll position, with focus on the row that was opened, and one visit makes one history entry.
- **SR30** Every state that depends on time is decided at the moment it is read or pressed, never by a background sweep, so at the instant a quote, bid window or holding date ends every read and every press already agrees.
- **SR31** Moving between signed-in desk screens plays one 320 ms wipe during which the old screen is inert and takes no press, and focus lands on the new level-one heading only once the new screen shows, at once under reduced motion.

**What "its screen meets the screen rules" means.** For each workflow named below, these all hold on its own screen, and each is required:

1. Its main write endpoint answers the earlier error of the one ladder for a request that breaks two published rules at once (for example an oversized body with no session gets the size refusal as JSON), every instant in its API responses is whole-second UTC, and the session cookie it signs in with has the published attributes.
2. SR1 to SR31 hold with its named dialog, sheet, menu, popover or accordion.
3. Its keyboard-only journey reaches the published focus targets. Every write action shows SR8 focus on opening, SR11 `Working…` with focus kept, SR12 focus afterwards and its Announcements copy, and every refused form shows its Problems links and `aria-invalid`.
4. Its 375x812 touch journey does the same, with closed sheets hidden and inert and no bar covering the focused control.
5. Its rare states show their copy verbatim with the name and UK time filled in.
6. Its own precision rules hold.
7. Its own motion holds on the path a real action takes, including the reply path, the refused path and the interrupted path.

| Workflow | Main screen | Main write endpoint | Its open thing |
|---|---|---|---|
| public site | `/occasions/school` | `POST /api/public/enquiries` | `Menu` panel, `Search` overlay, question accordion |
| quote request | `/quote/route` | `POST /api/public/enquiries` | `Journey ticket` sheet, `Choose a date` calendar |
| address lookup | `/enquiries` | `POST /api/enquiries` | `Add enquiry` dialog with its combobox list |
| enquiries | `/enquiries` | `PATCH /api/enquiries/<id>` | `Add enquiry` and `Merge enquiries` dialogs |
| trip plan | `/enquiries/<id>/trip` | `PUT /api/enquiries/<id>/trip/plan` | `Menu` sheet below 768 px, `Ask operators` from the bids link |
| operators | `/operators` | `POST /api/operators/<id>/papers` | `Upload paper` dialog |
| operator bids | `/enquiries/<id>/bids` | `POST /api/enquiries/<id>/award` | `Ask operators` dialog |
| quote building | `/hires/<id>/quote` | `PUT /api/hires/<id>/quote` | `Send quote` dialog |
| customer page | `/q/<token>` | `POST /api/q/<token>/accept` | `Accept this quote` dialog |
| payments | `/payments` | `POST /api/payments/statements/preview` | `Bring in statement` sheet |
| diary | `/diary` | `PUT /api/runs/<id>/departure` | `Assign driver` dialog |
| drivers' hours | `/hires/<id>/hours` | `PUT /api/runs/<id>/blocks` | `Add second driver` dialog |
| passenger list and seat plan | `/hires/<id>/seats` | `POST /api/hires/<id>/passengers/import` | `Add passengers` dialog |
| driver run sheet | `/r/<token>` | `POST /api/r/<token>/presses` | `Run details` sheet |
| changes and cancellations | `/hires/<id>/changes` | `POST /api/hires/<id>/cancel` | `Cancel booking` dialog |
| documents | `/documents` | `POST /api/hires/<id>/documents` | `Make document` dialog, `History` sheet |
| aftercare | `/aftercare/complaints` | `POST /api/complaints` | `Log complaint` dialog |

The cross-cutting route sweep holds SR4, SR5, SR6, SR14, SR15, SR16, SR25 and SR26 on every signed-in route and private page.

### Visual design (DP-59)

The look is square, loud and legible: no rounded corners anywhere except the round `Message us` link, full-bleed colour bands that butt with no gutters, and plum text on cyan.

**Palette in words.** White is the ground. A very deep plum is the dark surface for bands, panels, footer, submit buttons and unselected segments, and also the brand ink on white or cyan. A bright cyan is the accent for form fields, call blocks, links on plum and the current navigation underline. Black is reading ink on white. A mid-grey is used only for the client marks, never for reading text. White on plum is fine; white is never used as text on cyan, and field text on cyan is plum, which keeps contrast at about 7 to 1. All text meets WCAG 2.2 AA.

**Type.** Poppins is the display and body face and Noto Sans is the label, button and figure face, with money and table figures in Noto Sans tabular figures. Urdu runs in Noto Nastaliq Urdu at double line height so nothing clips, with Western digits. All are OFL and come from the app's own files (a font package or font files, named in `THIRD_PARTY_NOTICES.md`), never from another host. Hero titles are nearly three times body size on a desktop and just under twice on a phone; section headings are a little over twice body size.

**Density and composition.** Comfortable density. Full-bleed bands are split into 50/50 panels whose drawing side swaps row by row, with a centred masthead above and a plum legal footer below. Text inside panels is inset about one twentieth of the screen width. Every tap target is at least 44 px at phone width.

**Imagery.** Everything is procedural or uploaded: generated SVG side views of invented coaches, generated seat plans, generated client marks. Icons are an original outline set at a two-pixel stroke.

**Named components.**
- **Masthead call block**: from 1024 px, a centred white area at the top holding the Merrowfield wordmark and a new vehicle drawing on the left, and on the right a small label, the large plum telephone link and the cyan square `Get a free quote` link with plum text. Not sticky.
- **Underlined main navigation**: a centred single row of plum text links under the masthead. The current page has a cyan two-pixel underline just below the text, also marked with `aria-current`.
- **Phone top bar**: below 1024 px, a fixed white bar about 70 px tall with the wordmark at the left, a cyan outline telephone link and a plum `Menu` button of three lines, the bottom line shorter. A soft shadow appears after a short scroll.
- **Full-bleed coach drawing hero**: directly under the header, edge to edge, a little under half the laptop screen's height and about a third of a phone's. A generated side view of an invented coach in a flat plum and cyan street sits under a 40% dark overlay, with a centred two-tier white heading (the level-one heading `Coaches and minibuses with a driver`, then `Arranged for you from Coventry`) and no button. Static.
- **Client marks strip**: a white band under the hero showing five flat grey invented wordmarks from 1024 px and two below that, with `Earlier` and `Later`. Moves only when pressed.
- **Plum promise band**: a full-bleed plum band with a centred white heading `One desk, one person, every detail checked`, a large cyan outline icon, four short lines (`Partner operators asked for you`, `Papers checked for your last day`, `Drivers' hours checked before you travel`, `One private page for your quote`) and a wide cyan square link `Get a free quote` with plum text.
- **Occasion split panel**: a half-and-half row, drawing bleeding in one half, white, plum or cyan text panel in the other, swapping sides row by row. Below 768 px it stacks. Links on plum are cyan. The panel names each occasion and links to its page.
- **Journey quote form**: the working form on its floor-to-ceiling cyan field, with a centred plum title and the steps' fields, closed by a full-width plum square main action with white text. The field is the look's deliberate risk: a form most would call too loud, earned because a coach-hire business is a high-street counter and this form is its counter top.
- **Journey type bar**: a single row of four equal square segments, one radio each, with no gaps. Selected is white with plum text plus a visible mark; the others are plum with white text. Below 768 px it shows two per row.
- **Underline icon field**: every field has a small icon at the left, no box, one thin rule beneath, a chevron at the right on selects, at least 44 px tall. On cyan the rule and text are plum; on white the rule is ink.
- **Today and Tomorrow shortcuts**: two small text buttons at the far ends of a row directly above the out date. The chosen one is plum and underlined; the other is plain plum.
- **Occasion cards**: four cards, each a 3:2 generated drawing on top, a bold black two-line heading and a checklist with plum checks, with no fill, border or shadow. Each links to its occasion page.
- **Message us link**: a round link about 60 px across, fixed at the bottom left, plum with a white icon and a cyan ring. It opens a mail to the desk.
- **Back to top**: a plum square, at least 44 px at phone width, fixed at the bottom right.
- **Plum legal footer**: three centred lines of white text on plum at the page end, with pipe-separated links to `Terms` and `Fleet` and the line `Merrowfield Coach Hire, Coventry`.

**Working screens.** Desk screens keep the same bands. The top of each screen is a plum band holding the level-one heading. Lists and tables are white with plum heading rows and square cells. Filters use the same segmented bar as Journey type. Empty states use a large cyan outline icon on plum with one line of copy. Error and outage lines are plum text on white with a square mark, never colour alone. Duty ribbon blocks are flat plum, cyan, white and hatched, each labelled. The seat grid uses generated SVG seats.

### Motion and effects (DP-03, DP-06, DP-13, DP-27, DP-36, DP-38, DP-40, DP-48, DP-55, DP-58)

Motion is restrained: fades and short slides with a fast start and a long soft settle, and exactly three durations (SR7). Nothing decorative loops, and there are no unnamed effects.

| Motion | What it means | Duration |
|---|---|---|
| Value travels to ticket line or bar | an answer becoming part of the ticket: one element from the field's box to its line's box, moving and fading, one animation per value | 320 ms |
| Step slides left or right | moved forward or back | 320 ms |
| Slim bar slides down | scrolled past the header | 160 ms |
| Search overlay fades | opened or closed | 320 ms |
| Public `Menu` panel | opened or closed, from the right edge | 320 ms |
| Desk `Menu` sheet, other sheets, dialogs | opened or closed, per SR24 | 320 ms |
| Accordion height and fade | question opened or closed | 320 ms |
| Section rises and fades | first time in view | 640 ms |
| Client marks step | a press of `Earlier` or `Later` | 320 ms |
| Occasion card lifts | pointer hover and keyboard focus | 160 ms |
| `Message us` ring | three plays after load, then stops | 640 ms each |
| Stop rows slide | reorder | 160 ms |
| Diary card returns | Escape or a refused move | 160 ms |
| Ribbon blocks reflow | a break moved, one move for all blocks | 320 ms |
| Two seats cross | a swap | 320 ms |
| Document step check draws | that step finished, once only, never again on a refresh; steps already finished when the page first reads a document show their checks with no drawing, and steps passed between two reads draw together | 320 ms |
| Desk page wipe | moving between desk screens | 320 ms |

**The signature, Journey ticket, as observable steps.**
1. On `/quote/route`, `/quote/when` or `/quote/details` the customer answers a field and leaves it.
2. The value lifts from the field and travels as one element, moving and fading, to its ticket line beside the form from 1024 px, or to the fixed bar below 1024 px with the sheet closed, in about a third of a second.
3. It replaces `Not yet given`, and the bar's count rises.
4. If the same field changes while the value is travelling, the travelling element shows the new value and carries on from where it is to the line, with no jump.
5. The `Journey` bar reshapes the form with fades as Interactions says.

**Reduced motion.** Each value appears on its ticket line at once, the step changes at once and the sheet opens at once, with the same text, count, focus target and Announcements message. Across the app every other motion gives its end state at once per SR3, and the section rise and the ring do not play.

### Feedback states (DP-07, DP-08, DP-09, DP-11, DP-13, DP-15, DP-16, DP-19, DP-20, DP-21, DP-22, DP-23, DP-26, DP-27, DP-31, DP-34, DP-36, DP-38, DP-40, DP-41, DP-42, DP-43, DP-46, DP-47, DP-48, DP-49, DP-50, DP-51, DP-52, DP-53, DP-54, DP-55)

**Everywhere.**
- Every async action announces its exact copy in the one polite region named Announcements, including the rare states. Announcements and Problems summaries stay until the next action.
- Pending is SR11's `Working…` on the pressed button, except the `State` bar's `Saving…` and the run sheet's presses, which show at once.
- Every form error also appears in the Problems summary, whose links move focus to their fields (fields outside dialogs). A refused field has `aria-invalid="true"` and its message as its accessible description. Personal fields carry their autocomplete tokens: `name`, `email`, `tel`, `street-address`, `current-password`, `new-password`. A dialog refused by the server stays open as typed with focus on the message, and one whose last step has succeeded closes. `Read file`, `Add name` and a search are not last steps, so they leave theirs open; `Bring in` closes the statement sheet and `Bring in list` closes `Add passengers`.
- All copy renders character for character with straight apostrophes and the published dashes.

**Placeholders.** `<time>` is a UK time as `14:05`. `<date>` is a UK date as `Mon 29 Mar 2027`. `<date-time>` is `Mon 29 Mar 2027, 14:05 UK time`. `<amount>` is money as `£1,157.25`. `<operator>` is an operator's name. `<number>` is a run's number. For example, `Already awarded to Hanley Motor Services at 14:05.`

| Situation | Copy (shown and announced) |
|---|---|
| Session ended | `Your session ended. Sign in again to keep going — what you typed is still here.` |
| One refresh failed | `Couldn't refresh. Trying again.` |
| Customer saved, renamed, removed | `Customer saved.`, `Customer renamed.`, `Customer removed.`; refused while the customer has a hire: `This customer has a hire, so it can't be removed.` |
| Password changed | `Password changed.` |
| Wrong sign-in | `That email and password do not match.` |
| Public search | `<n> results found.`, `Nothing found for that search.` |
| Search text too long | `Search text can be up to 200 characters.` |
| Quote sent successfully | `Request sent. Your reference is <reference>.` |
| Missing answers | `Choose an occasion.`, `Enter the pick-up address.`, `Enter the destination.`, `Enter a date as DD/MM/YYYY.`, `Choose an hour and minutes.`, `Enter between 1 and 400 people.`, `Enter between 0 and 40 bags.`, `Enter between 0 and 10 wheelchair users.`, `Describe the stops in up to 2,000 characters.`, `Enter your name.`, `Enter a real email address.`, `Enter a UK telephone number.`, `Choose which <time> you mean.` |
| Date in the past | `That date has passed. Choose today or a later date.` |
| No hours left today | `No more pick-ups today.` |
| Short notice | `We need at least 30 minutes' notice for a pick-up.` |
| Missing hour | `<time> does not exist on <date>, when the clocks go forward. Choose another time.` |
| Return too early | `The return has to be after the pick-up.` |
| Request limit | `You have sent several requests. Try again after <time>.` |
| Address failure or slow reply | `We could not check this address. You can carry on and type it in full.` |
| Address list | `<n> suggestions.` |
| Enquiry added, merged | `Enquiry added.`, `Enquiries merged.` |
| State saved or refused | `State saved.`, `That did not save. Try again.` |
| Empty lists | `No enquiries match these filters.`, `No operators yet. Press Refresh directory.`, `No bids yet.`, `No payments yet.`, `Nothing in this week.`, `No passengers yet.`, `No documents yet.`, `No complaints logged.`, `No found items logged.`, `No customers yet.` |
| Stop moved | `Stop <i> of <n>: <address>`, for example `Stop 2 of 5: Solihull station` |
| Route good or failed | `Route updated.`; `Route not updated. Showing the last good route.`, with `Plan is out of date` showing until a good reply |
| Plan saved or marked | `Plan saved.`, `Larger than needed` |
| Plan refused, in this order | `This plan leaves <n> people without a seat.` (and `This plan leaves 1 person without a seat.`); `Bags need <n> more units of space.` (and `Bags need 1 more unit of space.`); `This plan has no lift for <n> wheelchair users.` (and `This plan has no lift for 1 wheelchair user.`) |
| Size not offered | `Choose sizes from 8, 12, 16, 31, 49, 56 and 70.` |
| Directory | `Directory refreshed.`; `The directory could not be read. Your list has not changed.`; marker `No longer listed` |
| Paper | `Paper stored.`; `This file is not a PDF, JPEG or PNG.`; `The file store is unavailable right now. Nothing was saved.` |
| Not clear | `<paper> ends <date>, before this hire's last day.`, `<paper> is missing.`, `Driver DBS check is older than three years on this hire's last day.`, `Driver DBS check is missing.`, `No longer listed` |
| Asks and award | `Operators asked.`, `Save a plan before asking operators.`, `Awarded to <operator>.`, `Already awarded to <operator> at <time>.`, `<operator> has no price on this hire.` |
| Bids | `Price sent.`, `Price changed.`, `Bid withdrawn.`, `Enter the price in pounds and pence.`, `Bids closed at <time>. Your price was not sent.` |
| Quote totals | `Totals updated: <amount>.`; `Margin is 0 to 60 in steps of 0.5.` |
| Quote sent, stale, locked | `Quote sent.`; `Someone changed this quote at <time>. Your edit is still here. Reload to see theirs.`; `This quote is accepted. Use Changes instead.` |
| Rate table | `Rate table added.`, `A rate table already starts on <date>.`, `A rate table can't start before today.`, `Enter the amount in pounds and pence.` |
| Customer page | as in the strings table |
| Statement | `Read <n> rows.`, `Brought in <n> rows.`, `Row <n>: <text> is not a real date.` (for example `Row 12: 31/02/2027 is not a real date.`), `Row <n>: <text> is not an amount.`, `The first line has to read Date,Description,Amount,Balance.`, `This file has more than 2,000 rows.` |
| Booking credit | `Credit <amount>` |
| Diary | `Run <number> moved to <date>.`, `That driver is already on Run <number> at <time>.`, `Clocks go forward 01:00`, `Clocks go back 02:00` |
| Driver | `Driver told at <time>`; `We couldn't reach the driver's phone. Nothing was marked as told.` |
| Ribbon | `Over the limit from <time>`, `Break moved.`, `Second driver added.`, `Run confirmed.`, `This run is over the limit. Move a break or add a second driver.` |
| Passengers | `<n> names brought in.`, `Name added.`, `Listed twice`, `<n> more adults are needed`, `1 more adult is needed`, `Wheelchair users sit only in 2A and 2B.`, `This file has more than 500 rows.` |
| Seat swap | `<name> is now in <seat>. <other name> is now in <other seat>.`, for example `Agnieszka Wiśniewska is now in 12A. Jack O'Rourke is now in 3C.`; a single move reads `<name> is now in <seat>.` |
| Run sheet press | `<press> recorded.` in the page's language button text, for example `Arrived recorded.` in English; Polish `Zapisano: <press>.` |
| Charges | `Charges accepted: <amount>.` |
| Changes | `Booking changed.`, `Booking cancelled.`, `This departure has already gone.` |
| Documents | `<kind> stored.` with `<kind>` one of `Quote`, `Confirmation letter`, `Invoice`, `Credit note`, `Seat plan`; `The PDF service is unavailable right now. Nothing was saved.`; `The file store is unavailable right now. Nothing was saved.`; `This hire has no accepted quote yet.`; `You have downloaded several files. Try again after <time>.` |
| Complaints | `Complaint logged.`; `Bank holidays unavailable. Weekends only.` |
| Lost property | `Item logged.`, `Item returned.`, `Record the owner's details before returning this.`, `Past holding date` |
| Customer closing | `Customer closed.`, `Customer brought back.`, state labels `Closed`, `Erasing`, invoice name `Erased customer`, `The wait is over. This customer can't be brought back.` |
| Old sheet | `Sheet brought in.`, `Matches two customers` |
| Generic not found | `We can't find that.` |

## Backend

### API (DP-01, DP-02, DP-05, DP-08, DP-10, DP-12, DP-14, DP-16, DP-17, DP-20, DP-21, DP-22, DP-24, DP-25, DP-26, DP-28, DP-29, DP-30, DP-32, DP-33, DP-35, DP-37, DP-39, DP-43, DP-44, DP-45, DP-47, DP-49, DP-50, DP-52, DP-53, DP-54, DP-56)

**Conventions.**
- Every JSON key and enum value is camelCase.
- Money in every body and response is a string with exactly two decimals (`"1157.25"`), never a number, except the prices sent to `PUT /api/b/<token>/bid`, which take the typed forms Business rules publishes. A percentage is a string (`"15"`, `"12.5"`).
- A local date-time is `{"date":"YYYY-MM-DD","time":"HH:MM"}` in UK time, optionally with `repeatedHour`: `first` or `second`.
- Every instant is UTC in whole seconds with a Z (`2027-03-29T22:59:59Z`, never milliseconds).
- Requests are `application/json` unless stated. Fields other than the published ones are ignored and change nothing.
- Lengths count characters as a reader does: an emoji counts as 1.
- Any `q` is capped at 200 characters inclusive. JSON nesting is capped at 16 levels inclusive. Each is answered 422 within a second.
- All `/api` routes need a session unless marked public or private.
- Published statuses in the rows below are success first, then each endpoint's own extra errors; the ladder decides the rest.

**Error body.** Always `{"error":{"code":"...","message":"...","fields":{"name":"..."}}}`, with `fields` only for field errors and always inside `error`. No stack trace, SQL, path or library name ever appears in one. Copy for `message` comes from Feedback states.

**The one ladder.** Unknown route or wrong method (404, or 405 with `Allow`), then a body or file over its published size limit (413, decided before the body is parsed and before authentication, always JSON, never a dropped connection), then rate limit (429 with `Retry-After` in seconds), then a state-changing request with a foreign `Origin` (403), then authentication (401), then unknown resource (404, or 410 for an ended private page), then content type (415), then malformed JSON (400), then field validation (422), then state (409), then a stale edit (412). A provider failure on one action answers 503, never 500.

**Size limits (the limit itself is allowed).**
- JSON bodies: 100,000 bytes.
- Statement file: 2,000,000 bytes.
- Passenger file: 1,000,000 bytes.
- Customer sheet: 2,000,000 bytes.
- Paper upload: 5,000,000 bytes judged on the file part alone, so a 5,000,000-byte file in a larger multipart body is taken and 5,000,001 answers 413. Any multipart body over 5,100,000 bytes answers 413 at once.

**Health and clock.**
- `GET /api/health` (public): 200 `{"status":"ok"}`.
- `GET /api/public/clock` (public): 200 `{"date":"2027-03-29","time":"14:05","instant":"2027-03-29T13:05:00Z"}`.

**Desk access.** A desk is `{"id","name","email"}`.
- `POST /api/auth/sign-up` (public) `{"name":"Hearsall Hire","email":"desk@hearsall.example","password":"at-least-8-characters"}`: 201 `{"desk":{...}}`, signs in. 409 email taken.
- `POST /api/auth/sign-in` (public) `{"email","password"}`: 200 `{"desk":{...}}`. 401 `wrongPassword`.
- `POST /api/auth/sign-out`: 204.
- `GET /api/auth/session`: 200 `{"desk":{...}}`. 401 `sessionEnded` for an ended session's cookie, 401 `notSignedIn` with no cookie.
- `POST /api/auth/password` `{"currentPassword","newPassword"}`: 204. This session stays and the person's other sessions end. 401 wrong current password.

**Customers.** A customer is `{"id","name","email","telephone","language","notes","state","closedAt","eraseAt"}`; `language` is `en`, `pl` or `ur`; `state` is `active`, `closed` or `erasing`.
- `GET /api/customers?q=&state=`: 200 `{"customers":[...]}`. Active by default. `q` matches anywhere in the name or email, case ignored.
- `POST /api/customers` `{"name":"Jack O'Rourke","email":"jack@orourke.example","telephone":"01632 960155","language":"en"}`: 201 customer.
- `GET /api/customers/<id>`: 200 customer, also while closed. A deleted or erased customer answers 404.
- `PATCH /api/customers/<id>` `{"name":"..."}`: 200 customer.
- `DELETE /api/customers/<id>`: 204. 409 if the customer has a hire.
- `POST /api/customers/<id>/close` with `{}`: 200 customer. 409 if already closed.
- `POST /api/customers/<id>/bring-back` with `{}`: 200 customer. 409 after the wait.
- `POST /api/customers/import`, `text/csv`: 200 `{"added":2,"filled":1,"reviewList":[{"row":4,"message":"Matches two customers"}]}`.
- `GET /api/customers/review`: 200 `{"reviewList":[...]}`.

**Public.**
- `GET /api/public/search?q=`: 200 `{"results":[{"title","path","excerpt"}]}`. 422 empty or over-long.
- `GET /api/public/address/find?q=<text>`: 200 `{"suggestions":[{"id","text"}]}`, at most six. 422 under 3 characters. 503.
- `GET /api/public/address/get/<id>`: 200 `{"id","line1","town","postcode","text"}`, with `postcode` in the published form and `text` as `<line1>, <town> <postcode>`. 503.
- `POST /api/public/enquiries` and, for any signed-in desk, `POST /api/enquiries`, with the same body. The public one feeds the desk named by `PUBLIC_DESK_EMAIL`. Example:

```json
{"occasion":"school","journeyType":"return","stops":[{"text":"Coventry station, Coventry CV1 2GT","checked":true},{"text":"NEC, Birmingham B40 1NT","checked":true}],"departAt":{"date":"2027-05-14","time":"08:00"},"returnAt":{"date":"2027-05-14","time":"17:00"},"party":{"people":47,"large":0,"medium":0,"hand":10,"wheelchairs":0},"details":null,"name":"Jack O'Rourke","email":"jack@orourke.example","telephone":"01632 960155","language":"en","website":""}
```

`occasion` is `school`, `weddings`, `company` or `festivals`. `journeyType` is `oneWay`, `return`, `sameDayReturn` or `severalStops`. `stops` holds From, then any stops, then To, 2 to 7 entries. Answer: 201 `{"reference":"CV-7K2M4","receivedAt":"..."}`. 429 on the public route only. 422 with `fields`.

**Enquiries.** An enquiry's `id` is its `reference`, and a hire shares that id. A row is `{"id","reference","customerName","occasion","state","departAt","departInstant","createdAt"}`. `state` is `new`, `priced`, `quoted`, `won` or `lost`.
- `GET /api/enquiries?state=&occasion=&q=&after=&before=`: 200 `{"enquiries":[25 rows at most],"nextCursor":"..."|null,"prevCursor":"..."|null}`. `q` matches anywhere in the reference, customer name or email, case ignored.
- `GET /api/enquiries/<id>`: 200 a row plus `{"journeyType","stops":[{"id","text","checked"}],"returnAt","returnInstant","party","details","email","telephone","language","submittedBody","mergedReferences":[],"duplicates":[{"id","reference"}]}`. `submittedBody` is the request's text exactly as sent. A merged later reference answers its earlier enquiry.
- `PATCH /api/enquiries/<id>` `{"state":"priced"}`: 200 row. 409 illegal change.
- `POST /api/enquiries/merge` `{"enquiryIds":["CV-AAAAA","CV-BBBBB"]}`: 200 `{"kept":"CV-AAAAA","merged":["CV-BBBBB"]}`. 409 not duplicates.

**Trip plan.**
- `GET /api/enquiries/<id>/trip`: 200 `{"stops":[{"id","text","checked"}],"legs":[{"km":"32.2","minutes":38,"miles":"20.0"}],"planOutOfDate":false,"plan":{"sizes":[49,49],"suggested":[49,49],"largerThanNeeded":false}}`. The first read of a trip with no legs makes one route call. `plan.sizes` is null until a plan exists, as Business rules publishes.
- `PUT /api/enquiries/<id>/trip/stops` `{"order":["<stop id>","<stop id>"]}`: 200 the trip. 503 with the order kept, the last good legs kept and `planOutOfDate` true. One call makes one route call.
- `POST /api/enquiries/<id>/trip/route` with `{}`: 200 the trip, or 503 the same way.
- `PUT /api/enquiries/<id>/trip/plan` `{"sizes":[49,12]}`: 200 the trip. 422 with the refusal as `message` and `fields.sizes`.

**Operators.** An operator is `{"id","name","town","email","telephone","sizes","listed","papers":[{"kind","endsOn","stored","objectKey"}],"dbsCheckedOn"}`. `kind` is `operatorLicence` or `publicLiabilityCover`.
- `GET /api/operators`: 200 `{"operators":[...]}`, in id order.
- `POST /api/operators/refresh` with `{}`: 200 `{"operators":[...]}`. 503. On a new desk call this before naming an `operatorId`.
- `POST /api/operators/<id>/papers`, `multipart/form-data` with `kind`, `endsOn` (`YYYY-MM-DD`) and `file`: 201 a paper. 422 for a refused type. 503.
- `GET /api/operators/<id>/papers/<kind>/file`: 200 the bytes as stored, with the type judged at upload. 404 with no file. 503.
- `PUT /api/operators/<id>/dbs` `{"checkedOn":"2026-01-15"}`: 200 operator.
- `GET /api/hires/<id>/operators`: 200 `{"operators":[{"id","name","clear":true,"reason":null}]}`.

**Hires.**
- `POST /api/hires` makes one hire in one call at the stage asked for, sending no mail and calling no provider. An `operatorId` not on the desk answers 404. The literal example:

```json
{"customer":{"name":"Jack O'Rourke","email":"jack@orourke.example","telephone":"01632 960155","language":"en"},"occasion":"company","stops":["Coventry station, Coventry CV1 2GT","NEC, Birmingham B40 1NT"],"departAt":{"date":"2027-05-14","time":"08:00"},"returnAt":null,"party":{"people":47,"large":0,"medium":0,"hand":0,"wheelchairs":0},"vehicles":[{"seats":49,"operatorId":"OP-1001","boughtPrice":"1006.30","marginPercent":"15"}],"stage":"accepted"}
```

`stage` is `enquiry`, `quoted` or `accepted`. At `enquiry`, `vehicles` holds only `seats` or is empty. Dates may be past or future. Vehicles are stored as given. The optional `quoteSentAt` (a local date-time) records when a quote carried over from the arranger's old records was sent, and otherwise sending is now. A customer whose folded email matches one on the desk is reused. Answer: 201 `{"id","reference","customerId","stage","enquiryState","quotePath","sentAt","validUntil","endsAt","vehicles":[{"id","seats","operatorId","boughtPrice","marginPercent","sellingPrice","vat","total","deposit","departAt","departInstant","runId"}],"runs":[{"id","number","sheetPath"}]}`.

- `GET /api/hires/<id>`: 200 the same fields plus `{"paymentState","paid","owed","credit","balanceDueOn","awarded":{"operatorId","operatorName","at"}|null,"vehicles":[{...,"depositPaid","balancePaid","refundsDue","owedAmount"}]}`. `paymentState` is `nothingPaid`, `depositPartPaid`, `depositPaid`, `paidInFull`, shown as `Nothing paid`, `Part of the deposit paid`, `Deposit paid`, `Paid in full`.

**Bids.**
- `POST /api/enquiries/<id>/bids/ask` `{"operatorIds":["OP-1001","OP-1002"]}`: 201 `{"asks":[{"operatorId","bidPath","sentAt","closesAt"}]}`. An operator already asked keeps its ask and gets no second mail. 409 `noPlan` when no plan has been saved. 409 `alreadyAwarded`.
- `GET /api/enquiries/<id>/bids?sort=priceLowest`: 200 `{"bids":[{"operatorId","operatorName","status","clear","reason","prices":["1250.00"],"total","receivedAt","closesAt"}],"awarded":...}`. `status` is `asked`, `open`, `withdrawn` or `closed`, as Business rules publishes. On a row with no live price `prices` is `[]` and `total` and `receivedAt` are null.
- `POST /api/enquiries/<id>/award` `{"operatorId":"OP-1001"}`: 200 `{"awarded":{...}}`, with vehicles taking the bid's prices, the default margin from the rate table in force, and one run per vehicle. 409 `alreadyAwarded`, including for a repeat press, with no further mail. 409 `noBid`. 409 `operatorNotClear` with the reason.
- `GET /api/b/<token>` (private): 200 `{"route":{"stops":["..."]},"dates":{"departAt":...,"returnAt":...,"departInstant","returnInstant"},"vehicles":[{"index":1,"seats":49}],"partySize":47,"closesAt","bid":null}`, and nothing else. 404 for an address that never existed. 410 once ended.
- `PUT /api/b/<token>/bid` (private) `{"prices":["1,250.50"]}`: 200 `{"bid":{"prices":["1250.50"],"receivedAt"}}`. 422 price grammar or wrong count. 410 `bidsClosed` with the late-press copy.
- `DELETE /api/b/<token>/bid` (private): 204. 409 `noBid`. 410 the same.

**Quote.** A quote is `{"version":3,"sentAt","validUntil","endsAt","quotePath","rateTableId","vehicles":[{"id","seats","boughtPrice","marginPercent","sellingPrice","vat","total","deposit"}],"total","depositTotal"}`.
- `GET /api/hires/<id>/quote`: 200 quote.
- `POST /api/hires/<id>/quote/preview` `{"vehicles":[{"seats":49,"boughtPrice":"1006.30","marginPercent":"15"}]}`: 200 `{"vehicles":[{"seats","sellingPrice","vat","total","deposit"}],"total","depositTotal"}`, saving nothing, using the hire's rates. 422.
- `PUT /api/hires/<id>/quote` `{"version":3,"vehicles":[{"id":"<vehicle id>","marginPercent":"12.5"}]}`: 200 quote. 422 margin. 409 `quoteLocked`. 412 `staleEdit`.
- `POST /api/hires/<id>/quote/send` with `{}`: 200 quote and one mail. A quote made at `quoted` by `POST /api/hires`, or seeded as `Quoted`, has not been mailed: its first send passes the 409 below and, unless it was edited, keeps `sentAt`, `validUntil`, `endsAt`, the rates and `quotePath` and mails that same address and valid-until date, even past its end. A repeat with nothing changed sends nothing and answers the same. A send after an edit replaces the earlier page. 409 not awarded or accepted.

**Rates.** A table is `{"id","effectiveFrom":"2027-04-01","defaultMarginPercent":"15","waitingRatePerHour":"20.00","secondDriverCharge":"150.00","depositMinibus":"50.00","depositMinibusHigher":"100.00","depositCoach":"100.00","depositCoachHigher":"150.00"}`.
- `GET /api/rates`: 200 `{"tables":[...],"inForce":"<id>"}`.
- `POST /api/rates` with a table without `id`: 201 table. 422 before today. 409 same date.

**Customer page (private).**
- `GET /api/q/<token>`: 200 `{"reference","language","state","stage","stops":["..."],"departAt","departInstant","returnAt","returnInstant","people":47,"vehicles":[{"seats","total","deposit"}],"total","depositTotal","validUntil","endsAt","depositSaidSent":false,"cancelled":false}`, and nothing else. `state` is `accepted` once the page's quote has been accepted, whatever the time; before that it is `open` up to and including `endsAt` and `ended` after it. A cancellation does not change `state`; it sets `cancelled` to true. `stage` is `quoteSent`, `accepted`, `deposit`, `balance` or `travel`. 404 never existed. 410 replaced or erased.
- `POST /api/q/<token>/accept` `{"name":"Jack O'Rourke"}`: 200 as the read. 422 name. 409 `quoteEnded`, only for a quote not yet accepted. A repeat after acceptance answers 200 and changes nothing, also after `endsAt`. 409 `bookingCancelled` on a cancelled booking's page, with the `This booking was cancelled.` copy, whether or not its quote was accepted.
- `POST /api/q/<token>/deposit-sent` with `{}`: 200 as the read, also after `endsAt` for an accepted quote. 409 `bookingCancelled` on a cancelled booking's page, with the same copy.
- `GET /api/q/<token>/pdf`: 200 `application/pdf`, the stored quote, rendered first if there is none. 503.

**Payments.**
- `POST /api/payments/statements/preview`, `text/csv`: 200 `{"previewId","matched":[{"row","date","description","amount","balance","reference"}],"unmatched":[...],"moneyOut":[...],"alreadySeen":[...],"refused":[{"row":12,"message":"..."}]}`. 422 header or row count.
- `POST /api/payments/statements/<previewId>/bring-in` with `{}`: 200 `{"broughtIn":3,"moneyHeld":"845.01"}`. A repeat brings nothing in.
- `GET /api/payments`: 200 `{"moneyHeld","bookings":[{"id","reference","customerName","paymentState","paid","owed","credit"}]}`.
- `GET /api/hires/<id>/ledger`: 200 `{"lines":[{"id","movementId","account","amount":"-175.00","at","vehicleId"}],"sum":"0.00"}`. `account` is `clientMoney`, `hireIncome`, `refundsDue` or `operatorOwed`, shown as `Client money`, `Hire income`, `Refunds due`, `Operator owed`.
- `POST /api/hires/<id>/refunds` `{"vehicleId":"<vehicle id>","amount":"75.00"}`: 201 a line pair, recording a refund paid. 409 above what is due.
- `GET /api/payments/download` and `GET /api/hires/<id>/payments/download`: 200 `text/csv`.

**Diary and runs.** A run is `{"id","number","hireId","vehicleId","seats","driver":{"name","telephone"}|null,"toldAt","confirmed","sheetPath","departAt","departInstant","secondDriver","stops":[{"id","text","flightCode"}],"charges":[{"stopId","kind","minutes","amount","accepted"}],"chargesTotal"}`. `kind` is `waiting` or `comfortStop`.
- `GET /api/diary?week=2027-W12`: 200 `{"week","days":[{"date","hours":23,"label":"Clocks go forward 01:00"}],"rows":[{"runId","number","hireId","seats","driver","departAt","departInstant"}]}`. 422 bad week.
- `GET /api/runs/<id>`: 200 run.
- `PUT /api/runs/<id>/departure` `{"departAt":{"date":"2027-03-28","time":"08:00"}}`: 200 run. 422 missing hour. 409 `driverClash`. 503 when a told driver cannot be told (the change is kept and `toldAt` is cleared).
- `PUT /api/runs/<id>/driver` `{"name":"Ewan Price","telephone":"01632 960301"}`: 200 run with `toldAt`. 503 with the driver kept and `toldAt` null. The same driver again with `toldAt` set publishes nothing. 409 `driverClash`.
- `POST /api/runs/<id>/tell` with `{}`: 200 run. 503. 409 no driver.
- `PUT /api/runs/<id>/blocks` `{"startAt":{"date":"2027-05-14","time":"11:00"},"blocks":[{"kind":"drive","minutes":270},{"kind":"break","minutes":45}]}`: 200 the hours answer. `kind` is `drive`, `break`, `wait` or `rest`.
- `GET /api/runs/<id>/hours`: 200 `{"drivingMinutes":271,"spreadMinutes":316,"breaches":[{"rule":"drivingBeforeBreak","atMinute":271,"atLocal":{"date":"2027-05-14","time":"15:31"}}]}`. `rule` is `drivingBeforeBreak`, `dailyDriving` or `spread`.
- `POST /api/runs/<id>/second-driver` with `{}`: 200 run. A repeat adds nothing.
- `POST /api/runs/<id>/confirm` with `{}`: 200 run. 409 `overTheLimit`.
- `PUT /api/runs/<id>/stops/<stopId>/flight` `{"code":"WT123"}`: 200 run.
- `POST /api/runs/<id>/accept-charges` with `{}`: 200 `{"added":"7.33","vehicleTotal":"1164.58"}`. A second press answers `"added":"0.00"`.

**Run sheet (private).**
- `GET /api/r/<token>`: 200 `{"number","departAt","departInstant","stops":[{"id","text","presses":{"arrived":null,"boarded":null,"left":null}}],"flightLine":null,"charges":[...]}`. 404 never existed. 410 once its booking is cancelled or its customer erased.
- `POST /api/r/<token>/presses` `{"stopId":"<stop id>","kind":"arrived","secondsAgo":0,"repeatKey":"<unique text>"}`: 201 `{"pressId","at":"..."}`. `kind` is `arrived`, `boarded`, `left`, `comfortStop` or `backOnTheRoad`. `secondsAgo` is the time since the press at each attempt, so a resend after a lost reply carries a new value, and it is not part of the comparison: the first attempt to arrive fixes the instant. The same `repeatKey` with the same `stopId` and `kind` returns the first status and body and counts nothing. The same key with a different `stopId` or `kind` answers 409 `repeatKeyConflict`. 409 `pressOutOfOrder` for a press whose earlier press at that stop is missing, or a kind already pressed there.

**Passengers and seats.**
- `POST /api/hires/<id>/passengers/import`, `text/csv`: 201 `{"listId","objectKey","passengers":[...]}`. 422 over 500 rows. 503.
- `POST /api/hires/<id>/passengers` `{"name":"Agnieszka Wiśniewska","group":"Adult","needs":""}`: 201 passenger.
- `GET /api/hires/<id>/passengers`: 200 `{"passengers":[{"id","name","group","needs","listedTwice","wheelchair"}],"adultsNeeded":4,"adultsShort":3}`.
- `GET /api/hires/<id>/seats`: 200 `{"vehicles":[{"id","seats","grid":[{"seat":"1A","passengerId":null}],"split":[{"passengerId","name","amount"}]}]}`.
- `PUT /api/hires/<id>/seats` `{"vehicleId":"<vehicle id>","passengerId":"<passenger id>","seat":"12A"}`: 200 as the read, swapping if the seat is taken. 409 `wheelchairSeat`. 422 unknown seat.
- `GET /api/hires/<id>/passengers/download`: 200 `text/csv`.

**Changes.**
- `POST /api/hires/<id>/changes/preview` and `POST /api/hires/<id>/changes`, same body `{"departAt":{"date":"2027-05-15","time":"09:15"},"stops":["Coventry station, Coventry CV1 2GT","NEC, Birmingham B40 1NT"],"vehicles":[{"id":"<vehicle id>","boughtPrice":"1100.00","marginPercent":"15"}]}` (every key optional): preview 200 `{"old":{...},"new":{...},"priceMoved":true,"lines":[{"vehicleId","refundsDue","owed"}]}`, saving nothing; apply 201 the same plus `{"id","quotePath"}`. 409 before acceptance.
- `GET /api/hires/<id>/changes`: 200 `{"changes":[...],"cancellation":null}`.
- `POST /api/hires/<id>/cancel/preview` and `POST /api/hires/<id>/cancel`, same body `{"noticeAt":{"date":"2027-04-14","time":"00:30"},"by":"customer"}`, where `by` is `customer` or `arranger`: 200 `{"cancellation":{"id","noticeAt":"...","by","lines":[{"vehicleId","days","charge","paid","refundsDue","owed"}]}}`. A repeat answers the first cancellation and records nothing. 409 `departureGone`.

**Documents.** A document is `{"id","kind","hireId","state","number","objectKey","customerName","createdAt","history":[{"at","who","what"}]}`. `kind` is `quote`, `confirmationLetter`, `invoice`, `creditNote` or `seatPlan`. `state` is `waiting`, `rendering` or `stored`.
- `GET /api/documents`: 200 `{"documents":[...],"nextInvoice":"INV-2027-0002","nextCreditNote":"CN-2027-0001"}`.
- `POST /api/hires/<id>/documents` `{"kind":"invoice"}`: 201 document once stored. While it runs the document reads in `GET /api/documents` as Business rules publishes. 409 no accepted quote. 503 with nothing kept.
- `GET /api/documents/<id>`: 200 document. No write method exists on it.
- `GET /api/documents/<id>/file`: 200 `application/pdf`. 404 until stored. 429. 503. 410 for an erased customer's document.

**Aftercare.**
- `POST /api/complaints` `{"customerId":"CU-1001","summary":"Late pick-up at the school","receivedAt":{"date":"2027-03-25","time":"10:00"}}`: 201 `{"id","customerId","summary","receivedAt","replyDue":"2027-04-01","holidayLine":null}`.
- `GET /api/complaints`: 200 `{"complaints":[...]}`.
- `POST /api/lost-property` `{"description":"Blue rucksack","foundOn":"2027-01-31"}`: 201 `{"id","description","foundOn","heldTo":"2027-02-28","state":"held"}`. `state` is `held`, `pastHoldingDate` or `returned`.
- `GET /api/lost-property`: 200 `{"items":[...]}`.
- `POST /api/lost-property/<id>/return` `{"ownerDetails":"Named the school badge on the front pocket"}`: 200 item plus `{"charge":"5.00"}`. 422 empty details. 409 already returned.

### Business rules (DP-07, DP-08, DP-10, DP-12, DP-14, DP-18, DP-20, DP-21, DP-22, DP-24, DP-25, DP-26, DP-28, DP-29, DP-30, DP-32, DP-33, DP-34, DP-35, DP-37, DP-37, DP-39, DP-41, DP-44, DP-45, DP-47, DP-50, DP-52, DP-53, DP-54)

**Time.** Business time is Europe/London. Screens show dates on the UK date, never the UTC date. A device's clock is never consulted. Every time-dependent state is decided at the moment of the read or press.

**Desks.** Every desk is self-contained. Its customers, enquiries, hires, rate table, operator list, papers, invoice numbers, bank-holiday list and ledger belong to it alone. Sign-up makes an empty desk with the default rate table (effective from 2000-01-01), no operators until `Refresh directory` and no holiday list until first needed. Each request decides its own desk, and nothing about one request can reach another's. Another desk's identifier answers 404, inside a body as well as in an address.

**Quote request rules.**
- Party is 1 to 400 people, 0 to 40 of each bag, 0 to 10 wheelchair users. `Stop details` is up to 2,000 characters. UK numbers with spaces or +44 read as the same number.
- When the out date is today, hours already past are removed from the list by the server's clock, and when none is left the no-more-pick-ups line shows. A pick-up under 30 minutes away is refused; exactly 30 minutes is allowed, with the server's clock cut down to its whole minute, so at 14:00:40 a pick-up at 14:30 is allowed and at 14:01:00 one at 14:30 is refused. On both enquiry routes a `time` whose minutes are not 00, 15, 30 or 45 answers 422 with `Choose an hour and minutes.` A time breaking both rules, such as 14:20 asked at 14:05, gets that refusal and not the short-notice one. A date before today is refused.
- On the day the clocks go forward, a time in the missing hour is refused (for example 01:30 on Sun 28 Mar 2027). On the day they go back, a time in the repeated hour asks which one and the answer is required: `first` on 2027-10-31 at 01:30 gives 2027-10-31T00:30:00Z and `second` gives 2027-10-31T01:30:00Z. A return earlier than or equal to the out date and time is refused.
- These rules apply to both enquiry routes. `POST /api/hires` applies only the missing-hour and repeated-hour rules, with first as its reading when `repeatedHour` is left out.
- A filled `website` field in a body that parses as JSON gets the normal 201 with a made-up reference and stores nothing and counts nothing, even with invalid fields or an email already at its limit.
- References are `CV-` then five characters of the alphabet 0123456789ABCDEFGHJKMNPQRSTVWXYZ.
- Five accepted requests per email in folded form per `ENQUIRY_RATE_WINDOW_SECONDS` (default 3600) are allowed. The sixth is refused until the oldest leaves the window, with `Retry-After` and that moment's UK time with its minute rounded up. Only requests that answer 201 and store count. The limit reads the `email` of a body that parses as JSON: a body of the wrong content type, unreadable JSON or a body with no usable `email` is not limited and goes on down the ladder to 415, 400 or 422. A request with an email at its limit and other invalid fields answers 429, because rate limit comes first.

**Folding.** For email, case and spaces are ignored. For telephone, only digits count, with a leading 44 read as 0. For names, case, spaces and accents are ignored.

**Address.** Third-party calls wait at most 5 seconds. A typed address is stored with `checked: false` and marked `Not checked` on the desk. Postcodes print upper case with one space before the last three characters (`cv1 2ab` and `cv12ab` both show `CV1 2AB`).

**Enquiry states.** Legal changes:
- `New` to `Priced` or `Lost`
- `Priced` to `New`, `Quoted` or `Lost`
- `Quoted` to `Priced`, `Won` or `Lost`
- `Won` to `Lost`
- `Lost` to `New`

Any other change answers 409; the same state answers 200 and changes nothing. The first bid received moves `New` to `Priced`, sending a quote moves it to `Quoted`, and acceptance moves it to `Won`.

**List and merge.** Order is newest first, then reference. A cursor marks a place in that order, so a row added while reading never repeats or skips one on the next page. Two requests with the same email or the same telephone in folded form are offered for merging. A merge keeps the earlier reference (the one created first, then the lower reference) and lists the later one under it.

**Trip plan.**
- Miles are km × 0.621371, half up to one decimal.
- Sizes 8, 12, 16 (minibus) and 31, 49, 56, 70 (coach) hold 16, 24, 32, 62, 98, 112 and 140 bag units. A Large bag is 3 units, a Medium 2, a Hand 1. Only the 16 and the 49 have a lift, each lift taking two wheelchair users at most.
- The plan is the fewest vehicles that seat everyone and hold every bag with room for every wheelchair user. Among those it is the fewest empty seats; then, with each plan's vehicles listed largest first, the plan whose list is larger at the first place they differ.
- Worked examples: 98 people give 49 + 49, not 70 + 31; 137 give 70 + 70; 100 give 70 + 31; 60 people with 2 wheelchair users give 49 + 12, because a 70 alone has no lift; 30 people with 3 wheelchair users give 16 + 16; 20 people with 50 Large bags give 70 + 8; 12 people with 20 Large bags give 31.
- `plan.suggested` is always worked out from the party. A plan exists only once it is saved: `plan.sizes` is null and `largerThanNeeded` false until then, and asking operators is refused. `textbox "Plan"` starts with the suggested sizes, so pressing `Save plan` accepts them. An enquiry made by `POST /api/hires` with vehicle sizes has those sizes as its saved plan.
- The arranger may overrule with any plan that passes the checks below. `largerThanNeeded` is true exactly when the saved plan has more vehicles than the suggested plan, or the same number of vehicles and more seats in total. For example, 47 people are suggested `49`: `56` is true, `31, 16` is true (more vehicles, though fewer seats), and `49` is false. A plan that cannot seat everyone is refused first, then one that cannot hold the bags, then one with no room for a wheelchair user. A size outside the seven is refused.

**Operators.**
- `Refresh directory` reads every page and is all or nothing. An operator the directory no longer names stays with its marker. Papers are judged by first bytes as PDF, JPEG or PNG.
- Required papers are `Operator licence` and `Public liability cover`. School hires also need the `Driver DBS check`, a date no older than three years on the hire's last day: a check on that date three years before counts, one a day older does not.
- A hire's last day is the UK date of its return, otherwise of its latest departure. An operator is `Clear` only if every required paper covers that day, not merely today: a paper ending on that day counts, one ending the day before does not. A paper counts by its end date, whether or not its file has been uploaded yet.
- When more than one thing stops an operator being `Clear`, `reason` is the first that applies, as its copy from Feedback states, in this order: `No longer listed`, `Operator licence`, `Public liability cover`, `Driver DBS check`. For example, seeded OP-1013 reads `Operator licence is missing.`
- The arranger gets one mail per paper at the first daily check that finds the paper ending within 30 days, counted on UK dates, 0 to 30 inclusive. Never a second for that paper, and none for a paper ending 31 or more days away.

**Bids.**
- A bid gives one price per vehicle of the plan, and the arranger awards the whole hire to one operator.
- Prices may be typed as `1250`, `1,250`, `1250.5` or `1,250.50`. Three decimals, a negative number, a pound sign or misplaced thousands such as `12,50` are refused.
- A bid can be priced, changed or withdrawn until the window ends or the hire is awarded. `closesAt` is the ask's `sentAt` plus `BID_WINDOW_SECONDS` (default 172800), in whole seconds. A press in the second of `closesAt` is accepted. From the next second, or from the award if that comes first, the page answers 410 from the server, with `lang` set on the document before any script runs, and a `PUT` or `DELETE` answers 410 `bidsClosed` with the late-press copy, whose time is the UK time of `closesAt` or of the award.
- A withdrawn bid leaves the operator free to price again while the window is open: `PUT` answers 200 and the bid is `open`, with a new `receivedAt`. `DELETE` with no live bid answers 409 `noBid`.
- A live price is a price sent no later than the second of `closesAt` and not withdrawn. The window limits the operator and not the arranger, so a live price stays live after `closesAt` and after an award.
- A row's `status` is `closed` from the second after `closesAt`, or from the award if that comes first, whatever the operator did. `closed` says only that the operator can no longer act, and the row's `prices` show whether it holds a live price. Before that a row is `asked` if no price has been sent, `open` with a live price and `withdrawn` after a withdrawal. An operator that never priced therefore reads `asked` until its window ends and `closed` with no live price afterwards.
- The bids table sorts by a row's `total`, then earliest received. A row with a live price keeps its place in that sort whatever its `status`, including after `closesAt`. Rows with no live price follow the priced rows under either sort, in operator id order.
- An operator not `Clear` for this hire shows its reason and cannot be awarded. An award is checked in this order: already awarded (409 `alreadyAwarded`), then an operator of this desk that was not asked or has no live price, including a withdrawn bid or a window that ended unpriced (409 `noBid`), then not `Clear` (409 `operatorNotClear`). An award of a live price after `closesAt` that passes these checks answers 200. `Award` shows on each row with a live price, before and after `closesAt`.
- Of two awards at once exactly one wins. Award sends one closing mail to every other asked operator, whether it priced, never priced or withdrew, and a repeat sends nothing.

**Quote money.**
- Selling price per vehicle = awarded price × (1 + margin), half up to the penny. Margin is 15% by default and editable per vehicle from 0 to 60 in steps of 0.5.
- VAT is zero on vehicles of 12 seats or more and 20% on the 8-seat minibus, half up per vehicle.
- Deposit per vehicle: a minibus £50, or £100 when that vehicle's total is over £750.00; a coach £100, or £150 when that vehicle's total is over £1,000.00. The comparison uses the rounded total, and exactly the limit stays at the lower deposit.
- Worked examples: 1,006.30 + 15% = 1,157.245, shown £1,157.25; 1,234.50 + 15% = 1,419.675, shown £1,419.68; 652.17 + 15% = 749.9955, shown £750.00, so a 12-seat minibus has the £50 deposit; 869.56 + 15% = 999.994, shown £999.99, so a coach has the £100 deposit; 869.57 + 15% = 1,000.0055, shown £1,000.01, so a coach has the £150 deposit; 8-seat 521.75 + 15% = 600.01, VAT £120.00, total £720.01.
- A vehicle's deposit is fixed when its quote is sent. A charge added afterwards (waiting, a comfort stop or a second driver) raises the total and the balance only, so seeded CV-A4F6C going from £750.00 to £900.00 keeps its £50.00 deposit and stays `Part of the deposit paid`. A fresh quote from a moved price works out its deposit again from the new total.
- `paymentState` is worked out from money and totals at each read. `depositPaid` means every deposit is paid with a balance still owed, and `paidInFull` means nothing is owed, so a charge added to a fully paid booking returns it to `depositPaid`.
- Saving with a version older than the stored one is refused, and the page keeps what was typed.

**Rate tables.** A table takes effect on a chosen date, today or later, so an edit changes the future only. The table in force on a date is the latest whose date is not after it. A quote sent keeps the rates of its sending day, including its deposits and its run's waiting rate. Two tables with the same date are refused.

**Customer page.**
- A quote is valid until the end of the fifth calendar day after sending, in UK time: sent Wed 24 Mar 2027 at 16:10, it is valid until Mon 29 Mar 2027 and ends at 2027-03-29T22:59:59Z across the clock change.
- When `QUOTE_VALID_SECONDS` is set, a quote instead ends that many seconds after sending.
- The server alone decides this at each read and each press. A quote not yet accepted and past its end still answers 200 with the ended line on the page, and pressing `Accept` is refused; `endsAt` itself still counts as valid. The end limits acceptance only: a quote accepted before its end and read after it keeps `state` `accepted`, shows no ended line and offers `I've sent the deposit`.
- A replaced quote's address and an erased customer's page answer their ended status, and an address that never existed answers not found.
- Amounts use Western digits and `£1,157.25` in all three languages. Dates read `Mon 29 Mar 2027` in English, `29.03.2027` in Polish and `29/03/2027` in Urdu.
- Polish counts: `1 osoba`, `2 osoby`, `4 osoby`, `5 osób`, `12 osób`, `21 osób`, `22 osoby`, `112 osób`, `122 osoby`, and `1 pojazd`, `2 pojazdy`, `5 pojazdów`. English: `1 person`, `2 people`, `1 vehicle`, `2 vehicles`. Urdu: `1 فرد`, `2 افراد`, `1 گاڑی`, `2 گاڑیاں`.
- `stage` and the stepper's current step show the last step reached, worked out at each read: `quoteSent` until the page's quote is accepted; then `accepted` while `paymentState` is `nothingPaid` or `depositPartPaid`; `deposit` at `depositPaid`; `balance` at `paidInFull`; and `travel` from the instant of the first departure, whatever has been paid. With the seed, while each departure is still ahead: CV-8T4VX and CV-5N6WZ read `quoteSent`, CV-2P7GB and CV-A4F6C `accepted`, CV-B8H3K `deposit` and CV-C6M9T `balance`.
- `I've sent the deposit` only records that the customer says so; the booking is not paid until the bank statement says so. Unsigned notes, operator names, bought-in prices and the margin reach neither the page nor any response field, mail or PDF the customer can read.

**Statements.**
- Files are UTF-8 with or without a byte order mark, LF or CRLF, with a final line or not, up to 2,000 rows, with the header `Date,Description,Amount,Balance`. Dates are DD/MM/YYYY (03/04/2027 is 3 April 2027). Amounts may be quoted with thousands commas (`"1,157.25"`) and are negative for money out.
- A reference is found anywhere in the description in any case: `CV`, then an optional hyphen or spaces, then five characters of the alphabet with no space inside them, not followed by another letter or digit, in which O reads as zero and I and L as one (`cv 0l1oi` is `CV-01101`).
- In statements, passenger lists and customer sheets a row's number is its line in the file, with the header as line 1, so the first data row is `Row 2` and `Row 12` is the file's twelfth line. The `row` fields in `refused`, the other preview lists and `reviewList` use the same numbers. Row limits exclude the header: 2,000 data rows are taken and 2,001 are refused, and likewise 500 and 501 in a passenger list.
- Nothing is stored until `Bring in`, which brings in the matched rows only. A row already seen has the same date, amount, description and balance. Two identical rows with different balances are two payments, and bringing the same file twice changes nothing.

**Allocation.** Money goes to a booking's vehicles in order of departure, then list order, first to deposits and then to balances, to the penny, and what is left over stays as credit. Worked example: vehicle one departs first, total £1,157.25, deposit £150.00; vehicle two total £720.01, deposit £50.00. A row of £175.00 gives £150.00 and £25.00 to the deposits. A row of £100.00 gives £25.00 to vehicle two's deposit and £75.00 to vehicle one's balance. A row of £1,614.66 gives £932.25 and £670.01 to the balances and leaves `Credit £12.40`.

**Ledger.**
- Every movement writes two ledger lines in one transaction, and each booking's lines always sum to zero. Corrections are new movements, never edits.
- Money in is plus on `clientMoney` and minus on `hireIncome`, one movement per vehicle part and one for any credit.
- A charge accepted, or a second driver added, is plus on `operatorOwed` and minus on `hireIncome`.
- A refund falling due is plus on `hireIncome` and minus on `refundsDue`.
- A refund paid is minus on `clientMoney` and plus on `refundsDue`.
- `Money held` is always the sum of the desk's `clientMoney` lines, whatever has happened.

**Balance and reminders.** The balance is due 7 days before departure in UK dates; a booking made inside those 7 days owes everything at once and gets no reminder. One reminder mail goes at the first daily check from 10 days before departure, in UK dates, while a balance is owed and more than 7 days remain: never twice, none at 11 days or more, none at 7 or fewer, none to a booking already paid.

**Downloads.** The passenger file's header is `Name,Group,Needs,Vehicle,Seat`, with one row per person shown in the list, in list order, `Vehicle` being the vehicle's seats and `Vehicle` and `Seat` empty for someone unseated. The payment file's header is `Date,Reference,Customer,Vehicle,Account,Amount,Description`, with one row per ledger line, both lines of every movement, oldest first, so a movement's minus line gives a negative `Amount` cell. `Date` is `YYYY-MM-DD` on the UK date, `Vehicle` is the vehicle's seats, `Account` is the shown name, and `Description` is the statement row's description, or `Charge accepted`, `Second driver`, `Refund due` or `Refund paid`. The desk's file holds every hire and a hire's file only its own. In passenger and payment files any cell beginning with =, +, - or @ starts with a straight apostrophe, negative amounts included. Files are UTF-8 with a byte order mark, named after the customer (`<customer name> passengers.csv`, `<customer name> payments.csv`, or `payments.csv` for the desk's whole file), and a name with Polish letters reaches the browser by `filename*`.

**Diary.**
- A run is one vehicle's duty on a hire, numbered per desk from 1, with one driver.
- A week holding a clock change shows it: Sun 28 Mar 2027 has 23 hours and Sun 31 Oct 2027 has 25.
- A hire stored as a local wall time keeps that wall time when its date is moved across a change: 08:00 on Sat 27 Mar 2027 is 08:00Z and 08:00 on Sun 28 Mar 2027 is 07:00Z. A move landing in a missing hour is refused, and one landing in a repeated hour takes the first.
- A move whose duty would overlap the same driver's other run is refused, naming that run and its start. A run's duty is its blocks' span, or 60 minutes from departure with no blocks. Drivers are the same when their folded telephones match.

**Drivers' hours.**
- Rules are in real elapsed minutes, never wall-clock subtraction: at most 270 minutes of driving before a break of at least 45 minutes. A break may be split as 15 then 30 in that order, and 30 then 15 does not clear.
- At most 540 minutes of driving in a day (the UK date its duty starts), or 600 on no more than two days of one driver in a Monday-to-Sunday week. At most 780 minutes from the start of duty to its end.
- `drivingMinutes` and `spreadMinutes` read the asked run's own blocks, and `drivingBeforeBreak` and `spread` judge that run alone. `dailyDriving` adds up the driving of every run on the desk with the same driver (folded telephone) whose duty starts on that UK date. A run with no driver counts alone.
- `atMinute` is the first elapsed minute of the asked run's duty over a limit. A day's driving breaches at its 601st minute, and a third or later day over 540 in a Monday-to-Sunday week, taken in date order, breaches at its 541st driving minute. The `dailyDriving` breach is reported only on the run holding that minute.
- Worked example across two runs: one driver has 570 minutes of driving on each of Tuesday, Wednesday and Thursday. Thursday is Run A, drive 270, then Run B, drive 270, break 45, drive 30. Tuesday and Wednesday have no breach, each run's `drivingMinutes` reads its own total (270 and 300 on Thursday), and Run B reports `dailyDriving` at `atMinute` 316, because the day's 541st driving minute is Run B's 271st.
- Worked examples: 270 minutes then a 45-minute break is fine, and 271 is a breach at minute 271. A run starting at 11:00 with 271 minutes of driving shows its band from 15:31. 22:00 Sat 27 Mar 2027 plus 270 minutes is 03:30 BST on Sun 28 Mar. 22:00 Sat 30 Oct 2027 plus 270 minutes is 01:30 GMT on Sun 31 Oct. Duty 19:00 Sat 30 Oct to 07:00 Sun 31 Oct 2027 is exactly 780 minutes and is fine, while 19:00 to 07:15 is a breach although the wall clock shows 12 hours 15. Duty 19:00 Sat 27 Mar to 07:00 Sun 28 Mar 2027 is 660 minutes.
- `Add second driver` adds the rate table's charge to that vehicle's total once, by paired lines, and with it that run's `breaches` is empty and its driving no longer counts towards its driver's day or week.
- The ribbon draws exactly 1 CSS pixel per real minute. Its ruler (`data-part="ruler-mark"`) is real time: the October change day prints `01:00` twice and the March change day has no `01:xx`.

**Passengers and seats.**
- A list is UTF-8, comma or semicolon as decided by the header row, up to 500 rows, with the columns `Name`, `Group`, `Needs` in any order and any case, or names are typed. A name with no group is fine. Rows the same in folded form are shown once and marked. A `Needs` of `Wheelchair` in any case marks a wheelchair user.
- Each new name takes the next empty seat, wheelchair users `2A` then `2B`.
- Seats: rows of 2 + 2 with an aisle (`1A 1B 1C 1D`), and whatever is left makes the last row, so the 49 is 12 rows and one seat (`13A`). The 8-seat has rows of 2 + 1 (`1A 1B 1C`), so it ends with `3A 3B`.
- Wheelchair users take only `2A` and `2B`, the seats beside the lift on the 16 and the 49.
- On a school hire a person whose `Group` is `Adult` is an adult and everyone else a pupil. One adult is needed per 15 pupils or part of 15, so 47 pupils with 1 adult are 3 short.
- A per-head split divides a vehicle's total to the penny among those seated on it with the earlier names taking the extra pennies: £1,157.25 across 47 people is 11 at £24.63 and 36 at £24.62. Splits and the plan print to A4 and to PDF.

**Run sheet.**
- Time counts from when the press was made on the phone, sent as `secondsAgo`, and the server works out the instant.
- Waiting runs from `Arrived` to `Boarded`, in whole minutes rounded down: 15 minutes free at each stop, then the hour rate (£20.00 by default) pro rata per minute, half up per stop. 16 minutes cost £0.33, 19 cost £1.33, 37 cost £7.33.
- An airport pick-up (a stop with a flight code) allows 60 free minutes from the flight's real landing, or from the booked pick-up (the run's departure) until `actualArrival` is given. The flight is read at the first press at that stop and at most once per 5 minutes after that, on later presses. Landing 14:05 and boarding 15:27 is 82 minutes and costs £7.33. With the flight API failing the flight line shows and waiting counts from the booked pick-up.
- A comfort stop, from `Comfort stop` to `Back on the road`, over 15 minutes is charged for the excess the same way.
- Charges reach the booking only after `Accept charges`, which adds them to that vehicle's total once and lands them on the balance by paired lines.

**Changes and cancellations.**
- A change to an accepted booking shows old and new side by side. If the price moves the customer gets a fresh private page by mail, the old address has then ended, and the fresh page opens for acceptance with its own five-day end while runs and payments stay.
- Money paid above the charge becomes refunds due, money short becomes owed, and each line is per vehicle.
- A cancellation by the arranger returns exactly what was paid.
- Written notice from the customer is typed in UK time. Days = departure date minus notice date, both UK calendar dates, never UTC dates and never 24-hour blocks. 30 days or more: the deposit only; 15 to 29: 25% of the vehicle's total; 8 to 14: 50%; 7 or fewer: all of it. Half up to the penny; the charge is never below the deposit and never above the vehicle's total.
- A departure already gone at the moment of the request cannot be cancelled.
- Worked examples: notice at 00:30 on Wed 14 Apr 2027 for departure on Thu 13 May 2027 is 29 days, so 25%; for Fri 14 May it is 30, so the deposit only; 28 Apr from 14 Apr is 14 days, 50%; 21 Apr from 14 Apr is 7 days, all of it; £1,157.25 at 25% is £289.31 and at 50% is £578.63; a £320.00 coach at 25% is £80.00, below its £100 deposit, so £100.00.
- A cancellation ends the run sheet. A cancelled booking's customer page stays readable, answering 200 with its cancelled line and no ended line, and offers neither `Accept` nor `I've sent the deposit`, whatever its `state`.

**Documents.**
- A document being made appears in `GET /api/documents` from the moment the request starts: `state` is `waiting`, becomes `rendering` when its HTML goes to Gotenberg and `stored` once MinIO has confirmed, with `number` null until then. If either provider fails the row is removed before the 503 answers, so nothing remains and no later read shows it. `Download` shows only at `stored`.
- Numbers have no gaps, per desk, by UK calendar year (`INV-2027-0001`, `CN-2027-0001`). A number is taken only once the PDF is stored, so a failed render burns no number, and two issued at the same moment take two consecutive numbers. Each request issues one document.
- An issued invoice never changes and its history lists who did what and when in order. Polish names keep their letters in the PDF.
- Downloads at `GET /api/documents/<id>/file` are limited to 5 per desk per `FILE_RATE_WINDOW_SECONDS` (default 3600). The sixth is refused with `Retry-After` and that moment's UK time with its minute rounded up.

**Complaints.** Complaints owe a reply within 3 working days in England and Wales. A complaint received at or after 17:00 or on a non-working day counts from the next working day. Weekends and the list's holidays are non-working. Worked examples: Thu 25 Mar 2027 at 10:00 owes Thu 1 Apr 2027, because of Good Friday and Easter Monday; Thu 25 Mar at 17:30 owes Fri 2 Apr; Wed 24 Mar at 16:59 owes Wed 31 Mar. Holidays are read per desk at most once per `HOLIDAY_CACHE_SECONDS` (default 86400), a failed read not counting. With it failing the last good list is used, and with none the weekends-only line shows and `holidayLine` carries it.

**Lost property.** An item is held for one calendar month and then shows its past-holding mark from the day after `heldTo`: found 31 Jan 2027 is held to 28 Feb 2027, 31 Mar to 30 Apr, 31 Jan 2028 to 29 Feb 2028, 30 Apr to 30 May. A return costs £5.00 and is answered only after the owner's stated details are recorded.

**Closing a customer.** States are active, closed, Erasing and erased. For the wait (`CLOSURE_WAIT_SECONDS`, default 604800) a closed customer can be brought back exactly as it was, with every relationship. While closed it leaves the default list and enquiry lists and search. After the wait it reads Erasing, and a worker running every 2 seconds erases, asking MinIO first even when the customer has no files. It removes the name, contact details, passenger lists, stored files and page addresses: the MinIO objects are gone and the private pages have ended. Invoices remain as records under `Erased customer`, numbers stay taken and the ledger's sums stay intact. With MinIO down an erasure stays Erasing and never claims to be done.

**Old customer sheet.** The header is `Name,Email,Telephone,Notes`. Rows match by email or telephone in folded form. A row matching no customer adds one, a row matching one fills only that customer's empty fields, and a row matching two changes nothing and goes to the review list. Bringing the same sheet in again adds nothing.

**Sessions.** A session ends after `SESSION_SECONDS` from sign-in (default 43200), on sign-out, or on a password change made in another session. The server alone decides that. A request for a desk screen's address with no session or an ended one answers 303 to `/sign-in?return=<path>`, where `<path>` is that address's path and query percent-encoded, for example `/sign-in?return=%2Fenquiries%3Fstate%3Dnew`. `Sign in again` opens the same form of address for the screen it shows on. After sign-in a `return` value is followed only if it decodes to a same-origin relative path (one leading `/`, not `//`), and otherwise sign-in goes to `/enquiries`.

### Services (DP-10, DP-15, DP-16, DP-17, DP-22, DP-34, DP-43, DP-45, DP-49, DP-52, DP-53, DP-60)

**Postgres** holds every desk's data, with paired ledger lines and gapless numbers written in one transaction. Apply the schema and seed idempotently on serve.

**MinIO** keeps uploads and PDFs byte for byte. Object keys: `desks/<desk id>/operators/<operator id>/<kind>/<paper id>`, `desks/<desk id>/passengers/<hire id>/<list id>.csv`, `desks/<desk id>/documents/<document id>.pdf`. A file reads as kept only after MinIO confirms. With MinIO down the action answers 503 with the file-store copy and nothing half-written.

**Mailpit** receives SMTP at `SMTP_HOST:SMTP_PORT`, from `MAIL_FROM`. Links use `APP_PUBLIC_URL`. These are the only mails:

| To | Subject | Holds |
|---|---|---|
| each asked operator | `Price request <reference>` | route, dates, vehicles, party size, the private bid address; nothing else about the hire |
| each losing operator after award | `Hire <reference> has closed` | that line only |
| customer, on quote send and on a moved price | `Your quote <reference>`, in the customer's language by the strings table | total, valid-until date, private quote address |
| desk's own email, per paper | `<paper> for <operator> ends on <date>` | that line |
| customer, balance reminder | `Balance reminder <reference>` | amount owed, due date, reference to quote |

Customer mail holds no bought-in price, margin, operator name or unsigned note. Operator mail holds no customer name or contact, other operator or margin. Daily mail is decided by `DAILY_RUN_AT`: `09:00` by default (the check runs at 09:00 UK time), and `any` runs the same check every 2 seconds, whatever the hour.

**Gotenberg** renders every PDF (quote, confirmation letter, invoice, credit note, seat plan) from HTML the app sends to `POST $GOTENBERG_URL/forms/chromium/convert/html`, as an `index.html` file. Gotenberg never calls the app. With it down the action answers 503 with the PDF-service copy and nothing is kept.

**ntfy** carries the driver's push: publish to `$NTFY_URL/driver-<telephone digits>` (folded telephone) with the app's credentials, title `Run <number>`. Message on telling: `Run <number>: <time> <date>, <first stop's text before its first comma>.`, for example `Run 4: 08:00 Fri 14 May 2027, Coventry station.` Message on a later change to the run's departure or stops, published once per change: `Run <number> changed: <time> <date>, <first stop>.`, for example `Run 4 changed: 09:15 Fri 14 May 2027, Coventry station.` `toldAt` is set only after ntfy accepts. With ntfy down the action answers 503 with the published copy and `Tell driver again` shows. One message per press, never a second for one press.

**WireMock.** All five third-party APIs below are invented, as is all their data. The app's server calls them at `$WIREMOCK_URL`, never the browser, and any call waits at most 5 seconds. The baseline answers these:

- **Address lookup.** `GET /v1/find?q=<text>` answers `{"suggestions":[{"id":"ad-101","text":"Coventry station, Coventry CV1 2GT"}]}` with at most six. Baseline for any `q`: `ad-101` Coventry station, `ad-102` NEC, `ad-103` Solihull station, `ad-104` Birmingham Airport, `ad-105` Rugby station, `ad-106` Nuneaton station. `GET /v1/get/<id>` answers `{"line1":"Coventry station","town":"Coventry","postcode":"cv12gt"}`; the others are NEC, Birmingham, `B40 1NT`; Solihull station, Solihull, `b91 3rq`; Birmingham Airport, Birmingham, `B26 3QJ`; Rugby station, Rugby, `cv21 3la`; Nuneaton station, Nuneaton, `CV114BU`.
- **Routing.** `POST /v1/route` with `{"vehicleClass":"coach","stops":[{"text":"<the address as shown>"}]}`, `vehicleClass` being `coach` or `minibus`, answers `{"legs":[{"km":"32.2","minutes":38}]}`, one leg per pair of stops in the baseline. `km` is a decimal string.
- **Flight status.** `GET /v1/flights/<code>?date=<YYYY-MM-DD>` answers `{"scheduledArrival":"2027-05-14T13:45:00Z","actualArrival":"2027-05-14T13:05:00Z","status":"landed"}` for baseline code `WT123`. `actualArrival` may be null. The date is the run's UK departure date.
- **Bank holidays.** `GET /bank-holidays.json` answers `{"england-and-wales":{"division":"england-and-wales","events":[{"title","date","notes","bunting"}]}}`. Baseline dates: 2027-01-01, 2027-03-26, 2027-03-29, 2027-05-03, 2027-05-31, 2027-08-30, 2027-12-27, 2027-12-28.
- **Operator directory.** `GET /v2/operators?cursor=<c>` (no cursor for the first page) answers `{"operators":[...],"nextCursor":"p2"}`, then `p3`, then null, in pages of 10, 10 and 4. The rows, in order, are byte-equal in the baseline:

```json
[{"id":"OP-1001","name":"Hanley Motor Services","town":"Coventry","email":"desk@op-1001.example","telephone":"01632 960200","sizes":[16,49,70]},
{"id":"OP-1002","name":"Arden Vale Coaches","town":"Solihull","email":"desk@op-1002.example","telephone":"01632 960201","sizes":[31,49]},
{"id":"OP-1003","name":"Nuneaton Road Travel","town":"Nuneaton","email":"desk@op-1003.example","telephone":"01632 960202","sizes":[8,12,16]},
{"id":"OP-1004","name":"Rugby Town Minibuses","town":"Rugby","email":"desk@op-1004.example","telephone":"01632 960203","sizes":[8,12]},
{"id":"OP-1005","name":"Leam Valley Executive Travel","town":"Leamington Spa","email":"desk@op-1005.example","telephone":"01632 960204","sizes":[49,56]},
{"id":"OP-1006","name":"Tame Bridge Coachworks","town":"Tamworth","email":"desk@op-1006.example","telephone":"01632 960205","sizes":[31,49,70]},
{"id":"OP-1007","name":"Walsall Lock Coaches","town":"Walsall","email":"desk@op-1007.example","telephone":"01632 960206","sizes":[16,49]},
{"id":"OP-1008","name":"Dudley Castle Travel","town":"Dudley","email":"desk@op-1008.example","telephone":"01632 960207","sizes":[12,16,31]},
{"id":"OP-1009","name":"Redditch Needle Coaches","town":"Redditch","email":"desk@op-1009.example","telephone":"01632 960208","sizes":[49,56,70]},
{"id":"OP-1010","name":"Stafford Shire Passenger Services","town":"Stafford","email":"desk@op-1010.example","telephone":"01632 960209","sizes":[31,56]},
{"id":"OP-1011","name":"Hinckley Boot Travel","town":"Hinckley","email":"desk@op-1011.example","telephone":"01632 960210","sizes":[8,16]},
{"id":"OP-1012","name":"Kenilworth Keep Coaches","town":"Kenilworth","email":"desk@op-1012.example","telephone":"01632 960211","sizes":[49,70]},
{"id":"OP-1013","name":"Warwick Bear Minibuses","town":"Warwick","email":"desk@op-1013.example","telephone":"01632 960212","sizes":[8,12,16]},
{"id":"OP-1014","name":"Lichfield Spire Coaches","town":"Lichfield","email":"desk@op-1014.example","telephone":"01632 960213","sizes":[31,49]},
{"id":"OP-1015","name":"Telford Gorge Travel","town":"Telford","email":"desk@op-1015.example","telephone":"01632 960214","sizes":[16,49,56]},
{"id":"OP-1016","name":"Worcester Sauce Bottle Tours","town":"Worcester","email":"desk@op-1016.example","telephone":"01632 960215","sizes":[12,31]},
{"id":"OP-1017","name":"Burton Brewery Coaches","town":"Burton upon Trent","email":"desk@op-1017.example","telephone":"01632 960216","sizes":[49,70]},
{"id":"OP-1018","name":"Stourbridge Glass Travel","town":"Stourbridge","email":"desk@op-1018.example","telephone":"01632 960217","sizes":[8,12]},
{"id":"OP-1019","name":"Sutton Park Coachlines","town":"Sutton Coldfield","email":"desk@op-1019.example","telephone":"01632 960218","sizes":[31,49,56]},
{"id":"OP-1020","name":"Bromsgrove Nail Works Minibuses","town":"Bromsgrove","email":"desk@op-1020.example","telephone":"01632 960219","sizes":[16]},
{"id":"OP-1021","name":"Atherstone Ball Game Coaches","town":"Atherstone","email":"desk@op-1021.example","telephone":"01632 960220","sizes":[49]},
{"id":"OP-1022","name":"Daventry Mast Travel","town":"Daventry","email":"desk@op-1022.example","telephone":"01632 960221","sizes":[12,31]},
{"id":"OP-1023","name":"Kidderminster Carpet Coaches","town":"Kidderminster","email":"desk@op-1023.example","telephone":"01632 960222","sizes":[16,49]},
{"id":"OP-1024","name":"Hereford Cider Mill Travel","town":"Hereford","email":"desk@op-1024.example","telephone":"01632 960223","sizes":[56,70]}]
```

### Seed data (DP-57)

Every seeded person and business is invented. Addresses are invented or public transport hubs, every email ends `.example`, and every telephone number is in the range 01632 960000 to 01632 960999. The seed is applied once per database on first serve, sends no mail and calls no provider except as stated.

Dates in the seed are relative. `B` is the UK date of first boot. `C` is the UK date of the next clock change after `B` (the last Sunday of March or October).

**Arrangers.**
- Maria Whitcombe, `maria@merrowfield.example`, password `Merrowfield-Desk-2027`, desk name `Merrowfield Coach Hire`.
- Tomasz Zieliński, `tomasz@zielinski-hire.example`, password `Zielinski-Desk-2027`, desk name `Zieliński Hire`. Tomasz's desk holds one customer, Halina Nowak (`CU-2001`, `halina@nowak.example`, `01632 960180`, `pl`), one New enquiry `CV-T0MA5`, and no operators.

**Customers on Maria's desk.**

| Id | Name | Email | Telephone | Language |
|---|---|---|---|---|
| CU-1001 | CHELMSLEYWOODANDKINGSHURSTUNITEDFEDERATIONOFPRIMARYSCHOOLSTRUSTS | `office@chelmsleywood-federation.example` | 01632 960101 | en |
| CU-1002 | Agnieszka Wiśniewska | `agnieszka@wisniewska.example` | 01632 960102 | pl |
| CU-1003 | شازیہ ملک | `shazia@malik.example` | 01632 960103 | ur |
| CU-1004 | Jack O'Rourke | `jack@orourke.example` | 01632 960155 | en |
| CU-1005 | Foleshill Tool Makers | `office@foleshill-tools.example` | 01632 960105 | en |
| CU-1006 | Stoke Aldermoor Bowls Club | `secretary@aldermoor-bowls.example` | 01632 960106 | en |

**Operators on Maria's desk.** All 24 directory rows, listed. The first twelve have `Operator licence` and `Public liability cover` ending 2028-12-31, with no file yet (`stored: false`), and a `Driver DBS check` dated 2026-01-15, except that OP-1012's `Public liability cover` ends 2027-06-30. The other twelve have none.

**Enquiries and hires on Maria's desk, newest first.** All have the stops `Coventry station, Coventry CV1 2GT` and `NEC, Birmingham B40 1NT`, no return, no bags and 47 people unless stated.

| Reference | Customer | Occasion | State | Departure | Vehicle, operator, bought, margin | Total, deposit | Quote or payment |
|---|---|---|---|---|---|---|---|
| CV-7K2M4 | CU-1004 | company | New | B+60, 08:00 | none | | |
| CV-D2Q5Y | CU-1001 | school | New | B+70, 09:00 | none | | |
| CV-3H9QR | CU-1001 | school | Priced | B+45, 08:30 | 49; open bids OP-1001 `1006.30`, OP-1002 `1040.00`, both asked at first boot | | |
| CV-8T4VX | CU-1002 | weddings | Quoted | B+50, 13:00 | 49, OP-1002, 869.57, 15 | £1,000.01, £150.00 | quote sent at first boot, open |
| CV-5N6WZ | CU-1003 | weddings | Quoted | B+40, 12:00 | 8 (8 people), OP-1003, 521.75, 15 | £720.01, £50.00 | sent B−10, past its end (answers 200) |
| CV-9D3JS | CU-1006 | festivals | Lost | B+30, 10:00 | none | | |
| CV-2P7GB | CU-1005 | company | Won | C−1, 08:00 | 49, OP-1001, 1006.30, 15 | £1,157.25, £150.00 | Nothing paid |
| CV-A4F6C | CU-1006 | festivals | Won | C, 08:00 | 12 (12 people), OP-1004, 652.17, 15 | £750.00, £50.00 | Part of the deposit paid, £25.00 |
| CV-B8H3K | CU-1001 | school | Won | C+7, 09:15 | 49, OP-1005, 869.56, 15 | £999.99, £100.00 | Deposit paid, £100.00 |
| CV-C6M9T | CU-1002 | weddings | Won | C−8, 07:30 | 8 (8 people), OP-1003, 521.75, 15 | £720.01, £50.00 | Paid in full, £720.01 |

**Runs.**

| Run | Id | Hire | Driver | Blocks from its departure |
|---|---|---|---|---|
| 1 | RN-1001 | CV-2P7GB | Ewan Price, 01632 960301 | drive 270, break 45, drive 120 |
| 2 | RN-1002 | CV-A4F6C | Marek Zając, 01632 960302 | drive 271, break 45, drive 60 (breach) |
| 3 | RN-1003 | CV-B8H3K | Ewan Price, 01632 960301 | drive 120 |
| 4 | RN-1004 | CV-C6M9T | Marek Zając, 01632 960302 | drive 120 |

`toldAt` is null on all, and the next run on Maria's desk is 5.

**Seat plan.** CV-B8H3K's 49 holds five typed names in this order: `Agnieszka Wiśniewska` (`Adult`, 12A), `Jack O'Rourke` (`Adult`, 3C), `Maja Kowalska` (`Year 5`, 1A), `Ibrahim Malik` (`Year 5`, 1B), `Tom Bennett` (`Year 5`, 1C).

**Ledger on Maria's desk.** `Money held` is £845.01: CV-A4F6C 25.00; CV-B8H3K 100.00; CV-C6M9T 50.00 and 670.01; each a movement of plus on `clientMoney` and minus on `hireIncome`.

**Invoice.** One issued invoice for CV-C6M9T, numbered `INV-<UK year of B>-0001`, so `nextInvoice` is the same year's `0002` and `nextCreditNote` that year's `CN-<year>-0001`. Its record is written at seed, and its PDF is rendered and stored once both Gotenberg and MinIO answer, retrying every few seconds and taking no further number. Until then its strip stands at `Waiting`.

**Default rate table.** Effective 2000-01-01 on every desk: margin 15, waiting rate 20.00, second-driver charge 150.00, deposits 50.00, 100.00, 100.00, 150.00. No complaints, found items or passenger files are seeded.

## Technical requirements

### Deployment (DP-60)

Backend: TypeScript on Node 22. Frontend: TypeScript built with Node 22.

`/app/run.json` holds string `install`, `build`, `serve` and `"_schema":"run-manifest-v1"`, for example:

```json
{"_schema":"run-manifest-v1","install":"npm ci","build":"npm run build","serve":"npm run serve"}
```

The server binds `0.0.0.0` on port 4173, honouring `APP_PUBLIC_PORT`. `GET /api/health` returns HTTP 200 JSON `{"status":"ok"}`. Schema and seed apply idempotently on serve, not only at build.

### Configuration and secrets (DP-08, DP-21, DP-28, DP-34, DP-50, DP-52, DP-53, DP-55, DP-60)

Read at start, never hard-coded or sent to the browser: `DATABASE_URL`; `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_FORCE_PATH_STYLE`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`; `SMTP_HOST`, `SMTP_PORT`, `MAIL_FROM`; `WIREMOCK_URL`; `GOTENBERG_URL`; `NTFY_URL`, `NTFY_USERNAME`, `NTFY_PASSWORD`; `APP_PUBLIC_PORT`, `APP_PUBLIC_URL`.

Settings with defaults:
- `PUBLIC_DESK_EMAIL` (`maria@merrowfield.example`)
- `ENQUIRY_RATE_WINDOW_SECONDS` (3600)
- `BID_WINDOW_SECONDS` (172800)
- `QUOTE_VALID_SECONDS` (unset: the fifth-day rule)
- `FILE_RATE_WINDOW_SECONDS` (3600)
- `CLOSURE_WAIT_SECONDS` (604800)
- `HOLIDAY_CACHE_SECONDS` (86400)
- `DAILY_RUN_AT` (`09:00`, or `any`)
- `SESSION_SECONDS` (43200)

The same build also serves as copies with these settings, each booting with the seed and owning its database and bucket, created empty for it. Mailpit and ntfy are shared, so mail and pushes are read by recipient.
- **MinIO down:** `${DATABASE_URL}_storage`, `${S3_BUCKET}-storage`, `CLOSURE_WAIT_SECONDS=5`.
- **Gotenberg down:** `${DATABASE_URL}_render`, `${S3_BUCKET}-render`.
- **ntfy down:** `${DATABASE_URL}_push`, `${S3_BUCKET}-push`.
- **Short timers:** `${DATABASE_URL}_short`, `${S3_BUCKET}-short`, `ENQUIRY_RATE_WINDOW_SECONDS=30`, `BID_WINDOW_SECONDS=20`, `QUOTE_VALID_SECONDS=20`, `FILE_RATE_WINDOW_SECONDS=30`, `CLOSURE_WAIT_SECONDS=20`, `HOLIDAY_CACHE_SECONDS=5`, `DAILY_RUN_AT=any`.
- **Short session:** `${DATABASE_URL}_session`, `${S3_BUCKET}-session`, `SESSION_SECONDS=20`.

### Server boundary (DP-02, DP-20, DP-29, DP-55, DP-56, DP-60)

- The app is same-origin only and served over plain http.
- The session cookie is HttpOnly, SameSite=Lax, never Secure and a browser-session cookie (no Max-Age or Expires).
- A state-changing request with a foreign `Origin` is refused; one with no `Origin` passes.
- An address that does not exist answers a server 404 page with its own heading, never the app shell with 200. An unknown `/api` route answers the JSON error body. Only the published endpoints and pages exist, with no debug or test routes; the app's own built files, fonts and service worker script are files and not pages.
- The server never serves source files, credentials or the raw contents of its environment. Third-party calls are made by the server, never the browser. No provider is reached from the browser.
- Only Postgres is needed to boot. With MinIO, Gotenberg, ntfy, SMTP or WireMock unreachable at boot, the app starts, answers health and gives each action its published outage answer.

### Browser support and performance (DP-55, DP-58)

Current Chromium, Firefox and WebKit at 320x568, 375x812, 768x1024, 812x375 and 1280x800. Public pages show their text on the first response. Desk screens are usable within three seconds on the seeded data. Refusals for over-long search text and over-deep JSON come within a second.

## Working rules

- **IF-01** `/app/run.json` holds string `install`, `build` and `serve` and `"_schema":"run-manifest-v1"`, and is the only way the app is installed, built and served.
- **IF-02** `THIRD_PARTY_NOTICES.md` at `/app` names every shipped package and font with its licence, where shipped packages means the production dependency tree (`npm ls --omit=dev --all --json`).
- **IF-03** Shipped packages (the production dependency tree, `npm ls --omit=dev --all --json`) carry only MIT, MIT-0, ISC, BSD-2-Clause, BSD-3-Clause, Apache-2.0, MPL-2.0, 0BSD, BlueOak-1.0.0 or CC0-1.0 licences, and a font or font package only OFL-1.1.
- **IF-04** The only datastores are Postgres and MinIO; no Valkey, SQLite, file-based database or other store is added on the server.
- **IF-05** Fonts, icons and drawings are self-hosted or generated by the project; no page loads anything from another origin.
- **IF-06** No image, icon, text or code is taken from any reference site; all imagery is generated SVG or uploaded by users.
- **IF-07** Credentials are read from the environment; none is committed, and the compose or service configuration provided is left untouched.

## Engineering standards

- The code is idiomatic strict TypeScript, with no `any` in domain code.
- Names match this brief's domain terms: enquiry, hire, run, bid, ledger line, rate table, duty ribbon, Journey ticket.
- Each domain rule (a state change, half-up money, a deposit limit, a UK-date count, a breach, an allocation) is decided in exactly one place in the source and used from there.
- Money is computed in exact pennies or decimals, never binary floating point.
- No abstraction has a single implementation unless a provider boundary needs it, and nothing request-specific lives in module or process scope.
- There is no dead, commented-out or unreachable code, and no defensive checks for impossible states.
- Every API error passes through the one published error shape and the one ladder.
- No feature, route or setting goes beyond this brief.
