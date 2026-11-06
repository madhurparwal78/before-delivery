# Halide Film Society / Société du film Halide — Halide Box Office

Halide Box Office is the bilingual box office, membership desk and finance console for the Halide Film Society, a repertory cinémathèque in Montréal with three screens in two buildings. Patrons browse the programme season by season, hold and buy reserved seats, join or change a membership tier, add a supporter uplift, and buy gift memberships. Group organisers book blocks of seats. Door staff check tickets in, programmers schedule seasons, and finance officers refund, issue goodwill credit and reconcile each day's takings. The app uses three backend services and no others. Kill Bill is the system of record for money: accounts, invoices, payments, refunds, credits and membership subscriptions. Mailpit, reached over SMTP, receives every transactional email. Postgres holds everything else. The following are out of scope: real card capture (the patron types a cardholder name and Kill Bill records the payment through its built-in external payment method), physical ticket printing, QR scanning hardware, subscription renewals after the first billing period, other datastores, and third-party sign-in.

## Problem and users

Repertory cinemas sell seats through one vendor, run memberships and gift cards in a spreadsheet or a separate CRM, take payments through a third processor, and ask for a donation at checkout that finance then has to separate from taxable admission by hand. The failures recur every week. The last seat of a sold-out 35mm print screening is sold twice. A member upgrades mid-year and the price on screen differs from the invoice. A gift code is guessed, or redeemed twice. A refund given at the door never reaches billing. Every month an accountant spends days matching takings, GST, QST, supporter uplift and goodwill credits against the payment provider. Quebec requires French to be at least as available as English, but most hosted ticketing treats French as a translation file, so emails, receipts and errors fall back to English. Halide Box Office puts all of this in one product backed by one billing ledger, and it is French-first.

| Role | Goal | Frequency |
|---|---|---|
| Member | Join or change a membership tier, book priority seats for a season, add a supporter uplift, and get a correct bilingual confirmation | Weekly |
| Guest patron | Buy single tickets or a gift membership without an account, and come back to the booking through an emailed link | Occasional |
| Group organiser | Reserve a block of seats for a class or film club, split the cost exactly, and get the group checked in at the door | Occasional |
| Door staff | Check patrons in quickly from a lean list that shows only what the door needs, and redeem each ticket once | Daily |
| Programmer | Draft, schedule and publish a season of screenings across venues, including weekly slots that cross the daylight-saving change | Weekly |
| Finance officer | Look up bookings, issue refunds and goodwill credits under an audit trail, reconcile daily takings against Kill Bill, and answer patron enquiries | Daily |

A member is a signed-in patron account with an active membership. A group organiser is any signed-in patron account. Staff sign in with seeded accounts that each carry exactly one role: `door`, `programmer` or `finance`.

## Journeys

1. **Browse the programme.** A patron opens the programme on its first season. Scrolling, the iris opens onto the season, its schedule fades in, and the iris closes again before the next season. The URL, the season tabs and a spoken announcement follow along. The patron switches to French and nothing on the page moves. They copy the URL, open it in a new tab, and land on the same season with its schedule fully shown.
2. **Guest buys tickets.** A guest opens a Nitrate Nights screening from the schedule rail, picks two seats on the seat map, holds them, and sees the hold countdown. They choose fares, type their name, email and cardholder name, and pay. The Booking confirmed page lists the tickets and price lines. One confirmation email arrives with a private booking link. Later the guest opens that link, or asks for a new one through the booking-link form.
3. **Member books in priority by keyboard.** A member with 25 dollars of goodwill credit opens a season in member priority. Using only the keyboard, they activate the season tab, open a screening, move across the seat grid with the arrow keys, select two seats, hold them, set the fares, switch on a five-dollar uplift, verify with the emailed code, and pay the remainder. The credit, tax lines and total match on screen, in the email and in Kill Bill.
4. **Join and change membership.** A signed-in patron joins the Cinephile tier with monthly billing and sees Membership active with the amount Kill Bill invoiced. Later they verify with an emailed code and upgrade to Projectionist. The prorated charge shown is Kill Bill's own invoice figure, and the membership email repeats it. A downgrade instead shows the date it takes effect and that nothing is charged today.
5. **Give a membership.** A guest buys a Cinephile gift for a friend and is charged the annual price. The purchaser gets a receipt and the recipient gets a redemption link. The recipient signs up, opens the link and redeems it. A Kill Bill subscription starts with a first invoice of 0.00, and the link stops working.
6. **Group outing.** A film-club organiser holds 17 seats at the group fare, names three payers with 6, 6 and 5 seats, and pays once. The cost split sums exactly to the Kill Bill total. On the night, door staff type the booking reference and check in the whole group, and no ticket can be checked in twice.
7. **Programme a season.** A programmer creates a draft season, adds a weekly Tuesday 19:00 slot for four weeks starting 20 October 2026, and sees every occurrence at 19:00 Montréal time across the 1 November change. They schedule the season, and it moves to member priority and then on sale at 10:00 Toronto time. A season can also be withdrawn, which refunds and emails every holder.
8. **Finance day.** A finance officer looks up a booking reference, refunds it before the cutoff, issues a goodwill credit to a patron who missed the cutoff, answers a contact enquiry, loads the day's reconciliation, downloads the CSV, accepts Kill Bill's figure for a mismatched day, and reads the audit list that records each of these actions.

## Mandatory requirements

This is the complete list of mandatory requirements; every check traces to one of these lines and the detailed sections below.

- **DP-01 — Season programme stage** The public programme page shows every published season, in date order, as a full-screen stage segment with its title, dates and a schedule rail whose rows give each screening's local time, auditorium code and seats left, and each row opens that screening.
- **DP-02 — Iris Pull scroll mapping** Within each season's 1000-pixel scroll segment, the iris openness, blade rotation, f-stop readout, schedule rail fade and ground tint follow the published formulas of scroll position exactly, in both scroll directions.
- **DP-03 — Active season and shareable URL** The active season follows the published activation rule and is reflected in the `season` query parameter, the root `data-active-season` attribute, the season tab's current state and one polite announcement, and a shared link lands on the published scroll position.
- **DP-04 — Reduced motion and renderer fallbacks** Under reduced motion the stage shows the selected season fully open with instant tab switching, and without WebGL or after a lost WebGL context an SVG iris renders the same states with the published attribute values.
- **DP-05 — In-place language switch** The language button switches every visible string, the page language and the locale path between English and French without reloading the page, remembers the choice, and moves the seat map by no more than the published tolerance.
- **DP-06 — Sale times in Montréal business time** Each season's member-priority and public-sale opening instants are 10:00 America/Toronto on their published dates and are shown in Toronto time whatever the server or browser time zone.
- **DP-07 — Guest booking journey** A guest patron picks seats on the seat map, holds them, pays with name and email only, and lands on the Booking confirmed page with tickets, a price summary and a private booking link.
- **DP-08 — Seat holds and server expiry** A seat hold lasts the configured hold time judged by the server with an exclusive end, after which payment is refused, the seats return to sale and the countdown matches the server.
- **DP-09 — Admission tax and uplift arithmetic** GST and QST are computed per admission line in integer cents with half-up rounding, the supporter uplift is an untaxed line, and the quote, booking, confirmation email, Kill Bill invoice and CSV agree to the cent.
- **DP-10 — One Kill Bill invoice per booking** Every paid booking is one Kill Bill invoice on the patron's account with the published item descriptions and one successful purchase payment equal to the amount paid now, or no payment when that amount is zero.
- **DP-11 — Checkout and gift idempotency** Checkout and gift purchase require an idempotency key, and a replay returns the original response without a second charge or email while a reused key with a different body is rejected.
- **DP-12 — Booking confirmation email** Each paid booking delivers exactly one confirmation email to Mailpit in the booking's locale with the published subject and the seat, ticket, tax, uplift, credit and total lines.
- **DP-13 — Guest booking links** A guest's booking link carries an unguessable token scoped to one booking, and it stops working when the booking is refunded or a new link is issued through the booking-link form.
- **DP-14 — Checkout succeeds whole or not at all** When Kill Bill fails during checkout no charge stands, the hold and booking stay exactly as they were, and the confirmation email is queued only together with a successful payment.
- **DP-15 — Last-seat winner and honest notices** Of simultaneous hold requests for the same seat exactly one succeeds, the others get the seat-taken result and notice, an expired hold shows the hold-expired notice, and seats left is never negative.
- **DP-16 — Member fares and priority booking** Members book at member and member-guest fares within their tier's allowance and alone may hold seats while a season is in member priority, while non-members get the published refusal.
- **DP-17 — Seat map keyboard grid** The seat map is a single tab stop moved with arrow, Home and End keys and toggled with Space or Enter, exposing each seat's code, selection and availability.
- **DP-18 — Keyboard-only member booking** A member completes the whole booking from the season tabs through the seat map, fares, uplift, step-up and payment with the keyboard alone, and the stage reaches the same end values as with a pointer.
- **DP-19 — Supporter uplift control** The uplift switch reveals preset and custom amounts with a sliding thumb, and a custom amount outside the published range is refused with the published field message in both locales.
- **DP-20 — Step-up code limits** Spending stored credit or changing tier requires an emailed six-digit code, with the published attempt ceiling, resend spacing, send limit, lockout window, Retry-After header and a response within five seconds.
- **DP-21 — Stored credit at checkout** A member's credit balance is applied to the next charge up to its total, recorded as paired ledger movements that match the Kill Bill account credit, including the zero-payment case.
- **DP-22 — Pay control states** The pay button shows the published label with the amount due in each locale, is disabled under each published condition, and shows the published pending label while a charge is in flight.
- **DP-23 — Join a membership** A signed-in patron chooses a tier and billing cadence, joins through a Kill Bill subscription on the published plan, and sees Membership active with the first invoice amount from Kill Bill.
- **DP-24 — Option menu focus** Opening the fare or billing-cadence menu moves focus to the selected option, arrow keys and Enter choose, and Escape closes the menu and returns focus to its opener.
- **DP-25 — Tier change timing** Moving to a higher tier changes the Kill Bill subscription immediately, moving to a lower tier or another cadence of the same tier takes effect at the end of the term, and the published conflicts are rejected.
- **DP-26 — Proration read from Kill Bill** The amounts shown for a tier change on screen, in the API and in the email are the Kill Bill invoice's items and amount, never a local recalculation.
- **DP-27 — Membership emails** Joining, redeeming a gift and changing tier each deliver exactly one membership email to Mailpit in the member's locale with the published subject and the tier, cadence, date and amount lines.
- **DP-28 — Gift membership purchase** A guest or signed-in patron buys a gift membership for a recipient, is charged the tier's annual price in Kill Bill, and the purchaser and recipient each receive their published email.
- **DP-29 — Single-use gift redemption** A gift's redemption link carries an unguessable token, redeems at most once even under simultaneous attempts, and answers not found once redeemed.
- **DP-30 — Gift subscription start** Redeeming a gift starts exactly one Kill Bill subscription on the tier's gift plan for the redeemer, whose first invoice amount is 0.00, while the purchaser's charge stays the tier's annual price.
- **DP-31 — Patron record ownership** A patron requesting another patron's booking, gift or hold by identifier gets exactly the same not-found response as for a record that does not exist.
- **DP-32 — Group booking journey** A signed-in organiser holds 10 to 40 seats at the group fare, names two to six payers with seat counts, pays once, and the group is checked in at the door by booking reference.
- **DP-33 — Exact group cost split** Payer shares are computed from the Kill Bill invoice total by seat count with the published largest-remainder rule and always sum exactly to the total.
- **DP-34 — Door list** The door list for a screening shows and returns only the published fields per ticket, never a patron's email, phone, full name, payment or membership details.
- **DP-35 — Single check-in and door window** Each ticket checks in at most once even from two devices at the same time, and only inside the published window around showtime.
- **DP-36 — Season lifecycle** Seasons follow the published state machine with time-driven member-priority and on-sale states, and every illegal transition is refused with the published conflict.
- **DP-37 — Weekly slots across daylight saving** Weekly screenings created from one local start time keep that Montréal wall-clock time on every occurrence across the 1 November 2026 change, following the published rule for missing and repeated times.
- **DP-38 — Season withdrawal** Withdrawing a season refunds each paid booking through Kill Bill, ends its holds, emails each holder in their locale and records each refund in the audit list.
- **DP-39 — Programmer console journey** A programmer creates a draft season, adds weekly screenings, schedules it and later archives or withdraws it from the staff console.
- **DP-40 — Finance desk journey** A finance officer finds a booking, ticket, gift or account by identifier in the staff lookup and reaches its refund and goodwill-credit controls, with the published not-found copy for misses.
- **DP-41 — Finance refunds** Finance refunds a paid booking before the refund cutoff through a Kill Bill refund, returning the paid portion to the payment and any credit portion to the member's credit, with the published amount shape.
- **DP-42 — Goodwill credits** A goodwill credit issued by finance creates a Kill Bill account credit, one paired ledger movement and one audit entry, and the account's balance equals the sum of its ledger movements.
- **DP-43 — Staff role enforcement** Finance, door and programming endpoints are refused server-side to every other role with the published forbidden response, whatever the interface shows.
- **DP-44 — Append-only audit list** Every refund, goodwill credit, reconciliation acceptance, season withdrawal and enquiry reply records actor, action, target, amount, reason and time, and no one can edit or delete an entry.
- **DP-45 — Business-day reconciliation** The reconciliation for a date covers the Toronto business day from local midnight to local midnight and compares local takings with Kill Bill payments and refunds using the published figures.
- **DP-46 — Reconciliation CSV export** The reconciliation CSV has the published columns and rows, totals that match the reconciliation, and neutralises patron-supplied names and notes that begin with formula characters.
- **DP-47 — Accepting the Kill Bill figure** When a day does not match, finance accepts Kill Bill's figure with a reason, sees the published confirmation and the day shows as accepted with an audit entry.
- **DP-48 — Accounts and sign-in return** Patrons create accounts and sign in, and after sign-in they return only to a safe same-origin path, falling back to their account page otherwise.
- **DP-49 — Self-service refunds** A patron refunds their own paid booking from the booking page or private link until the published cutoff before showtime, after which the refund is refused and only finance goodwill credit remains.
- **DP-50 — Contact enquiry and staff reply** A patron sends a contact enquiry, sees the published acknowledgement, and finance replies from the console so that exactly one reply email arrives in Mailpit in the enquiry's locale.
- **DP-51 — Service notices and recovery** When Kill Bill or the mail service is unreachable at boot or later, the app keeps serving, shows the named notice within ten seconds and clears it within ten seconds of the service returning, without a restart.
- **DP-52 — Billing outage changes nothing** While Kill Bill is unreachable, every money-moving or booking-changing request is refused with the published unavailable response and leaves bookings, holds, memberships, gifts and credits unchanged, as qualified in Services.
- **DP-53 — Mail outbox retry and drain order** Mail that cannot be sent is kept in an outbox and retried on the published ordered schedule with an attempt ceiling, then delivered oldest first exactly once per message key after recovery.
- **DP-54 — Run manifest and health** The app installs, builds and serves from the run manifest on the published port and answers the health check while dependencies are down.
- **DP-55 — Nothing private leaves the server** No service credential or internal host reaches the browser, and emails contain only the published identifiers and links.
- **DP-56 — Bilingual errors and emails** Every API error message and every email exists in English and French and is delivered in the published locale under the locale rule.
- **DP-57 — Responsive layouts and narrow disclosures** Every screen works at 375x812, 768x1024 and 1280x800 without horizontal scrolling, and on narrow screens the menu and film notes open through their published disclosure buttons.
- **DP-58 — Focus, hover and transition rules** Every page's first Tab stop is the skip link, dismissing a notice lands focus on the page heading, focus and hover states are visible, and interface transitions run in the published time range or instantly under reduced motion.
- **DP-59 — Projection-booth look** The public pages read as a near-black projection booth with warm off-white type, one tungsten amber for live state, serif season titles and monospaced numerals, and the iris looks like a mechanical lens diaphragm.
- **DP-60 — Real integrations in source** The source talks to Kill Bill, SMTP and Postgres for real, reads every credential from the environment, and keeps no fake state or test-only endpoint.

## Frontend

### Screens and layout (DP-01, DP-07, DP-23, DP-28, DP-32, DP-34, DP-39, DP-40, DP-57)

Every page lives under a locale prefix, `/en/` or `/fr/`. A request for `/` redirects to the prefix chosen by the locale rule in Business rules. Every page has the same parts: a header with the wordmark, the primary navigation, the language button and the sign-in or account link; the service notice slot directly under the header; then the main content.

| Screen | Path | What it shows |
|---|---|---|
| Programme | `/<locale>/` | The season stage (one segment per published season), the season tab list, then a footer. |
| Screening | `/<locale>/screenings/<screening id>` | Film title, format, auditorium, showtime, film notes, seat map, seats left, the group-booking checkbox (signed-in only), the Hold seats button. |
| Checkout | `/<locale>/checkout/<hold id>` | Hold countdown, one fare line per seat, uplift control, payer list (group holds), guest details (no session), note, cardholder name, price summary, step-up trigger, pay and release buttons. |
| Booking | `/<locale>/account/bookings/<booking ref>` (account) or `/<locale>/b/<token>` (guest link) | Booking confirmed heading straight after payment, otherwise Booking `<booking ref>`; tickets, price summary, cost split for groups, refund control. |
| Account | `/<locale>/account` | Membership summary, credit balance with ledger movements, My bookings table. |
| Membership | `/<locale>/membership` | Three tier cards, cadence menu, preview of the amount, step-up trigger, join or change button. |
| Gift | `/<locale>/gift` | Gift purchase form, with the step-up trigger when needed. |
| Gift redemption | `/<locale>/gift/<token>` | Gift details and Redeem button. |
| Sign in / Sign up | `/<locale>/signin`, `/<locale>/signup` | Account forms. |
| Booking link | `/<locale>/booking-link` | Form to email a new private booking link. |
| Contact | `/<locale>/contact` | Enquiry form. |
| Staff console | `/<locale>/staff` | Door, Programme and Finance sections, each shown only to its role. |

Layout by viewport. The page never scrolls horizontally at any of these sizes.

- **1280x800.** The programme stage fills the viewport, with the season title set large at lower left, the f-stop readout at the right edge, mid-height, and the season tab list along the top of the stage under the header. The schedule rail sits in the lower half of the stage on a 12-column grid. Each row gives the date (two columns), the time (two), the film title (five), the auditorium code (one) and seats left (two). The screening page puts film notes in a left column (four of twelve) and the seat map with its controls on the right. Checkout puts the form on the left (seven columns) and a price summary that stays in view on the right (five). The staff console is two panes: a table on the left (seven columns) and a detail pane on the right (five).
- **768x1024.** The stage is the same, but the rail rows wrap the film title onto its own line above date, time, code and seats. The screening page stacks film notes above the seat map. Checkout stacks the price summary under the form. The staff console stacks the detail pane under the table.
- **375x812.** The primary navigation collapses behind the Menu button. The season title shrinks to about three times body size. Rail rows become two-line cards: the film title, then a line with date, time, code and seats left. The film notes are collapsed behind the Film notes button. The seat map keeps every seat at least 44 pixels square and pans sideways inside its own frame. Every other region fits the screen width. The staff console is a single column.

### Public screens and controls (DP-01, DP-03, DP-05, DP-07, DP-17, DP-19, DP-20, DP-22, DP-24, DP-34, DP-40, DP-50, DP-57, DP-58)

Only the controls and regions below are public. Tests and judges find them by ARIA role and accessible name. English names apply under `/en/` and French names under `/fr/`. Placeholders in angle brackets are defined in Feedback states.

| Where | Role and English name | French name | Notes |
|---|---|---|---|
| Every page | `link "Skip to main content"` | `link "Passer au contenu principal"` | First Tab stop. Moves focus to the main `heading` level 1. |
| Every page | `navigation "Primary"` with links `Programme`, `Membership`, `Gift a membership`, `Contact`, `Sign in` or `My account` | `navigation "Principale"` with `Programme`, `Adhésion`, `Offrir une adhésion`, `Contact`, `Se connecter` or `Mon compte` | Behind the Menu button below 768 pixels wide. |
| Every page, below 768 px | `button "Menu"` with `aria-expanded` | `button "Menu"` | Shows or hides the primary navigation. While hidden, the navigation is not rendered (`hidden` or `display: none`), not just moved off screen. |
| Every page | `button "Français"` (English pages) | `button "English"` (French pages) | Has `lang` set to the target language. |
| Every page | `alert "Service notice"` with `button "Dismiss notice"` | `alert "Avis de service"`, `button "Fermer l'avis"` | Shown only while a service is down. |
| Every page | `heading` level 1 | same | Has `tabindex="-1"` so it can receive focus. |
| Programme | `region "Programme stage"` | `region "Scène du programme"` | Carries the stage data attributes from Motion and effects. |
| Programme | `tablist "Seasons"` with one `tab` per season, named by season title in the page language, in stage order | `tablist "Saisons"` | The active tab has `aria-selected="true"` and `aria-current="true"`. |
| Programme | `status "Season announcer"` | `status "Annonce de saison"` | Polite. |
| Programme | `heading` level 2 per season, named by season title | same | |
| Programme | `list "Schedule — <season title>"`, each row a `link "<film title> — <date> <time> — <auditorium code>"` | `list "Horaire — <season title>"` | |
| Programme | Text `f/<stop>` | same | Mono readout. |
| Screening | `button "Film notes"` with `aria-expanded` (below 768 px only) and `region "Film notes"` | `button "Notes sur le film"`, `region "Notes sur le film"` | From 768 px up, the region is always shown with at least its heading, even for a film without notes. Below 768 px it is not rendered (`hidden` or `display: none`) until `Film notes` is expanded. |
| Screening | `grid "Seat map"` with `row` elements and one `gridcell "Seat <seat>"` per seat | `grid "Plan de salle"`, `gridcell "Place <seat>"` | `aria-selected` marks seats in the patron's selection or hold. `aria-disabled="true"` marks seats sold or held by others. Anchor for the language-switch tolerance. |
| Screening | `checkbox "Group booking (10 to 40 seats)"` | `checkbox "Réservation de groupe (10 à 40 places)"` | Signed-in patrons only. |
| Screening | `button "Hold seats"` | `button "Retenir les places"` | |
| Screening | `status "Booking status"` and `alert "Booking error"` | `status "État de la réservation"`, `alert "Erreur de réservation"` | |
| Checkout | `heading` level 1 `Checkout` | `Paiement` | |
| Checkout | `timer "Hold time remaining"` | `timer "Temps de réservation restant"` | Text `m:ss`. |
| Checkout | `button "Fare for seat <seat>: <fare label>"` opening `listbox "Fare"` with one `option` per allowed fare label, in the order of the Fare labels list | `button "Tarif pour la place <seat> : <fare label>"`, `listbox "Tarif"` | Not shown for group holds. |
| Checkout | `switch "Add a supporter uplift"` | `switch "Ajouter une contribution de soutien"` | |
| Checkout | `radiogroup "Uplift amount"` with `radio` `<amount>` for each preset and `radio "Other amount"`, plus `textbox "Other amount in dollars"` | `radiogroup "Montant de la contribution"`, `radio "Autre montant"`, `textbox "Autre montant en dollars"` | Visible only while the switch is on. |
| Checkout, group | `textbox "Payer name <n>"`, `spinbutton "Seats for payer <n>"`, `button "Add payer"`, `button "Remove payer <n>"` | `textbox "Nom du payeur <n>"`, `spinbutton "Places pour le payeur <n>"`, `button "Ajouter un payeur"`, `button "Retirer le payeur <n>"` | `<n>` counts from 1. Each `Seats for payer <n>` is a native `<input type="number">`. |
| Checkout, no session | `textbox "Full name"`, `textbox "Email"`, `textbox "Phone (optional)"` | `textbox "Nom complet"`, `textbox "Courriel"`, `textbox "Téléphone (facultatif)"` | |
| Checkout | `textbox "Note for the box office (optional)"`, `textbox "Cardholder name"` | `textbox "Note pour la billetterie (facultatif)"`, `textbox "Nom du titulaire de la carte"` | |
| Checkout and booking | `table "Price summary"` with row headers `Admission`, `GST (5%)`, `QST (9.975%)`, `Supporter uplift (not taxed)`, `Credit applied`, `Total`, `Pay now` | `table "Récapitulatif du prix"`: `Entrée`, `TPS (5 %)`, `TVQ (9,975 %)`, `Contribution de soutien (non taxable)`, `Crédit appliqué`, `Total`, `À payer maintenant` | The uplift and credit rows appear only when non-zero. |
| Checkout, membership and gift | `button "Verify with a code"` | `button "Vérifier avec un code"` | Present exactly while step-up is needed under the step-up rule in Business rules: on checkout while the latest quote's `stepup_required` is true; on membership and gift while the action shown needs step-up and the session has no live verification. |
| Checkout, membership and gift | `dialog "Confirm it's you"` containing `textbox "Verification code"`, `button "Verify"`, `button "Send a new code"`, `button "Close"` | `dialog "Confirmez votre identité"`, `textbox "Code de vérification"`, `button "Vérifier"`, `button "Envoyer un nouveau code"`, `button "Fermer"` | Opened by Verify with a code. |
| Checkout | Pay button, labels from Feedback states | same | |
| Checkout | `button "Release seats"` | `button "Libérer les places"` | |
| Checkout | `status "Checkout status"` and `alert "Checkout error"` | `status "État du paiement"`, `alert "Erreur de paiement"` | |
| Booking | `table "Tickets"`, `table "Cost split"` (groups), `button "Refund booking"` opening `dialog "Refund booking"` with `button "Confirm refund"` | `table "Billets"`, `table "Répartition des coûts"`, `button "Rembourser la réservation"`, `dialog "Rembourser la réservation"`, `button "Confirmer le remboursement"` | |
| Account | `region "Membership"`, `region "Credit"` with text `Credit balance: <amount>`, `table "Credit movements"`, `table "My bookings"` (one row per booking showing its booking ref) | `region "Adhésion"`, `region "Crédit"`, `Solde de crédit : <amount>`, `table "Mouvements de crédit"`, `table "Mes réservations"` | |
| Membership | `radiogroup "Tier"` with `radio` `Friend`, `Cinephile`, `Projectionist` | `radiogroup "Palier"`: `Ami`, `Cinéphile`, `Projectionniste` | |
| Membership | `button "Billing: <cadence label>"` opening `listbox "Billing cadence"` with `option` `Annual`, `Monthly`, in that order | `button "Facturation : <cadence label>"`, `listbox "Fréquence de facturation"`: `Annuelle`, `Mensuelle` | |
| Membership | `button "Join for <amount>"` (amount = the plan price) or `button "Change tier"` | `button "Adhérer pour <amount>"`, `button "Changer de palier"` | |
| Membership | `status "Form status"` and `alert "Form error"` | `status "État du formulaire"`, `alert "Erreur de formulaire"` | Same pair on every form page that is not checkout or the staff console. |
| Gift | `radiogroup "Tier"`, `textbox "Your name"`, `textbox "Your email"`, `textbox "Recipient name"`, `textbox "Recipient email"`, `combobox "Recipient's language"` (a native `<select>`; options `English` value `en`, `Français` value `fr`), `textbox "Message (optional)"`, `textbox "Cardholder name"`, `button "Buy gift for <amount>"` (amount = the tier's annual price) | `textbox "Votre nom"`, `textbox "Votre courriel"`, `textbox "Nom du destinataire"`, `textbox "Courriel du destinataire"`, `combobox "Langue du destinataire"`, `textbox "Message (facultatif)"`, `textbox "Nom du titulaire de la carte"`, `button "Acheter le cadeau pour <amount>"` | Your name and Your email appear only without a session. |
| Gift redemption | `heading` level 1 `Redeem your gift membership`, `button "Redeem membership"` | `Activez votre adhésion-cadeau`, `button "Activer l'adhésion"` | |
| Sign in | `textbox "Email"`, password field labelled `Password`, `button "Sign in"`, `link "Create an account"` | `Courriel`, `Mot de passe`, `button "Se connecter"`, `link "Créer un compte"` | |
| Sign up | `textbox "Full name"`, `textbox "Email"`, password field `Password`, `combobox "Preferred language"` (a native `<select>`; `English`/`en`, `Français`/`fr`), `button "Create account"` | `Nom complet`, `Courriel`, `Mot de passe`, `combobox "Langue préférée"`, `button "Créer un compte"` | |
| Booking link | `textbox "Booking reference"`, `textbox "Email"`, `button "Email me a new link"` | `textbox "Référence de réservation"`, `textbox "Courriel"`, `button "M'envoyer un nouveau lien"` | |
| Contact | `textbox "Full name"`, `textbox "Email"`, `textbox "Subject"`, `textbox "Message"`, `button "Send enquiry"` | `Nom complet`, `Courriel`, `Objet`, `Message`, `button "Envoyer la demande"` | |
| Staff | `navigation "Staff"` with links `Door`, `Programme`, `Finance` (the signed-in role's only) | `navigation "Personnel"`: `Accueil`, `Programmation`, `Finances` | |
| Staff | `status "Staff status"` and `alert "Staff error"` | `status "État"`, `alert "Erreur"` | |
| Door | `combobox "Screening"` (a native `<select>` whose option values are screening ids) listing screenings within 24 hours of now, `table "Door list"` with columns `Seat`, `Initial`, `Ticket`, `Status`, `searchbox "Ticket or booking code"`, `button "Check in"` | `combobox "Séance"`, `table "Liste d'accueil"`: `Place`, `Initiale`, `Billet`, `Statut`, `searchbox "Code du billet ou de la réservation"`, `button "Enregistrer l'entrée"` | |
| Programme console | `textbox "Season slug"`, `textbox "Title (English)"`, `textbox "Title (French)"`, date field `Public sale date` (a native `<input type="date">`), `button "Create season"` | `textbox "Identifiant de la saison"`, `textbox "Titre (anglais)"`, `textbox "Titre (français)"`, `Date de vente publique`, `button "Créer la saison"` | |
| Programme console | `combobox "Season"` (option values are season slugs), `textbox "Film title"`, `combobox "Format"` (options `35mm`, `16mm`, `DCP`, each value equal to its label), `combobox "Auditorium"` (options `MH1`, `MH2`, `AC1`, each value equal to its label), date-time field `First showtime` (a native `<input type="datetime-local">`), `spinbutton "Weekly occurrences"`, `button "Add screenings"` | `combobox "Saison"`, `textbox "Titre du film"`, `combobox "Format"`, `combobox "Salle"`, `Première séance`, `spinbutton "Occurrences hebdomadaires"`, `button "Ajouter les séances"` | The three comboboxes are native `<select>` elements. |
| Programme console | `table "Seasons"` (one row per season showing its slug); per row `button "Schedule season"`, `button "Archive season"`, `button "Withdraw season"` opening `dialog "Withdraw season"` with `textbox "Reason"` and `button "Confirm withdrawal"` | `table "Saisons"`, `button "Planifier la saison"`, `button "Archiver la saison"`, `button "Retirer la saison"`, `dialog "Retirer la saison"`, `textbox "Motif"`, `button "Confirmer le retrait"` | |
| Finance | `searchbox "Find booking"`, `button "Search"` | `searchbox "Trouver une réservation"`, `button "Rechercher"` | |
| Finance | Result pane: `region "Booking <booking ref>"`, `region "Account <account number>"` or `region "Gift <gift ref>"` | `region "Réservation <booking ref>"`, `region "Compte <account number>"`, `region "Cadeau <gift ref>"` | A ticket code opens its booking's region. |
| Finance | `button "Refund booking"` opening `dialog "Refund booking"` with `textbox "Reason"` and `button "Confirm refund"` | as on the booking page, plus `textbox "Motif"` | In the booking region. |
| Finance | `button "Issue goodwill credit"` opening `dialog "Issue goodwill credit"` with `textbox "Amount in dollars"`, `textbox "Reason"`, `button "Issue credit"` | `button "Émettre un crédit de courtoisie"`, `dialog "Émettre un crédit de courtoisie"`, `textbox "Montant en dollars"`, `textbox "Motif"`, `button "Émettre le crédit"` | In booking and account regions. |
| Finance | `region "Reconciliation"` with date field `Business day` (a native `<input type="date">`), `button "Load day"`, `table "Takings"`, `link "Download CSV"`, `button "Accept Kill Bill figure"` opening `dialog "Accept Kill Bill figure"` with `textbox "Reason"` and `button "Confirm"` | `region "Rapprochement"`, `Journée d'affaires`, `button "Charger la journée"`, `table "Recettes"`, `link "Télécharger le CSV"`, `button "Accepter le montant de Kill Bill"`, `dialog "Accepter le montant de Kill Bill"`, `textbox "Motif"`, `button "Confirmer"` | |
| Finance | `table "Audit list"`, `table "Mail outbox"`, `table "Enquiries"` (one row per enquiry showing its ref and subject, with `button "Open <ref>"` that selects it) with `textbox "Reply"` and `button "Send reply"` on the selected enquiry | `table "Journal d'audit"`, `table "File de courriels"`, `table "Demandes"`, `button "Ouvrir <ref>"`, `textbox "Réponse"`, `button "Envoyer la réponse"` | |

### Interactions (DP-03, DP-05, DP-07, DP-17, DP-18, DP-24, DP-32, DP-34, DP-58)

- **Tab order.** On every page the order is the skip link, the header links, the language button and, when present, the Dismiss notice button, then the main content in reading order. On the programme page that means the season tab list as one stop, then the rail links of the active season only. On checkout: each fare button in seat order, the uplift switch, the uplift radios and other-amount field, the payer fields, the guest fields, the note, the cardholder name, Verify with a code, the pay button, then Release seats.
- **Skip and dismiss.** The skip link and the Dismiss notice button both move focus to the main level-1 heading. Focus never falls back to the document body.
- **Season tabs.** Left and Right Arrow move focus between tabs and wrap at the ends. Home and End jump to the first and last tab. Enter or Space activates the focused tab. Activation behaves like a deep link to that season, as defined in Motion and effects. A rail link that receives focus while its season's rail is not fully visible jumps the page to that season's deep-link position first.
- **Seat map.** The grid is one Tab stop and uses a roving focus. On entry, focus goes to the last focused seat, or else the first seat in seat order. Arrow keys move one seat (Left and Right within a row, Up and Down to the same seat number in the next row, clamped to the nearest existing seat) and stop at the edges without wrapping. Home and End jump to the first and last seat of the row. Space or Enter toggles the focused seat in or out of the selection when it is available and does nothing when it is unavailable. A pointer click or tap toggles a seat the same way. Hold seats submits the selection.
- **Option menus (fare and billing cadence).** Enter, Space or a click on the opener opens its listbox and puts focus on the currently selected option. Up and Down Arrow move between options. Enter or a click chooses an option, closes the menu and returns focus to the opener. Escape closes the menu without a change and returns focus to the opener. Tab closes the menu without a change and moves on.
- **Dialogs.** Opening a dialog moves focus to its first field, or its first button if it has no field. Tab and Shift+Tab cycle inside the dialog. Escape or Close shuts it and returns focus to the control that opened it. In the step-up dialog, a successful Verify closes the dialog and puts focus on the action it unlocked: the pay button on checkout, Join or Change tier on membership, Buy gift on gift. On checkout, a successful Verify also requests a fresh quote, so Verify with a code disappears and the pay button enables once that quote returns `stepup_required` false.
- **Language switch.** Pressing the language button swaps every visible string and every accessible name to the other locale in place. The document is not reloaded. The path prefix changes through a history replacement, `html lang` changes to `en` or `fr`, and the choice is saved through the locale endpoint. The scroll position, the focus, the selected seats and any typed form values all stay where they were. Without scripts, the button submits to the locale route in Server boundary.
- **Language switch tolerance.** On the screening page, at each of the three viewports and at any scroll position, the bounding box of `grid "Seat map"` differs by at most 2 CSS pixels in its left edge, top edge, width and height between just before and just after the switch, in either direction. To make this hold, every element above or beside the seat map keeps the same size in both locales: headings, labels and buttons there are given room for the longer of the two texts, and longer text never wraps onto an extra line.
- **Holding and checkout.** Hold seats creates the hold and goes to checkout. Changing a fare or the uplift asks the server for a fresh quote, and the price summary updates within one second. Release seats ends the hold and returns to the screening page. Pay submits checkout with a fresh idempotency key per checkout page visit, and resubmitting from the same visit reuses that key. On success the browser goes to the booking page. The gift form follows the same key rule per gift page visit.
- **Door check-in.** Typing a ticket code (`T-…`) or booking reference (`HB-…`) and pressing Enter or Check in checks in that ticket or every unchecked ticket in the booking. Focus stays in the search box and the box is cleared.
- **Staff lookup.** Enter or Search runs the lookup and focuses the result region's heading. On a miss, focus stays in the search box.

### Visual design (DP-59)

- **Colour roles.** A near-black ground, like the inside of a projection booth, on every public page and in the staff console. Warm off-white ink, like aged paper, for text. A warm mid-grey for secondary text, past screenings and unavailable seats. One tungsten amber reserved for live, actionable state: on-sale rail rows, selected seats, the pay button, the active season tab and focus indication. A clear red reserved for errors, the losing side of a seat race and outage notices. Amber is never used for decoration. Each season tints the ground very slightly (deep oxblood, deep blue-green, deep umber, cycling in season order) while staying near-black.
- **Type.** Instrument Serif for display (season titles, film titles, page headings). Inter for body and controls. IBM Plex Mono for every number a patron reads like a projectionist's log: times, dates, seat codes, auditorium codes, seats left, f-stops, amounts and references. Each heading step is about one fifth larger than the step below it. Season titles on the stage are about six times body text at the widest viewport.
- **Density and composition.** The pages are airy, with generous space between rail rows and between form groups. The public pages are a full-bleed black stage, with the season title set low at the left and the f-stop readout at the right. The staff console drops the stage and uses compact table-and-detail panes on the same palette.
- **Controls and contrast.** Every interactive target is at least 44 by 44 pixels. All text and control states meet WCAG 2.2 AA contrast against the ground. Seat states differ by shape as well as colour: available seats are outlined, yours are filled amber, taken seats are greyed with a diagonal stroke.
- **Media.** All imagery is procedural. Icons come from Lucide.

### Motion and effects (DP-02, DP-03, DP-04, DP-19, DP-58)

**Interface motion.** Panels, dialogs and menus fade and rise a few pixels when they appear and reverse when they leave, in about a quarter to a third of a second (between 240 and 320 milliseconds), starting and ending gently. Hover and keyboard focus on rail rows, seats and buttons show an amber edge, applied within that same range. The uplift switch's thumb, drawn inside the switch control, slides from off to on in about a quarter of a second (240 milliseconds). The hold timer ticks once per second. Nothing else moves on a clock. Decorative loops, idle animation and parallax are not allowed. Under reduced motion every one of these changes is instant. All of this motion uses CSS transitions or animations or `element.animate()`, never a script that moves things frame by frame.

**Signature: Iris Pull.** A patron moves through the programme season by season. A lens iris opens onto one season's schedule and closes before the next, so it is always clear which season they are browsing, and the URL records it for sharing.

- **Stage geometry.** The stage holds N seasons: every season in `scheduled`, `member-priority` or `on-sale`, ordered by first screening date, then slug. Season k (counting from 0) owns scroll positions 1000·k to 1000·k + 1000 pixels, measured from the top of the document. The stage is tall enough that scrolling reaches 1000·N, and the footer follows. For a scroll position y, the segment is k = min(N − 1, floor(y / 1000)) and the local position is p = min(1000, y − 1000·k). The stage, iris and title stay fixed in the viewport while their segment scrolls past.
- **Openness o.** o = p / 400 for p below 400. o = 1 from 400 to below 700. o = (1000 − p) / 300 from 700 to 1000. The opening and closing are linear in scroll, with no easing on scroll.
- **Iris.** Nine procedurally drawn blades. The blade rotation is 40·o degrees. The aperture radius is (D / 2)·(0.04 + 0.96·o) pixels, where D is the viewport's diagonal, √(`window.innerWidth`² + `window.innerHeight`²) in CSS pixels. Closed, it is a pupil 4% of the diagonal across. Fully open, it clears the whole viewport.
- **F-stop readout.** It shows `f/` followed by entry i = min(8, floor(8·o)) of the list 22, 16, 11, 8, 5.6, 4, 2.8, 2, 1.4 (i counts from 0). While opening, the readout steps every 50 pixels of scroll.
- **Rail.** The schedule rail's visibility v is 0 for p below 400, (p − 400) / 300 from 400 to below 700, and (1000 − p) / 300 from 700 to 1000.
- **Ground tint.** The tint mix t is 0 for p below 700 and (p − 700) / 300 from 700 to 1000, crossfading the ground toward season k + 1's tint. It stays 0 for the last season.
- **Activation.** The active season is k when p ≥ 300 (the readout has reached f/2.8), otherwise max(0, k − 1). Whenever the active season changes, four things happen: the URL query becomes `?season=<slug>` through a history replacement, the `html` element's `data-active-season` becomes the slug, that season's tab gets `aria-selected="true"` and `aria-current="true"`, and the Season announcer reads the copy from Feedback states once. On first load the URL and attribute take the initial active season, without an announcement.
- **Deep link and tab activation.** Loading `/<locale>/?season=<slug>` for a season on the stage, or activating its tab, jumps the page instantly to y = 1000·k + 700, where o = 1, v = 1 and that season is active. For example, with the seed data at start, `?season=winter-retrospective` is k = 2 and lands at y = 2700. An unknown slug is ignored and the page opens at the top.
- **Pure function of scroll.** Every value above depends only on the scroll position and viewport size. Each is monotonic within each phase, and scrolling back retraces the same values step by step, with no drift over time. The attributes update within 100 milliseconds of the scroll position settling.
- **Published attributes.** These sit on `region "Programme stage"`:

| Attribute | Value | Check tolerance |
|---|---|---|
| `data-segment` | k | exact |
| `data-iris-open` | o, three decimals | ±0.005 |
| `data-iris-rotation` | degrees, one decimal | ±0.2 |
| `data-iris-radius` | radius, whole pixels | ±2 |
| `data-fstop` | `22`, `16`, `11`, `8`, `5.6`, `4`, `2.8`, `2` or `1.4` | exact; checks stay at least 2 pixels away from a step |
| `data-rail-visible` | v, three decimals | ±0.005 |
| `data-tint-mix` | t, three decimals | ±0.005 |
| `data-renderer` | `webgl` or `svg` | exact |
| `data-context` | `ok`, `lost` or `none` | exact |

- **Reduced motion.** Under `prefers-reduced-motion: reduce` the stage is not split into scroll segments. It shows only the selected season, which is the deep-linked season or else the first. The iris is drawn fully open and static. Tabs swap seasons instantly, with no scrubbing and no scroll jump. The attributes hold the selected season's final values at once: `data-segment` = its index, `data-iris-open` `1.000`, `data-iris-rotation` `40.0`, `data-iris-radius` = round(D / 2), `data-fstop` `1.4`, `data-rail-visible` `1.000`, `data-tint-mix` `0.000`. The URL, `data-active-season`, tab state and announcement behave exactly as in full motion.
- **Without WebGL.** When WebGL is unavailable at load, an SVG drawing of the same nine blades renders every state, with `data-renderer="svg"` and `data-context="none"`. When the WebGL context is lost, the SVG iris replaces the canvas immediately, with `data-renderer="svg"` and `data-context="lost"`, and all numeric attributes keep following scroll. When the context is restored, within one second the canvas returns with `data-renderer="webgl"` and `data-context="ok"`, showing the current scroll state. The WebGL context is created on the main thread for a `<canvas>` in the document; that canvas is never transferred to an OffscreenCanvas or a worker.

### Feedback states (DP-15, DP-19, DP-20, DP-22, DP-50, DP-51, DP-56)

**Placeholders.** These hold wherever a placeholder appears in this brief.
- `<amount>`: a value in cents formatted for the page or email locale. English: dollar sign, comma thousands, dot decimals (`$1,234.50`). French: space-grouped thousands, comma decimals, a space, then `$` (`1 234,50 $`). Checks treat a normal space, a no-break space and a narrow no-break space as equal.
- `<date>`: `YYYY-MM-DD`. `<time>`: `HH:MM`, 24-hour. Both are America/Toronto local.
- `<seat>`: row letter plus seat number, such as `C7`. `<seats>`: seat codes in seat order, joined by `, `.
- `<season title>`: the title in the page locale. `<film title>`: as stored.
- `<booking ref>`, `<gift ref>`, `<enquiry ref>`, `<account number>`, `<ticket code>`: the record's identifier (formats in Business rules).
- `<fare label>`: one of the fare labels below. `<cadence label>`: `Annual` or `Monthly` (`Annuelle`, `Mensuelle`).
- Fare labels: `regular` Regular / Ordinaire; `reduced` Reduced (student, 65+) / Réduit (étudiant, 65 ans et plus); `member` Member / Membre; `member-guest` Member guest / Invité de membre; `group` Group / Groupe.
- Tier labels: Friend / Ami, Cinephile / Cinéphile, Projectionist / Projectionniste.

**Rules for every async action.** While a request is in flight, its button is disabled, shows `Working…` (`En cours…`), and the page's status region announces the same text. The pay button uses its own pending label. On success, the status region announces the action's success copy. On an API error, the page's alert region shows the error's `message` verbatim, and for field errors each message also appears under its field, tied to it as its description. Copy shown after success stays true when mail is only queued.

| Key | English | French |
|---|---|---|
| Season announcer | `<season title> — <n> screenings` (`1 screening` when n is 1) | `<season title> — <n> séances` (`1 séance`) |
| Sale times line (on the programme page, for scheduled and member-priority seasons) | `Members book from <date> 10:00 · Everyone from <date> 10:00 (Montréal time)` | `Membres dès le <date> à 10 h · Grand public dès le <date> à 10 h (heure de Montréal)` |
| Seats left | `<n> left`, or `Sold out` when 0 | `<n> restantes`, or `Complet` |
| Hold placed | `Seats held. Complete checkout before the timer ends.` | `Places retenues. Terminez le paiement avant la fin du minuteur.` |
| Pay button | `Pay <amount>` (amount = pay now) | `Payer <amount>` |
| Pay button, pay now is 0 | `Confirm booking` | `Confirmer la réservation` |
| Pay button pending | `Processing payment…` | `Paiement en cours…` |
| Confirmation heading | `Booking confirmed` | `Réservation confirmée` |
| Confirmation line | `We'll email your confirmation to <email>.` | `Nous enverrons votre confirmation à <email>.` |
| Mail delayed line (confirmation, gift, step-up, reply, while mail is down) | `Email is delayed. It will be sent automatically when our mail service returns.` | `Le courriel est retardé. Il sera envoyé automatiquement au retour de notre service de courriel.` |
| Release done | `Seats released.` | `Places libérées.` |
| Step-up code sent | `We sent a 6-digit code to <masked email>.` (`<masked email>` is the first character, `***`, then `@` and the domain) | `Nous avons envoyé un code à 6 chiffres à <masked email>.` |
| Step-up verified | `Verified.` | `Vérifié.` |
| Membership joined heading | `Membership active` | `Adhésion active` |
| Upgrade done | `Your new tier is active. Charged today: <amount>.` | `Votre nouveau palier est actif. Facturé aujourd'hui : <amount>.` |
| Downgrade or cadence scheduled | `Your change takes effect on <date>. Nothing is charged today.` | `Votre changement prend effet le <date>. Rien n'est facturé aujourd'hui.` |
| Gift purchased heading and line | `Gift membership purchased` / `We'll email the gift to <recipient email>.` | `Adhésion-cadeau achetée` / `Nous enverrons le cadeau à <recipient email>.` |
| Gift redeemed heading | `Your gift membership is active` | `Votre adhésion-cadeau est active` |
| Refund done | `Refund issued: <amount> to the original payment.`, followed by ` <amount> returned to your credit.` when non-zero | `Remboursement émis : <amount> sur le paiement d'origine.`, followed by ` <amount> remis en crédit.` |
| Goodwill done | `Goodwill credit of <amount> issued to <account number>.` | `Crédit de courtoisie de <amount> émis au compte <account number>.` |
| Checked in | `Checked in: seat <seat>.`, or for a booking `Checked in <n> of <m> tickets.` | `Entrée enregistrée : place <seat>.` / `<n> billets sur <m> enregistrés.` |
| Lookup miss | `No booking, ticket, gift or account matches “<query>”.` | `Aucune réservation, aucun billet, aucun cadeau ni aucun compte ne correspond à « <query> ».` |
| Reconciliation accepted | `Kill Bill total accepted for <date>. The difference of <amount> is recorded in the audit list.` | `Total de Kill Bill accepté pour le <date>. L'écart de <amount> est consigné au journal d'audit.` |
| Season scheduled / archived / withdrawn | `Season scheduled.` / `Season archived.` / `Season withdrawn. <n> bookings refunded.` | `Saison planifiée.` / `Saison archivée.` / `Saison retirée. <n> réservations remboursées.` |
| Screenings added | `<n> screenings added.` | `<n> séances ajoutées.` |
| Enquiry received | `Thank you. Your enquiry <enquiry ref> has been received. We reply by email.` | `Merci. Votre demande <enquiry ref> a bien été reçue. Nous répondons par courriel.` |
| Reply recorded | `Reply recorded. It will be emailed to <email>.` | `Réponse enregistrée. Elle sera envoyée à <email>.` |
| Booking link requested | `If the reference and email match, a new link is on its way and any earlier link no longer works.` | `Si la référence et le courriel correspondent, un nouveau lien est en route et tout lien précédent ne fonctionne plus.` |
| Billing notice | `Billing is temporarily unavailable. You can browse the programme, but booking, membership changes and refunds are paused.` | `La facturation est temporairement indisponible. Vous pouvez consulter le programme, mais les réservations, les changements d'adhésion et les remboursements sont suspendus.` |
| Mail notice | `Email delivery is delayed. Confirmations will be sent automatically when it recovers.` | `L'envoi des courriels est retardé. Les confirmations seront envoyées automatiquement à son rétablissement.` |
| Mail outbox states | `Pending`, `Sent`, `Not delivered` | `En attente`, `Envoyé`, `Non livré` |
| Reconciliation status | `Matched`, `Mismatch`, `Accepted` | `Concordant`, `Écart`, `Accepté` |

**Error messages.** Each API error `message` is the text below in the request locale (Business rules). HTTP statuses are in the API error catalogue.

| Code | English | French |
|---|---|---|
| `not_found` | `This page or record doesn't exist.` | `Cette page ou cette fiche n'existe pas.` |
| `unauthenticated` | `Please sign in to continue.` | `Connectez-vous pour continuer.` |
| `invalid_credentials` | `Email or password is incorrect.` | `Courriel ou mot de passe incorrect.` |
| `forbidden` | `Your role can't do this.` | `Votre rôle ne permet pas cette action.` |
| `cross_origin` | `This request must come from the Halide site.` | `Cette requête doit provenir du site Halide.` |
| `body_too_large` | `The request is too large.` | `La requête est trop volumineuse.` |
| `unsupported_media_type` | `Send the request as JSON.` | `Envoyez la requête en JSON.` |
| `invalid_json` | `The request body isn't valid JSON.` | `Le corps de la requête n'est pas un JSON valide.` |
| `method_not_allowed` | `This action isn't allowed here.` | `Cette action n'est pas permise ici.` |
| `validation` | `Some fields need attention.` | `Certains champs sont à corriger.` |
| `idempotency_conflict` | `This retry key was already used for a different request.` | `Cette clé de reprise a déjà servi pour une autre requête.` |
| `idempotency_in_progress` | `This request is still being processed.` | `Cette requête est toujours en traitement.` |
| `seat_taken` | `Just taken by another patron: <seats>. Choose other seats.` | `Viennent d'être prises par une autre personne : <seats>. Choisissez d'autres places.` |
| `hold_expired` | `Your seat hold has expired and the seats are back on sale. Choose your seats again.` | `Votre réservation temporaire a expiré et les places sont remises en vente. Choisissez de nouveau vos places.` |
| `hold_already_paid` | `This hold has already been paid.` | `Cette réservation temporaire est déjà payée.` |
| `not_on_sale` | `Booking for this season opens to members on <date> at 10:00.` | `La réservation pour cette saison ouvre aux membres le <date> à 10 h.` |
| `members_priority` | `Member priority booking is open. Booking opens to everyone on <date> at 10:00.` | `La réservation prioritaire des membres est en cours. La vente au grand public ouvre le <date> à 10 h.` |
| `screening_closed` | `This screening is no longer on sale.` | `Cette séance n'est plus en vente.` |
| `stepup_required` | `Confirm it's you with the code we email you.` | `Confirmez votre identité avec le code envoyé par courriel.` |
| `code_incorrect` | `That code isn't right. <n> attempts left.` | `Ce code est incorrect. Essais restants : <n>.` |
| `code_expired` | `This code has expired. Send a new code.` | `Ce code a expiré. Demandez un nouveau code.` |
| `stepup_locked` | `Too many incorrect codes. Verification is locked for <minutes> min.` | `Trop de codes incorrects. La vérification est bloquée pendant <minutes> min.` |
| `resend_too_soon` | `Wait <seconds> s before sending another code.` | `Attendez <seconds> s avant de demander un autre code.` |
| `code_send_limit` | `Too many codes sent. Try again in <minutes> min.` | `Trop de codes envoyés. Réessayez dans <minutes> min.` |
| `already_member` | `You already have an active membership.` | `Vous avez déjà une adhésion active.` |
| `not_member` | `You don't have an active membership.` | `Vous n'avez pas d'adhésion active.` |
| `no_change` | `That is already your tier and billing.` | `C'est déjà votre palier et votre facturation.` |
| `change_pending` | `A change is already scheduled for <date>.` | `Un changement est déjà prévu le <date>.` |
| `gift_membership_locked` | `Gift memberships can't change tier until they end.` | `Une adhésion-cadeau ne peut pas changer de palier avant sa fin.` |
| `booking_not_paid` | `This booking isn't paid.` | `Cette réservation n'est pas payée.` |
| `already_refunded` | `This booking was already refunded.` | `Cette réservation a déjà été remboursée.` |
| `booking_checked_in` | `This booking has been checked in and can't be refunded.` | `Cette réservation a été enregistrée à l'entrée et ne peut pas être remboursée.` |
| `refund_window_closed` | `Refunds close 2 hours before showtime. The box office can offer a goodwill credit.` | `Les remboursements ferment 2 heures avant la séance. La billetterie peut offrir un crédit de courtoisie.` |
| `already_checked_in` | `Already checked in at <time>.` | `Déjà enregistré à <time>.` |
| `checkin_not_open` | `Check-in opens at <time>.` | `L'accueil ouvre à <time>.` |
| `checkin_closed` | `Check-in closed at <time>.` | `L'accueil a fermé à <time>.` |
| `ticket_refunded` | `This ticket was refunded.` | `Ce billet a été remboursé.` |
| `illegal_transition` | `A season can't move from <from> to <to>.` | `Une saison ne peut pas passer de <from> à <to>.` |
| `season_empty` | `Add at least one screening first.` | `Ajoutez d'abord au moins une séance.` |
| `season_has_future_screenings` | `This season still has upcoming screenings.` | `Cette saison a encore des séances à venir.` |
| `season_closed` | `This season is closed to changes.` | `Cette saison n'accepte plus de modifications.` |
| `slug_taken` | `That season slug is already used.` | `Cet identifiant de saison est déjà utilisé.` |
| `email_taken` | `An account already uses this email.` | `Un compte utilise déjà ce courriel.` |
| `nothing_to_accept` | `This day already matches Kill Bill.` | `Cette journée concorde déjà avec Kill Bill.` |
| `billing_unavailable` | `Billing is temporarily unavailable. Nothing was charged or changed. Please try again in a few minutes.` | `La facturation est temporairement indisponible. Rien n'a été facturé ni modifié. Réessayez dans quelques minutes.` |

`<from>` and `<to>` are state values. `<minutes>` is the Retry-After seconds divided by 60, rounded up. `<seconds>` is the Retry-After value.

**Field messages** (inside `fields`):
- Required: `Required.` / `Obligatoire.`
- Bad email: `Enter a valid email address.` / `Entrez une adresse courriel valide.`
- Length: `Use <min> to <max> characters.` / `Utilisez de <min> à <max> caractères.`
- Not in the list: `Choose one of the listed options.` / `Choisissez l'une des options proposées.`
- Seat count: `Choose 1 to 10 seats.` / `Choisissez de 1 à 10 places.`
- Group seat count: `Choose 10 to 40 seats for a group.` / `Choisissez de 10 à 40 places pour un groupe.`
- Fare: `This fare isn't available for this seat.` / `Ce tarif n'est pas offert pour cette place.`
- Uplift: `Enter an uplift between $1.00 and $500.00.` / `Entrez une contribution entre 1,00 $ et 500,00 $.`
- Credit: `Enter a credit between $1.00 and $500.00.` / `Entrez un crédit entre 1,00 $ et 500,00 $.`
- Split: `Payer seats must add up to <n>.` / `Les places des payeurs doivent totaliser <n>.`
- Date or time: `Enter a valid date.` / `Entrez une date valide.`
- Retry key: `A retry key is required.` / `Une clé de reprise est requise.`

**Pay button disabled conditions.** The pay button keeps its label from the copy table and is natively disabled in each of these cases, in both locales:
1. The hold countdown has reached `0:00`, or the server answered `hold_expired`.
2. The latest quote's `stepup_required` is true.
3. Pay now is above zero and the cardholder name is empty.
4. There is no session and the full name or email is empty.
5. The billing notice is showing.
6. A group's payer seats do not add up to the hold's seat count.

On the membership and gift screens, the Join, Change tier and Buy gift buttons keep their published labels and are natively disabled, in both locales, while the action shown needs step-up and the session has no live verification (step-up rule in Business rules), and while the billing notice is showing.

When the hold expires, the Checkout error alert shows the `hold_expired` message together with `link "Choose seats again"` (`link "Choisir de nouveau vos places"`), which opens the screening page. When a hold attempt loses a race, the Booking error alert shows the `seat_taken` message, the taken seats are greyed at once, and they leave the selection.

**Outage notices.** The Service notice alert shows the billing notice, the mail notice, or both, one paragraph each. It appears within 10 seconds of the status endpoint reporting a service down and disappears within 10 seconds of it reporting the service up. The page polls status every 5 seconds. Dismissing a notice hides it until that service's status next changes.

## Backend

### API (DP-08, DP-10, DP-11, DP-13, DP-15, DP-20, DP-29, DP-31, DP-34, DP-41, DP-42, DP-43, DP-44, DP-45, DP-46, DP-48, DP-50, DP-53)

All endpoints are under the app origin. Request bodies are `application/json` with a limit of 16,384 bytes. Responses are `application/json; charset=utf-8`, except the CSV export. Every API request from the browser carries the header `X-Halide-Locale` set to the page locale (`en` or `fr`). Every instant in a response is ISO 8601 in America/Toronto with offset and whole seconds, such as `2026-11-03T19:00:00-05:00`. Mail outbox times are the only exception and carry milliseconds. Money fields are integer cents, suffixed `_cents`, with currency `CAD`. Sessions use an HttpOnly, SameSite=Lax cookie. Anonymous guests get an HttpOnly cookie scoping their holds.

**Error shape** (the only one): `{"error":{"code":"<code>","message":"<localised message>","fields":{"<field>":"<message>"}}}`. `fields` appears only for `validation`. Extra keys appear only on these codes: `seats` (array of seat codes) on `seat_taken`, `attempts_left` (integer) on `code_incorrect`, `retry_after_seconds` (integer) on every 429, together with a `Retry-After` header in whole seconds.

**Error catalogue.** 400 `invalid_json`. 401 `unauthenticated`, `invalid_credentials`. 403 `forbidden`, `cross_origin`, `members_priority`, `stepup_required`. 404 `not_found`. 405 `method_not_allowed`. 409 `idempotency_in_progress`, `seat_taken`, `not_on_sale`, `screening_closed`, `hold_already_paid`, `booking_not_paid`, `already_refunded`, `booking_checked_in`, `refund_window_closed`, `already_checked_in`, `checkin_not_open`, `checkin_closed`, `ticket_refunded`, `already_member`, `not_member`, `no_change`, `change_pending`, `gift_membership_locked`, `illegal_transition`, `season_has_future_screenings`, `season_closed`, `slug_taken`, `email_taken`, `nothing_to_accept`. 410 `hold_expired`, `code_expired`. 413 `body_too_large`. 415 `unsupported_media_type`. 422 `validation`, `idempotency_conflict`, `code_incorrect`, `season_empty`. 429 `stepup_locked`, `resend_too_soon`, `code_send_limit`. 503 `billing_unavailable`.

**Error precedence**, applied the same way on every endpoint. The first failing check wins:
1. 413, then 415, then 400.
2. `cross_origin`.
3. `unauthenticated`.
4. `forbidden` for the caller's role on that route.
5. `not_found` for an unknown record, or one the caller does not own.
6. Idempotency: a replay returns its stored response before any later check, then `idempotency_in_progress`, then `idempotency_conflict`, then a missing key (`validation`).
7. 429 limits.
8. State checks: 403 `members_priority` and `stepup_required`, then every 409 and 410.
9. `validation`, `code_incorrect`, `season_empty`.
10. `billing_unavailable`.

Endpoint rows list only their own errors.

**Shapes used below.**
- Booking: `{"ref","state","locale","screening":{"id","film_title","starts_at","auditorium"},"seats":[...],"tickets":[{"code","seat","fare","status"}],"lines":[{"fare","quantity","unit_cents","subtotal_cents","gst_cents","qst_cents"}],"admission_cents","gst_cents","qst_cents","uplift_cents","total_cents","credit_applied_cents","paid_cents","currency":"CAD","split":null|[{"name","seats","share_cents"}],"paid_at"}`. Lines appear in the fare order `regular`, `reduced`, `member`, `member-guest`, `group`, one line per fare used.
- Quote: the same money keys plus `lines`, `pay_now_cents` and `stepup_required` (boolean, set by the step-up rule in Business rules).
- Hold: `{"id","screening_id","seats":[...],"group":bool,"state":"held"|"expired"|"paid","ended_by":null|"patron"|"timeout"|"season","expires_at","server_time","booking_ref":null|"<ref>"}`.
- Membership: `{"tier","cadence":"annual"|"monthly"|"gift","plan","state":"active","started_on","charged_through","ends_on":null|"<date>","pending_change":null|{"tier","cadence","effective_date"}}`.
- Invoice: `{"amount_cents","credit_applied_cents","paid_cents","items":[{"type","description","amount_cents"}]}`. Every value is copied from the Kill Bill invoice.

| Method and path | Who | Request | Success | Own errors |
|---|---|---|---|---|
| GET `/api/health` | anyone | none | 200 `{"status":"ok"}` | 503 `{"status":"starting"}` until the database schema is ready |
| GET `/api/status` | anyone | none | 200 `{"billing":"up"\|"down","mail":"up"\|"down","checked_at"}` | none |
| POST `/api/locale` | anyone | `{"locale":"en"\|"fr"}` | 204, sets the locale cookie and, when signed in, the account locale | validation |
| GET `/api/seasons` | anyone | none | 200 `{"seasons":[{"slug","title","title_en","title_fr","state","public_sale_date","priority_opens_at","public_opens_at","first_date","last_date","screening_count"}]}`, stage order | none |
| GET `/api/seasons/<slug>` | anyone | none | 200 `{"season":{…same keys…,"screenings":[{"id","film_title","format","auditorium","starts_at","starts_local","capacity","seats_remaining"}]}}`, future screenings in start order | not_found for draft, archived, withdrawn |
| GET `/api/screenings/<id>` | anyone | none | 200 `{"screening":{"id","season_slug","film_title","format","auditorium":{"code","name","venue"},"starts_at","starts_local","capacity","sold","held","seats_remaining","seats":[{"code","state":"available"\|"held"\|"sold"\|"mine"}]}}` | not_found |
| POST `/api/holds` | anyone; group needs a session | `{"screening_id","seats":["C3"],"group":false}` | 201 `{"hold":Hold}` | seat_taken, not_on_sale, members_priority, screening_closed, validation |
| GET `/api/holds/<id>` | hold owner | none | 200 `{"hold":Hold}` | not_found |
| POST `/api/holds/<id>/quote` | hold owner | `{"fares":{"C3":"member"},"uplift_cents":500}` | 200 `{"quote":Quote}` | hold_expired, hold_already_paid, validation |
| DELETE `/api/holds/<id>` | hold owner | none | 200 `{"hold":Hold,"released_amount":{"cents","currency":"CAD"}}` | hold_expired, hold_already_paid |
| POST `/api/checkout` | hold owner; header `Idempotency-Key` | `{"hold_id","fares":{…},"uplift_cents","cardholder_name","note","guest":{"name","email","phone"},"split":[{"name","seats"}]}` | 201 `{"booking":Booking,"guest_link":"/<locale>/b/<token>"\|null}` | hold_expired, hold_already_paid, stepup_required, validation, billing_unavailable |
| GET `/api/bookings` | patron | none | 200 `{"bookings":[Booking]}`, newest first | none |
| GET `/api/bookings/<ref>` | owning patron | none | 200 `{"booking":Booking}` | not_found |
| POST `/api/bookings/<ref>/refund` | owning patron | `{}` | 200 `{"refund":{"booking_ref","refunded_cents","recredited_cents","currency":"CAD","state":"refunded"}}` | booking_not_paid, already_refunded, booking_checked_in, refund_window_closed, billing_unavailable |
| GET `/api/guest/bookings/<token>` | link holder | none | 200 `{"booking":Booking}` | not_found |
| POST `/api/guest/bookings/<token>/refund` | link holder | `{}` | as the patron refund | as the patron refund |
| POST `/api/guest/booking-links` | anyone | `{"booking_ref","email"}` | 202 `{"status":"accepted"}`, always | validation |
| POST `/api/gifts` | anyone; header `Idempotency-Key` | `{"tier","purchaser":{"name","email"},"recipient":{"name","email","locale"},"message","cardholder_name"}` | 201 `{"gift":{"ref","tier","price_cents","currency":"CAD","recipient_name","recipient_email","state":"unredeemed"}}` | stepup_required, validation, billing_unavailable |
| GET `/api/gifts/<ref>` | purchasing patron | none | 200 `{"gift":{…as above…,"state":"unredeemed"\|"redeemed","redeemed_at"}}` | not_found |
| GET `/api/gift-redemptions/<token>` | anyone | none | 200 `{"gift":{"ref","tier","from_name","message","term_months":12}}` | not_found |
| POST `/api/gift-redemptions/<token>/redeem` | patron | `{}` | 201 `{"membership":Membership,"first_invoice_cents":0}` | already_member, billing_unavailable |
| GET `/api/membership` | patron | none | 200 `{"membership":Membership\|null}` | none |
| POST `/api/membership` | patron | `{"tier","cadence"}` | 201 `{"membership":Membership,"invoice":Invoice}` | already_member, stepup_required, validation, billing_unavailable |
| POST `/api/membership/change` | patron | `{"tier","cadence"}` | 200 `{"membership":Membership,"effective":"immediate"\|"end-of-term","effective_date","invoice":Invoice\|null}` | not_member, no_change, change_pending, gift_membership_locked, stepup_required, validation, billing_unavailable |
| GET `/api/me/credit` | patron | none | 200 `{"balance_cents","movements":[{"id","kind":"goodwill"\|"spend"\|"reversal","amount_cents","reference","at"}]}`, newest first; amounts signed from the patron's side | none |
| POST `/api/stepup/start` | patron | `{"purpose":"checkout"\|"gift"\|"membership"}` | 201 `{"challenge":{"id","expires_at","delivery":"sent"\|"queued","masked_email"}}` | stepup_locked, resend_too_soon, code_send_limit, validation |
| POST `/api/stepup/resend` | patron | `{"challenge_id"}` | 200 same as start | not_found, stepup_locked, resend_too_soon, code_send_limit |
| POST `/api/stepup/verify` | patron | `{"challenge_id","code"}` | 200 `{"stepup":{"verified":true,"valid_until"}}` | not_found, stepup_locked, code_expired, code_incorrect |
| POST `/api/auth/signup` | anyone | `{"name","email","password","locale"}` | 201 `{"account":{"number","name","email","locale","role":"patron"}}`, signed in | email_taken, validation |
| POST `/api/auth/signin` | anyone | `{"email","password","next"}` | 200 `{"account":{…,"role"},"redirect":"<safe path>"}` | invalid_credentials, validation |
| POST `/api/auth/signout` | signed in | `{}` | 204 | none |
| GET `/api/me` | signed in | none | 200 `{"account":{"number","name","email","locale","role","membership":Membership\|null,"credit_balance_cents"}}` | none |
| POST `/api/enquiries` | anyone | `{"name","email","subject","message"}` | 201 `{"enquiry":{"ref","state":"open"}}` | validation |
| GET `/api/door/screenings` | door | none | 200 `{"screenings":[{"id","film_title","starts_at","auditorium"}]}` from 24 hours ago to 24 hours ahead | none |
| GET `/api/door/screenings/<id>/list` | door | none | 200 `{"screening":{"id","film_title","starts_at","auditorium"},"tickets":[DoorTicket]}` where DoorTicket has exactly the keys `ticket_code`, `seat`, `initial`, `status`, `booking_ref` | not_found |
| POST `/api/door/tickets/<code>/check-in` | door | `{}` | 200 `{"ticket":DoorTicket,"checked_in_at"}` | already_checked_in, ticket_refunded, checkin_not_open, checkin_closed |
| POST `/api/door/bookings/<ref>/check-in` | door | `{}` | 200 `{"booking_ref","checked_in":<n>,"already_checked_in":<m>,"tickets":[DoorTicket]}` | ticket_refunded (whole booking refunded), checkin_not_open, checkin_closed |
| GET `/api/programmer/seasons` | programmer | none | 200 `{"seasons":[{…season keys…,"screenings":[…]}]}`, every state | none |
| POST `/api/programmer/seasons` | programmer | `{"slug","title_en","title_fr","public_sale_date"}` | 201 `{"season":{…,"state":"draft"}}` | slug_taken, validation |
| POST `/api/programmer/seasons/<slug>/screenings` | programmer | `{"film_title","format","auditorium","first_local":"2026-10-20T19:00","weeks":4}` | 201 `{"screenings":[{"id","starts_local","starts_at"}]}` | season_closed, validation |
| POST `/api/programmer/seasons/<slug>/transition` | programmer | `{"to":"scheduled"\|"archived"\|"withdrawn","reason"}` | 200 `{"season":{…,"state"},"refunded_bookings":<n>}` | illegal_transition, season_has_future_screenings, season_empty, validation, billing_unavailable (withdrawal only) |
| GET `/api/finance/lookup?q=<query>` | finance | none | 200 `{"kind":"booking","booking":Booking,"patron":{"name","email","phone","account_number"}}`, or `{"kind":"account","account":{…/api/me account keys…},"ledger":[movements]}`, or `{"kind":"gift","gift":{…}}` | not_found |
| POST `/api/finance/bookings/<ref>/refund` | finance | `{"reason"}` | 200 as the patron refund, plus `"audit_id"` | as the patron refund, validation |
| POST `/api/finance/credits` | finance | `{"account_number","amount_cents","reason"}` | 201 `{"credit":{"account_number","amount_cents","currency":"CAD","balance_cents","movement_id","audit_id"}}` | not_found, validation, billing_unavailable |
| GET `/api/finance/audit` | finance | none | 200 `{"entries":[{"id","at","actor","action","target","amount_cents","reason"}]}`, newest first | none |
| PUT, PATCH, DELETE `/api/finance/audit/<id>` | anyone | any | never succeeds | 405 `method_not_allowed` with `Allow: GET`, after the auth checks |
| GET `/api/finance/reconciliation?date=<date>` | finance | none (no date means today in Toronto) | 200 Reconciliation (Business rules) | validation, billing_unavailable |
| GET `/api/finance/reconciliation.csv?date=<date>` | finance | none | 200 `text/csv; charset=utf-8`, `Content-Disposition: attachment; filename="halide-takings-<date>.csv"` | validation, billing_unavailable |
| POST `/api/finance/reconciliation/accept` | finance | `{"date","reason"}` | 200 Reconciliation with `"status":"accepted"` | nothing_to_accept, validation, billing_unavailable |
| GET `/api/finance/outbox` | finance | none | 200 `{"messages":[{"seq","key","kind","to","subject","enqueued_at","state":"pending"\|"sent"\|"dead","attempts":[{"started_at","finished_at","outcome":"failed"\|"sent"}]}]}`, the latest 200 in seq order | none |
| GET `/api/finance/enquiries` | finance | none | 200 `{"enquiries":[{"ref","name","email","subject","message","locale","state":"open"\|"answered","received_at"}]}` | none |
| POST `/api/finance/enquiries/<ref>/reply` | finance | `{"body"}` | 201 `{"reply":{"enquiry_ref","queued_at"},"enquiry":{"ref","state":"answered"}}` | not_found, validation |

**Validation limits.** Names are 1 to 80 characters. Email is a single address of at most 254 characters. Phone is 7 to 20 characters of digits, spaces and `+-()`. Password is 10 to 128 characters. Note is 0 to 200 characters. Cardholder name is 1 to 80 characters. Gift message is 0 to 300 characters. Subject is 1 to 120 characters. Message and reply body are 1 to 4,000 characters. Reason is 3 to 500 characters. Slug matches `^[a-z0-9]+(-[a-z0-9]+)*$` and is 3 to 40 characters long. Film title is 1 to 120 characters. Weeks is 1 to 26. `Idempotency-Key` is 8 to 128 characters of letters, digits, `-` and `_`. Enum fields accept only the values listed in Business rules. Every limit given here includes its end values.

**Field names in `fields`.** These are the request keys, using dots for nesting (`guest.email`, `fares.C3`, `split`, `uplift_cents`), plus `idempotency_key`.

**Body-less exceptions.** When a signed-in patron sends `guest` to checkout or `purchaser` to a gift purchase, the field is ignored and the account is used. Without a session, both fields are required.

### Business rules (DP-06, DP-08, DP-09, DP-11, DP-14, DP-15, DP-16, DP-20, DP-21, DP-25, DP-29, DP-30, DP-33, DP-35, DP-36, DP-37, DP-41, DP-42, DP-44, DP-45, DP-46, DP-49, DP-53, DP-56)

**Identifiers.**
- Booking ref: `HB-` plus 6 characters. Gift ref: `HG-` plus 6. Enquiry ref: `EQ-` plus 6. Ticket code: `T-` plus 8. All of these draw from the alphabet `23456789ABCDEFGHJKLMNPQRSTUVWXYZ`.
- Account number: `A-` plus six digits, assigned in order from `A-100001`.
- Hold id: a random UUID.
- Capability token: 43 base64url characters made from 32 random bytes.
- Screening id: `<season slug>-<n>`, numbered from 1 within the season in order of creation.
- Lookups and door codes are case-insensitive and trimmed.

**Enums.**
- Fares: `regular`, `reduced`, `member`, `member-guest`, `group`.
- Tiers: `friend`, `cinephile`, `projectionist`.
- Cadences: `annual`, `monthly` (`gift` appears only in output).
- Locales: `en`, `fr`.
- Formats: `35mm`, `16mm`, `DCP`.
- Auditoriums: `MH1`, `MH2`, `AC1`.
- Step-up purposes: `checkout`, `gift`, `membership`.
- Season states: `draft`, `scheduled`, `member-priority`, `on-sale`, `archived`, `withdrawn`.
- Booking states: `held`, `paid`, `checked-in`, `expired`, `refunded`.
- Ticket status: `issued`, `checked-in`, `refunded`.
- Audit actions: `refund`, `goodwill-credit`, `reconciliation-accept`, `season-withdraw`, `enquiry-reply`.

**Locale rule.** This is the one rule for every locale decision.
- The page locale is the path prefix. Loading any `/en/…` or `/fr/…` page sets the `halide_locale` cookie to that prefix.
- The request locale of an API call is the first of these that is set: a valid `X-Halide-Locale` header (`en` or `fr`; any other value is ignored); the `halide_locale` cookie; the signed-in account's locale; `en` when the first `Accept-Language` tag starts with `en`. Otherwise it is `fr`. Every API error `message` uses the request locale.
- A request for `/` (or any path without a prefix) picks its prefix with the same order, without the header.
- Records store the request locale of the call that creates them: a booking at checkout, a gift as its purchaser locale (with the recipient locale chosen in the form stored separately), an enquiry when it is sent.
- The account locale is set at sign-up and changes only through `POST /api/locale` while signed in, which the language button calls.
- Email locale: the booking confirmation, booking-link and refund emails use the booking's locale; the gift receipt uses the gift's purchaser locale; the gift-delivered email uses the recipient locale; the enquiry reply uses the enquiry's locale; the membership-started, membership-changed and step-up emails use the account locale at the moment the email is enqueued.

**Prices** (tax-exclusive admission, in cents): `regular` 1400, `reduced` 1100, `member` 1000, `member-guest` 1200, `group` 950. Membership and gift prices include tax, and the app adds no tax lines to them:

| Tier | Annual | Monthly | Member-guest allowance |
|---|---|---|---|
| friend | 6000 | 600 | 1 |
| cinephile | 12000 | 1200 | 2 |
| projectionist | 24000 | 2400 | 3 |

**Fare rules.**
- A booking with an active member's session may use `member` on at most one seat and `member-guest` on at most the tier's allowance. Every account may use `regular` and `reduced` freely.
- `group` is the only fare allowed in a group hold and is allowed nowhere else.
- Default fares: for a member, `member` on the first seat in seat order, `member-guest` on the next seats up to the allowance, then `regular`. For everyone else, `regular`.
- A fare that breaks these rules gives `validation` on `fares.<seat>`. When a fare is used on more seats than allowed, the error is on the first seat, in seat order, past the allowance (with `member`, `member`, the second seat).

**Tax and totals.**
- Admission lines group the seats by fare. A line's subtotal is quantity × unit price.
- Per line, GST = (subtotal × 5 + 50) integer-divided by 100, and QST = (subtotal × 9975 + 50000) integer-divided by 100000. That is half-up rounding to the cent, done once per line and per tax. QST is not charged on GST.
- The uplift is one untaxed amount.
- Total = Σ subtotals + Σ GST + Σ QST + uplift.
- Credit applied = min(credit balance, total). Pay now = total − credit applied.
- Every place that shows money (quote, booking, page, email, Kill Bill invoice, CSV) shows these same integers.

Worked example 1 (guest): 2 × `regular` + 1 × `reduced`, no uplift.

| Line | Subtotal | GST | QST |
|---|---|---|---|
| regular x2 | 2800 | 140 | 279 |
| reduced x1 | 1100 | 55 | 110 |

Admission 3900, GST 195, QST 389, total 4484 (`$44.84`).

Worked example 2 (member): `member` + `member-guest`, uplift 500. Member line: subtotal 1000, GST 50, QST 100. Member-guest line: subtotal 1200, GST 60, QST 120. Admission 2200, GST 110, QST 220, uplift 500, total 3030 (`$30.30`). Taxing the whole 2200 at once would give QST 219, which is wrong. Per-line rounding gives 220.
- With a credit balance of 2500: credit applied 2500, pay now 530.
- With a balance of 4000: credit applied 3030, pay now 0, and 970 remains.

**Supporter uplift.** `uplift_cents` is 0 (no uplift), a preset (200, 500 or 1000), or a custom whole number of cents from 100 to 50000 inclusive. Anything else gives `validation` on `uplift_cents` with the uplift field message. The switch starts off. Turning it on selects the 500 preset.

**Seat holds.**
- A hold is taken whole or not at all: an individual hold covers 1 to 10 seats, a group hold 10 to 40. Seats must exist in the auditorium and must not repeat.
- Holds belong to the session (account or anonymous guest cookie) that made them.
- `expires_at` = creation + `HOLD_TTL_SECONDS`. A hold is live while server time is strictly before `expires_at`. At or after that instant it is `expired` (`ended_by` `timeout`), its seats count as available, and any quote, release or checkout on it gives `hold_expired`. For example, a payment arriving one second after `expires_at` is refused.
- Release ends a live hold at once (`ended_by` `patron`). `released_amount.cents` is the total of the hold's latest quote, or 0 if it was never quoted.
- The countdown shows `expires_at` − (browser time + the offset learned from the `server_time` of the hold the checkout page loaded), rounded down to whole seconds, and refreshes each second. The offset is learned once per page load.

**Last-seat race.** Seat claims are decided in the database. Of any number of simultaneous holds or checkouts touching the same seat, exactly one wins. Each loser gets `seat_taken` listing the contested seats and changes nothing. Seats remaining = capacity − sold seats (paid or checked-in) − seats in live holds, never below 0. Refunded and expired seats are available again. The screening page refreshes the seat map every 5 seconds and right after each hold, release or checkout response. The rail refreshes seats left on load and every 15 seconds.

**Season state machine.**
- `public_opens_at` is 10:00 America/Toronto on `public_sale_date`. `priority_opens_at` is 10:00 America/Toronto three calendar days earlier. Both are wall-clock times, so the gap is 71, 72 or 73 real hours. For example, `public_sale_date` 2026-11-03 gives `priority_opens_at` 2026-10-31T10:00:00-04:00 and `public_opens_at` 2026-11-03T10:00:00-05:00, 73 hours apart.
- A season that has been scheduled is in a time-derived state: `scheduled` before `priority_opens_at`, `member-priority` from then until `public_opens_at`, and `on-sale` afterwards.
- Legal requests:
  - `draft` → `scheduled`. A season with no screenings gives `season_empty`. The resulting state is the time-derived one.
  - `on-sale` → `archived`. Any screening still to start gives `season_has_future_screenings`.
  - `scheduled` or `on-sale` → `withdrawn`. This needs a reason.
- Every other request (any request to `member-priority` or `on-sale`, anything from `archived` or `withdrawn`, withdrawing during `member-priority`, scheduling twice) gives `illegal_transition`.
- Screenings can be added in every state except `archived` and `withdrawn`, which give `season_closed`.

**Who may hold seats.**
- `on-sale`: anyone.
- `member-priority`: active members only. Others get `members_priority`.
- `scheduled`: `not_on_sale`.
- `archived` or `withdrawn`, or a screening whose start time has passed: `screening_closed`.
- `draft`: `not_found`.

**Booking state machine.**
- `held` → `paid` by checkout. `held` → `expired` by timeout, release or withdrawal (`ended_by` `season`).
- `paid` → `checked-in` when its first ticket is checked in.
- `paid` → `refunded`. This refunds every ticket.
- Illegal edges:
  - Checkout on `expired` gives `hold_expired`. On `paid` (not a replay) it gives `hold_already_paid`.
  - A refund of `held` or `expired` gives `booking_not_paid`, of `refunded` gives `already_refunded`, and of `checked-in` gives `booking_checked_in`.
  - Check-in of a refunded ticket gives `ticket_refunded`, and of a checked-in ticket gives `already_checked_in`.

**Checkout atomicity.** A booking becomes `paid` and is given its ref and tickets only in the same database commit that records a successful Kill Bill payment, or a zero pay-now invoice. The confirmation email is enqueued in that same commit. If Kill Bill fails or is unreachable at any step:
- The answer is `billing_unavailable`.
- The hold stays `held` with its original `expires_at`, and no booking, ticket, ledger movement or email exists.
- Any invoice already created is voided in Kill Bill, immediately or as soon as billing returns.
- No successful payment for that hold remains.

Simultaneous checkouts of one hold with different keys give exactly one payment. The others get `hold_already_paid`.

**Idempotency.** `POST /api/checkout` and `POST /api/gifts` require `Idempotency-Key`. Keys are stored for 24 hours together with a hash of the request body and the caller. While a key is still processing, the same key gives `idempotency_in_progress`. Once it has finished, the same key and body return the stored status and body with header `Idempotent-Replayed: true` and no new charge, ledger movement or email. The same key with a different body gives `idempotency_conflict`.

**Stored credit and step-up.**
- When an account's credit balance is above zero, its next charge (checkout, gift purchase, membership join or tier change) spends credit automatically, up to the charge.
- A session has a live verification while server time is strictly before the `valid_until` of its latest successful verify. A verification lasts `STEPUP_VALID_SECONDS` (`valid_until` = verification time + that value) and covers every charge and tier change in that session until then, whatever `purpose` started it. `purpose` names the screen that asked (`checkout`, `gift` or `membership`) and changes nothing else: the code, its email and every limit below are the same.
- An action needs step-up when it spends credit (its credit applied is above zero) or is a tier change, whatever the balance. Such an action without a live verification answers `stepup_required`. With a live verification it proceeds.
- The quote's `stepup_required` is true exactly when the quote's credit applied is above zero and the session has no live verification. Otherwise it is false. It is computed on every quote request, so a quote requested after a successful verify returns false until `valid_until` passes, and true again afterwards while credit is applied. Checkout answers `stepup_required` under exactly the same condition, judged at checkout time.
- On the membership and gift screens, the action shown needs step-up under the same rule: every tier change; a join while the credit balance is above zero; a signed-in gift purchase while the credit balance is above zero.
- Starting step-up emails a 6-digit code valid for `STEPUP_CODE_TTL_SECONDS`. The code is valid while server time is strictly before `expires_at`, and after that it gives `code_expired`. A resend replaces the code and the old code stops working.
- The first four wrong codes on a challenge give `code_incorrect` with `attempts_left` 4, 3, 2, 1. The fifth wrong code locks step-up for the account for `STEPUP_LOCKOUT_SECONDS`, answering `stepup_locked` with `Retry-After` equal to the full window. During the lockout, every start, resend and verify, even with the right code, gives `stepup_locked` with the remaining seconds, rounded up.
- Sends (starts plus resends) must be at least 30 seconds apart, or the answer is `resend_too_soon` with the remaining seconds. Each account may receive at most 4 codes within any rolling `STEPUP_LOCKOUT_SECONDS` window. The fifth gives `code_send_limit`, with Retry-After lasting until the oldest send leaves the window. When more than one limit applies, lockout is reported first, then spacing, then the send limit.
- Every step-up request answers within 5 seconds, even when mail or Kill Bill is down. The code email goes through the outbox, and `delivery` is `sent` once SMTP accepted it within that time, otherwise `queued`.

**Paired credit ledger.** Every credit movement writes exactly two rows sharing one `movement_id`, with signed amounts summing to zero:
- Goodwill issue X: `member-credit` +X and `goodwill-expense` −X.
- Spend Y (on any charge, equal to the credit Kill Bill applied to its invoice): `member-credit` −Y and `credit-redeemed` +Y.
- Re-credit on refund Z: `member-credit` +Z and `credit-redeemed` −Z (kind `reversal`).

Rows are never updated or deleted. An account's balance is the sum of its `member-credit` rows, and it always equals the Kill Bill account credit balance. Goodwill amounts run from 100 to 50000 cents inclusive. For example, a goodwill credit of 1500 to `A-100001` makes the balance 1500, and spending 1500 on a booking returns it to 0 through a second pair.

**Refunds.**
- Self-service (owner or guest link) and finance refunds are allowed only while server time is strictly before showtime − 2 hours. At or after that instant the answer is `refund_window_closed`, and only a finance goodwill credit remains.
- A refund covers the full booking. The card portion (`paid_cents`) goes back to the Kill Bill payment, and the credit portion (`credit_applied_cents`) goes back to the account credit through a reversal pair.
- The booking becomes `refunded`, its seats are available again, its guest link stops working, a refund email is enqueued, and an audit entry is written.
- Worked example: refunding worked example 2 with 2500 credit gives `refunded_cents` 530 and `recredited_cents` 2500.

**Season withdrawal.**
- Withdrawal ends every live hold of the season.
- It then refunds each `paid` booking one by one, each committed together with its Kill Bill refund, its refund email (reason line: season withdrawn) and its `refund` audit entry. Checked-in bookings are left alone.
- Once every booking is refunded, the season becomes `withdrawn`, with one `season-withdraw` audit entry whose amount is the total refunded.
- If Kill Bill fails part-way, the answer is `billing_unavailable`. The season keeps its previous state, refunds already done stay done, and repeating the request finishes the rest.

**Door check-in.** Check-in is allowed while showtime − 45 minutes ≤ server time < showtime + 30 minutes. Before that the answer is `checkin_not_open`, and from the closing instant on it is `checkin_closed`, each with the edge `<time>`. Each ticket is checked in once, decided in the database. Of simultaneous attempts from any number of devices, exactly one succeeds and the rest get `already_checked_in`. A booking-wide check-in checks in every `issued` ticket and reports how many were already checked in. Two simultaneous booking-wide check-ins together check in each ticket exactly once. The door list refreshes every 10 seconds and after every check-in.

**Door list fields.** Each ticket shows exactly `ticket_code`, `seat`, `initial`, `status` and `booking_ref`. `initial` is the first character of the booking name (guest name or account name), uppercased, followed by `.`. No other key exists, whether nested or at the top level.

**Group cost split.**
- A group checkout may include 2 to 6 payers, each with a name and 1 or more seats, and the seat counts must sum to the hold's seats.
- With T the Kill Bill invoice amount (the booking total) and S the seat count, each payer's base share = floor(T × seats ÷ S), and remainder_i = (T × seats) mod S.
- The leftover cents T − Σ base go one each to payers in order of largest remainder, ties broken by listing order.
- Worked example: 17 group seats give admission 16150, GST 808, QST 1611, total 18569. Payers with 6, 6 and 5 seats get 6554, 6554 and 5461. Listed as 5, 6, 6 they get 5461, 6554, 6554.

**Membership.**
- Plans are `<tier>-annual`, `<tier>-monthly` and `<tier>-gift`. Rank: friend < cinephile < projectionist.
- Joining with an active membership gives `already_member`.
- Changes:
  - To a higher tier: `immediate`. Kill Bill prorates, and the invoice is returned.
  - To a lower tier, or another cadence of the same tier: `end-of-term`, `effective_date` = `charged_through`, `invoice` null, and the pending change shows on the membership.
  - The same plan: `no_change`. While a change is pending: `change_pending`. On a gift plan: `gift_membership_locked`. Without a membership: `not_member`.
- Every invoice figure shown is read from Kill Bill. For example only (Kill Bill's numbers are authoritative): a `cinephile-monthly` member billed 2026-10-01 to 2026-11-01 who upgrades to `projectionist-monthly` on 2026-10-16 receives an invoice with a REPAIR_ADJ of −6.19 and a recurring item of 12.39, amount 6.20, and the app shows exactly those.

**Gifts.**
- The purchaser's Kill Bill account is charged the tier's annual price (for example 12000 for cinephile).
- Redemption needs a signed-in account without an active membership, otherwise `already_member`. It starts exactly one subscription on `<tier>-gift`, a single 12-month term at 0.00 that ends on its own. The redeemer's first invoice amount is 0.00.
- Redemption happens at most once, decided in the database. Simultaneous redeem attempts produce one 201, and every other attempt, like every later GET or POST on that token, gets `not_found`.

**Capability links.**
- A guest booking link `/<locale>/b/<token>` opens only its own booking.
- It stops working (`not_found`) when the booking is refunded or a new link is issued. After a refund made through the link, that page keeps showing the Refund done copy until the visitor leaves it.
- `POST /api/guest/booking-links` always answers 202. When the ref and email match a paid or checked-in guest booking, it creates a new token, kills the old one, and enqueues the booking-link email.
- A gift link `/<locale>/gift/<token>` stops working once the gift is redeemed.

**Ownership.** A booking, hold or gift that does not belong to the caller answers exactly like a missing one: status 404 and a byte-identical body.

**Roles.**
- `door`: `/api/door/*`.
- `programmer`: `/api/programmer/*`.
- `finance`: `/api/finance/*`.
- Patron endpoints (`/api/bookings*`, `/api/membership*`, `/api/me/credit`, `/api/stepup/*`, gift redemption) are for `patron` accounts.
- Any other signed-in role on these routes gets `forbidden`, and no session gets `unauthenticated`.

**Audit list.** One entry is written for each refund, goodwill credit, reconciliation acceptance, season withdrawal and enquiry reply. The `actor` is the acting staff member's email, except for a refund the patron made: the patron's account number, or `guest`. The fields are `id` (increasing integer), `at`, `actor`, `action`, `target` (booking ref, account number, date, season slug or enquiry ref), `amount_cents` (null for replies) and `reason` (for replies, the enquiry subject). The list is append-only. The API refuses edits, and the database refuses UPDATE and DELETE on it even through the app's own credentials.

**Reconciliation.**
- The business day for `<date>` runs from 00:00 to the next 00:00 America/Toronto, so it lasts 23, 24 or 25 hours. For example, 2026-11-01 runs from 2026-11-01T00:00:00-04:00 to 2026-11-02T00:00:00-05:00 (25 hours).
- The response is `{"date","timezone":"America/Toronto","window_start","window_end","local":{"admission_cents","gst_cents","qst_cents","uplift_cents","gift_cents","membership_cents","credit_spent_cents","refunds_cents","net_payments_cents"},"killbill":{"payments_cents","refunds_cents","net_payments_cents"},"difference_cents","status":"matched"|"mismatch"|"accepted","accepted_difference_cents":null|<int>}`.
- Local figures sum bookings paid, gifts sold and membership invoices created in the window, minus credit spent on any of them, minus card refunds in the window: net = admission + gst + qst + uplift + gift + membership − credit_spent − refunds.
- Kill Bill figures sum successful PURCHASE amounts and REFUND amounts whose effective dates fall in the window, across every account the app created. Kill Bill net = payments − refunds.
- difference = Kill Bill net − local net. Status is `matched` when difference is 0. It is `accepted` after an acceptance while the difference still equals `accepted_difference_cents`. Otherwise it is `mismatch`.
- Acceptance needs a reason and a mismatch, otherwise `nothing_to_accept`, and writes a `reconciliation-accept` entry with amount = difference.
- Worked example: a day holding only worked example 2 paid with 2500 credit gives local admission 2200, GST 110, QST 220, uplift 500, credit_spent 2500, net 530, Kill Bill payments 530, difference 0, `matched`.

**CSV.**
- UTF-8 without a byte-order mark, CRLF line endings, RFC 4180 quoting.
- Header: `kind,reference,occurred_at,patron_name,note,admission,gst,qst,uplift,gift,membership,credit_spent,paid,refunded`.
- Amounts are non-negative dollars with two decimals and a dot. Every money column a row does not use holds `0.00`.
- Rows, ordered by `occurred_at` then reference:
  - `booking` (booking ref), one per booking paid in the window: admission, gst, qst and uplift from the booking, credit_spent = credit applied, paid = admission + gst + qst + uplift − credit_spent, refunded `0.00`. `patron_name` is the booking name and `note` the booking note.
  - `gift` (gift ref), one per gift sold: gift = price, credit_spent, paid = gift − credit_spent, refunded `0.00`. `patron_name` is the purchaser name and `note` is empty.
  - `membership` (account number), one per Kill Bill membership invoice created in the window whose amount is above 0.00: membership = the invoice amount, credit_spent = its credit applied, paid = membership − credit_spent, refunded `0.00`. `patron_name` is the account name and `note` is empty. Gift-plan invoices of 0.00 and end-of-term changes produce no row.
  - `refund` (booking ref), one per refund in the window: every amount column is `0.00` except refunded = the card refund (`refunded_cents`). The re-credited portion does not appear. `patron_name` and `note` repeat the booking's.
- Σ paid − Σ refunded equals the local net.
- A `patron_name` or `note` cell that begins with `=`, `+`, `-`, `@`, a tab or a carriage return gets a leading `'`.
- Worked example rows (worked example 2 paid with 2500 credit, then refunded):
  - `booking,HB-XXXXXX,<occurred_at>,Élise Tremblay,,22.00,1.10,2.20,5.00,0.00,0.00,25.00,5.30,0.00`
  - `refund,HB-XXXXXX,<occurred_at>,Élise Tremblay,,0.00,0.00,0.00,0.00,0.00,0.00,0.00,0.00,5.30`

**Weekly slots and daylight saving.**
- `first_local` is America/Toronto wall-clock time. Occurrence n (from 0) is `first_local` + 7·n calendar days at the same wall-clock time, converted to an instant with that date's offset.
- A local time that does not exist (the spring-forward gap) moves forward one hour. A local time that occurs twice (the fall-back hour) takes the first, daylight-time occurrence.
- Worked example: `2026-10-20T19:00`, 4 weeks gives 2026-10-20T19:00:00-04:00, 2026-10-27T19:00:00-04:00, 2026-11-03T19:00:00-05:00 and 2026-11-10T19:00:00-05:00.
- `2026-11-01T01:30` gives 2026-11-01T01:30:00-04:00. `2027-03-14T02:30` gives 2027-03-14T03:30:00-04:00.
- These rules hold whatever the server's own time zone is.

**Mail outbox.**
- Every email is a row in the outbox, enqueued in the same commit as its business event, with a unique message key. A second enqueue with the same key is a no-op. Each key reaches Mailpit at most once.
- Keys:
  - `booking-confirmed:<booking ref>`
  - `booking-link:<booking ref>:<n>`
  - `booking-refunded:<booking ref>`
  - `membership-started:<account number>:<n>`
  - `membership-changed:<account number>:<n>`
  - `gift-receipt:<gift ref>`
  - `gift-delivered:<gift ref>`
  - `stepup-code:<account number>:<n>`
  - `enquiry-reply:<enquiry ref>:<n>`
  
  `<n>` counts from 1 for that record.
- Each running instance, identified by its `APP_PUBLIC_PORT`, delivers only the messages it enqueued itself. It never sends, retries or drains a message another instance enqueued, even when both share one database, and the Mail outbox table and `GET /api/finance/outbox` still list every message. Within one instance, delivery is strictly first in, first out by `enqueued_at`, with ties broken by `seq`. That instance's oldest pending message (the head) is always tried first, and nothing newer is tried or sent until the head is `sent` or `dead`.
- The head's first attempt is immediate. After a failure, the next attempts start 5, 15 and then 45 seconds after the previous failed attempt finished, then every 60 seconds. Each actual gap falls between the published delay and 3 seconds more. The order 5 → 15 → 45 is part of the contract.
- After the 20th failed attempt the message becomes `dead` and is never retried, and the next message becomes the head.
- When the mail probe turns from down to up, the head is tried at once and the backlog drains back to back, oldest first.

### Services (DP-10, DP-12, DP-27, DP-28, DP-30, DP-38, DP-50, DP-51, DP-52, DP-55, DP-60)

**Kill Bill** is the system of record for money. Use the tenant named by `KILLBILL_API_KEY`/`KILLBILL_API_SECRET`, with basic auth `KILLBILL_USERNAME`/`KILLBILL_PASSWORD`.
- **Catalogue.** At serve, upload a CAD catalogue once if it is missing, retrying every 5 seconds until it succeeds.
  - Products `Friend`, `Cinephile` and `Projectionist`.
  - Plans `<tier>-annual` (ANNUAL, in advance) and `<tier>-monthly` (MONTHLY, in advance) at the prices in Business rules, no trial.
  - `<tier>-gift`: one FIXEDTERM 12-month phase with a fixed price of 0.00.
- **Accounts.** Each patron or guest gets one CAD account when first charged. `externalKey` is the account number, or `guest-<lowercased email>` for guests. The account carries name, email, locale `en_CA` or `fr_CA` and time zone `America/Toronto`, and no bill cycle day is set, so a subscription's first invoice is the plan's full price for its first period. The default payment method is the built-in `__EXTERNAL_PAYMENT__` plugin.
- **Booking.** One invoice per paid booking with these items:
  - EXTERNAL_CHARGE `<booking ref> ADM <fare> x<quantity>` = the line subtotal.
  - TAX `<booking ref> GST <fare>` and TAX `<booking ref> QST <fare>`, one each per line.
  - EXTERNAL_CHARGE `<booking ref> UPLIFT` when the uplift is non-zero.
  
  The invoice amount equals the total. Account credit used appears as credit-applied items. When pay now is above 0 there is exactly one payment, with a PURCHASE transaction in SUCCESS for pay now. When pay now is 0 there is no payment.
- **Gift.** One invoice on the purchaser's account with EXTERNAL_CHARGE `<gift ref> GIFT <tier>` = the annual price. Account credit used appears as credit-applied items, and the remainder is paid by one PURCHASE, or there is no payment when nothing remains.
- **Refund.** A REFUND transaction on the booking's payment for `paid_cents`, plus an account credit `<booking ref> RECREDIT` for `recredited_cents` when that is non-zero.
- **Goodwill.** An account credit `GOODWILL <audit id>` of the amount.
- **Membership.** One subscription per join or redemption on the published plan. Changes use policy IMMEDIATE for upgrades and END_OF_TERM otherwise. Account credit is applied by Kill Bill to the resulting invoice, and any remainder is paid by one PURCHASE.
- **When unreachable.** Kill Bill counts as unreachable when a call fails to connect or takes longer than 10 seconds. The status flips to `billing: down` at once, and a probe every 5 seconds flips it back. While it is down:
  - Every POST and DELETE under `/api/holds`, `/api/checkout`, `/api/gifts`, the redeem endpoint, `/api/membership`, the refund endpoints, `/api/finance/credits`, the reconciliation endpoints and season withdrawal answer `billing_unavailable`.
  - Every GET of a booking, hold, membership, gift or credit balance returns the same body before, during and after the outage, with two exceptions only: a Hold's `server_time`, and the changes a hold's own timeout makes (`state` becomes `expired` and `ended_by` becomes `timeout`) once its `expires_at` passes.
  - The Service notice shows the billing notice.

**Mailpit, over SMTP** (`SMTP_HOST`, `SMTP_PORT`, no auth).
- **Sender and headers.** `From` is `MAIL_FROM` (`Halide Box Office <billetterie@halide.example>`). Every message carries a `text/plain` part with the lines below, one per line, and an optional HTML part with the same content. The header `X-Halide-Message-Key` holds the outbox key. `Message-ID` uses the domain of the `MAIL_FROM` address.
- **Locale.** Each email's locale follows the locale rule in Business rules. French uses the French subject and labels, and amounts and dates use the Feedback states placeholders. Every page link in an email uses that email's locale prefix (`/fr/…` in a French email).
- **Allowed content.** An email may contain only these identifiers: the booking ref, ticket codes, the gift ref, the enquiry ref, the account number, and the step-up code (only in the step-up email). Every link is `APP_PUBLIC_URL` followed by a path. A capability token appears only in the guest booking confirmation, the booking-link email and the gift-delivered email.
- **Forbidden content.** Apart from the `APP_PUBLIC_URL` prefix at the start of a link, which is allowed whatever host it names, no email body or header ever contains a UUID, a Kill Bill id, a session or idempotency key, a hold id, an internal host name (`killbill`, `mailpit`, `postgres`, `127.0.0.1`, `localhost`), the text `killbill`, or any credential value.

| Email (key) | To | Subject EN / FR | Body lines EN / FR |
|---|---|---|---|
| Booking confirmation | booking email | `Booking confirmed — <booking ref>` / `Réservation confirmée — <booking ref>` | `Booking reference: <booking ref>` / `Référence de réservation : …`; `Film: <film title>` / `Film : …`; `Showtime: <date> <time>` / `Séance : …`; `Venue: <auditorium name> (<code>)` / `Salle : …`; `Seats: <seats>` / `Places : …`; per ticket `Ticket <ticket code> — Seat <seat> — <fare label>` / `Billet … — Place … — …`; `Admission: <amount>` / `Entrée : …`; `GST (5%): <amount>` / `TPS (5 %) : …`; `QST (9.975%): <amount>` / `TVQ (9,975 %) : …`; when non-zero `Supporter uplift (not taxed): <amount>` / `Contribution de soutien (non taxable) : …`; when non-zero `Credit applied: <amount>` / `Crédit appliqué : …`; `Total: <amount>` / `Total : …`; `Paid today: <amount>` / `Payé aujourd'hui : …`; for groups, per payer `Share — <name>: <amount>` / `Part — <name> : …`; guests `Manage your booking: <link>` / `Gérer votre réservation : …`, accounts `View your booking: <link>` / `Voir votre réservation : …` |
| Booking link | guest email | `Your Halide booking link — <booking ref>` / `Votre lien de réservation Halide — <booking ref>` | `Manage your booking: <link>` / `Gérer votre réservation : <link>` |
| Refund | booking email | `Refund issued — <booking ref>` / `Remboursement émis — <booking ref>` | `Refunded to your card: <amount>` / `Remboursé sur votre carte : …`; when non-zero `Returned to your credit: <amount>` / `Remis en crédit : …`; `Reason: ` + `Requested by you` / `À votre demande`, `Issued by the box office` / `Émis par la billetterie`, or `Season withdrawn: <season title>` / `Saison retirée : <season title>` |
| Membership started | account email | `Your Halide membership has started` / `Votre adhésion Halide a commencé` | `Member number: <account number>` / `Numéro de membre : …`; `Tier: <tier label>` / `Palier : …`; `Billing: <cadence label>`, or for a gift `Billing: Gift, 12 months` / `Facturation : …`, or for a gift `Facturation : Cadeau, 12 mois`; `Amount charged: <amount>` (first invoice amount, `0.00` formatted for gifts) / `Montant facturé : …`; `Next billing date: <date>` or for gifts `Ends on: <date>` / `Prochaine facturation : …` or `Prend fin le : …` |
| Membership changed | account email | `Your Halide membership has changed` / `Votre adhésion Halide a été modifiée` | `From: <tier label>, <cadence label>` / `Avant : …`; `To: <tier label>, <cadence label>` / `Après : …`; `Takes effect: <date>` / `Prend effet : …`; `Prorated charge today: <amount>` (Kill Bill invoice amount, or 0 for end of term) / `Montant au prorata aujourd'hui : …` |
| Gift receipt | purchaser email | `Gift membership receipt — <gift ref>` / `Reçu d'adhésion-cadeau — <gift ref>` | `Gift reference: <gift ref>` / `Référence du cadeau : …`; `Tier: <tier label>` / `Palier : …`; `Recipient: <recipient name>` / `Destinataire : …`; `Amount charged: <amount>` / `Montant facturé : …` |
| Gift delivered | recipient email | `<purchaser name> has given you a Halide membership` / `<purchaser name> vous offre une adhésion Halide` | `Tier: <tier label>` / `Palier : …`; when given `Message: <message>` / `Message : …`; `Redeem your membership: <link>` / `Activez votre adhésion : <link>` |
| Step-up code | account email | `Your Halide verification code` / `Votre code de vérification Halide` | `Code: <6 digits>` / `Code : …`; `This code expires in <minutes> min.` / `Ce code expire dans <minutes> min.` |
| Enquiry reply | enquiry email | `Re: <subject> [<enquiry ref>]` / `Re : <subject> [<enquiry ref>]` | the reply text verbatim; `Enquiry reference: <enquiry ref>` / `Référence de la demande : …`; `— Halide Film Society box office` / `— Billetterie de la Société du film Halide` |

The mail service is down when an SMTP connection fails or takes longer than 5 seconds. A connect probe every 5 seconds sets `mail` in status. While mail is down, every action still succeeds, its email waits in the outbox, the Service notice shows the mail notice, and confirmation screens add the mail-delayed line.

**Postgres** (`DATABASE_URL`, owned by a non-superuser role) stores everything that is not money of record: venues, auditoriums and seat maps, seasons, screenings, holds, bookings, tickets, check-ins, accounts and sessions, idempotency records, the step-up state, the outbox, enquiries, and these two published tables, which tests read:
- `credit_ledger`: `movement_id`, `account_number`, `ledger_account` (`member-credit`, `goodwill-expense`, `credit-redeemed`), `amount_cents` (signed integer), `kind` (`goodwill`, `spend` or `reversal`, the movement kind the credit API reports for that movement), `reference`, `created_at`.
- `audit_log`: `id`, `at`, `actor`, `action`, `target`, `amount_cents`, `reason`. UPDATE and DELETE on it raise an error.

Schema and seed are applied idempotently every time the app serves. When the database is empty, the seed is written again.

### Seed data (DP-01, DP-06, DP-16, DP-36)

Every person, venue, film and business below is invented. D is the America/Toronto calendar date on which the app seeds an empty database. All times are Toronto wall clock.

Venues and auditoriums. Seat codes are the row letter followed by the seat number, and seat order is row then number.

| Code | Name | Venue | Rows | Seats per row | Capacity |
|---|---|---|---|---|---|
| MH1 | Salle Lumière | Maison Halide, 1450 rue de la Pellicule, Montréal | A–J | 14 | 140 |
| MH2 | Salle Nitrate | Maison Halide | A–D | 6 | 24 |
| AC1 | Studio Clark | Annexe Clark, 62 rue Argentique, Montréal | A–F | 8 | 48 |

Seasons, in stage order:

| Slug | Title EN / FR | Public sale date | State at seed | Screenings (id, film, format, auditorium, local start) |
|---|---|---|---|---|
| `nitrate-nights` | Nitrate Nights / Nuits nitrate | D − 10 | on-sale | `nitrate-nights-1` La Chambre ambre, 35mm, MH2, D+2 19:00; `nitrate-nights-2` The Lantern Keeper, 35mm, MH2, D+4 21:00; `nitrate-nights-3` Sel d'argent, 35mm, MH1, D+6 19:00 |
| `cinema-direct` | Direct Cinema Québec / Cinéma direct québécois | D + 2 | member-priority | `cinema-direct-1` Rue des Érables, 1963, 16mm, AC1, D+3 18:30; `cinema-direct-2` Les Glaneurs du fleuve, 16mm, AC1, D+5 20:00 |
| `winter-retrospective` | Winter Retrospective / Rétrospective d'hiver | D + 30 | scheduled | `winter-retrospective-1` Neige sur Verdun, DCP, MH1, D+40 19:00; `winter-retrospective-2` The Long Thaw, DCP, MH1, D+47 19:00 |
| `spring-workshop` | Spring Workshop / Atelier du printemps | D + 80 | draft | `spring-workshop-1` Atelier lumière, DCP, AC1, D+90 19:00 |

No bookings, holds, gifts, credits, enquiries or audit entries exist at start.

Accounts:

| Email | Password | Name | Role | Number | Locale |
|---|---|---|---|---|---|
| finance@halide.example | `Reel-Finance-2026!` | Noor Haddad | finance | none | fr |
| door@halide.example | `Reel-Door-2026!` | Théo Gagnon | door | none | fr |
| programmer@halide.example | `Reel-Programme-2026!` | Ines Laurin | programmer | none | en |
| elise@patrons.example | `Patron-Elise-2026!` | Élise Tremblay | patron | A-100001 | fr |
| marcus@patrons.example | `Patron-Marcus-2026!` | Marcus Bell | patron | A-100002 | en |

Neither seeded patron has a membership or credit, and neither has a Kill Bill account until first charged. Seeded passwords are stored only as hashes.

## Technical requirements

### Deployment (DP-54)

- **Runtime.** Node.js 22 LTS with npm, and TypeScript for all application and build code.
- **Run manifest.** `/app/run.json` holds string commands run from `/app`:

```json
{"_schema":"run-manifest-v1","install":"npm ci","build":"npm run build","serve":"npm run serve"}
```

- **Listening.** `serve` listens on `0.0.0.0` at port `APP_PUBLIC_PORT`, defaulting to 4173.
- **Health.** `GET /api/health` answers HTTP 200 `{"status":"ok"}` within 15 seconds of start, even when Kill Bill and mail are down.
- **Outage instances.** Extra instances may run alongside the main one, each with its own `APP_PUBLIC_PORT` and the same `DATABASE_URL`, with one dependency pointed at an unreachable address. They must start and behave as described in Services.

### Configuration and secrets (DP-55, DP-60)

The app reads these at start and never hard-codes their values:
- Services: `DATABASE_URL`, `KILLBILL_URL`, `KILLBILL_USERNAME`, `KILLBILL_PASSWORD`, `KILLBILL_API_KEY`, `KILLBILL_API_SECRET`, `SMTP_HOST`, `SMTP_PORT`, `MAIL_FROM`.
- Server: `APP_PUBLIC_PORT`, and `APP_PUBLIC_URL`, the absolute base for email links, defaulting to `http://localhost:<APP_PUBLIC_PORT>`.
- Time rules: `HOLD_TTL_SECONDS` (whole seconds, 1 to 3600, default 480), `STEPUP_CODE_TTL_SECONDS` (1 to 3600, default 600), `STEPUP_VALID_SECONDS` (1 to 3600, default 600), `STEPUP_LOCKOUT_SECONDS` (1 to 86400, default 900).

No credential, connection string or internal service URL ever appears in any response body or header, server-rendered page, built browser asset, browser request, log line sent to the browser, or email.

### Server boundary (DP-05, DP-48, DP-51, DP-55)

- **Same origin.** The API is same-origin only. A state-changing request whose `Origin` header is present and differs from the app's own origin gets `cross_origin`. No CORS headers are ever sent.
- **Bodies.** JSON bodies may be up to 16,384 bytes, and 16,384 is allowed. 16,385 or more gets `body_too_large`. A request with a non-empty body whose `Content-Type` media type is anything other than `application/json` (a `charset` parameter is allowed), or that has no `Content-Type`, gets `unsupported_media_type`. A body sent as `application/json` that does not parse as JSON gets `invalid_json`. An empty body needs no `Content-Type` and counts as `{}`.
- **What is never served.** The server serves only app routes and built assets. Source files, `.ts` files, source maps, `run.json`, `package.json`, lockfiles and dotfiles such as `/.env` all answer 404.
- **Safe paths.** A safe path is checked after one round of percent-decoding. It must start with exactly one `/`, must not start with `//` or `/\`, must contain no `\`, no control characters and no scheme, and may be at most 512 characters long.
- **Sign-in return.** Sign-in returns the safe `next`. Without one it returns `/<account locale>/account` for patrons and `/<account locale>/staff` for staff.
- **Locale route.** `GET /locale/<en|fr>?next=<path>` sets the locale cookie and answers 303 with a relative `Location`. A safe `next` gets its `/en/` or `/fr/` prefix swapped to the chosen locale, and the prefix is added when it is missing. An unsafe or missing `next` sends the browser to `/<locale>/`.
- **Dependencies at boot.** When Kill Bill or mail is unreachable at boot, the app still starts, serves pages and health, reports the service down, and recovers within 10 seconds of the service returning without a restart, as described in Services. Postgres is required: until it is reachable the app retries every 2 seconds and health answers `starting`.

### Browser support and performance (DP-57, DP-58)

- **Browsers.** Current Chromium, Firefox and Safari, at the viewports 375x812, 768x1024 and 1280x800.
- **Programme stage.** The stage is drawn and its tabs respond within three seconds of navigation at 1280x800.
- **Responsiveness.** Price quotes update within one second. Stage attributes update within 100 milliseconds of scrolling settling.
- **Fonts.** Self-hosted. Text stays readable while they load.

## Working rules

- IF-01: `/app/run.json` exists and is exactly one JSON object with string keys `_schema` (value `run-manifest-v1`), `install`, `build` and `serve`, and no other keys.
- IF-02: `/app/THIRD_PARTY_NOTICES.md` has one entry per shipped package (the production tree from `npm ls --omit=dev --all --json`, including the database driver) and per bundled font. Each entry gives the name, exact version and SPDX licence identifier.
- IF-03: Every shipped package and font is licensed under MIT, ISC, BSD-2-Clause, BSD-3-Clause, Apache-2.0, 0BSD or OFL-1.1.
- IF-04: All application, build and tooling code is TypeScript. No `.js`, `.mjs`, `.cjs` or `.jsx` file exists anywhere under `/app` outside `/app/node_modules/` and the build output `/app/dist/`. Use `.ts` or `.tsx` instead.
- IF-05: No extra datastore. `package.json` dependencies include none of `sqlite3`, `better-sqlite3`, `redis`, `ioredis`, `mongodb`, `mongoose`, `lowdb`, `nedb`, `level`, and no `*.db` or `*.sqlite` file exists under `/app`.
- IF-06: No file under `/app/dist/` references `fonts.googleapis.com`, `fonts.gstatic.com`, `cdn.jsdelivr.net`, `unpkg.com` or `cdnjs.cloudflare.com`.

## Engineering standards

- The code is idiomatic, strict TypeScript, with no `any` in application code and no suppressed type errors.
- Names in code match the domain terms of this brief: season, screening, hold, booking, ticket, fare, uplift, goodwill credit, step-up, outbox, door list, reconciliation.
- Each domain rule is decided in exactly one place in the source, including: per-line tax, the cost split, the season state derivation, the refund cutoff, the check-in window, hold liveness, the step-up requirement, the safe-path check, the locale rule and the retry schedule.
- Money is integer cents end to end. No floating-point arithmetic touches an amount.
- No abstraction has a single implementation, and there are no defensive checks for impossible states.
- No dead, commented-out or unreachable code, and no features, endpoints or flags beyond this brief.
- One error shape and one error catalogue are used for every API error.
