# Ocotillo Longevity Club Member Desk

Ocotillo Member Desk is the one place where a founder-run longevity membership practice in Scottsdale, Arizona runs its members. Care coordinators book at-home fasting blood draws in each member's own local wall time. Visiting phlebotomists work from a private visit page sent to them by mail. Lab partner results come in as a file, are converted to the practice's units with exact decimals and are flagged against the practice's published range table. Longevity specialists write plans and pack supplement blends into morning and evening packets. Plus memberships are billed every 6 months or yearly. The desk keeps its records in Postgres, stores lab report PDFs and message attachments in MinIO, sends mail through an SMTP server that Mailpit receives, and bills through Kill Bill. Out of scope: medical advice and clinical decisions (specialists write plans and choose blends; the app only stores, converts units, flags results against the published range table, packs blends and bills), changing prices, other payment providers, sign-in through outside identity services, and any datastore other than Postgres and MinIO.

## Problem and users

Today the practice runs on five tools that never agree. The phlebotomy vendor's portal books fasting draws in Phoenix time, so members on the East Coast get a knock at 04:00. Results are retyped from lab PDFs into a spreadsheet, where nmol/L and ng/mL get mixed up and rounding drifts by a tenth. Flags are read against whichever range table is open that day, not the one in force when the blood was drawn. Phlebotomists get street addresses in plain email weeks ahead. The billing tool shows a membership as active before the payment has gone through. Supplement packets are counted by hand, and the evening packet keeps overflowing. The founder pays for all this in refunds for missed draws, specialist hours spent re-checking numbers, HSA/FSA receipts that plan administrators reject, and the privacy risk of addresses and lab values sitting in inboxes.

Users:

- **Practice owner** (the founder, daily): runs members, the published range table, account closures and staff, and keeps the practice's starting data and receipts exact.
- **Longevity specialist** (daily): releases results, corrects values, writes each member's longevity plan and supplement blend, and answers care messages.
- **Care coordinator** (daily): books at-home draws in the member's local wall time, brings in the lab partner's results file and report, and triages care messages.
- **Billing lead** (weekly): watches memberships and lists a month's receipts for HSA/FSA claims without touching health data.
- **Member** (weekly): joins Plus, books or moves a draw, reads results on the marker band, follows the plan and blend, messages the care team, downloads the results history file and can close the account.
- **Visiting phlebotomist** (weekly): opens the private visit page on a phone, sees the draw time and, on the day, the address, enters kit codes and marks the draw collected.
- **Prospective member** (occasional): compares Free and Plus by cadence, checks that their home state is served and browses the marker catalog.

## Journeys

1. **From visitor to Plus member.** A prospective member lands on the home page and opens the plans page. They toggle the cadence between Every 6 months and Yearly, check that Colorado is served, and browse the marker catalog. They create a Free account and land on their member home. From Membership they join Plus yearly. The membership shows Plus · Active with the renewal date Kill Bill reports, and a receipt appears under Records and receipts.
2. **Booking a draw across a clock change.** A care coordinator opens a Denver member's record and books a 07:00 draw with a phlebotomist who serves Colorado, for a Monday after the March clock change. The calendar shows the draw in Phoenix time and Denver time. The phlebotomist gets a mail with a private visit page address and no street address. Later the member moves the draw to another morning before the change cutoff.
3. **The visit.** On the draw day the phlebotomist opens the visit page on a phone. They see the member's first name and last initial, the draw time, the street address and the gate notes. They type each tube's kit code and press Mark collected in the bottom bar. The page ends at the end of the member's local day.
4. **From lab file to released results.** A care coordinator opens the collected draw and brings in the lab partner's results file and the report PDF. They check the preview of matched, unknown and refused rows and save. When the report is stored the draw shows Ready. A longevity specialist releases it, and the member gets a mail that says only that new results are ready.
5. **Reading the marker band.** A member opens Your results. They move across draw stations with the keyboard or a tap. The value dot slides, the numbers roll, and the zones reshape whenever an older draw was flagged against an older range table. When a specialist corrects a value, the open band shows the change and who made it within five seconds.
6. **Plan and blend.** A longevity specialist builds a member's blend. The catalog sits beside the morning and evening packets, and the prices are shown. Then they publish the member's plan. The member sees the latest plan with its byline and the current blend. Staff can still read every earlier plan with the blend it was published with.
7. **Care messages and records.** A member writes to their care team with a photo attached. A coordinator reads the cleaned copy and replies, and the reply appears in the member's open thread. The member downloads their results history file, and the billing lead lists the month's receipts page by page.
8. **Closing an account.** A member closes their account through a confirmation dialog, and their Plus runs to the end of the paid period. The practice owner can bring the account back within the wait. If nobody does, the member's personal data is erased everywhere and receipts read Erased member.

## Mandatory requirements

This is the complete list of mandatory requirements; every check traces to one of these lines and the detailed sections below.

- **DP-01 — Sign-in and sign-out** Sign-in answers the same status for an email that belongs to nobody as for a wrong password, the right password opens a session, and signing out ends it so the session endpoint answers 401.
- **DP-02 — Staff management by the owner** Only the practice owner lists, adds, re-roles and removes staff; a role change applies from that person's next request, a removed staff member can no longer sign in, and a removed or unknown staff id answers 404 on every staff endpoint.
- **DP-03 — Practice access journey** Filling the sign-in form lands each person on their published home route with a live session, and signing out makes the session endpoint answer 401.
- **DP-04 — Plans page journey** A prospective member compares Free and Plus with the cadence radio group, sees the published prices from half-up cents with the price roll, checks a state with the verbatim state copy, opens the catalog accordions and creates a Free account, complete by keyboard and by touch at 375x812, and its screen meets the screen rules.
- **DP-05 — Exact plan prices** The plans endpoint and page show each Plus price and per-month figure exactly as Business rules derive them, rounded half up to the cent.
- **DP-06 — Served state check** The state check answers from the server whether a chosen state is served, using the published yes and not-yet copy.
- **DP-07 — Marker catalog** The six category accordions open and close as published, a closed one is inert and out of the Tab order from the moment it starts closing and hidden once its closing animation ends, and the search filters after its pause, always shows the results for the latest input, and keeps the open category and the search in the address as history entries.
- **DP-08 — Public layouts, header and partner strip** The plans page shows its published layout at each published width, the header turns solid after scrolling, and the partner strip loops, pauses and stops as published.
- **DP-09 — Free account sign-up** A prospective member creates a Free account with the published fields, lands on the member home route signed in, and a state outside the 47 is refused with the not-yet copy.
- **DP-10 — Membership journey** A member joins Plus, changes cadence and cancels through the Membership dialogs, sees only server-decided dates even with the device clock hours off, keeps the dialog open as typed with focus on the outage message on the Kill Bill-down copy, complete by keyboard and by touch at 375x812, and its screen meets the screen rules.
- **DP-11 — Plus confirmed by Kill Bill** Plus shows Active only after Kill Bill confirms the subscription and its first paid invoice, and the renewal date shown is the one Kill Bill reports.
- **DP-12 — Repeated join requests** A join repeated with the same Request-Key header and body answers the first response and makes one subscription, and the same key with a different body answers 409.
- **DP-13 — Cadence change and cancel** A cadence change takes effect at the next renewal and a cancel keeps Plus until the end of the paid period, both with the dates Kill Bill reports.
- **DP-14 — Payments outage** While Kill Bill is unreachable, a join, cadence change, cancel, member create with a cadence, closure or restore answers 503 with the payments copy and writes nothing in either system.
- **DP-15 — Draw booking journey** A care coordinator books a member's draw through the Book draw dialog, sees both times on staff screens across the member's next clock change, hears the slot-taken copy with the winner and the next free slot when a slot is lost, and a member moves or cancels until the cutoff, complete by keyboard and by touch at 375x812, and its screen meets the screen rules.
- **DP-16 — Slots in member wall time** Slots are 20 minutes from 06:00 to 09:40 member local time, Monday to Saturday with the staff same-day exception in Business rules, and keep their wall-clock time across clock changes, so the Phoenix-time instant moves.
- **DP-17 — One booking per slot** Of simultaneous bookings of one phlebotomist's slot exactly one succeeds and every other answers 409 with the winner and that phlebotomist's real next free slot.
- **DP-18 — Who can have a draw and when** A draw needs a phlebotomist who serves the member's state, Plus in force as qualified in Business rules, and a date inside the booker's window, and a past date records a collected draw.
- **DP-19 — Member change cutoff** A member can move or cancel a booked draw until 18:00 member local time on the day before it, and a request at or after that instant answers 409 with the changes-closed copy.
- **DP-20 — Visit page journey** A visiting phlebotomist works the visit page at 375x812 by touch: they see the member's first name and last initial and the draw time, enter kit codes and read the wrong-check copy for a bad one, press Mark collected in the bottom bar, and see the ended copy once the page ends, complete by keyboard too, and its screen meets the screen rules.
- **DP-21 — Visit page lifetime** Booking a draw for today or later mails a visit page address, and that address ends at its published end instant, when a new address replaces it, or when a coordinator ends it, after which it answers 410.
- **DP-22 — What the visit page shows** The visit page and every response it reads carry only the published visit fields, and the street address and gate notes appear only when the server says it is the draw day in member local time.
- **DP-23 — Kit codes** Kit codes are accepted only with a valid check character as published, in any letter case and with or without dashes, and are always shown in upper-case dashed form.
- **DP-24 — Results intake journey** A care coordinator previews and saves the lab partner's results file and report through the Bring in results dialog, sees Ready only after the report is stored, reads the outage copy on the MinIO-down copy, and scrolls the preview table in its own named frame at 375x812, complete by keyboard and by touch at 375x812, and its screen meets the screen rules.
- **DP-25 — Results file preview and conversion** The results file is read as published, rows are matched through the alias table and converted with the factor table in exact decimals rounded half up, the preview lists matched, unknown and refused rows with row numbers and reasons before anything is saved, and saving the same file twice changes nothing.
- **DP-26 — Report file checks** A report is judged by its content and limited on the file alone as published in Server boundary, and an oversized body answers 413 as JSON before authentication.
- **DP-27 — Report kept byte for byte** Each report is stored in MinIO byte for byte under its published key and downloads unchanged, and the draw shows Ready only after MinIO confirms the stored object.
- **DP-28 — Report store outage** While MinIO is unreachable, a report is refused with 503 and the report-store copy, and no row and no object is written.
- **DP-29 — Releasing results** A specialist releases a Ready draw to the member, which queues one mail that carries no marker, value or flag, and members see only released results.
- **DP-30 — Marker band journey** A member reads results on the marker band with server-decided zones and flags, moves through the draw stations by keyboard and touch, opens a draw's popover uncut, and sees a corrected value arrive with the correction copy in their own local time, and its screen meets the screen rules.
- **DP-31 — Flags from the range table** Each result is flagged by the server from the range table for the member's sex and age band in force on the draw's collected date, with age in whole years on the member's local collected date.
- **DP-32 — Effective-dated range changes** The practice owner changes a marker's ranges from a chosen Phoenix date, every draw keeps the ranges in force on its collected date on every screen, file and response, and a second change of one marker for one date answers 409 with the duplicate-change copy.
- **DP-33 — Marker band motion** Selecting another station slides the same dot element, rolls the numerals and morphs differing zones, all starting in the same frame with the published durations, newly released results draw the newest trend segment, and under reduced motion all of it changes at once with the same final page state.
- **DP-34 — Draw station keyboard** The draw stations form one keyboard composite with a single Tab stop, Left and Right moving, Home and End jumping, Up and Down also moving at 375, and Enter opening the draw's detail popover uncut inside the viewport.
- **DP-35 — Corrected values** A specialist's corrected value keeps its history and reaches every open band within the 5-second refresh with the correction copy, while an open popover stays open.
- **DP-36 — Longevity plan journey** A longevity specialist writes and publishes a plan in the Edit plan dialog, the member sees the latest published plan with its byline, and a stale save keeps the dialog open as typed with the newer-plan copy, complete by keyboard and by touch at 375x812, and its screen meets the screen rules.
- **DP-37 — Published plans** A member only ever sees the latest published plan and never a draft, staff read every earlier published plan exactly as published with the blend it was published with, and the latest plan's Supplements section shows the current blend.
- **DP-38 — Newer plan protection** Saving or publishing a draft after someone else has published a newer plan answers 412 with the newer-plan copy.
- **DP-39 — Plan dialog keeps its state** The open Edit plan dialog keeps what was typed across the 5-second refresh, and pressing Edit plan again during its closing animation keeps it open for good.
- **DP-40 — Blend builder journey** A longevity specialist builds a member's blend in the Blend builder, sees capsule strengths in their units, packets and prices, and reads the packet-full copy with focus on it, complete by keyboard and by touch at 375x812 with the catalog in a bottom sheet, and its screen meets the screen rules.
- **DP-41 — Packet packing** Daily doses are whole capsules, Split capsules divide between packets with the odd one in the morning, and a packet over 4 capsules answers 422 with the packet-full copy naming the packet.
- **DP-42 — Blend prices** The 30-day list price and the member price are computed in integer cents exactly as Business rules publish, with the member price rounded half up.
- **DP-43 — Blend builder layouts** The Blend builder shows the catalog beside the packets from 1100 px wide, stacked below 1100 px, and in a bottom sheet at 375x812.
- **DP-44 — Care thread journey** A member writes to their care team with an optional attachment, sees a staff reply arrive in the open thread while the message box keeps focus and text, and reads the rate-limit copy on the short-timers copy, complete by keyboard and by touch at 375x812, and its screen meets the screen rules.
- **DP-45 — Message limits and attachments** A message is at most 2,000 characters counted in code points, with at most one PDF, JPEG or PNG attachment judged by its content and limited on the file alone as published.
- **DP-46 — Photo originals and staff copies** A photo attachment's original is kept in MinIO byte for byte, and the copy staff see has the camera orientation applied and every metadata block removed.
- **DP-47 — Message rate limit** A member's 11th message inside MESSAGE_RATE_WINDOW_SECONDS answers 429 with Retry-After in whole seconds and the message-limit copy, keyed on the member and never on the network address.
- **DP-48 — Records and receipts journey** A member downloads the results history file and opens receipt pages, and the billing lead pages through a month's receipts, with each wide table scrolling in its own focusable, named frame at 375x812, and the member reads the download-limit copy on the short-timers copy, complete by keyboard and by touch at 375x812, and its screen meets the screen rules.
- **DP-49 — Results history file** The results history file has the published format and columns with the range in force on each draw, prefixes any cell starting with a formula character with an apostrophe, and is limited to 5 downloads per member per FILE_RATE_WINDOW_SECONDS.
- **DP-50 — Receipt pages** Each paid Kill Bill invoice has one receipt page with the exact amounts Kill Bill reports, the paid date in Phoenix time and the practice's tax number.
- **DP-51 — Billing lead receipt list** The billing lead lists a month's receipts 25 per page in the stable order, with a cursor that never repeats or skips a receipt while new ones arrive, and every response carries only the published receipt fields and no health data.
- **DP-52 — Closing journey** A member closes their account through a confirmation dialog and the practice owner can bring it back, with every state shown as the server says even with the device clock hours off, the closing copy naming the erase time, and each action landing on its published route, complete by keyboard and by touch at 375x812, and its screen meets the screen rules.
- **DP-53 — Erasure after the wait** CLOSURE_WAIT_SECONDS after a closing request, the member's personal data is erased from the database, Kill Bill, MinIO and unsent mail, the member shows Erasing until MinIO confirms every deletion and then Erased, and receipts read Erased member.
- **DP-54 — Bringing an account back** Within the wait, the practice owner brings a closing account back exactly as it was, with the same draws, results, plans, blend and membership.
- **DP-55 — Routes, screens and layouts** Every screen has its published route and level-one heading, each role lands on its home route, record routes survive a reload, and every screen passes the automated accessibility check and shows its published layout at every published viewport with no sideways page overflow.
- **DP-56 — One API convention** Every API response follows the one error-precedence ladder, the one error shape, camelCase keys and enum values, and whole-second UTC instants, and only the published endpoints exist.
- **DP-57 — Sessions** The session cookie has the published attributes, the server alone ends sessions, changing a password ends that person's other sessions, and a session that ends mid-form keeps what was typed and reopens the same dialog after signing in again.
- **DP-58 — Starting data and safe start** A fresh practice copy on its own empty database and bucket starts safely next to other copies with exactly the published starting data, and delivers its own pending mail.
- **DP-59 — Airy, precise look** Screens show the airy pale-sky look with rounded white cards, Fraunces headings, Figtree text with lined-up figures, procedural glyph imagery and the marker band as the visual centre of results.
- **DP-60 — Credentials and wiring** Every service credential and address is read from the environment, never hard-coded or sent to the browser, and every state shown comes from the real services, never from a stand-in.

## Frontend

### Screens and layout (DP-55, DP-08, DP-43, DP-04)

Every screen has one level-one heading, given below. At 375x812 each screen's main action sits in a bar fixed to the bottom. From 768 px wide it sits in the normal flow. No screen scrolls sideways at 375x812, 768x1024, 1024x768 or 1280x800. A wide table scrolls sideways inside its own frame instead.

| Route | Level-one heading | Who | Main action at 375x812 |
|---|---|---|---|
| `/` | `Ocotillo Longevity Club` | anyone | link `See plans` |
| `/plans` | `Plans` | anyone | button `Join Plus` |
| `/markers` | `Marker catalog` | anyone | link `See plans` |
| `/join` | `Create your free account` | anyone | button `Create account` |
| `/signin` | `Sign in` | anyone | button `Sign in` |
| `/me` | `Welcome, <first name>` | member | link `Book a draw` |
| `/me/membership` | `Membership` | member | button `Join Plus` (Free) or button `Change cadence` (Plus) |
| `/me/draws` | `Your draws` | member | button `Book a draw` |
| `/me/draws/<drawId>` | `Draw on <date>` | member | button `Move draw` |
| `/me/results` | `Your results` | member | link `Message your care team` |
| `/me/plan` | `Your longevity plan` | member | link `Message your care team` |
| `/me/messages` | `Messages` | member | button `Send message` |
| `/me/records` | `Records and receipts` | member | button `Download results history` |
| `/me/account` | `Your account` | member | button `Save profile` |
| `/receipts/<receiptId>` | `Receipt <receipt number>` | the member, billing lead, owner | button `Print receipt` |
| `/staff/members` | `Members` | all staff | button `Add member` (owner); none for others |
| `/staff/members/<memberId>` | `<member name>` | all staff | button `Book draw` (owner, coordinator) |
| `/staff/members/<memberId>/results` | `Results for <member name>` | owner, specialist, coordinator | link `Back to member` |
| `/staff/members/<memberId>/plan` | `Plan for <member name>` | owner, specialist | button `Edit plan` |
| `/staff/members/<memberId>/plans/<planId>` | `Plan published <date>` | owner, specialist | link `Back to plan` |
| `/staff/members/<memberId>/blend` | `Blend for <member name>` | owner, specialist | button `Save blend` |
| `/staff/members/<memberId>/blends/<blendId>` | `Blend for <member name>` | owner, specialist | button `Save blend` |
| `/staff/members/<memberId>/messages` | `Messages with <member name>` | owner, specialist, coordinator | button `Send reply` |
| `/staff/messages` | `Care messages` | owner, specialist, coordinator | link `Open oldest open thread` |
| `/staff/calendar` | `Draw calendar` | owner, coordinator | button `Book draw` |
| `/staff/draws/<drawId>` | `Draw for <member name> on <date>` | owner, specialist, coordinator | button `Bring in results` (collected), button `Release results` (ready), button `Send new visit page` (booked) |
| `/staff/results` | `Results to release` | owner, specialist | link `Open next draw` |
| `/staff/ranges` | `Range table` | owner | button `Change ranges` |
| `/staff/receipts` | `Receipts` | owner, billing lead | button `Next page` |
| `/staff/team` | `Team` | owner | button `Add staff member` |
| `/visit/<token>` | `Visit for <first name> <last initial>.`; an ended page `This visit page has ended.`; an unknown token `We can't find that page.` | anyone with the address | button `Mark collected` (none once ended or unknown) |
| any other path | `We can't find that page.` | anyone | link `Go to the home page` |

Home routes after sign-in:

| Role | Home route |
|---|---|
| member | `/me` |
| practice owner | `/staff/members` |
| longevity specialist | `/staff/results` |
| care coordinator | `/staff/calendar` |
| billing lead | `/staff/receipts` |

After booking a draw the address bar shows `/staff/draws/<drawId>` (staff) or `/me/draws/<drawId>` (member). After saving results it shows `/staff/draws/<drawId>`. After publishing a plan it shows `/staff/members/<memberId>/plans/<planId>`. After saving a blend it shows `/staff/members/<memberId>/blends/<blendId>`. After closing an account it shows `/me/account`. Reloading any of these addresses shows the same screen.

Layout by screen:

- **Public header** (every public screen): brand on the left, `navigation "Main"` with the Explore mega menu, Plans, Marker catalog and Sign in. At 375 the header shows brand, Explore and Sign in.
- **Home** (`/`): a hero with a generated cloud and gradient ground, a short pitch, the partner strip, and three feature cards for at-home draws, the marker band and supplement packets.
- **Plans** (`/plans`): from 1100 px wide, the Free and Plus cards sit side by side above the comparison table `Compare Free and Plus`. At 1024x768 and 768x1024 the two plan cards sit in two columns, with the comparison table full width below them. At 375x812 everything is one column and the Join Plus bar is fixed to the bottom. These layouts switch exactly at 1100 px and at 600 px (two columns from 600 px up to 1099 px, one column below 600 px), never at 1024 or 768. Below the cards sit the state check and a link to the marker catalog.
- **Marker catalog** (`/markers`): a search field, then the six category accordions in a single column at every width.
- **Member pages**: a `navigation "Member"` bar with Home, Membership, Draws, Results, Plan, Messages, Records and Account (at 375 it is a top bar with a `button "Menu"` that opens a sheet). Content sits in rounded white cards on the 12-column grid: one column below 768 px, two columns from 768 px on Home, a single column on Results.
- **Staff pages**: a `navigation "Desk"` with the links each role may use, plus the staff nav controls from the controls table. Member record pages show the member's details card and sections for membership, draws, results, plan, blend and messages.
- **Draw calendar** (`/staff/calendar`): from 1100 px wide it shows a week (Monday to Saturday columns, rows in Phoenix time). Below 1100 px it shows one day with previous and next day buttons.
- **Results** (`/me/results`, `/staff/members/<memberId>/results`): one full-width card per marker that has at least one result, grouped by category in catalog order, each holding one marker band.
- **Blend builder**: from 1100 px wide the ingredient catalog sits on the left and the Morning and Evening packets sit side by side on the right, with prices beneath. Below 1100 px the catalog is stacked above the packets. At 375x812 the catalog opens in a bottom sheet from `button "Ingredient catalog"`, and the packets stack.
- **Visit page** (`/visit/<token>`): a single touch-first column at every width: the heading, the draw time, the address card, the kit code field and list, and a fixed bottom bar with Mark collected. This bar stays fixed at every width, the one exception to the rule above that a main action joins the normal flow from 768 px.
- **Receipts** (`/staff/receipts`, `/me/records`): a table that scrolls sideways inside its own frame below 768 px.

### Public screens and controls (DP-04, DP-07, DP-10, DP-15, DP-20, DP-24, DP-30, DP-36, DP-40, DP-44, DP-48, DP-52, DP-57)

Only these controls and regions are public. Everything else is free. Every screen also has the `status` live region named `Announcements` (polite), and every form error also appears in a `region "Problems"`.

| Screen | Role and accessible name | Visible copy or content |
|---|---|---|
| all | `status "Announcements"` | the exact copies from Feedback states |
| all forms | `region "Problems"` containing one link per field error | each link reads the field error and moves focus to its field |
| all | `link "Sign in again"` inside Announcements, when a session ended; while a dialog is open the same link also sits inside that dialog, so it stays reachable | leads to `/signin` |
| public header | `banner` with `data-state` of `top` or `solid` | brand |
| public header | `button "Explore"` (marked expanded when open), `navigation "Explore"` holding four tile links `link "Marker band"`, `link "At-home draws"`, `link "Supplement packets"`, `link "Plans"` | each tile has a procedural glyph and one line of copy |
| home | `region "Lab partners"` (focusable: the region itself is one Tab stop) | Saguaro Diagnostics, Mesa Clinical Labs, Copperline Pathology, Bluebird Assay Partners, Red Rock Reference Lab, Palo Verde Analytics |
| plans | `radiogroup "Billing cadence"` with `radio "Every 6 months"` and `radio "Yearly"` | |
| plans | Plus price with `data-part="price"` and per-month line with `data-part="per-month"` | `$749.95 every 6 months`, `$124.99 a month` or `$1,274.92 a year`, `$106.24 a month` |
| plans | `table "Compare Free and Plus"` | rows: At-home blood draws (Free: None; Plus: Two a year), Results on the marker band (Free: No; Plus: Yes), Written longevity plan (Free: No; Plus: Yes), Custom supplement blend (Free: No; Plus: Yes, member price), Care messages (Free: No; Plus: Yes), Marker catalog (Free: Yes; Plus: Yes) |
| plans | `button "Join Plus"`, `link "Create a free account"` in the Free card | Join Plus leads a signed-out visitor to `/join` and a signed-in member to `/me/membership` |
| plans | `combobox "Your state"`, `button "Check state"` | answer shown below and announced |
| catalog | `searchbox "Search markers"` | |
| catalog | six accordion headers `button "Metabolic"`, `button "Heart"`, `button "Hormones"`, `button "Kidney and liver"`, `button "Nutrients"`, `button "Inflammation and blood"`, each controlling a `region` of the same name | markers as list items with unit |
| join | `textbox "Full name"`, `textbox "Email"`, `textbox "Password"`, `textbox "Date of birth"`, `radiogroup "Sex"` (`radio "Female"`, `radio "Male"`), `combobox "Home state"`, `combobox "Local time"` with options `New York time`, `Chicago time`, `Denver time`, `Phoenix time`, `Los Angeles time`, `button "Create account"` | |
| sign-in | `textbox "Email"`, `textbox "Password"`, `button "Sign in"` | |
| member nav | `button "Sign out"`; at 375 `button "Menu"` opening `dialog "Menu"` (the sheet holding the member navigation and Sign out) | |
| staff nav (every staff screen) | `button "Change password"` opening the same `dialog "Change password"` as the account screen, and `button "Sign out"` | |
| membership | `dialog "Join Plus"` with `radiogroup "Billing cadence"` and `button "Confirm and join"` | |
| membership | `button "Change cadence"` opening `dialog "Change cadence"` with `radiogroup "Billing cadence"` and `button "Confirm change"` | |
| membership | `button "Cancel Plus"` opening `dialog "Cancel Plus"` with `button "Yes, cancel Plus"` and `button "Keep Plus"` | |
| membership | status line with `data-part="membership-state"` | `Free`, `Plus · Pending`, `Plus · Active`, `Plus · Ending`; plus one of `Renews <date>`, `<cadence label> from <date>`, `Plus until <date>` |
| draws (staff and member) | `dialog "Book draw"` with `combobox "Member"` (staff, when opened from the calendar), `combobox "Phlebotomist"`, `textbox "Date"`, `radiogroup "Time"` (one `radio` per slot, named `<HH:MM> <city> time`), `button "Book draw"` | |
| member draw | `button "Move draw"` opening `dialog "Move draw"` (same date, time and button `Move draw`), `button "Cancel draw"` opening `dialog "Cancel draw"` with `button "Yes, cancel this draw"` | |
| calendar | `button "Previous day"`, `button "Next day"` (day view), `button "Previous week"`, `button "Next week"` (week view); each draw is a `link` named by its staff time line | `<date>, <HH:MM> Phoenix time · <HH:MM> <city> time` |
| staff draw | `button "End visit page"`, `button "Send new visit page"`, `button "Bring in results"`, `button "Release results"` | |
| staff draw | `dialog "Bring in results"` with file inputs `Results file` and `Report PDF`, `button "Preview"`, `region "Preview rows"` (focusable) holding `table "Preview"` with columns Row, Kit code, Marker, Value, Unit, Status, Reason, and `button "Save results"` | |
| visit page | `textbox "Kit code"`, `button "Add kit code"`, `list "Kit codes"`, `button "Mark collected"`, `region "Address"` | |
| results | one `region "<marker name>"` per marker card; inside: the band with zone elements `data-part="zone"` and `data-zone` of `below`, `inRange`, `optimal`, `above`; the dot `data-part="dot"`; the value `data-part="value"`; the flag label; the trend line `data-part="trend"` | value with decimals and unit, flag label |
| results | `listbox "Draws for <marker name>"` with one `option` per collected draw named `<date>`, each with `data-state` of `selected`, `earlier` or `later` and `data-at` of its collected instant | |
| results | `dialog "Draw on <date>"` (the detail popover) | collected time in the reader's time, value, flag, range in force, specialist note, correction line |
| staff results | `button "Correct value"` on each marker card, opening `dialog "Correct value"` with `textbox "Value"`, `textbox "Note"`, `button "Save correction"` | |
| ranges | `button "Change ranges"` opening `dialog "Change ranges"` with `combobox "Marker"`, `textbox "Takes effect on"`, six rows of `textbox` fields named `Low, <sex label> <age band label>`, `High, …`, `Optimal low, …`, `Optimal high, …`, `button "Save ranges"` | |
| plan | `button "Edit plan"` opening `dialog "Edit plan"` with `textbox "Nutrition"`, `textbox "Movement"`, `textbox "Sleep"`, `textbox "Supplements notes"`, `button "Save draft"`, `button "Publish plan"` | |
| plan | `list "Earlier plans"` of links named `Published <date> by <name>` | |
| member plan | byline | `Published <date> by <name>` |
| blend | `region "Ingredient catalog"` with `button "Add <ingredient name>"` per ingredient; `region "Morning packet"`, `region "Evening packet"`; `spinbutton "Capsules a day, <ingredient name>"`; `button "Remove <ingredient name>"`; `button "Save blend"` | packet count `<n> of 4 capsules`; `30-day list price $<amount>`; `Member price $<amount>` |
| blend at 375 | `button "Ingredient catalog"` opening `dialog "Ingredient catalog"` (bottom sheet) with a `button "Close"` | |
| messages (member) | `log "Messages"`, `textbox "Message"`, file input `Attachment`, `button "Send message"` | counter `<n> of 2,000 characters` |
| messages (staff) | `log "Messages"`, `textbox "Reply"`, file input `Attachment`, `button "Send reply"`, `button "Mark handled"` | |
| records | `button "Download results history"`, `region "Receipts table"` (focusable) holding `table "Receipts"` | |
| receipts (staff) | `textbox "Month"` (YYYY-MM; the list follows it as soon as a complete month is typed or Enter is pressed), `region "Receipts table"` (focusable) holding `table "Receipts"` with columns Receipt, Member, Paid, Amount, `button "Next page"` | |
| account | `textbox "Phone"`, `textbox "Address line 1"`, `textbox "Address line 2"`, `textbox "City"`, `textbox "ZIP code"`, `textbox "Gate notes"`, `button "Save profile"`; `button "Change password"` opening `dialog "Change password"` with `textbox "Current password"`, `textbox "New password"`, `button "Save password"`; `button "Close account"` opening `dialog "Close account"` with `button "Yes, close my account"` and `button "Keep my account"` | |
| staff member record | `button "Bring back account"` (owner, closing accounts); account state label `Active`, `Closing`, `Erasing` or `Erased` | |
| staff members | `button "Add member"` opening `dialog "Add member"` (fields as the member create body) and `button "Save member"` | |

Every date textbox (`Date`, `Date of birth`, `Takes effect on`) is a plain text field that takes the date typed as `YYYY-MM-DD`, and the `Month` textbox takes `YYYY-MM`. The server answers a date in any other form with 422 on that field (`Enter the date as YYYY-MM-DD.`, or for the month the copy in API).

Option labels shown next to API values:

| API field | Value → label |
|---|---|
| cadence | `sixMonths` → Every 6 months; `yearly` → Yearly |
| sex | `female` → Female; `male` → Male |
| timeZone | `newYork` → New York time; `chicago` → Chicago time; `denver` → Denver time; `phoenix` → Phoenix time; `losAngeles` → Los Angeles time |
| flag | `belowRange` → Below range; `inRange` → In range; `optimal` → Optimal; `aboveRange` → Above range |
| draw state | `booked` → Booked; `collected` → Collected; `ready` → Ready; `released` → Released; `cancelled` → Cancelled |
| packet time | `morning` → Morning; `evening` → Evening; `split` → Split |
| account state | `active` → Active; `closing` → Closing; `erasing` → Erasing; `erased` → Erased |
| membership state | `free` → Free; `pending` → Plus · Pending; `active` → Plus · Active; `cancelled` → Plus · Ending |
| role | `owner` → Practice owner; `specialist` → Longevity specialist; `coordinator` → Care coordinator; `billingLead` → Billing lead; `member` → Member |
| ageBand | `age18To39` → 18–39; `age40To59` → 40–59; `age60Plus` → 60 and over |
| visit page state | `live` → Live; `ended` → Ended; `none` → None |
| plan state | `draft` → Draft; `published` → Published |
| thread state | `open` → Open; `handled` → Handled |
| station data-state | `selected`, `earlier`, `later` (not shown as text) |

Display formats on every screen: a date is `Mon 15 Mar 2027`. A date-time is `Mon 15 Mar 2027, 07:20 Denver time`, naming the city of the zone shown. Money is `$1,274.92`. A result value carries the marker's decimals and unit, for example `22.5 ng/mL`. Staff screens show times, and dates taken from an instant, in Phoenix time. Member screens show times, and dates taken from an instant, in the member's own local time. A receipt's paid date is the one exception: it is the Phoenix date on every screen. A staff screen showing a draw shows both, as `<date>, <HH:MM> Phoenix time · <HH:MM> <city> time` (for a Phoenix-time member, the Phoenix time once).

### Interactions (DP-04, DP-07, DP-10, DP-15, DP-20, DP-30, DP-34, DP-36, DP-39, DP-40, DP-44, DP-57)

- **Cadence toggle.** Arrow keys move between the two radios, and Space or a tap picks one. The Plus price and the per-month line then roll to the new values, as described in Motion and effects.
- **State check.** Pick a state and press Check state. The answer from the server appears below the control and in Announcements.
- **Catalog accordions.** Enter, Space, a click or a tap on a header opens or closes its panel. Several can be open at once. Each open or close is one history entry, with the open categories in the address as `?open=<category ids comma-separated>`. Typing in the search field updates `?q=<text>` and filters markers in place after a 300 millisecond pause with no typing. Each settled search is one history entry. Back and Forward restore the open categories, the search text and the results. When an earlier search request answers after a later one, its answer is dropped. Category ids are `metabolic`, `heart`, `hormones`, `kidneyLiver`, `nutrients`, `inflammationBlood`.
- **Mega menu.** Explore opens on click, tap, Enter or Space and closes on Escape, a second press, a click outside, or moving focus out of it. On close, focus returns to Explore. A pointer of type mouse also opens it after resting on Explore and closes it on leaving the button and the panel. A touch pointer opens it only on tap.
- **Header.** Transparent at the top. Once the page has scrolled 24 px or more it turns solid with a soft blur behind it (`data-state="solid"`), and it turns back below 24 px.
- **Partner strip.** It scrolls the partner names in a continuous loop, pauses while a mouse pointer is over it or while it holds focus, and resumes when both end.
- **Dialogs and sheets.** Opening one moves focus to its first field (or to its first button when it has no field). Tab and Shift+Tab wrap inside it. Escape or its Close button closes it, and a tap outside closes a bottom sheet. Closing returns focus to the control that opened it at once. When that control is gone after the action, focus moves to the screen's level-one heading. A dialog the server refused stays open as typed, with focus on the refusal message inside it.
- **Problems summary.** After a refused form outside a dialog, focus moves to the Problems region. Each link moves focus to its field. Inside a dialog, the field errors sit next to their fields and focus moves to the message.
- **Book draw.** Pick the phlebotomist (only those serving the member's state are listed) and the date, then choose one radio in Time (the slots that are free) and press Book draw. When the slot was just lost, the dialog stays open and the slot list re-reads.
- **Visit page.** Typing a kit code and pressing Enter or Add kit code adds it in upper-case dashed form. Mark collected sits in the bottom bar and records the collection. Every control is at least 44 px in both directions. A focused field is scrolled fully into view between the top of the screen and the bottom bar.
- **Marker band.** Stations run from the oldest draw to the latest, left to right (top to bottom when stacked at 375).
  - When the band opens, the latest draw's station is selected. A refresh keeps the selection, and a newly released draw is added as a new latest station without moving it.
  - The station row is one Tab stop: Tab lands on the selected station.
  - Left (and at 375 also Up) selects the next earlier draw. Right (and at 375 also Down) selects the next later draw. Neither wraps at either end.
  - Home jumps to the oldest draw and End to the latest. A click or tap selects a station. Enter, or a second tap on the selected station, opens its detail popover. Escape or Close closes it and focus returns to the station. The popover is placed so it is fully inside the viewport at 375 and at 1280 wide.
- **Edit plan.** The dialog opens with the member's latest published plan text, or the open draft if one exists. Save draft keeps it as a draft, and Publish plan publishes. Pressing Edit plan again while the dialog is still closing reopens it, and it stays open.
- **Blend builder.** Add puts an ingredient in at its default of 1 capsule a day. The spinbutton changes capsules a day with arrows or typing. Within one second of each change, the packets and prices refresh from the server's preview. Save blend saves. When a preview or Save blend answers `packet_full`, the packet-full copy appears as text in the screen's `region "Problems"` (with no link, since it names no field) and in Announcements. After Save blend, focus moves to that Problems region. After an automatic preview, focus stays on the spinbutton being typed in. At 375 the catalog's bottom sheet closes after each Add and returns focus to `button "Ingredient catalog"`.
- **Messages.** The character counter counts code points the way the server does. Send message posts the message, and the box is cleared after a success. A reply arriving in the refresh appears in the log without moving focus or clearing the box.
- **Session ended.** When any request answers 401 `session_ended`, the screen keeps every typed value and any open dialog, and Announcements shows the session-ended copy with `link "Sign in again"` (also inside the open dialog, if there is one). After signing in, the app returns to the same address, opens the same dialog again and refills the typed values.

### Screen rules (DP-55 and every journey requirement)

Every journey requirement that ends "and its screen meets the screen rules" means these rules, checked on that workflow's own screen and its own endpoints.

- **SR1.** Every staff screen, member page and the visit page re-reads its data from the server every 5 seconds while open. A refresh changes only what changed, in place. Focus stays on the same control. An open dialog, sheet or popover stays open with what was typed. An open accordion stays open, an expanded row stays expanded, and the scroll position stays.
- **SR2.** Closing a dialog, sheet or popover (Escape, its Close button, or a tap outside a sheet) returns focus to the control that opened it at once. The page behind is usable at once while the closing animation still runs. Pressing that control again during the closing animation opens it again, and no leftover close timer may undo that.
- **SR3.** Under reduced motion every dialog, sheet, menu, popover and accordion opens and closes at once. A closed one is gone from the screen and from the accessibility tree within 100 milliseconds. Every loop stops, and every sequence shows its end state at once, through the same code path that runs the animation.
- **SR4.** At 375x812 the box of every control is at least 44 by 44 CSS pixels. This covers buttons, links (including links in list rows and table cells), form fields, menu items and accordion headers, and for a radio or checkbox the box of its label. Links inside a sentence of running text are the only exception.
- **SR5.** An automated WCAG 2.2 AA check (axe-core with the tags wcag2a, wcag2aa, wcag21aa, wcag22aa) reports no violation on every screen at 375x812 and 1280x800. It runs once with each dialog or sheet the screen offers at that size open, and once with all of them closed. A wide table at 375 scrolls sideways inside its own frame, and that frame takes keyboard focus and has an accessible name.
- **SR6.** At 375x812 each screen's main action (named in the screens table) sits in a bar fixed to the bottom. A control that receives focus by Tab or tap is scrolled fully into view between the top bar and the bottom bar.
- **SR7.** All motion uses the browser's own style transitions and keyframe animations, or its built-in Web Animations interface, with exactly the durations published in Motion and effects. Frames are never timed by script, and no other duration is used, including library defaults. This covers styles declared for any state, such as hover and focus.
- **SR8.** Every Tab stop shows a visible focus ring. Every dialog and sheet keeps Tab and Shift+Tab inside it (a native dialog element alone does not), closes on Escape and returns focus to its opener.
- **SR9.** A closed accordion panel, menu, sheet or popover is hidden and inert. Its controls leave the Tab order the moment it starts closing, and it leaves the accessibility tree when its closing animation ends. Collapsing to zero height or moving off-screen does not count as closing.
- **SR10.** Pointer and touch behaviour follow each event's own pointer type, never hover or pointer media queries. Every control works the same for a mouse pointer and a touch pointer in the same browser.
- **SR11.** The workflow's own endpoints follow the API conventions. A request to its main write endpoint that breaks two published rules at once answers the earlier rung of the error-precedence ladder (for example, an oversized body sent without a session answers 413 as JSON). Every instant in its responses is UTC in whole seconds with a `Z`. On a workflow that signs in, the session cookie has exactly the attributes published under Server boundary.

### Visual design (DP-59)

- **Colour.** A pale sky-blue page ground, deep navy ink for text, pure white surfaces for cards, a strong cobalt blue for actions, links and focus rings, and a deep pine green for the Optimal zone. Below range and Above range use a muted warm amber, and In range uses a soft blue. Every zone also carries its text label, so colour never carries meaning alone. Every text and control meets WCAG 2.2 AA contrast.
- **Type.** Fraunces, an optical-size serif, for headings and large numerals. Figtree for body text, with figures of equal width (tabular) for every value, price, kit code and time, so columns of numbers line up. Each heading level is about a third larger than the level below it, so the main page heading is roughly two and a half times the body size. Inter is never used.
- **Density and shape.** Airy: generous space in steps of 8, 16, 24, 40 and 80 px. Cards are white with large rounded corners (24 px) and one soft, diffuse shadow, with no hard dividing lines. The layout is a 12-column grid with 24 px gutters.
- **Imagery.** All imagery is generated: soft cloud and gradient fields behind every hero, and simple line glyphs for markers, tubes, packets and capsules, drawn as SVG by the app. The only other images are files the practice or members upload.
- **Composition.** The header floats transparent over the hero and turns solid on scroll. The mega menu shows four illustrated tiles. Results are full-width cards, each with one marker band as the main visual: a long rounded track split into its zones, a single round dot at the value, large Fraunces numerals beside it, and the station row beneath. The visit page is one touch-first column with a fixed bottom action bar.
- **Touch targets.** Every control is at least 44 px in both directions at 375x812 (SR4).

### Motion and effects (DP-33, DP-08, DP-04, DP-07, DP-55)

Motion has exactly three published durations: **short, 160 milliseconds**; **medium, 320 milliseconds**; **long, 640 milliseconds**. The partner strip adds one more: **one full pass every 64 seconds**. All motion starts briskly and eases softly into place, with the same easing everywhere.

- **Dialogs and popovers** fade and rise slightly on open and fade on close (short). The draw detail popover fades in (short).
- **Bottom sheets** slide up from the bottom edge on open and back down on close (medium).
- **Mega menu** fades and drops slightly into place (short).
- **Accordions** open and close by growing and shrinking their height to the panel's content (medium).
- **Header** changes from transparent to solid with blur (short).
- **Plan price roll**: when the cadence changes, the old price and per-month line slide up and out while the new ones slide up into place, each medium, both starting in the same frame.
- **Partner strip**: names drift sideways in a seamless loop, one full pass every 64 seconds. It pauses while hovered by a mouse or focused.
- **Marker band**: selecting another station starts all of the following in the same frame, none waiting for another.
  1. The same dot element slides along the band to the new value, anywhere from the band's left end to its right end (medium). The dot is moved, never removed and redrawn.
  2. The numerals roll: the old value slides up and out while the new value slides up into place (medium each).
  3. When that draw's ranges differ from the previously selected draw's, each zone boundary glides from the old bound's position to the new one (long).

  When newly released results arrive in the refresh of an open screen, the newest trend segment draws itself from the previous station to the new one (long). A screen opened later shows the trend line complete. Station states (`data-state`, `data-at`), values and flags are set at once and never wait for an animation.
- **No other motion.** There are no decorative loops other than the partner strip, and no motion beyond what is listed here.
- **Reduced motion.** When the person asks for reduced motion, everything above happens at once. Dialogs, sheets, menus, popovers and accordions open and close instantly. The partner strip stops. The price, dot, numerals and zones jump to their end state, and the trend line shows complete. All of this runs through the same code path as the animation and leaves the same final page state, so a reading never depends on the animation.

### Feedback states (DP-01, DP-06, DP-09, DP-10, DP-14, DP-15, DP-17, DP-19, DP-21, DP-22, DP-23, DP-24, DP-28, DP-29, DP-32, DP-35, DP-36, DP-38, DP-41, DP-44, DP-47, DP-49, DP-52, DP-53, DP-54, DP-57)

Every async action shows a pending state: its button is disabled and Announcements reads `Working on it.`. When the action ends, Announcements reads the action's own copy below. Announcements and Problems summaries stay until the person's next action. All copy renders character for character, with straight apostrophes, the published dashes (`—` em dash, `–` en dash, `·` middle dot) and the published case. API error messages carry the same copy.

Placeholders: `<date>` is a date as `Mon 15 Mar 2027`. `<HH:MM>` is a 24-hour time. `<city>` is the city of the zone shown, as follows.
- On a staff screen, a single time uses `Phoenix`.
- Slot times (the `Time` radio names in Book draw and Move draw, and the slot-lost copy) use the member's city, on staff screens too. So does the second time of every two-time form (`<HH:MM> Phoenix time · <HH:MM> <city> time`).
- Member screens always use the member's city.
- For a Phoenix-time member, every two-time form shows the Phoenix time once, in copies as on screens. `<State name>` is the full state name. `<winner>` is the full name of the staff member whose booking won, or `a member` when the winning booking was a member's own. `<name>` is a staff member's full name. `<marker>` is the marker's display name. `<first name>` is the member's first name. `<phlebotomist>` is the phlebotomist's full name. `<cadence label>` is `Every 6 months` or `Yearly`.

| Action or state | Copy |
|---|---|
| sign-in refused (unknown email, wrong password, removed staff, erased member) | `That email and password don't match.` |
| session ended mid-form | `Your session ended. Sign in again to keep going — what you typed is still here.` |
| state check, served | `Yes — we serve members in <State name>.` |
| state check, not served (also the sign-up refusal) | `Not yet — we can't serve members in <State name>.` |
| account created | `Your free account is ready.` |
| joined, Kill Bill confirmed | `Welcome to Plus. Your membership is active.` |
| joined, confirmation still pending | `Your payment is being confirmed. Plus shows Active once it is.` |
| cadence change saved | `Your cadence changes at your next renewal.` |
| cancel saved | `Plus stays until the end of your paid period.` |
| membership lines | `Renews <date>`; `<cadence label> from <date>`; `Plus until <date>` |
| Kill Bill unreachable | `Payments are unavailable right now. Nothing was charged.` |
| draw booked (staff) | `Draw booked for <date>, <HH:MM> Phoenix time · <HH:MM> <city> time.` |
| draw booked (member) | `Draw booked for <date>, <HH:MM> <city> time.` |
| draw moved | `Draw moved to <date>, <HH:MM> <city> time.` (staff: the two-time form) |
| draw cancelled | `Draw cancelled.` |
| slot lost (staff) | `That slot was just taken by <winner>. The next free slot is <date>, <HH:MM> <city> time.` (`<city>` is the member's city) |
| slot lost (member) | `That slot was just taken. The next free slot is <date>, <HH:MM> <city> time.` |
| draw refused, no Plus on that date | `Draws are part of Plus.` |
| member change after cutoff | `Changes closed at <date>, 18:00 <city> time. Message your care team to change this draw.` (the member's city) |
| member has no address | `Add your home address before booking a draw.` |
| visit page ended by coordinator | `Visit page ended.` |
| new visit page sent | `A new visit page is on its way to <phlebotomist>.` |
| visit page ended (page and 410 body) | `This visit page has ended.` |
| address before the draw day | `Address shown on the visit day.` |
| kit code added | `Kit code <kit code> added.` |
| kit code wrong check character | `That kit code isn't valid. Check the last character.` |
| kit code wrong shape | `Enter a kit code like KT-1000042-7.` |
| Mark collected with no kit code | `Enter at least one kit code before marking collected.` |
| Mark collected before or after the draw day | `You can mark this draw collected on the visit day.` |
| marked collected | `Marked collected at <HH:MM> <city> time.` (the member's city) |
| results preview | `<m> matched, <u> unknown, <r> refused. Nothing is saved yet.` |
| results saved, report stored | `Results saved and the report is stored.` |
| MinIO unreachable | `The report store is unavailable right now. Nothing was saved.` |
| results released | `Results released. A notice is on its way to <first name>.` |
| release before Ready | `Results can be released once the report is stored.` |
| ranges saved | `New ranges for <marker> take effect on <date>.` |
| second change for one marker and date | `Ranges for <marker> already change on <date>.` |
| correction saved (staff) | `<marker> corrected.` |
| correction arrives on an open band (and the correction line on the card) | `<name> corrected <marker> at <HH:MM> <city> time. The band shows the corrected value.` (Phoenix on staff screens, the member's city on member screens) |
| plan draft saved | `Draft saved.` |
| plan published | `Plan published.` |
| plan byline | `Published <date> by <name>` |
| newer plan published meanwhile | `<name> published a newer plan at <HH:MM> Phoenix time. Your changes are still here.` |
| blend saved | `Blend saved.` |
| packet over 4 capsules | `The morning packet holds at most 4 capsules.` or `The evening packet holds at most 4 capsules.` (the morning copy when both overflow) |
| message sent | `Message sent.` |
| reply sent | `Reply sent.` |
| thread marked handled | `Thread marked handled.` |
| 11th message in the window | `Too many messages for now. You can send another at <HH:MM> <city> time.` |
| 6th download in the window | `Too many downloads for now. You can download again at <HH:MM> <city> time.` |
| download started | `Your results history is downloading.` |
| account closing (copy and the account screen) | `Your account is closing. It will be erased at <date>, <HH:MM> <city> time unless the practice brings it back.` |
| writing to a closing account | `This account is closing.` |
| account brought back | `<member name>'s account is back.` |
| restore after the wait | `This account is already being erased.` |
| erased member name on receipts and lists | `Erased member` |
| profile saved | `Profile saved.` |
| password changed | `Password changed. Your other sessions have ended.` |
| not-found screen | `We can't find that page.` |

In the rate-limit copies, `<HH:MM>` is the Retry-After instant in the member's local time, rounded up to a whole minute (an instant already on a whole minute stays as it is). Field error copies are listed with their fields in Business rules and API. The copies for size limits are listed in Server boundary.

## Backend

### API (DP-01, DP-02, DP-05, DP-06, DP-07, DP-09, DP-11, DP-12, DP-13, DP-17, DP-18, DP-19, DP-21, DP-22, DP-23, DP-25, DP-26, DP-27, DP-29, DP-31, DP-32, DP-35, DP-37, DP-38, DP-41, DP-42, DP-45, DP-46, DP-47, DP-49, DP-50, DP-51, DP-53, DP-54, DP-56, DP-57)

Conventions:

- Every JSON key in every request and response is camelCase, nested keys included. Every enum value is a published camelCase word (see the option labels table). US states are lower-case two-letter codes such as `co`.
- Every instant is UTC in whole seconds with a `Z` (`2027-03-15T13:00:00Z`, never milliseconds). Local dates are `YYYY-MM-DD` and local times are `HH:MM`.
- Money is integer cents in fields ending `Cents`. Result values and range bounds are decimal strings with the marker's decimals (`"22.5"`).
- Ids are opaque strings, generated afresh in each practice copy.
- JSON request bodies need `Content-Type: application/json`. Upload endpoints need `multipart/form-data`.
- Every error body is `{"error": {"code": "<code>", "message": "<copy>", "fields": {"<field>": "<copy>"}}}`. The `fields` key appears only for field errors, and always inside `error`.

Error-precedence ladder. It is the only precedence rule, and it covers every endpoint. Each request is judged by the first rung it fails:

1. Unknown route under `/api` → 404 `not_found`. Wrong method on a known route → 405 `method_not_allowed` with an `Allow` header.
2. Body over its published size limit → 413 `too_large`. This is decided from the declared length, or while the body streams, before it is otherwise parsed and before authentication. A file part over its own file limit also answers here, measured as the part streams (see Server boundary). It is always answered as JSON, never as a dropped connection.
3. Rate limit → 429 `rate_limited` with `Retry-After`. It applies only to a request with a valid session, keyed on that person.
4. Authentication → 401 `not_signed_in` (no cookie) or 401 `session_ended` (a cookie whose session the server has ended). Visit page endpoints need no session.
5. Unknown resource → 404 `not_found`. An id in the path, the query or the body that does not exist as that route's resource answers 404 to every signed-in caller, whatever their role. A removed staff member's id counts as not existing, and so do the draws, results, plans, blends and messages of an erased member. On a route the caller's role may use, an id that is not theirs to see (another member's draw, receipt, attachment or message) answers exactly like an unknown id. In a body or query this covers `memberId` and `phlebotomistId` (slot reads, draw lists, booking and moving draws) and `basedOnPlanId` (plans). A catalog choice inside a body (`marker`, `ingredient`) is a field error at rung 10 instead. An ended visit page answers 410 `visit_page_ended`.
6. Role → 403 `forbidden`, for a caller outside the route's allowed roles, on a route without an id or with ids that exist.
7. Content type → 415 `unsupported_media_type`.
8. Malformed JSON or multipart → 400 `bad_request`.
9. A repeated `Request-Key`: the same key with the same body replays the stored status and body. The same key with a different body → 409 `request_key_reused` (message `This request key was already used for a different request.`).
10. Field validation → 422 `invalid` with `fields`.
11. State → 409 with the endpoint's code.
12. Stale edit → 412 `stale`.

A provider outage (503) is decided only after every rung above has passed.

Roles per endpoint group:

| Group | Allowed roles |
|---|---|
| `/api/staff*` | owner |
| `POST /api/members`, `/api/members/<id>/restore`, `POST /api/range-changes` | owner |
| `GET /api/members`, `GET /api/members/<id>` | all staff (the billing lead gets the billing projection) |
| draws, slots, visit pages (staff side) | owner, coordinator |
| `GET /api/draws?state=…`, `GET /api/draws?memberId=…` | owner, specialist, coordinator |
| results files, reports, `POST /api/draws/<id>/results` | owner, coordinator, specialist |
| release, corrections | owner, specialist |
| plans and blends (staff side), `GET /api/ingredients` | owner, specialist |
| staff results and messages | owner, specialist, coordinator |
| `GET /api/draws/<id>` | owner, specialist, coordinator |
| receipts list | owner, billingLead |
| `/api/me*` except `/api/me/password` | member (staff answer 403) |
| `POST /api/me/password` | every signed-in person, staff and members |

Every other role answers 403 at rung 6, after rung 5 has looked up every id in the request. So a member or a non-owner calling a staff endpoint answers 403, except that an unknown or removed id answers 404 first.

**Public and session**

- `GET /api/health` → 200 `{"status":"ok"}`.
- `GET /api/plans` → 200 `{"plans":[{"id":"free","name":"Free","prices":[]},{"id":"plus","name":"Plus","prices":[{"cadence":"sixMonths","months":6,"amountCents":74995,"perMonthCents":12499},{"cadence":"yearly","months":12,"amountCents":127492,"perMonthCents":10624}]}]}`.
- `GET /api/states` → 200 `{"states":[{"state":"al","name":"Alabama","served":true}, …]}` for all 50 states. `GET /api/states/<code>` → 200 `{"state":"co","name":"Colorado","served":true,"message":"<state check copy>"}`. Unknown code → 404.
- `GET /api/markers?q=<text>` → 200 `{"categories":[{"id":"nutrients","name":"Nutrients","markers":[{"id":"vitaminD","name":"Vitamin D","unit":"ng/mL","decimals":1}]}]}`. Categories and markers come in catalog order. `q` matches marker names and aliases, ignoring case and punctuation, and categories with no match are left out.
- `POST /api/accounts` example body: `{"name":"Ava Torres","email":"ava.torres@example.com","password":"long-enough-pass","dateOfBirth":"1990-04-12","sex":"female","state":"co","timeZone":"denver"}` → 201 `{"member":<member self>}` with the session cookie set and the person signed in. Errors: 422 on `name` (`Enter your full name.`), `email` (`Enter a valid email address.`), `password` (`Use at least 12 characters.`), `dateOfBirth` (`Members must be 18 or older.`), `state` (the not-yet state copy), `sex` or `timeZone` (`Choose one of the options.`). 409 `email_taken` (`An account with this email already exists.`).
- `POST /api/session` example body: `{"email":"dana.ruiz@ocotillo.example","password":"desk-pass-2027"}` → 200 `{"user":{"id":"…","name":"Dana Ruiz","role":"coordinator"},"home":"/staff/calendar"}` and sets the cookie. A wrong password, an unknown email, a removed staff member or an erased member → 401 `sign_in_failed` with the sign-in copy. All four are identical in status and body.
- `GET /api/session` → 200 `{"user":{…},"home":"…","expiresAt":"…Z"}`. `DELETE /api/session` → 204, after which that cookie answers 401 `session_ended`.
- `POST /api/me/password` (any signed-in person) example body: `{"currentPassword":"desk-pass-2027","newPassword":"a-new-long-pass"}` → 204. It ends every other session of that person and keeps this one. 422 on `currentPassword` (`That password isn't right.`) or `newPassword` (`Use at least 12 characters.`).

**Staff (owner only)**

- `GET /api/staff` → 200 `{"staff":[{"id","name","email","role"}]}`.
- `POST /api/staff` example body: `{"name":"Rae Kim","email":"rae.kim@ocotillo.example","password":"starting-pass-1","role":"coordinator"}` → 201 `{"staff":{"id","name","email","role"}}`. 422 on fields. 409 `email_taken`. `role` is one of `specialist`, `coordinator`, `billingLead`.
- `GET /api/staff/<staffId>` → 200 `{"staff":{…}}`.
- `PATCH /api/staff/<staffId>` example body: `{"role":"specialist"}` → 200 `{"staff":{…}}`. 409 `owner_stays` (`The practice owner stays the owner.`) for the owner's own id.
- `DELETE /api/staff/<staffId>` → 204. It ends that person's sessions. 409 `owner_stays` for the owner.
- A removed staff member's id answers 404 on all of these.

**Members**

- `POST /api/members` example body: `{"name":"Lena Brooks","email":"lena.brooks@example.com","password":"member-pass-2027","dateOfBirth":"1987-03-02","sex":"female","state":"co","timeZone":"denver","phone":"+1 303 555 0100","address":{"line1":"200 Pearl St","line2":"","city":"Denver","postalCode":"80203"},"gateNotes":"Side gate.","cadence":"sixMonths"}` → 201 `{"member":<staff member view>}`. `cadence` may be `null` for a Free member. With a cadence, Plus is started in Kill Bill exactly as a join, and Kill Bill unreachable answers 503 with no member created. 422 on fields as for accounts. 409 `email_taken`.
- `GET /api/members?q=<text>` (`q` is optional and matches names and emails; without it, every member, unpaged, in no set order) → 200 `{"members":[…]}`. `GET /api/members/<memberId>` → 200 `{"member":…}`.
  - Staff member view: `id, name, email, phone, dateOfBirth, sex, state, timeZone, address, gateNotes, accountState, erasesAt, membership`.
  - Billing projection (billing lead): only `id, name, email, accountState, membership`.
  - An erased member shows `name` as `Erased member`, `accountState` `erased`, and `null` for every personal field. `GET /api/members/<memberId>` and `GET /api/members` keep returning an erased member in this redacted view. Only that member's draws, results, plans, blends and messages answer 404.
  - `gateNotes` is `null` when there are none. An empty string in a request is stored as `null`.
- `GET /api/me` → 200 `{"member":<member self>}`, with the same fields as the staff view. `PATCH /api/me` example body: `{"phone":"+1 303 555 0100","address":{"line1":"200 Pearl St","line2":"","city":"Denver","postalCode":"80203"},"gateNotes":"Side gate."}` → 200. 422 on `postalCode` (`Enter a 5-digit ZIP code.`).
- `membership` object: `{"state":"free|pending|active|cancelled","cadence":null|"sixMonths"|"yearly","renewalDate":null|"YYYY-MM-DD","plusUntil":null|"YYYY-MM-DD","pendingCadence":null|"sixMonths"|"yearly","pendingFrom":null|"YYYY-MM-DD"}`. Every date in it is the Kill Bill date in Phoenix time.

**Memberships (member)**

- `GET /api/me/membership` → 200 `{"membership":…}`.
- `POST /api/me/membership` example body: `{"cadence":"yearly"}`, with an optional `Request-Key: <any string up to 100 characters>` header. → 201 `{"membership":…}` (state `active`, or `pending` when Kill Bill has not confirmed within 10 seconds). 409 `already_plus` (`You already have Plus.`). 409 `account_closing`. 503 `payments_unavailable`.
- `PATCH /api/me/membership` example body: `{"cadence":"sixMonths"}` → 200 with `pendingCadence` and `pendingFrom`. 409 `same_cadence` (`You're already on that cadence.`). 409 `not_plus` (`You don't have Plus.`). 503.
- `POST /api/me/membership/cancel` (empty JSON body `{}`) → 200 with state `cancelled` and `plusUntil`. 409 `already_ending` (`Plus is already set to end.`). 409 `not_plus`. 503.

**Slots and draws**

- `GET /api/phlebotomists` → 200 `{"phlebotomists":[{"id","name","states":["az","co"]}]}`.
- `GET /api/slots?memberId=<id>&date=YYYY-MM-DD` (staff) and `GET /api/me/slots?date=YYYY-MM-DD` (member). Both → 200 `{"slots":[{"phlebotomistId","phlebotomistName","localTime":"07:00","startsAt":"…Z","free":true}]}` for the phlebotomists serving the member's state on that member-local date.
- Draw view: `{"id","memberId","memberName","phlebotomistId","phlebotomistName","state","startsAt","localDate","localTime","timeZone","collectedAt","kitCodes":["KT-1000013-6"],"hasResults","changesCloseAt","visitPage":{"state":"live|ended|none","endsAt":null|"…Z"}}`. The member's own view leaves out `memberName`.
- `POST /api/draws` (staff) example body: `{"memberId":"<id>","phlebotomistId":"<id>","date":"2027-03-15","time":"07:00"}`. A past draw also gives `collectedAt` and `kitCodes`, for example for a Denver member once Mon 1 Mar 2027 is past: `{"memberId":"<id>","phlebotomistId":"<id>","date":"2027-03-01","time":"07:00","collectedAt":"2027-03-02T06:30:00Z","kitCodes":["KT-1000042-7"]}` (`collectedAt` is 23:30 Denver time on 1 Mar, the draw's member-local date). → 201 `{"draw":…}`. Errors:
  - 422 on `date` (`Choose a date within 400 days of today.`), `time` (`Choose a slot from the published times.`), `phlebotomistId` (`This phlebotomist doesn't serve <State name>.`), `collectedAt` (`Give the collected time for a past draw.`; also when it does not fall on that member-local date), `kitCodes` (a kit code copy).
  - 409 `plus_required` (`Draws are part of Plus.`).
  - 409 `slot_taken` (the slot-lost copy).
  - 409 `address_required`.
  - 409 `account_closing`.
- `POST /api/me/draws` example body: `{"phlebotomistId":"<id>","date":"2027-03-15","time":"07:00"}` → 201. The same errors apply, but the date window copy is `Choose a date from tomorrow up to 28 days ahead.`.
- `GET /api/draws?from=YYYY-MM-DD&to=YYYY-MM-DD` (owner, coordinator; Phoenix dates, at most 7 days) → 200 `{"draws":[…]}` in start order. `GET /api/draws?state=<draw state>` (owner, specialist, coordinator) → 200 every member's draws in that state, oldest `collectedAt` first (booked and cancelled draws by start), for example `state=ready` for Results to release. `GET /api/draws?memberId=<id>` (owner, specialist, coordinator) → 200 that member's draws, newest start first. A request gives exactly one of `from` with `to`, `state` or `memberId`, else 422 on `from` (`Choose a date range, a state or a member.`). `GET /api/draws/<drawId>` → 200. `GET /api/me/draws` → 200 `{"draws":[…]}`.
- `PATCH /api/draws/<drawId>` (staff) or `PATCH /api/me/draws/<drawId>` (member) example body: `{"date":"2027-03-16","time":"07:20"}` → 200. Only a `booked` draw can move: 409 `not_booked` (`Only a booked draw can change.`). A member at or after the cutoff gets 409 `changes_closed`. Other errors are as for booking.
- `POST /api/draws/<drawId>/cancel` or `POST /api/me/draws/<drawId>/cancel` (body `{}`) → 200 with state `cancelled`. 409 `not_booked`. A member gets 409 `changes_closed`.
- `POST /api/draws/<drawId>/visit-page` (body `{}`) → 201 `{"visitPage":{"state":"live","endsAt":"…Z"}}`. It ends the old address and mails a new one. 409 `not_booked`. 409 `not_upcoming` (`This draw has no visit page to send.`) for a draw before today.
- `DELETE /api/draws/<drawId>/visit-page` → 200 `{"visitPage":{"state":"ended","endsAt":"…Z"}}`.

**Visit page (no session; the token is the capability)**

- `GET /api/visits/<token>` → 200 with exactly these keys: `{"memberName":"Elena M.","startsAt","localDate","localTime","timeZone","isDrawDay","address":null|{"line1","line2","city","state","postalCode"},"gateNotes":null|"…","kitCodes":[…],"state":"booked|collected","collectedAt":null|"…Z","endsAt"}`. Unknown token → 404. An ended token → 410 `visit_page_ended`.
- `POST /api/visits/<token>/kit-codes` example body: `{"kitCode":"kt1000046x"}` → 201 `{"kitCodes":["KT-1000046-X"]}`. A code already on the draw answers 200 with the list unchanged. 422 on `kitCode` (a kit code copy). 409 `already_collected` (`This draw is already collected.`).
- `POST /api/visits/<token>/collect` (body `{}`) → 200 `{"state":"collected","collectedAt":"…Z"}`. 409 `kit_code_required`, 409 `not_draw_day`, 409 `already_collected`.

**Results**

- `POST /api/draws/<drawId>/results-file/preview`: multipart with the part `file` (the results file) → 200 `{"rows":[{"row":2,"status":"matched","kitCode":"KT-1000046-X","marker":"vitaminD","value":"22.5","unit":"ng/mL","source":{"marker":"Vit D, 25-OH","value":"56.125","unit":"nmol/L"}},{"row":3,"status":"unknown","reason":"No marker matches \"Zonulin\"."},{"row":4,"status":"refused","reason":"Value isn't a number."}]}`. Nothing is written. 422 on `file` (`The first row must be kitCode,marker,value,unit.` or `The results file must be UTF-8 text.`). 409 `not_collected` (`Results can be brought in for a collected draw.`).
- `POST /api/draws/<drawId>/results-file`: multipart with the parts `file` and `report` → 201 `{"draw":…,"saved":<n>,"unchanged":<n>}`. Saving the same file and report again → 200 with `saved` 0. Errors: 422 on `file` (as for preview), 422 on `report` (`Attach the lab's report PDF.` or `The report must be a PDF file.`), 409 `not_collected`, 409 `report_exists` (`This draw already has a different report.`), 503 `report_store_unavailable`.
- `POST /api/draws/<drawId>/results` example body: `{"results":[{"marker":"vitaminD","value":"22.5"},{"marker":"ldl","value":"118"}]}`. Values are given in the practice unit. → 201 `{"draw":…}`. 422 on `results.<index>.marker` (`Choose a marker from the catalog.`) or `results.<index>.value` (`Value isn't a number.`). 409 `not_collected`.
- `POST /api/draws/<drawId>/report`: multipart with the part `report` → 201 `{"draw":…}`. The errors are the report errors above.
- `GET /api/draws/<drawId>/report` (staff, and the member for their own released draw) → 200 `application/pdf`, the stored bytes. 404 when the draw has no report.
- `POST /api/draws/<drawId>/release` (body `{}`) → 200 `{"draw":…}` with state `released`. 409 `not_ready`.
- `GET /api/me/results` (released draws only) and `GET /api/members/<memberId>/results` (staff, every draw with results) → 200 `{"markers":[{"marker":"vitaminD","name":"Vitamin D","category":"nutrients","unit":"ng/mL","decimals":1,"scale":{"min":"0.0","max":"130.0"},"draws":[{"drawId","collectedAt":"…Z","resultId","value":"22.5","flag":"belowRange","ageBand":"age18To39","range":{"low":"30.0","high":"100.0","optimalLow":"40.0","optimalHigh":"60.0","effectiveFrom":"2020-01-01"},"note":null|"…","correctedBy":null|"Priya Shah","correctedAt":null|"…Z"}]}]}`. Draws come oldest first.
- `PATCH /api/results/<resultId>` example body: `{"value":"22.9","note":"Re-read from the lab report."}` → 200 `{"result":…}`. 422 on `value`. `GET /api/results/<resultId>/history` (staff) → 200 `{"history":[{"value","note","by","at"}]}`.

**Range table**

- `GET /api/ranges?marker=<id>&on=YYYY-MM-DD` → 200 `{"marker":"ldl","effectiveFrom":"2026-07-01","ranges":[{"sex":"female","ageBand":"age18To39","low":"40","high":"115","optimalLow":"40","optimalHigh":"89"}, …]}` with the six rows in force on that Phoenix date. `GET /api/range-changes` (owner) → 200 `{"changes":[{"id","marker","effectiveFrom","createdBy","createdAt"}]}`.
- `POST /api/range-changes` example body: `{"marker":"ldl","effectiveFrom":"2027-03-15","ranges":[{"sex":"female","ageBand":"age18To39","low":"40","high":"115","optimalLow":"40","optimalHigh":"89"}, …six rows, one per sex and age band…]}` → 201 `{"change":…}`. Errors:
  - 422 on `effectiveFrom` (`Choose today or a later date.`).
  - 422 on `ranges` (`Give all six rows.`).
  - 422 on `ranges.<index>` (`Bounds must run low ≤ optimal low ≤ optimal high ≤ high.`).
  - 409 `ranges_already_change` (the duplicate-change copy).

**Plans**

- Plan view: `{"id","memberId","state":"draft|published","basedOnPlanId":null|"…","sections":{"nutrition","movement","sleep","supplements"},"publishedAt":null|"…Z","publishedBy":null|"<name>","blend":null|<blend view>,"updatedAt"}`. Section text is plain paragraphs separated by blank lines. A line starting with `- ` is a bullet.
- `POST /api/members/<memberId>/plans` example body: `{"basedOnPlanId":"<latest published plan id or null>","sections":{"nutrition":"Build meals around…","movement":"- Walk 30 minutes daily","sleep":"Lights out by 22:30.","supplements":"Take the evening packet an hour before bed."}}` → 201 `{"plan":…}` as a draft. 422 on `sections.<name>` (`Keep each section to 20,000 characters.`). 412 `stale`.
- `PUT /api/longevity-plans/<planId>` (body as above, without `basedOnPlanId`) → 200. 409 `already_published` (`This plan is already published.`). 412 `stale`.
- `POST /api/longevity-plans/<planId>/publish` (body `{}`) → 200 `{"plan":…}`. 409 `already_published`. 412 `stale`.
- `GET /api/members/<memberId>/plans` (staff) → 200 `{"plans":[…]}`, newest first, drafts included. `GET /api/longevity-plans/<planId>` (staff) → 200. `GET /api/me/plan` → 200 `{"plan":null|<latest published plan>}`. The member's plan never includes a draft.

**Blends**

- `GET /api/ingredients` → 200 `{"ingredients":[{"id","name","strength":{"amount":"5000","unit":"IU","mcg":"125"},"time":"morning","priceCentsPerCapsule":9}]}`.
- Blend view: `{"id","memberId","items":[{"ingredient":"omega3","capsulesPerDay":2,"morning":1,"evening":1}],"morningCapsules":3,"eveningCapsules":4,"listPriceCents":2970,"memberPriceCents":2525,"savedBy","savedAt"}`.
- `POST /api/members/<memberId>/blends/preview` and `POST /api/members/<memberId>/blends` share the example body `{"items":[{"ingredient":"vitaminD3","capsulesPerDay":1},{"ingredient":"magnesiumGlycinate","capsulesPerDay":2},{"ingredient":"omega3","capsulesPerDay":2},{"ingredient":"methylB12","capsulesPerDay":1},{"ingredient":"ashwagandha","capsulesPerDay":1}]}`. Preview → 200 `{"blend":…}` without `id`, and nothing is written. Save → 201 `{"blend":…}`. Errors:
  - 422 on `items.<index>.capsulesPerDay` (`Use a whole number of capsules, 1 or more.`).
  - 422 on `items.<index>.ingredient` (`Choose an ingredient from the catalog.` or `Each ingredient appears once.`).
  - 422 `packet_full` with the packet-full copy as the message and no `fields`.
- `GET /api/members/<memberId>/blends` → 200 `{"blends":[…]}`, newest first. `GET /api/me/blend` → 200 `{"blend":null|<current blend>}`.

**Care messages**

- Message view: `{"id","from":{"role","name"},"body","attachment":null|{"id","kind":"pdf|jpeg|png","bytes"},"sentAt"}`.
- `POST /api/me/messages`: multipart with the part `body` and an optional part `attachment` → 201 `{"message":…}`. Errors: 422 on `body` (`Write a message first.` or `Keep your message to 2,000 characters.`), 422 on `attachment` (`Attach a PDF, JPEG or PNG file.`), 429.
- `GET /api/me/messages` → 200 `{"messages":[…]}`.
- `GET /api/message-threads` (staff) → 200 `{"threads":[{"memberId","memberName","state":"open|handled","lastMessageAt"}]}`, open threads first, then oldest first.
- `GET /api/members/<memberId>/messages` → 200. `POST /api/members/<memberId>/messages` (multipart, as the member's) → 201. `POST /api/members/<memberId>/messages/handled` (body `{}`) → 200 `{"thread":{"state":"handled"}}`. A new member message reopens the thread.
- `GET /api/attachments/<attachmentId>` (staff, and the member for their own) → 200 with the cleaned copy for a photo and the stored bytes for a PDF. `GET /api/attachments/<attachmentId>/original` (staff, and the member for their own) → 200 with the original bytes.

**Records and receipts**

- `GET /api/me/results-history` → 200 `text/csv; charset=utf-8`, `Content-Disposition: attachment; filename="ocotillo-results-history.csv"`. 429.
- Receipt list item: exactly `{"id","number","memberName","paidAt","paidDate","amountCents","currency"}`. Receipt view: the list keys plus `{"invoiceId","items":[{"description","periodStart","periodEnd","amountCents"}],"practice":{"name","address","taxNumber"}}`. No receipt response carries a marker, value, flag, plan, blend, address or date of birth of the member.
- `GET /api/receipts?month=YYYY-MM&cursor=<cursor>` (owner, billing lead) → 200 `{"receipts":[…25 at most…],"nextCursor":null|"…"}`. 422 on `month` (`Choose a month as YYYY-MM.`) or `cursor` (`That page link is no longer valid.`).
- `GET /api/receipts/<receiptId>` (owner, billing lead, the member for their own) → 200 `{"receipt":…}`. `GET /api/me/receipts` → 200 `{"receipts":[…]}`, newest first.

**Closing an account**

- `POST /api/me/closure` (body `{}`) → 200 `{"member":…}` with `accountState` `closing` and `erasesAt`. 409 `account_closing`. 503 (when the member has Plus and Kill Bill is unreachable).
- `POST /api/members/<memberId>/restore` (owner, body `{}`) → 200 `{"member":…}` with `accountState` `active`. 409 `not_closing` (`This account isn't closing.`). 409 `erasure_started`. 503 whenever Kill Bill is unreachable, for a Free member's account too, because restore always checks the account with Kill Bill first.
- While an account is closing, every member write other than sign-out and the password change answers 409 `account_closing`.

### Business rules (DP-05, DP-11, DP-12, DP-13, DP-16, DP-17, DP-18, DP-19, DP-21, DP-22, DP-23, DP-25, DP-27, DP-29, DP-31, DP-32, DP-35, DP-37, DP-38, DP-41, DP-42, DP-45, DP-46, DP-47, DP-49, DP-50, DP-51, DP-53, DP-54, DP-57)

**Time.**

- Business time is America/Phoenix, which never changes its clocks.
- Each member's local wall time is one of five zones: `newYork` (America/New_York), `chicago` (America/Chicago), `denver` (America/Denver), `phoenix` (America/Phoenix), `losAngeles` (America/Los_Angeles).
- "Today" for a member is the current date in their local zone. "Today" for the practice is the current Phoenix date.
- The browser's clock is never used for any date, status, cutoff, countdown or flag. Every one of them comes from the server, so a device clock that is hours wrong changes nothing on screen.

**Prices.**

- Plus costs $749.95 every 6 months.
- Yearly costs two six-month payments less 15%, rounded half up to the cent: 2 × 749.95 × 0.85 = 1,274.915, so $1,274.92 a year. Floating point would give $1,274.91, which is wrong.
- Every per-month figure is the period price divided by its months, rounded half up to the cent: $124.99 for every 6 months, $106.24 for yearly.
- All money arithmetic is exact decimal or integer cents.
- Free costs nothing and has no Kill Bill subscription.

**Served states.**

- The practice serves 47 states: every state except Alaska, Hawaii and Rhode Island.

**Memberships.**

- States: `free` → `pending` (the join is sent to Kill Bill) → `active` (Kill Bill confirms the subscription and its first invoice is paid).
- From `active`: a cadence change records `pendingCadence` from the next renewal, and Kill Bill switches the plan at the end of the term. A cancel moves to `cancelled`, where Plus stays until `plusUntil`. On that Phoenix date the membership becomes `free`.
- The join waits up to 10 seconds for Kill Bill's confirmation. After that, the membership stays `pending` until a later read sees Kill Bill confirm it.
- `renewalDate` and `plusUntil` are Kill Bill's charged-through date for the subscription. `pendingFrom` is the date the change takes effect.
- A cancelled member who joins again starts a new subscription.
- A cadence change or cancel while `pending` goes to Kill Bill exactly like one while `active`. When Kill Bill is unreachable it answers 503 with the payments copy. Otherwise the app first completes the pending confirmation and then applies the change.
- Illegal moves: join while `pending`, `active` or `cancelled` → 409 `already_plus`. Cadence change or cancel while `free` → 409 `not_plus`. Cancel while `cancelled` → 409 `already_ending`. Changing to the current cadence → 409 `same_cadence`.

**Request keys.**

- A join may carry a `Request-Key` header. Keys are kept per member for 24 hours.
- The same key with a byte-identical body returns the first response's status and body and creates nothing new in either system.
- The same key with a different body → 409 `request_key_reused`.

**Slots.**

- Draws are fasting morning draws in 20-minute slots starting 06:00, 06:20, … 09:40 member local time (12 slots), Monday to Saturday in the member's local dates. There are no slots on Sunday, apart from the staff same-day exception under Booking.
- Slots keep their wall-clock time across clock changes, so their Phoenix time moves. For example, a Denver member's 07:00 draw on Fri 12 Mar 2027 is `2027-03-12T14:00:00Z` and 07:00 Phoenix time. On Mon 15 Mar 2027 it is `2027-03-15T13:00:00Z` and 06:00 Phoenix time.
- A member local day has 23 hours on Sun 14 Mar 2027 and 25 hours on Sun 7 Nov 2027. Both are Sundays with no slots.
- Tests compute the next and latest clock change in a member's zone from the real current date. The 2027 dates here are worked examples only.

**Booking.**

- A phlebotomist holds one draw per start instant.
- Of any number of simultaneous bookings of one phlebotomist's start instant, exactly one succeeds. Every other answers 409 `slot_taken` with the slot-lost copy.
- `<winner>` in that copy is the winning booking's staff name. The next free slot is the same phlebotomist's first free slot after the taken one, on the member's local slot grid (Monday to Saturday, 06:00 to 09:40), shown in the member's local time.
- A draw needs a phlebotomist who serves the member's state, and a member with a home address.
- A draw dated today or later needs the member's Plus to be `active` or `cancelled` with `plusUntil` on or after the draw's Phoenix date. Recording a past draw needs the member's Plus to be in force today. Otherwise → 409 `plus_required`. A Free member always gets 409 `plus_required`.
- Members book from tomorrow up to 28 days ahead in their local dates. Staff book or record from 400 days back to 400 days ahead. Both bounds are included.
- Staff same-day exception: staff may book a draw for today in member local time at any of the 12 slot times, on any day of the week including Sunday, also when that time has already passed. Such a draw is booked (not collected), gets a visit page and is on its draw day at once, so draw-day behaviour is always reachable. Staff slot reads for today list all 12 times. Every other date keeps the Monday-to-Saturday grid: a Sunday, or a time off the grid, answers 422 on `time` (`Choose a slot from the published times.`).
- A draw dated before today in member local time is recorded `collected`, with the `collectedAt` given in the request, and gets no visit page.

**Draw states.**

- `booked` → `collected` (Mark collected on the visit page, or recorded in the past) → `ready` (results saved and the report stored) → `released` (a specialist releases it).
- `booked` → `cancelled`.
- A booked draw can be moved or cancelled by staff at any time. Every other change of a non-booked draw → 409 `not_booked`.
- Saving results or a report needs `collected` or `ready` (else 409 `not_collected`). A result correction can happen in `collected`, `ready` or `released`.
- Release needs `ready` (else 409 `not_ready`).

**Member change cutoff.**

- A member can move or cancel their booked draw until 18:00 member local time on the day before the draw's local date (`changesCloseAt`), even when a clock change falls between them.
- A request at or after that instant → 409 `changes_closed`. Staff are not bound by the cutoff.

**Visit page.**

- Booking a draw for today or later, moving a booked draw, and `POST …/visit-page` each mail the draw's phlebotomist a new private visit page address. Each new address ends the previous one at once.
- Cancelling the draw or `DELETE …/visit-page` ends the address.
- An address also ends at the end of the draw day in member local time (the next local midnight), or `DRAW_PAGE_SECONDS` after it was sent when that variable is set, whichever comes first.
- A request at or after the end instant finds it ended: 410, and the page shows the ended copy.
- `isDrawDay` is true only while the server's current member-local date equals the draw's local date. Only then does the page carry the street address and gate notes. Otherwise both are `null` and the page shows the address-later copy.
- `memberName` is the first name and the last name's initial with a full stop. No other personal data reaches the page or its responses.
- Mark collected works only on the draw day (else 409 `not_draw_day`) and only with at least one kit code (else 409 `kit_code_required`). It records `collectedAt` as the instant it was pressed.

**Kit codes.**

- A kit code is `KT-`, seven digits, `-` and a check character.
- The check character comes from the seven digits by this rule (ISO 7064 MOD 11-2). Start with 0. For each digit from left to right, add the digit, double the sum and keep the remainder after dividing by 11. The check value is 12 minus the final remainder, taken modulo 11. A check value of 10 is written `X`.
- `KT-1000046-X` and `KT-1000042-7` are valid. `KT-1000046-1` is refused with the wrong-check copy.
- Input is accepted in lower case and with or without dashes and spaces. It is stored and shown as upper-case dashed form. A wrong shape gets the wrong-shape copy.
- A draw's kit codes are unique within it.

**Results file.**

- The file is UTF-8, with or without a byte order mark, with LF or CRLF line ends, and comma separated, with no quoting.
- Each row is split at its commas:
  - the first field is the kit code;
  - the last two fields are the value and the unit;
  - every field between them is rejoined with commas as the marker.

  So `KT-1000046-X,Vit D, 25-OH,56.125,nmol/L` has the marker `Vit D, 25-OH`. A row with fewer than four fields is `refused` with the reason `Row needs kitCode, marker, value and unit.`. A blank last line is ignored.
- The first row is exactly `kitCode,marker,value,unit`. Row numbers count that header as row 1.
- Each row's `marker` is matched to the catalog by lower-casing it and dropping every character that is not a letter or digit, then comparing it with each alias and display name treated the same way. For example, `Vit D, 25-OH` and `25(OH) Vitamin D` both match Vitamin D.
- Statuses:
  - `unknown`: no marker matches. The reason is `No marker matches "<marker as written>".`
  - `refused`: the kit code is not on the draw (`Kit code isn't on this draw.`), the value is not a decimal number (`Value isn't a number.`), the unit is not accepted for that marker (`Unit isn't accepted for <marker>.`), or the marker already has a different saved value for this draw (`Already saved with a different value; correct it on the result instead.`).
  - `matched`: everything else.
- Units match ignoring case, and `u` stands for `µ`.
- A matched value is converted with the factor table using exact decimal arithmetic, then rounded half up to the marker's decimals. For example, 56.125 nmol/L ÷ 2.5 = 22.45, so 22.5 ng/mL. Floating point would give 22.4, which is wrong.
- Saving stores the matched rows only. A matched row whose marker already holds the same value is left unchanged. Saving the same file again changes nothing.
- One report per draw: the same report bytes again change nothing, and different bytes when a report exists → 409 `report_exists`.
- A report is a PDF exactly when its first bytes are `%PDF-`, whatever its file name or declared type. Anything else → 422 on `report` (`The report must be a PDF file.`).
- The draw becomes `ready` only after MinIO confirms the stored report and the draw has at least one result.

**Flags.**

- Each result is flagged by the server from the range table rows for the member's sex and age band, in force on the draw's collected date.
- The age band is whole years of age on the collected date in the member's own local date: `age18To39` (18–39), `age40To59` (40–59), `age60Plus` (60 and over). For example, a member born 2 Mar 1987 whose draw was collected at 23:30 Denver time on Mon 1 Mar 2027 (`2027-03-02T06:30:00Z`) is 39, in the 18–39 band. The UTC date would make them 40.
- Bounds are inclusive and compared at the marker's decimals:
  - `optimal` when optimal low ≤ value ≤ optimal high;
  - otherwise `inRange` when low ≤ value ≤ high;
  - otherwise `belowRange` when value < low, or `aboveRange` when value > high.
- Zones on the band: below runs from the scale minimum to low, in range from low to high, optimal from optimal low to optimal high (drawn over in range), above from high to the scale maximum. The scale minimum and maximum come from the server and fit every zone and value of that marker's draws.

**Range changes.**

- A change gives all six rows (both sexes × three age bands) for one marker and takes effect from 00:00 Phoenix time on its `effectiveFrom` date, which must be today or later in Phoenix.
- A draw is read against the change in force at its collected instant. Every screen, the results history file and every response show that draw's range in force.
- Two changes of one marker for one date → 409 `ranges_already_change`.

**Corrections.**

- A correction replaces the value (and optionally the note), keeps the earlier value in the history with who and when, and re-flags the result against the same ranges in force.
- Open screens show the correction copy within the 5-second refresh.

**Plans.**

- A plan is a `draft` or `published`. A draft records `basedOnPlanId`, the member's latest published plan when the draft was created (or `null`).
- Saving or publishing a draft whose `basedOnPlanId` is no longer the member's latest published plan → 412 `stale`. The message names the publisher of the newer plan and its publish time in Phoenix time.
- A published plan never changes again.
- Publishing records the member's current blend with the plan.
- The member sees only the latest published plan. Its Supplements section shows the member's current blend, which may be newer than the blend recorded with it. This holds on the member's plan screen, on the staff Plan screen and on the latest plan's own staff page. Every earlier published plan shows the blend recorded with it.
- In the API, `blend` in `GET /api/me/plan` is the member's current blend. In every staff plan view (`GET /api/members/<memberId>/plans` and `GET /api/longevity-plans/<planId>`, the latest plan included), `blend` is the blend recorded when that plan was published, and `null` for a draft. Staff screens read the current blend from `GET /api/members/<memberId>/blends`.

**Blends.**

- Each ingredient has a capsule strength, a time (`morning`, `evening` or `split`) and a price per capsule in integer cents.
- The strengths of Vitamin D3 and Vitamin D3 low dose are in IU, at 40 IU = 1 mcg, and are shown with both, for example `5,000 IU (125 mcg)`.
- Every ingredient has a distinct display name, and that name is the `<ingredient name>` in its `Add`, `Capsules a day` and `Remove` controls.
- A daily dose is a whole number of capsules, 1 or more.
- Morning and Evening ingredients go wholly into their packet. Split ingredients put half their capsules in each packet, with an odd capsule going to the morning packet.
- Each packet holds at most 4 capsules, otherwise 422 `packet_full`. The copy names the packet that overflows, and the morning one when both do.
- The 30-day list price is the sum, over ingredients, of capsules a day × 30 × price per capsule. The member price is the list price × 85%, in integer cents rounded half up. For example, a $29.70 list price is 2,524.5 cents, so $25.25 for members. Floating point would give $25.24, which is wrong.
- Each save creates a new blend, and the newest is the member's current blend.

**Care messages.**

- A message body is 1 to 2,000 characters counted in Unicode code points, so an emoji counts once. 2,000 is allowed and 2,001 is refused.
- There is at most one attachment, judged by its first bytes, never by file name or declared type: PDF starts with `%PDF-`, JPEG with the bytes FF D8 FF, PNG with 89 50 4E 47 0D 0A 1A 0A.
- For a JPEG or PNG, the original is kept byte for byte. The copy staff see is re-encoded with the camera orientation applied to the pixels and every metadata block removed (EXIF, GPS, XMP, ICC profile text, comments and text chunks).
- Staff replies reach the member's open thread within the 5-second refresh.
- Message rate limit: a member's message counts against the limit for `MESSAGE_RATE_WINDOW_SECONDS` after it was accepted. An 11th message while 10 still count → 429 with `Retry-After`, the whole seconds (rounded up, at least 1) until the oldest counted message leaves the window, and the message-limit copy.
- The limit is keyed on the member and never on the network address, and refused messages do not count.

**Results history file.**

- UTF-8 without a byte order mark, every field in double quotes (a quote inside a field is doubled), CRLF line ends.
- Header row: `"Collected date","Marker","Value","Unit","Flag","Range in force","Specialist note"`.
- One row per released result, oldest draw first, then catalog order.
- Columns:
  - collected date: the member-local date as `YYYY-MM-DD`;
  - marker: the display name;
  - value: with the marker's decimals;
  - unit;
  - flag: its label;
  - range in force: `<low>–<high> (optimal <optimal low>–<optimal high>)` with en dashes;
  - specialist note: empty when there is none.
- Any cell starting with `=`, `+`, `-`, `@`, a tab or a carriage return is prefixed with an apostrophe inside the quotes.
- Downloads: at most 5 per member per `FILE_RATE_WINDOW_SECONDS`, counted the same way as messages. The 6th → 429 with `Retry-After` and the download-limit copy, keyed on the member.

**Receipts.**

- Each paid Kill Bill invoice of a member's account has exactly one receipt. The app creates it when the join, or its check of Kill Bill at least every 60 seconds, sees the invoice paid.
- Amounts and line items are exactly what Kill Bill reports.
- `paidAt` is the payment's instant. `paidDate` and the month a receipt belongs to are its Phoenix date.
- `number` runs `OLC-000001` upward in creation order.
- The list holds the receipts whose `paidDate` falls in the month, ordered by `number` ascending (the order the desk recorded them), 25 per page. The cursor marks the last receipt returned. A receipt recorded later always has a higher number, so receipts recorded while someone is paging appear after the cursor and none repeats or is skipped.
- The receipt page shows the practice name, address and tax number, the member's name (or `Erased member`), the receipt number, the paid date, each line item with its period, the total and `Paid`.

**Closing an account.**

- States: `active` → `closing` (on the member's request; `erasesAt` = request instant + `CLOSURE_WAIT_SECONDS`) → `erasing` → `erased`.
- While closing, the owner can restore the account to `active`.
- The closing request cancels Plus at the end of the paid period in Kill Bill.
- Restoring brings back the same draws, results, plans, blend and membership as before the request, undoing that cancel in Kill Bill when Plus had not been set to end before the request. Restore after `erasesAt` → 409 `erasure_started`.
- Within 5 seconds after `erasesAt` the server erases the member:
  - name, email, phone, address, gate notes and date of birth from the database;
  - the member's draws, results, plans, blends, messages and sessions from the database;
  - their unsent mail;
  - the Kill Bill account's name, email and phone (replaced by `Erased member` and blanks).
  The member then shows `erasing` while it deletes their report PDFs and attachments from MinIO, and `erased` once MinIO has confirmed every deletion.
- Receipts keep their amounts and show `Erased member`. An erased member cannot sign in.

**Sessions.**

- A session lasts `SESSION_SECONDS` from sign-in.
- The server alone decides that a session has ended: expiry, sign-out, a password change elsewhere, removal of the staff member, or erasure. An ended session's cookie answers 401 `session_ended`.
- A role change applies from that person's next request.

### Services (DP-11, DP-13, DP-14, DP-21, DP-27, DP-28, DP-29, DP-46, DP-50, DP-53, DP-58)

**Kill Bill.**

- The app uses the tenant given by `KILLBILL_API_KEY` and `KILLBILL_API_SECRET`. At start it uploads, if the tenant lacks it, a catalog in USD with product `Plus` and two in-advance plans: `plus-six-months` (every 6 months, 749.95) and `plus-yearly` (every year, 1274.92).
- Each member who joins gets one Kill Bill account with the external key set to the member's id, the member's name and email, currency USD and time zone America/Phoenix. The account has an external payment method set as default, so invoices are paid at once.
- Joining creates one subscription on that account. A cadence change is a plan change at the end of the term. A cancel is an end-of-term cancellation. A restore undoes that cancellation.
- When Kill Bill is unreachable or answers a server error, every join, cadence change, cancel, member create with a cadence, closure (for a Plus member, pending included) and restore (for every member, Free included) answers 503 `payments_unavailable` with the payments copy. Nothing is written in the app's database or left behind in Kill Bill: anything created before the failure is cancelled.
- The UI dialog stays open as typed with focus on the message.

**MinIO.**

- The bucket is `S3_BUCKET`, created at start if missing.
- Object keys:
  - report: `members/<memberId>/draws/<drawId>/report.pdf`;
  - attachment original: `members/<memberId>/attachments/<attachmentId>/original`;
  - cleaned photo copy: `members/<memberId>/attachments/<attachmentId>/clean`.
- Objects are stored byte for byte as received.
- When MinIO is unreachable, a report answers 503 `report_store_unavailable` with the report-store copy, and no result row, report row or object is written. A message with an attachment answers 503 `attachment_store_unavailable` (`Attachments can't be stored right now. Nothing was sent.`).

**Mail (SMTP received by Mailpit).**

- Mail goes from `MAIL_FROM` through `SMTP_HOST` and `SMTP_PORT`. Every mail is first written to a pending-mail list in Postgres and delivered from there, so it is retried until the SMTP server accepts it.
- Visit page mail: to the phlebotomist's email, subject `Visit page for <date>`. The body names the member's first name and last initial and the draw time in member local time, and gives the address `<APP_PUBLIC_URL>/visit/<token>`. It never contains the street address, gate notes or any other personal data.
- Results notice: to the member's email, subject `Your new results are ready`. The body says new results are ready and links `<APP_PUBLIC_URL>/me/results`. It never contains a marker, value, flag or note.
- Unsent mail for an erased member is deleted with them.

### Seed data (DP-58)

Every seeded person, practice, lab partner and address is invented. A new practice copy starts with exactly these records and nothing else. Tests never change seeded staff or members.

Practice: Ocotillo Longevity Club, 8820 E Desert Willow Way, Suite 140, Scottsdale, AZ 85258. Tax number `86-4172093`.

Staff (password `desk-pass-2027` for each):

| Name | Email | Role |
|---|---|---|
| Maya Okafor | maya.okafor@ocotillo.example | owner |
| Priya Shah | priya.shah@ocotillo.example | specialist |
| Theo Lindqvist | theo.lindqvist@ocotillo.example | specialist |
| Dana Ruiz | dana.ruiz@ocotillo.example | coordinator |
| Sam Whitfield | sam.whitfield@ocotillo.example | coordinator |
| Jordan Pell | jordan.pell@ocotillo.example | billingLead |

Members (password `member-pass-2027` for each):

| Name | Email | Born | Sex | State | Local time | Phone | Address | Gate notes | Membership |
|---|---|---|---|---|---|---|---|---|---|
| Elena Marsh | elena.marsh@example.com | 1987-03-02 | female | co | denver | +1 303 555 0142 | 1450 Larimer St, Apt 6B, Denver 80202 | Buzz 6B; the lobby door sticks. | Plus, sixMonths |
| Marcus Bell | marcus.bell@example.com | 1971-06-14 | male | ny | newYork | +1 212 555 0187 | 88 Orchard St, Apt 3, New York 10002 | Ring twice. | Plus, yearly |
| Rosa Delgado | rosa.delgado@example.com | 1958-11-20 | female | il | chicago | +1 312 555 0119 | 2201 W Armitage Ave, Chicago 60647 | Side door by the garden. | Plus, sixMonths |
| Owen Pryce | owen.pryce@example.com | 1990-08-09 | male | az | phoenix | +1 480 555 0163 | 3300 N Scottsdale Rd, Unit 12, Scottsdale 85251 | none (`null`) | Free |
| Hana Sato | hana.sato@example.com | 1979-04-27 | female | ca | losAngeles | +1 415 555 0175 | 640 Valencia St, San Francisco 94110 | Gate code 4417. | Plus, yearly |

Addresses as stored. The `address` object holds `line1`, `line2`, `city` and `postalCode`, `line2` is `""` when there is none, and the state is the member's state:

| Member | line1 | line2 | city | postalCode |
|---|---|---|---|---|
| Elena Marsh | 1450 Larimer St | Apt 6B | Denver | 80202 |
| Marcus Bell | 88 Orchard St | Apt 3 | New York | 10002 |
| Rosa Delgado | 2201 W Armitage Ave | (empty) | Chicago | 60647 |
| Owen Pryce | 3300 N Scottsdale Rd | Unit 12 | Scottsdale | 85251 |
| Hana Sato | 640 Valencia St | (empty) | San Francisco | 94110 |

On a copy's first start, the app creates each seeded Plus member's Kill Bill account and subscription, starting that day. While Kill Bill is unreachable it keeps trying every 5 seconds, and those memberships show `pending` until Kill Bill confirms them. Their first paid invoices are the seeded receipts: $749.95 for Elena Marsh and Rosa Delgado, and $1,274.92 for Marcus Bell and Hana Sato. Each is paid on the first-start date, numbered `OLC-000001` to `OLC-000004` in the members table's order (Elena Marsh, Marcus Bell, Rosa Delgado, Hana Sato).

Phlebotomists (mail goes to these addresses):

| Name | Email | States served |
|---|---|---|
| Luis Carrillo | luis.carrillo@visits.example | az, co, nm, nv, ut |
| Ivy Chen | ivy.chen@visits.example | co, ut |
| Bree Halvorsen | bree.halvorsen@visits.example | ca, id, mt, or, wa, wy |
| Tomas Reyes | tomas.reyes@visits.example | ar, ia, ks, la, mn, mo, nd, ne, ok, sd, tx |
| Nia Brooks | nia.brooks@visits.example | al, il, in, ky, mi, ms, oh, tn, wi |
| Grace Whitaker | grace.whitaker@visits.example | ct, de, ma, md, me, nh, nj, ny, pa, vt |
| Caleb Ford | caleb.ford@visits.example | fl, ga, nc, sc, va, wv |

Seeded draws were brought over from the practice's earlier spreadsheet. All are `released` and have no report file.

| Member | Phlebotomist | Starts | Collected | Kit code | Vitamin D | LDL | HDL | ApoB | hs-CRP | Ferritin | Testosterone |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Elena Marsh | Luis Carrillo | 2025-09-15T13:00:00Z | 2025-09-15T13:12:00Z | KT-1000013-6 | 22.5 | 118 | 58 | 92 | 1.40 | 35 | — |
| Elena Marsh | Luis Carrillo | 2026-03-09T13:00:00Z | 2026-03-09T13:15:00Z | KT-1000021-6 | 31.5 | 108 | 61 | 84 | 0.90 | 48 | — |
| Elena Marsh | Luis Carrillo | 2026-09-14T13:00:00Z | 2026-09-14T13:10:00Z | KT-1000101-6 | 44.0 | 120 | 64 | 78 | 0.60 | 62 | — |
| Marcus Bell | Grace Whitaker | 2026-10-05T11:20:00Z | 2026-10-05T11:31:00Z | KT-1000110-4 | 38.2 | 96 | 47 | 88 | 2.10 | 180 | 520 |

For example, with the seed data at start, Elena Marsh's LDL reads In range on the first two draws (the starting LDL rows) and Above range on the third (the 2026-07-01 LDL rows). The seeded note on her third draw's Vitamin D is `Keep the morning D3 with breakfast.`, by Priya Shah.

Seeded plan for Elena Marsh: published at 2026-09-21T16:30:00Z by Priya Shah, with this text:

- Nutrition: `Build each meal around protein and vegetables.\n\n- Two portions of oily fish a week\n- Fibre at breakfast`
- Movement: `- Walk 30 minutes a day\n- Strength work twice a week`
- Sleep: `Lights out by 22:30 on weeknights.`
- Supplements notes: `Take the morning packet with breakfast and the evening packet an hour before bed.`

The seeded blend for Elena Marsh was saved at the same instant and is recorded with that plan: Vitamin D3 5,000 IU, 1 capsule; Magnesium glycinate, 2 capsules; Omega-3, 2 capsules; Methyl B12, 1 capsule; Ashwagandha, 1 capsule. That packs the morning packet with 3 capsules and the evening packet with 4, for a list price of $29.70 and a member price of $25.25.

Seeded care thread for Elena Marsh: her message `Could we move my spring draw a little earlier?` at 2026-09-22T15:00:00Z, and Dana Ruiz's reply `Yes — I'll offer you 06:20 next time.` at 2026-09-22T16:10:00Z. The thread is `handled`.

Ingredient catalog:

| id | Name | Strength | Time | Price per capsule |
|---|---|---|---|---|
| vitaminD3 | Vitamin D3 | 5,000 IU (125 mcg) | morning | 9 cents |
| vitaminD3Small | Vitamin D3 low dose | 1,000 IU (25 mcg) | morning | 6 cents |
| magnesiumGlycinate | Magnesium glycinate | 200 mg | evening | 12 cents |
| omega3 | Omega-3 | 1,000 mg | split | 18 cents |
| methylB12 | Methyl B12 | 1,000 mcg | morning | 15 cents |
| ashwagandha | Ashwagandha | 300 mg | evening | 15 cents |
| vitaminK2 | Vitamin K2 (MK-7) | 100 mcg | morning | 11 cents |
| zincPicolinate | Zinc picolinate | 15 mg | evening | 8 cents |
| creatine | Creatine monohydrate | 1,000 mg | split | 6 cents |
| coq10 | CoQ10 | 100 mg | morning | 22 cents |
| glycine | Glycine | 1,000 mg | evening | 5 cents |

Marker catalog, unit factors and aliases. A lab unit converts to the practice unit by the listed step.

| Category | id | Name | Practice unit | Decimals | Accepted lab units → practice unit | Aliases |
|---|---|---|---|---|---|---|
| Metabolic | glucose | Fasting glucose | mg/dL | 0 | mg/dL ×1; mmol/L ×18.016 | Glucose, GLU, Fasting glucose, Glucose fasting |
| Metabolic | hba1c | HbA1c | % | 1 | % ×1 | Hemoglobin A1c, A1C, HbA1c, Glycated hemoglobin |
| Metabolic | insulin | Fasting insulin | µIU/mL | 1 | µIU/mL ×1; mIU/L ×1; pmol/L ÷6.945 | Insulin, Insulin fasting |
| Heart | ldl | LDL | mg/dL | 0 | mg/dL ×1; mmol/L ×38.67 | LDL-C, LDL cholesterol, LDL Chol Calc |
| Heart | hdl | HDL | mg/dL | 0 | mg/dL ×1; mmol/L ×38.67 | HDL-C, HDL cholesterol |
| Heart | triglycerides | Triglycerides | mg/dL | 0 | mg/dL ×1; mmol/L ×88.57 | TG, Trig, Triglyceride |
| Heart | apoB | ApoB | mg/dL | 0 | mg/dL ×1; g/L ×100 | Apolipoprotein B, Apo B, APOB-100 |
| Hormones | tsh | TSH | mIU/L | 2 | mIU/L ×1; µIU/mL ×1 | Thyroid stimulating hormone, Thyrotropin |
| Hormones | testosterone | Total testosterone | ng/dL | 0 | ng/dL ×1; nmol/L ×28.84 | Testosterone, Testosterone total, TT |
| Hormones | estradiol | Estradiol | pg/mL | 0 | pg/mL ×1; pmol/L ÷3.671 | E2, Oestradiol, Estradiol sensitive |
| Kidney and liver | creatinine | Creatinine | mg/dL | 2 | mg/dL ×1; µmol/L ÷88.42 | Creat, Serum creatinine |
| Kidney and liver | egfr | eGFR | mL/min/1.73m² | 0 | mL/min/1.73m² ×1 | GFR estimated, eGFR CKD-EPI |
| Kidney and liver | alt | ALT | U/L | 0 | U/L ×1 | SGPT, Alanine aminotransferase, ALT/SGPT |
| Nutrients | vitaminD | Vitamin D | ng/mL | 1 | ng/mL ×1; nmol/L ÷2.5 | Vit D, 25-OH; 25(OH) Vitamin D; 25-Hydroxyvitamin D; Vitamin D 25-OH |
| Nutrients | ferritin | Ferritin | ng/mL | 0 | ng/mL ×1; µg/L ×1 | Serum ferritin, FERR |
| Nutrients | vitaminB12 | Vitamin B12 | pg/mL | 0 | pg/mL ×1; pmol/L ×1.355 | B12, Cobalamin, Vit B12 |
| Nutrients | magnesiumRbc | RBC magnesium | mg/dL | 1 | mg/dL ×1 | Magnesium RBC, Mg RBC, Red cell magnesium |
| Inflammation and blood | hsCrp | hs-CRP | mg/L | 2 | mg/L ×1; mg/dL ×10 | CRP high sensitivity, hsCRP, C-reactive protein hs |
| Inflammation and blood | homocysteine | Homocysteine | µmol/L | 1 | µmol/L ×1 | Hcy, Homocyst(e)ine |
| Inflammation and blood | hemoglobin | Hemoglobin | g/dL | 1 | g/dL ×1; g/L ÷10 | Hgb, Hb, Haemoglobin |

The Vitamin D aliases are separated by semicolons because the first alias contains a comma.

Starting range table, in force from 2020-01-01 for every marker. "All" means both sexes and every age band. Bounds are low–high (optimal low–optimal high).

| Marker | Rows |
|---|---|
| Fasting glucose | All: 70–99 (75–90) |
| HbA1c | All: 4.0–5.6 (4.6–5.3) |
| Fasting insulin | All: 2.0–19.6 (2.0–8.0) |
| LDL | All: 40–129 (40–99) |
| HDL | female, all bands: 50–100 (60–90); male, all bands: 40–100 (50–90) |
| Triglycerides | All: 30–149 (30–99) |
| ApoB | All: 40–99 (40–79) |
| TSH | All: 0.45–4.50 (1.00–2.50) |
| Total testosterone | female, all bands: 15–70 (25–60); male 18–39: 300–1000 (500–900); male 40–59: 300–950 (450–850); male 60 and over: 250–900 (400–800) |
| Estradiol | female 18–39: 30–400 (50–250); female 40–59: 10–350 (30–200); female 60 and over: 0–30 (0–20); male, all bands: 10–40 (20–35) |
| Creatinine | female, all bands: 0.50–1.00 (0.60–0.90); male, all bands: 0.70–1.30 (0.80–1.10) |
| eGFR | both sexes 18–39: 90–150 (100–130); 40–59: 75–150 (90–120); 60 and over: 60–150 (75–110) |
| ALT | female, all bands: 7–33 (10–25); male, all bands: 7–40 (10–30) |
| Vitamin D | All: 30.0–100.0 (40.0–60.0) |
| Ferritin | female, all bands: 15–150 (40–120); male, all bands: 30–400 (50–200) |
| Vitamin B12 | All: 232–1245 (500–1000) |
| RBC magnesium | All: 4.2–6.8 (5.5–6.5) |
| hs-CRP | All: 0.00–3.00 (0.00–1.00) |
| Homocysteine | All: 4.0–15.0 (4.0–9.0) |
| Hemoglobin | female, all bands: 12.0–15.5 (13.0–14.5); male, all bands: 13.5–17.5 (14.0–16.0) |

Seeded range change: LDL from 2026-07-01, All: 40–115 (40–89), created by Maya Okafor.

## Technical requirements

### Deployment (DP-58)

- The app is TypeScript on Node.js (the runtime available in the image).
- `/app/run.json` holds string `install`, `build` and `serve` commands and `"_schema":"run-manifest-v1"`, for example: `{"_schema":"run-manifest-v1","install":"npm ci","build":"npm run build","serve":"node dist/server.js"}`.
- The server binds `0.0.0.0` on port 4173, or on `APP_PUBLIC_PORT` when set. `GET /api/health` answers HTTP 200 JSON `{"status":"ok"}` once the database schema is ready.
- The schema and the starting data are applied idempotently on serve, never only at build. Several copies may start at the same moment, each on its own database and bucket. Each one starts safely, and reads, writes and sends only for its own data.
- The verifier runs these copies: the main one; one where Kill Bill is unreachable (its own database and bucket); one where MinIO is unreachable (its own database and bucket); a short-timers copy (`DRAW_PAGE_SECONDS=20`, `MESSAGE_RATE_WINDOW_SECONDS=30`, `FILE_RATE_WINDOW_SECONDS=30`, `CLOSURE_WAIT_SECONDS=20`, default session length); a short-session copy (`SESSION_SECONDS=20` only); and a spare copy for range changes that take effect today. Each has its own database and bucket.

### Configuration and secrets (DP-60)

The app reads these at start and never hard-codes them or sends them to the browser:

- `DATABASE_URL`;
- `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_FORCE_PATH_STYLE`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`;
- `KILLBILL_URL`, `KILLBILL_USERNAME`, `KILLBILL_PASSWORD`, `KILLBILL_API_KEY`, `KILLBILL_API_SECRET`;
- `SMTP_HOST`, `SMTP_PORT`, `MAIL_FROM`;
- `APP_PUBLIC_PORT`, `APP_PUBLIC_URL`.

Timers and their defaults:

| Variable | Default |
|---|---|
| `SESSION_SECONDS` | 43200 |
| `MESSAGE_RATE_WINDOW_SECONDS` | 3600 |
| `FILE_RATE_WINDOW_SECONDS` | 3600 |
| `CLOSURE_WAIT_SECONDS` | 2592000 |
| `DRAW_PAGE_SECONDS` | unset |

### Server boundary (DP-26, DP-45, DP-56, DP-57, DP-60)

- **Same origin.** The app is same-origin only and sends no cross-origin allowances.
- **Session cookie.** It is HttpOnly and SameSite=Lax, is never Secure (the app is served over plain http), and is a browser-session cookie: it carries no Expires attribute and no maximum age attribute, so it ends when the browser session ends.
- **What it serves.** The server serves only the built browser assets, the font files and the API. It never serves source files, `run.json`, environment files or credentials. Any other path renders the not-found screen with status 404.
- **Dependencies at boot.** If Postgres is unreachable at boot, the server keeps retrying and the health check does not answer 200 until it connects. If Kill Bill, MinIO or the SMTP server is unreachable, the app still starts and answers health 200. Only the actions that need that service answer their outage status.

Size limits. A limit's own value is allowed, and one byte over is refused with 413 `too_large`. The whole-body limits are decided from the declared length or while streaming, before authentication and before parsing. The file limits count the file's own bytes alone, never the multipart body, and are enforced as the part streams. File-part limits belong to rung 2 of the ladder too: a part over its limit answers 413 before authentication and before any other check, also without a session.

| Where | Limit | 413 message |
|---|---|---|
| any JSON body | 65,536 bytes | `That request is too large.` |
| results-file preview body | 1,100,000 bytes | `That request is too large.` |
| results-file save and report bodies | 11,100,000 bytes | `That request is too large.` |
| message bodies (member and staff) | 5,100,000 bytes | `That request is too large.` |
| results file part | 1,000,000 bytes | `The results file must be at most 1,000,000 bytes.` |
| report PDF part | 10,000,000 bytes | `The report must be at most 10,000,000 bytes.` |
| attachment part | 5,000,000 bytes | `Attachments must be at most 5,000,000 bytes.` |

For example, a 9,990,000-byte report in a larger multipart request is accepted, and a 10,000,001-byte report answers 413.

### Browser support and performance (DP-55)

- Current Chromium, at 375x812 (touch), 768x1024, 1024x768 and 1280x800.
- Every screen is usable within three seconds of opening.
- API answers within one second, except actions that wait on Kill Bill, which answer within twelve seconds.
- The 5-second refresh never blocks typing.

## Working rules

- IF-01: `/app/run.json` exists with string `install`, `build` and `serve` fields and `"_schema":"run-manifest-v1"`.
- IF-02: `THIRD_PARTY_NOTICES.md` at `/app` lists every shipped package with its licence, where shipped packages are the production dependency tree from `npm ls --omit=dev --all --json`.
- IF-03: Every shipped package (the same production dependency tree) carries a permissive licence: MIT, ISC, BSD-2-Clause, BSD-3-Clause, Apache-2.0, 0BSD, BlueOak-1.0.0, CC0-1.0 or Unlicense.
- IF-04: Fraunces and Figtree are shipped as font files inside the app with their SIL Open Font License notice, no font loads from another origin, and no shipped stylesheet, font file or font-family declaration names the Inter font.
- IF-05: The app keeps state only in Postgres and MinIO, with no other datastore, embedded database or state file.
- IF-06: No credential, API key, secret or password value other than the published seed passwords appears in the source.
- IF-07: All hand-written application source is TypeScript.
- IF-08: The app ships no raster images, stock illustrations or third-party icon sets. Imagery is generated SVG or uploaded files.

## Engineering standards

- The code is idiomatic, strictly typed TypeScript, with types that match the API shapes and no unchecked casts.
- Names in code match this brief's domain terms (draw, visit page, kit code, marker band, range change, blend, packet, receipt, closure).
- Each domain rule is decided in exactly one place in the source, and every screen and endpoint uses that place. This covers each state transition, money rounding, unit conversion, flagging, packet packing, the change cutoff, the visit page end and the kit code check.
- Money and result values are exact decimals or integer cents everywhere, never binary floating point.
- There is no abstraction with a single implementation, no dead, commented-out or unreachable code, and no defensive checks for impossible states.
- Every error leaves the server in the one published error shape, built in one place.
- There are no features, endpoints, screens or settings beyond this brief.
