# Opaline Institute Opaline Bench Days

Opaline Bench Days is the booking and event-operations site for a live, two-day masterclass in direct composite layering. The course has 24 seats and awards CE credit. It runs at a fictional bench lab in Chicago on Friday 16 and Saturday 17 April 2027. On the public microsite, dentists explore the course, pick a physical bench in a 3D lab, hold it on server time, and pay a deposit and later the balance. Clinic owners buy several seats on one clinic account and give each seat to a named colleague. Behind the public site are four staff surfaces. The registrar desk reconciles money against Kill Bill, reviews licences, and issues visa-support letters and CE certificates. A front-desk check-in screen works at the lab door. A content desk lets the event director edit the programme. The product uses these services:

- **Kill Bill** for invoices, payments and refunds.
- **Postgres** for the reservation ledger, bench inventory, holds, waitlists, accounts, check-ins, background work and the outbound mail queue.
- **MinIO** for uploaded scans and generated PDFs.
- **Mailpit** as the email sink.
- **PocketBase** as the store behind the content desk.

Accounts use email and password and live in Postgres. There is no third-party sign-in. These are out of scope: other datastores, real card processing (Kill Bill records payments against its built-in external payment method), on-demand courses and other events.

## Problem and users

Live hands-on composite masterclasses cost USD 1,700 to 6,000 a seat. They seat 16 to 24 dentists at benches with typodonts, curing lights and loupes, and award about 14 to 16 AGD PACE or ADA CERP credits. Most are still sold through a generic ticket page, a payment link and a spreadsheet. The organiser pays for this in several ways:

- The registrar settles deposits and balances by hand.
- Clinic owners buy three or four seats and email in their associates' names weeks later.
- Two people both "get" the last front-row bench.
- Refunds follow a dated schedule but are worked out on a calculator, often against the wrong day when someone cancels near midnight.
- A PACE-compliant certificate can only go to someone whose licence and both days of attendance are on record.
- A bench that frees up two weeks before the course goes unsold because nobody owns the waitlist.

Every mismatch costs the organiser a seat worth thousands of dollars. It costs the attendee a refund dispute or a missing credit at licence renewal.

Users:

- **Event director** (daily): edits agenda sessions, hospitality events, hotels and FAQ entries in the content desk and sees them live on the public site. Keeps hands-on time at no less than the PACE share. Watches seats sold, held and waitlisted.
- **Registrar** (daily): reconciles deposits, balances, upgrades and refunds against Kill Bill. Checks uploaded licences and issues visa-support letters and CE certificates.
- **Front-desk check-in staff** (occasional): checks each named attendee in on day 1 and day 2 at the lab door in seconds, including walk-ups found by name.
- **Individual practitioner** (occasional): explores the event, picks a bench, pays a deposit and later the balance, uploads a licence, and receives the receipt and certificate.
- **Clinic group buyer** (occasional): buys several seats on one clinic account and gets one group invoice. Assigns each seat to a named colleague and cancels or upgrades one seat without touching the others.
- **Assigned colleague** (occasional): accepts the seat a clinic assigned them, uploads their own licence, and sees only their own seat, documents and certificate.

## Journeys

1. **Explore and reserve on a phone.** A practitioner opens the site on a phone. The overture fills the screen, with the reserve bar docked at the bottom. They open the chapter drawer and jump to "Two days". They switch between Day 1 and Day 2 in the segmented switch, then open an evening's details and an FAQ answer. In the lab, a sideways drag orbits the scene. They create an account and tap an open Bench-tier bench. The panel reads the pending text until the server accepts. Then the bench lifts, a ring starts running down, and the reserve bar shows the countdown. Other buyers polling the same map see the bench as held, never as theirs. The practitioner pays the deposit and sees the confirmation heading for their bench. The receipt email arrives.
2. **Keyboard-only reservation on a laptop.** A practitioner who uses no pointer tabs into the bench map, arrows to an open bench and presses Enter to hold it. They hear the hold announced with the seats remaining. They press Escape to release it, then Enter on another bench. They open checkout and pay the deposit, all by keyboard, and focus returns to the hold panel. Their payment went out with seconds left on the hold, and the confirmation stays on screen after the countdown reaches zero.
3. **Last Atelier place and the waitlist.** Nine Atelier seats are sold. Two practitioners press hold on the last Atelier place at the same instant. Both see only the pending text while their requests run. One gets the bench. The other's bench never lifts. It turns held, the Atelier sold-out heading appears with a waitlist button, and they join as number 1. The winner's hold runs out unpaid. The bench is offered to the waitlisted practitioner, and Atelier stays sold out on the map, the reserve bar and the director's counts throughout. That practitioner gets the offer email, signs in, accepts within the window and holds the bench with a fresh countdown.
4. **Balance, upgrade, cancellation and refund near midnight.** A practitioner with a deposit paid upgrades to an open Atelier bench and pays only the part of the difference that the date allows. They later pay the balance and get the paid-in-full receipt. Another practitioner cancels a paid seat at 23:30 Chicago time on the last day of a refund window. The account page shows the refund due for that Chicago date, not the UTC date. The registrar opens the desk and sees the row's Kill Bill paid amount. They issue the refund, which Kill Bill records against each payment, newest first, and the row turns refunded. The refund email arrives.
5. **Clinic group purchase and assignment.** A clinic owner holds four benches together and pays one group invoice in full. They name two colleagues at checkout and two later. They see the group confirmation heading, and the group receipt lists names and benches only. Each colleague gets an assignment email, signs up with that email, accepts the seat and uploads a licence. The owner sees each seat's licence status but cannot open the files. The owner reassigns one seat. The former colleague loses that seat, its licence and its documents on their very next request, and is free to accept another seat. The owner cancels one seat. Only that seat's invoice item changes, and its refund follows the schedule.
6. **Registrar paperwork.** The registrar opens an attendee's licence through a short-lived link and marks it matched. An international attendee uploads a passport scan. The registrar issues a visa-support letter, which is emailed to them. While document storage is down, the registrar's attempt is refused, and nothing is recorded or sent.
7. **Event days and certificates.** On Friday 16 April 2027, the front desk presses the search shortcut, quickly types part of a walk-up's name, and presses Enter to check them in for day 1. The match list always belongs to the text in the box. On Saturday 17 April 2027 they check the same attendee in for day 2. The registrar issues the CE certificate. One attempt fails while storage is down and uses no certificate number, so the next certificate takes the next number. The attendee downloads the same certificate PDF every time and gets the certificate email.
8. **Content desk and outages.** The event director selects a hands-on session in the content desk and types a new minutes value. The projected hands-on share recomputes with every key. When a value would drop it below 30%, the field error appears before they press Save. They save a valid value, and the public site shows it on the next load. Meanwhile Kill Bill stops answering during a practitioner's checkout. The practitioner reads the published billing-offline banner while their hold keeps running. When Kill Bill answers again, the same retry succeeds with one charge, and no restart is needed.

## Mandatory requirements

This is the complete list of mandatory requirements; every check traces to one of these lines and the detailed sections below.

- **DP-01 — Run manifest and health check** Ship /app/run.json and serve the app on port 4173 with GET /api/health answering as stated in Deployment.
- **DP-02 — Credentials from the environment** Read every service URL, credential and clock setting from the environment variables listed in Configuration and secrets, never hard-code them and never send them to the browser.
- **DP-03 — Accounts, roles and sessions** Let practitioners and clinics create accounts and everyone sign in with email and password, and gate each staff action to its one role as stated in Business rules.
- **DP-04 — One error shape and order** Answer every API error with the one JSON error shape and the single precedence order stated in API.
- **DP-05 — Same-origin server boundary** Enforce the request limits, origin check and never-served paths stated in Server boundary.
- **DP-06 — Nocturnal palette with curing-blue states** Set the site on a near-black umber ground with bone text, using curing-light blue only for live and selected states and gold only for Atelier marks.
- **DP-07 — Chaptered editorial composition** Give each of the seven chapters a full viewport with oversized split serif headlines and chapter navigation as Screens and layout gives for each viewport, with headlines across the left two thirds and a numbered chapter rail on the right edge at 1280x800.
- **DP-08 — Clinical tabular numerals** Set every number (prices, countdowns, seat counts, bench labels, session minutes) in tabular figures from a small fixed set of sizes.
- **DP-09 — Explore the seven chapters** A visitor scrolls from overture to reserve, switches agenda days, opens an evening's details and an FAQ answer, and reaches the bench map at every published viewport.
- **DP-10 — Content desk writes to PocketBase** Let the event director create, edit and delete agenda sessions, hospitality events, hotels and FAQ entries in the PocketBase collections named in Services, with agenda writes checked against the hands-on share rule one at a time as stated in Business rules.
- **DP-11 — Public content reads live** Show PocketBase content on the public site and in the public content API on the next load after any change, with no restart.
- **DP-12 — Hospitality tier gating** Show Atelier-only evenings to everyone as gated, and reveal their time, venue and description only to the accounts stated in Business rules.
- **DP-13 — Published layouts at three viewports** Render the agenda, hospitality list, bench map and reserve bar in the arrangement Screens and layout gives for 375x812, 768x1024 and 1280x800, with no sideways scrolling.
- **DP-14 — Collapsed panels are inert** Keep a closed chapter drawer, a collapsed FAQ answer and collapsed evening details hidden, unfocusable and out of the accessibility tree until opened.
- **DP-15 — Lab scene orbit by drag and touch** Render the procedural lab scene and orbit it by mouse or touch drag inside the published range, springing back inside it on release.
- **DP-16 — Scroll-driven lab camera and preloader** Move the lab camera from overhead plan to bench height as the lab chapter scrolls, reversing on scroll back, after a preloader that counts to 100 as stated in Motion and effects.
- **DP-17 — Reduced-motion bench plan** Under reduced motion or without WebGL, replace the scene with the flat labelled bench plan that keeps hold, release, waitlist and checkout and runs no orbit, lift, spring, scrub or kinetic letters.
- **DP-18 — Bench inventory and seats remaining** Publish the 24 benches with per-viewer states computed for each request and the seat counts from the one ledger computation in Business rules, agreeing on every surface and refreshed on screen within two seconds of any change.
- **DP-19 — Server-timed holds** Hold a bench for the server's hold length from server creation, never extended by client activity, and show its countdown and end from the server's status whatever the device clock says.
- **DP-20 — Keyboard bench map** Let a practitioner move across benches with arrow keys, hold with Enter and release with Escape, with no pointer.
- **DP-21 — Bench Lift on the server's answer** Lift the held bench on a spring, split its label into moving letters and deplete a ring in step with the server's hold time, starting only once the server accepts the hold as stated in Motion and effects.
- **DP-22 — Announced bench outcomes** Show the pending hold text and announce each hold, loss, release, expiry, payment result and seat count in the Bench updates live region with the copy from Feedback states.
- **DP-23 — Hold a bench from the map** A signed-in practitioner picks an open bench, sees it held with a running countdown, and releases it or lets it end, with the bench returning to open.
- **DP-24 — Atelier rows and hard cap** Allow only Atelier reservations on rows A and B and never let active Atelier reservations, live offers included, exceed the cap in Business rules.
- **DP-25 — One winner for the last bench** When simultaneous holds race for the same bench or the last Atelier place, exactly one succeeds and every other gets the conflict code and waitlist offer stated in Business rules.
- **DP-26 — Atelier sold-out copy** Show the Atelier sold-out heading, banner and bench labels from Feedback states once the cap is reached, live offers included, even while row A or B benches are open.
- **DP-27 — Pay a deposit by keyboard** A practitioner holding a bench opens checkout, pays the deposit using only the keyboard and sees the confirmation heading, with focus returned to the opener on Close or Escape and to the hold panel heading after Done.
- **DP-28 — One Kill Bill charge per payment** Record each deposit, balance, full payment, upgrade and refund in Kill Bill exactly once however often it is retried, with replay and conflict answers as stated in Business rules.
- **DP-29 — Paid only after Kill Bill, receipt and mail** Move a reservation to a paid state only after Kill Bill confirms the payment, the receipt PDF is stored and the receipt email is queued; otherwise show it as pending, as qualified in Business rules.
- **DP-30 — Confirmation outlasts the hold timer** Keep the confirmation of a payment sent before the hold ended on screen after the countdown reaches zero, and never let a later repaint replace it or an outage message.
- **DP-31 — Balance payment to paid in full** Let the buyer pay the outstanding balance once the deposit is paid, moving the reservation to paid in full with its receipt and email.
- **DP-32 — Balance reminders at 21 and 7 days** Email each buyer still owing a balance the 21-day and 7-day reminders at most once each across every app process sharing the database, on the venue-local dates in Business rules.
- **DP-33 — Reserve-by deadline** Refuse new deposits from venue-local 20 March 2027 while still selling full-payment seats, publish deposits_open and hide the Pay deposit button when it is false, as stated in Business rules.
- **DP-34 — Atelier upgrade difference** Move a paid seat to an open Atelier bench and invoice only the price difference, split by the seat's state and the venue-local date as stated in Business rules.
- **DP-35 — Tier waitlists** Let a signed-in buyer join the waitlist for a tier with no bench to hold and show their position, as stated in Business rules.
- **DP-36 — Waitlist offers on server time** Offer each freed bench to the first waitlisted buyer for its tier for the server's offer window, email them, and pass a lapsed or declined offer to the next.
- **DP-37 — Hold-ended dialog** Show the hold-ended dialog with its published copy only after the server reports the hold released.
- **DP-38 — Accept a waitlist offer** A waitlisted practitioner gets the offer email, signs in, accepts the bench within the window and holds it with a fresh countdown.
- **DP-39 — Buyer cancellation frees the bench** Let the buyer cancel a paid seat up to the refund cut-off, freeing the bench for the waitlist and fixing the refund due, as stated in Business rules.
- **DP-40 — Dated refund schedule** Compute the refund due in integer cents from the venue-local date of the cancel request and the amount paid under the schedule in Business rules.
- **DP-41 — Registrar refund through Kill Bill** Let only the registrar send a cancelled seat's refund to Kill Bill, split across its payments newest first as stated in Business rules, and mark it refunded only after Kill Bill confirms every part.
- **DP-42 — Registrar reconciles and refunds** The registrar opens the desk, sees each reservation's paid and refunded amounts as Kill Bill records them, issues a refund and sees the row turn refunded.
- **DP-43 — Buy seats on one clinic account** A clinic buyer holds several benches together, pays one group invoice in full, optionally naming colleagues, and sees the group confirmation.
- **DP-44 — One group invoice, one item per seat** Bill a group checkout as one Kill Bill invoice with one item per seat whose amounts sum to the invoice total.
- **DP-45 — Group invoice confirmation heading** Show the group confirmation heading from Feedback states after a group payment is confirmed.
- **DP-46 — Group emails list names and benches only** Send group receipts and group refund emails that list each seat's bench and colleague name and never a licence number, passport detail or uploaded file.
- **DP-47 — Assign and reassign a seat** Let the buyer name or change the attendee of any of their paid seats until day 1 check-in, email the new colleague, and cut off the former assignee at once as stated in Business rules.
- **DP-48 — Each person sees only their own records** Show each colleague only their own seat, documents and certificate, and show the buying clinic seat status without licence or passport files, answering 404 for anything else.
- **DP-49 — Colleague accepts a seat** An assigned colleague signs up with the invited email, accepts the seat, uploads a licence and sees only their seat.
- **DP-50 — Cancel one group seat** Cancel and refund one group seat under the dated schedule, adjusting only that seat's invoice item so the items still sum to the invoice.
- **DP-51 — Upgrade one group seat** Upgrade one group seat on its own upgrade invoice without changing the group invoice or the other seats.
- **DP-52 — Safe document uploads** Accept licence and passport scans only as PDF, JPEG or PNG judged by content, within the size limit in API, stored privately in MinIO and fetched through short-lived signed links.
- **DP-53 — Registrar licence review** Let only the registrar mark an attendee's licence matched or rejected, as stated in Business rules.
- **DP-54 — Visa-support letters** Let the registrar issue a visa-support letter PDF once for an attendee with a passport scan and email them, recording nothing and sending nothing when storage fails.
- **DP-55 — Check-in on the venue date** Let front-desk staff check a paid-in-full attendee in for each course day only on that day's venue-local date in America/Chicago, as stated in Business rules.
- **DP-56 — Keyboard check-in desk** Let front-desk staff search by name and check an attendee in using only the keyboard, with the matches and announcements always for the latest search text.
- **DP-57 — CE certificate issued once** Issue the PACE-format certificate PDF only for an eligible attendee, generate it once with a gapless certificate number, re-serve the same object and email the attendee.
- **DP-58 — Kill Bill outage and recovery** While Kill Bill is unreachable, answer payment, refund and desk requests as stated in Services with the published copy, and resume when it returns without a restart.
- **DP-59 — Storage and mail outage recovery** While MinIO or Mailpit is unreachable, keep payments pending and mail queued as stated in Services, and finish them when the service returns without a restart.
- **DP-60 — Live hands-on share** Recompute the content desk's projected hands-on share and its 30% field error in place on every keystroke before saving, as stated in Interactions and Feedback states.

## Frontend

### Screens and layout (DP-07, DP-09, DP-13, DP-14, DP-18)

The app has these screens, all served from the one app origin:

- **Public site** at `/`. Seven chapters in this order, each at least one full viewport tall:
  1. **Overture**: brand, course title, dates, city and a split serif headline.
  2. **Method**: what the course teaches, the instructor, and the CE statement (credits, format and provider from Seed data).
  3. **Two days**: the agenda.
  4. **The lab**: the scene, the tier switch, the bench map and the hold panel. This chapter is about two viewport heights tall, and the scene stays in view while you scroll through it.
  5. **Evenings**: the hospitality list.
  6. **Venue**: the venue address and the hotels with their external map links.
  7. **Reserve**: prices, deadlines, the refund schedule, the FAQ, and the sign-in and account entry.
- **Account** at `/account`: "My seats". It shows the signed-in person's reservations as buyer or attendee, any groups, their waitlist entry and offers, and every action they may take.
- **Registrar desk** at `/desk`: the reservations table with search, refund, licence review, visa-letter and certificate actions.
- **Content desk** at `/desk/content`: the event director's editor for the four content kinds, the live hands-on share and the seat counts.
- **Check-in** at `/checkin`: the front-desk search and check-in screen for today's course day.
- Any other path shows the not-found page from Feedback states.

How the public site is arranged at each published viewport. No viewport scrolls sideways.

| Area | 1280x800 | 768x1024 | 375x812 |
|---|---|---|---|
| Chapter navigation | Numbered chapter rail fixed to the right edge, marking the current chapter | Same rail on the right edge | No rail. A `Menu` button in the header opens the chapter drawer |
| Reserve bar | Compact bar docked in the top-right of the header: seats remaining and the reserve button, or your live hold countdown | Same as 1280 | Full-width bar docked to the bottom of the viewport on every chapter. The page leaves room at the end so the bar hides no content |
| Headlines | Oversized split serif headline across the left two thirds (columns 1 to 8 of 12) | Full width, still split onto two or more lines | Full width |
| Agenda | Two text tabs (Day 1, Day 2) above a two-column session list | Same tabs above a one-column list | Tabs drawn as a full-width segmented switch with two equal halves, above a one-column list |
| Lab chapter | Scene on the left two thirds. On the right third: the tier switch, the bench map as 4 rows of 6, and the hold panel | Scene full width, then the tier switch, the bench map as 4 rows of 6, then the hold panel | Scene about half the viewport tall, then the tier switch, then the bench map as a stacked list grouped under row headings A to D, six benches each, one per line. The hold countdown and pay button sit in the docked reserve bar |
| Evenings | Three cards per line | Two cards per line | One card per line |
| Venue | Venue address and hotels side by side | Stacked | Stacked |

Agenda sessions and evening cards:
- Each session shows its number, format label (`Lecture` or `Hands-on`), minutes, title and outcomes.
- Each evening card shows its title, day and tier label. Its details (start time, venue and description) are collapsed behind a details button at every viewport.
- FAQ answers are collapsed at every viewport.

Collapsed panels: a collapsed FAQ answer, collapsed evening details and the closed chapter drawer are hidden and inert. Nothing inside them is visible, focusable or exposed to assistive tech until they are opened. Moving a panel off screen does not count as closing it.

Staff screens use one column at 375. At 768 and 1280 they use two columns, a table or list beside a detail or form panel. At 375 the registrar's table becomes one card per reservation. On the content desk, the `Hands-on share` status sits directly above the session form at every viewport.

### Public screens and controls (DP-09, DP-10, DP-14, DP-17, DP-20, DP-22, DP-26, DP-27, DP-43, DP-45, DP-56, DP-60)

Only the controls and regions below are public. Everything else is free. Copy that is not given here lives in Feedback states, which also defines the `<placeholders>`.

**Public site and lab**

| Role and accessible name | Where | Visible copy and notes |
|---|---|---|
| `navigation "Chapters"` | Rail at 768 and 1280, and inside the drawer | Links `01 Overture`, `02 Method`, `03 Two days`, `04 The lab`, `05 Evenings`, `06 Venue`, `07 Reserve`. The current chapter's link carries `aria-current="true"` |
| `button "Menu"` | Header at 375 | Opens `dialog "Chapters"`, which holds `button "Close menu"` and the chapter links |
| `button "Reserve a bench"` | Reserve bar | Scrolls to the lab chapter and moves focus into the bench map |
| text `<remaining> of 24 seats remaining` | Reserve bar | |
| `tablist "Agenda days"` with `tab "Day 1"` and `tab "Day 2"`, each controlling a `tabpanel` | Two days | Same roles when drawn as the segmented switch |
| `button` named by the FAQ question, with `aria-expanded` | Reserve | Toggles its answer |
| `button "Details for <evening title>"`, with `aria-expanded` | Each evening card | Toggles that card's details |
| text `Atelier guests` | Atelier-only evening cards | Shown with a lock glyph |
| `link "Map for <hotel name>"` | Venue | Opens the hotel's map link in a new tab |
| `progressbar "Loading the lab"` | Lab chapter | Counts 0 to 100, then is removed |
| `region "Lab scene"` | Lab chapter, only while the 3D scene runs | Carries the attributes listed in Motion and effects |
| `radiogroup "Tier"` with `radio "Bench"` and `radio "Atelier"` | Lab chapter | Bench is checked by default. While Atelier is sold out, the Atelier radio shows the text `Sold out` |
| `grid "Bench map"` with four `row`s named `Row A` to `Row D`, each holding six `gridcell`s | Lab chapter | Row A is nearest the demo station |
| `button "Bench <bench>, <state text>"` | One per gridcell | The state text is one of `Open`, `Atelier only`, `Sold out`, `Held`, `Held by you`, `Offered to you`, `Sold`, `Yours`, chosen as in Interactions. The same words show on the bench next to its glyph |
| `region "Your hold"` | Lab chapter (1280, 768) and reserve bar (375) | A heading with the bench label. Holds `timer "Hold time remaining"` showing `mm:ss`, `button "Pay deposit"` (only while the server reports deposits open), `button "Pay in full"` and `button "Release bench"`. For clinics it lists the selected benches and shows `button "Hold <n> benches"`, then `button "Pay group invoice"` |
| `button "Join the <tier name> waitlist"` | Lab chapter | Shown only while the selected tier has no bench you can hold |
| `status "Bench updates"` | Lab chapter | Polite live region |
| `alert` billing banner | Lab chapter and checkout | Shown only during a billing outage |

**Sign-in, account and checkout**

| Role and accessible name | Where | Visible copy and notes |
|---|---|---|
| `dialog "Sign in"` | Opened by holding while signed out, or from Reserve | `textbox "Email"`, `textbox "Password"`, `button "Sign in"`, `button "Create an account"` |
| `dialog "Create account"` | From the sign-in dialog | `textbox "Name"`, `textbox "Email"`, `textbox "Password"`, `radio "Practitioner"`, `radio "Clinic"`, `textbox "Clinic name"` (shown for Clinic), `button "Create account"` |
| `dialog "Checkout"` | From the hold panel | `textbox "Name for the receipt"` (prefilled with the account name), `button "Pay deposit $<deposit>"` or `button "Pay in full $<price>"`, `button "Close"`. After success it shows the confirmation heading and `button "Done"` |
| `dialog "Group checkout"` | From the clinic hold panel | One fieldset per bench with `textbox "Colleague name for Bench <bench>"` and `textbox "Colleague email for Bench <bench>"` (both optional), `textbox "Name for the receipt"`, `button "Pay group invoice $<total>"`, `button "Close"` |
| `dialog "Hold ended"` | Lab chapter | Heading and body from Feedback states, plus `button "Back to the map"` |
| `heading "My seats"` | Account | |
| `region "Bench <bench>"` | Account, one per reservation | The state label and the buttons that apply to its current state: `button "Pay balance $<balance>"`, `button "Upgrade to Atelier"`, `button "Cancel seat"`, `button "Assign to a colleague"`, `button "Accept seat"`, `button "Upload licence"`, `button "Upload passport scan"`, `button "Download receipt"`, `button "Download visa letter"`, `button "Download certificate"` |
| `region "Waitlist offer"` | Account | The offer heading, the `<left>` text, `button "Accept bench"` and `button "Decline"` |
| `status "Account updates"` | Account | Polite live region |

**Registrar desk and content desk**

| Role and accessible name | Where | Visible copy and notes |
|---|---|---|
| `searchbox "Find a reservation"` | Registrar desk | |
| `table "Reservations"` | Registrar desk | Columns: Bench, Attendee, Buyer, Tier, State, Paid in Kill Bill, Refunded in Kill Bill, Refund due, Licence |
| Row buttons | Registrar desk | `button "Issue refund $<amount>"`, `button "Open licence"`, `button "Mark licence matched"`, `button "Reject licence"`, `button "Issue visa letter"`, `button "Issue certificate"` |
| `status "Desk updates"` | Registrar desk and content desk | Polite live region |
| `tablist "Content"` with `tab "Agenda"`, `tab "Evenings"`, `tab "Hotels"`, `tab "FAQ"` | Content desk | Each tab has a list of items, a form, `button "Save"` and `button "Delete"` |
| `list "Sessions"` with `button "Session <number>: <title>"`, plus `button "New session"` | Content desk, Agenda tab | Selecting a session loads it into the form |
| Session form fields | Content desk, Agenda tab | `textbox "Number"`, `textbox "Day"`, `radiogroup "Format"` with `radio "Lecture"` and `radio "Hands-on"`, `textbox "Minutes"`, `textbox "Title"`, `textbox "Outcomes"` |
| `button "Confirm delete"` and `button "Keep session"` | Content desk, Agenda tab | Shown after pressing Delete on a session |
| `status "Hands-on share"` | Content desk, Agenda tab, above the form | Polite live region with the share text from Feedback states |
| `region "Seats"` | Content desk and registrar desk | Texts `Sold <n>`, `Held <n>`, `Waitlisted <n>` |

**Check-in**

| Role and accessible name | Where | Visible copy and notes |
|---|---|---|
| `heading` for the check-in day | Check-in | Copy from Feedback states |
| `searchbox "Attendee name"` | Check-in | |
| `list "Matches"` with `button "Check in <name> for day <day>"` | Check-in | |
| `status "Check-in updates"` | Check-in | Polite live region |

### Interactions (DP-14, DP-15, DP-18, DP-20, DP-23, DP-27, DP-33, DP-37, DP-43, DP-56, DP-60)

**Chapter navigation.** Clicking a rail or drawer link scrolls to that chapter and moves focus to its heading. The rail marks the chapter that fills most of the viewport.

**Agenda.** Clicking a tab, or pressing Left or Right while a tab has focus, selects the other day. Only the selected tab is in the Tab order (roving focus).

**FAQ and evening details.** Enter, Space or a tap toggles the answer or details. Focus stays on the button.

**Bench state text.** Each bench button's state text comes from the server's per-viewer state and the selected tier:
- A row A or B bench the server reports `open` reads `Sold out` while Atelier is sold out.
- Otherwise it reads `Atelier only` while the Bench tier is selected, and `Open` while Atelier is selected.
- Open C and D benches read `Open` under either tier. Holding one makes a Bench-tier reservation.
- The other server states map to `Held`, `Held by you`, `Offered to you`, `Sold` and `Yours`.
- The page refreshes the map from the server at least every two seconds. Straight after any of your own hold, release, payment or offer action, it refreshes again from the server's answer.

**Bench map, pointer and touch.** Clicking or tapping a bench, in the map or in the 3D scene, does the same thing as pressing Enter on its map button.

**Bench map, keyboard.**
- The map is one Tab stop. Tab lands on your held bench, or otherwise on the first `Open` bench in reading order.
- At 768 and 1280:
  - Left and Right move along a row and stop at its ends.
  - Up and Down move to the same seat number in the row before or after.
  - Home and End go to the first and last bench of the row.
- At 375 (the stacked list), Up and Down move to the previous and next bench in reading order across rows. Left and Right do the same.
- Enter on an `Open` bench asks the server to hold it. While signed out, Enter opens the sign-in dialog instead, and the hold request for that bench is sent once you sign in.
- Enter on an `Atelier only` bench only makes the announcement in Feedback states.
- Escape, pressed while focus is anywhere in the bench map or the hold panel, releases your hold. These keys work whichever bench has focus.

**Pressing hold.**
1. While the hold request runs, the bench keeps its previous state text. The hold panel opens showing only the pending text from Feedback states: no timer and no pay buttons yet.
2. On the server's 201, the panel shows the bench heading, the countdown and the pay and release buttons, and the bench reads `Held by you`.
3. On a 409, the panel closes. The page refetches the map at once and shows the server's state for the bench. It never shows `Held by you` for a bench the server refused.

**Clinic selection.** For a signed-in clinic account, Enter or a click toggles a bench in or out of the selection, up to six benches. `Hold <n> benches` then holds them all at once, following the same pending rule. Escape in the map clears the selection, or releases the group hold if one is live.

**Hold panel.**
- `Release bench` returns the bench to the map.
- `Pay deposit` appears only while the server's latest `deposits_open` is true. When it is false, the panel shows the Deposits-closed line from Feedback states in its place, and only `Pay in full` remains.
- The device clock never decides this.

**Checkout.**
- `Pay deposit` or `Pay in full` opens `dialog "Checkout"` with focus on the name field.
- Tab and Shift+Tab wrap inside the dialog. Escape or `Close` closes it and returns focus to the button that opened it.
- Pressing the pay button disables it and shows the pending copy.
- On success the dialog shows the confirmation heading. `Done` closes it and puts focus on the hold panel heading.
- `Group checkout` behaves the same way.

**Hold ended.** The `Hold ended` dialog opens only under the timing rules in Feedback states. Focus starts on `Back to the map` and wraps inside the dialog. Escape or the button closes it and returns focus to the bench map.

**Sign-in dialogs.** They trap Tab, close on Escape, and return focus to whatever opened them.

**Account actions.**
- `Upgrade to Atelier` opens a dialog where you pick an open Atelier bench and pay the difference.
- `Assign to a colleague` opens a dialog with name and email fields. On an already assigned seat, it replaces the assignee.
- `Upload licence` opens a dialog with `textbox "Licence number"`, `textbox "Issuing state"` and a file input.
- `Upload passport scan` opens a dialog with `textbox "Full name as in passport"`, `textbox "Nationality"`, `textbox "Passport number"` and a file input.
- Every dialog traps Tab, closes on Escape and returns focus to its opener.
- Download buttons fetch a fresh signed link and open the PDF in a new tab.

**Content desk, live hands-on share.** The `Hands-on share` status always shows the share the agenda would have if the form were saved now. It is computed in the browser from the loaded session list and the form's current values, with no network request.
- `t` is the total minutes and `h` is the hands-on minutes over all sessions. The session being edited counts once, with the form's current minutes and format in place of its stored ones.
- A new session form adds the form's session to the totals.
- After pressing `Delete` on a session, the totals leave that session out until `Keep session` is pressed.
- An empty or non-numeric Minutes field counts as 0 minutes.
- The share recomputes in place on every keystroke in Minutes and on every Format change, before Save.
- Whenever the projected share breaks the hands-on rule in Business rules, the Minutes field is marked invalid and shows the hands-on field error from Feedback states as its description. Exactly 30% does not show the error. When the share recovers, the error clears in place.
- Save stays available. A save that breaks the rule receives the server's 422, and the same error stays on the field.

**Check-in desk.**
- Pressing `/` anywhere on the check-in screen moves focus to the search box, unless focus is already in a text field.
- Typing at least two characters lists matches. The page may wait up to 200 milliseconds after the last keystroke before asking the server.
- The `Matches` list and every announcement always belong to the text currently in the box. An answer to an earlier text that arrives after a later one is ignored, whatever order the answers come in.
- Down from the search box moves to the first match button. Up and Down move between matches. Enter on a match checks that attendee in for today's day.
- Enter in the search box checks in the single match only when the list shown belongs to the current text and holds exactly one match. Otherwise Enter in the box does nothing.
- After a check-in, focus returns to the search box with its text selected, ready for the next name.
- The registrar desk's `Find a reservation` box follows the same latest-text rule.

**Touch on the lab scene.** A mostly sideways one-finger drag orbits the scene. A mostly vertical drag scrolls the page.

### Visual design (DP-06, DP-07, DP-08)

**Colour.**
- The page ground is a near-black warm umber.
- Text and fine rules are bone, a warm off-white like polished enamel.
- Raised panels and dividers use umber ink, a dark warm brown slightly lighter than the ground. No white or light panel appears above the fold on the public site.
- The only saturated colour is curing-light blue. It is used only for live and selected states: your held bench, the hold ring, the focus ring, the selected tab and the active rail marker.
- Priority gold is used only for Atelier marks: the rim of row A and B benches, the lock glyph and the `Atelier guests` label.

**Type.**
- Display headings use Bodoni Moda, a high-contrast didone serif with hairline strokes, split across two or more lines at the largest sizes.
- Body text and controls use Instrument Sans, a compact grotesk.
- Each step in the type scale is about a third larger than the one below. Chapter headlines are the largest step, roughly four to six times the body size at 1280.
- Both fonts are self-hosted.

**Numerals.** Every number is set in tabular figures and drawn from the same small set of size steps. That covers prices, countdowns, seat counts, bench labels, session numbers and minutes, the hands-on share and chapter numbers. Countdowns and chapter numbers use a monospaced face.

**Density and composition.** The layout is airy, with generous space between groups. Each chapter fills the viewport on a 12-column grid, with headlines in columns 1 to 8 and the numbered rail on the right edge. The staff screens use the same ground, inks and type: tables in bone on umber, form errors in bone with a curing-blue marker, and the same tabular numerals.

**Size and contrast.** Every control is at least 44 by 44 CSS pixels to tap. All text and every control state meets WCAG 2.2 AA contrast against its background. Focus always shows as a curing-blue ring.

### Motion and effects (DP-15, DP-16, DP-17, DP-21)

**Motion vocabulary.** State changes start fast and settle gently.
- Hover and press feedback on benches and buttons, such as a brighter rim, takes about a fifth of a second.
- State changes on benches, tabs and panels take about a third of a second.
- Counting numerals and the lift settle take about six tenths of a second.
- Chapter headline wipe reveals and the preloader finish within nine tenths of a second.

**Preloader.** Once the lab's assets are ready, `progressbar "Loading the lab"` counts from 0 to 100 within at most nine tenths of a second. It is then removed, and the scene's `data-ready` becomes `true`.

**Lab scene (Bench Lift).** The procedural 3D lab is drawn on a canvas inside `region "Lab scene"`. It shows 24 extruded benches in four rows of six, facing an instructor's demo station, with a soft cone of light under each bench's curing lamp. No images or video are used. The scene never moves on its own: there is no idle rotation and no looping effect.

The region carries these attributes, updated as the camera and the selected bench change:

| Attribute | Value |
|---|---|
| `data-azimuth` | Degrees, one decimal |
| `data-elevation` | Degrees, one decimal |
| `data-scroll-progress` | 0 to 1, two decimals |
| `data-selected-bench` | A bench label, or empty |
| `data-ready` | `true` once the preloader is done |
| `data-lift` | The selected bench's lift, from 0 (resting) to 1 (fully lifted), two decimals |
| `data-ring` | `none`, `depleting` or `band` |
| `data-ring-remaining` | While `data-ring` is `depleting`, the share of ring left, 0 to 1, two decimals. Empty otherwise |

Bench glyphs and fills by state:

| State | Look |
|---|---|
| Open | Bone outline |
| Atelier only / Sold out | Gold rim and lock |
| Held | Dim umber with a small clock glyph |
| Held by you / Offered to you | Curing blue with a ring |
| Sold | Filled umber with a dot |
| Yours | Solid curing-blue band |

How the scene responds:

1. **Scroll.** As the lab chapter scrolls from its top meeting the top of the viewport to its bottom meeting the bottom, `data-scroll-progress` goes from 0 to 1. Over that range the camera moves from an overhead plan (elevation 62 degrees) to bench height (elevation 20 degrees), always in the same direction as the scroll. Scrolling back reverses it step by step.
2. **Drag.** A horizontal drag with a mouse or one finger orbits the azimuth. A vertical mouse drag offsets the elevation. The published range is azimuth −35 to +35 degrees and elevation 20 to 62 degrees. While dragging, the camera can be pulled past the range by at most 8 degrees, with growing resistance. On release it springs back inside the range and settles within six tenths of a second, overshooting at most once.
3. **Pending.** While a hold request runs, the bench does not move:
   - `data-lift` stays `0.00`.
   - `data-ring` stays `none`.
   - `data-selected-bench` keeps its previous value.
   - The hold panel heading has no `data-letter` elements.
4. **Lift.** On the server's 201 for your hold, the bench rises on a spring and settles within six tenths of a second. At that point `data-lift` reads `1.00` and `data-selected-bench` names the bench.
   - The bench label in the hold panel heading splits into individual letters that rise one after another over about a third of a second. While the scene runs, each character of `<bench>` in that heading is its own element carrying a `data-letter` attribute and hidden from assistive tech. The heading's accessible name stays the full text.
   - A clinic's selection, before holding, lifts each selected bench the same way as a selection marker.
5. **Ring.** From the 201, a curing-blue ring around the held bench depletes continuously, and `data-ring` reads `depleting`.
   - `data-ring-remaining` equals the server's `seconds_remaining` divided by the hold's `duration_seconds`, counted down on the page's elapsed time, to within 0.02.
   - The same time shows in the `timer` as `mm:ss`, updating at least once a second.
6. **Lost.** If the server refuses the hold, the bench never lifts. It turns `Held` or `Sold` straight from the refetched server state, with no intermediate state. If a live hold of yours is later reported released, the lift reverses: `data-lift` returns to `0.00` and `data-ring` to `none`.
7. **Converted.** When payment is confirmed, the ring closes into a solid band over about six tenths of a second (`data-ring` reads `band`), and the bench stays lifted as `Yours`.
8. **Seats count.** When the seats remaining change, the numerals count from the old to the new value over about six tenths of a second.

**Reduced motion.** With reduced motion set, the canvas and `region "Lab scene"` are not rendered. The lab chapter shows only the flat bench plan: the same `grid "Bench map"` of labelled buttons in rows A to D, with the same glyphs and state words, stacked by row below 768.
- Nothing moves: no orbit, lift, spring, scroll scrub, kinetic letters, headline wipe or counting numerals.
- The hold panel heading holds the bench label as plain text, with no `data-letter` elements.
- Every value shows its final state at once, and the timer text updates once a second.
- Hold, release, waitlist and checkout work exactly the same.

**No WebGL.** Without WebGL the same flat plan shows, with the no-WebGL line from Feedback states above it.

Nothing else on the site moves except the preloader while it loads, and the ring and countdown while a hold is live. No unnamed decorative loops are allowed.

### Feedback states (DP-22, DP-26, DP-30, DP-33, DP-37, DP-45, DP-54, DP-56, DP-57, DP-58, DP-59, DP-60)

**Placeholders used in copy:**

| Placeholder | Meaning |
|---|---|
| `<bench>` | A bench label such as `C4` |
| `<remaining>` | The ledger seats remaining |
| `<n>` | A count |
| `<tier name>` | `Bench` or `Atelier` |
| `<position>` | A waitlist position |
| `<name>` | An attendee's name |
| `<day>` | `1` or `2` |
| `<query>` | The current search text |
| `<missing>` | The eligibility gaps joined by `, `, using the words `balance unpaid`, `day 1 check-in`, `day 2 check-in`, `licence not matched`, in the same order as `missing` in API |
| `<left>` | `<hh:mm:ss> left to accept`, from the offer's server `seconds_remaining` |
| `<h>`, `<t>` | Hands-on minutes and total minutes as whole numbers, defined in Interactions |
| `<p>` | `floor(h × 1000 ÷ t) ÷ 10` printed with exactly one decimal, or `0.0` when `t` is 0 |
| `<deposit>`, `<price>`, `<balance>`, `<total>`, `<refund>`, `<amount>` | Dollar amounts with thousands commas and two decimals, without the dollar sign (the copy prints it) |

Every message below shows on screen and is announced in its named polite live region.

**Bench updates.** While a hold request runs, the hold panel shows the pending text `Holding Bench <bench>` (for a clinic, `Holding <n> benches`).

| Event | Copy |
|---|---|
| Hold placed | `Bench <bench> is held for you. <remaining> of 24 seats remaining.` |
| Group hold placed | `<n> benches are held for you. <remaining> of 24 seats remaining.` |
| Hold refused with `409 bench_taken`, including a lost race for the last Atelier place | `Bench <bench> was just taken. <remaining> of 24 seats remaining.` |
| Hold refused with `409 atelier_sold_out` | `Atelier is sold out. <remaining> of 24 seats remaining.` |
| Enter on an Atelier-only bench | `Bench <bench> is an Atelier bench. Switch to Atelier to hold it.` |
| Released | `Bench <bench> released. <remaining> of 24 seats remaining.` |
| Hold ended | `Your hold on Bench <bench> has ended. <remaining> of 24 seats remaining.` |
| Payment confirmed | `Bench <bench> is yours. <remaining> of 24 seats remaining.` |
| Group payment confirmed | `<n> benches are yours. <remaining> of 24 seats remaining.` |
| Payment pending (202) | `Payment for Bench <bench> is being confirmed. We will update this page and email your receipt.` |
| Group payment pending | `Payment for <n> benches is being confirmed. We will update this page and email your receipt.` |
| Billing offline (503) | `Billing is offline right now. Your hold keeps running and no money has moved.` The same text shows in the `alert` banner |
| Deposits closed (409 `deposits_closed`) | The Deposits-closed line below |
| Waitlist joined | `You are number <position> on the <tier name> waitlist.` |

**Payment and hold screens.**
- Deposits-closed line, shown in the hold panel in place of `Pay deposit` whenever the server reports deposits closed: `Deposits closed on 19 March 2027. Pay in full to reserve a bench.`
- While a payment request is in flight, the pay button reads `Processing payment` and is disabled.
- When the countdown reaches zero with no server answer yet, the hold panel shows `Checking your hold` until the next server status, which comes within two seconds.
- Confirmation heading, in the checkout dialog and the hold panel: `Bench <bench> is yours`.
- Group confirmation heading: `Group invoice confirmed: <n> seats on one invoice`.
- Atelier sold out, shown above the map while the Atelier tier is selected:
  - Heading `Atelier is sold out`.
  - Banner `All 10 Atelier places are taken. Join the Atelier waitlist and we will offer you the next Atelier bench that opens.`
- Hold-ended dialog: heading `Your hold has ended`, body `Bench <bench> is back on the map. Pick another bench or join the waitlist.`
- No-WebGL line: `The 3D lab needs WebGL. Here is the flat bench plan.`

**Timing rules for these screens.**
- The countdown starts from the `seconds_remaining` in the latest server response and counts down on the page's own elapsed time. It never reads the device date.
- The hold-ended dialog and message appear only when the server reports the hold `released`. They never appear for a reservation whose payment request was sent before the countdown ended.
- Once a confirmation, pending message or billing-offline message is shown, later background refreshes never replace it. It stays until the user acts again or the server reports a newer state for that reservation. A pending message becoming confirmed is replaced by the confirmation.

**Account updates.**

| Event | Copy |
|---|---|
| Balance paid | `Bench <bench> is paid in full.` |
| Upgraded | `Bench <bench> is now your Atelier bench.` |
| Cancelled | `Bench <bench> is cancelled. Refund due: $<refund>. The registrar will send it.` |
| No refund window | `Refunds closed on 19 March 2027. You can assign this seat to a colleague instead.` |
| Assigned | `Bench <bench> is assigned to <name>. We emailed them.` |
| Seat accepted | `Bench <bench> is now your seat.` |
| Licence uploaded | `Licence received. The registrar will check it.` |
| Passport uploaded | `Passport scan received. The registrar will prepare your letter.` |
| Offer accepted | The Bench updates hold-placed copy |
| Offer lapsed | `This offer has passed to the next person on the waitlist.` |
| Wrong file type | `Upload a PDF, JPEG or PNG file.` |
| File too large (`file_too_large` or `payload_too_large`) | `Files must be 10,000,000 bytes or smaller.` |
| Storage offline | `Uploads are unavailable right now. Nothing was saved; try again shortly.` |
| Document offline | `Documents are unavailable right now. Try again shortly.` |

Account pages also use the Bench updates billing-offline and pending copy for balance, full and upgrade payments.

**Offer region.** Heading `Bench <bench> is waiting for you`, then `<left>`.

**Desk updates.**

| Event | Copy |
|---|---|
| Refund sent | `Refunded $<amount> for Bench <bench>.` |
| Refund blocked by billing outage | `Refund not sent: Kill Bill is not answering. Nothing was refunded.` |
| Licence matched | `Licence matched for <name>.` |
| Licence rejected | `Licence rejected for <name>.` |
| Visa letter issued | `Visa-support letter issued to <name>.` |
| Visa letter blocked by storage outage | `Visa letter not issued: document storage is not answering. Nothing was sent.` |
| Certificate issued | `Certificate issued to <name>.` |
| Certificate blocked by storage outage | `Certificate not issued: document storage is not answering. No certificate number was used.` |
| Certificate not ready | `Certificate not ready: <missing>.` |
| Content saved | `Saved. The public site shows it on the next load.` |
| Hands-on rule, as the Minutes field error and the server's `errors.minutes` | `Hands-on time must stay at least 30% of the agenda.` |

- **Hands-on share** status text: `Hands-on <h> of <t> minutes (<p>%)`. For example, with the seed data at start it reads `Hands-on 690 of 960 minutes (71.8%)`.
- Desk billing banner (`alert`): `Kill Bill is not answering. Paid and refunded totals will refresh when it is back.` While the banner shows, the two Kill Bill columns read `Unavailable`.

**Check-in.**

Day heading: `Day 1 check-in`, `Day 2 check-in` or `Check-in is closed today`, from the server's `open_day`.

| Event | Copy |
|---|---|
| Matches listed | `Found <n> for "<query>".` |
| No matches | `No attendee matches "<query>".` |
| Checked in | `<name> checked in for day <day>.` |
| Already checked in | `<name> is already checked in for day <day>.` |
| Balance due | `<name> has a balance due. Send them to the registrar.` |
| Day 2 before day 1 | `<name> has no day 1 check-in. Send them to the registrar.` |
| No attendee on the seat | `This seat has no attendee yet. Send them to the registrar.` |

**Other.**
- Sign-in failure: `Email or password is incorrect.`
- Field errors show under each field, and an error summary at the top of the form links to each field.
- Content unavailable: `The programme is loading slowly. Refresh in a moment.`
- Not-found page heading: `This page is not on the programme`.

## Backend

### API (DP-03, DP-04, DP-10, DP-11, DP-18, DP-19, DP-25, DP-28, DP-31, DP-33, DP-34, DP-35, DP-36, DP-39, DP-41, DP-44, DP-47, DP-48, DP-52, DP-53, DP-54, DP-55, DP-57)

**Conventions.**
- All endpoints live under `/api`. They take and return `application/json`, except uploads, which take `multipart/form-data`.
- Sign-in sets the session cookie `ob_session` (HttpOnly, SameSite=Lax).
- Time-bearing responses include `server_time` (ISO 8601 UTC, always the real server clock).
- Money is always integer cents in fields ending `_cents`.
- Every id the app issues (accounts, reservations, groups, offers) is a random string of at least 16 characters after its prefix (`acc_`, `res_`, `grp_`, `off_`), never sequential.
- Bench labels (`A1` to `D6`) in request bodies are values, not ids. A label outside that set answers 422 on its field (`benches` or `bench`). A group-checkout assignment naming a bench that is not in the group answers 422 on `assignments`.

**Error shape.** Every error is `{"error":"<code>","message":"<free text>"}`. Some errors add a field:
- Validation errors add `"errors":{"<field>":"<message>"}`.
- The certificate check adds `"missing":[...]`.
- Hold conflicts add `"waitlist":{"tier":"bench"|"atelier","open":true|false}`.

**Access annotations.** Each endpoint row names who may call it, in parentheses.
- `practitioner`, `clinic`, `registrar`, `director` and `frontdesk` are roles.
- `buyer`, `attendee`, `offeree` and `assignee` are relationships to the id in the path. Only practitioner and clinic accounts can hold them.
- A signed-in account gets `403 forbidden` when its role can never pass the row. That includes:
  - every staff role the row does not name, for example a registrar or director calling a buyer-only payment endpoint, or a director calling `GET /api/reservations/{id}`;
  - practitioner and clinic accounts on registrar desk, content desk and check-in endpoints;
  - a practitioner or clinic account on a row that names only the other buyer role.
- A practitioner or clinic account that may call the row but lacks the named relationship to that id gets `404 not_found`, never 403.

**Error precedence** is the same for the whole API, and the first rule that applies decides:
1. `403 {"error":"cross_origin"}` from the origin check in Server boundary.
2. `413 {"error":"payload_too_large"}` for a request over the size limits in Server boundary.
3. `401 {"error":"unauthenticated"}`.
4. A completed idempotent replay returns its stored response.
5. `403 {"error":"forbidden"}` under the access annotations above. This is checked before any id is looked up.
6. `400 {"error":"malformed_json"}` or `415 {"error":"unsupported_media_type"}` for a body that cannot be parsed.
7. `404 {"error":"not_found"}` for any id, in the path or the body, that does not exist or that the caller may not see.
8. `409` state conflicts, with the codes below. Any illegal state move not named below is `409 {"error":"invalid_transition"}`.
9. `422 {"error":"validation","errors":{...}}`.
10. `413 {"error":"file_too_large"}`, then `415 {"error":"unsupported_file_type"}`.
11. `503` dependency codes: `billing_unavailable`, `storage_unavailable` or `content_unavailable`. One exception: the content endpoints keep their records and the hands-on check in PocketBase, so while PocketBase is unreachable they answer `503 content_unavailable` straight after rule 6.

Endpoint rows below list only their own extra codes.

**Idempotency-Key header.** The payment, upgrade, group-checkout and refund endpoints require it. It is 8 to 128 characters from letters, digits, `-` and `_`. A missing or malformed key is `422 {"errors":{"idempotency_key":"..."}}`.

**Reservation object.**

```json
{"id":"res_…","bench":"C4","tier":"bench","state":"held","group_id":null,
 "buyer":{"name":"…","kind":"practitioner"},
 "attendee":{"name":"…","email":"…","accepted":true},
 "price_cents":345000,"paid_cents":0,"balance_cents":345000,"refund_due_cents":null,
 "hold":{"expires_at":"…","seconds_remaining":412,"duration_seconds":480},
 "payment_pending":null,"licence_status":"none","passport_status":"none",
 "checked_in":{"day1":false,"day2":false},"documents":["deposit-receipt"]}
```

The values shown are for a fresh Bench hold with the default hold length.

| Field | Values |
|---|---|
| `state` | `held`, `deposit_paid`, `paid_in_full`, `checked_in_day1`, `checked_in_day2`, `certificate_issued`, `released`, `cancelled` or `refunded` |
| `hold` | Null unless `state` is `held`. `seconds_remaining` is never below 0 |
| `payment_pending` | Null, or one of `deposit`, `balance`, `full`, `upgrade`, `group` |
| `licence_status` | `none`, `submitted`, `matched` or `rejected` |
| `passport_status` | `none` or `submitted` |
| `documents` | The generated document kinds |

**Accounts.**
- `POST /api/auth/signup` `{"name","email","password","kind":"practitioner"|"clinic","clinic_name"?}` → `201 {"account":{"id","name","email","role"}}`, signed in.
  - `409 email_taken`.
  - 422 field rules: `name` 1 to 120 characters, `email` a valid email, `password` 10 to 128 characters, and `clinic_name` 1 to 120 characters, required for a clinic.
- `POST /api/auth/signin` `{"email","password"}` → `200 {"account":{...}}`. A wrong pair answers `401 {"error":"invalid_credentials"}`.
- `POST /api/auth/signout` → `204`.
- `GET /api/me` → `200 {"account":{...},"reservations":[...],"groups":[...],"waitlist":null|{"tier","position"},"offers":[{"id","bench","tier","state","seconds_remaining"}],"venue_date":"YYYY-MM-DD","deposits_open":true|false,"server_time"}`.
- `role` is one of `practitioner`, `clinic`, `director`, `registrar` or `frontdesk`. Emails compare case-insensitively.

**Public.**
- `GET /api/health` → `200 {"status":"ok"}`.
- `GET /api/benches` (anonymous allowed) → `200 {"server_time","venue_date","deposits_open","seats_total":24,"seats_remaining","held","sold","tiers":{"bench":{"remaining"},"atelier":{"remaining","cap":10,"active","sold_out"}},"benches":[{"label","row","number","tier","state"}]}`.
  - Each bench `state` is relative to the caller: `open`, `held`, `held_by_you`, `offered_to_you`, `sold` or `yours`.
  - `held_by_you`, `offered_to_you` and `yours` are computed for each request from the caller's own session. A response is never reused for another account, or between an account and anonymous callers.
  - Anonymous callers see only `open`, `held` and `sold`.
- `GET /api/content` (anonymous allowed) → `200 {"sessions":[...],"hospitality":[...],"hotels":[...],"faq":[...]}`.
  - Sessions are ordered by day, then number. FAQ entries are ordered by `sort`.
  - Gated evenings appear as `{"id","title","day","tier":"atelier","gated":true}`.
  - PocketBase unreachable: `503 {"error":"content_unavailable"}`.

**Holds and reservations.**
- `POST /api/holds` `{"benches":["C4"]}` (practitioner or clinic) → `201 {"reservations":[...],"group_id":null|"grp_…","seats_remaining","server_time"}`.
  - `409 bench_taken`: some bench is not open.
  - `409 atelier_sold_out`: every requested bench is open, but the Atelier cap is reached.
  - `409 already_reserved`: the practitioner already has an active reservation, live offer or waitlist entry, or already attends a seat.
  - `409 hold_limit`: the clinic already has a live group hold.
  - Both bench conflicts carry `waitlist`.
  - 422: an empty list, duplicates, more than one bench for a practitioner, or more than six for a clinic.
- `POST /api/reservations/{id}/release` (buyer) → `200 {"reservation","seats_remaining"}`.
- `POST /api/groups/{id}/release` (buyer) → `200 {"group","seats_remaining"}`.
- `GET /api/reservations/{id}` (buyer, attendee, registrar) → `200 {"reservation","server_time"}`.
- `GET /api/groups/{id}` (buyer, registrar) → `200 {"group":{"id","state","reservations":[...],"invoice":null|{"kb_invoice_id","items":[{"bench","amount_cents"}],"total_cents"}}}`.
  - Each item's `amount_cents` is that seat's item amount net of its adjustments.
  - `total_cents` equals both their sum and the Kill Bill invoice amount.

**Payments.** All payment endpoints are buyer-only, take `Idempotency-Key`, and take the body `{"billing_name":"…"}` (1 to 120 characters).
- `POST /api/reservations/{id}/deposit` → `201 {"reservation"}` with `state` `deposit_paid`.
  - `409 hold_expired`, `409 already_paid`, `409 deposits_closed`.
- `POST /api/reservations/{id}/full` → `201` with `paid_in_full`.
  - `409 hold_expired`, `409 already_paid`.
- `POST /api/reservations/{id}/balance` → `201` with `paid_in_full`.
  - `409 not_deposit_paid`.
- `POST /api/reservations/{id}/upgrade` `{"bench":"A3","billing_name"}` → `201`, with the reservation on the new bench, `tier` `atelier`, and `paid_cents` and `balance_cents` from the upgrade rule in Business rules.
  - `409 not_paid`, `409 already_atelier`, `409 bench_taken`, `409 atelier_sold_out`.
  - `422 {"errors":{"bench":"…"}}` when the bench is not in row A or B.
- `POST /api/groups/{id}/checkout` `{"billing_name","assignments":[{"bench","name","email"}]}` → `201 {"group"}`, with every reservation `paid_in_full` and `invoice` filled.
  - Assignments are optional. Each one names a bench of the group.
  - `409 hold_expired`, `409 already_paid`, `409 already_attending` (an assignment email already attends another seat).
- Every payment endpoint:
  - answers `503 {"error":"billing_unavailable"}` when Kill Bill cannot confirm;
  - answers `202 {"reservation"}` (or `202 {"group"}`) with `payment_pending` set when Kill Bill confirmed but the receipt could not be stored yet;
  - answers `409 {"error":"idempotency_conflict"}` when the key was used before for a different endpoint or body.

**Cancellation and refunds.**
- `POST /api/reservations/{id}/cancel` (buyer) → `200 {"reservation"}` with `state` `cancelled` and `refund_due_cents`.
  - `409 no_refund_window`.
- `POST /api/desk/reservations/{id}/refund` (registrar, `Idempotency-Key`, empty body) → `200 {"reservation","refund":{"amount_cents","transaction_external_keys":[...]}}` with `state` `refunded`.
  - The keys are listed in ascending order of their `<n>` suffix, starting from `-1`.
  - `409 not_cancelled`, `409 already_refunded`, `503 billing_unavailable`.

**Waitlist and offers.**
- `POST /api/waitlist` `{"tier":"bench"|"atelier"}` (practitioner) → `201 {"tier","position"}`.
  - `409 benches_available`, `409 already_reserved`.
  - 422 for an unknown tier.
- `DELETE /api/waitlist` → `204`.
- `POST /api/offers/{id}/accept` (offeree) → `201 {"reservations":[...],"seats_remaining","server_time"}` with a fresh hold.
  - `409 offer_lapsed`.
- `POST /api/offers/{id}/decline` (offeree) → `200 {"offer"}`.

**Seats, attendees and documents.**
- `PUT /api/reservations/{id}/assignee` `{"name","email"}` (buyer) → `200 {"reservation"}`.
  - `409 already_attending`.
  - `409 invalid_transition` from any state other than `deposit_paid` or `paid_in_full`.
  - 422 on `name` and `email`.
- `POST /api/reservations/{id}/accept` (assignee: the account whose email matches the currently named assignee) → `200 {"reservation"}`.
  - `409 already_attending`.
- `POST /api/reservations/{id}/licence` (attendee only), multipart with fields `licence_number` (1 to 40 characters), `licence_state` (1 to 60 characters) and `file` → `201 {"reservation"}` with `licence_status` `submitted`.
  - `409 licence_locked` once the licence is matched.
- `POST /api/reservations/{id}/passport` (attendee only), multipart with fields `full_name`, `nationality` and `passport_number` (each 1 to 120 characters) and `file` → `201`.
- Both upload endpoints answer:
  - `413 {"error":"file_too_large"}` above 10,000,000 bytes. Exactly 10,000,000 bytes is allowed.
  - `415 {"error":"unsupported_file_type"}` when the content is not PDF, JPEG or PNG.
  - `503 {"error":"storage_unavailable"}`.
  - 422 for a missing field, and `422 {"errors":{"file":"…"}}` for a request with more than one file part.
- `GET /api/reservations/{id}/licence` → `200 {"licence_number","licence_state","status","url","expires_in":60}`, and `GET /api/reservations/{id}/passport` → `200 {"full_name","nationality","passport_number","url","expires_in":60}`.
  - Attendee and registrar only. The buyer of a seat they do not attend gets 404.
  - No upload yet: 404.
- `GET /api/reservations/{id}/documents/{kind}`, where `kind` is one of `deposit-receipt`, `balance-receipt`, `full-receipt`, `upgrade-receipt`, `visa-letter` or `certificate` → `200 {"url","expires_in":60}`.
  - Receipts: buyer and registrar. Visa letter and certificate: attendee and registrar.
  - Not generated: 404. MinIO down: `503 storage_unavailable`.
- `GET /api/groups/{id}/documents/invoice` (buyer, registrar) → same shape.

**Registrar desk.** Every endpoint is role `registrar`, except inventory, which is also open to `director`.
- `GET /api/desk/reservations?q=` → `200 {"billing":"ok"|"unavailable","reservations":[{...reservation,"buyer_email","kb":{"paid_cents","refunded_cents"}|null}]}`.
  - `q` matches attendee name, buyer name or bench.
  - `kb` holds that seat's confirmed purchases and refunds as Kill Bill records them. For a group seat, that is its own item's share of the group payment plus any upgrade payment.
- `POST /api/desk/reservations/{id}/licence-review` `{"decision":"matched"|"rejected","note"?}` → `200 {"reservation"}`.
  - `409 no_licence`.
  - 422 on `decision`.
- `POST /api/desk/reservations/{id}/visa-letter` → `201 {"reservation"}` the first time, then `200` with the same document.
  - `409 passport_missing`, `409 not_paid`, `503 storage_unavailable`.
- `POST /api/desk/reservations/{id}/certificate` → `201 {"reservation","certificate_number"}` the first time, then `200` with the same number and object.
  - `409 {"error":"certificate_not_eligible","missing":[...]}`. `missing` lists only the gaps that apply, always in this order: `balance_unpaid`, `day1_check_in`, `day2_check_in`, `licence_not_matched`.
  - `503 storage_unavailable`.
- `GET /api/desk/inventory` → `200 {"seats_total":24,"seats_remaining","held","sold","waitlisted":{"bench","atelier"},"atelier":{"active","cap":10,"remaining","sold_out"}}`.

**Content desk** (role `director`). `{kind}` is one of `sessions`, `hospitality`, `hotels` or `faq`.
- `GET /api/desk/content/{kind}` → `200 {"items":[...]}`.
- `POST /api/desk/content/{kind}` → `201 {"item"}`.
- `PATCH /api/desk/content/{kind}/{id}` → `200 {"item"}`. A PATCH changes only the fields it sends.
- `DELETE /api/desk/content/{kind}/{id}` → `204`.
- Any of them: `503 content_unavailable`.
- 422 field rules:
  - Session: `number` a positive integer unique within the agenda; `day` 1 or 2; `title` 1 to 120 characters; `format` `lecture` or `hands-on`; `minutes` an integer from 15 to 480; `outcomes` 0 to 600 characters. The hands-on rule from Business rules errors on `minutes`.
  - Hospitality: `title`; `day` 1 or 2; `starts_at` as `HH:MM`; `venue`; `tier` `all` or `atelier`; `description`.
  - Hotel: `name`; `distance`; `rate`; `map_url`, an `https` URL.
  - FAQ: `question`; `answer`; `sort` an integer.

**Check-in** (role `frontdesk`).
- `GET /api/checkin?q=` → `200 {"q","venue_date":"YYYY-MM-DD","open_day":1|2|null,"results":[{"reservation_id","attendee_name","bench","day1","day2"}]}`.
  - `q` echoes the query that produced the results.
  - At most 10 results: a case-insensitive substring match on attendee name, over seats that have an attendee.
  - `q` must be at least 2 characters, or the answer is 422.
- `POST /api/checkin` `{"reservation_id","day":1|2}` → `201 {"reservation"}`.
  - `409 checkin_closed`, `409 already_checked_in`, `409 balance_due`, `409 not_checked_in_day1`, `409 no_attendee`.

### Business rules (DP-03, DP-10, DP-12, DP-18, DP-19, DP-24, DP-25, DP-28, DP-29, DP-30, DP-32, DP-33, DP-34, DP-35, DP-36, DP-39, DP-40, DP-41, DP-47, DP-48, DP-50, DP-51, DP-53, DP-54, DP-55, DP-57)

**Roles.**
- Practitioners and clinics buy.
- Only the registrar refunds, reviews licences, issues visa letters and issues certificates.
- Only front-desk staff check in.
- Only the event director edits content.
- Staff accounts cannot hold, buy or attend.
- A clinic account never attends. A practitioner attends at most one seat at a time: their own active reservation, or one accepted assignment.

**Venue-local time.**
- Every calendar rule uses the venue-local date in America/Chicago, under the real time-zone rules. That covers the reserve-by date, reminders, the refund schedule, the upgrade split, `deposits_open` and check-in days.
- Chicago is six hours behind UTC until 2:00 local time on Sunday 14 March 2027, and five hours behind from then. For example, 05:30 UTC on 16 January 2027 is still 15 January in Chicago, and 04:30 UTC on 20 March 2027 is still 19 March.
- When `BENCH_DAYS_NOW` is set, the venue-local date comes from that frozen instant. Otherwise it comes from the real clock.
- Hold timers, offer timers and `server_time` always run on the real server clock.
- `venue_date` publishes the venue-local date. `deposits_open` is true exactly when that date is on or before 19 March 2027.
- The browser never works out either value from the device clock, which may be wrong.

**Benches and tiers.**
- There are 24 benches, labelled `A1` to `D6`: rows A to D, numbers 1 to 6, with row A nearest the demo station.
- Rows A and B (12 benches) are Atelier benches. Rows C and D are Bench-tier benches. A reservation's tier is the tier of its bench's row.
- The Atelier tier has a hard cap of 10 active Atelier places. An active Atelier place is an A or B bench under a live offer, or an Atelier reservation in `held`, `deposit_paid`, `paid_in_full`, `checked_in_day1`, `checked_in_day2` or `certificate_issued`.
- When the cap is reached, Atelier is sold out (`sold_out` true). No row A or B bench can then be held, offered or upgraded to, even if some are open.

**Prices**, in integer USD cents:

| | Bench tier | Atelier tier |
|---|---|---|
| Full price | 345000 ($3,450.00) | 590000 ($5,900.00) |
| Deposit | 90000 ($900.00) | 150000 ($1,500.00) |
| Balance | 255000 ($2,550.00) | 440000 ($4,400.00) |

**The ledger count.** One ledger computation in Postgres produces every count. The bench map, `GET /api/benches`, `GET /api/desk/inventory`, the `Seats` region, the reserve bar and every mutation response all report its result.
- `held`: benches under a live hold plus benches under a live waitlist offer. A hold counts as live while it is unexpired. It also counts as live past `expires_at` while it is kept by a running payment request or a confirmed, receipt-pending payment, as stated in Holds.
- `sold`: benches whose reservation is in an active state past `held` (`deposit_paid` through `certificate_issued`).
- `seats_remaining` is `24 − held − sold`.
- An offered bench is not open. Anonymous callers see it as `held`.
- `tiers.bench.remaining` is the number of open C and D benches.
- `tiers.atelier.active` counts active Atelier places, live offers included.
- `tiers.atelier.remaining` is the smaller of the open A and B benches and `10 − active`.
- At every read, the number of benches an anonymous caller sees as not `open` equals `24 − seats_remaining`.
- A mutation response's `seats_remaining` equals what a `GET /api/benches` made straight after it returns, when nothing else changed in between.
- `Waitlisted <n>` and `waitlisted` count entries still in `waitlisted` (offered entries count under held).
- `paid_cents` is the seat's Kill Bill-confirmed payments minus confirmed refunds. `balance_cents` is `price_cents` minus confirmed payments.

**Reservation state machine.** The legal moves are:
- `held` → `deposit_paid` (deposit confirmed)
- `held` → `paid_in_full` (full payment or group checkout confirmed)
- `deposit_paid` → `paid_in_full` (balance confirmed)
- `paid_in_full` → `checked_in_day1` → `checked_in_day2` → `certificate_issued`
- `held` → `released` (hold expiry or buyer release)
- `deposit_paid` or `paid_in_full` → `cancelled` (buyer)
- `cancelled` → `refunded` (Kill Bill confirmed)

An upgrade keeps the state and changes the bench and tier. Every other move is refused as listed in API.

**Waitlist entries** move from `waitlisted` to `offered`, then to `held` (accepted) or `offer_lapsed` (the window passed or the offer was declined). A `DELETE` removes a `waitlisted` entry.

**Holds.**
- A hold lasts `HOLD_SECONDS` seconds (default 480, which is 8 minutes) from the moment the server creates it.
- Nothing the client does extends a hold: not reading, refreshing or retrying, and not a long-open tab or a wrong device clock.
- The API never reports an expired hold as held, except for the payment cases below.
- Within 2 seconds of expiry, the server releases the bench. It offers the bench to the first waitlisted buyer for its tier, or leaves it open if nobody is waiting.
- A practitioner holds one bench. A clinic holds one to six benches at once as a group, and the group's benches share one expiry and are paid or released together.
- A payment request received before `expires_at` keeps the hold from being released while the request runs.
  - If Kill Bill confirms after `expires_at`, the payment stands and the seat becomes paid.
  - If Kill Bill fails and the hold has expired by then, the hold is released.
- Once Kill Bill has confirmed a payment, the hold is never released, even while the receipt is still pending.
- Past `expires_at`, a reservation whose payment request is still running, or whose payment Kill Bill confirmed while the receipt is pending, reads as follows until the state moves:
  - `state` stays `held`, and `payment_pending` names the payment from the moment Kill Bill confirms.
  - `hold` keeps its `expires_at` and `duration_seconds`, and its `seconds_remaining` reads `0`. It is never negative.
  - In the ledger the bench counts under `held`, and as an active Atelier place for an A or B bench.
  - The buyer sees the bench as `held_by_you`, and everyone else sees it as `held`.
  - Once the receipt is stored and its email queued, the state moves to the paid state and the bench counts under `sold`.

**Concurrency.**
- Every hold, offer acceptance and upgrade claims its benches and its Atelier place in one atomic ledger step, across every app process.
- Of N simultaneous claims on the same bench, or on the last Atelier place, exactly one succeeds with 201.
- Every other claim gets `409 bench_taken` or `409 atelier_sold_out`. Its `waitlist.open` is `true` when the tier now has no bench to hold.
- Which code a losing claim gets:
  - `bench_taken` whenever a bench it names is no longer open. This applies even when the Atelier cap is also reached. Two practitioners racing for the same bench that is also the last Atelier place therefore get one 201 and one `409 bench_taken`, and the loser hears the bench-taken copy from Feedback states.
  - `atelier_sold_out` only when every bench it names is still open but the cap is reached, for example when two practitioners race for different open A or B benches for the last Atelier place.
- A group hold is all or nothing.

**Payments and Kill Bill confirmation.**
- A reservation enters `deposit_paid` or `paid_in_full`, and an upgrade takes effect, only when three things are true:
  1. Kill Bill has confirmed the PURCHASE transaction.
  2. The receipt PDF is stored in MinIO.
  3. The receipt email is in the outbound queue.
- If Kill Bill does not confirm, the answer is 503 and nothing changes.
- If Kill Bill confirms but the PDF cannot be stored, the answer is 202 with `payment_pending`. The server retries the receipt at least every 10 seconds, without a restart. When it succeeds, the state moves and the email is queued.
- A browser never moves a state.

**Idempotency.**
- `Idempotency-Key` values are scoped to the calling account.
- A completed request (200 or 201) stores its response. A replay with the same key, endpoint and body returns that response unchanged, even if the state has moved since.
- 202, 409, 422 and 503 answers are not stored, so a retry with the same key runs again.
- The same key with a different endpoint or body is `409 idempotency_conflict`.
- Separately from the header, every Kill Bill transaction uses the external key given in Services, derived from the reservation or group. Before charging or refunding, the server looks that key up in Kill Bill and reuses a confirmed transaction. Two attempts can never create two charges or two refunds, even with different header keys.
- A further payment for a seat already paid at that step is `409 already_paid`.

**Reserve-by date.**
- 19 March 2027 is both the last day for new deposits and the balance-due date.
- From 20 March 2027, a deposit is `409 deposits_closed`, while full payment is accepted as long as benches remain.
- An unpaid balance after the due date shows the state label `Balance overdue` on the desk and the account. It stays payable until day 1 check-in.

**Balance reminders.**
- A reservation in `deposit_paid` gets the 21-day reminder once, on or after 26 February 2027, and the 7-day reminder once, on or after 12 March 2027. No reminder of either kind goes out after 19 March 2027.
- If both are due at once (for example, the first check after a deposit made on or after 12 March), only the 7-day reminder is sent, and the 21-day reminder never follows.
- Every app process checks at least once every 60 seconds, so a reminder goes out within 60 seconds of becoming due.
- Each reminder goes to the buyer exactly once, however many processes share the database.

**Upgrade.** An upgrade moves a paid Bench-tier seat to an open A or B bench and invoices only the difference of 245000 cents ($2,450.00). How it is charged depends on the seat's state:

| From | Venue-local date | Charged now | Result |
|---|---|---|---|
| `paid_in_full` | Any | 245000 | — |
| `deposit_paid` | On or before 19 March 2027 | 60000 | The 185000 balance part is added, so `paid_cents` is 150000 and `balance_cents` is 440000 |
| `deposit_paid` | From 20 March 2027 | 245000 | `paid_cents` is 335000 and `balance_cents` is 255000 |

- The old bench frees at once and is offered to the Bench-tier waitlist.
- An upgrade obeys the Atelier cap.

**Waitlist.**
- A signed-in practitioner may join a tier's waitlist only while that tier has no bench they could hold. Otherwise the answer is `409 benches_available`.
  - Bench tier: no open C or D bench.
  - Atelier tier: no open A or B bench, or the cap has been reached.
- A waitlisted buyer's position is the number of `waitlisted` entries for that tier that joined before them, plus one. It is recomputed on every read.
- A bench of a tier frees through a hold release or expiry, a cancellation, an upgrade away or an offer lapse. When that happens, and for Atelier when the cap allows, the first `waitlisted` entry gets an offer on that bench.
- The offer lasts `OFFER_SECONDS` seconds (default 86400, which is 24 hours) from the moment the server creates it and queues its email.
- The offer is accepted only through the signed-in offeree's account. Accepting starts a normal hold.
- Within 2 seconds of the offer's expiry, or at once when it is declined, the entry becomes `offer_lapsed`. The bench then passes to the next `waitlisted` entry as a new offer with its email queued, or opens if nobody is waiting.

**Cancellation and the dated refund schedule.**
- Only the buyer cancels, and only from `deposit_paid` or `paid_in_full`.
- The venue-local date of the cancel request fixes `refund_due_cents`. "Amount paid" means the seat's confirmed purchases.

| Venue-local date of the cancel request | Refund due |
|---|---|
| On or before 15 January 2027 | Amount paid minus 25000 cents ($250.00) |
| 16 January to 19 March 2027 | 50% of the amount paid, rounded down to the cent |
| From 20 March 2027 | No refund: cancel is `409 no_refund_window`. The buyer may reassign the seat to a named colleague instead |

- Cancelling frees the bench at once, and it is offered to the waitlist.
- Only the registrar sends the refund. The seat becomes `refunded` only after Kill Bill confirms every refund transaction.
- The refund is split across the seat's payments, newest payment first. Each part is no larger than what that payment paid for this seat, and each part adjusts that seat's item on that payment's invoice.
- Worked example: a Bench seat pays a deposit of 90000, upgrades for 60000 and pays a balance of 440000. It is cancelled on or before 15 January 2027, so the refund due is 565000. The refund is sent as:

| Transaction external key | Amount | Applied to |
|---|---|---|
| `ob-refund-<id>-1` | 440000 | Balance item |
| `ob-refund-<id>-2` | 60000 | Upgrade item |
| `ob-refund-<id>-3` | 65000 | Deposit item |

**Group seats.**
- A group checkout pays every seat at its tier's full price, in one Kill Bill invoice with one item per seat. The items always sum to the invoice total.
- Cancelling and refunding one group seat refunds against the group payment and adjusts only that seat's item. The other items and the remaining seats are untouched. The invoice's items, including the adjustment, still sum to the invoice amount to the cent.
- Upgrading one group seat creates a separate upgrade invoice on the clinic account, with one item for that seat. The group invoice does not change.

**Assignment, reassignment and visibility.**
- The buyer of a `deposit_paid` or `paid_in_full` seat may name its attendee (a name plus an email). An individual buyer who does this stops being the attendee.
- The assignee becomes the attendee only after accepting from an account with that email.
- Naming a different assignee takes effect on the former assignee's very next request:
  - The former assignee gets 404 for the reservation, its licence, its passport and its documents, and `/api/me` no longer lists the seat.
  - They no longer count as attending, so they may accept another seat.
  - The acceptance, licence and passport records for the seat are cleared.
  - The licence scan, passport scan and visa-letter objects are deleted from MinIO, and `documents` drops `visa-letter`.
  - The new assignee is emailed.
- An attendee sees their own seat, its licence, passport, visa letter and certificate.
- A buyer sees each of their seats' state, attendee name and email, acceptance, `licence_status`, `passport_status` and check-ins. A buyer never sees licence or passport numbers or files, or the attendee's visa letter or certificate; those answer 404.
- Any id outside these rules answers 404.

**Licence review.** Only `submitted` or `rejected` licences can be reviewed. `matched` locks the licence. A new upload after `rejected` returns it to `submitted`.

**Visa-support letter.**
- It needs a passport scan and a seat in `deposit_paid`, `paid_in_full`, `checked_in_day1`, `checked_in_day2` or `certificate_issued`.
- It is generated once, and later calls return the same object.
- If it cannot be stored, the answer is 503, `documents` is unchanged and no email is queued.

**Check-in.**
- Day 1 check-in is open only on the venue-local date Friday 16 April 2027, and day 2 only on Saturday 17 April 2027. On any other date the answer is `409 checkin_closed`.
- Any seat without an accepted attendee answers `409 no_attendee`.
- Day 1 needs the seat in `paid_in_full`. Day 2 needs it in `checked_in_day1`.
- When several conflicts apply, the first in this order answers:
  1. `checkin_closed`
  2. `no_attendee`
  3. `already_checked_in` (the seat already has that day's check-in)
  4. `balance_due` (the seat is `deposit_paid`, on either day)
  5. `not_checked_in_day1` (day 2 for a seat in `paid_in_full`)

**Certificate.**
- It issues only when the seat is `checked_in_day2` and the licence is `matched`.
- It is generated once, numbered `OB-2027-` plus a 4-digit sequence starting at `0001`.
- Numbers are consecutive in issue order, with no gaps:
  - A number is taken only together with a stored PDF. An attempt that fails to store answers 503, records nothing, sends no email and uses no number.
  - Simultaneous issues for different seats get distinct consecutive numbers.
  - Simultaneous issues for the same seat return the same number: one 201, the others 200.
- Every later call or download returns the same object.
- The PDF shows these as text:
  - attendee name, licence number and issuing state;
  - course title;
  - provider name and provider ID;
  - dates 16 and 17 April 2027;
  - location Chicago, Illinois;
  - educational format `Lecture and participation (hands-on)`;
  - `16 credits`;
  - subject code;
  - certificate number;
  - the course director's name.

**Content.**
- The hands-on rule: the agenda's hands-on minutes `h` must stay at least 30% of its total minutes `t`, that is `h × 10 ≥ t × 3`. Exactly 30% is allowed.
- A session create, edit or delete that would break the rule is refused with 422 on `minutes`, carrying the hands-on copy from Feedback states.
- Session writes are checked and written one at a time across every app process. Each write is checked against the agenda as it stands after every earlier write has finished.
- Of two simultaneous writes that each keep the rule alone but break it together, exactly one succeeds and the other gets the 422. The stored agenda always satisfies the rule.
- An Atelier-only evening's `starts_at`, `venue` and `description` are returned only to:
  - the director;
  - a signed-in account that is the buyer or attendee of an Atelier reservation in `deposit_paid`, `paid_in_full`, `checked_in_day1`, `checked_in_day2` or `certificate_issued`.

  Everyone else gets the gated shape.

**Privacy of copies.**
- No email subject or body ever contains a licence number, issuing state or passport detail, and no email attaches a file. Emails link to `/account` instead.
- Receipt and group invoice PDFs list only benches, tiers, amounts and attendee names.

### Services (DP-10, DP-11, DP-28, DP-29, DP-32, DP-44, DP-46, DP-52, DP-54, DP-57, DP-58, DP-59)

**Kill Bill** is the source of truth for paid and refunded.

Accounts:
- Each buyer (a practitioner, or a clinic for a group) has one Kill Bill account with currency USD, `externalKey` `ob-<app account id>`, the buyer's name (the clinic name for a clinic) and email.
- Kill Bill's built-in external payment method is the default payment method.

Payments:
- Each payment is an invoice of external charges followed by a PURCHASE against that invoice. The PURCHASE's payment external key and transaction external key are both the key below.

| Payment | Invoice item description | External key |
|---|---|---|
| Deposit | `Bench <bench> <tier name> deposit` | `ob-deposit-<reservation id>` |
| Balance | `Bench <bench> <tier name> balance` | `ob-balance-<reservation id>` |
| Full payment | `Bench <bench> <tier name> full price` | `ob-full-<reservation id>` |
| Upgrade (new bench, for the amount charged now) | `Bench <bench> Atelier upgrade` | `ob-upgrade-<reservation id>` |
| Group checkout (one item per seat) | `Bench <bench> <tier name> full price` | `ob-group-<group id>` |

Refunds:
- Each refund is a REFUND transaction with an invoice-item adjustment on that seat's item. Its transaction external key is `ob-refund-<reservation id>-<n>`, with `n` counting from 1, newest payment first.
- Desk amounts (`kb.paid_cents`, `kb.refunded_cents`) are read from Kill Bill each time the desk loads.

When Kill Bill is unreachable:
- Payment and refund endpoints answer `503 billing_unavailable` and change nothing. Holds keep running.
- `GET /api/desk/reservations` answers 200 with `"billing":"unavailable"` and `kb` null.
- The UI shows the billing-offline banner, the desk banner and the refund-blocked copy from Feedback states.
- Each request tries Kill Bill again, and the first request after Kill Bill returns succeeds, with no restart.

**Postgres** holds:
- the reservation ledger and bench inventory;
- holds, waitlists and offers;
- accounts and sessions, and assignments;
- licence and passport records (metadata and object keys);
- idempotency records;
- the certificate number sequence;
- check-ins;
- the outbound mail queue;
- the coordination of agenda writes.

The schema is applied idempotently every time the app starts serving.

The verifier runs several app processes against one database at once, sometimes with different `BENCH_DAYS_NOW` values. Together they must stay correct. Each piece of background work is claimed in the database, so it runs exactly once across all processes: hold and offer expiry, offer creation, balance reminders, sending queued mail and receipt retries. No email, offer, reminder or receipt is ever produced twice.

**MinIO.** Everything goes in the private bucket `S3_BUCKET`. Nothing is public, and browsers fetch objects only through signed links valid for 60 seconds.

| Object | Key |
|---|---|
| Licence scan | `licences/<reservation id>/<random id>.<pdf, jpg or png>` |
| Passport scan | `passports/<reservation id>/<random id>.<pdf, jpg or png>` |
| Receipt | `receipts/<reservation id>/<deposit, balance, full or upgrade>.pdf` |
| Group invoice | `receipts/groups/<group id>/invoice.pdf` |
| Visa letter | `visa-letters/<reservation id>.pdf` |
| Certificate | `certificates/<reservation id>.pdf` |

- Uploads are stored byte for byte as submitted, with the detected content type.
- Keys never use the uploaded file name.
- The bucket is created if missing every time the app starts serving.

When MinIO is unreachable:
- Uploads and document links answer `503 storage_unavailable`.
- Visa letters and certificates follow their failure rules in Business rules.
- Payments that Kill Bill has confirmed answer 202 pending, and they finish within 10 seconds of MinIO returning, with no restart.

**Mailpit (SMTP).** Every email is sent from `MAIL_FROM` and passes through the outbound queue in Postgres, which retries at least every 10 seconds.

| Email | To | Subject |
|---|---|---|
| Deposit receipt | Buyer | `Deposit received: Bench <bench> is yours` |
| Paid-in-full receipt (balance or full payment) | Buyer | `Paid in full: Bench <bench>` |
| Upgrade receipt | Buyer | `Upgrade confirmed: Bench <bench> is Atelier` |
| Group receipt, listing each `Bench <bench>: <name or Unassigned>` | Clinic buyer | `Group invoice paid: <n> seats` |
| 21-day reminder | Buyer | `Balance reminder: 21 days to pay for Bench <bench>` |
| 7-day reminder | Buyer | `Balance reminder: 7 days to pay for Bench <bench>` |
| Waitlist offer | Offeree | `A bench is open for you: sign in to accept` |
| Seat assignment | Assignee | `<clinic name or buyer name> assigned you Bench <bench> at Opaline Bench Days` |
| Visa letter ready | Attendee | `Your visa-support letter for Opaline Bench Days` |
| Refund confirmed (for a group seat, it also lists the remaining seats with names and benches) | Buyer | `Refund confirmed: Bench <bench>` |
| Certificate issued | Attendee | `Your CE certificate for Opaline Bench Days` |

When Mailpit is unreachable, actions still succeed, because queuing is a Postgres write. No user-facing error appears. Queued emails send within 10 seconds of Mailpit returning, with no restart.

**PocketBase.** Every time the app starts serving, it creates these collections idempotently, then seeds any that are empty:

| Collection | Fields |
|---|---|
| `agenda_sessions` | `number` number, `day` number, `title` text, `format` text (`lecture` or `hands-on`), `minutes` number, `outcomes` text |
| `hospitality_events` | `title`, `day` number, `starts_at` text, `venue`, `tier` text (`all` or `atelier`), `description` |
| `hotels` | `name`, `distance`, `rate`, `map_url` |
| `faq_entries` | `question`, `answer`, `sort` number |

- `GET /api/content` and the public pages read PocketBase on every request, so a change made through the content desk, or directly in PocketBase, shows on the next load.
- When PocketBase is unreachable, the content endpoints answer `503 content_unavailable`, and the public chapters show the content-unavailable copy.

### Seed data (DP-03, DP-10, DP-11, DP-12, DP-57, DP-60)

Every person, business, venue, hotel and identifier below is invented.

**Staff accounts.** These are present at start, and seeded on every serve when missing:

| Role | Name | Email | Password |
|---|---|---|---|
| Event director | Mara Okonkwo-Lindqvist | `director@opaline-institute.test` | `bench-days-director-2027` |
| Registrar | Theo Vasquez-Hale | `registrar@opaline-institute.test` | `bench-days-registrar-2027` |
| Front desk | Priya Anand-Sorensen | `frontdesk@opaline-institute.test` | `bench-days-frontdesk-2027` |

**Starting state.** There are no buyer accounts, reservations, groups, waitlist entries, offers or certificates. All 24 benches are open: `seats_remaining` is 24, Bench-tier remaining is 12 and Atelier remaining is 10.

**Event facts**, shown on the site and printed on PDFs:
- Course title: `Layered Composite Masterclass`
- Dates: Friday 16 and Saturday 17 April 2027
- Venue: The Opaline Lab, 1460 West Kinzie Street, Chicago, Illinois
- Instructor and course director: Dr. Celeste Marrow-Ibarra
- Provider: Opaline Institute, provider ID `OI-PACE-219874`
- Credits: 16, format `Lecture and participation (hands-on)`
- Subject code: `250 Operative (restorative) dentistry`

**Agenda sessions** (960 minutes in total, 690 of them hands-on):

| No. | Day | Format | Minutes | Title | Outcomes |
|---|---|---|---|---|---|
| 1 | 1 | lecture | 90 | Shade and translucency mapping | Read chroma, value and translucency zones on a natural incisor |
| 2 | 1 | hands-on | 150 | Palatal shell from a silicone index | Build a thin, even palatal shell from a wax-up index |
| 3 | 1 | lecture | 60 | Dentin mamelons and internal effects | Plan mamelon shape and halo before layering |
| 4 | 1 | hands-on | 180 | Class IV layering on the typodont | Layer dentin, effects and enamel to a natural incisal edge |
| 5 | 2 | lecture | 60 | Posterior anatomy and occlusal stamping | Choose between freehand anatomy and occlusal stamps |
| 6 | 2 | hands-on | 180 | Class II with sectional matrices | Place tight contacts with sectional rings and wedges |
| 7 | 2 | lecture | 60 | Finishing and polishing sequence | Order discs, rubbers and pastes for lasting gloss |
| 8 | 2 | hands-on | 180 | Polish to gloss and photograph | Finish to gloss and record cross-polarised photographs |

**Hospitality events:**

| Title | Day | Starts | Venue | Tier | Description |
|---|---|---|---|---|---|
| Welcome reception | 1 | 18:30 | The Opaline Lab foyer | all | Drinks and small plates with the instructor |
| Atelier dinner with the instructor | 1 | 20:00 | Larkspur Room, West Loop | atelier | A seated tasting menu for Atelier guests and the course director |
| Bench breakfast | 2 | 07:30 | The Opaline Lab foyer | all | Coffee and pastries before the lab opens |

**Hotels:**

| Name | Distance | Rate | Map link |
|---|---|---|---|
| Fulton Rail Hotel | 0.4 miles | from $289 a night | `https://maps.example.com/fulton-rail-hotel` |
| Kinzie Loft Suites | 0.7 miles | from $245 a night | `https://maps.example.com/kinzie-loft-suites` |

**FAQ entries:**

| Sort | Question | Answer |
|---|---|---|
| 1 | What should I bring? | Your own loupes. Typodonts, composites, instruments and curing lights are provided at every bench. |
| 2 | How are CE credits awarded? | Credits are issued after both days of check-in and a matched licence on file. |
| 3 | Can my clinic buy several seats? | Yes. A clinic account can hold up to six benches at once and pays one group invoice. |
| 4 | What is the difference between Bench and Atelier? | Atelier seats sit in rows A and B nearest the demo station and include the Atelier dinner. |

## Technical requirements

### Deployment (DP-01)

The runtime has Node.js 22 LTS with npm, and the app is written in TypeScript. The app root `/app` contains `run.json` with the string fields `install`, `build` and `serve`, plus `"_schema":"run-manifest-v1"`. For example:

```json
{"_schema":"run-manifest-v1","install":"npm ci","build":"npm run build","serve":"npm run start"}
```

- `serve` starts one process that binds `0.0.0.0` on port 4173, or on `APP_PUBLIC_PORT` when it is set.
- `GET /api/health` answers HTTP 200 with `{"status":"ok"}` as soon as the process is listening, whether or not any dependency is reachable.
- The schema, bucket, collections and staff seed are applied idempotently on every serve, not only at build.

### Configuration and secrets (DP-02)

The server reads these variables at start:

| Purpose | Variables |
|---|---|
| Kill Bill | `KILLBILL_URL`, `KILLBILL_USERNAME`, `KILLBILL_PASSWORD`, `KILLBILL_API_KEY`, `KILLBILL_API_SECRET` |
| Postgres | `DATABASE_URL` |
| MinIO | `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_FORCE_PATH_STYLE`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` |
| Mail | `SMTP_HOST`, `SMTP_PORT`, `MAIL_FROM` (the From line, `Opaline Bench Days <registrar@opaline-institute.test>`) |
| PocketBase | `POCKETBASE_URL`, `POCKETBASE_ADMIN_EMAIL`, `POCKETBASE_ADMIN_PASSWORD` |
| Timing | `HOLD_SECONDS` (default 480), `OFFER_SECONDS` (default 86400) |
| Venue clock | `BENCH_DAYS_NOW`: an optional ISO 8601 UTC instant such as `2027-03-20T04:30:00Z`, used under the venue-local time rule in Business rules |

No credential is hard-coded, logged, written to a client bundle or sent in any response. Session tokens are random values stored in Postgres.

### Server boundary (DP-05)

- The app serves its pages, assets and API from one origin.
- A state-changing request whose `Origin` header is present and differs from the app's origin answers `403 {"error":"cross_origin"}` before any other check.
- JSON bodies are limited to 65,536 bytes, and exactly 65,536 bytes is allowed. Larger bodies answer `413 {"error":"payload_too_large"}`.
- A whole multipart request is limited to 10,100,000 bytes, and exactly 10,100,000 bytes is allowed. Larger requests answer `413 {"error":"payload_too_large"}`. The per-file limit and second file parts are answered as stated in API.
- File type is decided from the file's leading bytes: PDF starts with `%PDF-`, JPEG with the bytes FF D8 FF, and PNG with the 8-byte PNG signature. The extension and declared type are ignored. SVG, HTML and every other type are refused.
- Uploaded file names are never used for storage.
- The server never serves source files, `run.json`, package or lock files, dotfiles, environment files or credentials. Such paths answer 404.
- If any dependency is unreachable at boot, the app still starts, answers health, and serves every route that does not need that dependency. It connects on later requests, with no restart.

### Browser support and performance (DP-13, DP-18)

- Current Chromium, Firefox and Safari, at 375x812, 768x1024 and 1280x800, with touch on phones.
- The overture is readable within two seconds of load.
- The bench map is usable by keyboard or pointer within three seconds, even before the 3D scene is ready.
- A hold request answers within one second under normal load.
- The bench map and seat counts reflect any change on the server within two seconds.

## Working rules

- IF-01: `/app/run.json` has exactly the keys `_schema` (value `run-manifest-v1`), `install`, `build` and `serve`, all strings.
- IF-02: `/app/THIRD_PARTY_NOTICES.md` names every shipped package and both bundled fonts, each with its licence. Shipped packages means the production dependency tree from `npm ls --omit=dev --all --json`.
- IF-03: Shipped packages (the same production dependency tree) and bundled fonts use only the MIT, ISC, BSD-2-Clause, BSD-3-Clause, Apache-2.0, 0BSD or OFL-1.1 licences.
- IF-04: There is no datastore beyond Postgres, MinIO and PocketBase: no SQLite, no Redis, no in-memory store of record and no state files on local disk.
- IF-05: The provided service configuration is left unchanged: the compose files, and the dev tenant, bucket, database and PocketBase admin settings.
- IF-06: The built site loads no script, stylesheet, font or image from another origin.
- IF-07: A committed `package-lock.json` matches `package.json`.

## Engineering standards

- Code is idiomatic TypeScript with strict type checking on and no untyped escape hatches in domain code.
- Names in code match the terms in this brief: bench, hold, reservation, deposit, balance, upgrade, waitlist offer, group invoice, assignee, check-in, venue date, hands-on share and certificate.
- Each domain rule is decided in exactly one place in the source:
  - the reservation state machine;
  - the venue-local date;
  - the ledger count and Atelier cap;
  - the refund schedule and its newest-first split;
  - the upgrade split;
  - the hands-on share check;
  - certificate eligibility and numbering.
- Money is integer cents end to end. It is formatted as dollars only when shown on screen, in a PDF or in an email.
- No abstraction has only one implementation. The source has no dead, commented-out or unreachable code and no defensive checks for impossible states.
- Every API error is built through the one error shape and precedence in API.
- No feature, route or screen goes beyond this brief.
