# Kestrel Row Holdfast Register

Holdfast Register is the equity register of one venture-backed robotics startup, Tidecraft Robotics. Each person who holds Tidecraft equity uses it to follow their own part of the register. Option holders follow their grants, vesting, offers and exercises. Leavers watch their exercise window. Investors see their holdings and take part in tender offers. Board members approve grants. The founder admin keeps the cap table, securities ledger, option pool, valuations, grants, tender offers and round scenarios up to date. The app uses three backends. PostgreSQL is the register of record. A MinIO bucket is the document vault, where signed agreements, exercise notices and tender NDAs are sealed. A WireMock-served payment provider, Quillon Pay, collects exercise money. The following are out of scope: other companies, self-registration, email or push notifications (every notice stays inside the app), tax calculations, real money movement beyond the provider's records, and any datastore or service beyond these three. People exist only as seeded records or as people the founder admin adds.

## Problem and users

At an early startup, the people who hold equity mostly learn what they own from a PDF and a spreadsheet the founder keeps by hand. An engineer with 48,000 options cannot easily answer the questions that cost them money:
- How many options have vested today?
- My vesting started on the 31st, so what happens in February?
- When does the grant offer waiting for me lapse?
- I resigned, so how many days do I have left to exercise before the rest are cancelled?

Most terminated grants have a 90-day post-termination window, and one miscount loses the options for good.

Tender offers cause the same confusion. When an offer is oversubscribed, each seller's tender is scaled down pro rata. The whole-share rounding is done by hand, so two sellers can each believe they sold the last lot. Founders pay for this in lawyer hours and lost trust. Employees pay with lapsed grants, missed windows and surprise dilution. The company risks granting below fair value whenever a 409A valuation has quietly lapsed.

Holdfast puts each holder's own register at the centre. Every deadline is decided on the server's date and clock, never on the person's device. Ownership always sums to 100.00. Tender lots are whole shares. Each person sees only their own slice of the register. When the person's role changes, their open screen changes at once.

Users:
- **Option holder**: follows their grants, vested count, cliff and month-end vesting dates (weekly). Accepts or declines an offered grant within its window. Exercises vested options and sees the provider's payment record before the shares appear.
- **Leaver**: a former employee. Watches the server-clock countdown of their exercise window and exercises before it ends. An order received one second before the end still counts.
- **Investor**: sees only their own holdings and fully diluted percentage. Signs the tender NDA and submits shares into an open tender offer before it closes.
- **Founder admin**: keeps the cap table, securities ledger, option pool and valuations current (daily). Issues grants for board approval, sends offers, records departures, opens tender offers and runs round scenarios at a pre-money price.
- **Board member**: approves or declines queued grants toward quorum, working from a summary-only view of the register.

## Journeys

1. **Checking vesting.** Juniper Vance (option holder) is signed out on the sign-in page. They sign in and land on their portal board. The board shows their first name, the vested-today tile and the next-tranche tile. They open Vesting and see the tranche ribbon for grant TC-OPT-0007, with the cliff cell and each monthly cell labelled with its true date (the February cells read 28 Feb, or 29 Feb in 2028). They move the projection marker forward with the arrow keys and watch the vested count, cost and vested ownership change. They press Home, and the marker returns to the server's today. End state: the ribbon shows the server-vested cells in red and the figures for today.
2. **Issuing a grant.** Mara Okafor (founder admin) is on the Grants admin page with no drafts. Using only the keyboard, they start a new grant, pick a holder, type the options and strike, choose the vesting type in the radio group and type the vesting start. They submit the grant to the board. Priya Natarajan and Theo Blackwood (board members) each approve it from the board queue. Mara sends the offer. End state: the grant shows Offered with its expiry time, and the holder's open portal shows the offer within one second.
3. **Accepting an offer.** Kenji Moreau (option holder) has an offered grant. They open it, read the agreement text and accept. End state: the grant shows Accepted, the sealed agreement appears under Documents, and the ribbon shows the new schedule. If the vault is unreachable, the grant instead stays Offered with the signature Pending and a Retry signing button.
4. **Exercising.** Juniper opens the Exercise dialog from the keyboard, types 3,217, sees the cost of $1,346.31 and confirms. End state: the order page shows the provider's record (reference, amount, confirmed time), then the issued shares and the sealed exercise notice. The cap table shows Juniper's issued shares, and the ledger shows the issue.
5. **Leaving.** Rafael Ostrowski (leaver) signs in. Their ribbon carries a black band ending in a countdown of the time left in their exercise window. They exercise part of their vested options before the end. End state: when the window ends, the cells of the unexercised options turn muted and the Exercisable now figure drops to 0. The exercised part stays issued.
6. **Tendering.** Mara opens a tender offer with a share cap and a close time. Larkspur Ventures Fund II (investor) opens it, signs the NDA, types the shares to tender and submits. Larkspur watches the projected allocation, remaining cap and countdown update in place as Brightwater Angels LLC submits. End state: at the close, the page shows the final whole-share allocation and proceeds, and the cap table shows the shares moved to the buyer.
7. **Modelling a round.** Mara opens Round scenario and types a pre-money valuation, a new investment and a target pool. End state: the price per share, pool top-up, new shares and percentages update in place as they type, with no submit button.
8. **Changing access.** Priya, a board member, has the board queue open. Mara changes Priya's role to option holder, and Priya's open screen switches to the option-holder portal. Later, Mara removes Kenji's access while Kenji's document viewer is open. End state: Kenji's viewer closes and their page shows that access has ended.

## Mandatory requirements

This is the complete list of mandatory requirements; every check traces to one of these lines and the detailed sections below.

- **DP-01 — Sign-in and holder portal** A seeded option holder signs in with email and password and lands on the two-by-two portal board, which shows their first name, their vested-today count out of total options and their next tranche date, all from the server.
- **DP-02 — Vesting schedule on the server date** Accepted grants vest in whole options by the published floor rule (a one-year cliff then monthly, or monthly with no cliff), counted on Tidecraft's server date in Pacific time.
- **DP-03 — Month-end tranche dates** A vesting start on the 29th, 30th or 31st vests on the last day of each shorter month, and every tranche date in the API and on the ribbon follows this rule.
- **DP-04 — Tranche ribbon** The grant page draws the whole ribbon on first load: one cliff cell spanning 12 months, then one cell per monthly tranche, each labelled with its true date, with server-vested cells filled red. A tranche that vests while the page is open fills without a reload.
- **DP-05 — Projection marker** A slider moves month by month with the arrow keys, Page Up and Page Down, Home and End. It announces the marker date and shows the server's vested count, cost at strike and vested ownership for that month, while the server's today stays marked.
- **DP-06 — Device clock never decides** With the browser clock or time zone set days away from the server's, every vested count, tranche state, offer status and countdown on screen equals what the API returns.
- **DP-07 — Grant issue journey** The founder admin drafts a grant from the keyboard (holder, options, strike, vesting type radio group, typed start date) and submits it to the board. Two board members approve it, and the founder admin sends the offer.
- **DP-08 — Grant validation** Submitting a grant requires a whole positive number of options within the available pool, a strike at or above the current fair market value and a valid typed vesting start, with field errors as published in the API.
- **DP-09 — Board quorum voting** Each board member votes once each time a grant is in the queue. A majority of approvals moves the grant to Approved and a majority of declines returns it to Draft, exactly once even under simultaneous votes.
- **DP-10 — Offer acceptance journey** An option holder opens an offered grant, reads the agreement and accepts it. They then see the grant Accepted, the sealed agreement under Documents and the grant's schedule on the ribbon.
- **DP-11 — Signed only when sealed in the vault** A grant counts as accepted only after its agreement's bytes are stored in the vault and read back matching, as qualified in Business rules.
- **DP-12 — Decline returns to the board queue** Declining an offered grant returns it to the board queue with its votes cleared and its pool reservation kept.
- **DP-13 — Offer expiry on the server** An offer expires exactly when its offer window ends on the server clock, acceptance at or after that instant is refused, and an open portal shows Expired within one second without a reload.
- **DP-14 — Pending signature recovery** While the vault is unreachable, grant acceptance and NDA signing stay Pending with the outage copy, and they complete on a later retry once the vault answers, with no restart of the app.
- **DP-15 — Exercise journey** An option holder runs the whole exercise flow from the keyboard: they open the exercise dialog, type an amount, confirm, and see the provider's payment record, then the issued shares and the exercise notice.
- **DP-16 — Exact exercise cost** The exercise cost is options times strike, rounded half-up to the cent once on the server, and the same amount appears on the order, the provider's payment record and the exercise notice.
- **DP-17 — Vested-only exercise** An exercise is refused when it asks for more than the grant's exercisable options (vested minus those already exercised, cancelled or in open orders).
- **DP-18 — Idempotent exercise orders** Every exercise carries an idempotency key. Five simultaneous requests with one key create exactly one order and one provider payment, the other four receive the stored response, and a reused key with a different body is refused.
- **DP-19 — Provider-confirmed issuance** Shares are issued only after the server has fetched the provider's payment record and it reads confirmed with the order's amount and reference.
- **DP-20 — Slow and unreachable provider** A provider that accepts the payment but has not confirmed after five seconds leaves the order Pending until it confirms. A provider that is unreachable, or does not answer the payment request within five seconds, leaves the order Held for retry under the same key, and shares are never issued twice.
- **DP-21 — Cancel wins over in-flight confirmation** Cancelling a Pending or Held order always wins. A confirmation that arrives afterwards issues nothing, and the server cancels that payment at the provider.
- **DP-22 — Exercise notice in the vault** Each issued order gets an exercise notice sealed in the vault under its order id, and the notice text carries the order's options, strike and cost.
- **DP-23 — Record a departure** Recording a departure makes the person a leaver, cancels their unvested options at once and opens an exercise window that ends exactly one leaver window after the recorded moment.
- **DP-24 — Leaver countdown journey** A leaver signs in, sees the server-clock countdown on a black band in their ribbon and exercises vested options before the window ends.
- **DP-25 — Exercise window edge** An exercise the server receives one second before the window ends is honoured and completes. One received at or after the end is refused.
- **DP-26 — Cancellation at window end** When the window ends, the server cancels every unexercised option not held in an open order. The leaver's open ribbon mutes the cancelled cells and drops the Exercisable now figure to 0 within one second.
- **DP-27 — Open a tender offer** The founder admin opens one tender at a time, with a title, price per share, share cap and close time, bought by Harbourline Secondary Partners.
- **DP-28 — Tender submission journey** An investor signs the tender NDA, types the shares to tender and submits, then watches their projected allocation and then their final allocation on the tender page.
- **DP-29 — Tender NDA and submission rules** Only investors whose NDA is sealed in the vault may submit, once per tender, up to their issued shares, before the close. They may withdraw while the tender is open.
- **DP-30 — Close and pro rata allocation** At the close time on the server, an oversubscribed tender is allocated pro rata in whole shares, with the leftover shares given one each in submission order. The cap is never exceeded, even under simultaneous submissions, and the shares move on the ledger.
- **DP-31 — Live tender panel** An investor's open tender page updates the projected allocation, remaining cap and countdown in place over the page's one socket, within one second of any submission, withdrawal or close.
- **DP-32 — Cap table to 100.00** The cap table shows each row's fully diluted shares and ownership to two decimals by largest remainder, and the total is exactly 100.00 after every ledger change. The grid is drawn complete on first load, with every row and the Total row.
- **DP-33 — Cap table keyboard grid** The cap table is a grid with a single tab stop, navigated with the arrow keys, Home and End.
- **DP-34 — Focus holds through live redraw** When a live update redraws the cap table, keyboard focus stays on the same row and column.
- **DP-35 — Securities ledger** Every change to a holder's issued shares or outstanding options, and every pool resize, writes one ledger entry per holder affected.
- **DP-36 — Option pool** The option pool shows authorized, outstanding, exercised, reserved and available counts, and a resize below what is already allocated is refused.
- **DP-37 — Round scenario arithmetic** A round scenario at a pre-money valuation computes the pool top-up, price per share, new shares, post-money fully diluted shares and percentages exactly, by the published rounding.
- **DP-38 — Round scenario journey** The founder admin types a pre-money valuation, an investment and a target pool, and sees the result update in place with no submit button.
- **DP-39 — Valuation records** The founder admin records fair market valuations. The current valuation is the latest one in effect on the server date, and each valuation shows Current, Superseded or Lapsed.
- **DP-40 — Lapsed valuation blocks grants** When the current valuation has lapsed on the server date, creating, submitting or offering a grant is refused at once.
- **DP-41 — Own-slice visibility** An option holder or leaver sees only their own grants, orders and documents. An investor sees only their own holdings. A board member sees only the class summary and the queue.
- **DP-42 — Other holders' records are not found** Another person's grant, order or document answers 404 on the API and shows the not-found page in the browser, with none of that person's figures.
- **DP-43 — Role change switches the open screen** A role change applies on the person's next request and switches their open screen to their new role's portal within one second.
- **DP-44 — Access removal closes documents** Removing a person's access ends their sessions, closes their open document viewer within one second and makes all of their vault documents unreachable to them.
- **DP-45 — Document viewer serves vault bytes** Every document is served back byte for byte from its stored vault object, with its seal hash shown.
- **DP-46 — One live socket per page** Each page opens exactly one WebSocket to the server and sends nothing over it, and every open screen of the same data agrees within one second.
- **DP-47 — Replay after a drop** After the socket drops, the page reconnects, replays every event it missed and applies each one once.
- **DP-48 — Polite announcements** A polite status region named Register updates exists from first paint and announces each timed or decided event exactly once, using the published copy.
- **DP-49 — Drafts survive reload, Back and a second tab** Grant drafts and tender drafts are saved on the server within one second of typing, and they reappear after a reload, after Back navigation and in a second tab.
- **DP-50 — Run manifest and health** The app installs, builds and serves from the run manifest on port 4173 (or APP_PUBLIC_PORT) and answers the health check.
- **DP-51 — Configuration from the environment** Every service URL and credential, both window lengths and both warning settings, are read from the environment at start and are never hard-coded or sent to the browser.
- **DP-52 — Server boundary** The server is same-origin only, rejects oversized and non-JSON bodies, and never serves source files or credentials.
- **DP-53 — Boots without the provider or vault** The app starts and serves every screen while the payment provider or the vault is unreachable, showing the outage copy only on the actions that need them.
- **DP-54 — Responsive layouts** At widths of 375, 768 and 1280 pixels, no page scrolls sideways and every control is at least 44 by 44 pixels.
- **DP-55 — Keyboard dialogs** Every dialog keeps Tab and Shift+Tab inside it, closes on Escape and returns focus to the control that opened it.
- **DP-56 — Ribbon and headline motion** The ribbon's cell fills, the counting numerals and the sign-in title reveal each finish within their published durations, and none of them loops.
- **DP-57 — Reduced motion** Under reduced motion, every fill, count and reveal shows its end state at once, with the same values, controls and announcements.
- **DP-58 — Editorial axis composition** Every working screen hangs its headings, figures and table starts from one vertical axis at 42% of the width, with side notes to its left and black bands opening the Exercise and Tender chapters.
- **DP-59 — Masthead sign-in page** The sign-in page shows the photographic mosaic masthead. Its black tile carries the fully diluted count, and the two-line title starts on the axis.
- **DP-60 — Full-colour states and forms** Empty, loading and error states are whole black or red bands with one sentence at display size. Forms hang from the axis as one narrow column. The cap table uses grey row bands and a red 100.00 total.
- **DP-61 — Locked documents and linked corrections** A sealed grant agreement or exercise notice is locked: its vault object never changes. The founder admin corrects it through the API by recording a new linked version, and the original stays readable byte for byte.
- **DP-62 — Nothing sent before the socket is open** While a signed-in page's socket is not open (before it first opens, and from a drop until it is open again), the buttons and selects named under Live socket in Interactions are disabled, so the page sends no change to the server.
- **DP-63 — Round scenario in the address** The round scenario keeps its three typed inputs in the page address, so a reload, Back and a second tab opened at that address show the same inputs and result. At 375 pixels the result is one stacked column with no sideways scroll.
- **DP-64 — Lapse reaches an open grant form** When the current valuation becomes lapsed while a grant form is open, that form disables "Submit to board", shows the lapsed band and announces the lapse once, within one second and without a reload.
- **DP-65 — Board grant summary in the address** A board member opens a queued grant's summary at its own address. A reload shows the same summary, and Back or Escape returns to the queue with focus on that grant's link. A vote cast by another board member updates the open summary within one second.
- **DP-66 — Ribbon follows the marker on a phone** At 375 pixels, each keyboard move of the projection marker scrolls the ribbon track so the marker's cell lies wholly inside the track's visible frame, and the page never scrolls sideways. Under reduced motion the track moves there at once.
- **DP-67 — Cap table sort in the address** Each cap-table column header sorts the rows by that column from the keyboard, shows the order with aria-sort and keeps the sort in the page address, so a reload shows the same order with the Total row last.
- **DP-68 — Offer warning before expiry** When an offer reaches its warning time on the server clock, the holder's open pages show the offer warning and announce it once, without a reload.
- **DP-69 — Leaver window warnings** At each leaver warning time before the window end on the server clock, the leaver's open pages show the window warning and announce it once. At 375 pixels the warning fits the page with no sideways scroll.
- **DP-70 — Tender result under reduced motion** At the close, the seller's open tender page shows their allocation. With motion it counts up to the final figure, and under reduced motion it shows only the final figure.
- **DP-71 — Focus after a role switch** After a live role switch, keyboard focus moves to the new portal's name heading.
- **DP-72 — Draft edited in two tabs** A change saved from one tab's grant form shows in the same draft's form in another tab within one second, and a save based on an outdated draft version is refused with `draft_outdated`.
- **DP-73 — Racing exercises stay within exercisable** Exercise orders with different keys that arrive at the same moment for one grant are checked one after another, so the options they hold together never exceed exercisable, and each order that does not fit is refused with the published field error.
- **DP-74 — Selected holder in the address** On the founder admin's cap table, Enter on a holder row opens that holder's detail and keeps the selection in the page address with the sort, so a reload, Back and a second tab show the same detail with focus on that row.
- **DP-75 — Saved scenarios** The founder admin saves a named round scenario on the server. It appears in every open scenario page's saved list within one second, and opening it from the list by keyboard and coming Back returns focus to its link.
- **DP-76 — Round price against fair market value** The scenario result compares its price per share with the current fair market value, and an open scenario follows a valuation that is recorded or lapses within one second, announcing the new comparison once.
- **DP-77 — Valuation filter in the address** The valuations table is filtered by a status radio group worked with the arrow keys, and the chosen status stays in the page address through a reload, Back and a second tab.
- **DP-78 — Focus after recording a valuation** After a valuation is recorded, keyboard focus moves to the new row of the valuations table, and after a refusal it moves to the first field in error.
- **DP-79 — One accept wins** Two accepts of one offered grant that arrive at the same moment seal one agreement and write one ledger entry, the other answers `grant_not_offered`, and every open page of that grant shows Accepted within one second.
- **DP-80 — Cap table grid follows focus on a phone** At 375 pixels, every keyboard move in the cap table grid scrolls its region so the focused cell lies wholly inside the region's visible frame.
- **DP-81 — Dialog focus survives a live redraw** The focus return of DP-55 also holds after a live update redrew the page while the dialog was open.
- **DP-82 — Outdated draft notice** A refused outdated draft save shows the notice with keyboard focus on it, and Escape or "Keep editing" closes it and returns focus to the field whose save was refused, which now holds the latest version.
- **DP-83 — Document viewer at its own address** A document viewer opened at its own address stays open through a reload, and closing it returns focus to that document's link in the list.
- **DP-84 — Focus after acceptance** When an acceptance completes, directly or after Retry signing, keyboard focus moves to the grant page's Exercise button.

## Frontend

### Screens and layout (DP-01, DP-04, DP-41, DP-42, DP-54, DP-58, DP-59, DP-63, DP-65, DP-67, DP-74, DP-77, DP-83)

Every page is served by the app at its own path. Pages and the roles that can open them:

| Path | Roles | Shows |
|---|---|---|
| `/` signed out | everyone | The sign-in page: masthead mosaic, title, standfirst and sign-in form. |
| `/` signed in | every role | The portal board: a two-by-two set of tiles for the person's role (see Public screens and controls). |
| `/grants/<grant id>` | the grant's holder, founder admin | Grant chapter: grant id and state in the left zone, the agreement text when offered, the tranche ribbon with the projection figures, and the accept, decline and exercise controls. |
| `/exercise` | option holder, leaver | Exercise chapter, opened by a full-bleed black band: the person's orders, newest first, with state and cost. |
| `/exercises/<order id>` | the order's holder, founder admin | Order page: options, strike, cost, state, the provider record and the notice status. |
| `/documents` | every role except board member | The person's documents (founder admin: all), each with kind, title, status and seal. |
| `/documents/<document id>` | the document's owner, founder admin | The documents list with the document viewer dialog open. |
| `/cap-table` | every role | The cap table grid shaped to the role. The founder admin also sees the option pool panel and the ledger link. The address may carry a sort as `?sort=<column key>&dir=<asc or desc>` and a selected holder as `holder=<row key>`. |
| `/tenders` and `/tenders/<tender id>` | investor, founder admin | Tender chapter, opened by a full-bleed black band: terms, countdown, the person's NDA, submission and allocation (founder admin: all submissions). |
| `/board` | board member | Board queue: the grants waiting for a vote, as summary rows. |
| `/board/<grant id>` | board member | Grant summary for one queued grant: holder, options, strike, vesting, approvals and the vote buttons. |
| `/admin/grants` and `/admin/grants/<grant id>` | founder admin | The grants list with state, and the grant form for drafts. |
| `/admin/valuations` | founder admin | The valuations table and the record-valuation form. The address may carry the filter as `?status=<all, current, superseded or lapsed>`. |
| `/admin/ledger` | founder admin | The securities ledger table. |
| `/admin/tenders` | founder admin | Tender list and the open-tender form. |
| `/admin/scenario` | founder admin | The round scenario form and result. The address may carry the inputs as `?pre=<text>&investment=<text>&pool=<text>`. |
| `/admin/people` | founder admin | The people table with role, access and departure controls. |

Any path whose record the signed-in person may not see, any record that does not exist, and any page their role cannot open all show the same not-found page: a black band with the heading from Public screens and controls and no figures from the record. A signed-out visit to any path except `/` shows the sign-in page.

Layout across the three viewports:
- **1280 × 800.** A fixed vertical axis at 42% of the viewport width carries every heading, figure, form column and table start. The zone left of the axis holds the person's name, the grant or order id and short side notes. The portal board is a two-by-two grid filling the content width. The ribbon runs from the axis to the right edge. When there are more than 24 cells, the ribbon scrolls sideways inside its own track, never the page.
- **768 × 1024.** The axis stays at 42%. Side notes move from the left zone to sit directly above the heading they annotate. The portal board stays two by two. Tables keep every column, with figures wrapping under their labels when needed.
- **375 × 812.** The axis collapses to the 16-pixel page margin, and everything starts at that margin. The portal board becomes one column of four tiles. The cap table grid keeps its columns inside its own sideways-scrolling region. The ribbon track scrolls sideways inside itself. Dialogs fill the screen.

At no viewport does the page itself scroll sideways.

### Public screens and controls (DP-01, DP-04, DP-05, DP-07, DP-10, DP-15, DP-24, DP-28, DP-31, DP-33, DP-38, DP-43, DP-44, DP-45, DP-48, DP-61, DP-65, DP-67, DP-68, DP-69, DP-74, DP-75, DP-76, DP-77, DP-82, DP-83, DP-84)

Only these roles and names are public. Everything else is free. `<placeholders>` are defined where their values are owned.

| Where | Role and accessible name | Visible copy / content |
|---|---|---|
| Every page | `status` "Register updates" (polite live region, present from first paint, including the sign-in page) | The announcements listed in Feedback states. |
| Signed-in pages | `navigation` "Register" with `link`s by role. Option holder and leaver: "Portal", "Vesting", "Exercise", "Documents", "Cap table". Investor: "Portal", "Tender", "Documents", "Cap table". Board member: "Portal", "Board queue", "Cap table". Founder admin: "Portal", "Cap table", "Ledger", "Grants", "Valuations", "Tenders", "Round scenario", "People", "Documents" | The link text equals the name. "Vesting" opens the person's oldest accepted or offered grant. |
| Signed-in pages | `button` "Sign out" | Sign out |
| Sign-in | `heading` level 1 "Your shares, on the record." | Set on two lines: "Your shares," / "on the record." |
| Sign-in | Masthead black tile | `<fully diluted total>` at display size, with "shares, fully diluted" beneath |
| Sign-in | Standfirst paragraph | "Tidecraft Robotics keeps its register here. Sign in to see what you own, what vests next and every deadline that applies to you." |
| Sign-in | `textbox` "Email", password field labelled "Password", `button` "Sign in" | |
| Portal | `region` "Portal board" with four tiles | |
| Portal, option holder | Name tile `heading` level 1 `<first name>`. Dark tile "Vested today: `<vested today>` of `<total options>`". Red tile "Next tranche `<next tranche date>`", or "Fully vested" when no tranche remains. Two photograph tiles. | |
| Portal, leaver | Name tile. Dark tile "Exercisable now: `<exercisable>`". Red tile holding `timer` "Exercise window" with the text "`<countdown>` left". Two photograph tiles. | |
| Portal, investor | Name tile. Dark tile "Your fully diluted ownership: `<ownership>`%". Red tile "Tender open until `<close instant>`", or "No tender open". Two photograph tiles. | |
| Portal, board member | Name tile. Dark tile "Grants awaiting your vote: `<n>`". Red tile "Quorum `<quorum>` of `<board size>`". Two photograph tiles. | |
| Portal, founder admin | Name tile. Dark tile "Fully diluted: `<fully diluted total>`". Red tile "Offers to send: `<n>`". Two photograph tiles. | |
| Portal and grant page, offered grant in its warning period | `region` "Offer warning", a red strip at the top of the content | "The offer for grant `<grant id>` lapses at `<expiry instant>`. Accept or decline before then." |
| Portal and grant page, leaver after a warning time | `region` "Window warning", a red strip at the top of the content | "Your exercise window on grant `<grant id>` closes in `<warning countdown>`." |
| Grant page | `heading` level 1 `<grant id>`, plus the state word: "Draft", "With the board", "Approved", "Offered", "Accepted" or "Expired" | |
| Grant page | `group` "Tranche ribbon" containing `list` "Tranches" | Each `listitem` is named "`<tranche date>`, `<cumulative>` options, `<cell state>`". `<cell state>` is one of "vested", "unvested", "projected" or "cancelled". |
| Grant page | `slider` "Projection date" | aria-valuemin 0, aria-valuemax 48, aria-valuenow `<month index>`, aria-valuetext `<marker date>`, with " (today)" appended when the marker is on the server's today |
| Grant page | `group` "Projection figures" with three labelled values: "Vested" `<cumulative>`, "Cost to exercise" `$<cost>`, "Vested ownership" `<percent>`% | |
| Grant page, leaver | `timer` "Exercise window" on the black band | "`<countdown>` left", then "Window closed" |
| Grant page, leaver | Labelled value "Exercisable now" | `<exercisable>` |
| Grant page, offered | `region` "Grant agreement", `button` "Accept grant", `button` "Decline grant", and `button` "Retry signing" while the signature is pending | |
| Grant page, accepted | `button` "Exercise" | Exercise |
| Exercise dialog | `dialog` "Exercise options", `textbox` "Options to exercise", text "Cost $`<cost>`" (labelled "Cost"), `button` "Confirm exercise", `button` "Close" | |
| Order page | `heading` level 1 `<order id>`, the state word ("Pending", "Held", "Issued" or "Cancelled"), `region` "Provider record" showing "Reference `<payment id>`", "Amount $`<cost>` USD" and "Confirmed `<confirmed instant>`", `button` "Retry payment" (when Held), `button` "Retry notice" (when the notice is pending), `button` "Cancel order" (when Pending or Held) | |
| Documents | `list` "Documents", one `link` per document named by its title | |
| Document viewer | `dialog` "Document viewer" with `heading` `<document title>`, the document text, "Seal `<first 12 characters of the SHA-256>`", "Version `<version>`", "Corrects `<document id>`" (on a correction), "Superseded by `<document id>`" (on a superseded version) and `button` "Close" | |
| Cap table | `grid` "Cap table" with `columnheader`s "Holder", "Issued shares", "Options outstanding", "Fully diluted" and "Ownership", each with `aria-sort` "none", "ascending" or "descending". One `row` per row in the API. A final `row` "Total" shows `<fully diluted total>` and "100.00". | |
| Cap table, founder admin, a holder selected | `region` "Holder detail" with `heading` `<row label>` and `table` "Holder ledger" listing that holder's ledger entries, newest first | |
| Cap table, founder admin | `region` "Option pool" with labelled values "Authorized", "Outstanding", "Exercised", "Reserved" and "Available", plus `textbox` "Pool size" and `button` "Resize pool" | |
| Ledger | `table` "Securities ledger", columns "When", "Holder", "Entry", "Class", "Shares", "Options", "Reference" | |
| Board queue | `table` "Board queue", with `link` `<grant id>`, `button` "Approve `<grant id>`" and `button` "Decline `<grant id>`" on each row, and text "`<approvals>` of `<quorum>` approvals" | |
| Grant summary | `region` "Grant summary" with `heading` level 1 `<grant id>`, labelled values "Holder", "Options", "Strike price" and "Vesting", text "`<approvals>` of `<quorum>` approvals", `button` "Approve `<grant id>`", `button` "Decline `<grant id>`" and `link` "Back to the queue" | |
| Grants admin | `button` "New grant", `table` "Grants", `button` "Send offer `<grant id>`" on Approved rows, `link` `<grant id>` | |
| Grant form | `form` "Issue grant" containing: `combobox` "Holder"; `textbox` "Options"; `textbox` "Strike price"; `radiogroup` "Vesting type" with `radio` "4 years, 1-year cliff" and `radio` "4 years monthly, no cliff"; `textbox` "Vesting start" (hint "YYYY-MM-DD"); text "Draft saved"; `button` "Submit to board"; `button` "Delete draft" | |
| Valuations | `radiogroup` "Show valuations" with `radio`s "All", "Current", "Superseded" and "Lapsed" above `table` "Valuations", which has a status column showing "Current", "Superseded" or "Lapsed". `form` "Record valuation" containing `textbox` "Effective date", `textbox` "Expiry date", `textbox` "Fair market value per share", `textbox` "Valuation firm" and `button` "Record valuation". | |
| Tender page | `heading` level 1 `<tender title>`; `timer` "Tender closes in" showing "`<countdown>`", then "Closed"; labelled values "Price per share" $`<price>`, "Share cap" `<cap>`, "Remaining cap" `<remaining cap>` and "Oversubscribed by" `<n>` (shown only when above 0) | |
| Tender page, investor | `button` "Sign NDA", `textbox` "Shares to tender", `button` "Submit tender", `button` "Withdraw tender", `region` "Your allocation" showing "Projected allocation `<n>`" while open, then "Allocated `<n>` shares, proceeds $`<proceeds>`" | |
| Tenders admin | `form` "Open tender offer" containing `textbox` "Title", `textbox` "Price per share", `textbox` "Share cap", `textbox` "Closes at" (hint "YYYY-MM-DD HH:MM, Pacific time") and `button` "Open tender"; `table` "Tender submissions" | |
| Round scenario | `form` "Round scenario" containing `textbox` "Pre-money valuation", `textbox` "New investment" and `textbox` "Target pool after the round". `region` "Scenario result" with labelled values "Pool top-up", "Price per share", "New shares", "Post-money fully diluted", "New investor", "Pool after", "Dilution", "Investment used" and "Price vs fair market value". There is no submit button. Below the result, `form` "Save scenario" containing `textbox` "Scenario name" and `button` "Save scenario", then `list` "Saved scenarios" with one `link` per saved scenario named by its name, newest first. | |
| People | `table` "People"; per row `combobox` "Role for `<name>`", `button` "Remove access for `<name>`" and `button` "Record departure for `<name>`". `form` "Add person" containing `textbox` "Name", `textbox` "Email", `combobox` "Role", `textbox` "Initial password" and `button` "Add person". | |
| Not-found page | `heading` level 1 "Not on your register" | "This record isn't on your register." |

Every `combobox` above is a native select. The "Holder" options list the people whose role is option holder, each labelled with the person's name alone, in order A to Z, after a first placeholder option "Choose an option holder". The "Role for `<name>`" and "Role" options are the role labels "Board member", "Option holder" and "Investor", with those labels as their visible text. The keyboard picks an option by arrow keys or by typing its first letters.

### Interactions (DP-05, DP-07, DP-15, DP-28, DP-33, DP-34, DP-38, DP-43, DP-44, DP-49, DP-55, DP-62, DP-63, DP-64, DP-65, DP-66, DP-67, DP-71, DP-72, DP-73, DP-74, DP-75, DP-76, DP-77, DP-78, DP-80, DP-81, DP-82, DP-83, DP-84)

- **Tab order.** It follows reading order: navigation, then the left-zone notes, then the main column from top to bottom. Every control shows a visible focus indicator: a thick signal-red ring offset from the control.
- **Sign-in.** Enter in either field submits the form. After success, the page goes to `/` and focus moves to the name heading.
- **Projection marker.**
  - The marker starts at the server's today, which is the month index of the latest tranche date on or before the server date.
  - Right and Up arrows move it forward one month; Left and Down move it back one month. Page Up and Page Down move it twelve months. Home returns to the server's today, and End goes to month 48. The value stays between 0 and 48.
  - Pointer drag and tap on a cell move the marker to that cell.
  - The marker's cell is the cell whose marks include the marker's month (month 0 uses the first cell). At 375 pixels, each keyboard move scrolls the ribbon track sideways so the marker's cell lies wholly inside the track's visible frame. The scroll is smooth with motion, and under reduced motion the track is there at once. The page itself never scrolls sideways.
  - Each move updates the three projection figures from the schedule the server returned. Cells after the server's today, up to and including the marker's cell, show as projected. The red server-vested cells never change because of the marker.
- **Cap table grid.**
  - The grid is one tab stop. Focus lands on the cell last focused, or the first data cell the first time.
  - The arrow keys move between cells, Home and End go to the first and last cell of the row, and Ctrl+Home goes to the first data cell and Ctrl+End to the last cell of the Total row. In the header row, Home and End go to the first and last header.
  - When a live update redraws the grid, the focused cell keeps focus by row key and column, even if rows reorder. If the focused row is gone, focus moves to the same column of the Total row.
  - The header row is part of the grid: ArrowUp from a cell in the first row moves to that column's header. Enter or Space on a header sorts the rows by that column. The first press sorts figure columns largest first (`descending`) and Holder by label A to Z, ignoring case (`ascending`); each further press on the same header switches between `descending` and `ascending`. In both orders, rows with equal values keep their default order from Business rules, and the Total row stays last. The sorted header's `aria-sort` shows the order and every other header shows "none". Focus stays on the header after sorting.
  - For the founder admin, Enter on a holder row's Holder cell selects that holder: the "Holder detail" region opens beside the grid and the address gains `holder=<row key>`. Enter on the selected row's Holder cell again, or Escape in the grid, closes the detail and drops the parameter. Selecting and closing replace the address without adding a history entry, keeping any sort parameters first. Enter on the "Unallocated option pool" or "All other holders" row does nothing. Opening an address with `holder=` shows the detail on the first render with focus on that row's Holder cell.
  - At 375 pixels, every keyboard move in the grid scrolls the grid's sideways region so the focused cell lies wholly inside the region's visible frame.
  - Each sort replaces the current address with `/cap-table?sort=<column key>&dir=<asc or desc>`, followed by `&holder=<row key>` when a holder is selected, without adding a history entry. The column keys are `holder`, `issued_shares`, `options_outstanding`, `fully_diluted` and `ownership`. Opening that address shows the rows in that order on the first render. Without the parameters, the default order applies.
- **Grant form.**
  - "New grant" creates a draft and opens its form with focus on "Holder".
  - Within the "Vesting type" radio group, the arrow keys move and select.
  - "Vesting start" is typed, with no date picker required. It is checked as described in the API.
  - Each field change saves the draft within one second and shows "Draft saved".
  - Enter on any field, or "Submit to board", submits.
  - Field errors appear in red text directly beside the field, prefixed by the word "Error:". The first field with an error receives focus.
  - When the current valuation becomes lapsed while the form is open, "Submit to board" becomes disabled within one second without a reload, the lapsed band from Feedback states appears on the page and is announced once. When a Current valuation is recorded again, the button is enabled the same way.
  - A form sends its saves one at a time, and each save carries the `draft_version` returned by the previous save, or loaded with the form. When the same draft is open in another tab, a saved change reaches that tab's form within one second: every field without keyboard focus shows the saved value. A live push from another tab updates the fields but not the carried `draft_version`, so this tab's next save after another tab's save is refused with `draft_outdated`. A save refused with `draft_outdated` loads the latest version into the form and shows the "Draft changed" region from Feedback states with focus on "Keep editing". Escape or "Keep editing" closes it and returns focus to the field whose save was refused, which then holds the latest version.
- **Exercise flow.**
  - "Exercise" opens the dialog "Exercise options" with focus in "Options to exercise".
  - Typing updates "Cost" within half a second from the server's figure for that count. This preview uses the API's cost rule and does not create an order.
  - Enter or "Confirm exercise" places the order. The dialog then closes and the page goes to the order page, with focus on the order heading. When the open order's state changes live (a pending order issued, a held order retried), the page updates in place and keyboard focus stays where it was.
  - Escape or "Close" closes the dialog without an order and returns focus to "Exercise".
- **Dialogs.** In every dialog (exercise, document viewer), Tab from the last control goes to the first control and Shift+Tab from the first goes to the last. Escape closes the dialog, and focus returns to the control that opened it, even when a live update redrew the page while the dialog was open. The document viewer at `/documents/<document id>` reopens on a reload; closing it changes the address to `/documents` and returns focus to that document's link in the list, also when the viewer was opened from the address itself.
- **Tender.**
  - "Shares to tender" saves the person's draft on the server within one second of typing.
  - "Submit tender" is disabled, with the side note "Sign the NDA to tender", until the NDA is sealed.
  - After a submission, the field becomes read-only and "Withdraw tender" appears.
- **Round scenario.**
  - Every keystroke in the three fields recomputes the result in place within half a second of the last keystroke. Invalid input shows the field error beside the field and leaves the previous result greyed out.
  - Each settled input replaces the current address with `/admin/scenario?pre=<text>&investment=<text>&pool=<text>`, holding the three fields' typed text URL-encoded, without adding a history entry. Opening that address, by reload, Back or in another tab, fills the three fields with that text and shows its result.
  - "Save scenario" saves the current inputs under the typed name. The new link appears in "Saved scenarios" on every open scenario page within one second; the save is announced only on the page that saved it. Following a saved scenario's link opens its address (the `?pre=…&investment=…&pool=…` form above); coming Back to the list puts focus on that link.
  - "Price vs fair market value" follows the current valuation: when a valuation is recorded or the current one lapses while the page is open, the value changes within one second and the change is announced once.
  - At 375 pixels the labelled values of "Scenario result" stack in one column, and the page does not scroll sideways.
- **Role change.** When a role change arrives on the socket, the page navigates within one second to `/` for the new role, moves keyboard focus to the name heading and announces the change. Any open dialog closes first.
- **Acceptance.** When "Accept grant" or "Retry signing" completes the acceptance, the grant page shows Accepted in place and keyboard focus moves to "Exercise".
- **Access removal.** When an access removal arrives, the page closes any open dialog, including the document viewer, and replaces the page with the full-page removal band within one second. The band links to sign-in.
- **Drafts.** Reload, Back and a second tab all show the server's saved draft values for grants and tender submissions.
- **Valuations.** Within "Show valuations", the arrow keys move and select. The table shows only rows of the chosen status, or every row for "All", and the choice replaces the address with `/admin/valuations?status=<all, current, superseded or lapsed>` without adding a history entry. Opening that address checks that radio and filters the table on the first render; without it, "All" applies. When the chosen status hides every row, the table area shows "No valuations with this status." After "Record valuation" succeeds, the filter returns to "All" (the address becomes `/admin/valuations?status=all`) and focus moves to the new row's Effective date cell; after a refusal, focus moves to the first field in error.
- **Board queue.** Each row's grant id is a link to `/board/<grant id>`. Following it opens the grant summary with focus on its heading. Escape on the summary, the "Back to the queue" link or the browser's Back returns to `/board` with focus on that grant's link. A reload of `/board/<grant id>` shows the same summary. Votes cast by other board members update the open summary's approvals text within one second. A grant that is no longer in the queue shows the not-found page at `/board/<grant id>`, and an open summary whose grant leaves the queue is replaced by the not-found page within one second.
- **Live socket.** On signed-in pages, while the socket is not open (before it first opens, and from a drop until it is open again), these buttons are disabled (native `disabled` or `aria-disabled="true"`): "New grant", "Submit to board", "Delete draft", "Approve `<grant id>`", "Decline `<grant id>`", "Send offer `<grant id>`", "Accept grant", "Decline grant", "Retry signing", "Exercise", "Confirm exercise", "Cancel order", "Retry payment", "Retry notice", "Sign NDA", "Submit tender", "Withdraw tender", "Record valuation", "Save scenario", "Resize pool", "Open tender", "Add person", "Remove access for `<name>`" and "Record departure for `<name>`", and every "Role for `<name>`" select is disabled too. Typed draft text stays in its field and is saved once the socket is open again. The exercise cost preview changes nothing and keeps working. Navigation links, "Sign out" and "Close" stay usable.
- **Touch.** Every control and ribbon cell is at least 44 by 44 pixels. The ribbon track and the cap table region scroll sideways inside themselves with a swipe.

### Visual design (DP-58, DP-59, DP-60)

The look is an editorial annual report: each holder's own numbers are set large on one vertical axis, like a page of a printed annual. The mood is authoritative and sober. Deadlines are shown with the weight of an official notice, and are never in small print.

- **Type.** Funnel Display is used for headings, tile figures and every large numeral. Funnel Sans is used for body text, labels and tables, and all figures use tabular, same-width digits. Each step up the heading scale is about a third larger than the step below. The giant name and the tile figures are roughly four to five times body size. Both typefaces are bundled with the app.
- **Colour.**
  - The ground is pure white.
  - The surface is a pale neutral grey, used for cap-table row bands and projected ribbon cells.
  - Ink is near-black, for text, black bands and the dark tile.
  - Muted is a mid grey, for secondary labels and cancelled cells.
  - The accent is a signal red, kept for vested shares, the one primary action on each screen, the 100.00 total and outage bands.
  - Text on red is white.
  - All text and controls meet WCAG 2.2 AA contrast on their background.
- **Density.** Comfortable, with generous space between sections. A tile or row never holds more than one figure at display size.
- **Composition.**
  - A fixed vertical axis at 42% of the viewport width carries every heading, figure and table start.
  - The zone from the left edge to the axis holds the holder's name, the grant id and short side notes.
  - Full-bleed black bands, edge to edge with white Funnel Display headings, open the Exercise and Tender chapters.
  - On phones, the axis collapses to the page margin.
- **Sign-in hero (masthead with the title on the axis).**
  - A masthead mosaic spans the top of the page in two rows. It combines four greyscale photographs (robot arms, a workbench, hands at a desk) with flat tiles in signal red, black and pale grey.
  - One black tile spans both rows and carries Tidecraft's fully diluted share count at display size.
  - Below the mosaic, the title starts on the axis, on two lines. The standfirst sits at the left margin.
- **Portal (two-by-two board).**
  - The name tile shows the person's first name at giant size.
  - The two photograph tiles continue the masthead picture.
  - The dark tile is black with white text, and the red tile is signal red with white text, each carrying the role's figures listed in Public screens and controls.
- **Working screens.** Each is a page of the same printed annual.
  - The cap table is a borderless grid. Alternate rows have pale-grey bands instead of rules, figures are tabular and percentages are right-aligned on the axis. The Total row shows 100.00 in red.
  - Forms (grant issue, exercise, tender, valuation, scenario, add person) are single narrow columns about 38 characters wide, hanging from the axis. They use typed date fields and show errors in red text beside the field together with the word "Error:", so colour is never the only signal.
  - Empty, loading and error states fill the content area as a whole black band, or a red band for outages, with one sentence at display size.
- **Shapes.** Every tile, band edge inside the content and button has gently rounded corners of 8 pixels. There are no shadows and no outlines except the focus ring.
- **Excluded.** No cream or paper ground, no hairline rules, no monospace labels, no index numbering and no glass or blur effects.
- **Assets.** The photographs are CC0 and shown in greyscale. Icons are Lucide line icons.

### Motion and effects (DP-04, DP-05, DP-56, DP-57, DP-66, DP-70)

All motion starts quickly and settles softly. There are no bounces and no overshoot.

- **Title reveal.** On first paint of the sign-in page, each line of the title rises into view from behind an invisible mask. The whole reveal takes just under half a second (between 0.4 and 0.6 seconds). It runs once and does not repeat on later visits within the same page session.
- **Cell fill (signature: the tranche ribbon).** As the projection marker passes cells moving forward, each cell fills with pale grey from left to right, in under a fifth of a second per cell (between 0.15 and 0.25 seconds). Moving the marker back un-fills the cells one step at a time in reverse order, at the same pace. When a tranche vests on the server while the page is open, its cell fills red from left to right at the same pace.
- **Numeral count.** When the marker moves, the three projection figures count from their old values to their new values in about a third of a second (between 0.25 and 0.4 seconds), ending exactly on the server's value.
- **Leaver band.** When the server cancels a leaver's remaining options at the window end, each cell that turns cancelled under the ribbon cell rule in Business rules fades to muted grey, left to right, in under a fifth of a second per cell. The figure that Business rules names as dropping at the window end counts down to its new value at the same time.
- **Allocation reveal.** When a tender is allocated, the seller's "Allocated `<n>` shares" figure counts up from 0 to its final value in between 0.25 and 0.4 seconds, ending exactly on the server's figure. Under reduced motion only the final figure is ever shown.
- **Press feedback.** Buttons darken briefly while pressed (under a tenth of a second). Hovering changes only the underline or fill colour, with no movement.
- **No loops.** There are no idle or decorative loops anywhere. The countdowns change only their digits, once per second.
- **Reduced motion.** When the person's system asks for reduced motion, cells fill and unfill instantly, numerals show their final values at once and the title appears without the reveal. The marker, keyboard control, values, announcements and countdown digits stay exactly the same.

### Feedback states (DP-13, DP-14, DP-20, DP-26, DP-30, DP-43, DP-44, DP-48, DP-53, DP-60, DP-61, DP-64, DP-68, DP-69, DP-72, DP-75, DP-76, DP-82)

Every announcement below goes through the `status` "Register updates" region exactly once per event per page, including after a replay. The same copy appears as visible text in the page area named. `<placeholders>` follow the formats in Business rules.

| Action | Pending | Success | Field error / refusal | Outage |
|---|---|---|---|---|
| Sign in | button text "Signing in" | navigation to the portal (no announcement) | "That email and password don't match a Tidecraft register account." / for removed access: "Your access to the Tidecraft register has ended." | — |
| Grant draft save | — | "Draft saved" beside the form (not announced) | Outdated save: `region` "Draft changed" beside the form holding "This draft changed in another tab. The latest version is shown." and `button` "Keep editing" | — |
| Submit to board | button text "Sending" | "Grant `<grant id>` sent to the board for approval." | Errors beside fields: "Enter a whole number of options from 1 to `<available>`." / "Strike must be at least the current fair market value of $`<fmv>`." / "Enter the vesting start as YYYY-MM-DD." / "Choose an option holder." / "Choose a vesting type." | — |
| Grant refused for lapsed valuation | — | — | Black band on the grants admin page and announced: "The current valuation lapsed on `<expiry date>`. Record a new valuation before issuing grants." | — |
| Board vote | — | "Your approval of `<grant id>` is recorded: `<approvals>` of `<quorum>` approvals." / "Your decline of `<grant id>` is recorded." | "You have already voted on `<grant id>`." | — |
| Quorum reached | — | "Grant `<grant id>` approved by the board." / "Grant `<grant id>` returned to draft by the board." | — | — |
| Send offer | — | "Offer for `<grant id>` sent. It lapses at `<expiry instant>`." | — | — |
| Offer arrives (holder) | — | "A grant offer is waiting: `<grant id>`, `<options>` options." | — | — |
| Accept grant | "Sealing your signed agreement in the vault." | "Grant `<grant id>` accepted. Your signed agreement is sealed in the vault." | "The offer for grant `<grant id>` has expired." | Red band: "The document vault can't be reached. Your signature is pending and grant `<grant id>` is not yet accepted." with `button` "Retry signing" |
| Decline grant | — | "Grant `<grant id>` declined and returned to the board." | — | — |
| Offer warning | — | "The offer for grant `<grant id>` lapses at `<expiry instant>`. Accept or decline before then." | — | — |
| Offer expiry | — | "The offer for grant `<grant id>` has expired." | — | — |
| Tranche vests | — | "`<n>` options vested today on grant `<grant id>`." | — | — |
| Exercise | button text "Sending to the provider" | Pending: "Payment pending at the provider. Your shares appear once it confirms." Then issued: "Payment confirmed. `<options>` shares issued on grant `<grant id>`." | Beside the field: "Only `<exercisable>` vested options are available to exercise." / "Enter a whole number of options." Window closed: "Your exercise window closed before this order arrived." | Red band: "The payment provider can't be reached. Order `<order id>` is held under key `<key>`. Nothing has been issued." with `button` "Retry payment" |
| Cancel order | — | "Order `<order id>` cancelled. No shares were issued." | "Order `<order id>` was already issued and can't be cancelled." | — |
| Exercise notice | — | "Exercise notice for `<order id>` sealed in the vault." | — | Red band: "The document vault can't be reached. The exercise notice for `<order id>` is pending; your shares are issued." with `button` "Retry notice" |
| Window warning | — | "Your exercise window on grant `<grant id>` closes in `<warning countdown>`." | — | — |
| Window end | — | "Your exercise window has closed. `<n>` unexercised options on grant `<grant id>` were cancelled." | — | — |
| Record departure | — | "Departure recorded for `<name>`. Their exercise window ends at `<window end instant>`." | — | — |
| Sign NDA | "Sealing your NDA in the vault." | "NDA signed and sealed." | — | Red band: "The document vault can't be reached. Your NDA is pending and you can't tender yet." with `button` "Retry signing" |
| Submit tender | button text "Submitting" | "Tender submitted: `<shares>` shares at $`<price>`." | Beside the field: "Enter a whole number of shares from 1 to `<issued shares>`." / "This tender has closed." | — |
| Withdraw tender | — | "Tender withdrawn." | — | — |
| Tender close | — | "Tender `<tender id>` has closed." then "Tender `<tender id>` allocated: you sold `<allocation>` shares for $`<proceeds>`." | — | — |
| Open tender (admin) | — | "Tender `<tender id>` is open until `<close instant>`." | "Close the open tender before opening another." / beside fields: "Set a close time at least 10 seconds from now." / "Enter a whole number of shares from 1 upward." / "Enter a price above $0.0000 with up to four decimals." | — |
| Record valuation | — | "Valuation recorded: fair market value $`<fmv>` from `<effective date>`." | Beside fields: "The effective date can't be after today." / "The expiry date can't be before the effective date." / "Enter a value above $0.0000 with up to four decimals." | — |
| Round scenario | — | "Scenario updated: price per share $`<price>`." (once per settled input) / on a valuation change while open: "Fair market value is now $`<fmv>`; the round price is `<ratio>`× it." or "There is no current valuation to compare the round price with." / on save: "Scenario `<name>` saved." | Beside fields: "Enter an amount above $0.00 with up to two decimals." / "Enter a percentage from 0.00 to 30.00." / "This target pool can't be reached at this investment." / beside "Scenario name": "Enter a name of 1 to 60 characters." / "A saved scenario already has that name." | — |
| Resize pool / issue shares / add person | — | "Option pool resized to `<n>` options." / "`<shares>` `<class>` shares issued to `<name>`." / "`<name>` added as `<role label>`." | "The pool can't be smaller than the `<n>` options already allocated." / "That email is already on the register." | — |
| Role change (affected person) | — | "Your role is now `<role label>`." | — | — |
| Access removal (affected person) | — | Full-page black band: "Your access to the Tidecraft register has ended." | — | — |
| Remove access (admin) | — | "Access removed for `<name>`." | — | — |
| Document view | Black band: "Opening the document." | the document text | — | Red band: "The document vault can't be reached. Try again shortly." |
| Page loading | Black band: "Loading your register." | — | — | — |
| Empty states | — | Black bands: "You hold no grants yet." / "No tender is open." / "No documents yet." / "Nothing is waiting for your vote." / "No exercise orders yet." | — | — |
| Unexpected server error | — | — | Black band: "Something went wrong on our side. Your register has not changed." | — |
| Socket reconnecting | A thin black strip at the top of the page: "Reconnecting to the register." (not announced) | the strip disappears after the replay | — | — |

`<role label>` is one of "Founder admin", "Board member", "Option holder", "Leaver" or "Investor".

## Backend

### API (DP-08, DP-09, DP-16, DP-17, DP-18, DP-20, DP-21, DP-29, DP-36, DP-37, DP-39, DP-42, DP-45, DP-46, DP-50, DP-61, DP-68, DP-72, DP-75, DP-76, DP-79)

**General format and errors**

- Every endpoint is under `/api` and speaks JSON (`application/json; charset=utf-8`), except document content and the WebSocket. Request bodies are limited as stated in Server boundary.
- Authentication uses a session cookie set by `POST /api/session`.
- Every error has one shape: `{"error":{"code":"<code>","message":"<sentence>"}}`. A 422 has the code `validation` and adds `fields` as a top-level sibling of `error`, never nested inside it: `{"error":{"code":"validation","message":"<sentence>"},"fields":{"<field>":"<message>"}}`. Each key in `fields` is a request field name, and each message is the field error copy from Feedback states where one is published. Some 503 responses add the affected resource beside `error`, as listed below.

**Error precedence, for the whole API.** An idempotent replay returns its stored response before any check except authentication. Otherwise the checks run in this order, and the first failure answers:
1. Unauthenticated: 401 `unauthenticated`.
2. Unknown resource, or one the signed-in person may not see (including ids inside request bodies): 404 `not_found`.
3. The person's role may not use the endpoint: 403 `forbidden`.
4. State conflicts: 409 with the codes below.
5. Validation: 422 `validation`.
6. Dependency outage: 503.

The endpoint rows below list only their own codes.

**Value formats**
- Money amounts are strings with exactly two decimals (`"1346.31"`).
- Per-share prices (strike, fair market value, tender price, round price) are strings with exactly four decimals (`"0.4185"`).
- Percentages are strings with two decimals (`"45.45"`).
- The ratio `price_to_fmv` is a string with exactly two decimals (`"7.06"`).
- Share and option counts are integers.
- In requests, the money, price and percent fields (`strike`, `price_per_share`, `fmv_per_share`, `pre_money`, `investment`, `target_pool_percent`) are JSON strings of plain decimal digits with an optional decimal point, for example `"0.4185"` or `"12.00"`, with no sign, spaces or exponent. A JSON number or any other text fails 422 on that field. The count fields (`options`, `shares`, `share_cap`, `authorized`) are JSON integers, and a string or a decimal fails 422 on that field. The tender draft `shares` is the one exception: it is text, as its row states.
- Dates are `YYYY-MM-DD` in Tidecraft's time zone.
- Instants are ISO 8601 UTC with milliseconds and `Z`.
- Ids are strings: people `PER-001`, grants `TC-OPT-0001`, orders `EXO-000001`, tenders `TND-001`, valuations `VAL-01`, documents `DOC-000001`, ledger entries `LED-000001`. Each is numbered upward from the seed.

**Objects**
- **Person**: `{"id","name","first_name","email","role":"founder_admin|board_member|option_holder|leaver|investor","access":"active|removed|none","departure":null|{"terminated_at","termination_date","window_ends_at","warnings_at"}}`. `warnings_at` lists the instants of the leaver warnings still ahead when the departure was recorded, earliest first.
- **Grant**: `{"id","holder_id","holder_name","options","strike","vesting_type":"standard|monthly","vesting_start","state":"draft|board_queue|approved|offered|accepted|expired","draft_version","votes":{"approve","decline"},"offered_at","offer_expires_at","offer_warning_at","accepted_at","agreement":{"status":"none|pending|sealed|paper","document_id"},"vested","exercised","cancelled","forfeited","in_open_orders","exercisable","next_tranche":null|{"date","cumulative"},"exercise_window_ends_at","schedule":[Tranche],"server_date","server_time"}`. Draft fields may be `null`. `draft_version` is an integer that starts at 1 when the draft is created and rises by 1 with each saved PATCH. `offer_warning_at` is `offer_expires_at` − the offer warning, and `null` until the grant is offered. `vested`, `exercised`, `cancelled`, `forfeited`, `in_open_orders` and `exercisable` are 0 until the grant is accepted. `cancelled` counts only vested options that were cancelled: those cancelled at the leaver window end, and those returned by a held order cancelled after the window end. `forfeited` counts the unvested options cancelled when a departure is recorded (options − vested on the termination date). Forfeited options are never included in `cancelled`, and `vested` never includes them.
- **Tranche**: `{"month","date","cumulative","state":"vested|unvested|cancelled","cost_at_strike","vested_ownership"}`, for months 0 through 48.
- **Order**: `{"id","grant_id","holder_id","options","strike","cost","idempotency_key","state":"pending|held|issued|cancelled","placed_at","issued_at","payment":null|{"id","status","amount_cents","currency","reference","confirmed_at"},"notice":null|{"document_id","status":"pending|sealed"}}`
- **Tender**: `{"id","title","buyer":"Harbourline Secondary Partners","price_per_share","share_cap","closes_at","state":"open|closed|allocated","total_tendered","remaining_cap","oversubscribed_by","server_time","mine","submissions"}`.
  - `mine` is present for investors only: `{"nda":{"status":"none|pending|sealed","document_id"},"draft_shares","submission":null|{"shares","submitted_at","sequence"},"projected_allocation","allocation","proceeds"}`.
  - `submissions` is present for the founder admin only: a list of `{"holder_id","holder_name","shares","submitted_at","sequence","allocation","proceeds"}`.
- **Document**: `{"id","kind":"grant_agreement|exercise_notice|tender_nda","title","owner_id","status":"pending|sealed","sha256","vault_key","created_at","version","supersedes","superseded_by"}`. `version` is 1 for an original. `supersedes` and `superseded_by` are document ids or `null`.
- **CapTable**: `{"fully_diluted_total","rows":[{"key","label","issued_shares","options_outstanding","fully_diluted","ownership"}],"total_ownership":"100.00"}`
- **LedgerEntry**: `{"id","at","holder_id","holder_name","kind":"issuance|grant_accepted|exercise_issued|options_cancelled|tender_transfer|pool_resized","class","shares_delta","options_delta","reference"}`

**Endpoints**

| Method and path | Who | Request | Success | Own errors |
|---|---|---|---|---|
| GET `/api/health` | anyone | — | 200 `{"status":"ok"}` | — |
| GET `/api/masthead` | anyone | — | 200 `{"company":"Tidecraft Robotics","fully_diluted_total"}` | — |
| POST `/api/session` | anyone | `{"email","password"}` | 200 `{"person":Person}`, sets the session cookie | 401 `invalid_credentials`; 401 `access_removed` |
| DELETE `/api/session` | signed in | — | 204 | — |
| GET `/api/me` | signed in | — | 200 `{"person":Person,"server_time","server_date","time_zone":"America/Los_Angeles"}` | — |
| GET `/api/portal` | signed in | — | 200 with the role's tile values. Option holder: `{"first_name","vested_today","total_options","next_tranche_date"}`. Leaver: `{"first_name","exercisable","window_ends_at"}`. Investor: `{"first_name","fully_diluted_shares","ownership","open_tender":null|{"id","closes_at"}}`. Board member: `{"first_name","awaiting_vote","quorum","board_size"}`. Founder admin: `{"first_name","fully_diluted_total","offers_to_send"}`. | — |
| GET `/api/cap-table` | signed in | — | 200 CapTable shaped by role (Business rules) | — |
| GET `/api/ledger` | founder admin: all; option holder, leaver, investor: own | — | 200 `{"entries":[LedgerEntry]}`, newest first | 403 for board member |
| GET `/api/pool` | founder admin | — | 200 `{"authorized","outstanding","exercised","reserved","available","unallocated"}` | — |
| PATCH `/api/pool` | founder admin | `{"authorized"}` | 200 pool object | 409 `pool_below_allocated`; 422 |
| POST `/api/issuances` | founder admin | `{"holder_id","class":"Common|Series Seed Preferred|Series A Preferred","shares"}` | 201 `{"entry":LedgerEntry}` | 422 |
| GET `/api/people` | founder admin | — | 200 `{"people":[Person]}` | — |
| POST `/api/people` | founder admin | `{"name","email","role":"option_holder|investor|board_member","password"}`; password 12 to 128 characters | 201 `{"person":Person}` | 422 (`email` taken or invalid) |
| PATCH `/api/people/<id>` | founder admin | `{"role":"option_holder|investor|board_member"}` | 200 `{"person":Person}` | 409 `own_role` when changing yourself; 409 `person_is_leaver`; 422 |
| POST `/api/people/<id>/remove-access` | founder admin | `{}` | 200 `{"person":Person}` | 409 `own_role`; 409 `access_already_removed` |
| POST `/api/people/<id>/departure` | founder admin | `{}` | 200 `{"person":Person}` | 409 `not_an_option_holder` |
| GET `/api/grants` | founder admin: all; option holder, leaver: own | — | 200 `{"grants":[Grant]}` | 403 for investor and board member |
| POST `/api/grants` | founder admin | any of `{"holder_id","options","strike","vesting_type","vesting_start"}` | 201 Grant in `draft` | 409 `valuation_lapsed` |
| GET `/api/grants/<id>` | holder, founder admin | — | 200 Grant | — |
| PATCH `/api/grants/<id>` | founder admin | same fields as POST, plus optional `"draft_version"` | 200 Grant | 409 `grant_not_draft`, then 409 `draft_outdated` with `"grant":Grant` (the latest version) when `draft_version` is a positive integer that is not the grant's current one; 422 on `draft_version` when it is present and not a positive integer (such a value is never compared, so it never answers `draft_outdated`) |
| DELETE `/api/grants/<id>` | founder admin | — | 204 | 409 `grant_not_draft` |
| POST `/api/grants/<id>/submit` | founder admin | `{}` | 200 Grant in `board_queue` | 409 `grant_not_draft`; 409 `valuation_lapsed`; 409 `pool_exhausted`; 422 with fields `holder_id`, `options`, `strike`, `vesting_type`, `vesting_start` |
| POST `/api/grants/<id>/offer` | founder admin | `{}` | 200 Grant in `offered` | 409 `grant_not_approved`; 409 `valuation_lapsed`; 409 `strike_below_fmv` |
| POST `/api/grants/<id>/accept` | the holder | `{}` | 200 Grant in `accepted` | 409 `grant_not_offered`; 409 `offer_expired`; 503 `vault_unavailable` with `"grant":Grant` (still `offered`, agreement `pending`) |
| POST `/api/grants/<id>/decline` | the holder | `{}` | 200 Grant in `board_queue` | 409 `grant_not_offered`; 409 `offer_expired` |
| GET `/api/board/queue` | board member, founder admin | — | 200 `{"quorum","board_size","grants":[{"id","holder_name","options","strike","vesting_type","vesting_start","approvals","declines","my_vote":null|"approve"|"decline"}]}` | — |
| POST `/api/board/queue/<grant id>/votes` | board member | `{"vote":"approve|decline"}` | 200 the queue entry plus `"state"` | 409 `grant_not_in_queue`; 409 `already_voted`; 422 |
| GET `/api/valuations` | founder admin | — | 200 `{"valuations":[{"id","effective_on","expires_on","fmv_per_share","firm","status":"current|superseded|lapsed"}],"current_id"}` | — |
| POST `/api/valuations` | founder admin | `{"effective_on","expires_on","fmv_per_share","firm"}` | 201 the valuation | 422 |
| POST `/api/grants/<id>/exercise-quote` | the holder | `{"options"}` | 200 `{"options","strike","cost"}` | 409 `grant_not_exercisable`; 422 |
| POST `/api/grants/<id>/exercises` | the holder; header `Idempotency-Key` of 8 to 64 characters from letters, digits, `-` and `_` | `{"options"}` | 201 Order (`issued` or `pending`) | 409 `idempotency_key_reused` (same key, different grant or body); 409 `grant_not_exercisable`; 409 `exercise_window_closed`; 422 (`options`, or `idempotency_key` when missing or malformed); 503 `provider_unavailable` with `"order":Order` in `held` |
| GET `/api/exercises` | holder: own; founder admin: all | — | 200 `{"orders":[Order]}` | 403 for investor and board member |
| GET `/api/exercises/<id>` | holder, founder admin | — | 200 Order | — |
| POST `/api/exercises/<id>/retry` | the holder | `{}` | 200 Order | 409 `nothing_to_retry`; 503 `provider_unavailable` or `vault_unavailable` with `"order":Order` |
| POST `/api/exercises/<id>/cancel` | the holder | `{}` | 200 Order in `cancelled` | 409 `order_not_cancellable` |
| GET `/api/tenders` | investor, founder admin | — | 200 `{"tenders":[Tender]}` | 403 for others |
| POST `/api/tenders` | founder admin | `{"title","price_per_share","share_cap","closes_at"}` | 201 Tender | 409 `tender_already_open`; 422 |
| GET `/api/tenders/<id>` | investor, founder admin | — | 200 Tender | — |
| POST `/api/tenders/<id>/nda` | investor | `{}` | 200 Tender | 409 `nda_already_signed`; 409 `tender_closed`; 503 `vault_unavailable` with `"tender":Tender` (NDA `pending`) |
| PUT `/api/tenders/<id>/draft` | investor | `{"shares": "<text up to 12 characters>" or null}` | 200 Tender | 409 `tender_closed`; 422 |
| POST `/api/tenders/<id>/submissions` | investor | `{"shares"}` | 201 Tender | 409 `tender_closed`; 409 `nda_required`; 409 `already_submitted`; 422 |
| DELETE `/api/tenders/<id>/submissions/mine` | investor | — | 204 | 409 `tender_closed`; 409 `no_submission` |
| POST `/api/scenarios/round` | founder admin | `{"pre_money","investment","target_pool_percent"}` | 200 `{"fully_diluted_before","unallocated_pool_before","pool_top_up","price_per_share","new_shares","fully_diluted_after","new_investor_percent","pool_after_percent","dilution_percent","investment_used","fmv_per_share","price_to_fmv"}` | 422 |
| GET `/api/scenarios/saved` | founder admin | — | 200 `{"scenarios":[{"id","name","pre_money","investment","target_pool_percent","saved_at"}]}`, newest first | — |
| POST `/api/scenarios/saved` | founder admin | `{"name","pre_money","investment","target_pool_percent"}`; `name` 1 to 60 characters after trimming | 201 `{"scenario":{"id","name","pre_money","investment","target_pool_percent","saved_at"}}` | 409 `scenario_name_taken` (same name, ignoring case); 422 |
| GET `/api/documents` | own (founder admin: all) | — | 200 `{"documents":[Document]}` | 403 for board member |
| GET `/api/documents/<id>` | owner, founder admin | — | 200 Document | — |
| GET `/api/documents/<id>/content` | owner, founder admin | — | 200 the stored bytes, `Content-Type: text/plain; charset=utf-8`, header `X-Document-SHA256: <hex>` | 409 `document_pending`; 503 `vault_unavailable` |
| POST `/api/documents/<id>/corrections` | founder admin | `{"text":"<the corrected document text, 1 to 20,000 characters>"}` | 201 Document (the new version, `sealed`, with the original's title) | 409 `document_not_correctable` (a tender NDA), then 409 `document_superseded` (not the latest version), then 409 `document_pending`, checked in that order; 422 (`text`, counted in characters, after the body limit in Server boundary); 503 `vault_unavailable` (nothing recorded) |
| GET `/api/live` | signed in; WebSocket upgrade; optional query `since=<sequence>` | — | 101, then server-to-client JSON messages `{"seq","type","at","data"}` | 401 before upgrade; 403 when the `Origin` header is not the app's own origin |

**422 field rules**
- `options`, `shares` and `share_cap` are integers of 1 or more.
- Prices have at most four decimals and are above zero.
- Money amounts have at most two decimals and are above zero.
- `vesting_start` is a real calendar date written `YYYY-MM-DD`, between 2015-01-01 and one year after the server date, both ends allowed.
- `vesting_type` is `standard` or `monthly`.
- `holder_id` names a person whose role is option holder (a person who exists but holds another role gives 422 on `holder_id`; an unknown id gives 404).
- `closes_at` is an instant at least 10 seconds after the server time when the request is received.
- `effective_on` is on or before the server date.
- `expires_on` is on or after `effective_on`.
- `target_pool_percent` is from 0.00 to 30.00, both ends allowed.
- Unknown JSON fields are ignored.

### Business rules (DP-02, DP-03, DP-09, DP-11, DP-12, DP-13, DP-17, DP-18, DP-19, DP-20, DP-21, DP-23, DP-25, DP-26, DP-29, DP-30, DP-32, DP-35, DP-36, DP-37, DP-39, DP-40, DP-41, DP-43, DP-44, DP-46, DP-47, DP-49, DP-61, DP-64, DP-68, DP-69, DP-73, DP-75, DP-76, DP-79)

**Server time.** Tidecraft keeps its register on Pacific time (America/Los_Angeles). The server date is today's date in that zone, by the server's clock. Every vested count, expiry, close, cancellation and lapse is decided by the server. The browser shows only what the server returns or pushes, and never recomputes a status or a remaining time from its own clock. A device clock or time zone set wrongly changes nothing on screen.

**Vesting.**
- An accepted grant has month marks m = 0 to 48. The date of mark m is the vesting start plus m calendar months. When that month has no such day (the start is the 29th, 30th or 31st), the mark falls on the last day of the month. For example, a start of 31 Jan 2025 gives marks 31 Jan 2026, 28 Feb 2026, 31 Mar 2026, 30 Apr 2026, and later 29 Feb 2028.
- Cumulative vested at mark m is floor(options × m ÷ 48) for `monthly`. For `standard`, it is 0 for m below 12, and floor(options × m ÷ 48) from 12 on. So the cliff tranche is the first twelve months together, and the last mark completes the grant.
- Vested today is the cumulative at the latest mark whose date is on or before the server date.
- For example, with the seed data on server date 3 Nov 2026, grant TC-OPT-0007 has 21,000 of 48,000 vested and its next tranche is 30 Nov 2026.
- A tranche whose date becomes the server date vests at midnight Pacific time, and open pages receive it within one second.

**Ribbon cells.**
- `standard` grants show one cliff cell for marks 1 to 12, labelled with mark 12's date, then one cell per mark from 13 to 48. `monthly` grants show one cell per mark from 1 to 48.
- A cell's state is the first of these that applies:
  - **Cancelled after a departure.** For a leaver, a cell whose date is after the termination date is cancelled from the moment the departure is recorded.
  - **Cancelled at window end.** Once the window has ended and options were cancelled at its end, exercised options are applied to the vested cells in date order. A cell stays vested only when its `cumulative` is no more than the exercised count. Every other vested cell, including one only partly covered by exercises, is cancelled.
  - **Vested.** Any other cell whose date is on or before the server date.
  - **Unvested.** Any other cell.
- After a departure, `cumulative` for every mark after the termination date stays at the cumulative on the termination date, which equals the grant's `vested`. It is never reduced by forfeiture, cancellation or exercise, so "Vested" is always the gross vested figure, and forfeited options never appear in it. The figure that drops when the window ends is Exercisable now (the grant's `exercisable`, the leaver portal tile and the labelled value on the grant page). Cost at strike and vested ownership at every mark fall with it, because they use cumulative − exercised − cancelled, where `cancelled` holds only vested options cancelled (never `forfeited`).
- A leaver's black band runs the full width of the ribbon track, directly above the cells, with the countdown at its right end. It stays after the window ends, and then reads "Window closed". A leaver's grant has no next tranche.
- The slider's month index equals the mark. The projection figures at mark m come from that Tranche's `cumulative`, `cost_at_strike` and `vested_ownership`:
  - `cost_at_strike` = max(0, cumulative − exercised − cancelled) × strike, rounded half-up to the cent.
  - `vested_ownership` = (holder's issued shares + max(0, cumulative − exercised − cancelled)) ÷ fully diluted total × 100, rounded half-up to two decimals.

**Grant states.**
- draft → board_queue on submit. This reserves the options from the pool, and votes start empty.
- board_queue → approved when approvals reach quorum.
- board_queue → draft when declines reach quorum. Votes clear and the reservation is released.
- approved → offered on send offer. `offered_at` is the server time, and `offer_expires_at` = `offered_at` + the offer window.
- offered → accepted on a sealed signature, received before `offer_expires_at`. Accepts of one grant are served one after another: when two arrive together, one accepts and seals one agreement with one ledger entry, and the other answers 409 `grant_not_offered`.
- offered → board_queue on decline. Votes clear and the reservation is kept.
- offered → expired once the server time reaches `offer_expires_at`. The end is exclusive: acceptance received at that instant or later is refused with `offer_expired`. The reservation is released, and open pages show Expired within one second.
- An offered grant whose holder departs moves to expired at once.

Every other transition is refused with the state codes in the API.

**Offer window.** The offer window is `OFFER_WINDOW_SECONDS` seconds, default 2,592,000 (30 days).

**Offer warning.** The offer warning is `OFFER_WARNING_SECONDS` seconds, default 86,400 (24 hours). An offered grant enters its warning period at `offer_warning_at`, on the server clock, or at once when it is offered with less than the offer warning left. The holder's open pages receive the warning within one second, show the "Offer warning" strip while the grant stays offered and announce it once. The strip goes when the grant is accepted, declined or expired.

**Quorum.**
- Quorum is a majority of the people whose role is board member at the time of the vote: floor(n ÷ 2) + 1, which is 2 of 3 with the seed data.
- A board member votes once per stay in the queue. A second vote is refused with `already_voted`.
- Simultaneous votes are all counted, and the grant changes state exactly once.

**Valuations.**
- The current valuation is the one with the latest `effective_on` on or before the server date. Ties go to the one recorded later.
- Its status is Current while `expires_on` is on or after the server date, and Lapsed after that. Every other valuation is Superseded.
- While there is no Current valuation, creating, submitting or offering a grant is refused with `valuation_lapsed`. The block applies from the first request on the server date after expiry.
- A strike below the current fair market value fails submit validation, and fails offer with `strike_below_fmv`. The comparison is exact to four decimals, and equality is allowed.

**Option pool.**
- Outstanding = for each accepted grant, options − exercised − cancelled − forfeited.
- Exercised = options exercised into shares.
- Reserved = options of grants in board_queue, approved or offered.
- Available = authorized − outstanding − exercised − reserved.
- Unallocated = authorized − outstanding − exercised.
- Submitting a grant larger than Available is refused with `pool_exhausted`. A resize below outstanding + exercised + reserved is refused with `pool_below_allocated`.
- Cancelled and expired options return to the pool.

**Fully diluted ownership.**
- Fully diluted total = every issued share + every outstanding option + the unallocated pool.
- Ownership uses largest remainder at two decimals:
  1. Each row's exact percentage is cut down to two decimals.
  2. The missing hundredths are given one each to the rows with the largest cut-off remainders.
  3. Ties go to the row with more fully diluted shares, then to the earlier row.
- Rows are ordered by fully diluted shares, largest first, then name A to Z. The unallocated pool row comes last, keyed `pool`, labelled "Unallocated option pool".
- The cap table is shaped by role:
  - **Founder admin:** one row per holder with fully diluted shares above 0, keyed by person id, plus the pool row.
  - **Option holder, leaver or investor:** their own row (keyed by their id, with the ownership from the founder admin's computation) and one row keyed `others`, labelled "All other holders", with ownership 100.00 minus their own.
  - **Board member:** rows keyed `common`, `series_seed`, `series_a`, `options_outstanding` and `pool`, labelled "Common", "Series Seed Preferred", "Series A Preferred", "Options outstanding" and "Unallocated option pool", with largest remainder applied across those rows.
- Every ledger change recomputes the table, and open cap tables show the new rows within one second.

For example, with the seed data at start, the founder admin's rows read:

| Row | Fully diluted | Ownership |
|---|---|---|
| Mara Okafor | 4,000,000 | 45.45 |
| Anselm Kowalczyk | 2,000,000 | 22.73 |
| Larkspur Ventures Fund II | 1,500,000 | 17.05 |
| Brightwater Angels LLC | 300,000 | 3.41 |
| Juniper Vance | 48,000 | 0.54 |
| Rafael Ostrowski | 24,000 | 0.27 |
| Unallocated option pool | 928,000 | 10.55 |

Total 8,800,000 and 100.00. The board member's rows read: Common 68.18, Series A Preferred 17.05, Series Seed Preferred 3.41, Options outstanding 0.82, Unallocated option pool 10.54.

**Ledger.**
- Every change to a holder's issued shares or outstanding options writes exactly one LedgerEntry per holder affected, in the same transaction as the change. The changes are an issuance, an accepted grant (options +), an issued exercise (options −, Common shares +), a cancellation (options −) and a tender transfer (shares − for the seller, + for the buyer).
- A pool resize writes one entry with no holder.
- Board members have no ledger.

**Exercise.**
- Exercisable = vested − exercised − cancelled − options in open (pending or held) orders. Forfeited options are excluded, because `vested` never includes them and `cancelled` holds only vested options cancelled. This formula holds for an option holder and for a leaver both before and after the window ends. An order larger than Exercisable fails validation on `options`.
- Orders for one grant are checked one after another, even when their requests arrive together under different keys, so the options of all open and issued orders never exceed what was exercisable. An order that no longer fits is refused with the same `options` field error.
- Cost = options × strike, rounded half-up to the cent once on the server. For example, 3,217 × $0.4185 = $1,346.31. The order's `cost`, the provider payment's `amount_cents` and the notice's cost line are always this one figure.
- Only accepted grants can be exercised (otherwise `grant_not_exercisable`).

**Exercise idempotency.**
- The `Idempotency-Key` is unique across all orders.
- The first request with a key creates the order. Every later request with the same key, grant and body returns that first response's status and body unchanged, including a stored 503.
- A request with the same key but a different grant or body is refused with `idempotency_key_reused`.
- Requests with one key that arrive together are served one after another. Five simultaneous requests produce one order, one payment request at the provider and five identical responses.

**Exercise payment.**
1. Placing an order records it as pending and sends one payment to the provider under the order's key.
2. The server then fetches the payment record, and keeps fetching every 2 seconds while it reads pending.
3. The order becomes issued only when the fetched record reads `confirmed` with `amount_cents` equal to the cost in cents and `reference` equal to the order id. Then the holder's Common shares rise by the options, the options leave the outstanding count, the ledger entry is written and the notice is sealed.
4. The payment request itself must be answered within 5 seconds. After a 201 answer, the response waits at most 5 more seconds for the fetched record to read confirmed. A provider that answered the payment request but whose record still reads pending after those 5 seconds leaves a 201 with the order pending, and the order becomes issued later, pushed within one second of the confirmation.
5. When the provider cannot be reached (connection refused or reset, a 5xx answer, or no answer to the payment request within 5 seconds), the order is held with 503 `provider_unavailable`, and nothing is issued. A provider that is slow to answer the payment request is therefore held, never pending.
6. A record that reads `failed`, or does not match, also holds the order.

**Retry.**
- Retry resends the same payment under the same key, then fetches the record.
- For an issued order whose notice is pending, retry seals the notice instead.
- With nothing to retry, it answers `nothing_to_retry`.
- Shares are never issued twice for one order.

**Cancel.**
- A pending or held order can be cancelled; an issued or cancelled one cannot.
- A cancel always wins over a confirmation still in flight. When a confirmation arrives for a cancelled order, nothing is issued, and the server sends the provider's cancel for that payment.
- When both arrive together, the one that commits first decides. A cancel that commits first means the order is never issued.

**Departure and leaver window.**
- Recording a departure applies only to a person with the option holder role. It sets `terminated_at` to the server time, `termination_date` to the server date and `window_ends_at` to `terminated_at` + the leaver window. The leaver window is `LEAVER_WINDOW_SECONDS` seconds, default 7,776,000 (90 days).
- The person's role becomes leaver.
- Vesting stops at the termination date. Options not vested on that date are forfeited at once: they are added to the grant's `forfeited`, never to `cancelled`, they leave the outstanding count and one options_cancelled ledger entry records them. The cells after that date turn cancelled as set out in Ribbon cells.
- An exercise received before `window_ends_at` counts, even one second before. Its order proceeds to issued, pending or held as usual, and its options are never cancelled while the order is open. The end is exclusive: an exercise received at `window_ends_at` or later is refused with `exercise_window_closed`.
- At `window_ends_at`, the server cancels every remaining exercisable option by adding it to `cancelled`, which brings `exercisable` to 0. Any read after that instant already shows them cancelled, and open pages receive it within one second.
- For example, if a departure were recorded for Juniper Vance with 21,000 of 48,000 vested and nothing exercised: before the window ends, `vested` is 21,000, `forfeited` 27,000, `cancelled` 0 and `exercisable` 21,000, and the Tranche at mark 48 has `cumulative` 21,000 and `cost_at_strike` $8,788.50. After the window ends with nothing exercised, `cancelled` is 21,000, `exercisable` 0, and every mark's `cost_at_strike` is $0.00.
- A held order cancelled after the window end returns its options as cancelled.
- The leaver warnings are `LEAVER_WARNINGS_SECONDS`, a comma-separated list of seconds, default `2592000,604800,86400` (30 days, 7 days and 1 day). At `window_ends_at` minus each value, on the server clock, the leaver's open pages receive that warning within one second, the "Window warning" strip shows it in place of any earlier warning, and the region announces it once. A page loaded after a warning time shows the strip with the latest passed warning, without announcing it. `<warning countdown>` is that value in the countdown format, for example `7d 00:00:00`. A warning time already past when the departure is recorded is skipped. The strip goes when the window ends.

**Signatures and the vault.**
- A grant agreement, exercise notice or tender NDA counts as signed only after two things happen. First, the server writes its bytes to the vault under its key, once, never overwriting or deleting. Second, the server reads the object back, and its SHA-256 equals the hash recorded for the document.
- Until both happen, the document is pending, and the dependent step does not happen: a grant stays offered, a seller cannot tender, and a notice shows pending (the shares are still issued, because the payment confirmed them).
- Accepting again, or signing again, retries the same document under the same key.
- Seeded accepted grants carry agreement status `paper` (signed before the register moved to Holdfast) and have no vault document.
- A sealed grant agreement or exercise notice is locked: its vault object, text and seal never change, and the only field of its record that can change is `superseded_by`. A correction is recorded by the founder admin as a new document of the same kind and owner, with `version` one above the version it corrects and `supersedes` naming it. Its text is exactly the text sent, stored once under `<the original's vault key without .txt>.v<version>.txt` and sealed the same way. The corrected version's `superseded_by` becomes the new id, and it stays readable byte for byte. Only the latest version of a sealed document can be corrected. A tender NDA is never corrected.

**Tenders.**
- Only one tender may be open at a time. Every Tidecraft tender is bought by Harbourline Secondary Partners.
- Eligible sellers are investors with issued shares above 0.
- A seller must have a sealed NDA for that tender before submitting (otherwise `nda_required`). They may submit once (otherwise `already_submitted`), for at most their issued shares, and only while the server time is before `closes_at`. The end is exclusive: a request at or after the close is refused with `tender_closed`.
- Each submission gets the next `sequence` in the order its insert commits.
- A seller may withdraw while the tender is open. Submitting again later gets a new sequence.
- While open:
  - remaining cap = max(0, cap − total tendered).
  - oversubscribed by = max(0, total tendered − cap).
  - Each seller's projected allocation is the allocation rule applied to the current submissions.
- At `closes_at`, the tender closes and is allocated within one second:
  - If the total tendered is within the cap, each seller sells what they tendered.
  - Otherwise each seller gets floor(tendered × cap ÷ total tendered). The leftover shares (cap minus the sum of those floors) go one each to the earliest submissions in sequence order.
  - The sum of allocations never exceeds the cap, even when submissions arrive at the same moment.
  - Proceeds = allocation × price, rounded half-up to the cent.
- Allocated shares move from each seller to Harbourline in the seller's share class, as ledger entries.
- When two sellers both stand to receive the last leftover share, only the earlier sequence gets it, and the other seller's open page shows the lower figure within one second.
- For example, a cap of 100,001 at $2.4000, with Larkspur submitting 90,000 first and Brightwater 60,000 second, allocates 60,001 to Larkspur ($144,002.40) and 40,000 to Brightwater ($96,000.00).

**Round scenario.** Inputs are a pre-money valuation, an investment and a target post-money pool percentage p. Let F be the fully diluted total and U the unallocated pool. The calculation uses exact rational arithmetic and changes nothing in the register:
1. k = p ÷ 100 × (pre-money + investment) ÷ pre-money. When k is 1 or more, the input fails validation on `target_pool_percent`.
2. Pool top-up T = max(0, ceiling((k × F − U) ÷ (1 − k))).
3. Price per share = pre-money ÷ (F + T), rounded down to $0.0001.
4. New shares N = floor(investment ÷ price).
5. Post-money fully diluted = F + T + N.
6. New investor % = N ÷ post-money × 100.
7. Pool after % = (U + T) ÷ post-money × 100.
8. Dilution % = (T + N) ÷ post-money × 100.
9. Each percentage is rounded half-up to two decimals.
10. Investment used = N × price, rounded half-up to the cent.
11. `fmv_per_share` is the current valuation's fair market value, and `price_to_fmv` = price ÷ that value, rounded half-up to two decimals and shown as "`<ratio>`×". Both are `null` whenever no valuation has the status Current (also when the latest valuation in effect is Lapsed), and the labelled value then reads "No current valuation".

Saved scenarios keep the three inputs as sent, under a name unique across the register ignoring case. Saved scenario ids are `SCN-001` upward.

For example, with the seed data at start, inputs of $40,000,000.00, $10,000,000.00 and 12.00% give:

| Output | Value |
|---|---|
| Pool top-up | 461,177 |
| Price per share | $4.3191 |
| New shares | 2,315,297 |
| Post-money fully diluted | 11,576,474 |
| New investor | 20.00% |
| Pool after | 12.00% |
| Dilution | 23.98% |
| Investment used | $9,999,999.27 |

**Visibility.**
- An option holder or leaver reads only their own grants, orders, ledger entries and documents.
- An investor reads only their own holdings, ledger entries, NDA documents and their own part of a tender.
- A board member reads only the board queue and the class summary.
- The founder admin reads everything.
- Anything else answers `not_found` (see the precedence order in the API section).

**Roles and access.**
- A role change applies on the person's very next request, and the person's open pages receive it within one second.
- Removing access ends every session of that person: their next request answers `unauthenticated`. Their socket receives the removal and is then closed. Their documents can no longer be read by them.
- People with access `none` (seeded holders without a login) cannot sign in.

**Live events.**
- Every change a person can see is pushed to that person's open pages as one event with a sequence number, within one second. Changes include grant state changes, vested tranches, expiries, order changes, cancellations, cap-table changes, tender changes, valuation changes, saved scenarios, draft changes, offer warnings, window warnings, role changes and access removals.
- The server also sends a clock event with the server time once per second. Countdowns show `window_ends_at` or `closes_at` minus the latest server time received, formatted `<D>d <HH>:<MM>:<SS>`.
- A page connecting with `since=<sequence>` first receives every event for that person after that sequence, from the most recent 1,000 events.
- A page applies and announces each sequence number once.
- After a drop, a page tries to reconnect within 2 seconds and then at least once every 5 seconds until the socket is open again.

**Drafts.** A grant in draft is the grant draft. Every field change is saved through PATCH within one second. A tender draft holds the seller's typed text per tender until they submit or the tender closes.

**Display formats.**
- Dates as `<day> <Mon> <year>`, for example 28 Feb 2027.
- Instants as `<day> <Mon> <year>, <HH>:<MM>:<SS> PT`.
- Counts with thousands separators.
- Money as `$` with thousands separators and two decimals.
- Per-share prices as `$` with four decimals.

### Services (DP-11, DP-14, DP-19, DP-20, DP-21, DP-22, DP-29, DP-45, DP-53)

**PostgreSQL (`DATABASE_URL`).** This is the register of record. It holds people, sessions, the cap table, the securities ledger, the option pool, grants and votes, valuations, orders with their idempotency keys, tenders, submissions, drafts, document records and live events. Uniqueness and row locks make each concurrency rule above hold across simultaneous requests. The app applies its schema and the seed idempotently every time it starts. It seeds only an empty register.

**MinIO document vault (`S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_FORCE_PATH_STYLE`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`).**
- Objects live in the bucket `S3_BUCKET`, each with content type `text/plain; charset=utf-8`:
  - `grant-agreements/<grant id>.txt`
  - `exercise-notices/<order id>.txt`
  - `tender-ndas/<tender id>/<person id>.txt`
- Each object is written once and never replaced or deleted. The document content endpoint returns the object's bytes unchanged.
- Document texts are UTF-8. Lines end in a single newline, numbers are formatted as in Business rules, and instants are ISO 8601 UTC.
  - Grant agreement lines: `Tidecraft Robotics, Inc. — Stock Option Grant Agreement`, `Grant: <grant id>`, `Holder: <name>`, `Options: <options>`, `Strike price: $<strike>`, `Vesting: <4 years, 1-year cliff | 4 years monthly, no cliff>, from <vesting start>`, `Signed by: <name>`, `Signed at: <instant>`.
  - Exercise notice lines: `Tidecraft Robotics, Inc. — Notice of Exercise`, `Order: <order id>`, `Grant: <grant id>`, `Holder: <name>`, `Options exercised: <options>`, `Strike price: $<strike>`, `Exercise cost: $<cost>`, `Payment reference: <payment id>`, `Issued at: <instant>`.
  - Tender NDA lines: `Tidecraft Robotics, Inc. — Tender Offer Confidentiality Agreement`, `Tender: <tender id>`, `Seller: <name>`, `Signed at: <instant>`.
- When the vault cannot be reached, every signing action answers `vault_unavailable` with the outage copy from Feedback states, and the document stays pending. Reading a document answers `vault_unavailable`. Nothing else in the app stops working.

**Quillon Pay payment provider (`WIREMOCK_URL`).** Quillon Pay's API and data are invented. The app calls it server-side only, at:
- `POST <WIREMOCK_URL>/v1/payments`, with headers `Content-Type: application/json` and `Idempotency-Key: <order key>`. The body is `{"amount_cents": <integer cents>, "currency": "USD", "reference": "<order id>", "description": "Exercise of <options> options under <grant id>"}`. It answers 201 `{"id","status":"pending","amount_cents","currency","reference"}`. For example: `{"id":"pay_134631_EXO-000001","status":"pending","amount_cents":134631,"currency":"USD","reference":"EXO-000001"}`.
- `GET <WIREMOCK_URL>/v1/payments/<payment id>` answers 200 `{"id","status":"pending|confirmed|failed","amount_cents","currency","reference","confirmed_at"}`. This is the confirmed payment record the order page shows. For example: `{"id":"pay_134631_EXO-000001","status":"confirmed","amount_cents":134631,"currency":"USD","reference":"EXO-000001","confirmed_at":"2026-11-03T17:04:05Z"}`.
- `POST <WIREMOCK_URL>/v1/payments/<payment id>/cancel` with body `{}` answers 200 `{"id","status":"cancelled","amount_cents","currency","reference"}`.

Payment ids are opaque strings that the app stores as returned and never builds itself. The provider answers the same payment for a repeated idempotency key. Outage behaviour is set out in Business rules (exercise payment), with the outage copy in Feedback states.

### Seed data (DP-01, DP-32, DP-36, DP-39, DP-41)

Every seeded person, company and firm is invented. Every login uses the password `Tidecraft-demo-2026`. "Seed time" means the moment the register is first seeded on an empty database.

| Id | Name | First name | Email | Role | Access | Holdings |
|---|---|---|---|---|---|---|
| PER-001 | Mara Okafor | Mara | mara@tidecraft.example | founder_admin | active | 4,000,000 Common |
| PER-002 | Anselm Kowalczyk | Anselm | anselm@tidecraft.example | option_holder | none | 2,000,000 Common |
| PER-003 | Juniper Vance | Juniper | juniper@tidecraft.example | option_holder | active | grant TC-OPT-0007 |
| PER-004 | Kenji Moreau | Kenji | kenji@tidecraft.example | option_holder | active | grant TC-OPT-0011 (offered) |
| PER-005 | Rafael Ostrowski | Rafael | rafael@tidecraft.example | leaver | active | grant TC-OPT-0004 |
| PER-006 | Larkspur Ventures Fund II | Larkspur | larkspur@larkspur.example | investor | active | 1,500,000 Series A Preferred |
| PER-007 | Brightwater Angels LLC | Brightwater | brightwater@brightwater.example | investor | active | 300,000 Series Seed Preferred |
| PER-008 | Priya Natarajan | Priya | priya@tidecraft.example | board_member | active | none |
| PER-009 | Theo Blackwood | Theo | theo@tidecraft.example | board_member | active | none |
| PER-010 | Wen Castellanos | Wen | wen@tidecraft.example | board_member | active | none |
| PER-011 | Harbourline Secondary Partners | Harbourline | harbourline@harbourline.example | investor | none | none (tender buyer) |

Grants:
- **TC-OPT-0004** (Rafael Ostrowski): 24,000 options, strike $0.2210, `standard`, vesting start 2021-06-30, accepted, agreement `paper`. It is fully vested with nothing exercised. The departure was recorded at seed time, so `window_ends_at` is seed time plus the leaver window.
- **TC-OPT-0007** (Juniper Vance): 48,000 options, strike $0.4185, `standard`, vesting start 2025-01-31, accepted, agreement `paper`, nothing exercised.
- **TC-OPT-0011** (Kenji Moreau): 12,000 options, strike $0.6120, `standard`, vesting start 2026-11-02. Approved by Priya Natarajan and Theo Blackwood and offered at seed time, so `offer_expires_at` is seed time plus the offer window.

The next new grant is TC-OPT-0012. Orders start at EXO-000001, tenders at TND-001, documents at DOC-000001 and people at PER-012.

Option pool: 1,000,000 authorized. At start, outstanding is 72,000, exercised 0, reserved 12,000, available 916,000 and unallocated 928,000.

Valuations:
- **VAL-01**: effective 2024-12-01, expires 2025-11-30, $0.4185, Marrowgate Valuation Partners.
- **VAL-02**: effective 2026-10-01, expires 2027-09-30, $0.6120, Marrowgate Valuation Partners.

No tender, order or vault document exists at start. The ledger starts with one issuance entry for each seeded share holding and one grant_accepted entry for each of TC-OPT-0004 and TC-OPT-0007.

## Technical requirements

### Deployment (DP-50)

- The app is written in TypeScript and runs on Node.js 22, with npm available.
- `/app/run.json` holds string commands `install`, `build` and `serve`, plus `"_schema":"run-manifest-v1"`. For example: `{"_schema":"run-manifest-v1","install":"npm ci","build":"npm run build","serve":"npm run start"}`.
- The server binds `0.0.0.0` on port 4173, or on `APP_PUBLIC_PORT` when that is set.
- `GET /api/health` returns HTTP 200 with JSON `{"status":"ok"}` whenever the process is serving, including while any dependency is unreachable.
- Schema and seed are applied on every start, idempotently.

### Configuration and secrets (DP-51)

These are read from the environment at start:
- PostgreSQL: `DATABASE_URL`.
- Vault: `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_FORCE_PATH_STYLE`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`.
- Payment provider: `WIREMOCK_URL`.
- Offer window in seconds: `OFFER_WINDOW_SECONDS`, default 2592000.
- Leaver window in seconds: `LEAVER_WINDOW_SECONDS`, default 7776000.
- Offer warning in seconds: `OFFER_WARNING_SECONDS`, default 86400.
- Leaver warnings in seconds: `LEAVER_WARNINGS_SECONDS`, default 2592000,604800,86400.
- Port: `APP_PUBLIC_PORT`.

No URL, key or password for these is written in source. None of them is ever sent to the browser in a page, script, API response or socket message.

### Server boundary (DP-52, DP-53)

- **Same origin only.**
  - The browser loads every page, script, font, image and the WebSocket from the app's own origin. There are no third-party requests, so fonts and photographs ship with the app.
  - The server sends no cross-origin permission headers.
  - The server refuses WebSocket upgrades whose `Origin` is another origin, as stated in the API.
  - Every state-changing request whose `Origin` header names another origin is refused with 403 `forbidden`.
- **Request bodies.**
  - A body of 65,536 bytes is allowed. A body larger than that is refused with 413 `payload_too_large`.
  - A request with a body but a content type other than `application/json` is refused with 415 `unsupported_media_type`.
  - Malformed JSON is refused with 400 `bad_json`.
  - These checks run before all others.
- **Unknown paths.** An unknown `/api` path answers 404 `not_found`.
- **What the server never serves.** It never serves source files, source maps, environment files, the run manifest, lockfiles or anything outside the built browser assets and the API.
- **Session cookie.** It is HttpOnly and SameSite=Lax.
- **Dependencies unreachable at boot.**
  - When the vault or the payment provider is unreachable at start, the app boots and serves every page. Each action that needs the missing dependency answers its own 503 with the Feedback states copy. Once the dependency answers, the next request or retry succeeds, with no restart.
  - When PostgreSQL is unreachable at start, the app keeps retrying the connection every 2 seconds. Health answers ok, and every other `/api` request answers 503 `register_unavailable` until the connection succeeds.

### Browser support and performance (DP-04, DP-32, DP-54)

- The app supports current Chromium, Firefox and WebKit, at 375 × 812, 768 × 1024 and 1280 × 800, with touch and with reduced motion.
- The portal board, tranche ribbon and cap table are drawn complete, with every cell and row, on the first render after the page loads. They are usable within three seconds of navigation.
- Every API response other than an exercise that is waiting on the provider returns within one second with the seed data.
- Live changes reach every open page within one second.

## Working rules

- IF-01: `/app/run.json` exists with string `install`, `build` and `serve` commands and `"_schema":"run-manifest-v1"`, and the app is started only through it.
- IF-02: `THIRD_PARTY_NOTICES.md` at `/app` lists every shipped package, the two Funnel typefaces, the four photographs and the icon set, each with its licence.
- IF-03: Shipped packages are the production dependency tree as reported by `npm ls --omit=dev --all --json`. Shipped packages and bundled assets use only the MIT, Apache-2.0, BSD-2-Clause, BSD-3-Clause, ISC, 0BSD, OFL-1.1 or CC0-1.0 licences.
- IF-04: The app uses no datastore or service other than the provided PostgreSQL database, the MinIO bucket and the payment provider at `WIREMOCK_URL`. There is no SQLite, no file-based store and no other cache server.
- IF-05: The provided service configuration (the dev compose service definitions and their credentials) is left unchanged.
- IF-06: All server and browser code is TypeScript. The type checker runs in strict mode during the build.
- IF-07: The Funnel Display and Funnel Sans font files and the photographs are committed inside `/app` and served by the app itself.

## Engineering standards

- The code is idiomatic TypeScript under strict type checking, with no `any` and no non-null assertions to get past the checker.
- Names in code match the domain terms in this brief: grant, tranche, cliff, offer window, leaver window, exercise order, payment record, vault, seal, tender, allocation, valuation, fully diluted, ledger entry.
- Each domain rule is decided in exactly one place in the source, and every caller uses it. Rules here include the vesting schedule, cost rounding, largest-remainder ownership, pro rata allocation, the round scenario arithmetic, each grant and order state transition, and each window edge.
- There is no abstraction with a single implementation and no interface written for a single type.
- There is no dead, commented-out or unreachable code, and no defensive check for a state that the types or the database constraints already rule out.
- Every API error is produced in the one error shape from the API section, through one shared path.
- Money and per-share prices are handled as exact integer cents or exact decimals, never as binary floating point.
- There are no features, endpoints, screens or settings beyond this brief.
