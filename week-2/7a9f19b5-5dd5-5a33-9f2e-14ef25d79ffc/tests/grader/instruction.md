# Southerly Light Works Lightfall

Lightfall is Southerly Light Works' own platform for specifying and ordering its architectural luminaires in New Zealand. Architects, lighting designers and electricians use it to pick the exact variant of a fitting (finish, beam angle and colour temperature), test how its light falls in a 3D room, and send a quote at the right price tier. Approved trade buyers order on monthly account or by card, retail customers buy by card, and Southerly staff approve trade accounts, dispatch and refund orders, and look after clearance stock. Lightfall uses five backend services and no others. Postgres is the system of record. Kill Bill handles card authorisation, capture, refunds and trade invoices. Mailpit receives every outgoing email. MinIO stores covers, spec sheets and quote PDFs. PocketBase carries live collaboration. Out of scope: single sign-on, any other datastore or cache, shipping-rate calculation, real card processing (Lightfall uses the published test cards), multiple currencies (everything is New Zealand dollars), and any product, page or feature this brief does not describe.

## Problem and users

In New Zealand, a lighting designer can spend weeks choosing a downlight down to its brass finish, its 24° optic and its 2700K colour. Then the job goes to an electrician or a wholesaler, and the fitting is often swapped for a cheaper "approved equal". The swap throws a different pool of light in a different colour, and nobody notices until the ceiling is lit. The maker loses a sale it had already won, and the designer spends hours defending the original choice. Today a lighting catalogue is a brochure with PDFs. Designers copy codes into spreadsheets and guess how wide a beam spreads at a 2.7 m ceiling. Quotes are emailed by hand and often carry the wrong price tier: trade prices go to a homeowner, or GST-inclusive prices go to a trade buyer who works without GST. Trade applicants wait days for approval and then phone in orders on account. Staff re-key quotes and clean up card charges after payment gateway problems.

- **Retail customer** (occasional): browses the 3D catalogue, compares up to four fittings, saves favourites and buys by card. Prices are shown without GST, and GST is added at checkout.
- **Trade buyer** (weekly): an electrician, architect, lighting designer or wholesaler. After admin approval they see trade prices, build projects with quantities and room placements, share quotes with clients and collaborators, and order on monthly account or by card. Until approval they shop as a retail customer.
- **Admin** (daily): Southerly staff. They approve or decline trade applications, manage clearance stock, dispatch orders (which captures card payments and invoices account orders), issue partial or full refunds, record trade payments and watch service health.

## Journeys

1. **Retail browse and buy.** A signed-in retail customer starts on the catalogue. They search for "downlight" and see two cards: Kauri Downlight and Rimu Gimbal Downlight. They clear the search and filter to Matte Black, which leaves three cards: Kauri Downlight, Tōtara Track Spot and Harbour Surface Cylinder. They add all three to the comparison tray from the cards. This puts each product's default variant in the tray (KDL-WH-36-3000, TTS-BK-24-3000 and HSC-WH-24-3000). They then open the comparison. They save one fitting to favourites, open its product page and change the beam angle. They add two units to the cart. At checkout, the decline test card shows the published decline message. They pay again with the approval test card and land on the confirmed order page, and a receipt email arrives with the GST line.
2. **Clearance last units.** A retail customer opens a clearance fitting showing "Only 1 left" and pays for it. At the same moment another customer pays for the same unit; that customer sees the sold-out message and is not charged. Afterwards the fitting's card in the clearance catalogue, the product page and the admin stock table all show the fitting as sold out.
3. **Trade approval.** A wholesaler signs up as a trade applicant with their NZBN. They see the pending banner and retail prices only. An admin opens Applications and approves them, and the applicant receives the approval email. Once they sign in again, product pages show trade prices and the Projects link appears.
4. **Specify a project in the light-pool room.** An approved trade buyer opens a product page, picks finish, beam and colour temperature, and adds six units to a new project. They open the project and set the ceiling to 3.0 m. They place fittings onto the room's ceiling, watch each cone and floor pool appear, nudge fittings with the arrow keys, remove one, and read the light-pools table. The project reopens with every placement where they left it.
5. **Collaborate live.** The project owner invites a collaborating lighting designer. While both have the project open, each sees the other's avatar under "Viewing now". The designer moves a fitting, the owner's room and table follow within seconds, and a comment from either appears for both without a reload.
6. **Share a quote.** The owner shares the project quote with two client addresses at "No prices" and with a wholesaler at "Trade prices". The shares table shows each share as preparing, then Ready. Each recipient gets their own email with the PDF attached. The no-prices email and PDF contain no amounts at all.
7. **Monthly account order.** An approved trade buyer chooses Monthly account at checkout and adds a purchase order number. The order is placed at trade prices and a confirmation email arrives. An admin dispatches it, and a Kill Bill invoice with one GST line is raised. The buyer's order shows the due date. After the due date passes it shows Overdue, until the admin records the payment and it shows Paid.
8. **Admin day.** An admin checks Health, sees every service Up and dispatches an authorised card order. The order shows Paid once Kill Bill confirms the capture. The admin then refunds part of the order, then the rest, and sees the order go to Partly refunded and then Refunded. A refund larger than what remains is refused.

## Mandatory requirements

This is the complete list of mandatory requirements; every check traces to one of these lines and the detailed sections below.

- **DP-01 — Catalogue and search** Show the seeded catalogue as product cards that search and the finish, beam, colour temperature and clearance filters narrow in place, backed by the catalogue endpoint in API.
- **DP-02 — Price fields by role** Catalogue, product, search and comparison responses carry exactly the field list API publishes for the caller, so signed-out visitors, retail customers and trade buyers not yet approved never receive a trade price.
- **DP-03 — Compare up to four** A shopper adds up to four fittings to the comparison tray and opens a side-by-side comparison, and a fifth is refused both in the tray and by the API.
- **DP-04 — Favourites list** A signed-in shopper saves and removes fittings in their favourites list, which persists across sessions and devices.
- **DP-05 — Closed panels stay unavailable** When the catalogue menu, the filter sheet or the comparison tray is closed, nothing inside it is visible, focusable or in the accessibility tree at any published viewport.
- **DP-06 — Retail browsing journey** A signed-in retail customer searches, filters, compares three fittings, saves one and opens its product page, as Journey 1 describes.
- **DP-07 — Cart and GST totals** The cart shows line totals without GST, a subtotal, one 15% GST line and a total computed by the GST rule in Business rules, at the caller's price tier.
- **DP-08 — Card authorisation in Kill Bill** Paying by card authorises the order total in Kill Bill on the buyer's own Kill Bill account under the order key, and the order shows Authorised only after Kill Bill confirms.
- **DP-09 — One charge per checkout** Double-clicking Pay, replaying a pay request or retrying after a timeout never creates a second Kill Bill authorisation, and a reused request key with a different body is refused, as Business rules defines.
- **DP-10 — Declined and unavailable payments** A declined card or an unreachable Kill Bill leaves the order in a recoverable state and shows the exact published heading and body, and the buyer can pay again from the same checkout.
- **DP-11 — Order confirmation email** Every authorised card order and every order placed on account sends one confirmation email whose lines, GST line and total match the order to the cent.
- **DP-12 — Keyboard-only checkout** A buyer can go from the cart through the card form to the confirmed order using only the keyboard, with a visible focus indicator on every control.
- **DP-13 — Retail card checkout journey** A retail customer adds two fittings, is declined with the decline test card, pays with the approval test card and sees the confirmed order and the receipt email, as Journey 1 describes.
- **DP-14 — Clearance price and stock** Clearance fittings show their clearance price, the regular price struck through and the units left, and the clearance catalogue card, the product page and the admin stock table show the same stock figure.
- **DP-15 — No overselling** When several buyers pay for the last clearance units at once, exactly as many win as there are units left (one when one unit remains), the rest see the sold-out copy with no Kill Bill authorisation made, and stock on hand never goes below zero.
- **DP-16 — Stock movement record** Every change to clearance stock is recorded as a movement with its reason and the order that caused it, and the movements always add up to stock on hand.
- **DP-17 — Accounts and sign-in** Visitors sign up as retail customers or trade applicants and sign in and out with a session cookie.
- **DP-18 — Trade applications** A trade applicant submits a business name, NZBN and occupation, and sees the pending banner and retail prices until an admin decides.
- **DP-19 — Admin-only decisions** Only an admin can approve or decline a trade application, any other caller is refused by the server, and an application that has been decided cannot be decided again.
- **DP-20 — Approval and decline notices** Approving or declining an application sends the applicant one email with the outcome, and a decline email includes the admin's reason.
- **DP-21 — Trade approval journey** A wholesaler applies, waits on retail prices, is approved by an admin, receives the approval email and then sees trade prices and projects, as Journey 3 describes.
- **DP-22 — Live variant picker** Changing finish, beam angle or colour temperature on a product page updates price, lumens, pool diameter and centre lux in place without a reload, re-lights the 3D model and announces the new values in the product live region.
- **DP-23 — Product page layouts** The product page shows canvas and spec panel side by side at 1280x800, the spec panel under the canvas at 768x1024, and one column with a quick-add bar fixed to the bottom of the screen at 375x812.
- **DP-24 — Product 3D viewer** The product viewer shows a model of the selected fitting built from shapes in code. It turns slowly on its own, rotates under mouse or one-finger drag, and stops turning on its own under reduced motion.
- **DP-25 — Spring spec drawers** The Photometrics, Dimensions and Downloads drawers spring open and closed on tap, Enter or Space and land at once under reduced motion, and nothing inside a closed drawer can be reached.
- **DP-26 — Spec-sheet PDF** Each variant's spec sheet is generated once, stored in MinIO and downloadable from its product page, with the storage outage answer from API when MinIO is down.
- **DP-27 — Projects with quantities** An approved trade buyer creates projects with a client, a ceiling height and a room size and adds variant lines with quantities; anyone else is refused.
- **DP-28 — Project cover image** A trade buyer uploads a project cover image, which shows as ready only after MinIO confirms the stored object.
- **DP-29 — Add to project journey** An approved trade buyer picks a variant on a product page, adds it to a new project with a quantity and sets the project's ceiling height, as the first half of Journey 4 describes.
- **DP-30 — Light-pool geometry** Every placement reports the pool diameter and centre lux computed from published candela and ceiling height by the one formula in Business rules, with the same figures from the server and on screen.
- **DP-31 — Room placements** Placements are saved to the project inside the room bounds, and a variant never has more placements than its line quantity.
- **DP-32 — Pool placement sequence** Placing a fitting grows its cone, then expands its floor pool, then tints it by colour temperature, then counts the readout up, in the order and timing given in Motion and effects.
- **DP-33 — Keyboard placement** A trade buyer places, nudges and removes fittings in the room using only the keyboard, with focus always visible and Tab always able to leave the room.
- **DP-34 — Mirrored placement table** A table next to the room lists every placed fitting with code, position, beam, pool diameter and summed centre lux, and changes as soon as the room does.
- **DP-35 — Light-pool room journey** A trade buyer places project fittings in the room, nudges one, removes one, reads the light-pools table and finds the placements saved when the project reopens, as the second half of Journey 4 describes.
- **DP-36 — Project collaborators** A project owner invites other approved trade buyers as collaborators, who can view, place and comment, while any other account gets not-found.
- **DP-37 — Live presence and comments** Collaborators viewing a project see each other's avatars, and new comments appear for everyone without a reload, within the delays in Business rules.
- **DP-38 — Live placement sync** A placement made, moved or removed by one collaborator appears in every other open room within the delay in Business rules.
- **DP-39 — Collaboration outage and recovery** While PocketBase is unreachable, placements still save and comments are refused with the published copy, and live collaboration resumes on its own when PocketBase returns.
- **DP-40 — Quote shares by email** A project owner shares a quote with up to ten recipients at a chosen price display, and each recipient gets one email with the quote PDF attached once the PDF is ready.
- **DP-41 — Price display in shared copies** A share at No prices carries no amount in its email or PDF, and a Retail prices share never shows a trade price.
- **DP-42 — Quote PDF readiness** A share's PDF shows as Ready only after MinIO confirms the stored object, and while storage is unreachable the share waits, sends no email and finishes on its own once storage returns.
- **DP-43 — Quote share journey** A project owner shares a quote at No prices and at Trade prices, watches each share become Ready and each recipient receives the matching email and PDF, as Journey 6 describes.
- **DP-44 — Dispatch captures card payment** When an admin dispatches a card order, the authorised amount is captured in Kill Bill under the order key, at most once per order.
- **DP-45 — Paid only after capture** The admin order table shows a card order as Paid only after Kill Bill confirms the capture, and a failed capture leaves it Authorised with the published copy.
- **DP-46 — Partial refunds** An admin refunds part or all of a captured order through Kill Bill, never more than remains refundable, and the order shows a refund only after Kill Bill has recorded it.
- **DP-47 — Admin-only money actions** The server refuses dispatch, refunds, payment recording, stock changes and service health for every caller who is not an admin.
- **DP-48 — Order on monthly account** An approved trade buyer places their cart on monthly account at trade prices, with an optional purchase order number.
- **DP-49 — GST-itemised trade invoice** Dispatching an account order raises one Kill Bill invoice with one item per line without GST and one GST item, and the invoice total equals the order total to the cent.
- **DP-50 — Due date and overdue** An account invoice is due on the 20th of the month after its invoice date and shows Overdue from the 21st, using the New Zealand date the server works from.
- **DP-51 — Recording trade payments** An admin records full payment of an invoiced or overdue account order as a Kill Bill payment, after which the order shows Paid.
- **DP-52 — Kill Bill recovery without restart** Once Kill Bill is reachable again, the next payment, dispatch, invoice or refund goes through without restarting the app.
- **DP-53 — Newsletter with consent** Anyone can subscribe to the newsletter with an email, an occupation and explicit consent, and is subscribed only after following the emailed confirmation link.
- **DP-54 — Run manifest and health** The app installs, builds and serves from the run manifest and answers the health check on the published port.
- **DP-55 — Degraded boot and service health** The app starts and serves every feature that does not need a missing service when Kill Bill, MinIO or PocketBase is unreachable at boot, and the admin health panel shows each service as Up or Down.
- **DP-56 — Server boundary** The server accepts state-changing requests only from its own origin, enforces the published body limits and never serves source files or credentials.
- **DP-57 — Lighting dial** A lighting dial fixed to the screen switches the whole site between Auto and five lighting states, Auto follows the viewer's local hour, and a signed-in user's manual choice persists.
- **DP-58 — Responsive and reduced motion** Every screen fits 375x812, 768x1024 and 1280x800 without horizontal scrolling, every motion lands in its final state at once under reduced motion, and both 3D views fall back to still drawings without WebGL.
- **DP-59 — Nocturnal architectural look** Every screen follows the visual design: a near-black ground at Night, thin hairline rules framing each section, a lamp-amber accent as the only saturated colour, serif display headings and monospaced spec numerals.
- **DP-60 — Configuration from the environment** Every service URL and credential is read from the environment at start and is never hard-coded in source or sent to the browser.

## Frontend

### Screens and layout (DP-01, DP-03, DP-05, DP-14, DP-23, DP-27, DP-34, DP-37, DP-58)

All screens share a 12-column grid ruled with hairlines. They fit 375x812, 768x1024 and 1280x800 with no horizontal scrolling of the page.

- **Header** (every page). The wordmark "Lightfall", main navigation, cart link with item count and account links.
  - At 1280 and 768, a "Catalogue" button opens a mega-menu panel under the header, with links to each family.
  - At 375, a "Menu" button opens a full-height menu dialog holding the same links.
- **Home** (`/`). A full-bleed 3D scene of the featured fitting (Kauri Downlight) behind a small overlay title, one line of introduction, and links to the catalogue and to the trade application. At 375 the overlay text sits below the scene.
- **Catalogue** (`/catalogue`, with an optional `?family=` of `downlights`, `track-spots`, `pendants`, `surface` or `clearance`). A search field, filters and a results count above a grid of product cards. Each card shows the name, a still thumbnail of the 3D model, and the price line and stock badge of the card's shown variant.
  - The shown variant is the product's default variant. The exception is under `?family=clearance` or with "Clearance only" ticked, where the shown variant is the product's clearance variant.
  - For example, with the seed data at start, Harbour Surface Cylinder's card in the main catalogue shows the regular price of HSC-WH-24-3000 with no badge. Under `?family=clearance`, the same card shows HSC-CH-24-3000's clearance price, its struck-through regular price and its stock badge.
  - Rimu Gimbal Downlight's default variant is its clearance variant, so its card shows the clearance price and badge everywhere.
  - 1280: filters fill a 3-column rail on the left and cards run three across in the remaining 9 columns.
  - 768: cards run two across, and a "Filters" button opens a bottom sheet.
  - 375: cards run one across, with the same "Filters" sheet.
- **Comparison tray** (catalogue and product pages). A bar along the bottom with a toggle that shows the count. Open, it lists the chosen fittings and a link to the comparison. Closed, only the toggle shows.
- **Comparison** (`/compare`). A table with one column per fitting (up to four) and one row per spec: product, code, finish, beam, colour temperature, lumens, candela, watts, CRI, IP rating, price, and pool diameter and centre lux at 2.7 m. At 375 the columns narrow and the text wraps; the table never scrolls sideways.
- **Product page** (`/products/<slug>`, with an optional `?variant=<code>`). The 3D viewer canvas and a spec panel. The spec panel holds the name, family, the finish, beam and colour temperature pickers, the light readout (price, lumens, pool diameter and centre lux at 2.7 m), quantity, add buttons, and the three spec drawers.
  - 1280: canvas in the left 7 columns and spec panel in the right 5, side by side, both starting above the fold.
  - 768: canvas full width, spec panel directly below it.
  - 375: one column (canvas, then spec panel), plus a quick-add bar fixed to the bottom of the screen. The bar holds the price and the single add button for the caller's role ("Add to project" for approved trade buyers, "Add to cart" for everyone else); at this width the inline add button is not shown.
- **Favourites** (`/favourites`). Saved fittings as cards in the catalogue's arrangement.
- **Cart** (`/cart`) and **Checkout** (`/checkout`).
  - 1280: form in the left 7 columns and order summary in the right 5.
  - 768 and 375: summary first, then the form, in one column.
  - The summary shows lines, subtotal without GST, the GST line and the total.
- **Order** (`/orders/<orderKey>`). Status, lines, totals and, for account orders, the invoice number and due date.
- **Sign in** (`/signin`) and **Sign up** (`/signup`). Single-column forms 5 columns wide at 1280, full width below.
- **Projects** (`/projects`). The trade buyer's own projects and the projects they collaborate on, as cards with cover image, client and line count.
- **Project** (`/projects/<id>`). The light-pool room, the light-pools table, project lines, unplaced fittings, collaborators, the "Viewing now" avatars, comments, cover image and quote shares.
  - 1280: room canvas in the left 8 columns with the light-pools table under it; the side panel in the right 4 columns, holding (top to bottom) Viewing now, lines and unplaced fittings, comments, shares.
  - 768: room full width, then table, then side panel sections.
  - 375: room full width at about 60% of the screen height, then unplaced fittings, table, lines, comments and shares in one column.
- **Admin** (`/admin`). Tabs for Applications, Orders, Stock and Health, each a table. At 375 table cells wrap and action buttons stack under each row's text.
- **Newsletter confirmation** (`/newsletter/confirm?token=<token>`). One heading and one sentence.
- **Footer** (every page). The newsletter form and the line "Southerly Light Works · Ōtautahi Christchurch".
- **Lighting dial** (every page). Fixed to the bottom-left corner above the comparison tray, never covering the quick-add bar's button.

### Public screens and controls (DP-01, DP-03, DP-04, DP-05, DP-10, DP-12, DP-22, DP-23, DP-25, DP-33, DP-34, DP-37, DP-40, DP-45, DP-53, DP-57)

Only these roles and names are public; everything else is the builder's choice. `<...>` placeholders are filled from the record shown.

| Where | Role and accessible name | Visible copy / notes |
|---|---|---|
| Header | `navigation "Main"` | Holds the links below |
| Header (768, 1280) | `button "Catalogue"` | Shows whether the mega-menu is open; controls `region "Catalogue menu"` |
| Mega-menu | `link "Downlights"`, `link "Track spots"`, `link "Pendants"`, `link "Surface mounted"`, `link "Clearance"` | Inside `region "Catalogue menu"` |
| Header (375) | `button "Menu"` opens `dialog "Menu"` | Same five links, plus account links |
| Header | `link "Cart"` | Item count shown next to it |
| Header | `link "Projects"` (approved trade only), `link "Admin"` (admin only), `link "Sign in"` or `button "Sign out"` | |
| Every page | `radiogroup "Lighting"` with `radio "Auto"`, `radio "Morning"`, `radio "Day"`, `radio "Evening"`, `radio "Night"`, `radio "Gallery"` | Lighting dial |
| Every page | The root `html` element carries `data-light` (resolved state: `morning`, `day`, `evening`, `night` or `gallery`) and `data-light-mode` (`auto` or the manual choice in lowercase) | |
| Catalogue | `searchbox "Search fittings"` | |
| Catalogue | `status "Results count"` | Copy in Feedback states |
| Catalogue (1280) | `region "Filters"` | Inline filters |
| Catalogue (768, 375) | `button "Filters"` opens `dialog "Filters"` | Holds the filter groups and `button "Show results"` |
| Filters | `group "Finish"` with one `checkbox` per finish name; `group "Beam"` with `checkbox "15°"`, `"24°"`, `"36°"`, `"60°"`; `group "Colour temperature"` with `checkbox "2700K"`, `"3000K"`, `"4000K"`; `checkbox "Clearance only"` | |
| Product card | `article "<product name>"` holding `link "<product name>"`, `button "Compare <product name>"` (pressed when in tray), `button "Save <product name>"` (pressed when saved) | Price line and stock badge |
| Comparison tray | `button "Compare (<n>)"` controls `region "Compare tray"` | `<n>` is the number of fittings in the tray |
| Compare tray | `link "Open comparison"`, `button "Remove <product name> from comparison"` | |
| Comparison | `table "Comparison"` | |
| Product page | `heading` level 1 `"<product name>"` | |
| Product page | `img "<product name> 3D model"` | The viewer canvas, carrying `data-yaw` (whole degrees 0–359), `data-beam` (degrees), `data-cct` (kelvin), `data-idle` (`on` or `off`) |
| Product page | `region "Specification"` | Spec panel |
| Product page | `radiogroup "Finish"` (one `radio` per finish name), `radiogroup "Beam angle"` (`radio "<beam>°"`), `radiogroup "Colour temperature"` (`radio "<cct>K"`) | |
| Product page | `region "Light readout"` holding labelled values `Price`, `Lumens`, `Pool at 2.7 m`, `Centre at 2.7 m` | Numerals in the monospaced face |
| Product page | `status "Product updates"` | Polite; copy in Feedback states |
| Product page | `spinbutton "Quantity"`, `button "Add to cart"` or `button "Add to project"`, `button "Compare"`, `button "Save to favourites"` | |
| Product page (375) | `region "Quick add"` | Bar fixed to the bottom of the screen; holds the single add button |
| Add to project | `dialog "Add to project"` with `combobox "Project"`, `spinbutton "Quantity"`, `button "Add"` | |
| Drawers | `button "Photometrics"`, `button "Dimensions"`, `button "Downloads"` | Each shows whether it is open; Downloads holds `link "Spec sheet (PDF)"` |
| Cart | `table "Cart"`, `spinbutton "Quantity for <code>"`, `button "Remove <code>"`, `link "Checkout"` | Totals labelled as in Business rules |
| Checkout | `form "Checkout"` with `textbox "Full name"`, `"Address"`, `"City"`, `"Postcode"`, `"Card number"`, `"Expiry (MM/YY)"`, `"Security code"`, `"Name on card"` | |
| Checkout | `button "Pay $<total>"` | `<total>` is the order total including GST |
| Checkout (approved trade) | `radiogroup "Payment method"` with `radio "Card"` and `radio "Monthly account"`; `textbox "Purchase order (optional)"`; `button "Place order on account"` | Card fields shown only when Card is chosen |
| Checkout | `alert` holding a level-2 heading and one paragraph | Payment problem copy from Feedback states |
| Checkout | `status "Checkout status"` | |
| Order page | `heading` level 1 | Copy in Feedback states |
| Sign up | `textbox "Name"`, `"Email"`, `"Password"`, `radiogroup "Account type"` (`radio "Retail customer"`, `radio "Trade"`), `textbox "Business name"`, `textbox "NZBN"`, `combobox "Occupation"`, `button "Create account"` | Trade fields shown only for Trade. Occupation option labels and the API value each sends: `Electrician` → `electrician`, `Architect` → `architect`, `Lighting designer` → `lighting_designer`, `Wholesaler` → `wholesaler` |
| Sign in | `textbox "Email"`, `"Password"`, `button "Sign in"`, `alert` for errors | |
| Account | `status "Trade application"` | Pending banner |
| Projects | `button "New project"` opens `dialog "New project"` with `textbox "Project name"`, `textbox "Client"`, `spinbutton "Ceiling height (mm)"`, `button "Create project"` | |
| Project | `heading` level 1 `"<project name>"`, `table "Project lines"`, `spinbutton "Quantity for <code>"` | |
| Project | `button "Upload cover"` with file input `"Cover image"`, `img "Project cover"` | |
| Project | `status "Project updates"` | |
| Room | `region "Light-pool room"` | Carries `data-phase` (`cone`, `pool`, `tint`, `count`, `settled`) |
| Room | `img "Room 3D view"` | The canvas, never focusable |
| Room | `slider "Ceiling height"` | 2400 to 4000 in steps of 100; value text `<metres> m` with one decimal place |
| Room | `list "Unplaced fittings"` with `button "Place <code>"` | One button per unplaced unit |
| Room | `button "<code> #<n> at <x> mm, <y> mm"` | One per placed fitting, drawn over its position on the canvas. `<n>` is the placement's `ordinal` from Business rules, so a removal leaves a gap that is never refilled |
| Room | `table "Light pools"` with columns `Code`, `X (mm)`, `Y (mm)`, `Beam`, `Pool diameter (mm)`, `Centre lux` | |
| Room | `status "Room updates"` | |
| Project | `list "Viewing now"` holding `img "<user name>"` avatars | Initials in a circle |
| Project | `textbox "Collaborator email"`, `button "Invite"` (owner only) | |
| Project | `region "Comments"` holding `list "Comment thread"`, `textbox "Add a comment"`, `button "Post comment"` | |
| Project | `status "Live collaboration"` | |
| Project | `button "Share quote"` (owner only) opens `dialog "Share quote"` with `textbox "Recipients"` (comma-separated), `radiogroup "Price display"` (`radio "Trade prices"`, `radio "Retail prices"`, `radio "No prices"`), `textbox "Message"`, `button "Send quote"` | |
| Project | `table "Quote shares"` | Status column labels in Feedback states |
| Admin | `tablist` with `tab "Applications"`, `tab "Orders"`, `tab "Stock"`, `tab "Health"` | |
| Admin | `table "Trade applications"`, `button "Approve <business name>"`, `button "Decline <business name>"` | Decline opens `dialog "Decline application"` with `textbox "Reason"` and `button "Decline"` |
| Admin | `table "Orders"` with a `Status` column | Display status labels from Business rules |
| Admin | `button "Dispatch <orderKey>"`, `button "Refund <orderKey>"`, `button "Record payment <orderKey>"` | Refund opens `dialog "Refund"` with `textbox "Amount (NZD)"`, `textbox "Reason"`, `button "Issue refund"`. Record payment opens `dialog "Record payment"` with an empty `textbox "Amount received (NZD)"` and `button "Record"`. Both amount fields take dollars with up to two decimals and no dollar sign, for example `277.73` |
| Admin | `table "Clearance stock"` with columns `Code`, `Product`, `Clearance price`, `On hand`; `button "Adjust stock <code>"` opens `dialog "Adjust stock"` with `spinbutton "Change"`, `textbox "Note"`, `button "Save"` | |
| Admin | `table "Service health"` with rows `Postgres`, `Kill Bill`, `Mailpit`, `MinIO`, `PocketBase` | Cells read `Up` or `Down` |
| Admin | `status "Admin updates"` | |
| Footer | `region "Newsletter"` with `textbox "Email"`, `combobox "Occupation"` (options `Architect`, `Trade`, `Wholesaler`, `Other`), `checkbox "Send me the Lightfall newsletter"`, `button "Subscribe"`, `status "Newsletter status"` | |
| Newsletter confirmation | `heading` level 1 | Copy in Feedback states |

### Interactions (DP-01, DP-03, DP-05, DP-12, DP-22, DP-24, DP-25, DP-33, DP-34, DP-57)

- **Search and filters.** Typing in the search box filters the cards in place, without a submit button, a quarter of a second after the last keystroke. Ticking a filter does the same immediately. The URL query updates without a reload. At 768 and 375, the filter sheet applies each tick as it is made; "Show results" and Escape close it.
- **Menus, sheets and dialogs.** Every dialog (Menu, Filters, Add to project, New project, Share quote, Decline application, Refund, Record payment, Adjust stock) behaves the same way:
  - Opening it moves focus to its first control.
  - Tab from the last control wraps to the first, and Shift+Tab from the first wraps to the last.
  - Escape closes it, and closing returns focus to the control that opened it.
  - While it is open, the page behind cannot be focused or clicked.

  The mega-menu opens on click, Enter or Space. Escape or a click outside closes it and returns focus to "Catalogue". Down Arrow on "Catalogue" opens the menu and focuses its first link.
- **Closed panels.** When the mega-menu, the Menu dialog, the filter sheet, the comparison tray or a drawer is closed, its contents are hidden and removed from the tab order and the accessibility tree at every viewport. Sliding a panel off-screen does not count as closing it.
- **Comparison tray.** "Compare <product name>" on a card adds the card's shown variant (Screens and layout). "Compare" on a product page adds the selected variant. When the tray already holds four, the fifth press does nothing to the tray and the tray status shows the full-tray copy. The tray contents are kept in the browser across pages.
- **Variant picker.** Choosing a finish, beam or colour temperature radio (by click, tap, or arrow keys within the group) selects the matching variant at once. The URL's `?variant=` changes without a reload, the light readout numbers move to their new values in place, the 3D model's finish, cone width and light colour change, and `status "Product updates"` announces the result. A combination that does not exist for the product cannot be chosen: those radios are disabled.
- **3D viewer.**
  - Dragging with the mouse or one finger turns the model around its vertical axis: dragging across the full canvas width turns it half a turn. Dragging pauses idle turning, which resumes three seconds after release. Dragging works the same under reduced motion.
  - On touch screens a vertical swipe that starts on the canvas still scrolls the page; only a mostly sideways drag turns the model.
- **Spec drawers.** The button toggles its drawer on click, tap, Enter or Space. Photometrics is open by default; the other two start closed.
- **Add to cart / project.** "Add to cart" adds the chosen quantity of the selected variant without leaving the page. "Add to project" opens the dialog; "Add" adds the quantity to the chosen project and closes the dialog.
- **Checkout.** "Pay $<total>" is disabled from the first press until the reply arrives, so a double-click sends one request. The same checkout keeps one request key for all repeats of the same submission. Changing any card or delivery field starts a new key for the next submission. Tab order runs: payment method (trade only), then the delivery fields, card fields and the pay button, in that order.
- **Light-pool room.**
  - "Place <code>" puts that fitting at the centre of the room, with each coordinate rounded to the nearest 100 mm and halves rounded up. For example, with the seed data at start, Ponsonby Kitchen's fittings are placed at 3000 mm, 2300 mm. Focus moves to the new fitting's button, and the pool placement sequence plays.
  - With a fitting's button focused: arrow keys move it 100 mm (Right adds to x, Left subtracts from x, Down adds to y, Up subtracts from y), Shift+arrow moves it 500 mm, and Delete or Backspace removes it, returning focus to the matching "Place <code>" button.
  - Movement stops at the room edges. The plan's origin is the back-left corner seen from above, with x running to the right and y running towards the viewer.
  - Every move saves and updates the table and `status "Room updates"`.
  - Mouse or one-finger drag of a fitting on the canvas moves it in 100 mm steps and saves on release.
  - Tab moves through the fitting buttons in table order and then out of the room. The canvas itself never takes focus. Escape on a fitting button moves focus to the "Ceiling height" slider.
  - Moving the slider resizes every pool and re-counts the readouts.
  - The lighting dial changes the room's ambient brightness only; it never changes the pool sizes, tints or numbers.
- **Comments.** Enter in "Add a comment" inserts a new line; "Post comment" posts. A posted comment appears at the bottom of the thread for everyone viewing.
- **Lighting dial.** Choosing a radio (click, tap, or arrow keys within the group) recolours the site at once. Auto works out the state from the viewer's local hour using the bands in Business rules, re-checks every minute, and changes state when the hour crosses a band.
- **Focus.** Every focusable control shows a clearly visible amber focus ring that contrasts with every lighting state. No control is reachable only by pointer.

### Visual design (DP-57, DP-59)

- **Mood.** Nocturnal and architectural. At Night every page sits on a near-black ground with warm off-white paper-coloured text, as if the catalogue were a gallery lit only by its own fittings.
- **Colour roles.**
  - Ground: near-black with a faint blue cast.
  - Paper: warm off-white, used for text at Night and for the ground in Day and Gallery.
  - Warm accent: the amber of a 2700K lamp, used for actions, focus rings, selected states and the 2700K tint. It is the only saturated colour.
  - Cool tint: a pale moonlit blue, used only for 4000K pools and the 4000K swatch.
  - Muted: a cool mid-grey for secondary text and the hairline rules.
- **Lighting states.** The six dial states recolour ground and paper:
  - Night: near-black ground, paper text.
  - Evening: deep warm charcoal ground, paper text.
  - Morning: pale paper ground with a slight cool cast, near-black text.
  - Day: full paper ground, near-black text.
  - Gallery: flat paper ground and near-black text, with the 3D ambience neutral, meant for reading and printing specs.
  - Auto: shows whichever of Morning, Day, Evening or Night the hour gives.

  Every state meets WCAG 2.2 AA contrast for text and controls.
- **Type.**
  - Headings use Instrument Serif, a tall, elegant high-contrast serif.
  - Body text uses Inter Tight, a compact neutral grotesk.
  - Spec numerals (prices, lumens, millimetres, lux, codes) use JetBrains Mono so columns line up.
  - Each heading level is about one third larger than the level below. Overlay type on the 3D scenes stays small and restrained.
  - All three faces are self-hosted.
- **Composition and density.** Airy. A full-bleed 3D canvas sits behind a 12-column overlay grid. One-pixel hairline rules frame every section and table, with generous space between sections and no drop shadows or gradients on panels. Icons come from one consistent line icon set.
- **Touch targets.** Every control is at least 44 by 44 pixels at 375 and 768.

### Motion and effects (DP-22, DP-24, DP-25, DP-32, DP-58)

- **Meaning.** Motion only ever means something:
  - Light arriving: the cone and pool.
  - A value changing: numeral counts.
  - A panel entering or leaving: drawers, sheets, dialogs and the mega-menu.
  - Press feedback: buttons dim slightly while pressed, for under a tenth of a second.

  There are no decorative loops apart from the viewer's idle turn named below.
- **Panels.** Sheets, dialogs and the mega-menu fade and rise into place in about a third of a second and leave in about a quarter of a second. Spec drawers spring open in about a third of a second, overshooting very slightly once before they settle, and close in about a quarter of a second.
- **Numeral counts.** Readouts count from their previous value to the new one in about 0.4 seconds, fast at first and slowing into the final figure. The final values are in place within half a second of the change.
- **3D viewer.**
  - Shows the selected fitting built in code from turned and extruded shapes: a recessed downlight, a track spot on its adaptor, a pendant on its cord, a surface cylinder or a gimbal downlight. It is finished in the selected finish, with a light cone below it whose width matches the beam and whose colour matches the colour temperature.
  - When idle it turns once every 30 to 40 seconds and keeps `data-idle` at `on`.
  - When the variant changes, `data-beam` and `data-cct` change within the same frame and the cone re-lights over about a third of a second.
- **Signature: the light-pool room.**
  - A 3D room with a ceiling grid. Placing a fitting plays four steps in order, which `region "Light-pool room"` reports through `data-phase`:
    1. `cone`: a cone of light grows down from the ceiling in about a third of a second.
    2. `pool`: the floor pool expands from nothing to its computed diameter in about 0.4 seconds, springing very slightly past and back.
    3. `tint`: the pool's tint fades in during the last part of the pool step, about a third of a second (warm amber for 2700K, soft warm white for 3000K, pale cool blue-white for 4000K).
    4. `count`: the fitting's readout next to its button counts up from 0 to the pool diameter in mm and the centre lux, in about 0.4 seconds.

    Then `settled`. The whole sequence takes no more than 1.5 seconds.
  - Changing beam or ceiling height resizes the pool to its new size in about 0.4 seconds and re-counts the numbers from the old values.
  - Removing a fitting shrinks its pool and cone back to nothing in about a quarter of a second, the reverse of placement.
- **Reduced motion.** When the viewer asks for reduced motion:
  - the cone and pool appear at full size in one frame, and `data-phase` goes straight to `settled`;
  - numerals show their final values with no counting;
  - the viewer's idle turn stops and `data-idle` is `off`, while dragging still turns the model;
  - drawers, sheets, dialogs and menus appear and disappear at once.

  The light-pools table, the keyboard placement and every function work exactly the same.
- **Without WebGL.** If WebGL is unavailable:
  - the product viewer shows a still side-view line drawing as `img "<product name> drawing"` in place of the 3D model;
  - the room shows a top-down plan as `img "Room plan"`, with each pool drawn as a tinted circle at its size and position;
  - the fitting buttons, the table and the keyboard placement still work.

### Feedback states (DP-01, DP-03, DP-04, DP-10, DP-14, DP-15, DP-22, DP-28, DP-37, DP-39, DP-40, DP-42, DP-45, DP-46, DP-53)

Every async action shows its state on screen and announces it in the named live region. The table below is the only source of copy. Placeholders:

- `<price>`, `<total>`, `<subtotal>`, `<amount>` and `<refundable>` are money in the format from Business rules, without the dollar sign (the copy supplies it).
- `<price>`, both in the variant-change announcement and in the light readout's Price, is the caller's tier price. That is the trade price for approved trade buyers and admins, and the retail price for everyone else.
- `<lumens>`, `<diameter>` and `<lux>` are whole numbers.
- `<n>` and `<qty>` are counts.
- `<x>` and `<y>` are millimetres.
- Counts, millimetres, lumens, candela and lux that the app fills in from its own data (placeholder values, readouts, table cells, accessible names, announcements, emails and PDFs) are written as plain digits with no thousands separator. For example, `1150 lumens`, `3000 mm` and `1753 lux`.
- Literal published copy in this table renders exactly as printed, character for character, including any thousands separators it already contains (for example the cover upload error and the comment length error keep their commas).

| Action | Region | Pending | Success | Error | Outage |
|---|---|---|---|---|---|
| Search or filter | `status "Results count"` | — | `<n> fittings` (`1 fitting` when one) | — | — |
| Variant change | `status "Product updates"` | — | `<product name>, <finish name>, <beam>° beam, <cct>K: <lumens> lumens, $<price> + GST.` | — | — |
| Add to cart | `status "Product updates"` | button reads `Adding` | `Added <qty> to cart. Cart total $<subtotal> + GST.` | stock conflict: `Only <n> left.` | — |
| Compare | tray `button "Compare (<n>)"` count updates; tray status text | — | `Added to comparison.` | `You can compare up to four fittings.` | — |
| Favourite | `status "Product updates"` on product page; button pressed state on cards | — | `Saved to favourites.` / `Removed from favourites.` | signed out: `Sign in to save favourites.` | — |
| Pay by card | `status "Checkout status"` | button reads `Authorising payment` | navigates to the order page, heading `Order confirmed`, body `Order <orderKey> is confirmed. A receipt is on its way to <email>.` | card declined: alert heading `Card declined`, body `Your bank declined this card. No money has been taken. Try another card or contact your bank.`; field errors next to each field: `Enter a valid card number.`, `Enter an expiry date in the future.`, `Enter the 3-digit security code.`, `This field is required.` | alert heading `Payment service unavailable`, body `We couldn't reach our payment service. Your order is saved and you will only be charged once. Try again in a few minutes.` |
| Sold out at payment | `status "Checkout status"` | — | — | alert heading `Sold out while you were checking out`, body `Someone else bought the last units of <product name>. Your card has not been charged.` | — |
| Place on account | `status "Checkout status"` | button reads `Placing order` | order page heading `Order placed`, body `Order <orderKey> is on your monthly account. A confirmation is on its way to <email>.` | field errors as above | — |
| Sign in | `alert` on the form | button reads `Signing in` | goes to the previous page | `Email or password is incorrect.` | — |
| Sign up | `alert` on the form | button reads `Creating account` | goes to `/account` | `An account with this email already exists.`; `Enter a 13-digit NZBN starting with 94.`; `Use at least 10 characters.` | — |
| Trade pending | `status "Trade application"` | — | `Your trade application is with our team. You'll see trade prices once it's approved.` | declined: `Your trade application was declined. You can still shop at retail prices.` | — |
| Create project / add to project | `status "Project updates"` | button reads `Saving` | `Project created.` / `Added <qty> × <code> to <project name>.` | `Ceiling height must be between 2400 and 4000 mm.` | — |
| Cover upload | `status "Project updates"` | `Uploading cover` | `Cover ready.` | `Choose a JPEG, PNG or WebP image up to 5,000,000 bytes.` | `File storage is unavailable. Your cover was not saved; try again shortly.` |
| Spec sheet | `status "Product updates"` | link reads `Preparing spec sheet` | download starts | — | `Spec sheet unavailable right now. Try again shortly.` |
| Place, move, remove fitting | `status "Room updates"` | — | `<code> placed at <x> mm, <y> mm. Pool <diameter> mm, <lux> lux.` / `<code> moved to <x> mm, <y> mm.` / `<code> removed.` | `All <code> fittings are already placed.` | placements still save; see Live collaboration |
| Live collaboration | `status "Live collaboration"` | — | on reconnect: `Live collaboration is back.` | — | `Live collaboration paused. Your changes are saved and will sync when it reconnects.` |
| Post comment | `status "Project updates"` | button reads `Posting` | `Comment posted.` | `Comments can be up to 2,000 characters.` | `Comments are unavailable while live collaboration is paused.` |
| Invite collaborator | `status "Project updates"` | button reads `Inviting` | `<name> can now work on this project.` | `That email is not an approved trade account.` | — |
| Share quote | `status "Project updates"` | button reads `Sending` | `Quote queued for <n> recipients. Emails go out as soon as the PDF is ready.` | `Add between 1 and 10 valid email addresses.` | the share's status reads `Waiting for file storage` |
| Share status cell | `table "Quote shares"` | `Preparing PDF` | `Ready` | — | `Waiting for file storage` |
| Approve / decline | `status "Admin updates"` | button reads `Saving` | `Approved <business name>.` / `Declined <business name>.` | `This application has already been decided.` | — |
| Dispatch | `status "Admin updates"` | status cell reads `Capturing` (card) or `Invoicing` (account) | `Payment captured. Order <orderKey> is Paid.` / `Invoice <invoice number> raised for <orderKey>.` | `This order can't be dispatched in its current state.` | `Kill Bill is unavailable. Order <orderKey> is unchanged; try again shortly.` |
| Refund | `status "Admin updates"` | button reads `Refunding` | `Refunded $<amount> on <orderKey>.` | field: `More than the $<refundable> still refundable.` | the Kill Bill outage copy above |
| Record payment | `status "Admin updates"` | button reads `Recording` | `Payment recorded. Order <orderKey> is Paid.` | `The amount must equal the invoice total.` | the Kill Bill outage copy above |
| Adjust stock | `status "Admin updates"` | button reads `Saving` | `Stock for <code> is now <n>.` | `Stock can't go below zero.` | — |
| Newsletter | `status "Newsletter status"` | button reads `Subscribing` | `Check your inbox. We've sent a confirmation link to <email>.` | `Tick the box to agree to the newsletter.`; `Enter a valid email address.` | — |
| Newsletter confirm page | heading | — | `You're subscribed` | `That confirmation link isn't valid.` | — |

Stock badges on cards and product pages read `Only <n> left` when a clearance variant has 1 to 5 units and `Sold out` at 0. Price lines read `$<price> + GST`. Approved trade buyers see `Trade $<trade price> + GST` with `RRP $<retail price> + GST` below it. Clearance prices are followed by the regular retail price struck through.

## Backend

### API (DP-01–DP-04, DP-07–DP-10, DP-17–DP-19, DP-26–DP-28, DP-31, DP-36–DP-38, DP-40, DP-42, DP-44, DP-46–DP-48, DP-51, DP-53–DP-55)

General rules:

- All endpoints live under `/api`. JSON bodies use `Content-Type: application/json` and responses are `application/json` unless stated.
- Money is integer cents without GST, unless a field name says otherwise.
- Authentication is the `lf_session` cookie set by sign-up and sign-in.
- Every error uses one shape: `{"error":"<code>"}`, plus `"errors":{"<field>":"<code>"}` when the status is 422. Field codes are `required`, `invalid`, `too_long`, `out_of_range`, or a specific code named in the endpoint row.
- **Error precedence**, applied to the whole API:
  1. Request framing: 413, 415, 400 `invalid_json`, then 403 `cross_origin` (Server boundary).
  2. 401 `unauthenticated`.
  3. `403 {"error":"forbidden"}` for a signed-in caller who is not an admin on any `/api/admin/` path. This check comes before any record is looked up, so admin paths never answer 404 to non-admins.
  4. Idempotent replay or key conflict (Business rules).
  5. 404 for an unknown resource or one the caller may not see.
  6. 403 for the wrong role on all other paths.
  7. 409 state conflicts.
  8. 422 validation.
  9. 503 for an unreachable provider.

**Projection.** A variant object carries exactly these keys for signed-out visitors, retail customers and trade buyers whose application is not approved:

`code`, `finish`, `finish_name`, `beam_deg`, `cct_k`, `lumens`, `candela`, `retail_price_cents`, `was_price_cents` (regular retail price for clearance variants, otherwise `null`), `clearance` (boolean), `stock_on_hand` (integer for clearance variants, otherwise `null`).

Approved trade buyers and admins get exactly those keys plus `trade_price_cents`.

A product object carries exactly `slug`, `name`, `family`, `description`, `watts`, `cri`, `ip_rating`, `default_variant`, `variants`. A comparison item carries exactly `product_slug`, `product_name`, `watts`, `cri`, `ip_rating`, `pool_diameter_mm_at_2700`, `centre_lux_at_2700`, plus the caller's variant keys.

**Users.** A user object is `{id, email, name, role, trade_status, dial_mode}`:

- `role` is `retail`, `trade` or `admin`.
- `trade_status` is `null`, `submitted`, `approved` or `declined`.
- `dial_mode` is `auto`, `morning`, `day`, `evening`, `night` or `gallery`.

**Orders.** An order object is:

`{order_key, status, display_status, payment_method, price_tier, lines:[{variant_code, product_name, quantity, unit_price_cents, line_total_cents}], subtotal_cents, gst_cents, total_cents, captured_cents, refunded_cents, refunds:[{id, amount_cents, reason, kb_transaction_id, created_at}], card_last4, purchase_order, invoice, created_at}`

- `payment_method` is `null`, `card` or `account`.
- `price_tier` is `retail` or `trade`.
- `invoice` is `null` or `{kb_invoice_id, invoice_number, invoice_date, due_date}`, with dates as `YYYY-MM-DD`.

**Projects.** A project object is:

`{id, name, client_name, owner_id, is_owner, ceiling_height_mm, room_width_mm, room_depth_mm, cover, lines:[{variant_code, product_name, quantity, placed}], placements:[placement], collaborators:[{user_id, name, email}], live}`

- `cover` is `null` or `{status:"ready", url}`.
- A placement is `{id, variant_code, ordinal, x_mm, y_mm, beam_deg, cct_k, candela, pool_diameter_mm, own_lux, centre_lux}`.
- `live` is a boolean: whether live collaboration is connected.

**Catalogue query.** `GET /api/catalogue` takes these query parameters:

- `q` matches, case-insensitively and as a substring, the product name, the product description and the variant codes. Leading and trailing spaces are ignored, and an empty `q` means no search.
- `family` takes one family slug.
- `finish` takes finish codes (for example `BK`).
- `beam` takes beam angles in whole degrees (for example `24`).
- `cct` takes colour temperatures in whole kelvin (for example `3000`).
- `finish`, `beam` and `cct` each accept a comma-separated list, and a variant matches the list when it matches any value in it.
- `clearance=true` keeps clearance variants only.

A product is returned when `q` matches it and at least one of its variants matches every given filter at once. Each returned product carries all of its variants, not only the matching ones. Unknown values match nothing. Products come back in the order Seed data lists them.

| Method and path | Who | Request | Success | Endpoint errors |
|---|---|---|---|---|
| `GET /api/health` | anyone | — | `200 {"status":"ok"}` | — |
| `POST /api/auth/signup` | anyone | `{email, password, name, account_type:"retail"\|"trade", trade?:{business_name, nzbn, occupation:"electrician"\|"architect"\|"lighting_designer"\|"wholesaler"}}` | `201 {"user":user}` and sets the cookie | `409 {"error":"email_taken"}`; 422 (`password` of fewer than 10 characters is `too_short`; `nzbn` other than 13 digits starting `94` is `invalid`; `trade` is required when `account_type` is `trade`) |
| `POST /api/auth/signin` | anyone | `{email, password}` | `200 {"user":user}` and sets the cookie | `401 {"error":"invalid_credentials"}` |
| `POST /api/auth/signout` | signed in | — | `204` and clears the cookie | — |
| `GET /api/me` | signed in | — | `200 {"user":user}` | — |
| `PUT /api/me/dial` | signed in | `{mode}` | `200 {"dial_mode":mode}` | 422 |
| `GET /api/catalogue` | anyone | query parameters from Catalogue query | `200 {"products":[product]}` | — |
| `GET /api/products/<slug>` | anyone | — | `200 {"product":product}` | `404 {"error":"not_found"}` |
| `GET /api/compare?codes=<c1>,<c2>,…` | anyone | 1 to 4 variant codes | `200 {"items":[comparison item]}`, in request order | `404 {"error":"unknown_variant"}`; `422` with `codes` `too_many` for 5 or more |
| `GET /api/variants/<code>/spec-sheet` | anyone | — | `200` `application/pdf` | 404; `503 {"error":"storage_unavailable"}` |
| `GET /api/favourites` | signed in | — | `200 {"items":[variant + product_name, product_slug]}` | — |
| `PUT /api/favourites/<code>` | signed in | — | `200 {"saved":true}` (repeat is a no-op) | 404 |
| `DELETE /api/favourites/<code>` | signed in | — | `204` | — |
| `GET /api/cart` | signed in | — | `200 {"order":order}` (the caller's open order) | — |
| `POST /api/cart/lines` | signed in | `{variant_code, quantity}` (1 to 999) | `200 {"order":order}`; adds to an existing line | 404; `409 {"error":"insufficient_stock","available":<n>}`; 422 |
| `PATCH /api/cart/lines/<code>` | signed in | `{quantity}` (0 to 999; 0 removes) | `200 {"order":order}` | 404; 409 `insufficient_stock` |
| `POST /api/orders/<orderKey>/authorise` | owner of the order | header `Idempotency-Key` (1 to 100 characters); `{card:{number, expiry:"MM/YY", cvc, name}, delivery:{name, address, city, postcode}}` | `200 {"order":order}` with status `authorised` | `400 {"error":"idempotency_key_required"}`; `402 {"error":"card_declined","order":order}`; 409 `insufficient_stock`; `409 {"error":"empty_cart"}`; 422 (`postcode` must be 4 digits; `number` must pass the Luhn check and have 16 digits once spaces are removed; `expiry` must not be before the current month; `cvc` must be 3 digits); `503 {"error":"payment_unavailable","order":order}` |
| `POST /api/orders/<orderKey>/place-on-account` | owner, approved trade | header `Idempotency-Key`; `{delivery, purchase_order?}` (up to 40 characters) | `200 {"order":order}` with status `placed` | 400 `idempotency_key_required`; `403 {"error":"trade_account_required"}`; 409 `insufficient_stock`, `empty_cart`; 422 |
| `GET /api/orders` | signed in | — | `200 {"orders":[order]}`, newest first, excluding the open cart | — |
| `GET /api/orders/<orderKey>` | owner or admin | — | `200 {"order":order}` | 404 |
| `POST /api/newsletter` | anyone | `{email, occupation:"architect"\|"trade"\|"wholesaler"\|"other", consent:true}` | `202 {"status":"pending_confirmation"}` | 422 (`consent` not `true` is `required`) |
| `GET /api/newsletter/confirm?token=<token>` | anyone | — | `200 {"status":"confirmed","email":…,"occupation":…}`; repeats return the same | `404 {"error":"unknown_token"}` |
| `POST /api/projects` | approved trade | `{name, client_name?, ceiling_height_mm?, room_width_mm?, room_depth_mm?}` | `201 {"project":project}` | 403 `trade_account_required`; 422 |
| `GET /api/projects` | approved trade | — | `200 {"projects":[project without placements]}` | 403 |
| `GET /api/projects/<id>` | owner or collaborator | — | `200 {"project":project}` | 404 |
| `PATCH /api/projects/<id>` | owner or collaborator | any of the create fields | `200 {"project":project}` | `409 {"error":"placements_outside_room"}`; 422 |
| `POST /api/projects/<id>/lines` | owner or collaborator | `{variant_code, quantity}` (1 to 999) | `200 {"project":project}`; adds to an existing line | 404 `unknown_variant`; 422 |
| `PATCH /api/projects/<id>/lines/<code>` | owner or collaborator | `{quantity}` (0 to 999; 0 removes the line) | `200 {"project":project}` | `409 {"error":"placement_exceeds_quantity"}` |
| `POST /api/projects/<id>/cover` | owner or collaborator | `multipart/form-data`, field `image` | `201 {"cover":{"status":"ready","url":…}}` | 413; `422` with `image` `unsupported_type`; 503 `storage_unavailable` |
| `GET /api/projects/<id>/cover` | owner or collaborator | — | `200` image bytes | 404 |
| `POST /api/projects/<id>/placements` | owner or collaborator | `{variant_code, x_mm, y_mm}` | `201 {"placement":placement,"live":bool}` | 409 `placement_exceeds_quantity`; 422 (`x_mm` and `y_mm` must be whole numbers within the room, edges allowed) |
| `PATCH /api/projects/<id>/placements/<pid>` | owner or collaborator | `{x_mm, y_mm}` | `200 {"placement":placement,"live":bool}` | 404; 422 |
| `DELETE /api/projects/<id>/placements/<pid>` | owner or collaborator | — | `204` | 404 |
| `POST /api/projects/<id>/collaborators` | owner | `{email}` | `201 {"collaborator":{user_id,name,email}}` | `403 {"error":"owner_only"}`; 422 with `email` `not_a_trade_account` |
| `DELETE /api/projects/<id>/collaborators/<userId>` | owner | — | `204` | 403 `owner_only` |
| `GET /api/projects/<id>/comments` | owner or collaborator | — | `200 {"comments":[{id, author_name, body, created_at}]}`, oldest first | `503 {"error":"collaboration_unavailable"}` |
| `POST /api/projects/<id>/comments` | owner or collaborator | `{body}` (1 to 2,000 characters) | `201 {"comment":comment}` | 422; 503 `collaboration_unavailable` |
| `GET /api/projects/<id>/live` | owner or collaborator | — | `200` `text/event-stream` with events `presence` `{viewers:[{user_id,name,initials}]}`, `comment` `{comment}`, `placement` `{action:"created"\|"updated"\|"deleted", placement}`, `status` `{live:bool}` | 404 |
| `POST /api/projects/<id>/shares` | owner | `{recipients:[email], price_display:"trade"\|"retail"\|"none", message?}` (1 to 10 recipients; message up to 1,000 characters) | `201 {"share":{id, price_display, recipients, pdf_status:"pending", created_at}}` | 403 `owner_only`; 422 |
| `GET /api/projects/<id>/shares` | owner or collaborator | — | `200 {"shares":[share]}` with `pdf_status` `pending`, `waiting_for_storage` or `ready` | — |
| `GET /api/shares/<shareId>/pdf` | owner or collaborator | — | `200` `application/pdf` | `409 {"error":"pdf_not_ready"}` |
| `GET /api/admin/trade-applications?status=<status>` | admin | — | `200 {"applications":[{id, applicant_name, applicant_email, business_name, nzbn, occupation, status, submitted_at, decided_at, decline_reason}]}` | — |
| `POST /api/admin/trade-applications/<id>/approve` | admin | — | `200 {"application":…}` | — |
| `POST /api/admin/trade-applications/<id>/decline` | admin | `{reason}` (1 to 500 characters) | `200 {"application":…}` | 422 |
| `GET /api/admin/orders` | admin | — | `200 {"orders":[order + customer_email]}`, excluding open carts | — |
| `POST /api/admin/orders/<orderKey>/dispatch` | admin | — | `200 {"order":order}` | 503 `payment_unavailable` |
| `POST /api/admin/orders/<orderKey>/refunds` | admin | header `Idempotency-Key`; `{amount_cents, reason}` (amount at least 1; reason 1 to 200 characters) | `201 {"refund":{id, amount_cents, reason, kb_transaction_id, created_at},"order":order}` | 400 `idempotency_key_required`; 422 with `amount_cents` `exceeds_refundable`; 503 `payment_unavailable` |
| `POST /api/admin/orders/<orderKey>/record-payment` | admin | `{amount_cents}` (including GST) | `200 {"order":order}` | 422 with `amount_cents` `must_equal_balance`; 503 `payment_unavailable` |
| `GET /api/admin/stock` | admin | — | `200 {"items":[{variant_code, product_name, clearance_price_cents, stock_on_hand, movements:[{delta, reason, order_key, note, created_at}]}]}` | — |
| `PATCH /api/admin/variants/<code>` | admin | `{stock_adjust?, note?, clearance_price_cents?}`; `clearance_price_cents: null` ends clearance | `200 {"item":stock item}` | `409 {"error":"stock_below_zero"}`; 422 |
| `GET /api/admin/health` | admin | — | `200 {"services":{"postgres":"up"\|"down","killbill":…,"mailpit":…,"minio":…,"pocketbase":…}}` | — |

Every `/api/admin/` endpoint refuses non-admins through step 3 of the error precedence.

### Business rules (DP-02, DP-07, DP-09, DP-10, DP-14–DP-16, DP-18, DP-19, DP-30, DP-31, DP-37, DP-38, DP-41, DP-44–DP-46, DP-48–DP-51, DP-57)

- **Price tier.**
  - A cart is priced at `trade` for an approved trade buyer and at `retail` for everyone else. It is repriced on every read until it leaves the cart state, then frozen.
  - Clearance variants carry their clearance price in both `retail_price_cents` and `trade_price_cents`.
  - Every stored and displayed price is without GST.
- **GST.**
  - `line_total_cents = unit_price_cents × quantity`, and `subtotal_cents` is the sum of the line totals.
  - `gst_cents` is 15% of `subtotal_cents`, computed once per order, rounded to the nearest cent with halves rounded up.
  - `total_cents = subtotal_cents + gst_cents`.
  - The same three figures appear on the cart, order, confirmation email, quote PDF (when it shows prices) and Kill Bill.
  - For example, with the seed data at start: one PHP-BZ-60-2700 at trade price gives a subtotal of 24150, GST of 3623 and a total of 27773.
- **Money labels and format.**
  - Money is shown as `$` followed by dollars with comma thousands separators and two decimals, for example `$1,234.50`.
  - Totals are labelled `Subtotal (excl. GST)`, `GST (15%)` and `Total (incl. GST)` in the cart, emails and PDFs.
- **Order key.** Each open cart has one order key, `LF-` followed by 8 characters from `ABCDEFGHJKLMNPQRSTUVWXYZ23456789`. A caller's next cart gets a new key once the previous one is authorised or placed. The key never changes for the life of the order.
- **Card order states.**
  - Allowed changes:
    - `cart` → `authorised` | `declined` | `gateway_unavailable` (by authorise);
    - `declined` or `gateway_unavailable` → `authorised` | `declined` | `gateway_unavailable` (by authorise again);
    - `authorised` → `captured` (dispatch);
    - `captured` or `partially_refunded` → `partially_refunded` | `refunded` (refund).
  - Cart lines can be edited only in `cart`, `declined` and `gateway_unavailable`, and `GET /api/cart` returns an order in one of those states.
  - Every other change answers `409 {"error":"invalid_state","status":"<current status>"}`, including editing lines of an order that is not open, dispatching an order that is not `authorised` or `placed`, refunding an order that is not captured or partly refunded, and authorising an order that is already authorised.
- **Account order states.**
  - Allowed changes: `cart` → `placed` (place on account), `placed` → `invoiced` (dispatch), `invoiced` → `paid` (record payment).
  - An `invoiced` order whose due date is before the server's date reports `status` `overdue`; recording payment moves it to `paid`.
  - Refunds and authorisation on account orders answer the `invalid_state` 409.
- **Display status labels.** These are used in the admin orders table and on order pages:
  - `cart` → `Cart`
  - `authorised` → `Authorised`
  - `captured` → `Paid`
  - `partially_refunded` → `Partly refunded`
  - `refunded` → `Refunded`
  - `declined` → `Declined`
  - `gateway_unavailable` → `Payment pending`
  - `placed` → `Placed`
  - `invoiced` → `Invoiced`
  - `paid` → `Paid`
  - `overdue` → `Overdue`

  A card order reads `Paid` only after Kill Bill has replied that the capture succeeded.
- **Test cards.**
  - Spaces in the card number are ignored.
  - `4000 0000 0000 0002` is declined: the order goes to `declined`, the answer is 402, and no Kill Bill payment is created.
  - Any other 16-digit number that passes the Luhn check is approved, for example `4242 4242 4242 4242`.
  - Only the last four digits are stored.
- **One charge per checkout.**
  - `Idempotency-Key` is scoped to the caller and the endpoint.
  - A request repeating a stored key with the same body gets the stored status and body back without doing anything again. Only 200, 201 and 402 answers are stored, so a retry after a 503 or 409 is tried again.
  - The same key with a different body answers `409 {"error":"idempotency_conflict"}`.
  - A second request with a key whose first request is still running answers `409 {"error":"request_in_progress"}`.
  - Before authorising, the server looks up the Kill Bill payment by the order key. If an authorisation already succeeded there (for example after a timeout), it adopts that payment instead of creating another.
  - Whatever the keys, an order never has more than one successful Kill Bill authorisation, one capture, and one refund per refund request key.
- **Clearance stock.**
  - Only clearance variants track stock.
  - Units are reserved in the same database transaction that checks availability, before any Kill Bill call, when an order is authorised or placed on account. If several requests compete for the last units, exactly as many succeed as there are units, in the order the database commits them, and the rest answer the `insufficient_stock` 409.
  - A reservation becomes a `sale` movement (negative) carrying the order key.
  - A decline or a Kill Bill outage writes a `release` movement (positive) for the same order key.
  - Admin changes are `adjust` movements with a note, and the starting stock is one `seed` movement.
  - Stock on hand always equals the sum of the movements and never goes below zero.
  - Adding more units of a clearance variant to a cart than are on hand answers the `insufficient_stock` 409.
  - Refunds do not change stock.
- **Refunds.**
  - The refundable amount is `captured_cents − refunded_cents`. Captures are always the full `total_cents`.
  - A refund amount above the refundable amount answers the `exceeds_refundable` 422. A refund that brings `refunded_cents` to `captured_cents` moves the order to `refunded`; any smaller refund moves it to `partially_refunded`.
  - Simultaneous refunds on one order are applied one at a time: each is checked against the amount left after the ones before it.
  - A refund is written to the order only after Kill Bill confirms the refund transaction.
- **Trade applications.**
  - Signing up as trade creates an application in `submitted`. An admin moves it to `approved` or `declined`, and either decision is final.
  - Deciding an application that is already decided answers `409 {"error":"invalid_state","status":"<current>"}`.
  - The user's `trade_status` mirrors the application. Only `approved` unlocks trade prices, projects and monthly account.
- **Light-pool geometry.** The server and the screen use this one formula.
  - `h` is the ceiling height: the project's `ceiling_height_mm` in the room, and 2700 mm on product pages and in comparisons. Lux is measured on the floor directly below the fitting.
  - Pool diameter in mm = 2 × `h` (mm) × tan(beam ÷ 2), rounded to the nearest whole mm with halves up.
  - `own_lux` = candela ÷ (`h` in metres)², rounded to the nearest whole lux with halves up.
  - `centre_lux` of a placement P is the sum, over every placement Q in the project (P included), of candela(Q) × cos³θ ÷ (`h` in metres)². Here `d` is the horizontal distance between the centres of P and Q, and θ = atan(`d` ÷ `h`). Q counts only when `d` is no more than half of Q's unrounded pool diameter. The sum is rounded to the nearest whole lux with halves up.
  - For example, with the seed data at start: KDL-BK-24-3000 at 2700 mm has a pool diameter of 1148 and an own_lux of 898. Two of them 500 mm apart each have a centre_lux of 1753.
  - The lighting dial never changes these figures.
- **Placements.**
  - Each placement lies within 0 to `room_width_mm` on x and 0 to `room_depth_mm` on y, edges included.
  - A variant's placements never outnumber its line quantity. Lowering a quantity below the placed count, or adding a placement beyond it, answers the `placement_exceeds_quantity` 409.
  - Shrinking the room so that a placement falls outside it answers the `placements_outside_room` 409.
  - `ordinal` counts a variant's placements from 1 in creation order and is never reused within the project.
  - Ceiling height is 2400 to 4000 mm (default 2700), room width and depth are 2000 to 20000 mm (defaults 6000 and 4500), and all limits are inclusive.
- **Collaboration timing.**
  - A viewer appears in other viewers' "Viewing now" within 3 seconds of opening the project and leaves it within 30 seconds of closing it.
  - Comments and placement changes reach every other open view of the project within 3 seconds.
  - After PocketBase becomes reachable again, live collaboration resumes within 15 seconds.
- **Collaborators.** Only the owner invites or removes collaborators and shares quotes. Owners and collaborators can view, edit lines, place fittings and comment. Any other caller gets the 404.
- **Quote price display.**
  - `trade` shows trade prices and `retail` shows retail prices, each with lines, the GST line and the total.
  - `none` shows codes, product names, finishes, beams, colour temperatures and quantities only: no dollar sign, no amount and no GST line anywhere in the email or the PDF.
  - A `retail` share never contains a trade price figure.
- **Quote PDF readiness.**
  - A share starts `pending`. The server writes the PDF to MinIO and then confirms that the object exists before setting `ready`, which happens within 10 seconds while MinIO is reachable. Only then does it send the emails.
  - While MinIO is unreachable the share reads `waiting_for_storage`. The server retries every 10 seconds and finishes on its own once MinIO returns.
  - Shares are worked from their stored state, not from memory. Every running instance of the app picks up the `pending` and `waiting_for_storage` shares in the database it uses. A share therefore survives a restart, and whichever instance on that database next reaches MinIO finishes it.
- **Trade invoices.**
  - Dispatching a `placed` account order raises the Kill Bill invoice. Its `invoice_date` is the server's New Zealand date.
  - `due_date` is the 20th of the month after the invoice date. For example, an invoice dated 2027-01-15 is due 2027-02-20 and reads Overdue from 2027-02-21.
  - Recording payment needs `amount_cents` equal to the order's `total_cents`.
- **Server date.** The server's date for every date rule (invoice date, due date, overdue, card expiry) is the current date in Pacific/Auckland. When `LIGHTFALL_TODAY` is set it is used instead, as `YYYY-MM-DD`.
- **Lighting dial bands.** Auto uses the viewer's local hour:
  - Morning: 05:00 to 10:59
  - Day: 11:00 to 16:59
  - Evening: 17:00 to 20:59
  - Night: 21:00 to 04:59

  A signed-in user's choice is saved with `PUT /api/me/dial` and applied when they next load any page. A signed-out visitor's choice is kept in the browser. The default is Auto.
- **Newsletter.** A subscription is stored with its email, occupation, consent time and confirmation time. It counts as subscribed only once confirmed. Signing up again with the same email sends a new link and keeps the earlier records.

### Services (DP-08, DP-11, DP-20, DP-26, DP-28, DP-37–DP-40, DP-42, DP-44, DP-46, DP-49, DP-51–DP-53, DP-55)

Any provider call that cannot connect, or gets no reply within 10 seconds, counts as unreachable.

- **Kill Bill** (`KILLBILL_URL`, tenant from `KILLBILL_API_KEY` and `KILLBILL_API_SECRET`).
  - **Accounts.** Each buyer has one Kill Bill account with external key `lf-user-<user id>`, currency `NZD` and name equal to the user's name. It is created on first need and reused afterwards. It has one default payment method using the built-in external payment plugin.
  - **Authorisation.** One payment per card order, with payment external key `<orderKey>`. An `AUTHORIZE` transaction for the order total in dollars (`total_cents ÷ 100`), with transaction external key `<orderKey>-auth`.
  - **Dispatch.** A `CAPTURE` of the full amount with transaction external key `<orderKey>-capture`.
  - **Refunds.** Each refund is a `REFUND` transaction on that payment with transaction external key `<orderKey>-refund-<n>`, where `<n>` counts from 1 per order.
  - **Account-order dispatch.** One invoice on the buyer's Kill Bill account, made of external charges in one request: one item per order line, with description `<variant_code> x <quantity>` and amount equal to the line total in dollars; plus one item with description `GST 15%` and amount equal to the GST in dollars. The invoice balance equals the order total.
  - **Record payment.** Pays that invoice as an external payment with payment external key `<orderKey>-payment`.
  - **Order states.** An order's authorised, captured and refunded states, and an account order's invoiced and paid states, are written only after Kill Bill's successful reply.
  - **When unreachable.**
    - Authorise answers the `payment_unavailable` 503, the order goes to `gateway_unavailable`, the reservation is released, and the checkout shows the payment outage copy.
    - Dispatch, refund and record payment answer the same 503, leave the order unchanged, and show the Kill Bill outage copy.
    - Placing on account does not call Kill Bill.
    - The next call after Kill Bill returns goes through without a restart.
- **Mailpit** (SMTP at `SMTP_HOST`:`SMTP_PORT`). Every message is sent from the `MAIL_FROM` value, `Southerly Light Works <lightfall@southerly-light.test>`. Messages, each in plain text and HTML:
  - **Order confirmation** to the buyer, subject `Your Lightfall order <orderKey>`. It lists each line as `<variant_code> x <quantity>` with its line total, then the three money labels with their figures. Account orders also show the purchase order. Sent once per order when the order is authorised or placed.
  - **Trade approved** to the applicant, subject `Your Lightfall trade account is approved`.
  - **Trade declined** to the applicant, subject `About your Lightfall trade application`. The body includes the admin's reason.
  - **Quote share**, one message per recipient, subject `<sender name> shared a Lightfall quote: <project name>`. The body includes the sender's message and the quote at the share's price display. The PDF is attached as `lightfall-quote-<shareId>.pdf`.
  - **Newsletter confirmation** to the subscriber, subject `Confirm your Lightfall newsletter`. It contains the link `<APP_PUBLIC_URL>/newsletter/confirm?token=<token>` and states the occupation given.
- **MinIO** (`S3_*`, bucket `S3_BUCKET`, private). Object keys:
  - `covers/<projectId>/<uuid>.<jpg|png|webp>`
  - `spec-sheets/<variantCode>.pdf`, created on the first request and reused afterwards
  - `quotes/<projectId>/<shareId>.pdf`

  A cover or quote counts as ready only after the server has stored the object and confirmed it exists. Browsers fetch files only through the app's own endpoints.

  When MinIO is unreachable:
  - cover upload and spec-sheet download answer the `storage_unavailable` 503 with their outage copy;
  - shares wait as described in Business rules;
  - everything else keeps working.
- **PocketBase** (`POCKETBASE_URL`, admin `POCKETBASE_ADMIN_EMAIL` / `POCKETBASE_ADMIN_PASSWORD`).
  - The app creates these collections on every start and again after reconnecting, leaving existing ones as they are:
    - `lf_presence`: `project_id`, `user_id`, `name`, `seen_at`. One record per viewer per project, refreshed every 10 seconds while the project is open.
    - `lf_comments`: `project_id`, `author_id`, `author_name`, `body`. One record per comment.
    - `lf_placements`: `project_id`, `placement_id`, `variant_code`, `x_mm`, `y_mm`, `action`. One record per placement create, move or delete, written after the Postgres save.
  - The server subscribes to PocketBase changes and relays them to browsers through the project live stream. Browsers never contact PocketBase.
  - When PocketBase is unreachable:
    - placements save to Postgres and answer with `"live":false`;
    - comment endpoints answer the `collaboration_unavailable` 503;
    - the live stream sends `status` `{live:false}`, and pages show the Live collaboration outage copy.
  - The server retries every 5 seconds and resumes within the delay in Business rules.
- **Postgres** (`DATABASE_URL`). Stores everything else: catalogue, accounts, sessions, trade applications, favourites, projects, lines, placements, carts and orders with their GST figures, refunds, stock movements, shares, newsletter subscriptions, dial settings and idempotency records.
  - Schema and seed data apply on every start. Applying them is idempotent and safe when two instances start at once against the same database.

### Seed data (DP-01, DP-02, DP-14, DP-17, DP-18, DP-27, DP-36)

Every person, business, address and NZBN below is invented.

**Accounts.** Passwords are stored hashed.

| Name | Email | Password | Role / trade status | Business, NZBN, occupation |
|---|---|---|---|---|
| Ana Whitlow | `admin@southerly-light.test` | `Lightfall-admin-2026` | admin | — |
| Rangi Parata | `rangi@kowhai-electrical.test` | `Trade-approved-2026` | trade / approved | Kōwhai Electrical Ltd, `9429041234567`, electrician |
| Isla Morven | `isla@harbourlight.test` | `Trade-collab-2026` | trade / approved | Harbour Light Design, `9429047654321`, lighting_designer |
| Sam Whitcombe | `sam@whitcombe-wholesale.test` | `Trade-pending-2026` | trade / submitted | Whitcombe Wholesale, `9429030000017`, wholesaler |
| Jo Bennett | `jo@bennett-home.test` | `Retail-buyer-2026` | retail | — |
| Lee Chen | `lee@chen-house.test` | `Retail-buyer2-2026` | retail | — |

**Finishes.** `WH` Matte White, `BK` Matte Black, `BR` Brushed Brass, `BZ` Aged Bronze, `CH` Charcoal, `SN` Satin Nickel.

**Variant codes and prices.**

- Each variant code is `<product code>-<finish>-<beam>-<cct>`, for example `KDL-BK-24-3000`.
- Price in cents = product base price + finish surcharge + beam surcharge. Each figure below is given as retail/trade, and the result is the same for every colour temperature.
- Candela comes from the table for its beam and colour temperature. Lumens depend only on the colour temperature.

**Products.**

- **Kauri Downlight**
  - Slug `kauri-downlight`, code `KDL`, family `downlights`, default variant `KDL-WH-36-3000`.
  - 10 W, CRI 95, IP44.
  - Description: "Deep-recessed downlight with a glare-free trim."
  - Finishes WH, BK, BR; beams 24, 36, 60; colour temperatures 2700, 3000, 4000.
  - Base 8900/6400. BR +2000/+1400. Beam 24 +600/+400.
  - Lumens 860 / 900 / 940 at 2700K / 3000K / 4000K.
  - Candela at 2700K / 3000K / 4000K: 24° 6260 / 6550 / 6840; 36° 2800 / 2930 / 3060; 60° 1020 / 1070 / 1120.
- **Tōtara Track Spot**
  - Slug `totara-track-spot`, code `TTS`, family `track-spots`, default variant `TTS-BK-24-3000`.
  - 13 W, CRI 95, IP20.
  - Description: "Three-circuit track spot with a rotating, tilting head."
  - Finishes BK, WH; beams 15, 24, 36; colour temperatures 2700, 3000, 4000.
  - Base 14900/10500. Beam 15 +900/+600, beam 24 +600/+400.
  - Lumens 1150 / 1200 / 1260.
  - Candela at 2700K / 3000K / 4000K: 15° 21370 / 22300 / 23420; 24° 8380 / 8740 / 9180; 36° 3740 / 3900 / 4100.
- **Pōhutukawa Pendant**
  - Slug `pohutukawa-pendant`, code `PHP`, family `pendants`, default variant `PHP-BR-60-2700`.
  - 16 W, CRI 90, IP20.
  - Description: "Spun pendant with a softly diffused 60° downward beam."
  - Finishes BR, BZ; beam 60; colour temperatures 2700, 3000.
  - Base 32000/22400. BZ +2500/+1750.
  - Lumens 1400 / 1450 at 2700K / 3000K.
  - Candela 1660 / 1720.
- **Harbour Surface Cylinder**
  - Slug `harbour-surface-cylinder`, code `HSC`, family `surface`, default variant `HSC-WH-24-3000`.
  - 8 W, CRI 90, IP54.
  - Description: "Surface-mounted cylinder for concrete and exposed ceilings."
  - Finishes WH, BK; beams 24, 36; colour temperatures 3000, 4000.
  - Base 12500/8750. Beam 24 +600/+400.
  - Lumens 700 / 740 at 3000K / 4000K.
  - Candela at 3000K / 4000K: 24° 5100 / 5390; 36° 2280 / 2410.
  - One extra discontinued variant, `HSC-CH-24-3000`: lumens 700, candela 5100, clearance price 7900, stock 1.
- **Rimu Gimbal Downlight**
  - Slug `rimu-gimbal-downlight`, code `RGD`, family `downlights`, default variant `RGD-SN-36-3000`.
  - 8 W, CRI 90, IP44.
  - Description: "Adjustable gimbal downlight, final production run."
  - One variant only, `RGD-SN-36-3000`: regular price 11900/8300, lumens 650, candela 2110, clearance price 5900, stock 3.

The clearance family (`?family=clearance`) holds the two clearance variants' products, and stock starts as one `seed` movement each.

**Seeded project and application.**

- Project **Ponsonby Kitchen**, owned by Rangi Parata.
  - Client `M. and T. Hale`; ceiling 2700 mm; room 6000 × 4500 mm.
  - Lines `KDL-BK-24-2700` × 6 and `TTS-BK-36-3000` × 2.
  - No placements. Isla Morven is a collaborator.
- Sam Whitcombe's trade application is `submitted`.

No orders, favourites, shares or newsletter subscriptions exist at start.

## Technical requirements

### Deployment (DP-54)

- The runtime is Node.js 22 LTS with npm; the app is written in TypeScript.
- `/app/run.json` holds string commands `install`, `build` and `serve`, plus `"_schema":"run-manifest-v1"`. For example:

```json
{"_schema":"run-manifest-v1","install":"npm ci","build":"npm run build","serve":"npm run start"}
```

- The server binds `0.0.0.0` on the port in `APP_PUBLIC_PORT`, or 4173 when that is unset.
- `GET /api/health` answers `200 {"status":"ok"}` whenever the HTTP server is running, whatever the state of the providers.

### Configuration and secrets (DP-60)

The server reads all of these from the environment at start:

- `DATABASE_URL`
- `KILLBILL_URL`, `KILLBILL_USERNAME`, `KILLBILL_PASSWORD`, `KILLBILL_API_KEY`, `KILLBILL_API_SECRET`
- `SMTP_HOST`, `SMTP_PORT`, `MAIL_FROM`
- `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_FORCE_PATH_STYLE`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`
- `POCKETBASE_URL`, `POCKETBASE_ADMIN_EMAIL`, `POCKETBASE_ADMIN_PASSWORD`
- `APP_PUBLIC_PORT`, `APP_PUBLIC_URL` (the base of links in emails)
- `LIGHTFALL_TODAY` (optional; Business rules)

No credential or service URL is hard-coded in source, written into built browser assets, logged, or sent to the browser.

### Server boundary (DP-55, DP-56)

- **Same origin.** The browser talks only to the app's own origin. A `POST`, `PUT`, `PATCH` or `DELETE` whose `Origin` header is present and differs from the app's origin answers `403 {"error":"cross_origin"}`. The session cookie is HttpOnly and SameSite=Lax.
- **Body limits.**
  - JSON bodies may be up to 100,000 bytes; larger bodies answer `413 {"error":"payload_too_large"}`.
  - A cover image file may be up to 5,000,000 bytes (exactly 5,000,000 is allowed); larger files answer the same 413.
- **Request format.**
  - A JSON endpoint called with another content type answers `415 {"error":"unsupported_media_type"}`.
  - Unparseable JSON answers `400 {"error":"invalid_json"}`.
  - Unknown `/api` paths answer `404 {"error":"not_found"}`.
- **Never served.** The server never serves source files, source maps, `run.json`, package manifests, lockfiles, environment files or anything outside the built browser assets and the API. Requests for those paths answer 404.
- **Degraded boot.** When Kill Bill, MinIO or PocketBase is unreachable at start, the server still starts, serves every page and every endpoint that does not need the missing service, and reconnects on its own when the service returns. The admin health check probes each service live, waits no more than 2 seconds per service, and the Health tab refreshes every 10 seconds.
- **How a return is noticed.** The server keeps no lasting record that a provider is down. Every request, scheduled retry and health probe calls the provider afresh, and the first call that succeeds counts as the provider's return.
  - Kill Bill is retried on the next request.
  - Waiting shares are retried on the 10-second cadence in Business rules.
  - PocketBase is retried on the 5-second cadence in Services.
- **Outage copies.** Each outage copy of the app that grading runs, with one provider unreachable for its whole life, uses its own database. Work it leaves waiting or paused stays that way and is never finished by another copy.

### Browser support and performance (DP-23, DP-58)

- Supported browsers: current Chromium, Firefox and Safari, on desktop and phone, at the published viewports 375x812, 768x1024 and 1280x800.
- Catalogue and product pages are usable (text and controls visible and responding) within three seconds on a local connection.
- The first 3D frame appears within four seconds.
- API reads answer within one second with the seed data.
- The room stays responsive with 40 placements.

## Working rules

- IF-01: `/app/run.json` exists with string `install`, `build` and `serve` fields and `"_schema":"run-manifest-v1"`, and nothing else is needed to install, build and serve the app.
- IF-02: `THIRD_PARTY_NOTICES.md` at `/app` lists every shipped package and every bundled font with its licence. Shipped packages means the production dependency tree, as reported by `npm ls --omit=dev --all --json`.
- IF-03: Every shipped package (as defined in IF-02) is under MIT, ISC, BSD-2-Clause, BSD-3-Clause, Apache-2.0 or 0BSD, and every bundled font is under the SIL Open Font License 1.1.
- IF-04: The app uses no datastore beyond Postgres, Kill Bill, MinIO, PocketBase and Mailpit: no SQLite, Redis, embedded database or files used as a database.
- IF-05: Fonts, icons and scripts are served from the app itself; pages make no requests to third-party origins.
- IF-06: Application source, server and browser, is TypeScript; the only JavaScript files are generated build output and tool configuration.
- IF-07: The provided service definitions and dev environment configuration are left unmodified.
- IF-08: 3D models are built in code from geometric shapes; no downloaded model files, copied imagery or copied copy are shipped.

## Engineering standards

- Code is idiomatic, strictly typed TypeScript with no `any` escapes on domain values, and money is handled as integer cents throughout.
- Names follow the domain terms in this brief: order key, price tier, variant, beam, colour temperature, candela, pool diameter, centre lux, placement, clearance stock, movement, share, price display.
- Each domain rule is decided in exactly one place in the source and used everywhere else: the GST calculation, the light-pool formula shared by server and browser, the order state changes, the stock reservation, the due-date rule and the role projection of price fields.
- There is no abstraction with a single implementation, and no wrapper that only forwards calls.
- There is no dead, commented-out or unreachable code, and no defensive checks for states the rules above make impossible.
- Every API error goes through the one error shape in API.
- Nothing is built beyond this brief: no extra pages, endpoints, roles or settings.
