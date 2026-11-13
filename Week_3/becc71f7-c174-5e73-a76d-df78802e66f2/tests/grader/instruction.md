# Atelier Ourlet Ourlet Consignment Desk

Ourlet Consignment Desk is the back office and public shop window for Atelier Ourlet, a consignment boutique in Brussels run by its founder. It sells good pre-owned clothing, shoes and accessories. The shop owner, two shop assistants and a bookkeeper sign in with an email and a password. Consignors use a private consignor page and a public appointment page, and shoppers browse a public rail and hold pieces to try them on in the shop. It runs on Postgres (the shop's record), MinIO (intake photos, their cleaned public copies and the monthly bank transfer files) and Mailpit (every mail the shop sends). Business time is Europe/Brussels and money is euros. Out of scope: online payment, delivery, shopper or consignor accounts, any datastore other than these three services, and any feature this brief does not describe.

## Problem and users

Each month a founder-run consignment boutique in Brussels takes in hundreds of one-of-a-kind pieces. Each piece belongs to a consignor, who is paid a share when it sells. Today the founder keeps consignors and pieces in a spreadsheet, writes paper tags by hand, works out each markdown on a calculator as pieces age, and once a month types every consignor's bank transfer into the banking app one at a time. Consignors phone to ask what sold and what they are owed, and shoppers message to ask whether a piece is still there. Pieces that should have gone back to their owners stay on the rail. Generic consignment tools are priced in dollars and built for other markets: they round shares in floating point, they know nothing about Belgian VAT on the commission or the bank transfer file a Belgian bank accepts, and they count markdown days on the till's own clock. The founder pays for this with evenings spent reconciling, with consignors who leave over a wrong cent, and with pieces sold at yesterday's price.

- **Shop owner** (daily): runs the shop, its members and the markdown ladder, edits asking prices, brings consignors over from the previous tool's spreadsheet, erases consignors who ask for it, and pays every consignor correctly once a month.
- **Shop assistant** (daily): takes pieces in with tags and photos, sells at the till, looks after holds and intake appointments, and sends consignors their page address.
- **Bookkeeper** (occasional): reads the monthly sales book and the payout runs without changing anything.
- **Consignor** (weekly): sees each piece's tag code, current price and station, sees earnings by month, chooses Return to me or Donate as a period ends, and books an intake slot.
- **Shopper** (occasional): browses the public rail by category, size, brand and price band, and holds a piece to try it on in the shop.

## Journeys

1. **Taking a piece in.** Noor signs in and lands on the pieces screen. She opens New piece, picks the consignor, fills in category, brand, description, size, condition, asking price and intake date, and saves. The address bar shows the new piece's route, the piece has its tag code, and its hanging tag shows the asking price. She adds two photos. Shoppers see only the cleaned copies, and the owner can still download the originals.
2. **Browsing and holding.** A shopper on a phone opens the rail, opens the filters sheet, picks size M and a price band, and types "wool" in search. The list updates in place and the address keeps every choice. On a piece page they read the four markdown stations and hold the piece with their name and email. A mail arrives with a private hold page that shows the piece, the shop's address and when the hold ends. If a second shopper tries the same piece at the same moment, that shopper is told whose hold is in place and until when.
3. **Selling at the till.** An assistant types a tag code at the till, opens Sell, picks Card and completes the sale using only the keyboard. The address bar shows the sale. The consignor's share, the commission and its VAT are recorded to the cent. If someone else sold the same piece a moment earlier, the dialog stays open and names who sold it and when.
4. **The markdown ladder.** The owner changes the ladder from a chosen Brussels date. Pieces already taken in keep their old ladder on every screen, while pieces taken in from that date follow the new one. Every price and station on every screen comes from the server, even on a device whose clock is wrong.
5. **Month end.** Once a month has ended in Brussels, the owner starts the payout run for that month. In one step the app records one payout per consignor, stores a SEPA bank transfer file and sends each consignor a statement by mail. The run shows Ready, and the owner downloads the file for the bank. A consignor without a valid IBAN is held back with a stated reason.
6. **The consignor's own page.** A consignor opens their private page from a mail on a phone. They see only their own pieces and earnings, choose Return to me or Donate for a piece whose period is ending, and tap Save choices. Separately, they book an intake slot on the public appointment page and get a confirmation mail with a cancel address.
7. **Moving over and closing books.** The owner brings consignors and pieces over from the previous tool's spreadsheet through a preview, and saving the same file a second time changes nothing. The bookkeeper downloads the month's sales book.
8. **Period end and erasure.** At the end of a piece's period it leaves the rail for the Returns shelf or the Donation box. A consignor asks to be erased: the owner erases them, their photos are deleted from storage, and their past sales stay with `Erased consignor`. The owner archives a piece by mistake and brings it back exactly as it was.

## Mandatory requirements

This is the complete list of mandatory requirements; every check traces to one of these lines and the detailed sections below.

- **DP-01 — Staff sign-in** Signing in with a wrong password and with an email that belongs to no member answer the same status, the right password starts a session, and signing out ends it so the session endpoint answers 401.
- **DP-02 — Members belong to the owner** Only the shop owner lists, adds, re-roles and removes members, as set out in API; a removed member can no longer sign in, a role change applies from that member's next request, and an id that is not a current member answers 404 exactly like an unknown id.
- **DP-03 — Sign-in journey** Filling the sign-in form lands each staff role on its published home route with a live session, and signing out from there ends the session.
- **DP-04 — Public rail journey** A shopper browses the rail with category, size, brand, price band and search in the address, Back and Forward, search that shows the latest input, the published layouts at 1280x800, 1024x768, 768x1024 and 375x812, closed sheets and menus hidden and inert, pieces turning Sold or On hold in place within the 5-second refresh while the filters sheet stays open as typed, and a sold piece's page lifetime; the rail is complete by keyboard and by touch at 375x812, its rare-state copy renders verbatim, the endpoint GET /api/rail answers the earlier error of the ladder and whole-second Z instants, and its screen meets the screen rules.
- **DP-05 — Filters and search in the address** Category, size, brand, price band and search live in the rail's address, each change is one history entry that Back and Forward return to, and search runs after the published pause and always shows the results for the latest input, even when an earlier request answers later.
- **DP-06 — Rail layouts at the published widths** The rail is a filters column beside three columns from 1100 pixels wide, two columns with a filters side sheet at 1024x768 and 768x1024, and one column with a filters bottom sheet at 375x812, and a closed sheet or menu is hidden and inert.
- **DP-07 — Sold and held pieces on the rail** A piece sold or held elsewhere turns to Sold or On hold in place on an open rail within the 5-second refresh, and a sold piece's public page shows its sold state until the published day boundary, then answers 410.
- **DP-08 — Intake journey** A shop assistant takes a piece in through the New piece dialog by keyboard alone with the published focus targets, sees its tag code and route, adds photos, and reads the Markdown tag and its stations; the photo outage copy renders verbatim on the MinIO-down copy, the tag code, file-only photo size and metadata removal hold, POST /api/pieces answers the earlier error of the ladder for a request that breaks two rules, every instant is whole-second Z, the 375x812 touch journey keeps closed sheets inert and no bar over the focused control, and its screen meets the screen rules.
- **DP-09 — Tag codes** Every piece gets a tag code in the published format with a check digit, and lookup accepts lower case and missing dashes, always shows the upper-case dashed form, and refuses a code whose check digit fails.
- **DP-10 — Photo checks** An intake photo is accepted only when its content is JPEG, PNG or WebP, whatever its file name or declared type, and only when the file itself is at most 5,000,000 bytes; an oversized photo or body answers 413 as JSON before the body is parsed or the caller is authenticated.
- **DP-11 — Photo originals and public copies** The original photo is stored in MinIO byte for byte and only the owner downloads it; the public copy has the camera orientation applied, every metadata block removed and its longest side at most 1600 pixels; while MinIO is down a photo is refused with nothing stored.
- **DP-12 — Markdown stations** Every piece page shows four stations with their dates, each exposing its server-given state and whole-second UTC instant, as one keyboard composite with one Tab stop whose station popover opens uncut inside the viewport at 375 and 1280 pixels wide.
- **DP-13 — Price edits and the tag swing** The owner changes a piece's asking price, the markdown prices follow it from that instant, and every open rail, piece page and consignor page shows the new price at its next refresh: the tag swings once while the old price is struck through and the new one slides in, or under reduced motion the price changes at once with no swing.
- **DP-14 — Ladder journey** The shop owner changes the ladder through the Change ladder dialog by keyboard alone with the published focus targets, earlier pieces keep their ladder, a second change for the same date is refused with the published copy and the dialog kept open as typed, and prices and stations show as the server says with the page clock hours off; the half-up rounding and Brussels day boundaries hold, POST /api/ladders answers the earlier error of the ladder for a request that breaks two rules, every instant is whole-second Z, the 375x812 touch journey keeps closed sheets inert and no bar over the focused control, and its screen meets the screen rules.
- **DP-15 — Markdown prices** Each markdown price is the asking price times the ladder's remaining percentage in integer cents, rounded half up, as set in Business rules.
- **DP-16 — Brussels days** Station instants fall at Brussels local midnight of their day, across 23-hour and 25-hour days, as set in Business rules.
- **DP-17 — Ladder changes by date** A ladder change takes effect on a chosen Brussels date, every piece keeps the ladder in force on its intake date on every screen, the rail, the sales book and the payouts, and a second change for the same date is refused.
- **DP-18 — Prices from the server's clock** Every price, station state, end time and countdown on every screen comes from the server, also when the device clock is wrong by hours.
- **DP-19 — Hold journey** A shopper holds a piece from its public page and opens the private hold page from the mail; the losing shopper sees the published hold-taken copy with the winning end time, still shown after the next refresh; the hold ends at HOLD_SECONDS on the short-timers copy as the server says with the page clock hours off; the Mailpit-down copy refuses with the published copy; an assistant's Release dialog survives its own closing animation; the hold page works by touch at 375x812 and the flow by keyboard; POST /api/pieces/{id}/holds answers the earlier error of the ladder for a request that breaks two rules, every instant is whole-second Z, and its screen meets the screen rules.
- **DP-20 — One hold per piece** A piece has at most one active hold, and when two shoppers hold one piece at the same moment exactly one wins and the other is refused with the winning hold's end time.
- **DP-21 — Hold end and hold page** A hold lasts HOLD_SECONDS and ends exactly at its end instant; its private hold page shows the piece, the shop's address and the end in Brussels time, and lets the shopper let the hold go.
- **DP-22 — Hold mail** Placing a hold sends one mail that carries only the piece, the shop's address, the hold's end and the hold page address, and while Mailpit is down a hold is refused with nothing saved.
- **DP-23 — Release dialog** Pressing Release again during the Release hold dialog's closing animation keeps the dialog open for good, and the 5-second refresh never closes it or clears it.
- **DP-24 — Till journey** A shop assistant sells at the till by keyboard alone with the published focus targets, the sale is announced with its exact copy, a piece another member just sold is refused with the published copy naming who and when and the dialog kept open, the address bar shows the sale's route and a reload shows it; share, commission and VAT round half up, POST /api/sales answers the earlier error of the ladder for a request that breaks two rules, every instant is whole-second Z, the 375x812 touch journey keeps closed sheets inert and no bar over the focused control, and its screen meets the screen rules.
- **DP-25 — Repeated till requests** A till request repeated with the same request key answers the first response and records one sale, and the same key with a different body is refused.
- **DP-26 — Shares, commission and VAT** Every sale records the consignor's share, the shop's commission and the VAT inside the commission in integer cents, as set in Business rules.
- **DP-27 — Pieces sold elsewhere** Selling a piece that is already sold is refused with who sold it and when, and nothing is recorded.
- **DP-28 — Refunds and earlier sales** An assistant can record an earlier sale with its past instant and price in force then, a sale can be refunded until the published end of its refund window, and a refund puts the piece back at its price in force.
- **DP-29 — Payout run journey** The shop owner starts the payout run for an ended Brussels month through the Start payout run dialog by keyboard alone; the run shows Ready, the bank file downloads byte for byte, a consignor without a valid IBAN is held back with the published reason, a second start shows who started it and when, and the MinIO-down and Mailpit-down copies refuse with the published copy still shown after the next refresh; the SEPA name rule holds, POST /api/payout-runs answers the earlier error of the ladder for a request that breaks two rules, every instant is whole-second Z, the 375x812 touch journey keeps closed sheets inert and no bar over the focused control, and its screen meets the screen rules.
- **DP-30 — Bank transfer file** Each payout run writes one SEPA credit transfer file with the published elements, creditor names by the SEPA name rule and IBANs checked by MOD-97, and stores it in MinIO.
- **DP-31 — One payout run per month** Starting the run again for the same month gives the same run, and when two starts arrive at the same moment exactly one creates it and the other is told who started it and when.
- **DP-32 — Payout runs are all or nothing** A payout run records its payouts, stores its bank file and sends every statement together or does none of it, also when MinIO or Mailpit is down, and it shows Ready only after MinIO has confirmed the stored file.
- **DP-33 — Monthly statements** Each consignor in a run gets one statement mail with only their own pieces and amounts and at most the last four characters of their IBAN.
- **DP-34 — Consignor page journey** A consignor opens the private consignor page from the mail and sees only their own pieces and earnings; at 375x812 by touch they choose Return to me or Donate with the Save choices bar never covering the focused control, and they can complete the page by keyboard; the ended-page copy renders verbatim on the short-timers copy, prices and stations show as the server says with the page clock hours off, the tag never swings under reduced motion, PUT /api/portal/{token}/choices answers the earlier error of the ladder for a request that breaks two rules, every instant is whole-second Z, and its screen meets the screen rules.
- **DP-35 — Consignor page shows only their own** The consignor page and every response it reads carry only that consignor's own pieces and earnings, never shopper names or emails, other consignors, the shop's commission or more than the IBAN's last four characters, and another consignor's piece id answers 404.
- **DP-36 — Consignor page address** A consignor page address lasts PORTAL_PAGE_SECONDS, a new address ends the old one, the owner can end it, and an ended page answers 410.
- **DP-37 — Return to me or Donate** For each piece in the last 14 Brussels days of its period the consignor chooses Return to me or Donate, and outside that window the choice is refused.
- **DP-38 — Appointment journey** A consignor books a 20-minute intake slot on the public appointment page one week at a time, by touch at 375x812 and by keyboard; the losing booking sees the published slot-taken copy with the real next free slot, and the Mailpit-down copy refuses with the published copy; slot instants keep their wall-clock time across clock changes, POST /api/appointments answers the earlier error of the ladder for a request that breaks two rules, every instant is whole-second Z, and its screen meets the screen rules.
- **DP-39 — Slots in Brussels time** Slots run Tuesday to Saturday from 10:00 to 17:40 Brussels time every 20 minutes, from tomorrow up to 32 weeks ahead, and keep their wall-clock times in the weeks of a clock change.
- **DP-40 — One booking per slot** A slot holds one appointment, and when two bookings of one slot arrive at the same moment exactly one wins and the other is told the real next free slot.
- **DP-41 — Booking limit** One email address, in any letter case, can make at most 3 bookings per APPOINTMENT_RATE_WINDOW_SECONDS, and the next answers 429 with Retry-After.
- **DP-42 — Booking confirmation** Each booking sends one confirmation mail with the slot in Brussels time and a private address that cancels it, and while Mailpit is down a booking is refused with nothing saved.
- **DP-43 — Spreadsheet journey** The shop owner brings a previous-tool spreadsheet through the Preview import dialog by keyboard alone, the preview table at 375x812 scrolls sideways in its own focusable, named frame, and the preview and save results are announced with their exact copy; POST /api/imports/preview answers the earlier error of the ladder for a request that breaks two rules, every instant is whole-second Z, the 375x812 touch journey keeps closed sheets inert and no bar over the focused control, and its screen meets the screen rules.
- **DP-44 — Spreadsheet matching** Each row's consignor is matched by email in any letter case, then by normalised name, or else created, and a preview lists matched, new, refused and already-brought-over rows with row numbers and reasons before anything is saved.
- **DP-45 — Saving a file twice** Saving the same spreadsheet twice changes nothing the second time, and pieces brought over keep their original intake dates and the ladder in force on them.
- **DP-46 — Sales book journey** The bookkeeper reads a Brussels month's sales book screen and downloads its file through the Download sales book dialog by keyboard alone; at 375x812 the wide table scrolls in a focusable, named frame, and the limit copy renders verbatim; the cell rule holds, GET /api/sales-book answers the earlier error of the ladder for a request that breaks two rules, every instant is whole-second Z, and its screen meets the screen rules.
- **DP-47 — Sales book file** The sales book file uses the published format and columns, puts an apostrophe before any cell starting with =, +, -, @, a tab or a carriage return, and ends with a totals row equal to the sum of its lines, with shares and VAT exactly as the till recorded them.
- **DP-48 — Bookkeeper access and download limit** The bookkeeper reads the sales book and the payout runs, every write they send is refused with 403, and their 6th sales book download within BOOK_FILE_RATE_WINDOW_SECONDS answers 429 with Retry-After, counted per member.
- **DP-49 — Period end and erasure journey** The shop owner erases a consignor through the Erase consignor dialog by keyboard alone, the consignor shows Erased only after MinIO has confirmed that no photo of their unsold pieces is left, sold pieces show `Erased consignor`, an archived piece comes back exactly as it was, every state shows as the server says with the page clock hours off, and after each action the address bar shows the published route and a reload shows it; Brussels day boundaries hold, POST /api/consignors/{id}/erase answers the earlier error of the ladder for a request that breaks two rules, every instant is whole-second Z, the 375x812 touch journey keeps closed sheets inert and no bar over the focused control, and its screen meets the screen rules.
- **DP-50 — Period end shelves** At 00:00 Brussels on the period end day a piece leaves the rail for the Returns shelf or the Donation box by its consignor's choice, with Donate when none was made, and an uncollected Returns shelf piece moves to the Donation box after 14 Brussels days.
- **DP-51 — Consignor erasure** Erasing a consignor removes their name, email, phone and IBAN from the database and every response, deletes their unsold pieces' photos from MinIO, and keeps their sales with `Erased consignor`.
- **DP-52 — Archive and bring back** The owner archives a piece and brings it back exactly as it was, with the same tag code, photos, choice and station history.
- **DP-53 — Starting data** A fresh copy on its own empty database and bucket starts with exactly the published starting data, and several copies starting at the same moment each read, write and send only for their own data.
- **DP-54 — API conventions** Every API path follows the one error-precedence ladder, answers 405 with Allow for a wrong method and 415 for a wrong content type, answers 404 for unpublished paths, uses camelCase keys and the one error body, and gives every instant as UTC in whole seconds with a Z.
- **DP-55 — Landing routes** After sign-in each staff role lands on its published home route, after saving a new piece, placing a hold, completing a sale or starting a payout run the address bar shows that record's published route, and reloading or opening that address shows the same screen.
- **DP-56 — Session ended mid-form** When the server ends a session while a dialog is open, the dialog stays as typed, the live region announces the published copy, and signing in again returns to the same address with the same dialog open and its typed values.
- **DP-57 — Layout and accessibility on every screen** Every screen shows its published layout at 375x812, 768x1024, 1024x768 and 1280x800 with no sideways page overflow, follows the screen rules, and passes the automated WCAG 2.2 AA check with each of its dialogs, menus and sheets open and with all of them closed.
- **DP-58 — Motion system** All motion runs as CSS transitions, CSS animations or element animations of exactly 160, 320 or 640 milliseconds, and under reduced motion everything opens, closes and settles at once.
- **DP-59 — Quiet boutique look** Every screen uses the warm off-white page, the single black ink, the two published typefaces, generous section spacing and tabular figures on every price, tag code and IBAN, with the procedural garment imagery.
- **DP-60 — Hanging tag craft** Every piece card and piece page shows a card price tag hanging on a thin string from a punched hole, with the old price struck through at each markdown.

## Frontend

### Screens and layout (DP-04, DP-06, DP-08, DP-14, DP-19, DP-24, DP-29, DP-34, DP-38, DP-43, DP-46, DP-49, DP-55, DP-57)

Every screen has a published route. Reloading a route, or opening it fresh, shows the same screen. No screen scrolls sideways at any of the four sizes 375x812, 768x1024, 1024x768 and 1280x800. Wide tables scroll inside their own frame instead (see Screen rules). Each screen's **main action** is named below. At 375x812 it sits in a bar fixed to the bottom edge.

Public screens:

| Route | Screen | Main action |
|---|---|---|
| `/` with optional `category`, `size`, `brand`, `price`, `q` query parameters | Public rail | `button "Filters"` (below 1100 pixels wide) |
| `/pieces/<piece id>` | Public piece page | `button "Hold this piece"` |
| `/h/<hold token>` | Private hold page | `button "Let the hold go"` |
| `/c/<page token>` | Private consignor page | `button "Save choices"` |
| `/appointments` with optional `week=<YYYY-MM-DD>` (a Monday) | Public appointment page | `button "Book slot"` |
| `/appointments/cancel/<cancel token>` | Cancel appointment page | `button "Cancel appointment"` |
| `/sign-in` | Staff sign-in | `button "Sign in"` |

Staff screens. Every staff role sees only the screens it may use; any other staff route shows the not-found screen.

| Route | Screen | Roles | Main action |
|---|---|---|---|
| `/staff/pieces` with optional `status=<status>` | Pieces: one wide table beside a narrow detail column | owner, assistant | `button "New piece"` |
| `/staff/pieces/<piece id>` | Staff piece page | owner, assistant | `button "Sell"` |
| `/staff/till` | Till | owner, assistant | `button "Sell"` |
| `/staff/sales/<sale id>` | Sale | owner, assistant, bookkeeper | `button "Refund"` (owner, assistant) |
| `/staff/holds` | Holds | owner, assistant | `link "Till"` |
| `/staff/holds/<hold id>` | Hold | owner, assistant | `button "Release"` |
| `/staff/appointments` | Booked appointments | owner, assistant | `link "Public appointment page"` |
| `/staff/consignors` | Consignors | owner, assistant | `button "New consignor"` |
| `/staff/consignors/<consignor id>` | Consignor | owner, assistant | `button "Send page address"` |
| `/staff/ladder` | Markdown ladder | owner | `button "Change ladder"` |
| `/staff/payouts` | Payout runs | owner, bookkeeper | `button "Start payout run"` (owner) |
| `/staff/payouts/<YYYY-MM>` | Payout run | owner, bookkeeper | `link "Download bank file"` |
| `/staff/import` | Old spreadsheet | owner | `button "Choose file"` |
| `/staff/sales-book` with optional `month=<YYYY-MM>` | Sales book | owner, bookkeeper | `button "Download sales book"` |
| `/staff/members` | Members | owner | `button "Add member"` |

Home routes after sign-in: the owner lands on `/staff/consignors`, a shop assistant on `/staff/pieces` and the bookkeeper on `/staff/sales-book`.

After an action: saving a new piece shows `/staff/pieces/<piece id>`. A staff-placed hold shows `/staff/holds/<hold id>`. Completing a sale shows `/staff/sales/<sale id>`. Starting a payout run shows `/staff/payouts/<YYYY-MM>`. Archiving, bringing back or price-editing a piece stays on `/staff/pieces/<piece id>`. Erasing a consignor stays on `/staff/consignors/<consignor id>`. A shopper's own hold stays on `/pieces/<piece id>`. An unknown route shows a not-found screen with the heading `We couldn't find that page.`. A sold public piece page past its lifetime and an ended consignor page show their 410 screens (copy in Feedback states).

**Public rail.**
- A top bar holds the wordmark link "Atelier Ourlet", a Categories menu and the link "Book an intake slot". The Categories menu opens a wide panel with one featured tile per category, each a generated drawing of a garment on a hanger.
- **1100 pixels wide and up** (1280x800 included): a filters column on the left (search, category, size pills, brand, price band) beside a grid of piece cards in exactly three columns.
- **768 to 1099 pixels wide** (1024x768 and 768x1024): two columns of cards, with the filters in a side sheet that slides in from the right edge when Filters is pressed.
- **Below 768 pixels** (375x812): one column of cards. The filters sit in a bottom sheet that rises from the bottom edge, and the Categories menu is replaced by a Menu button that opens a sheet with the category links and the appointment link.
- Each card shows the photo (the first public copy) or a generated garment drawing, the description, brand, size and condition, and the hanging tag. An On hold or Sold badge sits on the card when that applies.

**Piece pages.**
- The public page shows the photos, the description as its heading, brand, size, condition, the hanging tag, and the four markdown stations in a row (stacked vertically below 768 pixels).
- The staff page adds the consignor's name, the tag code, a photos section with Add photo, and the actions its role and the piece's status allow: Change price, Place hold, Sell, Archive, Bring back and Mark collected.
- The owner sees a Download original link under each photo.

**Staff screens.**
- At 1280x800 each staff list is one wide table beside a narrow detail column for the selected row.
- At 768x1024 and 1024x768 the table takes the full width and the detail column sits below it.
- At 375x812 the table scrolls sideways inside its own frame and the main action sits in the bottom bar.
- A staff top bar holds the `navigation "Staff"` links the role may use and `button "Sign out"`. Below 768 pixels these move into a Menu sheet.
- The pieces screen has a status switcher (On the rail, On hold, Sold, Returns shelf, Donation box, Archived) that sets the `status` query parameter.

**Till.** A tag code field and Find piece button. The piece found shows with its tag and its price in force, and Sell opens the Sell piece dialog.

**Consignor page.** Built for 375x812 touch first, and it scales up to a centred column at wider sizes. It shows:
- a greeting with the consignor's name and `Paid to the account ending <last four>` (or the held-back reason when the IBAN on file is not valid);
- a list of their pieces:
  - each unsold piece shows its tag, tag code, description, station and status, and the Return to me or Donate choice where it is open;
  - a sold piece shows its tag code, description, `Sold` and its share, with no tag and no price;
- an Earnings by month table;
- the Save choices bar at the bottom.

**Hold page.** Built for 375x812 touch first. It shows the piece with its tag, the shop's address, `Held until <date-time>` and the server's minutes left, and the Let the hold go button.

**Appointment page.**
- One week at a time: a heading `Week of <date>` (the Monday), Previous week and Next week buttons, and one column per day from Tuesday to Saturday listing that day's 20-minute slots as buttons.
- Taken slots are shown as unavailable and cannot be pressed.
- At 375x812 the days stack vertically.

**Old spreadsheet, sales book, payouts.**
- The import screen has a file chooser, and the preview opens as a dialog with the rows table in a sideways-scrolling frame.
- The sales book screen has a month picker, the table and a totals row.
- The payout run screen shows the month, its status, the payouts table and the file link.

### Public screens and controls (DP-04, DP-08, DP-12, DP-19, DP-24, DP-29, DP-34, DP-38, DP-43, DP-46, DP-49, DP-56)

Only these roles, names and attributes are public. Everything else is up to you. `<label>` placeholders are filled from the record.

| Where | Role and accessible name | Visible copy or content |
|---|---|---|
| Every screen | `status "Announcements"` live region (the only live region) | the copy from Feedback states |
| Every form and dialog with a problem | `region "Problems"` holding one `link` per field problem | heading `There's a problem`, then each field message |
| Rail top bar | `button "Categories"` opening `navigation "Categories"` | featured tiles as `link "<category label>"` |
| Rail at 375 | `button "Menu"` opening `dialog "Menu"` | category links, `link "Book an intake slot"` |
| Rail | `searchbox "Search the rail"` | |
| Rail | `radiogroup "Category"` with `radio "All"` and one `radio` per category label | |
| Rail | `group "Size"` with one `button` per size label, pressed state shown | size pills |
| Rail | `combobox "Brand"` with option "All brands" then every brand on the rail | |
| Rail | `radiogroup "Price"` with `radio "Any price"` and one `radio` per price band label | |
| Rail below 1100 | `button "Filters"` opening `dialog "Filters"`, holding `button "Close filters"` and `button "Show <n> pieces"` | `<n>` is the number of pieces the filters give |
| Rail | `list "Pieces"`, one `listitem` per card, each card with `link "<description>"` to its piece page | badge `On hold` or `Sold` |
| Every tag | the swinging tag element carries `data-tag`; inside it the current price carries `data-price` and the struck old price `data-old-price` | price as `€37.43` |
| Piece pages | `toolbar "Markdown stations"` holding four `button`s named `<station label>, <date>`; each carries `data-station` (the API value), `data-state` and `data-at` | `Full price`, `<p>% off`, `<p>% off`, `Period ends` |
| Station popover | `dialog "<station label>"` (non-modal) with `button "Close"` | the station's date-time and the price from that station |
| Public piece page | `button "Hold this piece"` opening `dialog "Hold this piece"` with `textbox "Your name"`, `textbox "Email"`, `button "Hold piece"`, `button "Cancel"` | |
| Hold page | `button "Let the hold go"` | `Held until <date-time>`, `<n> minutes left` |
| Sign-in | `textbox "Email"`, the password field labelled `Password`, `button "Sign in"` | |
| Staff top bar | `navigation "Staff"`, `button "Sign out"`, at 375 `button "Menu"` | |
| Pieces | `navigation "Piece status"` links, `table "Pieces"` in `region "Pieces table"`, `button "New piece"` opening `dialog "New piece"` | |
| New piece dialog | `combobox "Consignor"`, `combobox "Category"`, `textbox "Brand"`, `textbox "Description"`, `combobox "Size"`, `radiogroup "Condition"` with `radio "Excellent"`, `radio "Very good"`, `radio "Good"`, `textbox "Asking price"` (euros such as 49.90), `textbox "Intake date"` (a date field), `button "Save piece"`, `button "Cancel"` | |
| Staff piece page | `heading` level 1 `<tag code>`; `button "Add photo"` (a file chooser labelled `Photo`); per photo `link "Download original"` (owner) | |
| Staff piece page | `button "Change price"` (owner) opening `dialog "Change price"` with `textbox "Asking price"`, `button "Save price"` | |
| Staff piece page | `button "Place hold"` opening `dialog "Place hold"` with `textbox "Shopper name"`, `textbox "Shopper email"`, `button "Hold piece"` | |
| Staff piece page | `button "Archive"` opening `dialog "Archive piece"` with `button "Archive piece"`; `button "Bring back"`; `button "Mark collected"` | |
| Till | `textbox "Tag code"`, `button "Find piece"`, `button "Sell"` opening `dialog "Sell piece"` | |
| Sell piece dialog | the price in force, `radiogroup "Payment"` with `radio "Card"` and `radio "Cash"`, `button "Complete sale"`, `button "Cancel"` | |
| Sale | `heading` level 1 `Sale <tag code>`, `button "Refund"` opening `dialog "Refund sale"` with `button "Confirm refund"` | |
| Holds | `table "Holds"` in `region "Holds table"`; hold page `heading` level 1 `Hold <tag code>`, `button "Release"` opening `dialog "Release hold"` with `button "Release hold"`, `button "Keep hold"` | |
| Appointments | `button "Previous week"`, `button "Next week"`, one `group "<date>"` per day with slot `button "<date-time>"`, `button "Book slot"` opening `dialog "Book slot"` with `textbox "Your name"`, `textbox "Email"`, `button "Confirm booking"` | |
| Cancel appointment page | `button "Cancel appointment"` | |
| Staff appointments | `table "Appointments"` in `region "Appointments table"` | |
| Consignors | `table "Consignors"` in `region "Consignors table"`, `button "New consignor"` opening `dialog "New consignor"` with `textbox "Name"`, `textbox "Email"`, `textbox "Phone"`, `textbox "IBAN"`, `button "Save consignor"` | |
| Consignor | `heading` level 1 `<consignor name>` (`Erased consignor` once erased), `button "Send page address"`, `button "End page address"` (owner), `button "Edit consignor"` opening `dialog "Edit consignor"` (same fields), `button "Erase consignor"` (owner) opening `dialog "Erase consignor"` with `button "Erase"`, `button "Cancel"` | status `Active`, `Erasing` or `Erased` |
| Consignor page | per open piece a `radiogroup "<tag code>: at the end of its period"` with `radio "Return to me"` and `radio "Donate"`; `table "Earnings by month"`; `button "Save choices"` | |
| Ladder | `table "Ladders"`, `button "Change ladder"` opening `dialog "Change ladder"` with `textbox "Takes effect on"`, `textbox "First markdown percent"`, `textbox "First markdown day"`, `textbox "Second markdown percent"`, `textbox "Second markdown day"`, `textbox "Period end day"`, `button "Save ladder"` | |
| Payouts | `table "Payout runs"`, `button "Start payout run"` opening `dialog "Start payout run"` with `combobox "Month"`, `button "Start run"`, `button "Cancel"` | |
| Payout run | `heading` level 1 `Payout run <Month YYYY>`, status text `Ready`, `table "Payouts"` in `region "Payouts table"`, `link "Download bank file"` | |
| Old spreadsheet | `button "Choose file"` (a file chooser labelled `Spreadsheet file`) opening `dialog "Preview import"` with `table "Rows"` in `region "Rows table"`, `button "Save"`, `button "Cancel"` | |
| Sales book | `combobox "Month"`, `table "Sales book"` in `region "Sales book table"`, `button "Download sales book"` opening `dialog "Download sales book"` with `button "Download"`, `button "Cancel"` | |
| Members | `table "Members"`, `button "Add member"` opening `dialog "Add member"` with `textbox "Name"`, `textbox "Email"`, the field labelled `Starting password`, `radiogroup "Role"` with `radio "Shop assistant"` and `radio "Bookkeeper"`, `button "Save member"` | |
| Session ended | `link "Sign in again"` inside `status "Announcements"` | |

Option labels shown next to their API values:
- **Category:** Coats `coats`, Jackets `jackets`, Dresses `dresses`, Knitwear `knitwear`, Shirts `shirts`, Trousers `trousers`, Skirts `skirts`, Shoes `shoes`, Bags `bags`, Accessories `accessories`.
- **Size:** XS `xs`, S `s`, M `m`, L `l`, XL `xl`, 36 `36` through 45 `45` (every whole number), One size `one_size`.
- **Condition:** Excellent `excellent`, Very good `very_good`, Good `good`.
- **Payment:** Card `card`, Cash `cash`.
- **Station:** Full price `full_price`, `<p>% off` `off_25` (the first markdown), `<p>% off` `off_50` (the second markdown), Period ends `period_ends`. `<p>` is the percentage of the piece's own ladder, for example `25% off`.
- **Station state:** `done`, `current`, `next`.
- **Choice:** Return to me `return`, Donate `donate`.
- **Price band** (by current price): Under €50 `under-50` (below €50.00), €50 to €100 `50-100` (€50.00 up to €99.99), €100 to €200 `100-200` (€100.00 up to €199.99), €200 and over `200-plus`.
- **Piece status:** On the rail `on_rail`, On hold `on_hold`, Sold `sold`, Returns shelf `returns_shelf`, Donation box `donation_box`, Returned `returned`, Archived `archived`.
- **Role:** Shop owner `owner`, Shop assistant `assistant`, Bookkeeper `bookkeeper`.
- **Consignor status:** Active `active`, Erasing `erasing`, Erased `erased`.
- **Payout status:** Paid `paid`, Held back `held_back`.
- **Import row status:** Matched `matched`, New `new`, Refused `refused`, Already brought over `already`.

Display formats on every screen:
- dates as `Tue 30 Mar 2027`;
- date-times as `Tue 30 Mar 2027, 10:20` in Brussels time;
- times alone as `14:30` (24-hour, Brussels);
- months as `March 2027`;
- money as `€1,234.50`;
- IBANs in groups of four (`BE68 5390 0754 7034`).

### Interactions (DP-05, DP-06, DP-12, DP-23, DP-24, DP-34, DP-38, DP-43, DP-56)

- **Rail filters.**
  - Choosing a category, size pill, brand or price band updates the list in place, with no reload and no submit button.
  - It also writes the choice into the address as one new history entry. Back and Forward step through those entries and the filters and list follow.
  - Typing in search waits until typing pauses for 300 milliseconds, then runs one search and writes `q` as one new history entry. The list always shows the answer for the latest text, and an older answer that arrives late is dropped.
  - Pressing a selected size pill again clears that size.
  - In the filters sheet, filter changes apply at once in the same way. `Show <n> pieces` closes the sheet.
- **Categories menu.** Opens on press, by click, tap or Enter, never on hover. Escape or pressing Categories again closes it and returns focus to the button. A closed menu or sheet is hidden and inert: nothing in it is visible, focusable or in the accessibility tree. Moving it off-screen does not count as closing it.
- **Markdown stations.**
  - The toolbar is one Tab stop and focus lands on the current station.
  - Left and Right move between stations, and Home and End jump to the first and last.
  - Enter opens that station's popover inside the viewport, never cut off, at 375 and 1280 pixels wide. Escape or Close closes it and returns focus to its station.
  - At 375 pixels wide, where the stations stack, Up and Down also move.
- **Dialogs and sheets.**
  - Opening a dialog moves focus to its first field (or its first button when it has no field).
  - Tab and Shift+Tab wrap inside it. Escape and its Close or Cancel button close it and return focus to the opener at once. Tapping outside a sheet closes it.
  - On a field problem, focus moves to the Problems summary at the top of the dialog or form. Each link in it moves focus to its field.
  - A dialog the server refuses stays open with everything typed, and focus moves to its Problems summary, which shows the server's message.
- **Focus targets after success.**
  - Save piece goes to the new piece's route with focus on its level-1 heading.
  - Complete sale goes to the sale's route with focus on its level-1 heading.
  - Hold piece on the public page closes the dialog and returns focus to Hold this piece, which stays on the page while the piece is on hold.
  - Save ladder, Save price, Save consignor and Save member close their dialog and return focus to the opener.
  - Release hold, Confirm refund, Archive piece and Erase change the record their opener acted on, so they close their dialog and move focus to the screen's level-1 heading (`Hold <tag code>`, `Sale <tag code>`, `<tag code>` and `Erased consignor`).
  - Hold piece in Place hold goes to the hold's route with focus on its level-1 heading.
  - Confirm booking closes the dialog and moves focus to the `Week of <date>` heading.
  - Start run goes to the run's route with focus on its level-1 heading.
  - The import Save closes the dialog and returns focus to Choose file.
  - Download closes its dialog, returns focus to Download sales book and downloads the file.
  - Save choices keeps focus on Save choices.
- **Till.** Typing a tag code (any case, dashes optional) and pressing Enter or Find piece shows the piece. Tab reaches Sell, Enter opens the dialog, the arrow keys choose Card or Cash, and Tab then Enter on Complete sale sells. Every till request carries a fresh request key, and a retry of the same press reuses it.
- **Release hold dialog.** Pressing Release while the dialog is still closing opens it again, and it stays open: no timer left over from the earlier close may hide it again. The 5-second refresh never closes an open dialog, sheet or popover, and never clears what was typed.
- **Consignor page by touch.** Tapping Return to me or Donate selects it, and Save choices sends every changed choice at once. A control that receives focus by Tab or tap is scrolled fully into view between the top bar and the bottom bar.
- **Appointment page.** Previous week and Next week change the `week` parameter. Pressing a free slot selects it, and Book slot opens the dialog.
- **Old spreadsheet.** Choosing a file sends it for a preview and opens Preview import. Save sends the same file to be saved. Cancel saves nothing.
- **Session ended.** When any request answers 401 `session_ended`:
  - an open dialog stays open as typed;
  - the live region announces the session copy with its Sign in again link;
  - that link goes to `/sign-in`, and after signing in the app returns to the same address and opens the same dialog again with the typed values.
- **Pointer type.** Pointer and touch behaviour follows each event's own pointer type, never hover or pointer media queries.

### Screen rules (DP-57; named by every journey requirement)

- **SR1.** Every staff screen, the public rail and piece pages, the appointment page, the consignor page and the hold page re-read their data from the server every 5 seconds while open. A refresh changes only what changed, in place: focus stays on the same control, an open dialog or sheet stays open with what was typed, an expanded row stays expanded and the scroll position stays. A refresh never clears or replaces the announcement, the Problems summary or the refusal message that the last action showed; they stay until the next action.
- **SR2.** Closing a dialog, sheet or popover (by Escape, its Close button or a tap outside a sheet) returns focus to the control that opened it at once, and leaves the page behind usable at once while the closing animation still runs. Pressing that control again during the closing animation opens it again, and no leftover close timer may undo that.
- **SR3.** Under reduced motion every dialog, sheet, menu and popover opens and closes at once: a closed one is gone from the screen and from the accessibility tree within 100 milliseconds. Every loop stops, and every sequence shows its end state at once with the same function.
- **SR4.** At 375x812 the box of every control is at least 44 by 44 CSS pixels: buttons, links (including links in list rows and table cells), form fields and menu items, and for a radio or checkbox the box of its label. Links inside a sentence of running text are the only exception.
- **SR5.** An automated WCAG 2.2 AA check (axe-core, tags wcag2a, wcag2aa, wcag21aa, wcag22aa) reports no violation on any screen at 375x812 and 1280x800, with each dialog or sheet that screen offers at that size open, and with all of them closed. A wide table at 375 scrolls sideways inside its own frame, and that frame takes keyboard focus and has an accessible name (the `region "<table name> table"` above).
- **SR6.** At 375x812 each screen's main action sits in a bar fixed to the bottom, and a control that receives focus by Tab or tap is scrolled fully into view between the top bar and the bottom bar.
- **SR7.** All motion is CSS transitions, CSS animations or element animations with exactly three durations, 160, 320 and 640 milliseconds (a loop's single pass included), and never frames timed by script.
- **SR8.** Every Tab stop shows a visible focus ring. Every dialog and sheet keeps Tab and Shift+Tab inside it (a native dialog element alone does not), closes on Escape and returns focus to its opener.

### Visual design (DP-59, DP-60)

- **Colour.** The whole product sits on a warm off-white page, like unbleached cotton, with one near-black ink for text, rules and icons. Price tags are a pale card-stock beige. A single brick red accent marks the strike line through an old price, markdown percentages and the focus ring. A warm grey is used for secondary text such as dates and brands. Everything meets WCAG 2.2 AA contrast.
- **Type.** Display headings use Familjen Grotesk, a narrow, slightly quirky grotesque. Body text uses Hanken Grotesk, a calm, open sans. Each heading level is about a third larger than the one below it. Every price, tag code, IBAN and time uses tabular figures, so digits line up in columns. Inter is not used anywhere.
- **Density and spacing.** Airy. Sections are separated by generous gaps of about forty pixels, cards have wide margins, and there is never more than one accent element per card.
- **Composition.**
  - The rail is a filters column of rounded size pills and category swatch rows (each a tiny generated garment) beside the grid of cards. Each card's tag hangs from its top-right corner on a thin dark string from a punched hole.
  - Staff screens pair one wide table with a narrow detail column.
  - Dialogs for holds and the till use a centred card with a two-column choice grid, like a calm country-and-language picker.
- **Imagery.** All imagery is generated SVG (garments on hangers, tags, folded-fabric textures) or the shop's own uploaded intake photos. Icons are Lucide.
- **Touch.** Every control is at least 44 by 44 pixels at 375x812 (SR4).

### Motion and effects (DP-13, DP-58, DP-60)

The product uses exactly three durations: 160 milliseconds for small press and hover feedback, 320 milliseconds for dialogs, sheets, popovers and the price slide, and 640 milliseconds for the tag swing. Everything moves with a slight overshoot and then settles. No decorative loop runs anywhere.

- **Dialogs and sheets.** They fade and rise into place in 320 milliseconds and leave the same way. The filters bottom sheet rises from the bottom edge, and the side sheet slides in from the right.
- **Signature, the Markdown tag.** When a piece's price changes while its card or page is open (a markdown step reached, or the owner's price edit arriving in a refresh), two things start in the same frame, and neither waits for the other:
  1. The tag swings once on its string about the punched hole. It tips at most 6 degrees either way and settles back to level over 640 milliseconds.
  2. A brick red line is drawn across the old price from its left edge to its right edge while the new price slides up from just below into place, both over 320 milliseconds.

  The old price then stays struck through beside the new one. Nothing moves when a page first loads.
- **Reduced motion.** The tag never swings and the price changes at once: the old price is already struck through and the new price is already in place in the same frame, with the same live-region announcement and the same station states. Every dialog, sheet, menu and popover opens and closes at once (SR3).

### Feedback states (DP-07, DP-11, DP-14, DP-19, DP-20, DP-24, DP-27, DP-29, DP-31, DP-36, DP-40, DP-41, DP-42, DP-43, DP-48, DP-49, DP-56)

Every async action shows a pending state: the pressed button is disabled and reads `Working…` until the server answers. Every result is announced in `status "Announcements"` with the copy below, character for character, with straight apostrophes and the dashes shown. A server refusal inside a dialog shows the same message in the dialog's Problems summary.

Placeholders:
- `<time>` is a Brussels time such as `14:30`;
- `<date>` and `<date-time>` use the formats in Public screens and controls;
- `<price>` is euros such as `€37.43`;
- `<tag code>` is the upper-case dashed form;
- `<Month YYYY>` is a month name and year;
- `<name>` is the member's name;
- `<n>` is a count.

| Action | Outcome | Copy |
|---|---|---|
| Save piece | success | `Piece <tag code> saved.` |
| Add photo | success | `Photo saved.` |
| Add photo | MinIO down | `Photos can't be saved right now. Nothing was stored — try again in a moment.` |
| Add photo | wrong content (field) | `Use a JPEG, PNG or WebP photo.` |
| Add photo | file over the limit (field) | `This photo is over 5,000,000 bytes.` |
| Add photo | seventh photo | `A piece can have at most 6 photos.` |
| Save price | success | `Price changed to <price>.` |
| Save price | piece changed meanwhile | `This piece changed since you opened it. Check the price and save again.` |
| Hold piece (public) | success | `Held for you until <time>. The details are on their way by mail.` |
| Hold piece (staff) | success | `Hold placed until <time>.` |
| Hold piece | lost to another hold | `Someone else is holding this piece until <time>.` (for example `Someone else is holding this piece until 14:30.`) |
| Hold piece or Confirm booking | Mailpit down | `We can't send your confirmation right now. Nothing was saved — try again in a moment.` |
| Release hold, Let the hold go | success | `Hold released.` |
| Hold page | hold over | `This hold has ended.` |
| Complete sale | success | `Sold <tag code> for <price>.` |
| Complete sale | already sold | `Sold by <name> at <time>. Nothing was charged.` (for example `Sold by Noor at 14:05. Nothing was charged.`) |
| Confirm refund | success | `Refund recorded. <tag code> is back on the rail.` |
| Confirm refund | window closed | `This sale can no longer be refunded.` |
| Confirm refund | in a payout run | `This sale is already in a payout run and can't be refunded.` |
| Save ladder | success | `Ladder saved. It applies to pieces taken in from <date>.` |
| Save ladder | date already used | `A ladder change already takes effect on <date>.` |
| Start run | success | `Payout run for <Month YYYY> is ready.` |
| Start run | already started | `This payout run was already started by <name> at <date-time>.` |
| Start run | MinIO down | `The payout run didn't start: the bank file can't be stored right now. Nothing was paid or sent.` |
| Start run | Mailpit down | `The payout run didn't start: statements can't be sent by mail right now. Nothing was paid or sent.` |
| Start run | nothing due | `There is nothing to pay for <Month YYYY>.` |
| Payout row | held back (shown in the row and the statement) | `No valid IBAN on file — held back until the next run.` |
| Save consignor | success | `Consignor saved.` |
| Send page address | success | `A new page address is on its way by mail.` |
| End page address | success | `The page address has ended.` |
| Consignor page | ended or expired (410 screen heading) | `This page has ended. Ask the shop for a new link.` |
| Save choices | success | `Choices saved.` |
| Save choices | window closed | `The choice for <tag code> is closed.` |
| Confirm booking | success | `Booked for <date-time>. The confirmation is on its way by mail.` |
| Confirm booking | slot just taken | `That slot was just taken. The next free slot is <date-time>.` (for example `That slot was just taken. The next free slot is Tue 30 Mar 2027, 10:20.`) |
| Confirm booking | no free slot left in range | `That slot was just taken. There is no free slot in the next 32 weeks.` |
| Confirm booking | booking limit | `This email address has booked 3 slots in a short while. Try again later.` |
| Cancel appointment | success | `Your appointment is cancelled.` |
| Preview import | success | `Preview ready: <n> matched, <n> new, <n> refused, <n> already brought over.` |
| Save (import) | success | `Saved: <n> pieces and <n> new consignors brought over.` |
| Download | success | `Sales book for <Month YYYY> downloaded.` |
| Download | download limit | `You've downloaded the sales book 5 times in a short while. Try again in a moment.` |
| Erase | waiting on MinIO | `Erasing photos — this consignor shows Erased once every photo is gone.` |
| Erase | done | `Consignor erased.` |
| Archive piece | success | `Piece archived.` |
| Bring back | success | `Piece brought back.` |
| Mark collected | success | `<tag code> collected by its consignor.` |
| Save member | success | `Member added.` |
| Public piece page | sold past its lifetime (410 screen heading) | `This piece has left the rail.` |
| Any request | session ended | `Your session ended. Sign in again to keep going — what you typed is still here.` followed by the link `Sign in again` |

Field messages, shown beside the field and in the Problems summary:

| Field | Message |
|---|---|
| name | `Enter a name.` |
| email | `Enter an email address like name@example.be.` |
| IBAN | `Enter a valid IBAN, for example BE68 5390 0754 7034.` |
| asking price | `Enter a price from €1.00 to €10,000.00.` |
| intake date | `Choose today or a date up to 730 days back.` |
| tag code | `This tag code's check digit doesn't match.` |

## Backend

### API (DP-01, DP-02, DP-09, DP-10, DP-11, DP-13, DP-17, DP-20, DP-21, DP-25, DP-28, DP-31, DP-35, DP-36, DP-37, DP-40, DP-41, DP-44, DP-47, DP-48, DP-51, DP-52, DP-54)

**Conventions.**
- Every JSON key, nested keys included, is camelCase.
- Every instant in a response is UTC in whole seconds with a Z, for example `2027-03-27T23:00:00Z`, never with milliseconds.
- Dates are `YYYY-MM-DD` Brussels dates, months are `YYYY-MM`, and money is integer cents in keys ending `Cents`.
- Ids are UUID strings, except payout ids.
- JSON requests must be `application/json`.
- Every error body is `{"error":{"code":"<code>","message":"<message>","fields":{"<field>":"<message>"}}}`. `fields` appears only for field errors (422) and always inside `error`. Where Feedback states publishes copy for a refusal, `message` is that copy with its values filled in.
- Only the endpoints below exist.

**Error order.** Every API request is judged in this order, and the first rule broken decides the answer:
1. Unknown route (404 `not_found`) or wrong method (405 `method_not_allowed` with an `Allow` header).
2. A body over its size limit (413 `payload_too_large`). This is decided while reading and before parsing or authentication, and is always answered as JSON, never a dropped connection.
3. Rate limit (429 `rate_limited` with `Retry-After` in whole seconds). The booking limit is keyed on the request's email and the sales book limit on the signed-in member, so each is judged as soon as its key is known.
4. Authentication: 401 `unauthenticated` for no or unknown session, 401 `session_ended` for an ended one.
5. Unknown resource named in the path or by a private token: 404 `not_found`, or 410 `piece_gone` for a sold piece past its lifetime and 410 `page_ended` for an ended private page. This step covers only path ids and token-bound resources. Ids inside a request body are judged at step 10.
6. Role (403 `forbidden`).
7. Content type (415 `unsupported_media_type`).
8. Malformed JSON (400 `malformed_json`).
9. A till request whose request key was seen before (stored response or 409 `request_key_reused`).
10. Ids inside the body, then field validation. Body ids are judged only once the body has been read and parsed as JSON. An unknown id inside the body answers 404 `not_found`: for example an unknown or erased `consignorId` in POST `/api/pieces`, an unknown `pieceId` in POST `/api/sales`, or another consignor's `pieceId` in PUT `/api/portal/{token}/choices`. Field validation then answers 422 `validation_failed`.
11. State (409 with its code).
12. A stale edit (412 `stale_edit`).

Outage refusals (503 `storage_unavailable`, 503 `mail_unavailable`) come after every rule above.

**Body limits.** JSON bodies are at most 65,536 bytes. A photo upload body is at most 6,000,000 bytes and its photo file at most 5,000,000 bytes. A spreadsheet body is at most 2,000,000 bytes. A size equal to the limit is allowed.

**Roles.**
- Public endpoints need no session.
- "staff" means any signed-in member.
- "desk" means the owner and shop assistants.
- "owner" means the shop owner only.
- "books" means the owner and the bookkeeper.

The bookkeeper's every POST, PUT, PATCH and DELETE (other than sign-out) answers 403.

| Method and path | Role | Request | Success | Extra errors |
|---|---|---|---|---|
| GET `/api/health` | public | | 200 `{"status":"ok"}` | |
| POST `/api/session` | public | `{"email":"noor@atelier-ourlet.example","password":"ourlet-noor-2027"}` | 200 `{"member":{id,name,email,role},"homeRoute":"/staff/pieces"}` and the session cookie | 401 `invalid_credentials` for a wrong password, an unknown email and a removed member alike |
| GET `/api/session` | staff | | 200 same body | |
| DELETE `/api/session` | staff | | 204; the cookie's session ends | |
| GET `/api/members` | owner | | 200 `{"members":[{id,name,email,role,createdAt}]}` | |
| POST `/api/members` | owner | `{"name":"Lieve","email":"lieve@atelier-ourlet.example","password":"start-here-4821","role":"assistant"}` | 201 `{"member":{…}}` | 422 (role is `assistant` or `bookkeeper`; password 10 to 128 characters); 409 `member_email_taken` |
| GET `/api/members/{id}` | owner | | 200 `{"member":{…}}` | |
| PATCH `/api/members/{id}` | owner | `{"role":"bookkeeper"}` | 200 `{"member":{…}}` | 422 |
| DELETE `/api/members/{id}` | owner | | 204 | 409 `cannot_remove_owner` |
| GET `/api/rail?category=&size=&brand=&price=&q=` | public | | 200 `{"pieces":[railPiece]}` | 422 for an unknown `category`, `size` or `price` value; a `brand` that no piece on the rail has gives 200 with an empty list |
| GET `/api/public/pieces/{id}` | public | | 200 `{"piece":railPiece with stations}` | 410 `piece_gone`; 404 when the piece is not on the rail, on hold or sold |
| GET `/api/pieces?status=&q=` | desk | | 200 `{"pieces":[piece]}` | |
| GET `/api/pieces/lookup?tag=hg10000420` | desk | | 200 `{"piece":piece}` | 422 `fields.tag` when the code is not well formed or its check digit fails; 404 for a well-formed code with no piece |
| POST `/api/pieces` | desk | `{"consignorId":"<consignor id>","category":"coats","brand":"Maison Arlo","description":"Wool wrap coat, camel","size":"m","condition":"very_good","askingPriceCents":4990,"intakeDate":"2026-02-27"}` | 201 `{"piece":piece}` | 404 for an unknown or erased `consignorId`; 422 |
| GET `/api/pieces/{id}` | desk | | 200 `{"piece":piece}` | |
| PATCH `/api/pieces/{id}` | owner | `{"askingPriceCents":4500}`, optional header `If-Match: "<version>"` | 200 `{"piece":piece}` | 422; 409 `not_for_sale` when sold or archived; 412 `stale_edit` |
| POST `/api/pieces/{id}/photos` | desk | `multipart/form-data` with one file part `photo` | 201 `{"photo":{id,pieceId,contentType,width,height,publicUrl,createdAt}}` | 413; 422 `fields.photo`; 409 `photo_limit`; 503 `storage_unavailable` |
| GET `/api/photos/{id}` | public for a piece the public may see, otherwise desk | | 200 the public copy's bytes | |
| GET `/api/photos/{id}/original` | owner | | 200 the original's bytes with its original content type | |
| POST `/api/pieces/{id}/archive` | owner | | 200 `{"piece":piece}` | 409 `cannot_archive` when on hold, sold or archived |
| POST `/api/pieces/{id}/restore` | owner | | 200 `{"piece":piece}` | 409 `not_archived`; 409 `consignor_erased` |
| POST `/api/pieces/{id}/collected` | desk | | 200 `{"piece":piece}` | 409 `not_on_returns_shelf` |
| GET `/api/ladders` | owner | | 200 `{"ladders":[ladder]}` | |
| POST `/api/ladders` | owner | `{"effectiveOn":"2027-05-01","firstMarkdownPercent":30,"firstMarkdownDay":21,"secondMarkdownPercent":60,"secondMarkdownDay":45,"periodEndDay":75}` | 201 `{"ladder":ladder}` | 422; 409 `ladder_date_taken` |
| POST `/api/pieces/{id}/holds` | public, or desk | `{"name":"Camille","email":"camille@shoppers.example"}` | 201 `{"hold":{id,pieceId,startsAt,endsAt,status}}` | 422; 409 `hold_taken`; 409 `not_for_sale`; 503 `mail_unavailable` |
| GET `/api/holds` | desk | | 200 `{"holds":[{id,pieceId,tagCode,shopperName,shopperEmail,startsAt,endsAt,status}]}` (active holds) | |
| GET `/api/holds/{id}` | desk | | 200 `{"hold":{…}}` | |
| POST `/api/holds/{id}/release` | desk | | 200 `{"hold":{…,"status":"released"}}` | 409 `hold_ended` |
| GET `/api/holds/by-token/{token}` | public | | 200 `{"hold":{status,endsAt,secondsLeft,piece:{tagCode,description,brand,size,currentPriceCents,photoUrl},shopAddress}}` | |
| POST `/api/holds/by-token/{token}/release` | public | | 200 same body with status `released` | 409 `hold_ended` |
| POST `/api/sales` | desk | `{"pieceId":"<piece id>","payment":"cash","soldAt":"2026-03-14T13:05:00Z"}` (`soldAt` optional; leave it out for a sale now), optional header `Request-Key: <1 to 100 characters>` | 201 `{"sale":sale}` | 422; 409 `already_sold`; 409 `not_for_sale`; 409 `request_key_reused` |
| GET `/api/sales/{id}` | staff | | 200 `{"sale":sale}` | |
| POST `/api/sales/{id}/refund` | desk | | 200 `{"sale":sale}` | 409 `refund_window_closed`; 409 `already_refunded`; 409 `sale_in_payout_run` |
| GET `/api/sales?month=2026-03` | books | | 200 `{"month","lines":[{saleId,soldAt,tagCode,description,priceCents,consignorShareCents,commissionCents,vatCents,consignorName}],"totals":{priceCents,consignorShareCents,commissionCents,vatCents}}` | 422 |
| GET `/api/sales-book?month=2026-03` | books | | 200 the sales book file | 429; 422 |
| GET `/api/payout-runs` | books | | 200 `{"runs":[run without payouts]}` | |
| POST `/api/payout-runs` | owner | `{"month":"2026-03"}` | 201 `{"run":run}` for the start that creates it; 200 `{"run":run}` for every later start for that month | 422; 409 `month_not_ended`; 409 `nothing_due`; 503 `storage_unavailable`; 503 `mail_unavailable` |
| GET `/api/payout-runs/{YYYY-MM}` | books | | 200 `{"run":run}` | |
| GET `/api/payout-runs/{YYYY-MM}/file` | books | | 200 `application/xml`, the stored file byte for byte | |
| GET `/api/consignors` | desk | | 200 `{"consignors":[consignor]}` | |
| POST `/api/consignors` | desk | `{"name":"Amélie Kint","email":"amelie.kint@consignors.example","phone":"+32 471 22 33 44","iban":"be35 3101 2345 6737"}` (`phone` and `iban` optional) | 201 `{"consignor":consignor}` | 422; 409 `consignor_email_taken` |
| GET `/api/consignors/{id}` | desk | | 200 `{"consignor":consignor,"pieces":[piece],"payouts":[payout]}` | |
| PATCH `/api/consignors/{id}` | desk | any of `name`, `email`, `phone`, `iban` | 200 `{"consignor":consignor}` | 422; 409 `consignor_email_taken`; 409 `consignor_erased` |
| POST `/api/consignors/{id}/portal-link` | desk | | 201 `{"pageEndsAt":"…"}`; the address is sent by mail | 409 `consignor_erased`; 503 `mail_unavailable` |
| DELETE `/api/consignors/{id}/portal-link` | owner | | 204 | |
| POST `/api/consignors/{id}/erase` | owner | | 202 `{"consignor":consignor}` with status `erasing` or `erased` | 409 `already_erased` |
| GET `/api/portal/{token}` | public | | 200 `{"consignor":{name,ibanLast4,ibanValid},"pageEndsAt","pieces":[portalPiece],"earnings":[{month,shareCents}]}` | 410 `page_ended` |
| GET `/api/portal/{token}/pieces/{pieceId}` | public | | 200 `{"piece":portalPiece}` | 404 for a piece that is not this consignor's |
| PUT `/api/portal/{token}/choices` | public | `{"choices":[{"pieceId":"<piece id>","choice":"return"}]}` | 200 `{"pieces":[portalPiece]}` | 404 when any piece is not this consignor's (nothing saved); 422; 409 `choice_closed` (nothing saved) |
| GET `/api/appointment-slots?week=2027-03-29` | public | | 200 `{"weekStart","previousWeek","nextWeek","slots":[{startsAt,endsAt,free}]}` | 422 `fields.week` for a date that is not a Monday or is outside the range |
| POST `/api/appointments` | public | `{"startsAt":"2027-03-30T08:00:00Z","name":"Amélie Kint","email":"amelie.kint@consignors.example"}` | 201 `{"appointment":{id,startsAt,endsAt}}` | 429; 422 `fields.startsAt` for an instant that is not a bookable slot; 409 `slot_taken`; 503 `mail_unavailable` |
| GET `/api/appointments` | desk | | 200 `{"appointments":[{id,startsAt,endsAt,name,email}]}` (upcoming, not cancelled) | |
| GET `/api/appointments/by-token/{token}` | public | | 200 `{"appointment":{startsAt,endsAt,status}}` | |
| POST `/api/appointments/by-token/{token}/cancel` | public | | 200 `{"appointment":{…,"status":"cancelled"}}` | 409 `already_cancelled` |
| POST `/api/imports/preview` | owner | `text/csv` body, the file | 200 `{"rows":[{row,itemNo,status,consignorName,reason}],"counts":{matched,new,refused,already}}` | 413; 422 `fields.file` |
| POST `/api/imports` | owner | `text/csv` body, the same file | 200 `{"counts":{…},"piecesCreated","consignorsCreated"}` | 413; 422 `fields.file` |

Response shapes:
- **`railPiece`**: `id, tagCode, description, category, brand, size, condition, status, station, currentPriceCents, previousPriceCents, photoUrls`. The public piece page adds `stations` and `soldAt` when sold. It never carries consignor or shopper data.
- **`piece`**: `railPiece` plus `consignor {id,name}, askingPriceCents, intakeDate, ladderId, stations, choice, choiceOpensAt, choiceClosesAt, photos, version, archivedAt, collectedAt`.
- **`stations`**: four objects `{station, label, at, priceCents, state}`.
- **`portalPiece`**: `id, tagCode, description, category, brand, size, status, station, currentPriceCents, previousPriceCents, stations, choice, choiceOpen, choiceOpensAt, choiceClosesAt, shareCents` (sold pieces only, otherwise null). For a sold piece, `currentPriceCents`, `previousPriceCents` and every station's `priceCents` are null, so no portal response reveals a sale price.
- **`sale`**: `id, pieceId, tagCode, soldAt, priceCents, consignorShareCents, commissionCents, vatCents, payment, soldBy {id,name}, consignorName, refundedAt, refundableUntil`.
- **`run`**: `month, status ("ready"), startedAt, startedBy {id,name}, readyAt, msgId, controlSumCents, payouts:[{id, consignorId, consignorName, iban, amountCents, status, reason}]`.
- **`consignor`**: `id, name, email, phone, iban (stored form), ibanValid, status, createdAt`.
- **`ladder`**: `id, effectiveOn` plus the five numbers.

**Sales book file.**
- Content type `text/csv; charset=utf-8`, attachment named `sales-book-<YYYY-MM>.csv`, UTF-8 with no byte order mark.
- Every field is in double quotes, a double quote inside a field is doubled, and every line ends with CRLF.
- The header line is `"Sale date","Tag code","Description","Sale price","Consignor share","Commission","VAT"`.
- Each line is one sale not refunded by the time of download, ordered by `soldAt` and then by sale id. The sales book screen and `GET /api/sales` list their lines in the same order. Each line holds the Brussels sale date-time as `2027-03-14 14:05`, the tag code, the piece's description, and the four amounts in euros with two decimals and a dot (`37.43`, no symbol, no thousands separator).
- The last line is `"Total","",""` followed by the four sums.
- Any cell whose first character is `=`, `+`, `-`, `@`, a tab or a carriage return gets an apostrophe added in front.

**Bank transfer file.** See Business rules, Payout runs.

### Business rules (DP-09, DP-12, DP-13, DP-15, DP-16, DP-17, DP-18, DP-20, DP-21, DP-25 to DP-28, DP-30 to DP-33, DP-35 to DP-41, DP-44, DP-45, DP-50 to DP-52)

**Brussels days.** A Brussels day runs from local midnight to local midnight, so it lasts 23 hours on 28 Mar 2027 and 25 hours on 31 Oct 2027. Day 0 of a piece is its intake date, and "day N" is the date N calendar days later, starting at 00:00 Brussels time.
- A piece taken in on 26 Feb 2027 reaches 25% off at 2027-03-27T23:00:00Z.
- A piece taken in on 27 Feb 2026 reaches 25% off at 2026-03-28T23:00:00Z, 50% off at 2026-04-27T22:00:00Z and its period end at 2026-05-27T22:00:00Z.

**Members and sessions.**
- The owner adds shop assistants and bookkeepers with a starting password, changes their role (it applies from their next request) and removes them.
- A removed member's sessions end and their sign-in answers like a wrong password.
- A removed member's id, an unknown id and any id that is not a current member answer 404 on every member endpoint.
- Seeded members are never removed by tests, and the owner cannot be removed.
- The session cookie is `ourlet_session`, HttpOnly, SameSite Lax, path `/`, with no Max-Age or Expires.
- A session ends SESSION_SECONDS after sign-in, or at sign-out. From then on the server answers 401 `session_ended` for that cookie.

**Tag codes.**
- A tag code is `HG-`, seven digits, `-` and a Luhn check digit computed over the seven digits. HG-1000042-0 is valid and HG-1000042-1 is not.
- New pieces get the next seven-digit number after the highest one given so far, starting after the seeded codes.
- Lookup ignores letter case and dashes and always answers with the upper-case dashed form.

**Intake.**
- A piece has:
  - a consignor;
  - a category, size and condition from the published lists;
  - a brand of 1 to 60 characters and a description of 1 to 120 characters;
  - an asking price from 100 to 1,000,000 cents inclusive;
  - an intake date that is today or up to 730 days back in Brussels, never in the future.
- A piece takes the ladder in force on its intake date.
- Up to 6 photos per piece.
- A photo is accepted when its first bytes say JPEG, PNG or WebP, whatever its file name or declared type, and its decoded image is readable. The photo file is at most 5,000,000 bytes, counted on the file alone, never on the request body. A 4,999,000-byte photo inside a larger request is accepted, and a 5,000,001-byte photo answers 413.

**Markdown ladder.**
- A ladder has a first and second markdown percentage (whole numbers, 1 to 90, first below second), a first and second markdown day and a period end day (whole numbers with 1 ≤ first < second < period end ≤ 365 and period end ≥ 15), and the Brussels date it takes effect on: today or up to 365 days ahead.
- The ladder in force on a date is the one with the latest effective date on or before it, and it applies to every piece with that intake date, including pieces already taken in that day.
- Two ladders with the same effective date are refused (409 `ladder_date_taken`).
- The seeded ladder is 25% off from day 30, 50% off from day 60 and period end on day 90.
- A piece is at its asking price from 00:00 Brussels on day 0, at the first markdown from 00:00 on its first markdown day, at the second markdown from 00:00 on its second markdown day, and its period ends at 00:00 on its period end day.
- Each markdown price is the asking price × (100 − percentage) / 100 in integer cents, rounded half up. EUR 49.90 at 25% off is EUR 37.43, where floating point 49.9 × 0.75 gives 37.42. EUR 19.90 at 25% off is EUR 14.93.
- A piece keeps its ladder on every screen, the rail, the till, the sales book and the payouts.

**Stations.**
- Each station's `at` is its whole-second UTC instant.
- The current station is the latest whose `at` is at or before now, the stations before it are `done` and those after it are `next`.
- `currentPriceCents` is the price of the current station, by the asking price in force now.
- `previousPriceCents` is the price just before the most recent price change (a markdown step or a price edit), or null when the piece has never changed price.
- After its period ends, a piece's station is `period_ends`.
- All of this comes from the server's clock. The device clock may be wrong by hours, and no screen computes a price, station state, end time or countdown from it.

**Price edits.** The owner changes a piece's asking price while it is not sold or archived. From that instant every station price follows the new asking price with the same ladder and dates. Earlier instants keep the asking price in force then, which matters for earlier sales. Each edit raises the piece's `version`, and an `If-Match` with an older version answers 412.

**Piece states.**
- A piece is `on_rail` from intake until its period ends, unless it is on hold, sold or archived.
- `on_hold` while it has an active hold.
- `sold` once sold and not refunded.
- At 00:00 Brussels on its period end day it leaves the rail: to `returns_shelf` when its choice is Return to me, otherwise to `donation_box`.
- A Returns shelf piece not marked collected by 00:00 Brussels on day (period end + 14) moves to `donation_box`. Marking it collected makes it `returned`.
- The owner archives a piece that is on the rail, on the Returns shelf, in the Donation box or returned. Archiving an on-hold, sold or archived piece is refused (409 `cannot_archive`).
- Bringing an archived piece back restores it exactly as it was: same tag code, ladder, asking price history, photos, choice, collection mark and station instants. Its state is then whatever its dates give at that moment.

**Holds.**
- A shopper (or an assistant for them) holds a piece that is on the rail by giving a name (1 to 80 characters) and an email.
- A hold starts at the request's instant, cut to the whole second, and lasts HOLD_SECONDS. It ends at its period end if that comes earlier.
- A hold ends exactly at its end instant: a request at that instant finds it ended. It also ends when released or when the piece is sold.
- A piece has at most one active hold. When two holds for one piece arrive at the same moment, exactly one is created (201) and every other answers 409 `hold_taken` with the winning hold's Brussels end time.
- Holding a piece that is sold, archived or past its period answers 409 `not_for_sale`.
- Releasing or letting go a hold that has already ended answers 409 `hold_ended`.
- The hold page's `secondsLeft` is the server's count at the moment of reading, and the page shows it in whole minutes, rounded down.

**Till.**
- A sale's price is the piece's price in force at the sale's instant. Payment is `card` or `cash`.
- A held piece may be sold, and that ends its hold.
- A sale of a piece that is already sold answers 409 `already_sold` naming the member who sold it and the sale's Brussels time, and nothing is recorded.
- Selling a piece that is archived, on a shelf or returned answers 409 `not_for_sale`.
- **Request key.** A request carrying a `Request-Key` already used by the same member within the last 24 hours answers exactly the stored first status and body when the body is the same, and records nothing new. With a different body it answers 409 `request_key_reused`.
- **Earlier sales.** `soldAt` may lie up to 730 days in the past, never in the future, and within the piece's period: from 00:00 Brussels on its intake date to before its period end, else 422 `fields.soldAt`. Its price is the price in force at that instant. Its refund window counts from that instant. It belongs to that Brussels month in the sales book and the payout runs.
- **Shares.** The consignor's share is 60% of the whole sale price when the sale price is EUR 300.00 or less, and 70% of the whole sale price when it is more, in integer cents rounded half up. 70% of EUR 312.45 is EUR 218.72, where floating point gives 218.71. The commission is the sale price minus the share. The VAT inside it is commission × 21 / 121, rounded half up to the cent. All four amounts are fixed when the sale is recorded.
- **Refund.** A sale can be refunded until 23:59:59 Brussels time on the 14th Brussels day after the sale's date: day 0 is the sale date, and the window closes at 00:00 Brussels on day 15. `refundableUntil` carries the instant 23:59:59 Brussels on day 14, and a refund at that instant is still allowed. For example, a sale on 14 Mar 2027 has `refundableUntil` `2027-03-28T21:59:59Z`, and a refund from `2027-03-28T22:00:00Z` is refused. An earlier sale recorded 13 days back can be refunded, and one 15 days back is refused with 409 `refund_window_closed`. A refund puts the piece back in the state its dates give at that instant, on the rail at its price in force when still within its period. A sale already in a payout run (paid or held back) cannot be refunded (409 `sale_in_payout_run`).

**Payout runs.**
- The owner starts the run for any Brussels month that has ended (it ends at 00:00 Brussels on the first day of the next month) and has no run yet. A month not yet ended answers 409 `month_not_ended`.
- A run covers:
  - every unrefunded sale in that month;
  - every unrefunded sale held back in an earlier run and not yet paid.
- Erased consignors are left out.
- One payout per consignor with a share due:
  - **paid** when their IBAN passes MOD-97;
  - **held back**, with the held-back reason from Feedback states, when it does not. Their sales stay due for the next run started.
- When no consignor with a valid IBAN has a share due, the start answers 409 `nothing_due` and nothing is recorded.
- Payout ids are `PO-<YYYY-MM>-<NNN>`. Every payout of the run, paid or held back, is numbered from 001 in order of its creditor name made by the SEPA name rule, compared by Unicode code point, then by consignor id.
- In one step the run records its payouts, writes the bank transfer file, stores it in MinIO and sends each consignor in the run one statement mail. All of it happens or none of it does: when MinIO or Mailpit cannot complete its part, nothing is recorded, stored or sent, and the start answers 503.
- The run's status is Ready only after MinIO has confirmed the stored file and every statement mail has been accepted. The 201 answer comes only then.
- Starting the run again for a month that already has one answers 200 with that same run, and nothing is recorded, stored or sent again. When two starts for one month arrive at the same moment, exactly one answers 201 and creates the run, and every other answers 200 with that run, whose `startedBy` and `startedAt` name who started it and when.
- **The bank transfer file** is ISO 20022 `pain.001.001.03` (namespace `urn:iso:std:iso:20022:tech:xsd:pain.001.001.03`):
  - `GrpHdr` with `MsgId` `PAYOUT-<YYYY-MM>`, `CreDtTm` in UTC whole seconds with Z, `NbOfTxs` (paid payouts), `CtrlSum` (their sum, two decimals), and `InitgPty/Nm` the shop's legal name;
  - one `PmtInf` with `PmtInfId` equal to `MsgId`, `PmtMtd` `TRF`, `NbOfTxs`, `CtrlSum`, `PmtTpInf/SvcLvl/Cd` `SEPA`, `ReqdExctnDt` the run's Brussels start date, `Dbtr/Nm` the shop's legal name, `DbtrAcct/Id/IBAN` the shop's own IBAN, `DbtrAgt/FinInstnId/Othr/Id` `NOTPROVIDED` and `ChrgBr` `SLEV`;
  - one `CdtTrfTxInf` per paid payout, in payout id order, with `PmtId/EndToEndId` the payout id, `Amt/InstdAmt Ccy="EUR"` with two decimals, `Cdtr/Nm` by the SEPA name rule, `CdtrAcct/Id/IBAN` the consignor's IBAN and `RmtInf/Ustrd` `Consignment payout <Month YYYY>` (for example `Consignment payout March 2027`).

  Held-back payouts are not in the file.
- **SEPA name rule.**
  1. Map Ł to L, Ø to O, Æ to AE, ß to ss, Œ to OE, Đ to D and Þ to TH (lower case alike).
  2. Apply Unicode NFKD and remove combining marks.
  3. Turn every character outside a–z, A–Z, 0–9 and `/ - ? : ( ) . , ' +` and space into a space.
  4. Make runs of spaces one space, trim, and keep at most 70 characters.

  "Zoë & Łukasz Ørsted-Hæk" becomes "Zoe Lukasz Orsted-Haek", and "Ségolène D’Hondt" with a curly apostrophe becomes "Segolene D Hondt".
- **IBANs** are checked by ISO 13616 MOD-97: BE68 5390 0754 7034 is valid and BE68 5390 0754 7035 is not. Lower case and spaces are accepted on input. IBANs are stored without spaces in upper case and shown in groups of four. An invalid IBAN sent to an endpoint answers 422. Only the seed can hold an invalid one (the spreadsheet refuses such rows), and a consignor may have no IBAN at all; both count as no valid IBAN in a payout run.

**Consignor page.**
- Sending the page address makes a new private address `/c/<token>` that lasts PORTAL_PAGE_SECONDS and mails it to the consignor. A new address ends the old one at once, and the owner can end the current one.
- An ended or expired address answers 410 `page_ended` on every portal endpoint. An unknown token answers 404.
- The page reads and acts only on that consignor's own pieces (archived ones excluded). Another consignor's piece id answers 404, also inside a choices body.
- Earnings per month are the sums of the consignor's shares of unrefunded sales, by Brussels sale month.
- No portal response carries shopper names or emails, other consignors, sale prices, commission, VAT, or more of the IBAN than its last four characters.

**Return to me or Donate.** For each piece the choice is open from 00:00 Brussels on day (period end − 14), which is day 76 with the seeded ladder, until 00:00 Brussels on its period end day. A choice sent outside that window, or for a piece that is sold, answers 409 `choice_closed` and saves nothing from that request. After the window closes, Donate applies unless Return to me was chosen.

**Intake appointments.**
- Slots are 20 minutes long, Tuesday to Saturday, starting every 20 minutes from 10:00 to 17:40 Brussels time (the last slot starts at 17:40).
- Slots are bookable from 00:00 Brussels tomorrow until before 00:00 Brussels on the date 224 days after tomorrow (32 weeks).
- The page shows one Monday-to-Sunday week at a time. `previousWeek` and `nextWeek` are null at the ends of the range, and a missing `week` means the week containing tomorrow.
- Wall-clock times stay the same across clock changes: Sat 27 Mar 2027 10:00 is 2027-03-27T09:00:00Z, and Tue 30 Mar 2027 10:00 is 2027-03-30T08:00:00Z.
- A slot holds one appointment that is not cancelled. When two bookings of one slot arrive at the same moment, exactly one is created and every other answers 409 `slot_taken`, whose message names the earliest free slot after the taken one.
- One email address, compared case-insensitively and never by network address, can make at most 3 bookings per APPOINTMENT_RATE_WINDOW_SECONDS. Every created booking counts, cancelled ones included. The next request with that email answers 429 with `Retry-After`: the whole seconds until the oldest counted booking leaves the window.
- The cancel address `/appointments/cancel/<token>` frees the slot. Cancelling it again answers 409 `already_cancelled`.

**Old spreadsheet.**
- The file is UTF-8 with or without a byte order mark, with LF or CRLF line ends, comma separated, and double-quoted fields where needed. Its first line must be exactly `item_no,consignor_name,consignor_email,consignor_phone,consignor_iban,category,brand,description,size,condition,asking_price,intake_date`; any other header answers 422 `fields.file`.
- Row 1 is the header, so the first data row is row 2.
- Category, size and condition are their on-screen labels in any letter case. `asking_price` is euros with a dot and up to two decimals. `intake_date` is `YYYY-MM-DD`.
- **Matching.** Each row's consignor is matched:
  1. by email, compared case-insensitively, against an existing consignor, when `consignor_email` is not empty. A row with an empty `consignor_email` is not refused for it: it skips this step.
  2. then by normalised name: lower case, accents removed, every run of characters other than letters and digits made one space, trimmed;
  3. otherwise the consignor is created from the row. A consignor created from a row with an empty email has no email (`email` is null).

  Rows are matched in file order, in the preview and in Save alike. A consignor created by an earlier row of the same file counts as existing for later rows. Later rows therefore share that new consignor when they have the same email in any letter case, or, without an email match, the same normalised name, and such a later row has status `matched`. Erased consignors never match. A matched consignor's stored details are not changed.
- **Refusal reasons**, one per refused row, in this order:
  - `Missing item number.`
  - `Item number appears twice in this file.` (for every repeat after the first)
  - `This row has <n> fields; the header has 12.`
  - `Missing consignor name.`
  - `Email address isn't valid.` (only for a non-empty `consignor_email`)
  - `IBAN doesn't pass its check.` (only for a non-empty `consignor_iban`; a row with an empty one brings its consignor over with no IBAN)
  - `More than one consignor has this name.`
  - `Unknown category.`
  - `Missing brand.`
  - `Missing description.`
  - `Unknown size.`
  - `Unknown condition.`
  - `Asking price must be between €1.00 and €10,000.00.`
  - `Intake date must be today or up to 730 days back.`
- A row whose `item_no` was already brought over has status `already` and changes nothing.
- The preview saves nothing. Save brings over every matched and new row: a piece with a new tag code, the row's intake date, the ladder in force on that date, and the row's item number kept with it. Saving the same file a second time changes nothing.

**Erasure.**
- Erasing a consignor at once replaces their name with `Erased consignor` and clears their email, phone and IBAN in the database and every response.
- Their page address ends, their unsold pieces are archived and any holds on them are released.
- Every photo of those unsold pieces, original and public copy, is deleted from MinIO. Photos of sold pieces stay.
- No mail to them is ever left waiting: every mail is sent at its action or the action is refused.
- The consignor shows `erasing` until MinIO has confirmed every deletion, retrying every 5 seconds while MinIO is unreachable, and only then `erased`. Erasing always first asks MinIO which objects of theirs it holds, so while MinIO is unreachable a consignor stays `erasing` even when none of their pieces has a photo. When the 202 answer already carries `erased`, the announcement is `Consignor erased.`.
- Their sales stay in the sales book with `Erased consignor`, and their unpaid shares are left out of later runs.
- Erasing again answers 409 `already_erased`, and editing an erased consignor or bringing back their pieces answers 409 `consignor_erased`.

**Sold piece lifetime.** A sold piece's public page shows its sold state, never 404, until 00:00 Brussels on day 30 after the sale date. From then on it answers 410 `piece_gone`. After a refund it follows its state again.

**Rail.**
- The rail lists pieces that are on the rail or on hold, plus pieces sold on the current Brussels day shown as Sold, newest intake date first, then by tag code.
- `q` matches the description or brand case-insensitively, or a tag code in any case with or without dashes.
- The price band follows the current price.

### Services (DP-11, DP-22, DP-30, DP-32, DP-33, DP-36, DP-42, DP-51)

**Postgres** (`DATABASE_URL`) holds the shop's record: members and sessions, consignors, pieces and their tag codes, asking price history, ladders with their effective dates, photos' metadata, holds, appointments, sales and refunds, request keys, payout runs and payouts, page addresses, and rows brought over from the previous tool's spreadsheet. Apply the schema idempotently when the app starts.

**MinIO** (`S3_*`) keeps, in `S3_BUCKET`:
- each intake photo's original byte for byte at `pieces/<piece id>/photos/<photo id>/original`;
- its public copy at `pieces/<piece id>/photos/<photo id>/public`, in the same format as the original, with the camera orientation applied, then every metadata block (EXIF, GPS, XMP, comments) removed, and the longest side at most 1600 pixels;
- each run's bank transfer file at `payouts/PAYOUT-<YYYY-MM>.xml`.

The app serves photos and files to the browser itself (same origin). While MinIO is unreachable, a photo answers 503 `storage_unavailable` with nothing stored, and a payout run answers 503 `storage_unavailable` with nothing recorded, stored or sent. The copy for each is in Feedback states.

**Mailpit** (`SMTP_HOST`, `SMTP_PORT`) receives every mail, From `MAIL_FROM`. Addresses in mails start with `APP_PUBLIC_URL` when it is set, otherwise with `http://localhost:<port>`.

| Mail | To | Subject | Carries only |
|---|---|---|---|
| Hold | the shopper's email | `Your hold at Atelier Ourlet until <time>` | the piece's tag code, description, brand, size and price, the shop's address, the hold's end as `<date-time>`, and the hold page address |
| Slot confirmation | the booking email | `Your intake appointment on <date-time>` | the slot as `<date-time>`, the shop's address and the cancel address |
| Consignor page | the consignor | `Your Atelier Ourlet consignor page` | the page address and its end as `<date-time>` |
| Statement | each consignor in a run | `Your Atelier Ourlet statement for <Month YYYY>` | each of their sold pieces in the run (tag code, description, sale date, share), their total, and either `Paid to the account ending <last four>` or the held-back reason |

No mail carries shopper names or emails (apart from the address it is sent to), other consignors, commission or VAT, or more of an IBAN than its last four characters. While Mailpit is unreachable, a hold or booking answers 503 `mail_unavailable` with nothing saved, sending a page address answers 503 `mail_unavailable` with the old address still valid, and a payout run answers 503 `mail_unavailable` with nothing recorded, stored or sent.

### Seed data (DP-53)

Every seeded person and business is invented. The shop's start, `S`, is the Brussels date on which a copy first starts on its empty database. Dates written `S−n` are fixed at that first start and never move afterwards.

- **Shop:** legal name `Atelier Ourlet SRL`, address `Rue de l'Ourlet 12, 1000 Brussels`, own IBAN `BE68 5390 0754 7034`, mail From `Atelier Ourlet <desk@atelier-ourlet.example>`.
- **Members:**

| Name | Email | Password | Role |
|---|---|---|---|
| Margaux | margaux@atelier-ourlet.example | ourlet-owner-2027 | owner |
| Noor | noor@atelier-ourlet.example | ourlet-noor-2027 | assistant |
| Jules | jules@atelier-ourlet.example | ourlet-jules-2027 | assistant |
| Ines | ines@atelier-ourlet.example | ourlet-ines-2027 | bookkeeper |

- **Consignors:**

| Name | Email | Phone | IBAN on file |
|---|---|---|---|
| Zoë Ørsted-Hæk | zoe.orsted@consignors.example | +32 470 11 22 33 | BE21 0012 3456 7803 (valid) |
| Ségolène D’Hondt (curly apostrophe) | segolene.dhondt@consignors.example | +32 470 12 34 56 | BE35 3101 2345 6737 (valid) |
| Maarten De Smet | maarten.desmet@consignors.example | +32 471 98 76 54 | BE94 7350 0123 4514 (valid) |
| Lotte Janssens | lotte.janssens@consignors.example | +32 472 45 67 89 | BE68 5390 0754 7035 (fails MOD-97) |

- **Ladder:** one, effective from 2024-01-01: first markdown 25% on day 30, second 50% on day 60, period end day 90.
- **Pieces** (none with photos; each shows a generated garment drawing):

| Tag code | Consignor | Category, brand, description | Size | Condition | Asking price | Intake | State at start |
|---|---|---|---|---|---|---|---|
| HG-1000042-0 | Zoë | coats, Maison Arlo, Wool wrap coat, camel | M | very_good | €49.90 | S−35 | on the rail at 25% off, €37.43 |
| HG-1000043-8 | Ségolène | dresses, Linnea, Silk slip dress, ink blue | S | very_good | €19.90 | S−3 | on the rail at full price |
| HG-1000044-6 | Maarten | shoes, Calder & Fils, Leather Chelsea boots | 42 | good | €120.00 | S−65 | on the rail at 50% off, €60.00 |
| HG-1000045-3 | Zoë | bags, Oriel, Leather shoulder bag, cognac | One size | excellent | €312.45 | S−20 | sold |
| HG-1000046-1 | Lotte | knitwear, Fjell, Merino cardigan, oatmeal | M | very_good | €39.00 | S−80 | on the rail at 50% off, €19.50, choice open, none made |
| HG-1000047-9 | Ségolène | jackets, Atelier Nord, Denim trucker jacket | L | good | €45.00 | S−92 | Returns shelf (choice Return to me) |
| HG-1000048-7 | Maarten | trousers, Pell, Pleated wool trousers, grey | M | good | €65.00 | S−95 | Donation box (no choice made) |
| HG-1000049-5 | Zoë | skirts, Linnea, Pleated midi skirt, black | S | excellent | €55.00 | S−50 | sold |
| HG-1000050-3 | Ségolène | shirts, Marlowe, Poplin shirt, white | M | very_good | €29.90 | S−45 | sold |
| HG-1000051-1 | Maarten | accessories, Oriel, Silk scarf, rust print | One size | excellent | €35.00 | S−10 | on the rail at full price |
| HG-1000052-9 | Lotte | coats, Fjell, Boiled wool coat, forest | L | good | €89.00 | S−31 | on the rail at 25% off, €66.75 |
| HG-1000053-7 | Zoë | shoes, Calder & Fils, Suede loafers | 38 | very_good | €75.00 | S−200 | archived (from the Donation box) |

- **Sales:**

| Piece | Sold at (Brussels) | By | Payment | Price | Share | Commission | VAT |
|---|---|---|---|---|---|---|---|
| HG-1000045-3 | S−10, 14:05 | Noor | card | €312.45 | €218.72 | €93.73 | €16.27 |
| HG-1000050-3 | S−12, 11:30 | Noor | cash | €22.43 | €13.46 | €8.97 | €1.56 |
| HG-1000049-5 | S−40, 16:20 | Jules | cash | €55.00 | €33.00 | €22.00 | €3.82 |

- **Nothing else:** no holds, appointments (every slot is free), refunds, payout runs, page addresses, photos or spreadsheet rows.

## Technical requirements

### Deployment (DP-53, DP-54)

- Node.js 22 LTS with npm is available. The app is written in TypeScript.
- `/app/run.json` holds string commands `install`, `build` and `serve`, plus `"_schema":"run-manifest-v1"`, for example:

  ```json
  {"_schema":"run-manifest-v1","install":"npm ci","build":"npm run build","serve":"npm run start"}
  ```

- The server binds `0.0.0.0` on the port in `APP_PUBLIC_PORT`, or on 4173 when that is unset.
- `GET /api/health` answers HTTP 200 JSON `{"status":"ok"}` once the app is serving, whether or not MinIO or Mailpit is reachable.
- Several copies of the app may start at the same moment, each with its own `DATABASE_URL`, `S3_BUCKET` and port. Each copy applies its schema and starting data only to its own database, creates its own bucket when it is missing, keeps nothing on the local disk that another copy could share, and reads, writes and sends only for its own data.
- The grader runs these copies:
  - MinIO down: its own database `${DATABASE_URL}_storage` and bucket `${S3_BUCKET}-storage`;
  - Mailpit down: `${DATABASE_URL}_mail` and `${S3_BUCKET}-mail`;
  - short timers: `${DATABASE_URL}_short` and `${S3_BUCKET}-short`, with HOLD_SECONDS 20, PORTAL_PAGE_SECONDS 20, APPOINTMENT_RATE_WINDOW_SECONDS 30 and BOOK_FILE_RATE_WINDOW_SECONDS 30;
  - short session: `${DATABASE_URL}_session` and `${S3_BUCKET}-session`, with SESSION_SECONDS 20 only;
  - spare: `${DATABASE_URL}_spare` and `${S3_BUCKET}-spare`, with no other change.

### Configuration and secrets (DP-53)

Read at start, never hard-coded and never sent to the browser:
- Postgres: `DATABASE_URL`.
- MinIO: `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_FORCE_PATH_STYLE`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`.
- Mailpit: `SMTP_HOST`, `SMTP_PORT`, `MAILPIT_URL`, `MAIL_FROM`.
- `APP_PUBLIC_PORT` and `APP_PUBLIC_URL`.
- Timers, in seconds, with their defaults: `SESSION_SECONDS` 43200, `HOLD_SECONDS` 7200, `PORTAL_PAGE_SECONDS` 1209600, `APPOINTMENT_RATE_WINDOW_SECONDS` 3600, `BOOK_FILE_RATE_WINDOW_SECONDS` 3600.

### Server boundary (DP-10, DP-54)

- Same origin only: the server sends no cross-origin headers, and the browser loads every script, style, font and image from the app itself.
- The body limits and the error order in API apply to every path, and an oversized body is answered as JSON before it is parsed or the caller is authenticated.
- The server never serves source files, the run manifest, environment files, credentials or stored originals outside their published endpoints.
- Unknown `/api/` paths answer 404 JSON, and other unknown paths show the not-found screen with status 404.
- When Postgres is unreachable at boot the server retries for up to 60 seconds before giving up. When MinIO or Mailpit is unreachable at boot it starts and serves anyway, refusing only the actions that need them.

### Browser support and performance (DP-57)

The current Chromium at 375x812, 768x1024, 1024x768 and 1280x800, by mouse, keyboard and touch. Every screen is usable within three seconds of opening with the seed data. API answers come within one second, and rail search results appear within one second after the typing pause.

## Working rules

- IF-01: `/app/run.json` exists with string `install`, `build` and `serve` commands and `"_schema":"run-manifest-v1"`.
- IF-02: `/app/THIRD_PARTY_NOTICES.md` lists every shipped package with its licence. Shipped packages are the production dependency tree, as given by `npm ls --omit=dev --all --json`.
- IF-03: Every shipped package's licence is permissive (MIT, ISC, BSD-2-Clause, BSD-3-Clause, Apache-2.0, 0BSD, or SIL OFL 1.1 for fonts).
- IF-04: Familjen Grotesk and Hanken Grotesk are shipped inside `/app` with their SIL OFL notice, no Inter font file or reference is shipped, and icons come only from Lucide.
- IF-05: No credential value (database password, storage keys, member passwords other than the published seed passwords) appears in any file under `/app` outside the published seed data.
- IF-06: The app uses no datastore other than Postgres, MinIO and Mailpit: no SQLite, Redis, embedded database or data files written to disk.
- IF-07: Application source is TypeScript.

## Engineering standards

- The code is idiomatic, strictly typed TypeScript, and names match this brief's domain terms (piece, consignor, tag code, ladder, station, hold, sale, payout run, consignor page).
- Each domain rule is decided in exactly one place in the source: the markdown price, the station states, the share, commission and VAT split, the refund window, the SEPA name rule, the MOD-97 check, the Luhn check and the Brussels day boundary.
- Money is integer cents everywhere, and no floating-point arithmetic touches an amount.
- Every API error is built through one consistent error shape, and the error order is applied in one place.
- There is no abstraction with a single implementation, and no dead, commented-out or unreachable code.
- There are no defensive checks for impossible states.
- There are no features, screens or endpoints beyond this brief.
