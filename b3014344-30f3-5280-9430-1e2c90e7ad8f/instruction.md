# Pampero Build Co. Pampero Ledger

Pampero Ledger is the storefront and client ledger of Pampero Build Co., a one-person web design-and-build studio in Buenos Aires. Prospects walk through the studio's work on a scroll-driven 3D site, compare three plans in US dollars or Argentine pesos, and buy one without a sales call. Clients then pay a deposit and a launch balance, or run a monthly care plan, and share brand files and deliverables with the studio and its contractors through a portal. The studio owner runs pricing, projects, refunds and credits from a studio console. The product uses five services: Kill Bill for billing, Mailpit as the mail server, MinIO for file storage, PocketBase as the CMS for case studies and journal posts, and Postgres for the order and project ledger. Out of scope: a live card processor (card checks are simulated with published test numbers), tax calculation, contracts and e-signature, chat, time tracking, any sign-in provider other than the product's own email and password, and any datastore beyond the five services.

## Problem and users

One-person web studios in Argentina sell to two kinds of client. Foreign clients pay in US dollars. Local businesses pay in pesos, and peso prices go up every few weeks because of inflation. Today the founder writes quotes in a document, takes the deposit in one tool, chases the launch balance in another, and hands over brand files through shared-drive links that contractors keep long after a project ends. Every gap costs the founder money. A client accepts a peso quote and is then invoiced at the newer price. A 40/60 split leaves the balance off by a centavo. A mid-month care-plan downgrade is prorated by hand and then disputed. A double-tapped Pay button on a phone charges the client twice. A contractor who finished in March can still open the client's brand folder in June. Freelancer suites handle proposals and invoices, but they do not lock a per-order price in a second currency, they do not let the client preview a prorated plan change, and they do not cut a contractor's file access when the project closes. Many of them also cannot take payments from clients outside North America.

Users:

- **Prospect** (occasional): explores the studio's work on the 3D site, compares the three plans in dollars or pesos and buys one without a call.
- **Client owner** (weekly): pays the deposit and the launch balance, or runs a care plan and changes, pauses or cancels it; uploads brand assets; downloads deliverables and invoice PDFs; invites teammates.
- **Client teammate** (weekly): uploads assets and fetches deliverables on the projects of the client account that invited them, and has no access to billing.
- **Studio owner** (daily): publishes and withdraws case studies and journal posts, sets effective-dated peso prices, assigns contractors, moves builds forward, issues partial refunds and credits, and closes projects.
- **Contractor** (daily): sees only the projects assigned to them, reads each client's brand assets and uploads deliverables until the project closes.

## Journeys

1. **Peso prospect buys a site build.** Start: a signed-out visitor on the home page. They scroll past the hero, tab through the case-study deck, open one case study and come back. In the pricing section they switch the currency to ARS, choose Studio Site and watch the quote sheet fold to the peso deposit and launch balance. They press Start checkout, enter their business details and a password, accept the quote, enter the approving test card and press Pay. End: the receipt page for their order shows the deposit paid in pesos. The receipt email has the same figure, and the portal shows a new project.
2. **Studio owner runs a build through to close.** Start: an order in deposit_paid. The studio owner assigns a contractor and starts the build. Mid-build the owner raises the Studio Site peso price for new buyers. The owner then invoices the launch balance, which uses the price locked when the client accepted. The client owner follows the invoice email to the invoices page, presses Pay launch balance, pays the balance and lands on the new receipt. The studio owner closes the project. End: the order is paid_in_full and then closed, and the contractor's next request for that project, or for a download link they opened earlier, is refused.
3. **Client owner shares the portal.** Start: a client owner on a project page. They invite a teammate by email. The teammate opens the emailed link, sets a password and lands on the same project page. The teammate uploads the logo, with progress announced. The assigned contractor downloads the logo and uploads a homepage mockup. End: the client owner downloads the mockup and, from the invoices page, the deposit invoice PDF.
4. **Client owner changes a care plan.** Start: a client owner on the plan page of an active Care Plus plan. They choose Switch to Care Lite. A dialog previews the credit for unused days, the Lite charge and the net total on the folded sheet, and the result is announced. They confirm. End: the plan page shows Care Lite, and Kill Bill's invoice carries exactly the previewed figures. Later the owner schedules a pause, resumes, and then cancels at period end. Each time they see the date billing confirmed.
5. **A renewal fails.** Start: a peso care plan whose renewal was declined. The plan page shows the past-due banner, and the owner has a dunning email. Retries run on the published dunning days, each failure sends one more notice, and the plan is cancelled after the last failure. In the variant where the owner acts first, they save the approving card, the open renewal is paid at once and the plan is active again.
6. **Studio owner refunds and credits.** Start: a paid order in the studio console. The owner refunds part of the deposit. The refunded total and the amount left update in place, and the client gets one refund email. The owner adds an account credit in the account's currency, and billing applies it to the next invoice.
7. **Billing is down at checkout.** Start: a client owner on the checkout page with every field filled in. They press Pay while billing is unreachable. End: the billing-outage banner shows word for word, nothing is charged, and every field keeps its value. When billing is reachable again, pressing Pay once more pays the order, with nothing left over from the failed attempt.

## Mandatory requirements

This is the complete list of mandatory requirements; every check traces to one of these lines and the detailed sections below.

- **DP-01 — Published work and journal** The home page's card deck and the journal page list exactly the case studies and journal posts the CMS holds as published, newest first, and each one opens its own detail route.
- **DP-02 — Entry publishing lifecycle** The studio owner moves each entry only from draft to published to withdrawn, every other move is refused, and a withdrawn entry leaves the deck and its detail route shows the not-found page within the delay set in Business rules.
- **DP-03 — Case-study open** Activating a case-study card carries it out of the deck into its detail route with the published open motion, or at once under reduced motion, and going back returns focus to that card.
- **DP-04 — Keyboard exploration journey** A prospect using only the keyboard moves through the case-study deck, opens a case study, comes back to the same card and reaches the pricing section, with focus always visible.
- **DP-05 — Server quotes** Every quote is computed on the server to the cent in the chosen currency, with a build's deposit and launch balance split by the published rule and a care plan's first month due in full.
- **DP-06 — One money format** Every amount appears in its currency's published format, and the plan card, the quote sheet, the order summary, the Kill Bill invoice and the receipt email carry the same figure to the centavo.
- **DP-07 — Fold-line quote sheet** Each plan, tier or currency pick sends one quote request; the sheet lies flat with the quoting label while it is in flight, then the crease slides to the due-now share, the panels tilt open and the numerals count to the server's figures, or the sheet stays flat with the pricing outage copy.
- **DP-08 — In-place quote updates** Plan, tier and currency changes update the plan cards, the quote sheet, the total and the split on the same page without a reload and announce the result sentence in the quote live region.
- **DP-09 — Published breakpoints** At 375, 768 and 1280 pixels wide the public pages show the column count, navigation style and due-now and due-at-launch arrangement set in Screens and layout, with nothing scrolling sideways.
- **DP-10 — Pricing journey** A prospect switches pricing to pesos, chooses Studio Site, reads the peso split on the sheet and starts checkout on the published checkout route showing the same figures.
- **DP-11 — Quote acceptance** Accepting a quote creates or reuses the client account, fixes the account's currency at its first order, locks the order's price at the acceptance instant, and is refused with the new figures when the price changed after the quote.
- **DP-12 — Deposit payment** Paying an accepted order authorizes and then captures the due-now amount in Kill Bill on the client's account, queues one receipt, creates the order's portal folder and moves the order to deposit_paid, or to paid_in_full for a care plan.
- **DP-13 — One payment per Pay intent** Repeating a Pay request with the same key returns the first response without charging again, reusing the key with a different body is refused, and simultaneous Pay requests for one order produce exactly one payment.
- **DP-14 — All-or-nothing payment** When billing or storage fails during Pay, the authorization is voided and no open deposit invoice, portal folder, receipt or ledger entry remains, and the order stays accepted, as qualified in Business rules.
- **DP-15 — Test cards** Pay approves the published approving test card, refuses the published declining card with nothing recorded, and rejects malformed card fields with field errors.
- **DP-16 — Checkout journey** A prospect completes acceptance and payment with the keyboard alone, lands on the order's receipt route showing the paid amount, and reloading that address shows the same receipt.
- **DP-17 — Effective-dated peso prices** The studio owner sets a new peso price for a plan from a stated instant, and quotes, plan cards and new acceptances use the price in effect at the moment of each request.
- **DP-18 — Locked acceptance price** Every later invoice of an accepted order, its launch balance and every care-plan renewal included, uses the price locked at acceptance whatever peso prices took effect afterwards.
- **DP-19 — Price change journey** After the studio owner raises the Studio Site peso price, a client whose order was accepted earlier is invoiced the launch balance at the locked price while a new prospect is quoted the new price.
- **DP-20 — Build order lifecycle** A build order moves only along quoted, accepted, deposit_paid, in_build, balance_invoiced, paid_in_full and closed, and every other move is refused with the order's current state.
- **DP-21 — Launch balance invoice** Invoicing the launch balance creates one Kill Bill invoice for the locked balance, sends one invoice notice and stores the invoice PDF in the order's portal folder.
- **DP-22 — Balance payment** The client owner pays the open launch balance under the same Pay rules as the deposit, and the order becomes paid_in_full with its own receipt.
- **DP-23 — Launch balance journey** A client owner follows the invoice notice to the portal, pays the launch balance and lands on the receipt route for that payment.
- **DP-24 — Partial refunds** The studio owner refunds part of a captured deposit or launch balance payment through Kill Bill, refunds on one payment never sum above it even when issued at the same moment, and the client owner receives one refund notice per refund.
- **DP-25 — Account credits** The studio owner credits a client account only in that account's currency, Kill Bill holds the credit and applies it to the account's next invoice, and the client owner receives one credit notice.
- **DP-26 — Refund journey** The studio owner opens the refund dialog for an order in the studio console, refunds part of the deposit and sees the refunded total and the amount left on that payment update in place.
- **DP-27 — Care plan purchase** Paying a care-plan order creates a monthly Kill Bill subscription at the locked price, pays its first invoice, and answers only after Kill Bill has invoiced the first period.
- **DP-28 — Plan change preview** A client owner previewing a care tier change gets billing's credit for the unused days of the current tier and charge for the new tier, from whole Buenos Aires days left in the period, shown on the sheet and announced in the plan live region.
- **DP-29 — Confirmed change equals preview** Confirming a preview changes the plan in Kill Bill at once with exactly the previewed credit, charge and total, is refused as expired when the preview has expired, and is refused with fresh figures when billing would now charge differently.
- **DP-30 — Preview survives timers** The plan-change dialog stays open with a usable confirm button while the studio clock ticks and the plan page polls, until the client owner confirms or dismisses it.
- **DP-31 — Plan change journey** A client owner switches care tier from the plan page with the keyboard, confirms in the dialog and stays on the published plan route showing the new tier, which a reload keeps.
- **DP-32 — Billing-confirmed plan state** The plan status, plan dates and invoice statuses in the portal are read from Kill Bill, an action's new state appears only after Kill Bill confirms it, and while billing is unreachable the plan page shows the plan outage copy instead of any status.
- **DP-33 — Pause and resume** Pausing an active plan schedules the pause for the end of the paid period as Kill Bill dates it, and resuming either drops a scheduled pause or restarts a paused plan from the current business day.
- **DP-34 — End-of-term cancel** Cancelling an active plan keeps it running to the end of the paid period, with an end date equal to Kill Bill's charged-through date, as qualified in Business rules.
- **DP-35 — Pause and cancel journey** A client owner schedules a pause, resumes, then cancels at period end, and after each action stays on the published plan route showing the date billing confirmed.
- **DP-36 — Renewal dunning** A failed care-plan renewal makes the plan past due, retries on the published dunning days, sends one dunning notice per failed attempt even with several app processes running, and cancels the plan after the last failed retry.
- **DP-37 — Card update settles past due** When the owner of a past-due plan saves a card that approves, the open renewal invoice is paid at once, one receipt is sent and the plan is active again.
- **DP-38 — Past-due recovery journey** The owner of a past-due plan sees the past-due banner on the plan page, updates the card with the keyboard and sees the plan active without leaving the plan route.
- **DP-39 — Upload allowlist** Uploads accept only the published file types, judged by the file's content, up to the published size limit, and refuse oversized files, renamed executables, scripted SVG files and unsafe names before anything reaches storage.
- **DP-40 — Upload progress announced** Each upload's progress, success, refusal and any storage outage are announced in the upload live region with the published copy.
- **DP-41 — Download links** Every file and invoice PDF download goes through a short-lived link that the server checks against the requester's current access on each use, so an expired link or ended access stops it.
- **DP-42 — Invoice PDFs** Every Kill Bill invoice of a client account gets a PDF in its order's portal folder within the published delay, downloadable by the client owner from the invoices page.
- **DP-43 — Portal files journey** A client owner uploads a brand asset on a project page, downloads a deliverable there and downloads an invoice PDF from the invoices page.
- **DP-44 — Teammate invites** A client owner invites a teammate by email from a project, the emailed link works once until it expires, and accepting it creates the teammate's sign-in on that client account.
- **DP-45 — Teammate scope** A teammate reads and uploads files on every project of the inviting account and is refused on that account's orders, invoices, care plan and invites.
- **DP-46 — Invite journey** An invited teammate opens the emailed link, sets a name and password, and lands on the project page of the project the invite came from.
- **DP-47 — Contractor scope** A contractor sees only the open projects assigned to them, can read those projects' brand assets and upload deliverables, and sees nothing of orders, invoices or plans.
- **DP-48 — Access ends at close** When the studio owner closes a project, each contractor assigned to it is refused with the access-ended response on their next request for its page, its files or a download link issued earlier.
- **DP-49 — Uniform not-found** Any order, project, invoice, file or invite id the requester may not see, malformed ids included, gets the same not-found response as an id that does not exist, in the API and on pages.
- **DP-50 — Contractor journey** A contractor signs in, opens an assigned project, downloads a brand asset and uploads a deliverable that the client owner then sees on the same project.
- **DP-51 — Billing outage at checkout** Pressing Pay while billing is unreachable shows the billing-outage banner word for word, charges nothing and keeps every value the client typed.
- **DP-52 — Storage and mail outages** While storage is unreachable, uploads and downloads are refused with the storage copy, and while mail is unreachable payments still succeed and each queued email is delivered exactly once within the published delay, as qualified in Services.
- **DP-53 — Recovery without restart** The app starts and answers its health check with any service down, reports each service's state, and keeps serving every action that does not need the unreachable service, as qualified in Server boundary.
- **DP-54 — Run manifest and health** The app installs, builds and serves from its run manifest on the published port and answers the published health check.
- **DP-55 — Sign-in and sessions** People sign in with email and password and land on their role's home route, protected API calls without a session are refused as unauthenticated, and protected pages send signed-out visitors to sign-in.
- **DP-56 — Keyboard dialogs and drawer** Every dialog and the navigation drawer keep Tab and Shift+Tab inside while open, close on Escape, return focus to the control that opened them, and the pricing currency shortcut works from any control in that section.
- **DP-57 — Studio scene** The home page's 3D stage pins one object per section, moves its camera only as the page scrolls and reverses it on the way back, turns the hero monolith at the published pace, holds a still camera per section under reduced motion, and falls back to still drawings without WebGL.
- **DP-58 — Footer studio clock** Every page's footer shows the studio's Buenos Aires time taken from the server and ticking every second in the browser.
- **DP-59 — Visual identity** The public site reads as warm bone paper with near-black ink, a cobalt accent, a red-orange seam on the fold, expressive display type, mono tabular amounts and airy spacing, and the portal is a plain two-pane ledger in the same palette.
- **DP-60 — Source integrity** Credentials and service addresses come only from the environment, every billing, storage, mail and CMS state the app shows comes from calls to those services, and every 3D object is built from procedural geometry.

## Frontend

### Screens and layout (DP-01, DP-03, DP-09, DP-10, DP-16, DP-23, DP-31, DP-35, DP-38, DP-43, DP-46, DP-58, DP-59)

The three published viewports are 375x812, 768x1024 and 1280x800. No screen scrolls sideways at any of them. Layout changes happen at exactly two widths: below 600 pixels, and from 1024 pixels up. No other breakpoint changes which layout a published viewport gets.

**Public site.** A full-bleed 3D stage sits behind the page. Over it, a twelve-column layout carries body text at a reading width of about 72 characters. Every public page has a header with the brand name and the main navigation. Every page, portal and studio included, has a footer with the studio clock and the contact address.

- Main navigation: a Menu button opening a drawer at 375 and 768; an inline row of links at 1280.
- `/` home, in this order:
  - Hero: brand line, one-sentence pitch and the pinned monolith.
  - Work: the case-study card deck. Cards stack in one column at 375, two at 768 and three at 1280. Each card shows title, client, year and summary.
  - Process: four numbered steps (Quote, Deposit, Build, Launch) beside the pinned process rail.
  - Pricing: the currency switch, three plan cards in the order Launch Page, Studio Site, Care, then the quote sheet and the Start checkout button. Plan cards sit in one column at 375. At 768 they sit in two columns, with Care on a second row aligned left. At 1280 they sit in three columns. Inside the quote sheet, the due-now and due-at-launch figures are stacked (due now above) at 375 and side by side (due now on the left) at 768 and 1280.
  - Contact: the studio email address as a mail link.
- `/work/<slug>`: one case study. Title as the page heading, client, year, summary, body and a Back to work link.
- `/journal`: journal posts newest first. `/journal/<slug>` shows one post.
- `/sign-in`: email and password form.
- `/checkout/<order id>`: the order summary (plan name, currency, the quote sheet with the order's figures), then the Accept quote form, then the Payment form. The Payment form is enabled only once the order is accepted, or when the order awaits its launch balance. At 375 everything is one column. At 768 and 1280 the summary sits on the left and the forms on the right.
- `/orders/<order id>/receipt`: the receipt for the order's latest captured payment. Shows the heading, order number, payment kind, amount, capture time in studio local time, the receipt-email line and a link to the portal.
- `/invite/<token>`: business name, project name, and a form for name and password.
- The not-found page and the access-ended page: one heading each with the copy from Feedback states, plus a link home.

**Portal.** Plain two-pane ledger with no 3D stage. A left pane holds the portal navigation (Overview, Projects, Plan, Invoices; contractors and teammates see only Overview and Projects). The right pane holds the content. At 375 the navigation becomes a wrapping row of links above the content. At 768 and 1280 it is a left column about a quarter of the width.

- `/portal`: overview. Client owners see orders (each order in balance_invoiced carries the Pay launch balance link), the plan summary and projects. Teammates see their account's projects. Contractors see their assigned open projects.
- `/portal/projects/<project id>`: project heading (business name and plan name), order state, Brand assets list with uploader and size, Deliverables list, assigned contractors (shown to the client owner and the studio owner), the upload controls each role may use, the published allowlist sentence, and the Invite teammate button for the client owner.
- `/portal/plan`: the care plan. Shows tier, monthly price, status label, period start, charged-through date and any pause or end date. Below come the actions allowed in the current status, and the past-due banner with the Update card form when the status is past due. The page refreshes plan data every 15 seconds while open.
- `/portal/invoices`: the invoices table, newest first. Each open launch-balance invoice row carries the Pay launch balance link.

**Studio console.** `/studio`: the Orders table (number, client, plan, currency, state, total, paid, refunded, actions), a Peso prices form with the price schedule below it, a Contractors assignment control on each build order, and the Entries table for the CMS. One column at 375. Tables scroll inside their own frame at 375 and 768 so the page itself never scrolls sideways.

### Public screens and controls (DP-04, DP-07, DP-08, DP-16, DP-26, DP-30, DP-31, DP-38, DP-40, DP-43, DP-46, DP-55, DP-56, DP-58)

Only these roles, names and visible copy are public. Everything else is free. `<…>` marks a value described elsewhere. Amounts use the money format from Business rules.

| Where | Role and accessible name | Visible copy / notes |
|---|---|---|
| Every page | `link "Skip to content"` | First focusable element |
| Every page | `navigation "Main"` with links `Work`, `Process`, `Pricing`, `Journal`, and `Sign in` (signed out) or `Portal` (signed in) | |
| 375, 768 | `button "Menu"` opening `dialog "Menu"` | The dialog holds the main navigation links and `button "Close menu"` |
| Every page footer | `timer "Studio time"` | `Studio time HH:MM:SS`, 24-hour |
| Home | `region "Work"` containing `list "Case studies"`, one `link "<case study title>"` per card | |
| Home | `region "Pricing"` containing `radiogroup "Currency"` with radios `USD` and `ARS` | USD checked on first load |
| Home | `article` per plan, named by its heading `Launch Page`, `Studio Site`, `Care` | Each shows its current price; Care shows `<amount> / month` |
| Home, Care card | `radiogroup "Care tier"` with radios `Lite` and `Plus` | Lite checked on first load |
| Home | `button "Choose Launch Page"`, `button "Choose Studio Site"`, `button "Choose Care"` | The chosen card's button has pressed state true; Studio Site is chosen on first load |
| Home, checkout, plan dialog | `region "Quote"` | Carries `data-state` (`quoting`, `ready` or `outage`), `data-crease` (current crease position, 0 to 100, one decimal) and `data-tilt` (current panel tilt in degrees, 0 to 18) |
| Inside `region "Quote"` (purchase) | `group "Due now"` and `group "Due at launch"`, each with its amount; total line `Total <total>` | |
| Inside `region "Quote"` (plan change) | `group "Credit"` and `group "New plan charge"`; total line `Total <total>` | |
| Inside `region "Quote"`, reduced motion | `table "Quote"` with the two panel names as column headers and a `Total` row | Replaces the folding sheet |
| Home, checkout | `status "Quote status"` | Polite live region |
| Home | `button "Start checkout"` | |
| Case study | `heading` level 1 with the title; `link "Back to work"` | |
| Journal | `list "Journal posts"` | |
| Sign-in | Fields labelled `Email`, `Password`; `button "Sign in"`; `alert` for errors | |
| Checkout | `region "Order summary"` | |
| Checkout | `form "Accept quote"`: fields `Business name`, `Your name`, `Email`, `Password` (all four shown only when signed out), `checkbox "I accept the scope and price in this quote"`, `button "Accept quote"`, `link "Already a client? Sign in"` | |
| Checkout | `form "Payment"`: fields `Card number`, `Expiry (MM/YY)`, `CVC`; `button "Pay <amount due>"` | `<amount due>` is the order's due-now amount, or the open launch balance |
| Checkout | `alert` banner for billing and storage outages | |
| Checkout | `status "Checkout status"` | Polite live region |
| Receipt | `heading` level 1 `Payment received`; `link "Go to your portal"` | |
| Portal | `navigation "Portal"` with links `Overview`, `Projects`, `Plan`, `Invoices` (as the role allows) | |
| Project | `region "Brand assets"` and `region "Deliverables"`, each with a `list`; per file `button "Download <file name>"` | |
| Project | File inputs labelled `Upload brand asset` (client owner, teammate) and `Upload deliverable` (studio owner, assigned contractor) | Allowlist sentence beside them: `Accepted: PNG, JPEG, WebP, SVG, PDF, WOFF2, OTF and TTF, up to 10 MB each.` |
| Project | `status "Upload status"` | Polite live region |
| Project | `button "Invite teammate"` opening `dialog "Invite teammate"` with field `Email`, `button "Send invite"`, `button "Close"`; `status "Invite status"` | Client owner only |
| Plan | Status text `Status: <label>` | Labels: `Active`, `Paused`, `Pauses on <date>`, `Ends on <date>`, `Past due`, `Cancelled` |
| Plan | `button "Switch to Care Lite"` or `button "Switch to Care Plus"` (the tier not held) | Active plans with no scheduled pause only |
| Plan | `dialog "Confirm plan change"` containing `region "Quote"`, `button "Confirm change"`, `button "Keep current plan"` | |
| Plan | `button "Pause plan"`, `button "Resume plan"`, `button "Cancel plan"` (as status allows) | |
| Plan | `dialog "Cancel care plan"` with `button "Cancel at period end"` and `button "Keep plan"` | |
| Plan | `alert` past-due banner; `form "Update card"` with the three card fields and `button "Update card and pay"` | Past due only |
| Plan | `status "Plan status"` | Polite live region |
| Invoices | `table "Invoices"` with columns `Number`, `Date`, `Description`, `Amount`, `Status`, `PDF`; per row `button "Download invoice <number>"` | Status labels `Paid`, `Open`, `Void`, `Credit` |
| Invoices, Overview | `link "Pay launch balance"` on each open launch-balance invoice row (Invoices) and on each order in balance_invoiced (Overview) | Goes to `/checkout/<order id>`, where the Payment form is enabled for the open launch balance |
| Studio | `table "Orders"`; per row as the state allows `button "Start build"`, `button "Invoice launch balance"`, `button "Close project"`, `button "Refund"` | |
| Studio | `dialog "Issue refund"`: `radiogroup "Payment"` with radios `Deposit` and `Launch balance`, fields `Amount` and `Reason`, `button "Issue refund"`, `button "Close"`; `status "Refund status"` | Shows `Refunded so far <amount>` and `Left on this payment <amount>` |
| Studio | `form "Peso prices"` with `Plan`, `Amount (ARS)`, `Effective from`, `button "Schedule price"` | |
| Studio | `table "Entries"`; per row `button "Publish"` or `button "Withdraw"` as the state allows | |

### Interactions (DP-03, DP-04, DP-07, DP-08, DP-16, DP-30, DP-31, DP-38, DP-56)

- **Tab order on the home page.** Skip link, then the main navigation (or the Menu button), then the case-study links in deck order, the currency radios, the plan articles' Choose buttons with the Care tier radios inside the Care card, Start checkout, and the contact link. Arrow keys move inside each radio group. Every focused control shows a clearly visible cobalt focus ring.
- **Currency shortcut.** While focus is anywhere inside `region "Pricing"`, pressing the C key toggles the currency between USD and ARS, exactly as clicking the other radio would. The key does nothing outside that region.
- **Case-study open.** Enter, a click or a tap on a card opens `/work/<slug>`. Escape on a case-study page, Back to work, or the browser's back button returns to `/` with the deck scrolled into view and focus on the card that was opened.
- **Choosing.** Choosing a plan or a care tier, or switching currency, starts one quote request as described in Motion and effects. A newer pick supersedes an older one. Only the latest request's answer is shown, and an earlier answer that arrives late is ignored. Start checkout creates a quoted order for the current pick and navigates to its checkout route.
- **Checkout.** Signed-out prospects fill in the four account fields and tick the acceptance box. Accept quote submits. On success the Payment form becomes active and focus moves to Card number. Pay submits once. While the request is pending the button is disabled and shows its pending state, so a second press sends nothing. The page keeps one Pay intent key from the moment the Payment form is filled until a Pay succeeds. The key changes whenever a card field changes, and a retry after a dropped connection reuses it. On success the browser goes to `/orders/<order id>/receipt`. On any error every typed value stays in its field.
- **Plan change.** Switch to Care Lite or Plus opens `dialog "Confirm plan change"` and requests a preview at the same moment. The sheet inside shows Quoting… and then the figures. Confirm change is enabled once figures are shown. Keep current plan, Escape, or Close dismisses the dialog. The 15-second plan refresh and the footer clock never close the dialog, move focus out of it, disable Confirm change, or replace a message the dialog is showing. After a confirmed change the dialog closes, focus returns to the switch button (now naming the other tier), and the URL stays `/portal/plan`.
- **Pause, resume, cancel.** Pause plan and Resume plan act at once. Cancel plan opens `dialog "Cancel care plan"`. Every action leaves the browser on `/portal/plan`.
- **Dialogs and drawer.** Every dialog and the Menu drawer keep Tab and Shift+Tab cycling inside it, wrapping from the last control to the first and back. Escape closes it, and focus returns to the control that opened it. The page behind cannot be reached by keyboard while it is open.
- **Invite accept.** Submitting the invite form signs the teammate in and goes to `/portal/projects/<project id>` of the project the invite came from.
- **Sign-in landing.** After sign-in the browser goes to the `next` address it came from, if any. Otherwise client owners and teammates go to `/portal`, contractors to `/portal`, and the studio owner to `/studio`. Signing in during checkout keeps the quoted order and returns to its checkout route.
- **Touch.** Every action is reachable by tap. Nothing needs hover, a swipe or a long press.
- **Scrolling.** The browser's own scrolling is used. Nothing hijacks the wheel, keys or touch.

### Visual design (DP-59)

- **Colour.** The ground is a warm bone paper, a light off-white with a hint of beige, never black. Text and lines are a near-black ink with a slight blue cast. One cobalt blue marks actions, links, the chosen plan and focus rings. A red-orange seam colour is kept for the fold crease, the outage banner's edge and destructive buttons. Text set in it is always ink on a pale tint, never red-orange body text. A warm grey-brown handles dividers, inactive tracks and large secondary labels only. Small secondary text uses a darker variant of that tone. Every text and control pair meets WCAG 2.2 AA contrast: 4.5 to 1 for body text, 3 to 1 for large text and control boundaries.
- **Type.** Headings use Bricolage Grotesque, a wide, characterful grotesque with ink traps. Body text uses IBM Plex Sans. Every amount, quote figure, date in a table and the studio clock uses IBM Plex Mono with tabular figures, so columns of numbers line up digit by digit. Each heading level is about one third larger than the level below it. The hero line is about seven times body size, so it reads as a poster.
- **Density.** Airy. Generous space separates sections. Each pinned section fills at least one screen height, and paragraphs never run wider than the reading measure.
- **Composition.** The 3D stage fills the window behind the public pages. Overlay type scrolls past each pinned object: the monolith, the card deck, the process rail and the quote sheet. The portal and studio drop the stage for a plain two-pane ledger on the same bone ground, with hairline rules between rows and mono amounts aligned right.
- **Controls.** Every tap target is at least 44 by 44 pixels. Buttons are solid cobalt with bone text (primary) or ink outlines (secondary).
- **Icons** come from the Lucide set only.

### Motion and effects (DP-03, DP-07, DP-57)

Motion is unhurried and exact. The camera never moves faster than the scroll does. Every movement starts briskly and settles gently, with no bounce except the hover lift.

- **Hover and press.** Cards and buttons lift slightly and grow a touch with a small overshoot, then settle, all within about a fifth of a second. Press sinks them back in the same time. Under reduced motion only the colour changes.
- **Studio scene.** One WebGL stage made only of procedural geometry. Each section pins one object while its overlay text scrolls past: the hero monolith (a tall faceted slab), the card deck (one thin card per published case study), the process rail (four beads on a bent rail, one per step) and the quote sheet (the folding sheet). The scene's container carries `data-scene-section` with the currently pinned section (`hero`, `work`, `process`, `pricing` or `contact`), `data-scene-turn` with the monolith's current turn in degrees from 0 to 360, and `data-scene-mode` set to `webgl` or `still`. The canvas itself is hidden from assistive technology.
  - The camera's position is a function of scroll position only. Scrolling down moves it forward through the sections. Scrolling back retraces the same path step by step. When scrolling stops, the camera catches up within about a third of a second and then holds still.
  - Idle motion: the monolith turns once every 30 to 45 seconds while the hero is in view. Nothing else in the scene loops. No other decorative loop exists anywhere in the product.
  - Reduced motion: the camera jumps to one fixed position per section. The monolith does not turn, and `data-scene-turn` stays constant.
  - Without WebGL, `data-scene-mode` is `still` and each section shows a still drawing of its object. Every link, control and quote works the same.
- **Case-study open.** The activated card lifts out of the deck and grows to fill the stage over about two-thirds of a second. Then the case study's text appears. Going back plays the same movement in reverse. Under reduced motion the case study appears at once, within a tenth of a second, with no movement.
- **Fold-line quote (signature).** The sheet shows the prospect or client where the money goes before they commit. Its crease divides due now from due at launch, or credit from new plan charge.
  1. A pick (plan, tier, currency) or an opened plan-change preview sends one quote request. The sheet folds flat (panels back to no tilt) in about a fifth of a second. `data-state` becomes `quoting`, and the label `Quoting…` shows in place of the numbers.
  2. When the answer arrives, `data-state` becomes `ready`. Over about a third of a second the crease slides across the sheet to the due-now share (or the credit share for a change), as a percentage from 0 to 100 of the sheet's width, and both panels tilt open from flat to 18 degrees.
  3. Over about two-thirds of a second the mono numerals on each panel count from their previous values (zero for the first quote on a page) to the server's figures. The total under the crease counts along with them and equals the sum of the two shown panel amounts at every frame.
  4. If billing is unreachable, `data-state` becomes `outage`, the sheet stays flat, and the quote outage copy from Feedback states shows instead of numbers. Inside `dialog "Confirm plan change"` the sheet shows the plan change preview outage copy from Feedback states instead.
  The crease line is drawn in the seam colour. Picking again before the motion ends restarts from step 1, using the values currently on screen as the "previous" values.
- **Reduced motion for the quote.** The sheet is replaced by `table "Quote"` with the two panel columns and the total row. Values swap in place with no counting and no tilt. `data-tilt` stays 0, and `data-crease` jumps straight to the new share.
- **Dialogs and drawer** fade and rise into place in about a fifth of a second and leave the same way. Under reduced motion they appear and disappear at once.

### Feedback states (DP-07, DP-08, DP-14, DP-15, DP-28, DP-29, DP-32, DP-36, DP-40, DP-44, DP-48, DP-49, DP-51, DP-52, DP-55)

Every async action shows its state on screen and announces it in the named polite live region. Copy is exact, character for character, with straight apostrophes. `<…>` placeholders are filled as described, and amounts use the money format. `<date>` is a day without a leading zero, the English month name and the year, for example `1 December 2026`.

| Action | Live region | Pending | Success | Field error / refusal | Outage |
|---|---|---|---|---|---|
| Quote (pick or switch) | `Quote status` | `Quoting…` | `Due now <due now>, due at launch <due at launch>, total <total>.` | n/a | `Live pricing is offline. Try again in a moment.` |
| Accept quote | `Checkout status` | `Accepting your quote…` | `Quote accepted. Price locked at <total>.` | Field messages under each field; price changed: `Prices changed since your quote. Review the new total before accepting.` | Billing-outage banner (below) only if billing is needed |
| Pay | `Checkout status` | `Processing payment…` | Navigates to the receipt route | Declined: `Your card was declined. Nothing was charged.`; field messages under card fields | Billing, as an `alert` banner: `We can't reach billing right now. Nothing was charged, and your details are still here. Try Pay again in a few minutes.` Storage, as an `alert` banner: `We couldn't open your project folder, so the payment was cancelled and nothing was charged. Try again in a few minutes.` |
| Receipt page | n/a | n/a | Line under the amount: `We'll email your receipt to <owner email>.` | n/a | n/a |
| Plan change preview | `Plan status` | `Working out your proration…` | `Credit <credit>, new plan charge <charge>, total <total>.` | Expired: `This preview expired. Open the change again for fresh figures.`; changed: `Billing moved on since your preview. Review the updated figures.` | `Billing is unreachable, so we can't change your plan right now.` |
| Confirm change | `Plan status` | `Confirming with billing…` | `Your plan is now <plan name>.` | Declined card: the declined copy above | Same as preview outage |
| Pause | `Plan status` | `Confirming with billing…` | `Your plan pauses on <date>.` | n/a | Same as preview outage |
| Resume | `Plan status` | `Confirming with billing…` | `Your plan is active again.` | Declined card: the declined copy above | Same as preview outage |
| Cancel | `Plan status` | `Confirming with billing…` | `Your plan ends on <date>.` | n/a | Same as preview outage |
| Plan page load and refresh | `Plan status` | n/a | n/a | n/a | Shown in place of the status and actions: `Billing is unreachable, so we can't show your plan status right now.` |
| Past due | `alert` banner | n/a | n/a | `Your last care-plan payment failed. Update your card to keep your plan.` | n/a |
| Update card and pay | `Plan status` | `Processing payment…` | `Payment received. Your plan is active.` | Declined: the declined copy above | Billing-outage banner text |
| Upload | `Upload status` | `Uploading <file name>: <percent>%`, announced at 0, 25, 50, 75 and 100 | `Uploaded <file name>.` | Type: `<file name> is not an accepted file type.`; size: `<file name> is larger than 10 MB.`; name: `That file name can't be stored. Rename the file and try again.` | `File storage is unavailable. Your file was not uploaded. Try again in a minute.` |
| Download | `Upload status` | n/a | Browser download starts | Expired link: `This download link expired. Press Download again.` | The storage outage copy above |
| Invite | `Invite status` | `Sending invite…` | `Invite sent to <email>.` | Field message under Email | n/a (mail is queued, never blocks) |
| Refund | `Refund status` | `Issuing refund…` | `Refunded <amount>. <remaining> left on this payment.` | Over the cap: `That is more than the <remaining> left on this payment.` | The billing-outage banner text |
| Sign in | `alert` | n/a | Navigates | `Email or password is incorrect.` | n/a |
| Work deck and journal | n/a | n/a | n/a | n/a | `Case studies are unavailable right now.` |

- The not-found page heading is `We couldn't find that page.` It is served with HTTP 404.
- The access-ended page heading is `Your access to this project ended when it closed.` It is served with HTTP 403.
- A message an action just showed stays until the next user action. A background refresh, poll or clock tick never overwrites or clears it.
- Success copy is shown only after the server confirms. A queued email never makes success copy false.

## Backend

### API (DP-02, DP-05, DP-11 to DP-15, DP-17, DP-20 to DP-22, DP-24, DP-25, DP-27 to DP-29, DP-32 to DP-34, DP-37, DP-39, DP-41, DP-42, DP-44, DP-45, DP-47 to DP-49, DP-53 to DP-55)

General:

- JSON in and out, `Content-Type: application/json`. Uploads use `multipart/form-data` with one field named `file`.
- Amounts are strings with exactly two decimals and no grouping, for example `"2350617.28"`. A proration credit is negative. The signs of refund and account-credit amounts are set in Business rules.
- Instants are ISO 8601 with the studio offset, for example `2026-11-01T14:05:09-03:00`. Dates are `YYYY-MM-DD`.
- Ids are UUIDs.
- Every error body has the shape `{"error":"<code>","message":"<sentence>"}`, and 422 adds `"fields":{"<field>":"<sentence>"}`. Where Feedback states gives copy for the same situation, `message` equals that copy.
- Actions marked **K** require an `Idempotency-Key` header (1 to 200 visible ASCII characters), with the semantics in Business rules. A missing key answers 422 with `fields["Idempotency-Key"]`.

Shared objects:

- Quote: `{"plan","currency","total","dueNow","dueAtLaunch","dueNowShare","priceEffectiveAt"}`. `dueNowShare` is dueNow ÷ total × 100, rounded half-up to one decimal.
- Order: `{"id","number","accountId","plan","planName","currency","state","total","dueNow","dueAtLaunch","acceptedAt","projectId","payments":[{"kind":"deposit"|"balance"|"care","amount","refunded","remaining","capturedAt","killbillPaymentId"}]}`. Fields that do not yet apply are null, and `payments` is an empty list.
- Plan: `{"id","tier":"lite"|"plus","planName","status":"active"|"paused"|"pending_cancel"|"past_due"|"cancelled","currency","monthlyPrice","periodStart","chargedThrough","pauseOn","endsOn","failedAttempts","nextRetryAt"}`.
- Preview: `{"previewId","fromTier","toTier","currency","credit","charge","total","creditShare","daysLeft","daysInPeriod","expiresAt"}`. `creditShare` is |credit| ÷ (|credit| + charge) × 100, rounded half-up to one decimal.
- Invoice: `{"id","number","date","kind":"deposit"|"balance"|"care"|"renewal"|"change","description","amount","balance","currency","status":"paid"|"open"|"void"|"credit","orderId","pdf":true|false}`.
- File: `{"id","kind":"asset"|"deliverable","name","type","size","uploadedBy","uploadedAt"}`.
- User: `{"id","name","email","role":"client_owner"|"teammate"|"studio_owner"|"contractor","accountId"}`.

Public and session:

| Method and path | Who | Request | Success | Own errors |
|---|---|---|---|---|
| `GET /api/health` | anyone | | 200 `{"status":"ok","services":{"postgres","killbill","minio","mailpit","pocketbase"}}`, each `"up"` or `"down"` | none |
| `GET /api/clock` | anyone | | 200 `{"now":"<instant>","zone":"America/Argentina/Buenos_Aires"}` | none |
| `GET /api/case-studies`, `GET /api/journal` | anyone | | 200 `{"entries":[{"slug","title","client","year","summary","publishedAt"}]}`, newest first | 503 `cms_unavailable` |
| `GET /api/case-studies/{slug}`, `GET /api/journal/{slug}` | anyone | | 200 entry with `body` | 404 unless published; 503 `cms_unavailable` |
| `GET /api/plans?currency=USD\|ARS` | anyone | | 200 `{"currency","plans":[{"plan","name","amount","interval":null\|"month"}]}` at prices in effect now | 422 currency |
| `POST /api/quotes` | anyone | `{"plan","currency"}` | 200 Quote | 422; 503 `billing_unavailable` |
| `POST /api/session` | anyone | `{"email","password"}` | 200 `{"user":User}` and the session cookie | 401 `invalid_credentials` |
| `DELETE /api/session` | signed in | | 204 | |
| `GET /api/me` | signed in | | 200 `{"user":User}` | |

Orders and payments:

| Method and path | Who | Request | Success | Own errors |
|---|---|---|---|---|
| `POST /api/orders` | anyone; a signed-in user other than a client owner gets 403 | `{"plan","currency"}` | 201 Order in `quoted`, owned by the caller's session | 422 |
| `GET /api/orders` | client owner | | 200 `{"orders":[Order]}` | |
| `GET /api/orders/{id}` | as Business rules allow | | 200 Order | |
| `POST /api/orders/{id}/accept` | the creating session | signed out: `{"businessName","name","email","password","acceptTerms":true}`; signed in: `{"acceptTerms":true}` | 200 `{"order":Order,"user":User}`; sets the session when signed out | 409 `quote_stale` with `"order":Order` at the new figures; 409 `plan_exists`; 422 |
| `POST /api/orders/{id}/pay` **K** | client owner | `{"card":{"number","expiry","cvc"}}` | 201 `{"order":Order,"payment":{"kind","amount","currency","killbillPaymentId"},"receiptUrl":"/orders/<id>/receipt"}` | 402 `card_declined`; 422; 503 `billing_unavailable`; 503 `storage_unavailable` |

Care plan (the caller's account; at most one non-cancelled plan):

| Method and path | Who | Request | Success | Own errors |
|---|---|---|---|---|
| `GET /api/plan` | client owner | | 200 `{"plan":Plan}` | 404 when the account has no plan; 503 `billing_unavailable` |
| `POST /api/plan/previews` | client owner | `{"tier":"lite"\|"plus"}` | 201 Preview | 422 same tier; 503 |
| `POST /api/plan/changes` **K** | client owner | `{"previewId"}` | 200 `{"plan":Plan,"invoice":Invoice}` | 402; 409 `preview_expired`; 409 `preview_stale` with `"preview":Preview`; 503 |
| `POST /api/plan/pause` **K** | client owner | `{}` | 200 `{"plan":Plan}` with `pauseOn` | 503 |
| `POST /api/plan/resume` **K** | client owner | `{}` | 200 `{"plan":Plan}` | 402; 503 |
| `POST /api/plan/cancel` **K** | client owner | `{}` | 200 `{"plan":Plan}` with status `pending_cancel` and `endsOn` | 503 |
| `POST /api/plan/card` **K** | client owner | `{"card":{…}}` | 200 `{"plan":Plan}` | 402; 422; 503 |

Invoices, projects, files and invites:

| Method and path | Who | Request | Success | Own errors |
|---|---|---|---|---|
| `GET /api/invoices` | client owner | | 200 `{"invoices":[Invoice]}` read from Kill Bill | 503 `billing_unavailable` |
| `GET /api/invoices/{id}` | client owner | | 200 Invoice | 503 |
| `POST /api/invoices/{id}/links` | client owner | `{}` | 201 `{"url","expiresAt"}` | 409 `pdf_pending` while the PDF is not stored yet |
| `GET /api/projects` | client owner, teammate, contractor, studio owner | | 200 `{"projects":[{"id","orderNumber","businessName","planName","state","closedAt"}]}` visible to the caller | |
| `GET /api/projects/{id}` | as Business rules allow | | 200 project with `assets`, `deliverables` (File lists) and `contractors` | 403 `access_ended` |
| `POST /api/projects/{id}/assets` | client owner, teammate | multipart `file` | 201 File | 409 `project_closed`; 413; 415; 422; 503 `storage_unavailable` |
| `POST /api/projects/{id}/deliverables` | studio owner, assigned contractor | multipart `file` | 201 File | the same as assets |
| `POST /api/files/{id}/links` | anyone who can see the file | `{}` | 201 `{"url","expiresAt"}` | 403 `access_ended` |
| `GET <link url>` | the user the link was issued to | | 200 bytes with `Content-Type` of the detected type, `Content-Disposition: attachment; filename="<name>"`, `X-Content-Type-Options: nosniff` | 403 `access_ended`; 410 `link_expired`; 503 `storage_unavailable` |
| `POST /api/projects/{id}/invites` | client owner | `{"email"}` | 201 `{"invite":{"id","email","expiresAt"}}`; the token travels only in the email | 422 |
| `GET /api/invites/{token}` | anyone | | 200 `{"businessName","projectName","email"}` | 409 `invite_used`; 410 `invite_expired` |
| `POST /api/invites/{token}/accept` | anyone | `{"name","password"}` | 201 `{"user":User,"projectId"}` and the session cookie | 409 `invite_used`; 410 `invite_expired`; 422 |

Studio (studio owner only):

| Method and path | Request | Success | Own errors |
|---|---|---|---|
| `GET /api/studio/orders`, `GET /api/studio/orders/{id}` | | 200 Order(s) with `businessName` and payments | |
| `POST /api/studio/orders/{id}/transitions` | `{"to":"in_build"\|"balance_invoiced"\|"closed"}` | 200 Order | 409 `invalid_transition`; 503 `billing_unavailable` for `balance_invoiced` |
| `POST /api/studio/projects/{id}/assignments` | `{"contractorId"}` | 201 `{"contractors":[…]}`; 200 if already assigned | 409 `project_closed`; 422 |
| `DELETE /api/studio/projects/{id}/assignments/{contractorId}` | | 204 | |
| `GET /api/studio/contractors` | | 200 `{"contractors":[{"id","name","email"}]}` | |
| `POST /api/studio/orders/{id}/refunds` **K** | `{"payment":"deposit"\|"balance","amount","reason"}` | 201 `{"refund":{"id","payment","amount","currency","killbillTransactionId"},"payment":{"kind","amount","refunded","remaining"}}` | 409 `payment_not_captured`; 422; 503 |
| `POST /api/studio/accounts/{id}/credits` **K** | `{"amount","currency","reason"}` | 201 `{"credit":{"id","amount","currency"},"accountCredit"}` | 409 `no_billing_account`; 422; 503 |
| `GET /api/studio/prices` | | 200 `{"prices":[{"id","plan","currency","amount","effectiveAt"}]}`, every row including scheduled ones | |
| `POST /api/studio/prices` | `{"plan","currency":"ARS","amount","effectiveAt"?}` | 201 price row | 422 |
| `GET /api/studio/entries` | | 200 every entry with `status` | 503 `cms_unavailable` |
| `POST /api/studio/entries` | `{"kind":"case_study"\|"journal","slug","title","client","year","summary","body"}` | 201 entry in `draft` | 422; 503 |
| `POST /api/studio/entries/{id}/publish`, `…/withdraw` | | 200 entry | 409 `invalid_transition`; 503 |

Limits:

- JSON bodies up to 65,536 bytes are accepted. Larger bodies answer 413 `payload_too_large` before parsing.
- Upload requests up to 10,100,000 bytes are read. Larger requests answer 413 `file_too_large` without reaching storage.
- Any other content type on a body-carrying route answers 415 `unsupported_media_type`.

### Business rules (DP-02, DP-05, DP-06, DP-11 to DP-15, DP-17, DP-18, DP-20 to DP-22, DP-24, DP-25, DP-27 to DP-29, DP-32 to DP-34, DP-36, DP-37, DP-39, DP-41, DP-42, DP-44, DP-45, DP-47 to DP-49, DP-53, DP-55)

**Error precedence, for the whole API.** Checks run in this order:

1. Body limits and content type (413, 415), and a cross-origin write (403 `cross_origin`).
2. No session where one is needed: 401 `unauthenticated`.
3. Any `/api/studio/` route called by anyone but the studio owner: 403 `forbidden`, before any id is read.
4. An unknown, malformed or invisible id, in the path or the body: 404 `not_found`.
5. A known resource the caller's role may not touch: 403 `forbidden`, or 403 `access_ended` for a closed project's contractor.
6. An idempotent replay, which returns its stored response.
7. State conflicts: 409.
8. Validation: 422.
9. Provider outcomes: 402, 503.

Uploads apply step 8 as name (422), then content type (415).

**Money.**

- Amounts are exact decimals to the cent (the centavo for pesos). They are never floating point.
- Display format: USD as `USD ` then digits grouped in threes with commas and a period before two decimals, for example `USD 1,999.99`. ARS as `ARS ` then digits grouped in threes with periods and a comma before two decimals, for example `ARS 2.350.617,28`. Negative amounts put a hyphen-minus before the code, for example `-USD 120.50`.
- The plan card, the quote sheet, the order summary, the receipt page, the PDF and every email show the figure the server computed, formatted this way. No surface recomputes or rounds it.

**Plans and the split.**

- Plans: `launch-page` (Launch Page) and `studio-site` (Studio Site) are fixed-scope builds. `care-lite` (Care Lite) and `care-plus` (Care Plus) are monthly care plans.
- For a build, the deposit is 40% of the total rounded down to the cent, and the launch balance is the total minus the deposit, so the two always sum to the total. In the API and the sheet the deposit is `dueNow` and the launch balance is `dueAtLaunch`.
- For a care plan, `dueNow` is the first month's price and `dueAtLaunch` is `0.00`.

**Prices over time.**

- Each plan has a price row per currency with an effective instant. The price in effect at instant T is the row with the latest effective instant at or before T.
- Dollar prices are fixed at their seed values, and posting a USD price answers 422.
- A new peso price takes effect at its `effectiveAt`, or at the moment the server receives it when `effectiveAt` is omitted. An `effectiveAt` earlier than now answers 422. The amount must be positive with at most two decimals.
- Quotes, plan listings and acceptances each use the price in effect at the moment the server handles that request. A price row whose instant has passed applies to the next request, with no restart or cache delay.

**Order states.**

| From | To | Who and how | Otherwise |
|---|---|---|---|
| (none) | quoted | anyone, `POST /api/orders`; figures at the current price, not yet locked | |
| quoted | accepted | the creating session, accept | 409 `invalid_transition` from any other state |
| accepted | deposit_paid (builds) or paid_in_full (care) | client owner, Pay | |
| deposit_paid | in_build | studio owner | |
| in_build | balance_invoiced | studio owner; creates the balance invoice | |
| balance_invoiced | paid_in_full | client owner, Pay | |
| paid_in_full | closed | studio owner; builds only | |

Every move not in this table answers 409 `invalid_transition`, with the current state named in `message`. Care orders never move past paid_in_full.

**Acceptance.**

- Signed out: accepting creates a client account (business name 1 to 120 characters, owner name 1 to 80 characters, a valid email not already registered, and a password of at least 10 characters) and signs its owner in. `acceptTerms` must be true. Each failure answers 422 under its field.
- The account's currency is fixed by its first accepted order. A later order in another currency answers 422 with `fields.currency` set to `Your account bills in <currency>.`
- An account with a care plan that is not cancelled cannot accept another care order: 409 `plan_exists`.
- At acceptance the server reads the price in effect at that instant. If it differs from the order's quoted total, the order is re-quoted at the new price, stays quoted, and the response is 409 `quote_stale` with the new figures. Otherwise the order's total, deposit and balance are stored as its locked price snapshot together with the price row used.
- The locked snapshot is used for every later invoice of the order: the launch balance, and the recurring price of a care plan for every renewal. It does not change when later prices take effect.
- Two simultaneous accepts of one order: exactly one succeeds, and the other answers 409 `invalid_transition`.

**Cards.** Card checks are simulated with published test numbers, because this environment has no live card processor.

- `4242 4242 4242 4242` approves.
- `4000 0000 0000 0002` declines with 402 `card_declined`.
- Spaces are ignored. Any other number, or one that fails the Luhn check, answers 422.
- Expiry is `MM/YY` and must be the current Buenos Aires month or later. CVC is 3 digits.
- Card numbers are never stored, logged or sent to billing. Only the last four digits are kept, as the account's card for renewals and changes.
- A decline is decided before billing is touched, so a declined Pay leaves no billing record.

**Paying (Pay, care first payment, balance).**

- On the first Pay of an account, its billing account is created.
- The order's invoice for the amount due is held in Kill Bill, and the amount is authorized against it.
- Then the order's portal folder is created and, in one ledger write, the payment, the new order state, the queued receipt and, for builds paid by deposit, a new project are recorded.
- Only then is the authorization captured. The response returns after the capture succeeds.
- If any step after the authorization fails (storage unreachable, ledger write failed, capture refused), the authorization is voided and the invoice created for this Pay is voided. No portal folder object stays behind, no receipt is queued, nothing is written to the ledger, and the order stays in its previous state. The response is the matching 503.
- If billing is unreachable at any step, nothing is charged and the response is 503 `billing_unavailable`.
- For a balance payment, Pay charges the balance invoice's open amount as billing holds it. That is the locked launch balance minus any account credit billing applied to the invoice.

**Pay intents and idempotency keys.**

- Keys are scoped to the caller (user or anonymous session) plus method and path.
- The first request with a key runs. Only a 2xx response is stored against the key, for at least 24 hours, and a later request with that key and an identical body gets the stored status and body plus the header `Idempotent-Replayed: true`, with no new effect.
- A request whose key is still being processed waits up to 15 seconds for the first to finish and then returns the stored response.
- The same key with a different body answers 409 `idempotency_mismatch`.
- A non-2xx outcome leaves the key unused, so the client may retry with it.
- Result: a double-pressed or retried Pay gives exactly one authorized and captured Kill Bill payment, one receipt and one portal folder.
- Pay requests with different keys for the same order, sent at once: exactly one pays. Each other request answers 409 `invalid_transition` once the winner has committed. If it arrives while the winner is still running, it waits up to 15 seconds for the winner and then answers the same way.

**Refunds and credits.**

- A refund targets the captured deposit or balance payment of an order. A payment not captured yet answers 409 `payment_not_captured`.
- The amount must be positive with at most two decimals and no more than the payment's remaining amount (captured minus refunds so far). Exactly the remaining amount is allowed. More answers 422 with `fields.amount` set to the over-cap copy from Feedback states.
- Simultaneous refunds on one payment are applied one at a time. Each sees the remaining amount left by the ones before it, so the refunds on a payment never sum above it.
- A refund changes no order state.
- A credit's currency must equal the account's currency, otherwise 422 with `fields.currency` set to `Credits must be in <account currency>.`
- A credit's request `amount` is positive with at most two decimals. Zero, a negative amount or more decimals answer 422 under `fields.amount`.
- In the credit response, `credit.amount` is that same positive amount, and `accountCredit` is the account's total unused credit as Kill Bill holds it right after this credit, a positive amount string in the account's currency. The credit notice's `<amount>` is the positive credit amount.
- An account with no billing account yet answers 409 `no_billing_account`.
- Billing applies a credit to the account's next invoice.

**Care plans.**

- Each period runs one calendar month from the purchase day.
- The first payment follows the Pay rules. The response returns only after Kill Bill shows the subscription invoiced for the first period and its charged-through date set. The plan's dates are copied from Kill Bill, never computed by the app.
- Statuses and moves:

| From | To | Action |
|---|---|---|
| active | active (other tier) | confirmed change |
| active | active with `pauseOn` | pause; takes effect at the charged-through date |
| active with `pauseOn` | active | resume (drops the scheduled pause) |
| active with `pauseOn` reached | paused | the date passes |
| paused | active | resume; billing restarts on the current business day and the invoice billing raises is paid with the account's card, with a decline answering 402 and the plan staying paused |
| active | pending_cancel | cancel; `endsOn` equals Kill Bill's charged-through date and billing end date |
| pending_cancel | cancelled | the date passes |
| active | past_due | a renewal payment fails |
| past_due | active | a retry or a card update pays the open renewal |
| past_due | cancelled | the third failed attempt |

  Any other action answers 409 `invalid_transition`. That includes a change, pause or cancel while paused, pending_cancel, past_due, cancelled or with a pause scheduled, and a resume while active with nothing scheduled.
- The status, dates, `failedAttempts` and invoice statuses come from Kill Bill on every read. An action responds only after Kill Bill confirms the new state, and its response carries the plan as Kill Bill then holds it.
- **Proration.** A tier change takes effect at once. Billing credits the unused part of the current tier and charges the new tier for the same days, counting whole days left in the period from the current business day in Buenos Aires (America/Argentina/Buenos_Aires). The credit is minus the current monthly price × days left ÷ days in the period. The charge is the new tier's current monthly price × days left ÷ days in the period. Each is rounded by billing to the cent. The total is credit plus charge. The app shows billing's figures and never computes its own.
- A preview stays confirmable for `PREVIEW_TTL_SECONDS` seconds (default 600). After that, Confirm answers 409 `preview_expired`. If billing would now produce different figures (for example the business day changed, or a new price took effect), Confirm answers 409 `preview_stale` with a fresh preview, and nothing changes.
- A positive total is authorized on the account's card before the change is made and captured against the change invoice. A decline answers 402 and nothing changes.
- A negative total becomes account credit in the account's currency.
- The new tier's price at confirmation is locked for its renewals.
- **Renewals and dunning.**
  - The app finds each unpaid renewal invoice within 60 seconds of Kill Bill holding it, sends one invoice notice for it, and charges the account's card. That charge is attempt 1.
  - If attempt 1 fails, the plan is past due. Attempt 2 runs 3 dunning days after attempt 1, and attempt 3 runs 7 dunning days after attempt 1, each no later than 5 seconds after it falls due.
  - A dunning day lasts `DUNNING_DAY_SECONDS` seconds (default 86,400).
  - Each failed attempt sends one dunning notice. When attempt 3 fails, the subscription is cancelled at once in Kill Bill.
  - Saving a card that approves during past due pays the open renewal at once. That payment does not count as a dunning attempt, and the remaining retries are dropped. A declined card update sends no dunning notice.
- Every captured payment (deposit, balance, first care month, change charge, renewal) queues exactly one receipt.

**Files and access.**

- Client owners and teammates of an account see every project of that account. Contractors see a project only while they are assigned and it is not closed. The studio owner sees all projects.
- A quoted order belongs to the session that created it. Only that session sees or accepts it, also after someone signs in within that session. Every other caller, other client owners included, gets 404 for it. From acceptance on, the order belongs to its client account and is visible to that account's client owner and to the studio owner.
- Anyone else gets 404 for a project, file, order, invoice or invite id, as for an id that does not exist.
- A contractor who was assigned to a project that is now closed gets 403 `access_ended` for that project, its files and its links. On pages they get the access-ended page.
- Closing a project takes effect on the very next request of every affected user, mid-session.
- Uploads into a closed project answer 409 `project_closed` for client users and the studio owner.
- Teammates get 403 `forbidden` on their own account's orders, invoices, plan, invoice links and invites. Contractors get 404 for every order and invoice id, and 403 on account-level billing lists.
- **Upload allowlist.**
  - Files up to and including 10,000,000 bytes are allowed. Larger files answer 413 `file_too_large`.
  - Name: 1 to 120 characters, with no `/`, `\`, `..`, control characters or leading dot. Otherwise 422 with `fields.file`.
  - The type is detected from the file's first bytes, never from the name or the declared type. Allowed: PNG, JPEG, WebP, SVG, PDF, WOFF2, OTF, TTF. The name's extension must be one of the detected type's usual extensions.
  - SVG is accepted only when its root element is `svg` and it contains no script element, no event-handler attribute, no `javascript:` reference and no `foreignObject`.
  - Anything else, a renamed executable included, answers 415 `unsupported_file_type`.
  - Nothing refused is ever written to storage.
- **Download links.**
  - A link is valid for `DOWNLOAD_LINK_SECONDS` seconds (default 60) and only for the user it was issued to. Anyone else gets 404.
  - Every use re-checks that user's current access. After expiry the link answers 410 `link_expired`.
  - The server streams the bytes itself, and the browser never receives a storage address.

**Invoice PDFs.** Every Kill Bill invoice of a client account (deposit, balance, first care month, change, renewal) gets a PDF stored within 30 seconds of Kill Bill holding it. The PDF shows the invoice number, date, business name, each item's description and amount, the total, the balance and the currency, in the money format.

**Invites.**

- An invite is for one email address that has no Pampero Ledger sign-in yet. Otherwise the response is 422 with `fields.email` set to `This person already has a Pampero Ledger sign-in.`
- An invite is valid for `INVITE_TTL_SECONDS` seconds (default 604,800) and can be used once.
- Accepting creates a teammate on the inviting account (name 1 to 80 characters, password at least 10 characters).
- An expired invite answers 410 `invite_expired`. A used invite answers 409 `invite_used`. Of two simultaneous accepts, exactly one succeeds.

**CMS entries.**

- Entries move draft → published → withdrawn only. Publishing a published or withdrawn entry, or withdrawing a draft or withdrawn one, answers 409 `invalid_transition`.
- Slugs are lowercase letters, digits and hyphens, unique across entries (otherwise 422).
- Public lists and detail routes reflect a publish or withdraw within 5 seconds.

**Sessions.**

- The session cookie is `pampero_session`, HttpOnly and SameSite=Lax. Sessions are stored in the ledger database.
- Protected pages redirect signed-out visitors to `/sign-in?next=<path>`.
- Passwords are stored only as slow salted hashes.

**Several processes, one database.** Several app processes may share one database and one billing tenant. Each receipt, notice, dunning attempt, PDF write and seed step still happens exactly once.

**Studio clock.** `GET /api/clock` and the first render of every page give the server's current Buenos Aires time. The browser advances it every second from that server reading and never takes it from the device's own time zone.

### Services (DP-12, DP-14, DP-21, DP-24, DP-25, DP-27, DP-29, DP-32 to DP-34, DP-36, DP-42, DP-52, DP-53, DP-60)

**Kill Bill (billing).**

- On serve, if the tenant has no catalog, upload one. It has products `care-lite` and `care-plus`, each with one monthly plan (`care-lite-monthly`, `care-plus-monthly`), billed in advance, with an evergreen phase priced in USD and ARS at the seed prices. Plan changes use the immediate policy, and cancels default to end of term.
- **Accounts.** One account per client account:
  - name is the business name and email is the owner email;
  - currency is the account currency;
  - time zone is America/Argentina/Buenos_Aires;
  - external key is `pampero-<client account id>`;
  - it carries the `AUTO_PAY_OFF` control tag, so the app pays every invoice itself;
  - it has one default payment method on the built-in external payment plugin (`__EXTERNAL_PAYMENT__`).
- **Build invoices.** The deposit invoice has one external-charge item described `<order number> deposit`. The balance invoice has one item described `<order number> launch balance`.
- **Build payments.** External keys are `<order id>-deposit` and `<order id>-balance`. A successful Pay shows AUTHORIZE then CAPTURE, both successful, for the amount paid, on the payment with that key, and leaves that invoice with balance `0.00`. A failed Pay shows AUTHORIZE then VOID, and its invoice is void. Billing links only purchases to an invoice, never an authorization or a capture, so after every capture for an invoice (deposit, balance, first care month, change charge, renewal) the app records one external invoice payment of the captured amount on that invoice, which brings its balance to `0.00`. That settling payment is not a second charge.
- **Care plans.**
  - Bundle external key `care-<order id>`. Its subscription's recurring price is the locked monthly price.
  - First payment external key `<order id>-care`.
  - A change invoice holds billing's repair-adjustment item (`REPAIR_ADJ`) for the credit and a recurring item for the new charge. A change payment's external key is `<preview id>-change`.
  - A renewal payment's external key is `<invoice id>-renewal`.
  - A pause is a bundle pause dated at the charged-through date.
  - An end-of-term cancel leaves the subscription with a billing end date equal to its charged-through date. The final dunning failure cancels it at once.
- **Refunds and credits.** A refund is a REFUND transaction on the refunded payment. A credit is an account credit in the account currency.
- **When unreachable.** Every action that needs billing answers 503 `billing_unavailable` and changes nothing. Plan and invoice reads answer the same 503. Quotes answer the same 503, because a quote is only shown when it can be charged. The UI shows the matching outage copy from Feedback states. Dunning attempts that fall due while billing is down run as soon as it returns.

**Mailpit (email).**

- SMTP to `SMTP_HOST`:`SMTP_PORT`, From `MAIL_FROM` (`Pampero Build Co. <ledger@pampero.test>`).
- Each message has a plain-text body, and an HTML part is optional. Links use `APP_PUBLIC_URL`.
- Every message is written to a queue in the ledger at the moment of the action and delivered once. Any app process sharing the ledger that can reach mail delivers a queued message within 30 seconds of it being queued, including messages queued by a process that cannot reach mail. While no process can reach mail, the queue retries at least every 30 seconds and delivers within 30 seconds of mail returning. A retried action never queues a second copy.

| Message | To | Subject | Body includes |
|---|---|---|---|
| Receipt, per captured payment | client owner | `Receipt <order number>: <amount>` | order number, payment kind (`Deposit`, `Launch balance`, `Care plan`, `Plan change`, `Renewal`), amount, receipt route link |
| Invoice notice, per balance or renewal invoice | client owner | `Invoice <invoice number> from Pampero Build Co.: <amount>` | amount, due amount, `/portal/invoices` link |
| Dunning notice, per failed attempt | client owner | `Care plan payment failed (attempt <n> of 3)` | amount, next retry date, or that the plan is cancelled after attempt 3, and the `<APP_PUBLIC_URL>/portal/plan` link |
| Refund notice | client owner | `Refund of <amount> on <order number>` | amount, amount left on that payment |
| Credit notice | client owner | `Account credit of <amount>` | amount, reason |
| Teammate invite | invitee | `Join <business name> on Pampero Ledger` | `<APP_PUBLIC_URL>/invite/<token>` |

`<invoice number>` is Kill Bill's invoice number. `<amount>` uses the money format.

**MinIO (files).** All objects live in `S3_BUCKET`:

- `portal/<order id>/.portal`: the portal folder marker, created at the order's first capture.
- `portal/<order id>/assets/<file id>/<file name>`
- `portal/<order id>/deliverables/<file id>/<file name>`
- `portal/<order id>/invoices/<Kill Bill invoice id>.pdf`: bytes start with `%PDF-`. Care renewals and changes go under the care order's folder.

When storage is unreachable, uploads and downloads answer 503 `storage_unavailable`, Pay follows the paying rule, and PDF writes retry and complete within 30 seconds of storage returning.

**PocketBase (CMS).**

- On serve, create the collection `entries` if missing. Fields: `kind` (`case_study` or `journal`), `slug`, `title`, `client`, `year`, `summary`, `body`, `status` (`draft`, `published`, `withdrawn`), `publishedAt`.
- The app reads and writes it server-side with the app admin. Public reads return published entries only.
- When unreachable, entry routes answer 503 `cms_unavailable`, and the deck and journal show the CMS outage copy from Feedback states.

**Postgres (ledger).** Holds client accounts and users, sessions, price rows, orders with their locked snapshots, payments and their allocations, refunds, credits, projects with assignments and close instants, file records, invites, idempotency records, previews, dunning attempts and the mail queue. Apply the schema idempotently on every serve. If Postgres is unreachable, every route except health and clock answers 503 `database_unavailable`.

### Seed data (DP-01, DP-16, DP-19, DP-23, DP-31, DP-36 to DP-38, DP-43, DP-47, DP-48, DP-50)

Every seeded person and business is invented. Seed on serve against an empty ledger, idempotently. When a needed service is down, seeding retries that part until it succeeds. Seed payments and invoices send no email; the exceptions are the past-due renewals below. Each app process on its own empty ledger database seeds its own copy of every record below, with its own billing accounts in the shared billing tenant. The "seeding day" is the Buenos Aires date of the first serve against that database.

**Users** (password in brackets):

- Studio owner Inés Calvar, `ines@pampero.test` (`pampero-owner-2026`).
- Contractors Tomás Rivero, `tomas@pampero.test` (`pampero-contractor-1`), and Dana Okafor, `dana@pampero.test` (`pampero-contractor-2`).
- Client owners:
  - Mariela Sosa, `mariela@yerbanorte.test` (`client-owner-ars-1`)
  - Olivia Brava, `olivia@casabrava.test` (`client-owner-usd-1`)
  - Grace Whitlow, `grace@harborpine.test` (`client-owner-usd-2`)
  - Ramiro Díaz, `ramiro@lumen.test` (`client-owner-ars-2`)
  - Lucía Ferro, `lucia@panaderiasur.test` (`client-owner-ars-3`)
  - Noah Prescott, `noah@quillfern.test` (`client-owner-usd-3`)
- Teammate Bruno Paz, `bruno@yerbanorte.test` (`client-team-ars-1`), on Yerba Norte SRL.

**Prices**, effective from `2026-01-01T00:00:00-03:00`:

| Plan | USD | ARS |
|---|---|---|
| Launch Page | 1849.99 | 233333.33 |
| Studio Site | 4999.99 | 587654.32 |
| Care Lite (month) | 149.00 | 189999.99 |
| Care Plus (month) | 349.00 | 449999.99 |

For example, with the seed data at start, a Studio Site quote in ARS gives due now `235061.72` and due at launch `352592.60`. In USD it gives `1999.99` and `3000.00`.

**Orders.** New orders are numbered from PB-0007, as `PB-` plus four digits.

| Number | Client (currency, card last four) | Plan | State and billing |
|---|---|---|---|
| PB-0001 | Yerba Norte SRL (ARS, 4242) | Studio Site at ARS 587654.32 | in_build; deposit captured. Project with asset `yerba-norte-logo.svg`, Tomás assigned |
| PB-0002 | Casa Brava (USD, 4242) | Launch Page at USD 1849.99 | paid_in_full; deposit 739.99 and balance 1110.00 captured. Project with asset `casa-brava-palette.pdf` and deliverable `casa-brava-homepage.png`, Dana assigned |
| PB-0003 | Harbor & Pine Ltd (USD, 4242) | Care Plus at USD 349.00 | paid_in_full; subscription started on the seeding day, first invoice paid, status active |
| PB-0004 | Ferretería Lumen (ARS, 0002) | Care Lite at ARS 189999.99 | paid_in_full; subscription started one calendar month before the seeding day, first invoice paid. Its renewal is due on the seeding day, and attempt 1 runs at seeding and is declined, so the plan is past due with its invoice notice and first dunning notice sent |
| PB-0005 | Panadería Sur (ARS, 0002) | Care Plus at ARS 449999.99 | paid_in_full; set up exactly like PB-0004: first invoice paid one calendar month before the seeding day, renewal attempt 1 at seeding declined, plan past due with its invoice notice and first dunning notice sent |
| PB-0006 | Quill & Fern Books (USD, 4242) | Care Lite at USD 149.00 | paid_in_full; subscription started two calendar months before the seeding day, first invoice paid, paused from its charged-through date one calendar month before the seeding day, so its status is paused with no open invoice |

Each seeded billing record, file object, portal folder marker and invoice PDF exists in its service as Services describes.

**CMS entries:**

| Kind | Slug | Title | Client, year | Status | Published at |
|---|---|---|---|---|---|
| case_study | `mate-route` | Mate Route | Mate Route Co., 2026 | published | 2026-09-14 |
| case_study | `atelier-ombu` | Atelier Ombú | Atelier Ombú, 2026 | published | 2026-07-30 |
| case_study | `lanchas-del-delta` | Lanchas del Delta | Lanchas del Delta, 2026 | published | 2026-05-02 |
| case_study | `norte-cycling-club` | Norte Cycling Club | Norte Cycling Club, 2026 | published | 2026-02-11 |
| case_study | `bodega-lince` | Bodega Lince | Bodega Lince, 2026 | draft | |
| case_study | `cafe-ruta-40` | Café Ruta 40 | Café Ruta 40, 2025 | withdrawn | |
| journal | `pricing-in-two-currencies` | Pricing in two currencies | | published | 2026-10-06 |
| journal | `what-a-care-plan-covers` | What a care plan covers | | published | 2026-08-19 |

Summaries and bodies are free copy written for the studio.

## Technical requirements

### Deployment (DP-54)

- Node.js 22 with npm is available. Write the app in TypeScript.
- `/app/run.json` holds string `install`, `build` and `serve` commands and `"_schema":"run-manifest-v1"`, for example:

```json
{"_schema":"run-manifest-v1","install":"npm ci","build":"npm run build","serve":"npm run start"}
```

- The server binds `0.0.0.0` on port 4173, or on `APP_PUBLIC_PORT` when that is set.
- `GET /api/health` answers HTTP 200 with JSON whose `status` is `"ok"`, within 2 seconds, whatever the state of the services.
- Schema, the billing catalog, the CMS collection and seed data are applied on serve, idempotently, never only at build.

### Configuration and secrets (DP-60)

These are read from the environment at start, never hard-coded and never sent to the browser:

- Postgres: `DATABASE_URL`
- MinIO: `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_FORCE_PATH_STYLE`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`
- PocketBase: `POCKETBASE_URL`, `POCKETBASE_ADMIN_EMAIL`, `POCKETBASE_ADMIN_PASSWORD`
- Kill Bill: `KILLBILL_URL`, `KILLBILL_USERNAME`, `KILLBILL_PASSWORD`, `KILLBILL_API_KEY`, `KILLBILL_API_SECRET`
- Mail: `SMTP_HOST`, `SMTP_PORT`, `MAIL_FROM`
- Links in emails: `APP_PUBLIC_URL`
- Durations in seconds: `DUNNING_DAY_SECONDS`, `DOWNLOAD_LINK_SECONDS`, `PREVIEW_TTL_SECONDS`, `INVITE_TTL_SECONDS`, with the defaults stated in Business rules.

### Server boundary (DP-49, DP-53)

- Same origin only. No cross-origin resource sharing headers are sent. A state-changing request whose `Origin` header names another origin answers 403 `cross_origin`.
- Fonts, scripts, styles and 3D code are served from the app's own origin. The browser never contacts another host.
- The server never serves source files, the run manifest, environment values, lockfiles or any path outside the built public assets and the routes above. Such paths answer the not-found page.
- Unknown page routes, and page routes for ids the viewer may not see, answer the not-found page with HTTP 404. API routes answer 404 `not_found`.
- **Boot and recovery.** The app starts and serves health with any service unreachable, and every action that does not need the unreachable service keeps working. Each request connects to the services afresh, and a failed connection is never cached, so the first request after a service returns uses it, and background work (mail queue, PDF writes, dunning, seeding) resumes within 30 seconds, with no restart.
- Several app processes may share one ledger database while one of them cannot reach a service. Work queued by that process (mail, PDF writes) is completed by any process that reaches the service, within the delays in Services, and an order whose Pay failed there can be paid through any process that reaches billing.

### Browser support and performance (DP-09, DP-57)

- Current Chromium, Firefox and WebKit at 375x812, 768x1024 and 1280x800, with touch, reduced motion and no WebGL each supported.
- Pricing controls are usable within 3 seconds of opening the home page. The 3D stage may finish loading afterwards.
- Quote responses arrive within 1 second when billing is up. Pay responds within 10 seconds.

## Working rules

- IF-01: `/app/run.json` exists with string `install`, `build` and `serve` fields and `"_schema":"run-manifest-v1"`, and nothing else is needed to install, build and serve.
- IF-02: `/app/THIRD_PARTY_NOTICES.md` lists every shipped package, meaning the production dependency tree from `npm ls --omit=dev --all --json`, plus every bundled font, with its licence.
- IF-03: Every shipped package and font is under MIT, ISC, BSD-2-Clause, BSD-3-Clause, Apache-2.0, 0BSD, CC0-1.0, BlueOak-1.0.0 or OFL-1.1. Nothing is under GPL, LGPL, AGPL or SSPL.
- IF-04: The app stores state only in the five provided services. No SQLite, Redis, embedded database or state files on disk.
- IF-05: The provided service configuration files are not modified.
- IF-06: Application source is TypeScript. Plain JavaScript appears only in tool configuration files.
- IF-07: Icons come only from Lucide, and the repository contains no 3D model files: every 3D object is built in code.
- IF-08: The built pages reference no external host for fonts, scripts, styles or images.

## Engineering standards

- The code is idiomatic, strictly typed TypeScript with no `any` escapes. Names match this brief's domain terms: quote, order, deposit, launch balance, care plan, tier, preview, dunning attempt, portal folder, assignment.
- Each domain rule (the deposit split, the money format, an order or plan transition, the price in effect, the refund cap, the access check, the upload allowlist) is decided in exactly one place in the source and used everywhere else.
- Money is held as exact decimals or integer minor units end to end. Floating point never touches an amount.
- There is no abstraction with a single implementation, and no wrapper that only forwards calls.
- There is no dead, commented-out or unreachable code, and no defensive check for a state the transitions above cannot produce.
- Every error leaves the server in the one error shape from the API section.
- No feature, route, screen or setting exists beyond this brief.
