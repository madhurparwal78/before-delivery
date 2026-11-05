# Keel & Bell Bellroll

Bellroll runs rent-to-own school instrument rentals for Keel & Bell Music. Keel & Bell is an independent music store that rents serialized student flutes, clarinets, trumpets, violins and cellos to families through partner school band and orchestra programs. Four people use Bellroll:

- The store owner runs the fleet, contracts, billing, payment reversals, price lists and buyouts.
- Parents reserve an instrument, sign the rental agreement, watch equity build and decide when to buy out.
- Band directors check which students have an instrument and when it arrives.
- The repair tech records instrument condition with photos.

The app keeps its records in Postgres. Each contract that goes active gets a Kill Bill account. Kill Bill records every payment, every refund for a reversed payment and every buyout charge, and it confirms every subscription cancellation. Mailpit receives signing links, receipts, reversal notices, ownership letters and delivery-day notices. MinIO stores signed agreement PDFs, bills of sale and condition photos. In the browser, motion runs on the Motion animation library and the instrument model on the contract sheet is drawn in 3D with three.js.

The following are out of scope:

- self-registration and password reset (every person is seeded)
- card capture
- a real e-signature provider
- school-year (non-equity) rental plans
- partial refunds, late fees, accessories and repairs billing
- any datastore other than those four services
- any page beyond those described here

## Problem and users

Every August and September an independent music store hands out hundreds of serialized instruments in a few weeks. Most go out on rent-to-own contracts. Each month's base rent adds equity toward a published purchase price. An early buyout takes a stepped discount off the remaining balance, and the discount shrinks as the contract ages. Stores run all of this on ageing point-of-sale add-ons and spreadsheets.

Things go wrong in predictable ways:

- On back-to-school night the last half-size cello is promised to two families, and the second family finds out only after pressing Reserve.
- Equity disappears when a child moves up a violin size.
- Payoff quotes are worked out by hand, sales tax is added or forgotten, and parents dispute the result.
- A returned check gets "fixed" by editing the spreadsheet, so nobody can say what the equity really is.
- A crashed register charges a family twice.
- Families pay off an instrument and never receive a bill of sale.
- Billing dates drift at the end of the month.
- Nobody can say who moved a contract, or when.
- Band directors phone the store to ask about deliveries. In the week the clocks change, half the reservations land on the wrong delivery day. A parent whose phone clock is wrong thinks the cutoff hasn't passed yet.

The owner pays for all of this in refunds, written-off instruments, hours of reconciliation, and families who quit the program without knowing how close they were to owning the instrument.

- **Store owner** (daily) runs the fleet, contracts, billing, reversals, price lists and buyouts for every partner school, often from a phone at the counter. The goal is never to assign one serial number twice or miscount equity, and to settle any dispute from the contract's own history and ledger.
- **Parent** (weekly) reserves the right instrument and size, signs the agreement, watches equity build across the family's contracts and decides when a buyout is worth it. Parents mostly use a phone, and the phone's clock and time zone may be wrong by hours.
- **Band director** (weekly) checks, usually on a phone on delivery day, which students on the school roster have an instrument, how many are still waiting, and each student's delivery status.
- **Repair tech** (daily) records condition with photos at check-out, exchange and return, so damage and wear can be traced to the right contract.

## Journeys

1. **Back-to-school night reservation.**
   - A parent signs in and sees their children and the family totals on My family.
   - They open Reserve an instrument and choose a child, then Cello, then the 1/2 size (one available), and decide on the waiver.
   - The page shows which delivery day the reservation will make by the store's cutoff. If the cutoff passes while the page is open, the line moves to the next delivery day by itself, whatever the parent's phone clock says.
   - While they decide, another family takes the last 1/2 cello. Within a few seconds the parent's size picker shows the 1/2 as gone, selects the 3/4 instead and says so, without losing the child, the waiver choice or their place on the page.
   - They press Reserve instrument. Bellroll shows the assigned serial, the hold deadline and the school delivery day.
2. **Agreement out, signed and activated.**
   - The owner opens the reserved contract from the fleet register. The register row grows into the contract sheet's header. The owner presses Send signing link.
   - The parent opens the emailed link without signing in. The page says how long the link works, and the parent reads the terms, types their full legal name, ticks the agreement box and signs, all from the keyboard. If the parent leaves the page open past the link's expiry, the form is replaced with the expired message.
   - On the contract sheet, the owner sees the contract as signed with the agreement PDF linked, and presses Activate contract. On a slow connection the owner presses it twice.
   - The sheet shows the contract as active with its monthly invoice and next billing date. There is exactly one billing account, and the contract history shows each step with who made it and when.
3. **Monthly payment and a bounced check.**
   - On an active contract, the owner opens Record payment, enters the amount and saves.
   - The sheet shows how the payment split into rent toward ownership, waiver and tax. Equity and the ledger update, and the parent gets one receipt email with a link to the contract. The owner's flaky connection retries the same payment several times, and a register crash left a charge in billing from an earlier attempt. Nothing is charged twice.
   - A week later the check bounces. The owner presses Reverse on that payment in the equity ledger and chooses Returned check.
   - The payment is refunded in billing, a reversal line removes exactly the rent part it had added, the rail and family totals fall back, and the parent gets a reversal notice. Nothing is edited.
4. **Moving up a size.**
   - A child outgrows a 1/4 violin. The repair tech records an exchange condition check with photos on the old contract.
   - The owner opens Exchange size, picks 1/2 and confirms.
   - Billing confirms that the old subscription is cancelled. The owner lands on the new contract, which carries the same equity and the same billing day. The old contract shows as exchanged with a paired ledger entry.
   - The family's equity total on My family is unchanged.
5. **Deciding when to buy.**
   - A parent opens the receipt link on their phone while signed out. After signing in they land on that contract sheet, at the month the link named.
   - They turn the 3D model of their child's cello with a finger, then drag the Buyout Rail across the contract's months, or step it with the arrow keys. The brass band inside the model and the brass gauge beside it rise and fall, the payoff figure rolls to each new value, and the tier label changes at each tier boundary. On release the handle springs onto its notch and they see when the quote expires. A vertical swipe over the rail still scrolls the page.
   - The Buy out button shows today's payoff plus sales tax. They press it and confirm.
   - The contract shows Owned with a downloadable bill of sale, and an ownership letter arrives for the amount actually charged.
6. **New season prices, and a mistake undone.**
   - The owner publishes a new price list, tax rate and discount schedule effective today. A first attempt with a tax rate typed wrongly and a tier gap is refused, with each field marked and focus on the first one.
   - Existing contracts keep their original rent, payoff and term, but their invoices take the new tax rate. A contract signed after publication also uses the new rents.
   - Late one evening the owner publishes a version for next month with a typo, notices it, and withdraws it before it takes effect. Every date's price list is exactly as it was before.
7. **Delivery day.**
   - A band director signs in on a phone. The navigation is folded behind a Menu button. The roster fits the phone's width with only the columns that matter there, and opens with the summary ("<k> of <total> students have an instrument"). Each status shows as a word with its own icon, with no family or money details. The director downloads the roster CSV.
   - The owner, on the Schools page, picks one of the school's next delivery days, each showing its cutoff in store time even across the autumn clock change. If the chosen day's cutoff passes while the page is open, the list refreshes, the passed day is cleared with a message, and other schools' choices stay. The owner sends the notice, and the director receives an email that lists students and instruments only.
8. **Condition at the counter.**
   - At check-out the repair tech opens the contract sheet, presses Record condition, chooses Check-out, adds notes and three photos, and saves. The check appears in the condition history with server-processed photos that only the store and that family can open.
   - A batch containing one photo of the wrong type is refused. The dialog names that file, keeps every photo the tech chose, and puts focus on that file's Remove button. Nothing from the batch is stored until the batch is fixed and saved again.

## Mandatory requirements

This is the complete list of mandatory requirements; every check traces to one of these lines and the detailed sections below.

- **DP-01 — Reserve from live availability** A parent reserves an instrument type and size for their own child, and the server assigns the available serial that sorts first and places a hold, as qualified in Business rules.
- **DP-02 — One winner for the last unit** When several reservations race for the last available unit of a type and size, exactly one succeeds and every other gets the unavailable answer with alternatives, and no serial is ever on two open contracts.
- **DP-03 — Delivery day by store cutoff** Each reservation's delivery day is its school's next delivery day whose cutoff in the store's time zone is later than the server's clock when the reservation arrives, whatever the device clock or zone says.
- **DP-04 — Reserving from the size picker** A parent picks a child, instrument and size with keyboard or pointer, reserves, and sees the serial, hold deadline and delivery day, or the unavailable message with alternatives they can choose straight away.
- **DP-05 — Send the signing link** The store owner sends a signing link for a reserved contract, the parent receives it by email, and sending again replaces the earlier link.
- **DP-06 — Signing link limits** A signing link opens only its own agreement and stops working once signed, after its lifetime, when its hold expires, when revoked, or when replaced.
- **DP-07 — Sign and store the agreement** Signing through a live link stores the signed agreement PDF in object storage, binds the contract to the price list in force that day and moves it to signed, or changes nothing when storage is unreachable.
- **DP-08 — Signing by keyboard** A parent can read, fill and sign the agreement page using only the keyboard, with visible focus and the outcome announced.
- **DP-09 — Activate exactly once with the stored agreement** The store owner activates a signed contract only when its signed PDF is in object storage, and however many activation requests arrive at once exactly one succeeds, with one Kill Bill account, one monthly subscription and one history entry.
- **DP-10 — Monthly invoice in exact cents** Each contract's monthly invoice lists its signed base rent, the optional waiver and sales tax at the rate in force on its billing date, in exact cents with the published rounding rule.
- **DP-11 — Payments reach Kill Bill before equity** A recorded payment becomes a Kill Bill purchase on the contract's account before any equity is credited, and a receipt email follows.
- **DP-12 — Exact payment split** Every payment is split into base rent, waiver and tax by the published rule at the tax rate in force on the day it is charged, and the three parts always add up to the amount charged.
- **DP-13 — Payment retries are safe** Repeating a payment with the same idempotency key, including several copies sent at once, gives one Kill Bill charge, one ledger entry and one receipt with every copy getting the first answer, and reusing a key with a different amount is rejected.
- **DP-14 — Simultaneous money actions never overshoot** Simultaneous money and state actions on one contract are taken one at a time, so equity never passes the purchase price and a payment that would pass it is refused before any Kill Bill charge.
- **DP-15 — Recording a payment from the contract sheet** The store owner records a payment in a dialog and sees the split, the new equity and the receipt notice on the contract sheet.
- **DP-16 — Size exchange moves equity in a pair** Exchanging an active violin or cello for a larger size closes the old contract and opens exactly one successor with a paired debit and credit that conserve total equity, even when the request arrives several times at once with one idempotency key.
- **DP-17 — Exchanging a size from the contract sheet** The store owner picks the new size in a dialog and lands on the successor contract showing the carried equity.
- **DP-18 — Payoff quote for any month** The server quotes equity, discount tier, payoff, sales tax and total for any month from 0 to the term length of a signed or active contract.
- **DP-19 — All-or-nothing buyout** A buyout charges the current payoff plus sales tax in Kill Bill, closes the contract as owned, closes its equity ledger and queues the ownership letter, or does none of these, as qualified in Business rules.
- **DP-20 — Buyout Rail** The contract sheet's rail moves one month per step by drag, tap or keys, fills the instrument model's brass band and the equity gauge in proportion to equity, swaps the tier label and shows the server's payoff for that month.
- **DP-21 — Buyout Rail with reduced motion** With reduced motion requested, the rail is a plain range slider beside a month-by-month table and every value changes without animation.
- **DP-22 — Buying out from the rail** A parent or the owner confirms a buyout for the payoff plus tax from the contract sheet and sees the contract turn owned.
- **DP-23 — Effective-dated price lists** The store owner publishes a price list with rents, sales tax rate and discount schedule effective today or later, and the version in force on any date follows the published rule.
- **DP-24 — Contracts keep their signed terms** Every surface of a signed contract uses the rent, waiver, purchase price, term and tiers it was signed under, while sales tax follows the rate in force on the billing date or the day charged, as qualified in Business rules.
- **DP-25 — Withdrawing a scheduled price list** The store owner can withdraw a price list only while its effective date is later than the store's today, and afterwards the version in force on every date and every unsigned reservation's terms are exactly what they were before it was published.
- **DP-26 — Managing price lists on screen** The store owner fills in the new price list form, sees every version labelled with its standing, and withdraws a scheduled one after confirming.
- **DP-27 — Fleet and student intake** The store owner adds serialized instruments and students, and the numbered fleet register lists every instrument with its status.
- **DP-28 — Director roster limited to school and fields** A band director sees only their own school's roster, with only the published student, instrument and delivery fields.
- **DP-29 — Roster summary equals its rows** The roster's count of students per delivery status always equals the tally of its rows at request time, including holds that lapsed on their own and size exchanges.
- **DP-30 — Roster CSV export** The roster CSV export holds the same rows as the roster and neutralises any cell beginning with a formula character.
- **DP-31 — Checking the roster before delivery day** A band director signs in, sees the roster summary and each student's instrument and delivery status as a word with its own icon in text meeting 4.5:1 contrast, and downloads the CSV.
- **DP-32 — Delivery days across daylight saving** Each school lists its next four delivery days, each with its cutoff at the same store wall-clock time on the day before, including across a daylight-saving change, and a delivery day leaves the list at its exact cutoff instant.
- **DP-33 — Delivery-day notice** The store owner sends a school's band director an email for one of its upcoming delivery days, listing only the students, instruments and serials on that day's manifest.
- **DP-34 — Condition photos judged by content** Condition photos are accepted only as JPEG, PNG or WebP images within the published limits, judged by their content, then re-encoded and stored under server-chosen names.
- **DP-35 — Condition upload is all or nothing** A condition check stores its event and every photo together or nothing at all, so a contract's stored condition photos always equal the photos of its recorded checks.
- **DP-36 — Recording condition at the counter** The repair tech records a check-out, exchange or return condition check with photos and sees it in the contract's condition history.
- **DP-37 — Families reach only their own contracts** A parent can reach contracts, statements, quotes, invoices, photos, agreements and bills of sale only for their own children, and any other ID answers 404.
- **DP-38 — Family totals stay with the family** My family's totals are computed at request time from the parent's own children only, follow lapsed holds, payoffs and reversals, and stay unchanged by other families' activity and by the family's own size exchanges.
- **DP-39 — Family overview** A parent sees each child with their contracts, equity and status, plus the family totals, and can reach reservation and the contract sheet from there.
- **DP-40 — Equity statement equals its ledger** A contract's equity always equals the sum of its ledger entries, which are never edited or deleted, and corrections are new reversal entries.
- **DP-41 — Contract state machine** Contracts move only along the published states, and every other move answers 409 with the instrument, ledger and history unchanged.
- **DP-42 — Unsigned holds expire** A reservation not signed by its hold deadline counts as expired from that deadline on every surface and releases its instrument, with no request needed to trigger it.
- **DP-43 — Attributed contract history** Every contract state move appends exactly one history entry naming its actor and time, a lapsed hold is recorded once by the system at its exact deadline, and rejected moves record nothing.
- **DP-44 — Sign-in and roles** Seeded staff, parents and directors sign in with email and password, and each endpoint is open only to the roles the API lists.
- **DP-45 — One error order and shape** Every error uses one JSON shape and the API applies one published precedence order.
- **DP-46 — Billing and storage outages** When Kill Bill or object storage is unreachable, every action that needs it answers 503 with nothing changed in any system and the screen says so, as qualified in Services.
- **DP-47 — Controlled server clock** When BELLROLL_CLOCK_START is set, every server time rule, including the store's today, reads one clock that starts at that instant when the app starts and advances in real time.
- **DP-48 — Run manifest and health** The app installs, builds and serves from its run manifest on the published port and answers the health check.
- **DP-49 — Server boundary** The server enforces same-origin requests and body limits and never serves source files or credentials.
- **DP-50 — Layout at three viewports** Every screen fits 375 by 812, 768 by 1024 and 1280 by 800 without horizontal scrolling, with tap targets at least 44 pixels.
- **DP-51 — Keyboard and visible focus** Every action works from the keyboard with a visible focus ring, and dialogs keep Tab inside, close on Escape and return focus to their opener.
- **DP-52 — Motion vocabulary** Motion uses the three published speeds, has no unnamed looping decoration, and stops entirely when reduced motion is requested.
- **DP-53 — Catalogued register look** Screens read as a numbered museum register on cream paper, with ink text, hairline rules, a single brass accent reserved for equity and ownership, and procedural instrument models drawn in ink.
- **DP-54 — Credentials from environment** Every service URL and credential is read from the environment at start and never hard-coded or sent to the browser.
- **DP-55 — Payment reversals** The store owner reverses a recorded payment on an active contract with one Kill Bill refund on the original payment and one reversal ledger entry of exactly its stored base part, at most once per payment, with retries handled like payments.
- **DP-56 — Reversing a payment from the contract sheet** The store owner reverses a payment from the equity ledger in a dialog with a reason and sees the payment marked reversed, the reduced equity and the refreshed Buyout Rail.
- **DP-57 — Bill of sale at payoff** Every move to paid off stores a bill of sale PDF that the owner and the family can download, so the bill of sale exists exactly when the contract is paid off and a refused payoff leaves no object and no new Kill Bill transaction, and a failed payoff leaves no object, while a Kill Bill charge it had already confirmed stays and is adopted on retry.
- **DP-58 — Billing anniversary dates** Each active contract's billing dates are its activation store date plus whole months with the day clamped to month end, each computed from the anchor, and a size-exchange successor keeps its predecessor's anchor.
- **DP-59 — Exact starting state** However many app instances start at once against one database, schema and seed are applied exactly once and new contract IDs come from one sequence starting at C-1004 without collisions.
- **DP-60 — Live size availability on Reserve** While the Reserve page is open, its size counts follow the server within 6 seconds without a reload, keeping the parent's choices and focus, and a selected size that runs out moves to the first available size of that instrument in size order with the published announcement.
- **DP-61 — Delivery line follows the server's cutoff** The Reserve page's delivery line switches to the next delivery day within 2 seconds after the chosen school's cutoff passes on the server's clock, whatever the device clock or zone says.
- **DP-62 — Signing page expires in place** An open signing page shows its link expiry and replaces the signing form with the expired message within 2 seconds after the link expires on the server's clock, whatever the device clock says.
- **DP-63 — Exact width bands** Layout changes only at the published width bands, and the roster and fleet register show exactly the published columns in each band, with hidden columns absent from the page and the accessibility tree.
- **DP-64 — Delivery-day picker survives its cutoff** When a listed delivery day's cutoff passes with the Schools page open, that school's delivery days refresh in place within 2 seconds, still-valid selections stay, and a passed selection is cleared with the published message.
- **DP-65 — Refused photo named and batch kept** When one photo in a condition batch is refused, the API names its position, and the dialog names the file, keeps every chosen photo and moves focus to that photo's Remove button.
- **DP-66 — Return to the requested page after sign-in** A signed-out visitor to a signed-in page lands back on that exact page and query after signing in when it is a same-site path open to their role, and otherwise on their role's home.
- **DP-67 — Closing confirmed by Kill Bill** Return, write-off, exchange and payoff commit only after Kill Bill reads the contract's subscription back as cancelled, and otherwise answer 503 with nothing changed in Bellroll.
- **DP-68 — Adopting an interrupted Kill Bill transaction** Before any charge or refund the server looks up its published external key in Kill Bill and adopts a successful transaction of the same amount instead of charging again, while a different amount is refused with nothing written.
- **DP-69 — Buyout Rail by touch** On a phone, a horizontal finger drag or a tap on a notch moves the rail month by month, a vertical swipe over the rail scrolls the page and leaves the month unchanged, and the handle is at least 44 by 44 pixels.
- **DP-70 — Collapsed menu is unavailable** In the narrow band the main navigation sits behind a Menu button, and while collapsed its links are neither reachable by Tab nor present in the accessibility tree.
- **DP-71 — Form errors on their fields** A refused price list, instrument or student form reports every invalid field at once, each message is tied to its field, and focus moves to the first invalid field.
- **DP-72 — Motion choreography** The rail handle settles with a measured spring, dialogs rise in and leave on time, the register row grows into the contract header, and figures roll to their exact values, each within its published speed and instant under reduced motion.
- **DP-73 — Turnable 3D instrument model** The contract sheet shows a WebGL model of the instrument with a brass band at the equity fraction, which drag and arrow keys turn in published steps, which never moves at idle, and which falls back to the flat drawing without WebGL.
- **DP-74 — Motion and 3D libraries** The browser animates with the Motion library and draws the instrument model with three.js, with no other animation or 3D engine.

## Frontend

### Screens and layout (DP-04, DP-15, DP-17, DP-22, DP-26, DP-27, DP-31, DP-36, DP-39, DP-50, DP-63, DP-66, DP-70, DP-73)

Every screen except Sign in and the signing page has a top bar with the Keel & Bell wordmark, the role's navigation and Sign out. Every date and date-time shown anywhere is in the store's time zone, whatever the browser's zone or clock, using the formats in Business rules.

**Width bands.** Layout follows three bands of viewport width, and changes only at their edges:

- **narrow:** 0 to 639 pixels
- **medium:** 640 to 1023 pixels
- **wide:** 1024 pixels and up

The published viewports 375x812, 768x1024 and 1280x800 fall into narrow, medium and wide. No other breakpoint changes which layout a width gets. No screen scrolls sideways in any band. A column or control that a band hides is removed from the page and from the accessibility tree, never clipped, covered or moved off-screen.

Routes:

- **Sign in** (`/`, optionally `/?next=<path>`): an email and password form. A signed-in visitor goes straight on, as described under Sign-in landing in Business rules. Role homes:
  - owner and tech: `/register`
  - parent: `/family`
  - director: `/roster`
- **Fleet register** (`/register`, owner and tech): every instrument as a numbered entry with index number, serial, instrument label, size, model, the school of its current contract, and status. An entry with a contract links to that contract's sheet. The owner also gets Add instrument and Add student.
  - narrow: a list of stacked numbered entries. The first line holds the index and serial, the second the instrument label and status.
  - medium: a table with the columns No., Serial, Instrument, Size, School and Status (no Model).
  - wide: a table with all seven columns.
- **Contract sheet** (`/contracts/<contract id>`; owner, tech, and parent for their own children): the contract header shows the contract ID, instrument label, serial, student, school and status. On the left is the instrument drawing group: the turnable 3D model, with a slim brass equity gauge beside it.
  - **Owner and parent.** On the right, in this order:
    1. the terms (price list ID, monthly rent, waiver, today's sales tax rate, purchase price, term, discount tiers, billing anchor and next billing date)
    2. the monthly invoice
    3. the equity ledger
    4. the agreement PDF link and, on a paid-off contract, the bill of sale link
    5. the contract history
    6. the condition history

    The owner also sees the signing link state and the Reverse buttons in the equity ledger. Below both columns runs the full-width Buyout Rail, shown only on signed and active contracts. A paid-off contract shows the model's band and the gauge full, and the word "Owned" in place of the rail.
  - **Tech.** The tech's sheet shows only the header, the model without its brass band and without the gauge, the condition history and Record condition. The tech never sees the Terms region, the monthly invoice, the equity ledger, the contract history, the signing link state, the agreement or bill of sale links, or the Buyout Rail.
  - **Actions and loading.** Action buttons appear only for the roles and states where the action is legal. The sheet reloads the contract on page load and after every action taken on it.
  - **Not found.** An unknown contract ID, or one the caller may not see, shows only `heading "Contract not found"` and a link home (see Public screens and controls). The page shows no other contract data.
  - **Bands:**
    - narrow: one column. The drawing group sits above the terms at about a third of the screen's height, and the rail spans the full width. The invoice, ledger and history tables keep their table roles and names, but each row is laid out as stacked label and value lines.
    - medium: two columns, with the drawing column narrower than the terms column.
    - wide: two even columns with the rail below them.
- **My family** (`/family`, parent): a totals line at the top (equity across open contracts in brass, and the owned count), then one section per child. Each section shows the child's school and current and past contracts (instrument label, serial, status, equity). It also offers Reserve an instrument for any child without an open contract. Totals and sections load on page load.
- **Reserve** (`/reserve`, parent): student, instrument and size pickers, the waiver choice, the terms in force today, the delivery-day line and Reserve instrument. `?student=<student id>` preselects a child. Sizes and the delivery line stay live, as described in Interactions.
- **Signing page** (`/sign/<token>`, no sign-in): the agreement text with the student, instrument, serial and terms, then the link expiry line, then the signing form.
- **Price lists** (`/price-lists`, owner): every version with its effective date, tax rate, rents, tiers and standing, a Withdraw button on each scheduled row, and the New price list form. Standings are computed when the page loads and after each publish or withdrawal. The form opens filled with the values and tiers of the version in force today, with Effective date empty.
- **Schools** (`/schools`, owner): one section per school. Each section has the school's delivery weekday, its roster summary, a View roster link, and the delivery-notice form listing the school's upcoming delivery days with their cutoffs. The page loads on page load, after each notice is sent, and at each cutoff as described in Interactions.
- **Roster** (`/roster` for the director; `/roster?school=<school id>` for the owner): the next delivery day, the roster summary, the school roster table and Download roster CSV. Everything loads on page load. Every band shows every row, the summary line, the summary list and the CSV link. Columns by band:
  - narrow: Student, Instrument, Serial, Status
  - medium: Student, Instrument, Size, Serial, Delivery day, Status
  - wide: Student, Grade, Instrument, Size, Serial, Delivery day, Status
- **Navigation by band.** In narrow, the role's navigation links and Sign out sit behind a Menu button in the top bar. In medium and wide there is no Menu button, and the links and Sign out are always shown.

### Public screens and controls (DP-04, DP-08, DP-15, DP-17, DP-20, DP-22, DP-26, DP-27, DP-29, DP-31, DP-32, DP-36, DP-38, DP-39, DP-43, DP-44, DP-56, DP-57, DP-58, DP-60, DP-62, DP-63, DP-64, DP-65, DP-66, DP-70, DP-71, DP-72, DP-73)

Only these roles and names are public; everything else is up to you. `<size>` and `<instrument>` follow the Formats rule in Business rules. Status copy is owned by Feedback states.

| Screen | Role and accessible name | Visible copy / notes |
|---|---|---|
| All signed-in | `navigation "Main"` | Links: owner "Register", "Price lists", "Schools"; tech "Register"; parent "My family"; director "Roster" |
| All signed-in | `button "Sign out"` | "Sign out" |
| All signed-in (narrow only) | `button "Menu"` with `aria-expanded` "false" or "true" | Controls the navigation links and Sign out |
| Sign in | `textbox "Email"`, `textbox "Password"`, `button "Sign in"`, `status "Sign-in status"` | Heading "Keel & Bell rentals" |
| Register (medium, wide) | `table "Fleet register"`, columns per band from Screens and layout | Each serial that has a contract is a `link "<serial>"` |
| Register (narrow) | `list "Fleet register"`, one `listitem` per instrument | Same `link "<serial>"` |
| Register (owner) | `button "Add instrument"` opens `dialog "Add instrument"` with `textbox "Serial"`, `combobox "Instrument"`, `combobox "Size"`, `textbox "Model"`, `button "Save instrument"`, `button "Cancel"` | |
| Register (owner) | `button "Add student"` opens `dialog "Add student"` with `combobox "Family"`, `combobox "School"`, `textbox "Student name"`, `textbox "Grade"`, `button "Save student"`, `button "Cancel"` | |
| Register | `status "Register status"` | |
| Contract sheet | `group "Contract header"` holding `heading` level 1 | Heading "<contract id> · <instrument label> <serial>" |
| Contract not found | `heading "Contract not found"`, then `link "My family"` for a parent or `link "Back to the register"` for owner and tech | |
| Contract sheet (owner, parent) | `region "Terms"` | Includes "Billing anchor <date>" and "Next billing <date>" on active contracts |
| Contract sheet (owner, parent) | `table "Monthly invoice"` | Caption "Due <billing date>" on an active contract, otherwise "Not billing" |
| Contract sheet (owner, parent) | `table "Equity ledger"` with columns "Date", "Entry", "Amount", "Equity after" | Entry words are in Business rules. A reversed payment's Entry ends with " (reversed)" |
| Contract sheet (owner, parent) | `link "Signed agreement (PDF)"` | |
| Contract sheet (owner, parent; paid-off only) | `link "Bill of sale (PDF)"` | Opens the bill-of-sale download |
| Contract sheet (owner, parent) | `list "Contract history"` | One item per history entry, oldest first, worded as in Business rules |
| Contract sheet (owner, tech, parent) | `list "Condition history"` | |
| Contract sheet | `status "Contract status"` | Announces every contract action |
| Contract sheet (owner) | `button "Send signing link"`, `button "Revoke signing link"`, `button "Activate contract"`, `button "Record payment"`, `button "Exchange size"`, `button "Mark returned"`, `button "Write off"` | Each is shown only when that action is legal |
| Contract sheet (owner) | `dialog "Record payment"` with `textbox "Amount"`, `button "Save payment"`, `button "Cancel"` | Amount in dollars, for example "58.46" |
| Contract sheet (owner, active contracts) | `button "Reverse <payment id>"` on each unreversed payment row of the equity ledger. It opens `dialog "Reverse payment"` with `radiogroup "Reason"` (radios "Returned check", "Chargeback", "Entered in error"), `button "Confirm reversal"` and `button "Cancel"` | Dialog text "Refund $<amount> and remove $<base part> of equity from <contract id>?" |
| Contract sheet (owner) | `dialog "Exchange size"` with `radiogroup "New size"`, `button "Confirm exchange"`, `button "Cancel"` | Radios named "<size>, <n> available" |
| Contract sheet (owner) | `dialog "Confirm write-off"` and `dialog "Confirm return"`, each with `button "Confirm"` and `button "Cancel"` | |
| Contract sheet (owner, parent) | `button "Buy out for $<total>"` opens `dialog "Confirm buyout"` with `button "Confirm buyout"` and `button "Cancel"` | `<total>` is the current month's quote `total_cents`. Dialog text: "Pay $<total> now ($<payoff> plus $<tax> tax) and own <serial>. <tier label> applies." with the current month's payoff, tax and tier |
| Contract sheet (owner, tech) | `button "Record condition"` opens `dialog "Record condition"` with `radiogroup "Condition check"` (radios "Check-out", "Exchange", "Return"), `textbox "Notes"`, a file input labelled "Photos", one thumbnail and `button "Remove <file name>"` per chosen photo, `status "Condition status"`, `button "Save condition"` and `button "Cancel"` | A refused photo's thumbnail shows "Not saved" |
| Buyout Rail (owner, parent) | `region "Buyout rail"` containing `slider "Buyout month"` | |
| Buyout Rail | slider values | Minimum 0, maximum `<term months>`, current value N, value text "Month <N> of <term months>: equity $<equity>, <tier label>, payoff $<payoff>" |
| Buyout Rail | visible text inside the region | "Equity $<equity>", "Payoff $<payoff>", the tier label of month N, and one band label per tier |
| Buyout Rail | `status "Payoff quote"` | |
| Contract sheet drawing | `group "<instrument label> drawing"` | Holds the model (or the flat fallback drawing) and, for owner and parent, the gauge |
| Contract sheet drawing (WebGL available) | the model canvas exposed as `img "<instrument label> model"`, focusable, with accessible description "Turned <angle> degrees. Left and Right arrow keys turn it." | `<angle>` is a whole number from 0 to 345 in steps of 15, as defined under Instrument model in Interactions |
| Contract sheet drawing (owner, parent) | `img "Equity fill, <percent>% owned"` | `<percent>` is equity ÷ purchase price × 100, rounded down to a whole number. While the rail is shown it uses the equity of the rail's selected month N; otherwise the contract's current equity (100 on a paid-off contract) |
| Reduced motion | `table "Buyout schedule"` with columns "Month", "Equity", "Tier", "Payoff" | The current month's row is marked "(now)" |
| My family | `heading "My family"`; `region "Family totals"` with "Equity across open contracts $<amount>" and "<n> owned"; one `region "<student name>"` per child; `link "Reserve an instrument"`; contract `link "<contract id>"` | `<amount>` and `<n>` are the API's `totals.equity_cents` and `totals.owned` |
| Reserve | `radiogroup "Student"`, `radiogroup "Instrument"` (radios "Flute", "Clarinet", "Trumpet", "Violin", "Cello"), `radiogroup "Size"`, `checkbox "Add maintenance and damage waiver"`, `button "Reserve instrument"`, `status "Reservation status"` | Size radios are named "<size>, <n> available", or "<size>, none available" and disabled. Delivery line: "Reserve before <cutoff date-time> for delivery day <delivery date>." for the chosen student's school |
| Reserve (after 409) | `list "Available instead"`, each item a `button "Reserve <size> <instrument>"` | For example "Reserve 3/4 Cello" |
| Signing page | `heading "Rental agreement"`, `region "Agreement text"`, `textbox "Full legal name"`, `checkbox "I have read and agree to this rental agreement"`, `button "Sign agreement"`, `status "Signing status"` | Under the agreement text: "This link works until <link expiry date-time>." |
| Price lists | `table "Price lists"` with columns "ID", "Effective date", "Tax rate", "Status", then one rent column per instrument | Status words "In force", "Scheduled", "Superseded", "Withdrawn" |
| Price lists | `button "Withdraw <price list id>"` on each scheduled row opens `dialog "Confirm withdrawal"` with `button "Withdraw price list"` and `button "Cancel"` | Dialog text: "Withdraw <price list id> before it takes effect on <effective date>? Contracts and reservations keep the terms in force without it." |
| Price lists | `form "New price list"` with `textbox "Effective date"`, `textbox "Sales tax rate"`; per instrument `textbox "<Instrument> monthly rent"`, `textbox "<Instrument> waiver"`, `textbox "<Instrument> purchase price"`; per tier n `textbox "Tier <n> name"`, `textbox "Tier <n> from month"`, `textbox "Tier <n> to month"`, `textbox "Tier <n> percent"`; `button "Add tier"`, `button "Publish price list"`, `status "Price list status"` | Money is typed in dollars and the sales tax rate as a percent with up to two decimals, for example "8.25". An empty "to month" means open-ended. Field-to-key mapping is in API |
| Schools | one `region "<school name>"` per school, with `list "Roster summary"`, `link "View roster"`, `combobox "Delivery date"`, `button "Send delivery notice"`, `status "Delivery notice status"` | Options: first "Pick a delivery day" (empty value), then the school's four upcoming delivery days, each "<date> (cutoff <cutoff date-time>)" |
| Roster | `heading "<school name> roster"`; `table "Roster"`, columns per band from Screens and layout; `link "Download roster CSV"` | "Next delivery day: <delivery date>". Each Status cell shows its status icon followed by the status word from Business rules |
| Roster | summary line "<k> of <total> students have an instrument" and `list "Roster summary"` | `<k>` is the scheduled, delivered and owned counts added together, and `<total>` is the row count. The list has one item per status, in the order of the roster status table, reading "<status word>: <count>", each with that status's icon |

### Interactions (DP-04, DP-08, DP-15, DP-17, DP-20, DP-22, DP-26, DP-36, DP-51, DP-56, DP-60, DP-61, DP-62, DP-64, DP-65, DP-66, DP-69, DP-70, DP-71, DP-73)

**Server time in the browser.** The Reserve page, the signing page and the Schools page judge time from the server, never from the device's date, time or zone. Each answer that carries `server_now` sets the page's estimate of the server clock: `server_now` plus the time elapsed since that answer arrived. Elapsed time is measured with the browser's elapsed-time counter, which a wrong or frozen device date does not affect. Each of these pages also asks the server again at least every 60 seconds while open.

**Tab order** follows reading order: top bar, page heading, main content left to right and top to bottom (on the contract sheet, the model, then the right column), then the rail, then page actions. Tab and Shift+Tab reach every control, and nothing hidden, collapsed or closed is reachable.

**Menu (narrow only):**

- `button "Menu"` starts with `aria-expanded` "false". While collapsed, no navigation link and no Sign out is in the tab order or the accessibility tree.
- Pressing Menu sets `aria-expanded` to "true", shows the links and Sign out, and moves focus to the first link.
- Escape closes the menu and returns focus to Menu. Following a link closes it.

**Radio groups** (Student, Instrument, Size, New size, Reason, Condition check) each take one Tab stop. Arrow keys move and select within the group and skip disabled sizes. Choosing an instrument rebuilds the Size group from the latest availability and selects the first available size.

**Reserve:**

- Enter on Reserve instrument submits.
- On the 409 unavailable answer, the Size group refreshes, the Available instead list appears under the status, and focus moves to its first button. Pressing one of its buttons selects that size and submits again.
- **Live sizes.** While the page is visible, it asks for availability every 5 seconds and whenever the window regains focus. It updates the Size radios in place, without reloading or rebuilding the page. The chosen student, instrument, size, waiver and keyboard focus stay as they are. A count changed on the server shows in the radio's name within 6 seconds.
  - If the selected size reaches none available, it becomes disabled and unselected, and the first available size of that instrument, in size order, is selected. If focus was on the disabled radio, it moves to the newly selected one. The status announces the change with the size-switch copy from Feedback states.
  - If no size of the selected instrument is left, nothing is selected, Reserve instrument is disabled and the status announces the instrument-gone copy from Feedback states.
  - A size that becomes available again is enabled, and the selection is left alone.
- **Delivery line.** The line comes from the school listing. Within 2 seconds after the chosen school's `cutoff_at` passes on the server clock, it changes to the next delivery day and its cutoff, without a reload. It also refreshes on page load and after every reservation attempt.

**Dialogs:**

- Enter or Space on the opener opens the dialog, and focus moves to its first field.
- Tab from the last control goes to the first, and Shift+Tab from the first goes to the last. Focus never leaves an open dialog.
- Escape or Cancel closes the dialog without saving and returns focus to the opener.
- After a success, the dialog closes and focus goes to the page's status message.
- Pressing Enter in the last field submits the dialog.
- Reopening a dialog while it is still leaving shows it open again, and it stays open (Motion and effects).

**Activate contract** is disabled from the moment it is pressed until the answer arrives.

**Reverse payment:** after a success, the dialog closes and the sheet reloads the contract, the equity ledger, the invoice and the quote table. The reversed payment's row loses its Reverse button.

**Buyout Rail:**

- The handle starts at the contract's current month. If the URL carries `?month=N` with a whole number N from 0 to the term length, it starts at N instead; any other value is ignored.
- **Pointer.** Dragging the handle moves it with the pointer, and its month is always the nearest notch. Pressing or tapping anywhere on the rail moves it to the nearest notch.
- **Touch.** At every width, a mostly horizontal finger drag that starts on the rail moves the handle month by month under the finger, and a tap on a notch moves to that notch. A mostly vertical swipe that starts on the rail scrolls the page, and the month stays as it was: the rail leaves vertical panning to the browser.
- **Hit area.** The element exposed as `slider "Buyout month"` is at least 44 by 44 pixels at every width, with or without reduced motion.
- **Keys.** Left and Down step back one month, Right and Up step forward one, Page Down and Page Up move twelve months, and Home and End jump to month 0 and the last month.
- **Release.** On pointer up, touch end, or after each key step, the handle settles on its notch, `status "Payoff quote"` announces the quote, and the URL query becomes `?month=N` without adding a browser history entry.
- The rail takes its figures from the server's quote table for the contract. It fetches the table when the sheet loads and again after each payment, reversal, exchange or buyout, so every figure shown is the server's figure for that month.
- The model's brass band, the gauge and the gauge's accessible name follow the handle's month.
- Buy out always uses the current month's quote total, whatever month the handle is on.

**Instrument model:**

- **Angle.** The model's angle is in degrees about its upright axis. It opens at 0 on every load of the sheet and is always held from 0 up to, but not including, 360. An angle that would go below 0 wraps up by 360, so −15 reads 345, and one that would reach 360 or more wraps down by 360, so 360 reads 0.
- **Drag.** A mostly horizontal drag across the model, with mouse or finger, turns it in proportion to the horizontal distance dragged. Dragging rightward increases the angle and dragging leftward decreases it. Every 100 pixels of horizontal drag turn the model by the same fixed amount, which is at least 15 and at most 180 degrees. So a 100-pixel drag from rest always moves the described angle by at least 15 degrees, wrapped as above, and visibly changes the drawn pixels. On touch, a mostly vertical swipe over the model scrolls the page and leaves the angle as it was.
- **Keys.** With the model focused, Right adds exactly 15 degrees and Left subtracts exactly 15 degrees, wrapped as above (345 plus 15 reads 0, and 0 minus 15 reads 345). The accessible description shows the new angle as soon as the key is pressed.
- **Description.** After a drag, the angle in the description is the model's angle rounded to the nearest multiple of 15 (halfway rounds up), and a rounded 360 reads 0. After key turns alone the angle is always a multiple of 15 and is shown as is.
- The model never turns or moves by itself.

**Signing page:**

- Tab goes from the agreement text (a focusable scrollable region) to Full legal name, then the agreement checkbox (Space toggles it), then Sign agreement.
- Enter in the name field submits.
- After success, the success copy replaces the form and focus moves to the status.
- **Expiry in place.** When the server clock reaches the link's `link_expires_at` with the page open, the signing form (name field, checkbox and Sign agreement) is removed within 2 seconds and the status shows the link-expired copy. If focus was in the form, it moves to the status. A form left on screen past expiry is never possible, whatever the device clock says.

**Schools page:**

- On load, each school's `combobox "Delivery date"` selects its first upcoming day.
- Within 2 seconds after a listed day's cutoff passes on the server clock, that school's options refresh in place without a reload. The passed day goes, a new fourth day is added, and the school's roster summary refreshes at the same moment.
  - A selected day that is still listed stays selected, and focus is not disturbed.
  - A selected day that was removed leaves "Pick a delivery day" selected. `button "Send delivery notice"` is disabled until a day is picked, and that school's status shows the passed-day copy from Feedback states. The message stays until the owner changes that school's selection or sends a notice. Later refreshes never clear it.
  - Another school's region, selection and status are untouched.

**Price lists:** Withdraw opens the confirmation dialog. Confirming sends the withdrawal, then reloads the table, so the row's status reads "Withdrawn".

**Form errors** (New price list, Add instrument, Add student):

- After a 422, each field named in `fields` gets `aria-invalid` "true", and the message is shown beside the field as text tied to it as its accessible description.
- A whole-list `items` or `tiers` message describes that list's first field.
- Focus moves to the first invalid field in form order.
- Submitting again clears the marks and messages of fields that are now valid.
- A value the form cannot read as a number is sent as `null`, and the server's message for that field comes back.

**Record condition:**

- The file input accepts several photos. Each chosen photo shows a thumbnail and its `button "Remove <file name>"`. Save uploads them all in one request.
- When a photo is refused, the dialog stays open. Every chosen photo stays chosen with its thumbnail. The refused one (the API's `photo_index`) shows "Not saved", focus moves to its Remove button, and `status "Condition status"` names the file with the copy from Feedback states. Pressing Remove drops that photo and clears its message.

**Sign-in return:** visiting a signed-in route while signed out goes to `/?next=<path and query>`, percent-encoded as a URL component. After sign-in the browser shows the landing chosen by Sign-in landing (Business rules), and reloading that address shows the same screen.

**Downloads.** Download roster CSV is a plain link that the browser downloads. Bill of sale (PDF) and Signed agreement (PDF) open the stored file.

**Hover and press.** Buttons and rows darken slightly on hover and press inward when pressed. Register rows show a hairline underline on hover and on keyboard focus.

### Visual design (DP-31, DP-50, DP-53, DP-73)

**Colour roles:**

- The page is a warm cream paper, never pure white.
- Text, drawings and the 3D model are a deep blue-black ink. Rules and dividers are hairlines in a warm grey-tan.
- One brass gold is the only accent, used only where equity and ownership show: the brass band in the model, the equity gauge and the flat drawing's hatch, equity figures, the family equity total, the equity part of payment splits, and the "Owned" mark.
- A brick red is reserved for alerts and destructive actions: write-off, reversal, withdrawal, and outage and error messages.
- Primary buttons are ink with cream text. Secondary buttons are outlined in ink on cream.

**Status words and contrast:**

- Every delivery status in the roster table and roster summary is a word plus a small Lucide line icon. The icon is different for each of the five statuses and hidden from screen readers. Status is never shown by colour alone.
- All text meets WCAG 2.2 AA: at least 4.5 to 1 against the background it actually sits on, including any tinted cell or band behind it. This covers status words, price list standings, muted labels and every brass figure.
- The warm grey-tan rule colour is never used for text.
- Brass text is a darker brass than the fill, deep enough to pass on cream. The "Owned" status word in particular passes.

**Focus** is a clearly visible ink ring at least two pixels thick, set slightly away from the control. The focused model canvas gets the same ring.

**Type:**

- Headings use Fraunces, a soft old-style serif with strong contrast between thick and thin strokes.
- Body text uses IBM Plex Sans.
- Labels, column heads and tier bands use IBM Plex Sans Condensed in small capitals.
- Every figure (serials, money, months, and dates in tables) uses IBM Plex Mono with equal-width digits, so columns of figures line up.
- Each heading level is about a quarter larger than the level below it, starting one step above body text.
- The app serves all fonts itself.

**Density** is comfortable: generous line spacing, at least a full line of space between register rows, and controls at least 44 pixels tall and wide.

**Composition:**

- A left-anchored numbered register runs down a grid of hairline rules, like a museum catalogue. Index numbers sit in the margin in mono, and serials lead each row.
- Choosing a row opens the two-column contract sheet: the instrument model on the left; the terms, ledger and history on the right; and the rail ruled full width beneath both.
- The contract history reads like a register's provenance column, with one dated line per move and a hairline between lines.
- Reversal lines in the ledger sit directly under the hairline of the row they reverse, in ink with a brick-red minus amount.

**Instrument model (DP-73):**

- **Rendering.** The model is built in the page from simple 3D shapes, never from a downloaded mesh or photo, with one distinct model each for flute, clarinet, trumpet, violin and cello. It is drawn in ink lines and flat ink tints on a canvas cleared to the cream paper. Nothing in it is brass except the band.
- **Size.** It stands upright and centred: its horizontal centre is within 10% of the canvas width of the canvas centre. Its rendered height is at least 60% of the canvas height. String models scale with fractional size: on the same canvas, a 4/4 is drawn taller than a 3/4, a 3/4 than a 1/2, and a 1/2 than a 1/4.
- **Brass band.** For owner and parent, a horizontal brass band fills the model's silhouette from its base upward. It is drawn flat, without lighting, in the single brass of the gauge.
- **Measurement.** Pixels are measured on the canvas's own pixel grid, read after a frame is drawn. The WebGL context keeps its drawing buffer between frames so the pixels can be read. The model's top and bottom are the highest and lowest rows holding any pixel that is not the paper colour. The band's top is the highest row holding a brass pixel. Once settled, the distance from the model's bottom to the band's top equals that month's equity ÷ purchase price times the model's height, within 2% of the canvas height. At 0% equity there are no brass pixels, and turning the model never changes this measurement.
- **Fallback.** When the browser cannot create a WebGL context, the group shows a flat ink line drawing of the instrument instead, with the same brass fill rule and the same names, and without `img "<instrument label> model"`.

**Equity gauge (owner and parent).** The gauge is the `img "Equity fill, <percent>% owned"` element: a slim upright brass column beside the model, or the hatch inside the flat drawing in the fallback. Its rendered box is exactly the visible brass: its bottom edge sits on the bottom edge of the drawing group's box, and it is never drawn larger and then clipped. Once settled, its height equals the drawing group's height times that month's equity ÷ purchase price, within 1 pixel.

**Rail:**

- One notch per month.
- Paid months, up to the current month, are solid ink ticks. Future months are dotted ticks.
- Each tier is a softly shaded band with its label in condensed small capitals.
- A hairline rule marks every tier boundary.

### Motion and effects (DP-20, DP-21, DP-52, DP-72, DP-73)

Every animation runs on the Motion library. Bellroll uses three speeds only. All of them start quickly and slow gently into place, except the handle's spring.

| Speed | Duration | Used for |
|---|---|---|
| Quick | 150 to 250 milliseconds | hover and press feedback, the tier label swap, status messages appearing, the tier-boundary rule brightening, dialogs leaving |
| Medium | 350 to 500 milliseconds | dialogs rising in, figures rolling digit by digit, the register row growing into the contract header, the model easing to rest after a turn |
| Long | 600 to 800 milliseconds | the brass band and gauge rising or falling, the rail handle's spring onto its notch |

**Choreography.** Each item below is measured on the page with its clock paused and stepped:

1. **Handle spring.**
   - Notch positions: the handle's centre at month 0 marks one end of the rail and its centre at the last month marks the other. Notch N sits N ÷ `<term months>` of the way between them.
   - After a key step or a tap on another notch, the handle travels toward the new notch and passes it in the direction of travel. At its furthest it is 2 to 8 pixels beyond the notch. It then comes back and stops moving between 600 and 800 milliseconds after the step.
   - At rest, the handle's centre is within 1 pixel of the notch.
   - After a drag release, the handle springs from where it was let go to the nearest notch and comes to rest within 800 milliseconds.
   - A new step during a spring heads straight for the newest notch.
2. **Dialogs.**
   - **Opening.** A dialog opens 12 pixels (within 1 pixel) below its resting place and fully transparent. It rises and fades in, reaching its resting place at full strength between 350 and 500 milliseconds after opening.
   - **Closing.** A closing dialog fades out. From the moment closing starts it takes no clicks or keys, and focus has already moved on. It is still painted at the start of its exit, and it is gone from the page and the accessibility tree between 150 and 250 milliseconds after closing starts.
   - A dialog reopened during its exit is shown open, and the end of the earlier exit never removes it.
3. **Register row into the contract header.** When the contract sheet opens from the register by clicking or pressing Enter on a serial link, `group "Contract header"` is painted on its first frame at the box of the register entry that was chosen, within 2 pixels on each edge. It reaches its own resting box between 350 and 500 milliseconds later. A direct load or reload of the sheet shows the header at rest at once.
4. **Figures.**
   - When the rail moves, "Equity $<equity>" and "Payoff $<payoff>" start rolling no later than 200 milliseconds after the brass starts moving. Each changed digit rolls upward or downward to its new digit.
   - Within 500 milliseconds of starting, each figure's text is exactly the formatted final amount, with no leftover rolling digits in the page.
   - The slider's value text and the status always carry the final values at once.
5. **Brass band and gauge.** After each move, they rise from the base or fall back, reaching their final heights (Visual design) between 600 and 800 milliseconds after the move. After a payment, reversal or exchange refetch they move to the new equity the same way.
6. **Model turn.** After a key turn or the end of a drag, the model eases to its new angle and stops moving between 350 and 500 milliseconds later.

**Buyout Rail, step by step.** Each time the handle reaches a new month:

1. The brass in the model and the gauge move first, rising when the handle moves forward and falling when it moves back.
2. The payoff and equity figures roll to their new values.
3. Last, if the move crossed a tier boundary, the tier label fades from old to new at the quick speed and that boundary's rule briefly brightens.

Moving back reverses each step month by month. Rapid moves interrupt running animations and head straight for the latest month's values. Nothing on the rail or in the model moves while the handle and model are idle.

**No other motion exists.** There are no idle loops, shimmering, floating, automatic turning or decorative animation, and no autoplaying media. Loading uses the static pending copy in Feedback states, never a spinning loop.

**Reduced motion.** When the operating system asks for reduced motion:

- Every item above becomes an instant change to its final state:
  - no spring: the handle lands on its notch
  - dialogs appear and disappear at once
  - no row-to-header movement
  - figures swap at once
  - the brass jumps to its height
  - the model jumps to its new angle
- After the final state is drawn, nothing on the page moves, scales or fades, and the page reports no running animations.
- The fill measurements still hold, and dragging still turns the model by the same rule.
- The rail becomes a plain browser range slider with the same `slider "Buyout month"` name, keys and hit area.
- The `table "Buyout schedule"` appears beside the rail in medium and wide, and below it in narrow.

Everything else behaves the same.

### Feedback states (DP-04, DP-08, DP-15, DP-17, DP-22, DP-26, DP-27, DP-33, DP-36, DP-46, DP-56, DP-60, DP-62, DP-64, DP-65, DP-71)

Every async action disables its button the moment it starts and sets the pending copy in its named `status` live region. The outcome then replaces the pending copy. `<...>` placeholders use the formats in Business rules. Network failures and any 500 show "Couldn't reach Bellroll. Nothing was changed; check your connection and try again."

| Action | Live region | Pending | Success | Errors (status → copy) |
|---|---|---|---|---|
| Sign in | Sign-in status | "Signing in…" | Goes to the landing from Business rules | 401 → "Email or password is wrong." |
| Reserve | Reservation status | "Reserving…" | "Reserved <instrument label> <serial> for <student name>. Hold until <hold deadline date-time>. Delivery day <delivery date>." | 409 unavailable → "That <size> <instrument> is no longer available." plus the Available instead list, or "Nothing else is available in that instrument right now." when the list is empty. 409 student_has_instrument → "<student name> already has an instrument on contract." 422 → "Choose a student, instrument and size." |
| Reserve, live size change | Reservation status | none | Size switch: "The last <size> <instrument> was just reserved. <new size> <instrument> is selected instead." Instrument gone: "No <instrument> is available right now." | |
| Send signing link | Contract status | "Sending…" | "Signing link queued for <parent email>. It works until <link expiry date-time>." | 409 → "This contract can't be sent for signing now." |
| Revoke signing link | Contract status | "Revoking…" | "Signing link revoked." | 409 no_live_link → "There is no live signing link to revoke." |
| Load signing page | Signing status | "Loading agreement…" | The agreement is shown | 404 → "This signing link is not valid." 410 link_expired, or expiry reached with the page open → "This signing link has expired. Ask Keel & Bell for a new one." 410 link_used → "This agreement has already been signed." |
| Sign agreement | Signing status | "Signing…" | "Agreement signed. Keel & Bell will confirm delivery." | 422 full_name → "Type your full legal name." 422 agree → "Tick the box to agree." 503 → "We couldn't save your signed agreement. Nothing was signed; try again in a moment." 404 and 410 → the matching load copy |
| Activate | Contract status | "Activating…" | "Contract active. Monthly billing is set up." | 409 invalid_transition → "This contract can't be activated now." 409 agreement_not_stored → "The signed agreement isn't stored yet." 503 billing_unavailable → "Billing is unreachable. The contract is still signed; try again in a moment." 503 storage_unavailable → "File storage is unreachable. The contract is still signed; try again in a moment." |
| Record payment | Contract status | "Recording payment…" | "Payment of $<amount> recorded: $<base part> rent toward ownership, $<waiver part> waiver, $<tax part> tax. Receipt queued for <parent email>." When the payment pays the contract off, " The instrument is now owned." follows | 422 amount_cents → "Enter an amount above $0.00.", or for exceeds_remaining → "That's more than the remaining balance. Use buyout instead." 409 invalid_transition → "This contract can't take payments now." 409 idempotency_conflict → "Billing already holds a different charge for this payment. Nothing was recorded." 503 billing_unavailable → "Billing is unreachable. Nothing was recorded; try again in a moment." 503 storage_unavailable → "File storage is unreachable, so this final payment can't close the contract. Nothing was recorded; try again in a moment." |
| Reverse payment | Contract status | "Reversing…" | "Payment <payment id> reversed: $<amount> refunded, $<base part> equity removed." | 409 payment_reversed → "Payment <payment id> was already reversed." 409 invalid_transition → "Payments can only be reversed on an active contract." 422 → "Choose a reason." 503 → "Billing is unreachable. Nothing was reversed; try again in a moment." |
| Exchange size | Contract status | "Exchanging…" | On the successor sheet: "Exchanged to <instrument label> <serial>. $<equity> equity moved from <old contract id>." | 409 unavailable → "That size is no longer available.", with the dialog's radios refreshed. 503 → "Billing is unreachable. Nothing was exchanged; try again in a moment." or "File storage is unreachable. Nothing was exchanged; try again in a moment." |
| Return / write-off | Contract status | "Saving…" | "Contract marked returned." / "Contract written off." | 503 → "Billing is unreachable or hasn't confirmed the cancellation. Nothing was changed; try again in a moment." |
| Buyout | Contract status | "Processing buyout…" | "Bought out for $<total>. <student name> owns <serial>. Ownership letter queued for <parent email>." | 409 quote_changed → "The payoff is now $<new total> with tax. Review and confirm again.", and the button is relabelled. 409 invalid_transition → "This contract can't be bought out now." 503 billing_unavailable → "Billing is unreachable. The contract is unchanged; try again in a moment." 503 storage_unavailable → "File storage is unreachable. Nothing was charged; the contract is unchanged." |
| Rail release | Payoff quote | none | "Month <N> payoff $<payoff>. Quote valid until <valid until date>." | If the quote table failed to load → "Couldn't load the payoff schedule. Reload to try again." and the rail is disabled |
| Record condition | Condition status (in the dialog); success in Contract status | "Uploading photos…" | The dialog closes and Contract status reads "Condition recorded with <n> photos." | 415 unsupported_image → "<file name> isn't a JPEG, PNG or WebP photo. Nothing was saved." 413 photo_too_large → "<file name> is over 5,000,000 bytes. Nothing was saved." 422 photos `dimensions` → "<file name> is over 8,000 pixels on a side. Nothing was saved." 422 photos `count` → "Add between 1 and 6 photos." 413 payload_too_large → "These photos are too large to send together. Nothing was saved." 409 contract_not_open → "Condition can't be recorded on this contract." 503 → "File storage is unreachable. Nothing was saved; try again in a moment." |
| Add instrument / student | Register status | "Saving…" | "Added <serial>." / "Added <student name> to <school name>." | 409 serial_taken → "Serial <serial> is already in the fleet." 422 → "Check the highlighted fields." with each field's message |
| Publish price list | Price list status | "Publishing…" | "Price list <price list id> takes effect <effective date>. Contracts signed before then keep their terms." | 422 → "Check the highlighted fields." with each field's message |
| Withdraw price list | Price list status | "Withdrawing…" | "Price list <price list id> withdrawn before it took effect." | 409 price_list_in_force → "<price list id> is already in force and can't be withdrawn." 409 price_list_withdrawn → "<price list id> was already withdrawn." |
| Delivery notice | Delivery notice status | "Sending…" | "Delivery notice queued for <director email> (<n> students)." | 422 → "Pick one of this school's delivery days." |
| Delivery day passes on screen | Delivery notice status | none | | "Delivery day <date> passed its cutoff. Pick another delivery day." |

In the condition copy, `<file name>` is the name of the chosen file at the API's `photo_index`.

## Backend

### API (DP-01, DP-05, DP-06, DP-07, DP-09, DP-10, DP-11, DP-13, DP-16, DP-18, DP-19, DP-23, DP-25, DP-27, DP-28, DP-29, DP-30, DP-32, DP-33, DP-34, DP-37, DP-38, DP-40, DP-41, DP-43, DP-44, DP-45, DP-55, DP-57, DP-58, DP-61, DP-62, DP-65, DP-67, DP-68, DP-71)

**Conventions:**

- Every endpoint is under `/api`.
- Requests and responses use `application/json; charset=utf-8`, except the PDF, image and CSV downloads and the condition upload, which uses `multipart/form-data`.
- Money is integer cents in fields ending `_cents`. Tax rates are whole basis points in fields ending `_bp`.
- Dates are `YYYY-MM-DD` in the store's time zone. Timestamps are ISO 8601 UTC with `Z`, to the second. The one exception is `server_now`, which is the server clock to the millisecond (for example `2026-11-04T22:59:10.250Z`).
- Authentication uses the `bellroll_session` cookie (HttpOnly, SameSite=Lax, Path=/).

**Error shape.** Every error uses this one shape: `{"error":{"code":"<code>","message":"<sentence>"}}`. Four cases add a field:

- 422 uses code `validation_failed` and adds `"fields":{"<field>":"<message>"}`, with every invalid field at once.
- 409 `unavailable` adds `"alternatives":[{"instrument_type","size","available"}]`.
- 409 `quote_changed` adds `"quote":<Quote>`.
- Per-photo refusals (413 `photo_too_large`, 415 `unsupported_image` and 422 with `"fields":{"photos":"dimensions"}`) add `"photo_index"`, the refused photo's 0-based position in upload order.

**Error precedence (whole API).** The checks run in this order, and the first one that fails answers:

1. Whole-request boundary rejections only: 403 `cross_origin`, 413 `payload_too_large` and 415 `unsupported_media_type` (Server boundary). Per-photo checks are not part of this step.
2. 401 `unauthenticated`.
3. 403 `forbidden` when the endpoint is not open to the caller's role.
4. An idempotent replay returns its stored response here. This includes a copy that arrived while the first request was still being processed (Business rules).
5. 404 for an unknown ID or one the caller may not see, including an ID inside the request body (a parent's `student_id`). The code is `not_found`, except `link_not_found` for a signing token, and `agreement_not_stored` and `bill_of_sale_not_stored` for their PDF downloads.
6. Conflicts with the current state of the resource. These never depend on request field values.
   - First, 410 `link_expired` and `link_used`.
   - Then the 409s, each in the order Business rules gives for its endpoint: `invalid_transition`, `not_exchangeable`, `student_has_instrument`, `no_live_link`, `agreement_not_stored`, `no_quote`, `contract_not_open`, `idempotency_conflict` (a stored key with a different body), `payment_reversed`, `price_list_withdrawn`, `price_list_in_force`.
7. 422 validation of request fields. For the condition upload, this step includes the per-photo checks, which may answer 413 `photo_too_large` or 415 `unsupported_image` in the order given in Business rules.
8. 409 conflicts judged from validated request values: `unavailable`, `quote_changed` and `serial_taken`, then `idempotency_conflict` when Kill Bill already holds a successful transaction under the action's external key for a different amount (found by the look-up just before charging or refunding).
9. 503 dependency outages.

The rows below list only each endpoint's own extra errors.

**Bodies used below:**

- *User*: `{"id","name","email","role":"owner"|"parent"|"director"|"tech","family_id":string|null,"school_id":string|null}`.
- *Contract*: `{"id","status","student":{"id","name","grade"},"school":{"id","name"},"family_id","instrument":{"serial","instrument_type","size","model","label"},"waiver":bool,"terms":{"price_list_id","bound":bool,"base_rent_cents","waiver_cents","purchase_price_cents","tax_rate_bp","term_months","tiers":[Tier]},"equity_cents","contract_month","delivery_date","hold_expires_at":ts|null,"signing_link":{"status":"none"|"live"|"revoked"|"used"|"expired","expires_at":ts|null},"agreement_stored":bool,"bill_of_sale_stored":bool,"subscription_state":"active"|"cancelled"|null,"signed_at","activated_at","closed_at","billing_anchor_date":date|null,"next_billing_date":date|null,"predecessor_id","successor_id","history":[HistoryEntry]}`. Unset values are `null`.
- *HistoryEntry*: `{"from":string|null,"to","at","actor":"owner"|"parent"|"system","actor_name":string|null}`, oldest first.
- *Tier*: `{"from_month","to_month":int|null,"percent","name","label"}`.
- *ContractSummary*: `{"id","status","student_name","instrument_label","serial","equity_cents","delivery_date"}`.
- *Quote*: `{"contract_id","month","term_months","paid":bool,"equity_cents","remaining_cents","tier":{"label","percent"},"discount_cents","payoff_cents","tax_cents","total_cents","valid_until"}`.
- *PriceList*: `{"id","effective_date","created_at","withdrawn_at":ts|null,"tax_rate_bp","items":[{"instrument_type","base_rent_cents","waiver_cents","purchase_price_cents"}],"tiers":[Tier]}`.
- *School*: `{"id","name","delivery_weekday","next_delivery_date","cutoff_at","upcoming_delivery_days":[{"date","cutoff_at"}]}`.
- *Payment*: `{"id","amount_cents","base_rent_cents","waiver_cents","tax_cents","killbill_payment_id","created_at"}`.
- *Reversal*: `{"id","payment_id","reason","amount_cents","base_rent_cents","waiver_cents","tax_cents","killbill_refund_id","created_at"}`.

| Method and path | Roles | Request | Success | Extra errors |
|---|---|---|---|---|
| `POST /api/session` | anyone | `{"email","password"}` | 200 `{"user":User}`, and sets the cookie | 401 `invalid_credentials` |
| `GET /api/me` | signed in | | 200 `{"user":User}` | |
| `DELETE /api/session` | signed in | | 204 | |
| `GET /api/health` | anyone | | 200 `{"status":"ok"}` | 503 `{"status":"starting"}` |
| `GET /api/availability` | signed in | | 200 `{"items":[{"instrument_type","size","available"}]}`, one item per type and size in this order: flute full, clarinet full, trumpet full, violin 1/4, 1/2, 3/4, 4/4, cello 1/4, 1/2, 3/4, 4/4 | |
| `GET /api/schools` | signed in | | 200 `{"server_now","schools":[School]}`, schools in seed order | |
| `GET /api/price-lists/current` | signed in | optional query `on=YYYY-MM-DD` (default today) | 200 `{"price_list":PriceList}`, the version in force on that date | 404 `not_found` when no version is in force on that date; 422 field `on` |
| `GET /api/price-lists` | owner | | 200 `{"price_lists":[PriceList]}`, newest effective date first, then newest created first; withdrawn versions included | |
| `POST /api/price-lists` | owner | `{"effective_date","tax_rate_bp","items":[{"instrument_type","base_rent_cents","waiver_cents","purchase_price_cents"}],"tiers":[{"from_month","to_month","percent","name"}]}` | 201 `{"price_list":PriceList}` | 422 with the field keys below |
| `POST /api/price-lists/{id}/withdraw` | owner | `{}` | 200 `{"price_list":PriceList}` with `withdrawn_at` set | 409 `price_list_withdrawn`, `price_list_in_force` |
| `GET /api/instruments` | owner, tech | | 200 `{"instruments":[{"index","serial","instrument_type","size","model","label","status","contract_id","school_name"}]}`, sorted by serial, with index counting from 1 | |
| `POST /api/instruments` | owner | `{"serial","instrument_type","size","model"}` | 201 `{"instrument":{...same fields}}` | 409 `serial_taken`; 422 fields `serial`, `instrument_type`, `size`, `model` |
| `GET /api/families` | owner | | 200 `{"families":[{"id","parent_name","email","phone","address","students":[{"id","name","grade","school_id"}]}]}` | |
| `POST /api/students` | owner | `{"family_id","school_id","name","grade"}` | 201 `{"student":{"id","name","grade","school_id","family_id"}}` | 422 fields `family_id`, `school_id`, `name`, `grade` |
| `GET /api/family` | parent | | 200 `{"family":{"id","parent_name","email"},"totals":{"open_contracts","equity_cents","owned"},"students":[{"id","name","grade","school":{"id","name"},"contracts":[ContractSummary]}]}` | |
| `POST /api/reservations` | parent | `{"student_id","instrument_type","size","waiver":bool}` | 201 `{"contract":Contract}` | 404 when the student is not the caller's; 409 `student_has_instrument`, `unavailable`; 422 fields |
| `GET /api/contracts` | owner and tech (all), parent (own) | | 200 `{"contracts":[ContractSummary]}` | |
| `GET /api/contracts/{id}` | owner, tech, parent (own) | | 200 `{"contract":Contract}` | |
| `POST /api/contracts/{id}/signing-link` | owner | `{}` | 201 `{"contract":Contract}` | 409 `invalid_transition` |
| `POST /api/contracts/{id}/signing-link/revoke` | owner | `{}` | 200 `{"contract":Contract}` | 409 `no_live_link` |
| `GET /api/signing/{token}` | anyone | | 200 `{"server_now","agreement":{"contract_id","student_name","school_name","instrument_label","serial","waiver","terms":{same as Contract terms},"link_expires_at","status":"agreement_sent"}}` | 404 `link_not_found`; 410 `link_expired`, `link_used` |
| `POST /api/signing/{token}` | anyone | `{"full_name","agree":true}` | 200 `{"agreement":{"contract_id","status":"signed","signed_at"}}` | 404 and 410 as above; 422 fields `full_name`, `agree`; 503 |
| `POST /api/contracts/{id}/activate` | owner | `{}` | 200 `{"contract":Contract}` | 409 `invalid_transition`, `agreement_not_stored`; 503 |
| `POST /api/contracts/{id}/return` | owner | `{}` | 200 `{"contract":Contract}` | 409 `invalid_transition`; 503 |
| `POST /api/contracts/{id}/write-off` | owner | `{}` | 200 `{"contract":Contract}` | 409 `invalid_transition`; 503 |
| `GET /api/contracts/{id}/invoice` | owner, parent (own) | | 200 `{"invoice":{"contract_id","price_list_id","billing_date":date|null,"upcoming_billing_dates":[date],"tax_rate_bp","lines":[{"code":"base_rent"\|"waiver"\|"sales_tax","label","amount_cents"}],"total_cents"}}` | |
| `GET /api/contracts/{id}/equity` | owner, parent (own) | | 200 `{"equity_cents","purchase_price_cents","contract_month","closed":bool,"entries":[{"id","kind","amount_cents","transfer_id","payment_id","reversed","created_at"}]}`, oldest first | |
| `GET /api/contracts/{id}/quote?month=N` | owner, parent (own) | | 200 `{"quote":Quote}` | 409 `no_quote`; 422 field `month` |
| `GET /api/contracts/{id}/quotes` | owner, parent (own) | | 200 `{"quotes":[Quote]}` for months 0 to the term, in order | 409 `no_quote` |
| `POST /api/contracts/{id}/payments` | owner | header `Idempotency-Key`; `{"amount_cents"}` | 201 `{"payment":Payment,"contract":Contract}` | 409 `invalid_transition`, `idempotency_conflict`; 422 fields `amount_cents`, `idempotency_key`; 503 |
| `POST /api/contracts/{id}/payments/{payment_id}/reversal` | owner | header `Idempotency-Key`; `{"reason":"returned_check"\|"chargeback"\|"entered_in_error"}` | 201 `{"reversal":Reversal,"contract":Contract}` | 404 `not_found` when the payment is not on that contract; 409 `invalid_transition`, `idempotency_conflict`, `payment_reversed`; 422 fields `reason`, `idempotency_key`; 503 |
| `POST /api/contracts/{id}/buyout` | owner, parent (own) | header `Idempotency-Key`; `{"expected_payoff_cents"}` | 200 `{"contract":Contract,"buyout":{"payoff_cents","discount_cents","remaining_cents","tax_cents","total_cents","tier":{"label","percent"},"killbill_payment_id"}}` | 409 `invalid_transition`, `idempotency_conflict`, `quote_changed`; 422 fields `expected_payoff_cents`, `idempotency_key`; 503 |
| `POST /api/contracts/{id}/exchange` | owner | header `Idempotency-Key`; `{"size"}` | 201 `{"old_contract":Contract,"new_contract":Contract,"transfer_id"}` | 409 `invalid_transition`, `not_exchangeable`, `idempotency_conflict`, `unavailable`; 422 fields `size`, `idempotency_key`; 503 |
| `GET /api/contracts/{id}/agreement.pdf` | owner, parent (own) | | 200 `application/pdf` | 404 `agreement_not_stored`; 503 |
| `GET /api/contracts/{id}/bill-of-sale.pdf` | owner, parent (own) | | 200 `application/pdf` | 404 `bill_of_sale_not_stored`; 503 |
| `POST /api/contracts/{id}/condition-events` | owner, tech | multipart: `kind` (`checkout`, `exchange` or `return`), `notes` (optional), one or more `photos` | 201 `{"event":{"id","kind","notes","recorded_by","created_at","photos":[{"id","url"}]}}` | 409 `contract_not_open`; 413 `photo_too_large` and 415 `unsupported_image`, each with `photo_index`; 422 fields `kind`, `notes`, `photos` (`count`, or `dimensions` with `photo_index`); 503 |
| `GET /api/contracts/{id}/condition-events` | owner, tech, parent (own) | | 200 `{"events":[...event]}`, newest first | |
| `GET /api/condition-photos/{photo_id}` | owner, tech, parent (own) | | 200 `image/jpeg` | 503 |
| `GET /api/schools/{id}/roster` | director (own school), owner | | 200 `{"school":{"id","name","delivery_weekday"},"next_delivery_date","counts":{"no_instrument","awaiting_agreement","scheduled","delivered","owned"},"students":[RosterRow]}` | |
| `GET /api/schools/{id}/roster.csv` | director (own school), owner | | 200 `text/csv; charset=utf-8` with `Content-Disposition: attachment; filename="roster-<school id>.csv"` | |
| `POST /api/schools/{id}/delivery-notice` | owner | `{"delivery_date"}` | 202 `{"recipient","delivery_date","student_count"}` | 422 field `delivery_date` |

**Price list field keys and messages.** A 422 from `POST /api/price-lists` names every invalid field at once with these keys and exact messages:

| Key | Message | Form field |
|---|---|---|
| `effective_date` | "Use a date from today on, as YYYY-MM-DD." | Effective date |
| `tax_rate_bp` | "Enter a rate from 0.00% to 20.00%." | Sales tax rate |
| `items.<instrument_type>.base_rent_cents` | "Enter a monthly rent from $1.00 to $1,000.00." | <Instrument> monthly rent |
| `items.<instrument_type>.waiver_cents` | "Enter a waiver from $0.00 to $100.00." | <Instrument> waiver |
| `items.<instrument_type>.purchase_price_cents` | "Enter a purchase price from $10.00 to $10,000.00, at least the monthly rent." | <Instrument> purchase price |
| `items` | "Give one price for each of the five instruments." | the first instrument field |
| `tiers.<i>.name` | "Name this tier in 1 to 30 characters." | Tier <i+1> name |
| `tiers.<i>.from_month` | "The first tier starts at month 0." for i = 0; otherwise "Start this tier the month after the previous tier ends." | Tier <i+1> from month |
| `tiers.<i>.to_month` | "End this tier at or after its start; only the last tier is open-ended." | Tier <i+1> to month |
| `tiers.<i>.percent` | "Enter a whole percent from 0 to 90." | Tier <i+1> percent |
| `tiers` | "Add between 1 and 6 tiers." | the first tier field |

`<i>` is the 0-based tier index. The add-instrument and add-student 422s also name every invalid field at once, each with a one-sentence message.

**Access beyond the table:**

- A director asking for another school's roster gets 404.
- Every contract, quote, invoice, statement, photo, PDF and condition endpoint answers a director with 403.
- The tech gets 403 from the invoice, equity, quote, quotes, agreement PDF and bill-of-sale endpoints, and from every money action.
- A parent reaches a contract only if it belongs to one of their own children, and that includes the exchanged predecessors of their own child's contracts. For photos, the photo's contract decides. Any other contract, photo or payment ID answers 404 `not_found`.
- The signing endpoints use only their token and never accept or reveal any other contract.
- No parent response ever names a contract, student or family other than the caller's own. This also holds for `predecessor_id` and `successor_id`, which always point within the same student's contracts.

**Payloads:**

- Every condition photo `url` is exactly `/api/condition-photos/<photo id>`. It is never a presigned link or an object-storage address.
- On equity entries, `payment_id` is set on `payment` and `reversal` entries. `reversed` is `true` or `false` on `payment` entries and `null` on every other entry.
- *RosterRow* has exactly these keys: `student_id`, `student_name`, `grade`, `instrument_type`, `size`, `serial`, `delivery_date`, `delivery_status`. When `delivery_status` is `no_instrument`, `instrument_type`, `size`, `serial` and `delivery_date` are `null`.

### Business rules (DP-01, DP-02, DP-03, DP-06, DP-07, DP-09, DP-10, DP-12, DP-13, DP-14, DP-16, DP-18, DP-19, DP-23, DP-24, DP-25, DP-28, DP-29, DP-30, DP-32, DP-33, DP-34, DP-35, DP-37, DP-38, DP-40, DP-41, DP-42, DP-43, DP-44, DP-47, DP-55, DP-57, DP-58, DP-59, DP-61, DP-62, DP-64, DP-66, DP-67, DP-68, DP-71)

**Clock**

- The server's "now" comes from one clock.
- When `BELLROLL_CLOCK_START` (an ISO 8601 UTC instant) is set, the clock reads that instant at the moment the app process starts and advances in real time from there. When it is not set, the clock is the system clock.
- Every server time rule reads this clock and nothing else. That covers:
  - delivery days and cutoffs
  - holds and signing link expiry
  - `server_now`
  - "today", effective dates and withdrawals
  - billing dates and `valid_until`
  - `signed_at`, `activated_at` and `closed_at`
  - history `at` and ledger `created_at`
  - the dates and times printed in PDFs and emails
- Requests to Kill Bill carry no dates from this clock; Kill Bill keeps its own.
- Instances that share a database always share one clock. An instance started with `BELLROLL_CLOCK_START` gets its own database, Kill Bill tenant and storage bucket (see Deployment).

**Today**

- "Today" is the clock's date in the store's time zone, America/Chicago. It changes at store midnight: 05:00 UTC while daylight time is in force and 06:00 UTC under standard time, never at UTC midnight.
- For example, with the clock started at 2026-11-01T04:59:30Z (11:59:30 PM CDT on October 31):
  - Today is 2026-10-31 until 2026-11-01T05:00:00Z, and 2026-11-01 from that instant.
  - A version effective 2026-11-01 published in those first 30 seconds is "Scheduled" and can be withdrawn.
  - From 05:00:00Z, a version effective 2026-11-01 is "In force". Withdrawing it answers 409 `price_list_in_force`, and `GET /api/price-lists/current` returns it.
  - Quote `valid_until` is 2026-11-07 before the change and 2026-11-08 after it.

**Formats**

- `$<amount>`: dollars with a comma every three digits and two decimals ("$1,120.50").
- `<date>`: month name, day and year in the store's time zone ("November 3, 2026").
- `<date-time>`: the same date plus hour, minute, AM/PM and the zone abbreviation in force at that instant, "CDT" or "CST" ("November 2, 2026, 5:00 PM CST").
- `<tax percent>`: `tax_rate_bp` ÷ 100 with two decimals, followed by "%" ("8.25%").
- `<instrument>` in visible copy: the instrument name with a capital first letter, as on the Instrument radios.
- `<size>` in visible copy: "1/4", "1/2", "3/4" or "4/4" for violins and cellos, and "Full size" for flute, clarinet and trumpet. For example: "That 1/2 Cello is no longer available.", `button "Reserve 3/4 Cello"`, and the radio "Full size, 1 available".
- `<instrument label>`: the size followed by the instrument name for violins and cellos ("1/2 Cello"), and the instrument name alone for flute, clarinet and trumpet ("Trumpet").
- API size values: `full` for flute, clarinet and trumpet; `1/4`, `1/2`, `3/4` or `4/4` for violin and cello. These appear only in API bodies and the CSV Size column, never in visible copy.

**Roles**

- The owner reaches everything.
- The tech reaches instruments, contracts and condition records. The tech does not reach money actions, invoices, equity statements, quotes, agreement or bill-of-sale PDFs, price lists, families or schools.
- A parent reaches only their own family's students and those students' contracts.
- A director reaches only their own school's roster.

**Sign-in landing**

- Signed-in routes are open by role:
  - `/register`: owner and tech
  - `/contracts/<id>`: owner, tech and parent
  - `/family` and `/reserve`: parent
  - `/price-lists` and `/schools`: owner
  - `/roster`: director and owner
- A signed-out request for one of these routes goes to `/?next=<the path and query, percent-encoded as a URL component>`. For example, `/contracts/C-1003?month=9` goes to `/?next=%2Fcontracts%2FC-1003%3Fmonth%3D9`.
- After sign-in, and for a signed-in visitor at `/?next=…`, the user lands on `next`, query included, only if both hold:
  - it starts with exactly one "/" followed by a character that is neither "/" nor "\"
  - its route is open to the user's role
- Otherwise the user lands on their role's home. This covers a missing `next`, `//evil.example/x`, an off-site address, `/sign/…`, an unknown route, and a route of another role (for example `/register` for a parent).
- A parent who lands on a contract they may not see gets the Contract not found screen.

**Instruments**

- An instrument's status is one of:
  - `available`
  - `on_contract`: on an open contract (reserved, agreement_sent, signed or active)
  - `sold`: its contract is paid_off
  - `retired`: written off, or seeded as retired
- `available` for a type and size is the count of instruments with that status.
- A serial is unique across the fleet and is 3 to 20 characters of capital letters, digits and hyphens.
- Model and student names are 1 to 80 characters after trimming.
- Grade is a whole number from 0 (kindergarten) to 12.
- Size must be valid for the type, and the family and school must exist.

**Reservations**

Checks run in this order:

1. The student must belong to the caller's family (otherwise 404).
2. The student must have no open contract (otherwise 409 `student_has_instrument`). This is checked before the request fields and before availability.
3. Type, size and waiver must be valid (otherwise 422).
4. An instrument of that type and size must be available. Otherwise the answer is 409 `unavailable` with message "No longer available", and its `alternatives` list every size of the same instrument that has at least one available unit, in size order.

On success:

- The server takes the available instrument of that type and size whose serial sorts first alphabetically.
- It creates a contract in `reserved` with `hold_expires_at` set to now plus the hold window.
- Before signing, the terms shown are the price list in force today, with `bound:false`.

**One winner**

- No instrument is ever on two open contracts, however many reservations or exchanges arrive at once.
- Of N simultaneous requests for the last unit, exactly one gets 201. The others get the 409 unavailable answer.

**Contract IDs**

- Contract IDs are "C-" followed by a number drawn from one database sequence that starts at 1004 (C-1004, C-1005, …).
- Simultaneous reservations or exchanges, on one instance or on several instances sharing the database, never receive the same ID.
- Other new IDs, including new price list, payment, reversal, event and photo IDs, are server-chosen strings.

**Delivery days and cutoffs**

- Each school has one delivery weekday. Delivery days are calendar dates in the store's time zone.
- The cutoff for delivery day D is 5:00 PM store wall-clock time on the calendar day before D. That local time always exists and never repeats. So `cutoff_at` is that local time converted with the UTC offset in force that evening: 22:00 UTC under Central Daylight Time and 23:00 UTC under Central Standard Time. For example, Thursday October 29, 2026 has `cutoff_at` 2026-10-28T22:00:00Z, and Tuesday November 3, 2026 has 2026-11-02T23:00:00Z.
- A reservation's `delivery_date` is the earliest date D on the school's delivery weekday whose cutoff is strictly later than the server's clock at the moment the reservation is received.
  - At the exact cutoff instant and after it, that day is no longer available.
  - Client clocks, zones and any time field in the request are ignored.
- `next_delivery_date` and `cutoff_at` in the school listing follow the same rule, computed at request time and never cached.
- `upcoming_delivery_days` lists four entries: `next_delivery_date` and the three same-weekday dates after it, each with its own `cutoff_at`.
- `delivery_date` is fixed at reservation. A successor contract gets a fresh one at exchange.
- Hold deadlines are measured in exact elapsed seconds, not wall-clock time. A hold that spans the autumn clock change therefore ends one wall-clock hour earlier than it started.

Examples:

- **Clock started at 2026-10-31T21:30:00Z.**
  - Larkspur's upcoming days are 2026-11-03 (cutoff 2026-11-02T23:00:00Z), 2026-11-10, 2026-11-17 and 2026-11-24, each with a 23:00 UTC cutoff the day before.
  - Ferncliff's first upcoming day is 2026-11-05 (cutoff 2026-11-04T23:00:00Z).
  - A reservation made within that minute with the default hold shows "Hold until November 2, 2026, 3:30 PM CST".
- **Clock started at 2026-11-02T22:30:00Z** (4:30 PM CST that Monday): a reservation for a Larkspur student gets `delivery_date` 2026-11-03.
- **Clock started at 2026-11-04T22:59:40Z.**
  - Until 23:00:00Z, Ferncliff's `next_delivery_date` is 2026-11-05. A reservation gets 2026-11-05, and a notice for 2026-11-05 is accepted.
  - From 2026-11-04T23:00:00.000Z, Ferncliff's upcoming days start at 2026-11-12. New reservations get 2026-11-12, and a notice for 2026-11-05 answers 422 field `delivery_date`.
  - The reservation made before the cutoff keeps 2026-11-05.
- **Clock started at 2026-11-04T22:59:10Z, with a Ferncliff student chosen on Reserve.**
  - Before 23:00:00Z the line reads "Reserve before November 4, 2026, 5:00 PM CST for delivery day November 5, 2026." Within 2 seconds after it, the line reads "Reserve before November 11, 2026, 5:00 PM CST for delivery day November 12, 2026."
  - On the Schools page, Ferncliff's day options become November 12, November 19, November 26 and December 3, 2026. Larkspur's stay November 10, 17 and 24 and December 1, 2026.

**Contract states and moves**

Any move not listed here answers 409 `invalid_transition` and changes nothing.

| From | To | How |
|---|---|---|
| (new) | `reserved` | Parent reserves |
| `reserved` | `agreement_sent` | Owner sends the signing link |
| `agreement_sent` | `agreement_sent` | Owner sends the link again; the old link dies |
| `reserved`, `agreement_sent` | `expired` | The hold deadline passes |
| `agreement_sent` | `signed` | Parent signs through a live link |
| `signed` | `active` | Owner activates |
| `active` | `exchanged` | Owner exchanges the size |
| (new) | `active` | The successor created by an exchange |
| `active` | `paid_off` | Buyout, or a payment that brings equity to the purchase price |
| `active` | `returned` | Owner marks it returned |
| `active` | `written_off` | Owner writes it off |

- `expired`, `exchanged`, `paid_off`, `returned` and `written_off` are terminal.
- Instruments follow their contract:
  - Expired, exchanged and returned contracts put their instrument back to `available`.
  - Paid-off makes it `sold`.
  - Written-off makes it `retired`.
- Every move out of `active` commits only after Kill Bill confirms the subscription cancelled (Services).
- Payment reversals change equity but are not state moves.

**Contract history**

Every move in the table above, and nothing else, appends exactly one entry to the contract's `history` in the same step as the move. Revoking a link, payments that don't pay off, reversals and condition checks add no entry.

| Move | `actor` | `actor_name` |
|---|---|---|
| Reservation (`from:null`) | `parent` | the parent's name |
| Sending and re-sending the link | `owner` | the owner's name |
| Signing | `parent` | the typed full name, trimmed |
| Activation, exchange (on the old contract), return, write-off | `owner` | the owner's name |
| Successor creation (`from:null` → `active`) | `owner` | the owner's name |
| Buyout | the caller's role (`owner` or `parent`) | the caller's name |
| A payment that pays off | `owner` | the owner's name |
| Hold expiry | `system` | `null` |

- `at` is the clock time of the move.
- For an expiry, `at` equals `hold_expires_at` exactly, whenever the expiry is first noticed. The entry is recorded exactly once, however many requests or surfaces read the contract.
- Rejected requests (any 4xx or 503) append nothing.
- Entries are never edited or deleted, and no endpoint changes them.
- Each `list "Contract history"` item reads "<date-time> · <from, or new> → <to> · <actor>".
  - `<from>` and `<to>` are the status values.
  - `<actor>` is `actor_name`. An owner entry without a name shows "Keel & Bell", and a system entry shows "System".

**Holds**

- The hold window is `RESERVATION_HOLD_SECONDS` seconds (default 172800, which is 48 hours).
- From `hold_expires_at` onward, an unsigned contract is `expired` on every surface, with no request needed to trigger it. Any request at or after the deadline sees:
  - the contract as expired and its instrument as available (including in `GET /api/availability`)
  - its signing link answering `link_expired`
  - its roster row, roster counts and family totals updated accordingly
  - its expiry history entry
- Signed contracts never expire.
- Once an expiry is recorded, it stands on every instance that reads that database. Nothing un-expires a contract.

**Signing links**

- Sending creates a link `/sign/<token>`, where the token is random, URL-safe and at least 128 bits.
- `link_expires_at` is whichever comes first: send time plus `SIGNING_LINK_TTL_SECONDS` seconds (default 86400, which is 24 hours), or the hold deadline.
- Only the newest link works:
  - Earlier or revoked tokens answer 404 `link_not_found`.
  - A link already used to sign answers 410 `link_used`.
  - A link at or past its expiry answers 410 `link_expired`, on load and on submit.
- Revoking leaves the contract in `agreement_sent` with no live link, and the owner may send again.
- A token reaches only its own agreement.

**Signing**

- `full_name` must be 2 to 120 characters after trimming, and `agree` must be `true`.
- On success, in this order:
  1. The server binds the contract to the price list in force today.
  2. It produces and stores the signed agreement PDF.
  3. It moves the contract to `signed` with `signed_at`.
- The PDF starts with `%PDF-`. Its text is uncompressed, so these values appear as plain text in the file:
  - the contract ID, student name, serial, instrument label and price list ID
  - the bound monthly base rent, the monthly waiver (only if chosen) and the purchase price, each as `$<amount>`
  - the sentence "Sales tax at <tax percent> (the rate in force when billed applies)." using the rate in force at signing
  - the term as "<term months> months", and each tier as its `label`
  - the typed full name, trimmed
  - the signing time as `<date-time>`
- If storing fails, nothing changes and the link stays live.

**Activation**

- Activation needs the contract's signed PDF to be present in object storage (otherwise 409 `agreement_not_stored`).
- It also needs the contract's Kill Bill account and subscription (Services).
- It sets `activated_at`, the billing anchor and `subscription_state` "active".
- Of any number of simultaneous activations of one `signed` contract, exactly one answers 200. Every other copy waits for the winner and then answers 409 `invalid_transition`. The result is exactly one Kill Bill account, one subscription and one `signed → active` history entry.

**Price lists**

- A price list version holds:
  - a sales tax rate (`tax_rate_bp`)
  - the monthly base rent, monthly waiver and purchase price for each of the five instrument types
  - a stepped discount schedule
- Versions are never edited or deleted.
- **In force.** The version in force on date D is the version that is not withdrawn and has the latest `effective_date` on or before D. When several versions share that date, the one created most recently wins. A withdrawn version is never in force on any date, never binds a contract and never supplies a tax rate.
- **Validation** (every failure is reported at once, with the keys and messages in API):
  - `effective_date` is today or later.
  - `tax_rate_bp` is a whole number from 0 to 2,000.
  - `items` has exactly one entry per type, with:
    - base rent from 100 to 100,000 cents
    - waiver from 0 to 10,000 cents
    - purchase price from 1,000 to 1,000,000 cents, and at least the base rent
  - `tiers` has 1 to 6 entries:
    - the first `from_month` is 0
    - each next `from_month` is the previous `to_month` plus 1
    - each non-null `to_month` is at least its own `from_month`
    - only the last `to_month` is `null` (open-ended)
    - `percent` is a whole number from 0 to 90
    - `name` is 1 to 30 characters
- A tier's `label` is "<name>, <percent>% off remaining".
- **Withdrawal.** A version can be withdrawn only while its `effective_date` is later than today. After the 404 check:
  1. An already withdrawn version answers 409 `price_list_withdrawn`.
  2. A version effective today or earlier answers 409 `price_list_in_force`.

  Withdrawal sets `withdrawn_at`. Afterwards, the version in force on every date, and so every unsigned reservation's displayed terms and every invoice, is exactly what it would be had the version never been published. For example, `GET /api/price-lists/current?on=<that date>` answers byte for byte as it did before publication.
- **Standing words**, in this order of precedence:
  1. "Withdrawn" when withdrawn.
  2. "In force" for the version in force today.
  3. "Scheduled" when its effective date is later than today.
  4. "Superseded" otherwise.

**Terms binding and sales tax**

- A contract is bound at signing to the version in force on its signing date. An exchange successor inherits its predecessor's version and waiver choice.
- Once signed, every surface of the contract takes base rent, waiver, purchase price, term and tiers from its bound version. That includes the contract body, invoice, quotes, payment split, buyout, receipt, agreement PDF and bill of sale.
- Sales tax never follows the bound version:
  - The monthly invoice uses the `tax_rate_bp` of the version in force on its billing date. That may be a scheduled version.
  - Everything charged or quoted today uses the version in force today: the contract body's `terms.tax_rate_bp`, the payment split, quotes, the buyout and the receipt.
  - A reversal reuses the payment's stored parts and never recomputes tax.
- Unsigned contracts show every term from the version in force today.
- `term_months` is the purchase price ÷ base rent, rounded up to a whole month.
- For example, suppose the owner publishes a version effective today with `tax_rate_bp` 900 and different rents:
  - C-1003's invoice becomes $45.00 + $9.00 + $4.86 = $58.86.
  - C-1001 keeps rent $18.00, and its tax line becomes $1.98.
  - $100.00 on C-1003 then splits into $76.45 rent, $15.29 waiver and $8.26 tax.
  - A contract signed afterwards uses the new rents and 9.00%.

**Rounding**

Every computed money line is rounded once, to the cent, half up (a half cent always rounds up), using exact integer arithmetic.

**Billing dates**

- An active contract's billing anchor (`billing_anchor_date`) is the store date of its `activated_at`. An exchange successor keeps its predecessor's anchor.
- Billing date k (k ≥ 1) is the anchor plus k calendar months. When that month has no such day, it is the month's last day. Every billing date is computed from the anchor, never from the previous billing date.
- `next_billing_date` is the first billing date on or after today. It and the anchor are `null` on contracts that are not active, except that the anchor stays set on terminal contracts that were once active.
- Examples:
  - With the clock started at 2027-01-31T18:00:00Z, a contract activated then has anchor 2027-01-31 and `upcoming_billing_dates` 2027-02-28, 2027-03-31, 2027-04-30, 2027-05-31.
  - With the clock started at 2026-10-31T21:30:00Z, `next_billing_date` is 2026-11-04 for C-1001, 2026-11-02 for C-1002 and 2026-11-03 for C-1003.

**Monthly invoice**

- Lines, in order: base rent, the waiver (only if chosen), sales tax.
- Sales tax is (base rent + waiver) × the invoice's `tax_rate_bp` ÷ 10,000, rounded. The total is the sum of the lines.
- On an active contract:
  - `billing_date` is `next_billing_date`.
  - `upcoming_billing_dates` is that date and the following three.
  - `tax_rate_bp` is that of the version in force on `billing_date`.
- On any other contract, `billing_date` is `null`, `upcoming_billing_dates` is empty, and tax uses today's rate.
- For example, with the seed data at start:
  - C-1001: $18.00 + $4.00 + $1.82 = $23.82
  - C-1002: $26.00 + $2.15 = $28.15
  - C-1003: $45.00 + $9.00 + $4.46 = $58.46
- For example, with the clock started at 2026-10-31T21:30:00Z, the owner publishes a version effective 2026-11-03 with `tax_rate_bp` 900:
  - C-1003's invoice (billing 2026-11-03) becomes $58.86.
  - C-1002's invoice (billing 2026-11-02) stays $28.15.
  - A $100.00 payment on C-1003 that day still splits $76.97 / $15.40 / $7.63.
  - Withdrawing that version restores C-1003's invoice to $58.46 byte for byte.

**Payments**

- Only active contracts take payments.
- `amount_cents` is a whole number from 1 to 1,000,000.
- The split uses today's figures:
  - w = the waiver line
  - t = (base rent + waiver) × today's `tax_rate_bp` ÷ 10,000, rounded
  - T = base rent + w + t
- Then:
  - tax part = amount × t ÷ T, rounded
  - waiver part = amount × w ÷ T, rounded
  - base part = amount − tax part − waiver part
- The three parts always add up to the amount.
- If the base part is more than the purchase price minus equity, the answer is 422 `{"fields":{"amount_cents":"exceeds_remaining"}}` and Kill Bill is never called.
- The base part is credited as equity.
- If equity then equals the purchase price, the contract becomes `paid_off` in the same step, the bill of sale is stored (see Bill of sale), the subscription is cancelled (Services) and the ownership letter is queued.
- The stored parts never change afterwards.
- For example, with the seed data at start, $100.00 on C-1003 splits into $76.97 rent, $15.40 waiver and $7.63 tax.

**Payment reversals**

- Only payments on an `active` contract can be reversed. After the 404 checks:
  1. A contract in any other state answers 409 `invalid_transition`. This covers a paid-off contract and payments left on an exchanged predecessor.
  2. The idempotency conflict check runs.
  3. An already reversed payment answers 409 `payment_reversed`.
  4. Then `reason` is validated.
- A reversal first records one Kill Bill REFUND for the payment's full amount on the original Kill Bill payment (Services). Only after that succeeds does it write, in one step, a `reversal` ledger entry of minus the payment's stored base part, carrying the `payment_id`. The payment entry then shows `reversed: true`.
- The reversal body repeats the payment's stored amount, base, waiver and tax parts exactly, whatever the tax rate is today.
- A reversal notice email is queued.
- A reversal adds no history entry.
- For example, take $100.00 on C-1003 at seed (7,697 / 1,540 / 763). After a version with `tax_rate_bp` 900 takes effect, reversing that payment still refunds $100.00 with parts 7,697 / 1,540 / 763 and removes 7,697 cents of equity, so equity returns to 67,500.

**One action at a time per contract**

- These actions on one contract are taken strictly one at a time: activation, payments, reversals, buyouts, exchanges, returns and write-offs.
- A request that arrives while another is in progress on the same contract waits for it to finish, then runs its own checks against the result.
- The remaining-balance check therefore always sees every earlier committed payment and reversal, and it runs before Kill Bill is charged. Equity never exceeds the purchase price.
- For example, two simultaneous payments on a contract with $X remaining, each with a base part of 60% of $X, give one 201 and one 422 `exceeds_remaining`, with a single Kill Bill transaction.
- When a payment that brings equity to the price races a buyout:
  - The contract becomes `paid_off` once, with one terminal history entry and one bill of sale.
  - The loser answers 409 `invalid_transition`, or 409 `quote_changed` if it was judged against an old quote.
  - The loser never causes a second Kill Bill charge.

**Idempotency** (payments, reversals, buyouts, exchanges)

- `Idempotency-Key` is required (otherwise 422 field `idempotency_key`). It is 1 to 100 printable ASCII characters, scoped to the contract and endpoint. For reversals, the payment ID in the path counts as part of the body.
- **Replay.** A replay with the same key and the same body returns the first stored status and body byte for byte. It creates no ledger entry, Kill Bill transaction, email, stored object or history entry.
- **In flight.** A copy that arrives while the first request with that key is still in progress waits for it, then returns its stored response. Of N simultaneous copies, exactly one is processed and all N receive identical responses. For example, five simultaneous exchange copies with one key give five identical 201 bodies, one successor, one transfer pair, one new Kill Bill account and subscription, and one `active → exchanged` history entry.
- **Conflict.** The same key with a different body answers 409 `idempotency_conflict`.
- **Stored answers.** 503 answers are not stored, so retrying a key after recovery processes it normally, adopting any Kill Bill transaction the failed attempt left (Services). 4xx answers are stored like successes. A new key on a contract that has already moved on gets that state's answer, for example 409 `invalid_transition` for a second exchange of an exchanged contract.

**Equity ledger**

- Entries are signed cents with a `kind`: `opening` (seed only), `payment`, `reversal`, `exchange_out`, `exchange_in` or `buyout`.
- Equity is always the sum of a contract's entries. Entries are never edited or deleted.
- A contract's ledger is `closed` once the contract is terminal, and takes no further entries.
- The Entry column words are:

  | Kind | Entry text |
  |---|---|
  | `opening` | "Opening balance" |
  | `payment` | "Payment <payment id>" |
  | `reversal` | "Reversal of <payment id>" |
  | `exchange_out` | "Exchange out to <successor id>" |
  | `exchange_in` | "Exchange in from <predecessor id>" |
  | `buyout` | "Buyout" |

**Contract month**

The contract month is equity ÷ base rent, rounded down to a whole month.

**Exchange**

Checks run in this order:

1. The contract must be `active`. Any other status, including signed, returned or exchanged, answers 409 `invalid_transition`.
2. The instrument must be a violin or cello. An active flute, clarinet or trumpet contract answers 409 `not_exchangeable`.
3. `size` must be larger than the current size of the same instrument (otherwise 422 field `size`).
4. The new unit is chosen as for reservations, with the same 409 unavailable answer.

On success, in one step after the Kill Bill steps in Services:

- The old contract becomes `exchanged` with `successor_id`.
- A successor contract for the same student is created directly in `active`. It has `predecessor_id`, the inherited terms and billing anchor, a fresh delivery date and the predecessor's signing time.
- The old signed PDF is copied to the successor's key.
- One transfer posts `exchange_out` of −E on the old contract and `exchange_in` of +E on the new one, sharing one `transfer_id`, where E is the old equity. The pair is posted even when E is 0.

Total equity across the two contracts is unchanged.

**Quotes**

- Quotes exist for `signed` and `active` contracts only. Others answer 409 `no_quote`.
- `month` is a whole number from 0 to `term_months` (otherwise 422).
- With current equity E, base rent b, purchase price P and current month m:
  - Equity at month N is N × b when N < m, and the smaller of P and E + (N − m) × b when N ≥ m.
  - remaining = P − equity.
  - The tier is the one whose month range contains N.
  - discount = remaining × percent ÷ 100, rounded.
  - payoff = remaining − discount.
  - tax = payoff × today's `tax_rate_bp` ÷ 10,000, rounded.
  - total = payoff + tax.
- `paid` is true when N ≤ m.
- `valid_until` is today plus 7 days.
- For example, with the seed data at start:
  - C-1001 month 9 pays off at $264.60 (Year 1, 30%), with $21.83 tax and a $286.43 total.
  - C-1001 month 12 pays off at $226.80, and month 13 at $244.80 (After, 20%).
  - C-1002 month 3 pays off at $452.40.
  - C-1003 month 15 pays off at $900.00 + $74.25 tax = $974.25.

**Buyout**

- Only active contracts can be bought out.
- `expected_payoff_cents` must be a whole number (otherwise 422). It must equal the current month's `payoff_cents`; otherwise the answer is 409 `quote_changed` carrying the fresh quote.
- The buyout is all or nothing:
  1. The bill of sale is written (see Bill of sale).
  2. The one Kill Bill charge for the current month's `total_cents` succeeds, or an earlier one is adopted.
  3. The subscription is confirmed cancelled.
  4. Then, in one step:
     - The contract becomes `paid_off` with `closed_at`.
     - A `buyout` entry of `remaining_cents` brings equity to the purchase price. Tax is never equity.
     - The ledger closes and the instrument becomes `sold`.
     - The history entry is appended and the ownership letter is queued.
- If any part fails, none of this remains in Bellroll or storage. A Kill Bill charge already confirmed stays under its external key and is adopted on retry (Services).

**Bill of sale**

- Every move to `paid_off`, whether by buyout or by a payment that reaches the purchase price, stores a bill of sale PDF.
- The steps run in this order:
  1. Confirm storage is reachable.
  2. Write the PDF.
  3. Do the Kill Bill steps (Services).
  4. Commit.
- If any Kill Bill step fails, the PDF is deleted before the 503 answer.
- The bill of sale object exists if and only if the contract is `paid_off`. `bill_of_sale_stored` reports it.
- The PDF starts with `%PDF-`, and its text is uncompressed. It contains:
  - the contract ID, parent name, student name, instrument label and serial
  - "Paid in full"
  - the amount paid at close as `$<amount>`: the buyout total including tax, or the final payment's amount
  - the close time as `<date-time>`
- The bill of sale download answers 404 `bill_of_sale_not_stored` on any contract without one.

**Condition checks**

- Allowed on `signed`, `active`, `exchanged` and `returned` contracts. Others answer 409 `contract_not_open`, before any field or photo check.
- Field and photo checks then run in this order, and the first failure answers:
  1. `kind` is one of the three values (otherwise 422 field `kind`).
  2. `notes` is at most 1,000 characters (otherwise 422 field `notes`).
  3. `photos` holds 1 to 6 files (otherwise 422 `{"fields":{"photos":"count"}}`).
  4. Each photo in upload order, completing all three checks on one photo before moving to the next. Each refusal carries that photo's `photo_index`.
     - **Size:** at most 5,000,000 bytes, and exactly 5,000,000 is allowed. Larger answers 413 `photo_too_large`.
     - **Content:** JPEG, PNG or WebP, judged by its bytes, not its name or declared type. Anything else answers 415 `unsupported_image`, including SVG, GIF, HEIC, PDF and files that fail to decode.
     - **Dimensions:** at most 8,000 pixels wide and 8,000 pixels high, and 8,000 is allowed. Larger answers 422 `{"fields":{"photos":"dimensions"}}`.
- **All or nothing:**
  - Every check on every photo finishes before any object is written, so a refused upload writes nothing anywhere.
  - Accepted photos are written under the new event's prefix.
  - The event and its photo records are committed only after every object is stored.
  - If any write fails, every object already written for that request is deleted before the 503 answer.
  - At every moment, the objects under a contract's condition prefix are exactly the photos of its recorded events.
- **Processing:**
  - Accepted photos are decoded and re-encoded as JPEG, at the same pixel width and height as stored in the source file. Orientation tags are not applied.
  - All metadata is removed: no EXIF, XMP or location segments.
  - Photos are stored under server-chosen names. Uploaded file names are never used or echoed.
  - Photo IDs are random, URL-safe and at least 128 bits.

**Roster**

- One row per student at the school, sorted by student name.
- The current contract is the student's most recently created contract that is not `expired`, judged at request time with the hold rule above. After an exchange, that is the successor.
- `delivery_status` depends on the current contract:

  | Current contract | `delivery_status` | Shown as |
  |---|---|---|
  | none | `no_instrument` | "No instrument" |
  | `reserved` or `agreement_sent` | `awaiting_agreement` | "Awaiting agreement" |
  | `signed` | `scheduled` | "Scheduled for delivery" |
  | `active` | `delivered` | "Delivered" |
  | `paid_off` | `owned` | "Owned" |
  | `returned` or `written_off` | `no_instrument` | "No instrument" |

- `counts` holds one key per `delivery_status`. Each is the number of `students` rows with that status in the same response, so the counts always add up to the row count.
- Directors never see parent names, emails, phones, addresses, payment details, equity, balances or any amount.

**Roster CSV**

- One data row per RosterRow, in the same order as the roster JSON. There is no summary row, and the columns never depend on screen width.
- The header is `Student,Grade,Instrument,Size,Serial,Delivery date,Delivery status`.
- Cells come from each RosterRow:

  | Column | Value |
  |---|---|
  | Student | `student_name` |
  | Grade | `grade` as a whole number |
  | Instrument | the instrument label, empty when `null` |
  | Size | the API `size` value, empty when `null` |
  | Serial | `serial`, empty when `null` |
  | Delivery date | `delivery_date` as `YYYY-MM-DD`, empty when `null` |
  | Delivery status | the shown word for `delivery_status` |

- Quoting is standard comma-separated quoting.
- Any cell whose first character is `=`, `+`, `-`, `@`, a tab or a carriage return gets a single apostrophe in front.

**Family totals**

- `totals.open_contracts` is the number of the family's contracts in `reserved`, `agreement_sent`, `signed` or `active`.
- `totals.equity_cents` is the sum of `equity_cents` over those contracts.
- `totals.owned` is the number of the family's `paid_off` contracts.
- Totals are computed at request time, under the hold rule, from the caller's own family only. In practice:
  - A lapsed hold drops out of `open_contracts` from its deadline.
  - A payoff moves the contract from open to owned and removes its equity from `equity_cents`.
  - A reversal lowers `equity_cents` by exactly its base part.
  - An exchange leaves `equity_cents` and `open_contracts` unchanged.
  - Another family's payments, reversals, reservations or exchanges never change them.
- For example, with the seed data at start, F-01's totals are 2 open contracts, 83,700 cents and 0 owned.

**Delivery-day manifest**

- A school's manifest for date D is every contract of that school with `delivery_date` D in `reserved`, `agreement_sent`, `signed` or `active`.
- `delivery_date` in a notice request must be one of the school's four `upcoming_delivery_days` at request time (otherwise 422).

**Starting state**

- On every start, the server makes sure the schema and the seed exist, under one Postgres advisory lock.
- The seed is written only into a database that has never been seeded. A database already seeded is left exactly as it is.
- So however many instances start at once against one database:
  - Each seeded contract has exactly one `opening` entry and one history entry.
  - PL-2024-01 exists once.
  - The fleet holds exactly the 16 seeded instruments plus any the owner added.

### Services (DP-05, DP-07, DP-09, DP-11, DP-13, DP-16, DP-19, DP-33, DP-34, DP-35, DP-46, DP-55, DP-57, DP-66, DP-67, DP-68)

**Kill Bill**

- **Accounts and subscriptions:**
  - Every contract that is or was active has a Kill Bill account with `externalKey` set to the contract ID and currency USD. It is named for the parent and has an external payment method as its default.
  - Each account has one subscription with external key `<contract id>-rental` on plan `bellroll-rental-monthly` (product `Rental`, monthly). The plan's recurring price is $0.00, because Bellroll records every payment itself. The app uploads the catalog it needs to the tenant when it is missing.
  - Before creating an account or subscription, the app looks it up by its external key and reuses one that exists. An earlier attempt that stopped after creating it therefore never leads to an error or a duplicate.
  - Any action on an active contract that needs Kill Bill first makes sure both exist. Seeded contracts get theirs the first time an action needs them.
  - `subscription_state` is "active" once Bellroll has created or found the subscription, "cancelled" once Bellroll has confirmed it cancelled, and `null` before either.
- **Transactions and their keys:**

  | Action | Kill Bill transaction | Payment and transaction external key |
  |---|---|---|
  | Payment | one PURCHASE on the contract's account for the payment amount, in dollars with two decimals | `<contract id>-pay-<idempotency key>` |
  | Reversal | one REFUND on the original payment for its full amount; the original payment then shows a PURCHASE and a REFUND of equal amounts | transaction key `<contract id>-reversal-<payment id>` |
  | Buyout | one PURCHASE for the quote's `total_cents` (payoff plus sales tax), in dollars | `<contract id>-buyout` |

  A payment's transaction must succeed before any ledger entry is written.
- **Adoption.** Before every charge or refund, the app looks up the transaction external key in Kill Bill:
  - A successful transaction of the same amount is adopted and nothing new is charged or refunded. The ledger entry, parts, receipt or notice are then written as usual.
  - A successful transaction of a different amount answers 409 `idempotency_conflict`, and nothing is written anywhere.
  - A transaction under the key that did not succeed is not adopted, and the app tries again under the same keys.
- **Closing a contract.** Return, write-off, exchange (on the old contract) and every payoff:
  - cancel the contract's subscription with `entitlementPolicy=IMMEDIATE` and `billingPolicy=IMMEDIATE`
  - read it back, and commit the move only once Kill Bill shows it `CANCELLED`
  - create the account and subscription first (looked up by key first) for a seeded contract that has none, then cancel it, so every closed contract that was once active has a cancelled subscription
  - treat a subscription found already `CANCELLED` (left by an interrupted earlier attempt) as done, and complete the move
- **Order within one action:**
  1. Storage steps: check reachability, then write the bill of sale or copy the agreement.
  2. The charge, after the adoption look-up.
  3. Cancelling the old subscription and reading it back.
  4. For an exchange, the successor's account and subscription.
  5. The Postgres commit and the emails.
- **Outage.** When Kill Bill is unreachable, errors, or does not read the subscription back as `CANCELLED`, these answer 503 `{"error":{"code":"billing_unavailable","message":"Billing is unreachable. Nothing was changed."}}`:
  - activation
  - payment and reversal
  - buyout and exchange
  - return and write-off

  Bellroll's records and email stay unchanged, and objects written for the action are deleted. When Kill Bill is unreachable, nothing changes in any system. If Kill Bill fails after confirming an earlier step of the same action, that confirmed effect stays under its published key and is adopted, never repeated, when the action is retried.

**MinIO** (bucket `S3_BUCKET`)

- **Object keys:**

  | Object | Key | Type | Notes |
  |---|---|---|---|
  | Signed agreement | `contracts/<contract id>/agreement-signed.pdf` | `application/pdf` | Seeded contracts report `agreement_stored` `true` from the start. Their PDF is generated and stored on the first agreement PDF download or the first exchange of that contract, never on a read of the contract body. It has the contents listed under Signing, printing the family's parent name as the typed full name and the contract's `signed_at` as the signing time |
  | Bill of sale | `contracts/<contract id>/bill-of-sale.pdf` | `application/pdf` | |
  | Condition photo | `contracts/<contract id>/condition/<event id>/<photo id>.jpg` | `image/jpeg` | The photo IDs equal the event's `photos[].id` |

- **Access:** objects are never exposed directly or through presigned links. They are streamed only by the authorised endpoints.
- **Outage.** When storage is unreachable or errors, these answer 503 `{"error":{"code":"storage_unavailable","message":"File storage is unreachable. Nothing was changed."}}` and change nothing:
  - signing, activation and exchange
  - buyout, and a payment that would pay the contract off; both answer before any Kill Bill call
  - condition upload
  - the agreement, bill-of-sale and photo downloads

  A payment that does not pay off, a reversal, a return and a write-off do not need storage, and they still succeed while it is down. An action that needs both services checks storage first.

**Mailpit (SMTP)**

- Every email is sent from `MAIL_FROM`: `Keel & Bell Music <rentals@keelandbell.example>`.
- Emails are queued in the same step as the action and delivered within 10 seconds while SMTP is reachable. They are retried until delivered and never duplicated by an idempotent replay, an in-flight copy or an adopted Kill Bill transaction.
- `<origin>` is `APP_PUBLIC_URL` when set, otherwise `http://localhost:<port>`.

| Email | To | Subject | Body includes |
|---|---|---|---|
| Signing link | the family's parent | "Sign your rental agreement — <student name>, <instrument label>" | the link `<origin>/sign/<token>` and the link expiry date-time |
| Receipt (each recorded payment) | parent | "Payment received — <contract id>" | the amount, the three parts, the tax rate applied as `<tax percent>`, the new equity, and the link `<origin>/contracts/<contract id>?month=<contract month>`, where `<contract month>` is the contract's `contract_month` after the payment, as a whole number |
| Reversal notice (each reversal) | parent | "Payment reversed — <contract id>" | the payment ID, the reason word, the amount refunded, the three parts, the equity removed, the new equity, and the link `<origin>/contracts/<contract id>` |
| Ownership letter (buyout or final payment) | parent | "You own it — <instrument label> <serial>" | the student, serial and purchase price; the amount paid at close as defined for the bill of sale; the link `<origin>/api/contracts/<contract id>/bill-of-sale.pdf` |
| Delivery-day notice | the school's director | "Delivery day <date> — <school name>" | one line per manifest student, "<student name> — <instrument label> — <serial>"; nothing about parents, contacts or money |

Reason words: `returned_check` is "Returned check", `chargeback` is "Chargeback", and `entered_in_error` is "Entered in error".

### Seed data (DP-01, DP-02, DP-10, DP-18, DP-24, DP-28, DP-37, DP-43, DP-44, DP-58, DP-59)

Every person, family, school and business here is invented. The seed is applied once per database, as described under Starting state.

**Store:** Keel & Bell Music, time zone America/Chicago. The sales tax rate lives in each price list version.

**Users:**

| Role | Name | Email | Password |
|---|---|---|---|
| owner | Dana Whitlock | owner@keelandbell.example | brass-owner-2026 |
| tech | Ira Penhallow | tech@keelandbell.example | brass-tech-2026 |
| director (larkspur) | Celia Marrow | cmarrow@larkspur.example | baton-larkspur-2026 |
| director (ferncliff) | Tomás Ibarra | tibarra@ferncliff.example | baton-ferncliff-2026 |
| parent (F-01) | Robin Alder | robin.alder@example.com | family-alder-2026 |
| parent (F-02) | Sam Brandt | sam.brandt@example.com | family-brandt-2026 |
| parent (F-03) | Lee Castellanos | lee.castellanos@example.com | family-castellanos-2026 |
| parent (F-04) | Avery Dunmore | avery.dunmore@example.com | family-dunmore-2026 |

**Family contact details:**

| Family | Phone | Address |
|---|---|---|
| F-01 | 555-0101 | 14 Orchard Row |
| F-02 | 555-0102 | 9 Mill Lane |
| F-03 | 555-0103 | 220 Quarry Road |
| F-04 | 555-0104 | 3 Tannery Court |

**Schools:**

| ID | Name | Delivery day |
|---|---|---|
| `larkspur` | Larkspur Middle School | Tuesday |
| `ferncliff` | Ferncliff Elementary | Thursday |

**Students:**

| ID | Name | Grade | School | Family |
|---|---|---|---|---|
| S-01 | Juniper Alder | 7 | larkspur | F-01 |
| S-02 | Theo Alder | 4 | ferncliff | F-01 |
| S-03 | Mira Brandt | 6 | larkspur | F-02 |
| S-04 | Nico Castellanos | 6 | larkspur | F-03 |
| S-05 | Ezra Dunmore | 6 | larkspur | F-04 |
| S-06 | Wren Dunmore | 4 | ferncliff | F-04 |

**Price list PL-2024-01:** effective 2024-01-01, `tax_rate_bp` 825, not withdrawn.

| Instrument | Base rent | Waiver | Purchase price |
|---|---|---|---|
| flute | 2400 | 500 | 72000 |
| clarinet | 2400 | 500 | 72000 |
| trumpet | 2600 | 600 | 83200 |
| violin | 1800 | 400 | 54000 |
| cello | 4500 | 900 | 180000 |

Discount tiers:

| Tier | Months | Discount |
|---|---|---|
| "Term 1" | 0 to 3 | 40% |
| "Year 1" | 4 to 12 | 30% |
| "After" | 13 onward | 20% |

**Fleet** (16 instruments):

| Serial | Type | Size | Model | Status |
|---|---|---|---|---|
| KB-FL-0101, KB-FL-0102 | flute | full | Corvin FL-200 | available |
| KB-CL-0201, KB-CL-0202 | clarinet | full | Corvin CL-300 | available |
| KB-TR-0301 | trumpet | full | Harlow TR-150 | on C-1002 |
| KB-TR-0302 | trumpet | full | Harlow TR-150 | available |
| KB-VN-0401 | violin | 1/4 | Ostwald VN-10 | on C-1001 |
| KB-VN-0402, KB-VN-0403 | violin | 1/2 | Ostwald VN-10 | available |
| KB-VN-0404 | violin | 3/4 | Ostwald VN-10 | available |
| KB-VN-0405 | violin | 4/4 | Ostwald VN-10 | available |
| KB-CE-0501 | cello | 1/2 | Ostwald CE-20 | available (the only free 1/2 cello) |
| KB-CE-0502 | cello | 1/2 | Ostwald CE-20 | on C-1003 |
| KB-CE-0503 | cello | 3/4 | Ostwald CE-20 | available |
| KB-CE-0504 | cello | 4/4 | Ostwald CE-20 | available |
| KB-CE-0505 | cello | 1/4 | Ostwald CE-20 | retired |

**Contracts.** All three seeded contracts:

- are active and bound to PL-2024-01;
- have no payments and exactly one `opening` ledger entry;
- have no Kill Bill account yet (`subscription_state` `null`);
- report `agreement_stored` `true` from the start, with the agreement PDF generated as described in Services;
- have `signed_at` and `activated_at` at 12:00 PM store time on the dates shown;
- have a billing anchor equal to the activation date;
- have exactly one history entry: `{"from":null,"to":"active","at":<activated_at>,"actor":"owner","actor_name":null}`.

| Contract | Student | Instrument | Waiver | Signed | Activated and delivered | Opening equity |
|---|---|---|---|---|---|---|
| C-1001 | Theo Alder | KB-VN-0401 | yes | 2025-09-03 | 2025-09-04 | 16200 |
| C-1002 | Mira Brandt | KB-TR-0301 | no | 2025-08-28 | 2025-09-02 | 7800 |
| C-1003 | Juniper Alder | KB-CE-0502 | yes | 2024-09-03 | 2024-09-03 | 67500 |

With the seed data at start:

- Larkspur's roster counts are 2 `no_instrument` and 2 `delivered` ("2 of 4 students have an instrument").
- Ferncliff's roster counts are 1 and 1 ("1 of 2 students have an instrument").
- The next new contract is C-1004.

## Technical requirements

### Deployment (DP-48, DP-59)

- Node.js 22 with npm is available. The app lives at `/app`.
- `/app/run.json` holds string `install`, `build` and `serve` commands and `"_schema":"run-manifest-v1"`, for example:

```json
{"_schema":"run-manifest-v1","install":"npm ci","build":"npm run build","serve":"npm run start"}
```

- `serve` binds `0.0.0.0` on the port in `APP_PUBLIC_PORT` (default 4173) and ensures schema and seed on every start, as described under Starting state.
- `GET /api/health` answers as the API table says. It answers 200 even while Kill Bill or storage is down.
- The verifier may run several instances side by side, each with its own environment and port, and several may start at the same moment.
  - Instances on the system clock share the main database. That includes instances with a dependency pointed at an unreachable address and instances with shorter `RESERVATION_HOLD_SECONDS` or `SIGNING_LINK_TTL_SECONDS`.
  - Each instance started with `BELLROLL_CLOCK_START` gets its own isolated set of records:
    - a fresh database through `DATABASE_URL`, seeded on its first start as described under Starting state;
    - its own Kill Bill tenant through `KILLBILL_API_KEY` and `KILLBILL_API_SECRET`;
    - its own empty bucket through `S3_BUCKET`.
  - The verifier normally creates that tenant before the instance starts. If Kill Bill has no tenant for the given key at boot, the app creates it once, with that key and secret, using `KILLBILL_USERNAME` and `KILLBILL_PASSWORD`. The app never creates buckets.
  - Because contract IDs restart at C-1004 in every fresh database, the same contract ID can exist in several databases. Each one's Kill Bill records live only in its own tenant, and its objects only in its own bucket. No instance ever reads another clock's database, tenant or bucket.

### Configuration and secrets (DP-47, DP-54)

Read these from the environment at start, never hard-coded:

- `DATABASE_URL`
- `KILLBILL_URL`, `KILLBILL_USERNAME`, `KILLBILL_PASSWORD`, `KILLBILL_API_KEY`, `KILLBILL_API_SECRET`
- `SMTP_HOST`, `SMTP_PORT`, `MAIL_FROM`
- `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_FORCE_PATH_STYLE`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`
- `RESERVATION_HOLD_SECONDS` and `SIGNING_LINK_TTL_SECONDS` (whole seconds)
- `BELLROLL_CLOCK_START` (optional; see the Clock rule in Business rules)
- `APP_PUBLIC_PORT`, and optionally `APP_PUBLIC_URL`

No credential or service URL appears in browser code, pages or API responses.

### Server boundary (DP-49)

**Origin:**

- The browser talks only to the app's own origin. No cross-origin headers are sent.
- The app's own origin is judged per request from that request's `Host` header: the host name and port the request was sent to. `APP_PUBLIC_URL` and `APP_PUBLIC_PORT` play no part in this check; `APP_PUBLIC_URL` is used only for links in emails. The scheme is not compared.
- A state-changing request (POST, PUT, PATCH or DELETE) whose `Origin` header is present and whose host and port differ from the `Host` header answers 403 `cross_origin`. An `Origin` of `null` counts as different.
- A request with no `Origin` header is allowed, and so is any GET or HEAD. So every instance, at whatever address it is reached, accepts requests from its own pages.

**Body limits:**

- JSON bodies may be up to 100,000 bytes, and multipart bodies up to 31,000,000 bytes. Each limit itself is allowed.
- A larger body answers 413 `payload_too_large`.
- A JSON endpoint sent another content type answers 415 `unsupported_media_type`.

**What is served:**

- The server serves only built assets and the API.
- Source files, `.env`, lockfiles, configuration and source maps all answer 404.
- Stored objects are streamed only through the authorised endpoints.

**Startup:**

- If Postgres is unreachable, the server keeps retrying, and health answers 503 until it has connected and the schema and seed are in place.
- If Kill Bill or storage is unreachable at boot, the server still starts. Only the actions that need that service answer 503, as described in Services.

### Browser support and performance (DP-50, DP-73)

Supported browsers are current Chromium, Firefox and WebKit, at every width in the three bands and in particular at 375x812, 768x1024 and 1280x800, with mouse, keyboard and touch. With the seed data:

- any screen is usable within three seconds of navigation;
- the instrument model draws its first frame within three seconds of the contract sheet opening;
- the quote table loads within one second;
- the rail figures keep up with the handle on every step.

## Working rules

- IF-01: `/app/run.json` holds exactly string `install`, `build` and `serve` commands plus `"_schema":"run-manifest-v1"`.
- IF-02: `/app/THIRD_PARTY_NOTICES.md` lists every shipped package (the production dependency tree from `npm ls --omit=dev --all --json`) and every bundled font, each with its licence.
- IF-03: Shipped packages (the production dependency tree from `npm ls --omit=dev --all --json`) and fonts use only the MIT, ISC, BSD-2-Clause, BSD-3-Clause, Apache-2.0, 0BSD, BlueOak-1.0.0 or SIL OFL 1.1 licences.
- IF-04: No datastore beyond Postgres, Kill Bill, MinIO and Mailpit: no SQLite, Redis, embedded databases or files used as storage.
- IF-05: The provided service configuration and its credentials stay untouched, and the app reaches services only through the published environment variables.
- IF-06: Application source is TypeScript, with no hand-written JavaScript source outside generated build output and tool configuration files.
- IF-07: The browser loads nothing from another origin. Fonts, icons, the motion and 3D libraries and every script are bundled and served by the app.

## Engineering standards

- The code is idiomatic, strictly typed TypeScript, with no `any` escapes and no ignored type errors.
- Names match this brief's domain terms: contract, reservation, hold, signing link, history, equity ledger, reversal, transfer, tier, payoff, quote, bill of sale, price list, withdrawal, billing anchor, delivery day, cutoff, manifest, condition check, subscription, external key.
- Each domain rule is decided in exactly one place and reused by every surface. That covers contract state moves with their history entry, the payment split, the reversal amount, tier choice and payoff, the price list in force, the sales tax rate for a date, billing dates, the store's today, the delivery-day cutoff, roster status and counts, family totals and the sign-in landing.
- Every server time rule reads the current moment from the one server clock, and every time-dependent browser surface reads the one estimate of the server clock built from `server_now`. Nothing else reads the system or device time.
- Money is integer cents end to end, and the one rounding rule is applied in one place. Floating-point arithmetic never touches amounts.
- Every action that spans Postgres, Kill Bill and object storage follows the one published order. It looks up Kill Bill by external key before writing there and explicitly cleans up what it already wrote. No action leaves an orphan object or a half-applied change.
- Each motion's speed, each width band and the model's turn rule are defined once and reused. No animation runs outside the Motion library or the three.js render loop.
- No abstraction has only one implementation, and there is no dead, commented-out or unreachable code or defensive check for impossible states. Errors leave the server in the one published shape, and nothing is built beyond this brief.
