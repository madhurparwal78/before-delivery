# Vesper & Rowe Talent Rungboard

Rungboard is the booking and casting workspace for Vesper & Rowe Talent, an invented Canadian agency for fashion and commercial models and content creators, with one office in Toronto and one in Vancouver. It does six jobs. Bookers hold talent days for several brands at once as ranked options. Holds release on the office's own clock. Confirmed holds become correctly priced bookings. Accounts tracks usage licences and talent statements. Brand clients browse public boards and send cast requests. Casting directors review private package links on their phones. New faces apply from their phones, and a guardian gives consent for a minor. Build it as one web app with a JSON API, backed by four services: PostgreSQL as the system of record, MinIO for photos, package ZIPs and statement CSVs, Kill Bill for invoices, and Mailpit as the outgoing mail sink. These are out of scope: payments collection, talent self-registration (talent members are invited), chat, contracts, any datastore beyond PostgreSQL and MinIO, and any sign-in other than email and password.

## Problem and users

Today the agency tracks options across a legacy agency database, shared spreadsheets and email threads. Toronto and Vancouver work three hours apart. A 1st option that should have released at noon Pacific is treated as live until 3 pm Eastern. Two bookers promise the same Friday. A 2nd option's challenge to the 1st dies in an inbox. Confirmed jobs are invoiced by hand, with day rates, quarter-hour overtime, usage by media, territory and term, the agency service fee and sales tax all re-keyed. Usage licences lapse with no renewal billed. Talent statements disagree with what was paid. Clients get stale package links and lose shortlists. A minor's guardian is asked for consent in email chains nobody can trace.

| Role | Goal | How often |
|---|---|---|
| Agency director | See both offices' holds, bookings, licence exposure and statements. Manage staff access, office closure dates, rate cards and the roster. | Daily |
| Booker | Place, rank, challenge, release and confirm options on talent days. Send casting packages. Turn confirmed options into correctly priced bookings. Keep talent profiles current. | Daily |
| Accounts lead | Issue invoices for confirmed bookings, track usage licences and renewals, record advances and reversals, and issue monthly talent statements that reconcile. | Weekly |
| Scout | Review new-face applications from a phone, judge photos, and move minors forward only after guardian consent. | Daily |
| Talent | See their own options and bookings in a private calendar feed and read their monthly statement. | Weekly |
| Brand client (no account) | Browse public boards, build a cast tray, send a cast request, and review private casting packages. | Occasional |
| Casting director (no account) | Shortlist or pass on talent from a private package link on a phone, and download the photos with a manifest. | Weekly |
| Guardian (no account) | Approve or decline a minor's application through a single-use emailed consent link. | Occasional |

Workspace roles are `agency_director`, `booker`, `accounts_lead`, `scout` and `talent`. Brand clients, casting directors, guardians and new faces never sign in.

## Journeys

1. **A booker holds, defends and books a day.** Start: Priya Shah (Toronto booker) is signed in on the availability board with Ines Okoro selected. Priya opens a day by keyboard and places a 1st option for Northbound Outfitters. Jonah Ellis places a 2nd for Lakeshore Beauty on the same day. Jonah challenges the 1st, and the 1st chip shows Challenged with its answer deadline. Priya opens the confirm dialog, picks full day, adds 50 minutes of overtime and a digital usage line, and confirms. End: the day fills solid with a "Booked" label, the 2nd chip leaves the ladder, both clients receive one challenge outcome email, Northbound receives the confirmation email with its calendar file, and the booking page lists every fee line in Canadian dollars. Rosa Delgado (accounts lead) then issues the invoice from the booking page, and the booking shows Invoiced.
2. **A brand client builds a cast and asks for it.** Start: the public site at `/boards`. The client opens the Women board, filters to Toronto, sorts by height, switches to feet and inches and pages forward. Back and Forward step through each choice. The client adds three talent to the tray, reorders them, and completes the four-step cast request by keyboard. End: a confirmation with the request reference appears, and the Toronto booking desk receives exactly one notification email.
3. **A booker sends a package, and a casting director shortlists on a phone.** Start: a booker on the Packages screen. The booker creates a package of four talent for a casting director's email. The casting director opens the emailed link on a phone, taps Shortlist on two talent and Pass on one, and downloads the photo ZIP. End: the booker's package view shows the choices. After the booker regenerates the link, the old link opens the dead-link page.
4. **A new face applies, a guardian consents and a scout signs.** Start: `/apply` on a phone. A 16-year-old applicant fills four steps, adds four photos and a guardian's email, reloads mid-way and finds the draft restored, then sends. The guardian approves through the emailed link. A second visit to the link shows it was already used. End: Theo Marchand (scout) approves and signs the applicant from a phone, and the new talent appears on the New Faces board.
5. **Accounts keeps licences and statements honest.** Start: Rosa Delgado on Licences. Rosa records a licence whose end falls in the next 30 days and sees it counted as Expiring. The client receives one renewal reminder. Rosa extends it by 3 months, and one renewal invoice appears in Kill Bill. Rosa records an advance for Ines Okoro, reverses a mistaken one and exports March's statement as CSV. End: the statement balance equals the sum of its lines, and the CSV opens with formula-like client names shown as text.
6. **The director runs the roster.** Start: Margot Vesper (agency director) on Roster. Margot imports the old system's CSV and reads a row-by-row report, then imports the same file again and sees nothing created. Margot withdraws a talent: the talent's profile address shows the gone page and the talent leaves packages and feeds. Margot restores them. End: the talent is back on the same board place, in the same packages with the same choices, and the same feed link works.
7. **A talent checks their own calendar and money.** Start: Ines Okoro signs in and lands on My calendar. Ines subscribes to the private feed link, regenerates it, and sees the old link stop working. End: Ines opens their own statement. Opening another talent's statement address answers not found.

## Mandatory requirements

This is the complete list of mandatory requirements; every check traces to one of these lines and the detailed sections below.

- **DP-01 — Workspace sign-in and invitations** A wrong password shows the sign-in error and the right one lands each role on its home screen. Sign out returns to the sign-in screen. A booker invited by the agency director sets a password from the emailed link and lands signed in on the board.
- **DP-02 — Identical account replies** Forgot-password and invitation requests answer with the same status and body whether or not the email already has an account, and send only the emails the Business rules allow.
- **DP-03 — Own member record only** A talent reads only their own member record; another member's id answers exactly like an unknown id.
- **DP-04 — Director-only staff changes** The server refuses invitations, role changes and member removal from every role except agency director.
- **DP-05 — Board browsing in the URL** A brand client browses boards by board, office, search, sort, unit and page, with every choice in the address so Back and Forward restore each step. At 375x812 the filters open as a bottom sheet whose sticky bar shows the result count.
- **DP-06 — Public profile fields** Public board and profile responses carry exactly the published public fields: never notes, rates, contact details, date of birth or guardian details.
- **DP-07 — Withdrawn talent off the public site** A withdrawn or erased talent's profile address answers the gone page and status, and the talent is absent from every board, board count and search.
- **DP-08 — Compact reach numbers** Reach numbers use the published truncating compact format, and every total adds the exact counts before formatting.
- **DP-09 — Page transitions and board previews** A public route change covers and reveals the page, reverses on Back, moves focus to the new level-one heading and updates the title. Headings reveal line by line with their accessible name present once, and the board index cover preview follows a mouse pointer only.
- **DP-10 — Cast tray** Adding a talent flies the portrait into the tray and rolls the count, and the tray count always equals the tray's contents after adds, removals, reorders and reloads.
- **DP-11 — Keyboard cast request** A brand client completes the multi-step cast request by keyboard alone, with the published focus target after every step and dialog, including continuing after correcting a step the server refused. The leave confirmation keeps focus inside it and Escape keeps the client on the form. The draft survives a reload.
- **DP-12 — One request per submit** A double-submitted cast request creates one request and one notification email. A replay under the same key returns the original response, and a different body under that key is refused. A request that breaks two published rules at once answers the earlier one in the one error precedence.
- **DP-13 — Cast request rate limit** Cast requests beyond the published per-address limit answer 429 with the wait in seconds.
- **DP-14 — Header-safe notification email** Line breaks in any cast request field never add mail headers or change the notification subject.
- **DP-15 — Gapless option ranks** Simultaneous placements on one talent-day get distinct ranks from 1 to 3 with no gaps, and a fourth is refused.
- **DP-16 — Replayable placement** A placement replayed under the same idempotency key returns the original response and rank, and a different body under that key is refused.
- **DP-17 — Release, challenge and confirm re-rank** Releasing promotes the options below. Confirming books the 1st and releases the rest. Each illegal transition is refused with its published conflict, and an action that breaks two published rules at once answers the earlier one in the one error precedence.
- **DP-18 — Option ladder** Each day column stacks rank-numbered chips with the published data attributes and accessible name. Chips slide to new rungs, the promoted numeral rolls, booked days carry the Booked label, and the reduced-motion substitute applies.
- **DP-19 — Board by keyboard and phone** A booker places, releases and confirms options either by keyboard alone (arrow keys across days, Enter to open a day, the published focus targets) or by touch at 375x812 in a bottom sheet with a sticky action bar. Every rare state announces its exact copy, and a session that ends mid-dialog keeps the typed values for after signing in again.
- **DP-20 — Automatic release** Every unconfirmed option carries an automatic release instant: 12:00 office time on the business day before the job day, skipping weekends and that office's closure dates, correct across daylight-saving changes. The server releases each hold within 10 seconds of its release instant.
- **DP-21 — Office-local hold-until** A booker's hold-until refuses spring-forward gap times, resolves a repeated autumn time to its first occurrence, and must be in the future and before the automatic release. A hold-until change that breaks two published rules at once answers the earlier one in the one error precedence.
- **DP-22 — Challenge deadline** A challenge gives the 1st holder OPTION_CHALLENGE_SECONDS to answer and refuses answers at or after the deadline. After the deadline the server releases the 1st, promotes the 2nd and emails both clients, exactly once across app copies.
- **DP-23 — Talent calendar feed** Each talent's private feed lists options as tentative and bookings as confirmed all-day events with exclusive end dates. The sequence rises on every change, released options become cancelled events, and regenerating the link kills the old one.
- **DP-24 — Exact booking fees** A confirm prices each talent in integer cents from the day or half-day rate, overtime per started quarter hour and usage fees. It adds the agency service fee, split across a group's talent by the published leftover-cent rule, and rounds each tax line on its own.
- **DP-25 — All-or-nothing confirm** A confirm records the Kill Bill draft invoice with one item per fee line, the confirmation email with its calendar file and the paired ledger entries together. With Kill Bill down it records nothing and the option stays 1st. A confirm that breaks two published rules at once answers the earlier one in the one error precedence.
- **DP-26 — Effective-dated rate cards** Each booking is priced by the rate card in effect on its job day, so jobs before a new card's effective date keep the old rates on the booking page, invoice, email and statement.
- **DP-27 — Private-safe confirmation email** The confirmation email and its calendar file carry the job and fee lines but never home addresses, guardian details or other clients' options.
- **DP-28 — Confirm and issue journey** A booker confirms a 1st option by keyboard through the confirm dialog to the booking page, which lists every fee line with its label and amount in the published money format, and the accounts lead issues its invoice, which commits the Kill Bill invoice. A confirm refused because the option is not 1st announces its exact copy.
- **DP-29 — Licence terms and reminders** A licence runs whole months from its first-use date, clamped to month end, and expires at the end of its last day in the client's time zone. It shows Active, Expiring or Expired, with counts that match the list. One renewal reminder per end date goes out within 10 seconds, exactly once across app copies.
- **DP-30 — Replayable licence extension** A licence extension under an idempotency key creates one Kill Bill renewal invoice even when replayed and refuses a different body under that key. It refuses a stale version, naming who extended and when, and records nothing when Kill Bill is down. An extension that breaks two published rules at once answers the earlier one in the one error precedence.
- **DP-31 — Licences on a phone** At 375x812 the accounts lead's licence list becomes cards with a sticky Extend bar, with end dates in the published day format. An extension, a licence extended meanwhile and the billing outage each announce their exact copy.
- **DP-32 — Paired ledger** Every booking, advance and reversal writes entries that sum to zero, and a talent's balance equals the sum of their entries. Advances are recouped oldest first. Corrections are reversals and never edit an entry. A movement request that breaks two published rules at once answers the earlier one in the one error precedence.
- **DP-33 — Monthly statements** Statements are cut by the talent's office calendar month, with totals that match their lines after reversals, and a talent reads only their own statement.
- **DP-34 — Statement CSV export** The statement CSV has the published columns, quoting and line endings, and neutralises text cells that begin with a formula trigger.
- **DP-35 — Statement journey** The accounts lead records an advance and a reversal and exports a statement by keyboard with the published focus targets, including saving again after an advance refused for an empty amount. At 375x812 the statement table keeps its first column pinned with no page overflow.
- **DP-36 — Package link lifecycle** A package link expires PACKAGE_LINK_TTL_SECONDS after issue and can be revoked or regenerated, after which the old link dies. The link can write only the casting director's choices, and a link request that breaks two published rules at once answers the earlier one in the one error precedence.
- **DP-37 — Package shows published fields** Package responses carry only the published package fields and drop withdrawn talent at once.
- **DP-38 — Package photo ZIP** The package ZIP holds each talent's photos with location data removed and orientation applied, plus a manifest with each file's name, size in bytes and SHA-256. With MinIO down the download answers with the storage outage.
- **DP-39 — Phone shortlist journey** On a 375x812 phone the casting director shortlists or passes on talent by touch. Each choice shows at once and rolls back with exact copy when the link was revoked or expired, or the talent was withdrawn, meanwhile.
- **DP-40 — Phone application journey** A new face applies by touch on a 375x812 phone through the multi-step form, with a sticky Next bar that never covers the focused field, continues after correcting a step the server refused, and finds the draft restored after a reload.
- **DP-41 — Application photo and bio limits** Each of the four required photos is judged by decoded content at or below the published per-file byte limit, and the bio limit counts user-perceived characters with no browser cut-off. An upload that breaks two published rules at once answers the earlier one in the one error precedence.
- **DP-42 — Application rate limit** New application drafts beyond the published per-address limit answer 429 with the wait in seconds.
- **DP-43 — Minors and guardian consent** An applicant whose 18th birthday falls after the office's calendar date is held until a guardian approves through a single-use link that expires after CONSENT_LINK_TTL_SECONDS. The scout decides only the applications the rules allow.
- **DP-44 — Measurements in both units** Measurements entered in either unit are stored in whole centimetres and shown in both units by the published rounding rule.
- **DP-45 — Clean portfolio photos** Portfolio uploads are judged by decoded content, every served photo has its location data removed and its orientation applied, and the storage outage records nothing.
- **DP-46 — Portfolio reorder** Photos reorder by drag or by keyboard and the order persists. A reorder from a stale version is refused, naming who saved and when. A reorder that breaks two published rules at once answers the earlier one in the one error precedence.
- **DP-47 — Profile editing journey** A booker edits a profile by keyboard with the published focus targets and browses the portfolio lightbox with arrows, swipe, Escape and its counter. A stale reorder rolls back on screen with exact copy, and a session that ends mid-edit keeps the edited values for after signing in again.
- **DP-48 — Legacy roster import** The roster import follows the published matching rules and unit parsing, merges duplicates, reports orphans row by row and creates nothing on re-import. An import that breaks two published rules at once answers the earlier one in the one error precedence.
- **DP-49 — Withdraw and restore exactly** Withdrawing a talent removes them at once from every board, open package, calendar feed and roster export. Restoring brings back the same packages, choices, feed link and board places.
- **DP-50 — Erasure keeps amounts** Erasure removes a talent's personal data everywhere, including queued emails and stored photos, yet keeps booking amounts under the published placeholder name.
- **DP-51 — Import dialog journey** The agency director runs the import dialog by keyboard with the published focus targets, including choosing a new file after one refused for its header row. At 375x812 the import report keeps its first column pinned.
- **DP-52 — Run manifest, health and start-up** The app installs, builds and serves from the run manifest and answers the health check. Several copies started together run start-up, the sweep and mail delivery with each effect happening exactly once.
- **DP-53 — One error ladder** Every API path follows the one published error precedence and answers 405 with an Allow header for a wrong method and 415 for a wrong content type.
- **DP-54 — Published formats** The API uses the published key, enum, money and instant conventions, and every screen and email shows office times, dates and money in the published formats.
- **DP-55 — Three viewports, accessible** Every screen at 375x812, 768x1024 and 1280x800 has no horizontal overflow and no obscured control, and passes an automated WCAG 2.2 AA audit with its dialogs and sheets open.
- **DP-56 — Forms and refused dialogs** Every form shows each field error inline and in the Problems summary, whose links move focus to the field. A refused dialog stays open with everything typed and focus on its error. The browser's own blocking is never used.
- **DP-57 — Motion system** Every motion uses only the three published durations, as a CSS transition, CSS animation or element animation with its reduced-motion substitute. Pointer behaviour follows each event's pointer type, and each accessible name equals its visible text once.
- **DP-58 — Ended sessions and removed access** A session that ends mid-form, by its SESSION_TTL_SECONDS lifetime or a sign-out elsewhere, keeps the draft and restores it after signing in again, and access removed mid-session refuses the next action with exact copy.
- **DP-59 — Editorial look** Screens show the warm paper ground, the oxblood accent used only for rank 1 and focus, the large serif display over small grotesk labels, hairline rules between rows and tabular figures.
- **DP-60 — Real integrations from configuration** Credentials and service URLs come from the environment, and invoices, emails and files live in Kill Bill, Mailpit and MinIO, never in app-made stand-ins.

## Frontend

### Screens and layout (DP-05, DP-09, DP-10, DP-11, DP-19, DP-31, DP-35, DP-39, DP-40, DP-47, DP-51, DP-55)

No screen scrolls sideways at 375x812, 768x1024 or 1280x800. Wide tables scroll inside their own labelled region instead. A closed menu, drawer or sheet is removed from the page or hidden, never only moved off screen.

Public screens:

| Path | Shows | 1280x800 | 768x1024 | 375x812 |
|---|---|---|---|---|
| `/boards` | Board index: one large serif row per board (Women, Men, Creators, New Faces) with its talent count | Rows span the twelve-column grid; the cover preview follows a mouse pointer | Same rows, narrower | Stacked rows; no preview |
| `/boards/<board>` | Board listing: search, office, sort and unit controls, portrait cards (photo, display name, office, height in the chosen unit, total reach) and pagination | Controls in a row above a three-column portrait grid | Two-column grid | One column; the Filters button opens a bottom sheet |
| `/talent/<slug>` | Public profile: name, office, board, measurements in the chosen unit, reach per platform and total, portfolio grid, Add to tray | Portfolio grid beside the facts | Facts above the grid | Single column |
| `/talent/<slug>` (withdrawn or erased) | Gone page | Centred | Centred | Centred |
| `/tray` | Tray list with reorder and remove, then Start cast request | List | List | List with a sticky bar |
| `/cast-request` | Four steps: Your tray, Your details, The job, Review and send. The step is in the address (`?step=1` to `?step=4`) | Form centred in eight columns | Full width | Full width, sticky Back and Next bar |
| `/p/<token>` | Casting package: title, talent cards with photos, published fields and Shortlist or Pass, shortlisted count, Download photos | Three-column cards | Two-column | One column; sticky bar with the count and download |
| `/apply` | New-face application: About you, Your story, Photos, Guardian (only for minors), Review. Step in the address (`?step=`) | Centred form | Full width | Full width, sticky Back and Next bar |
| `/consent/<token>` | Guardian consent: applicant first name, office, Approve and Decline | Centred | Centred | Centred |

Workspace screens (signed in). A left office rail holds the office switch and the role's navigation, and the main area fills the rest:

| Path | Who | Shows |
|---|---|---|
| `/sign-in`, `/forgot-password`, `/reset/<token>`, `/invite/<token>` | Anyone | Plain forms |
| `/workspace/overview` | Agency director (home) | Per office: held days, bookings this month, licence counts by status, statements due |
| `/workspace/board` | Booker (home), director | Office rail with the office's talent list; a 14-day strip for the selected talent starting at today's office date; each day is a column with three rungs. Address: `?office=<office>&talent=<slug>` |
| `/workspace/bookings`, `/workspace/bookings/<id>` | Booker, accounts lead, director | Booking list; booking page with fee lines, rate card, invoice state, Issue invoice |
| `/workspace/licences` | Accounts lead (home), director | Count tiles for Active, Expiring and Expired, then the licence table; Record licence |
| `/workspace/statements/<talentId>/<YYYY-MM>` | Accounts lead, director, the talent themselves | Statement table, advances with recouped and outstanding amounts, Record advance, Reverse, Export CSV |
| `/workspace/packages` | Booker, director | Packages with state, expiry and choices; New package |
| `/workspace/applications`, `/workspace/applications/<id>` | Scout (home), director | Application queue and review with the four photos, Minor label, decisions |
| `/workspace/talent/<id>` | Booker, director | Profile editor, portfolio grid with reorder, upload and lightbox |
| `/workspace/roster` | Director | Roster table with state, Import roster, Export roster, Withdraw, Restore, Erase |
| `/workspace/members`, `/workspace/rate-cards`, `/workspace/offices` | Director | Members and invitations; rate cards; office closure dates |
| `/workspace/me` | Talent (home) | Own 14-day options and bookings (read-only), calendar feed link, Regenerate, link to own statements |

Board layout by viewport: at 1280x800 the office rail sits left and the 14 day columns sit side by side. At 768x1024 the rail collapses into a top bar and the strip wraps into two rows of 7 days. At 375x812 the days stack as rows, a tapped day opens as a bottom sheet with a sticky action bar, licences become cards with a sticky Extend bar, and the statement and import-report tables keep their first column pinned while the other columns scroll inside the region.

### Public screens and controls (DP-05, DP-10, DP-11, DP-18, DP-19, DP-31, DP-39, DP-40, DP-47, DP-51, DP-56, DP-58)

These roles and names are public, and tests use them. Each accessible name is exactly its visible text, once. A password field is a native password input found by its label; it has no ARIA `textbox` role. Controls inside a repeated card are found within the card's named `article` or `listitem`.

| Where | Role and name | Visible copy or notes |
|---|---|---|
| All public pages | `link "Vesper & Rowe Talent"`, `link "Boards"`, `link "Tray <n>"`, `link "Apply"` | `<n>` is the tray count |
| Board listing | `searchbox "Search talent"`, `radiogroup "Office"` with radios `All offices`, `Toronto`, `Vancouver`; `combobox "Sort by"` with options `Name`, `Height`, `Reach`; `radiogroup "Units"` with radios `cm`, `ft and in`; `navigation "Pages"` with links `Previous page`, `Next page` | |
| Board listing (375x812) | `button "Filters"` opens `dialog "Filters"`; its sticky bar has `button "Show <n> talent"` | `<n>` is the result count for the choices in the sheet |
| Board navigation | `navigation "Boards"` with links `Women`, `Men`, `Creators`, `New Faces` | |
| Card and profile | `article "<display name>"` containing `button "Add to tray"` or `button "Remove from tray"` | |
| Tray and cast request | `list "Tray"` with a `listitem "<display name>"` each, containing `button "Up"`, `button "Down"`, `button "Remove"`; `button "Start cast request"`; `button "Next"`, `button "Back"`, `button "Send cast request"` | |
| Cast request fields | textboxes `Your name`, `Company`, `Email`, `Shoot date`, `Brief`; `radiogroup "Office"` | |
| Leave confirmation | `alertdialog "Leave the cast request?"` with `button "Stay on the form"` and `button "Leave"` | Body: "Your cast request has not been sent. Your draft stays saved on this device." |
| Live regions | `status "Tray announcements"`, `status "Package announcements"`, `status "Application announcements"` | |
| Package | `article "<display name>"` with toggle buttons `Shortlist` and `Pass` (pressed state shown), `button "Download photos"`, `status` text `<n> shortlisted` | |
| Apply | textboxes `First name`, `Last name`, `Email`, `Date of birth`, `Height`, `Instagram followers`, `Bio`, `Guardian name`, `Guardian email`; `radiogroup "Office"`; `radiogroup "Height unit"` (`cm`, `ft and in`); file inputs `Front photo`, `Profile photo`, `Full-length photo`, `Smiling photo`; `button "Next"`, `button "Back"`, `button "Send application"`; a `Bio` counter showing `<used> of 600` | |
| Consent | `button "Approve application"`, `button "Decline application"` | |
| Sign-in | textbox `Email`; password input labelled `Password`; `button "Sign in"`; `link "Forgot password?"`; `status "Account announcements"` | |
| Account pages and Members | `/forgot-password`: textbox `Email` and `button "Send reset link"`; `/reset/<token>` and `/invite/<token>`: password input labelled `New password` and `button "Set password"`; Members: `button "Invite member"` opens `dialog "Invite member"` with textboxes `Name` and `Email`, `combobox "Role"` with options `Agency director`, `Booker`, `Accounts lead` and `Scout`, `radiogroup "Office"` (`Toronto`, `Vancouver`) and `button "Send invitation"`; each of these pages has `status "Account announcements"` | Talent invitations go through the API only |
| Workspace | `navigation "Workspace"` with the role's links: `Overview`, `Board`, `Bookings`, `Licences`, `Statements`, `Packages`, `Applications`, `Roster`, `Members`, `Rate cards`, `Offices`, `My calendar`; `button "Sign out"` | Each role sees only its own screens |
| Board | `navigation "Offices"` with links `Toronto`, `Vancouver`; `list "Talent"` of links by display name; `grid "Availability for <display name>"` whose day cells are buttons; `status "Board announcements"` | |
| Day button | Name equals its visible text: `<Ddd> <D> <Mon>`, then each chip as `<ordinal> <company>`, or `Booked <company>`, or `Open` | Example: `Mon 15 Mar 1st Northbound Outfitters 2nd Lakeshore Beauty` |
| Day dialog or sheet | `dialog "<display name>, <date>"` listing chips, each with `button "Release"`, plus `button "Confirm"` on the 1st and `button "Challenge"` on the 2nd; textboxes `Client`, `Job title`, `Note`, `Hold until` (office-local date and time); `button "Place option"` | |
| Confirm dialog | `dialog "Confirm booking"`: `radiogroup "Day type"` (`Full day`, `Half day`); textbox `Overtime minutes`; `button "Add usage"`, which adds a group of comboboxes `Media` (options `Digital`, `Print`, `Out of home`, `Broadcast`), `Territory` (`Canada`, `North America`, `Worldwide`) and `Term` (`3 months`, `6 months`, `12 months`); `group "Also book"` of checkboxes by display name; `button "Confirm booking"` | |
| Booking page and list | Page: `button "Issue invoice"`; `status "Booking announcements"`. List (`/workspace/bookings`): `table "Bookings"` with a header row and one row per listed booking | |
| Licences | count tiles `Active <n>`, `Expiring <n>`, `Expired <n>`; `table "Licences"` or (375x812) a `list "Licences"` of `article` cards; `button "Record licence"`; `button "Extend"` (sticky bar on phone); `dialog "Extend licence"` with textbox `Months` and `button "Extend licence"`; `status "Licence announcements"` | |
| Statements | `region "Statement lines"` containing `table "Statement"`; `button "Record advance"` opens `dialog "Record advance"` (textboxes `Amount`, `Note`; `button "Save advance"`); `button "Reverse"` on each line opens `dialog "Reverse entry"` (textbox `Reason`, `button "Reverse entry"`); `button "Export CSV"`; `status "Statement announcements"` | |
| Packages (staff) | `button "New package"` opens `dialog "New package"`; each package has `button "Revoke link"` and `button "Regenerate link"` | |
| Applications | `article "<applicant name>"` with `button "Approve"`, `button "Decline"`, `button "Sign"` and a `Minor` text label when it applies | |
| Profile editor | `form "Profile"`; textboxes `Display name`, `Height`, `Chest`, `Waist`, `Hips`, `Instagram followers`, `TikTok followers`, `YouTube subscribers`, `Office note`; `radiogroup "Measurement unit"`; `button "Save profile"`; `list "Portfolio"` with a `listitem "Photo <p> of <n>"` each, containing `button "Move earlier"`, `button "Move later"`, `button "Open"`; `button "Upload photo"`; `dialog "Portfolio"` lightbox with `button "Previous photo"`, `button "Next photo"`, `button "Close"` and text `<p> of <n>`; `status "Profile announcements"` | |
| Roster | `button "Import roster"` opens `dialog "Import roster"` (file input `Roster CSV`, `button "Import"`); `region "Import report"` containing `table "Import report"`; per row `button "Withdraw"`, `button "Restore"`, `button "Erase"`; `alertdialog "Erase <display name>?"` with `button "Erase"` and `button "Keep"`; `link "Export roster"`; `status "Roster announcements"` | |
| My calendar | text field `Feed link` (read-only), `button "Regenerate feed link"`; `status "Calendar announcements"` | |
| Every form | `region "Problems"` holding one `link` per field error, its text being that error; in a dialog the region sits at the top of the dialog and its links move focus to fields inside it | Heading "There is a problem" (one error) or "There are <n> problems" |

Signature attributes: every chip has `data-rank` (`1`, `2` or `3`) and `data-state` (`option`, `challenged`, `booked` or `released`). Every day button has `data-day-state` (`open`, `held` or `booked`). The API's `placed` shows as `option`, `confirmed` as `booked`, and `released` or `expired` as `released`. A chip carries `released` only while it leaves the ladder.

### Interactions (DP-05, DP-09, DP-10, DP-11, DP-19, DP-28, DP-35, DP-39, DP-40, DP-46, DP-47, DP-51, DP-56, DP-58)

Board browsing. Changing the board, office, search, sort, unit or page writes all of them into the address (`/boards/<board>?office=&q=&sort=&unit=&page=`). The defaults are `office=all`, `q=` empty, `sort=name`, `unit=cm`, `page=1`, and the address always carries all five. Each change adds one history entry, and Back and Forward restore the controls and results exactly. Changing anything except the page resets the page to 1. Sort `name` is A to Z by display name, `height` is tallest first and `reach` is largest total first, with ties broken by display name. Pages hold 6 talent. The unit choice also applies on profiles reached from the board, carried as `?unit=`.

Cast tray. The tray lives in the browser and holds up to 12 talent. Add to tray toggles to Remove from tray. Up, Down and Remove act at once and keep focus on the moved item's same button; after Remove, focus goes to the next item's Remove, or to Start cast request when the list is empty. The `Tray <n>` count always equals the list's length, including after a reload.

Cast request. Next validates the current step on the server through `POST /api/cast-requests/checks`. On success it moves to the next step and focuses that step's level-two heading. Back focuses the previous step's heading. Send cast request focuses the confirmation heading. The draft is saved in the browser after every field change and restored on reload, together with its idempotency key. Following an in-app link away from an unsent request opens the leave confirmation with focus on Stay on the form. Tab stays inside it. Escape or Stay closes it and returns focus to the control that was focused before. Leave navigates away and keeps the draft.

Availability board. Tab reaches the grid once. Left and Right arrow move between days, Home and End jump to the first and last day, and Up and Down move by one week (seven days). Enter or Space opens the day dialog. Inside a dialog, Tab is trapped. Escape closes the dialog without saving, and focus returns to the day button that opened it. The board refreshes after every action and at least every 5 seconds, so a sweep release appears within 15 seconds of its instant.

Published focus targets after each dialog action:

| Action | Focus goes to |
|---|---|
| Place option, Release, Challenge succeed | The day dialog closes; the day button that opened it |
| Confirm booking succeeds | Both dialogs close; the `link "View booking <reference>"` that appears inside the booked day |
| Any day or confirm dialog refused | The dialog stays open with every typed value; focus moves to the refusal message inside the dialog (or to the first invalid field for 422) |
| Issue invoice succeeds | The `Invoiced` state text on the booking page |
| Record advance, Reverse entry succeed | The dialog closes; the new statement row's first cell |
| Export CSV succeeds | Stays on Export CSV |
| Extend licence succeeds | The dialog or sheet closes; the extended licence's end date text |
| Import succeeds | The dialog closes; the `Import report` heading |
| Erase confirmed | The roster row's state text |
| Save profile succeeds | Save profile |
| Move earlier or later | The same button on the moved photo |
| Lightbox closed | The `Open` button of the photo last shown |
| New package, Revoke link, Regenerate link succeed | The package's row heading |

Confirm dialog. Opening Confirm on a 1st chip opens it above the day dialog. Also book lists other talent of the same office whose 1st option on the same day is held by the same client. Confirm booking sends one request for all ticked talent.

Package page. Tapping Shortlist or Pass shows the pressed state and updates the count at once, before the server answers. Tapping the pressed button again clears the choice. If the server refuses, the button returns to its prior state, the count returns to its prior value, and the refusal copy from Feedback states is announced. The page loads its package once and checks again on every choice.

Application. Each Next saves the step to the server draft and focuses the next step's heading. The draft id and token stay in the browser, so a reload restores the step and its values. On a phone the sticky bar stays above the keyboard edge, and the page scrolls so the focused field sits fully above the bar. Photo inputs accept a tap to pick or take a photo. The Guardian step appears only when the date of birth makes the applicant a minor on the chosen office's date, as decided by the server when the About you step is saved.

Portfolio reorder. A mouse, pen or touch pointer can drag a photo to a new place. Touch drag starts after a press of half a second, and before that the touch scrolls the page. Move earlier and Move later do the same by keyboard. Every completed move saves at once with the portfolio version the screen holds. When the save is refused as stale, the grid returns to the server's order and announces the stale-order copy.

Lightbox. Open shows the photo with a `<p> of <n>` counter. Previous photo, Next photo and the Left and Right arrows step through the photos, a horizontal touch swipe does the same, and Escape or Close closes the lightbox.

Board index preview. When a mouse pointer moves over a board row, a portrait cover for that board follows the pointer, offset below and right of it. The preview appears only for pointer events whose pointer type is mouse. A touch or pen tap simply follows the row's link.

Ended session. When any signed-in request answers `session_ended`, the screen keeps its open form or dialog values in the browser, announces the session copy and shows a Sign in again link to `/sign-in?return=<current path>`. After signing in, the user returns to that path, the same dialog reopens with the kept values, and the draft-restored copy is announced.

### Visual design (DP-46, DP-55, DP-59)

- Colour roles: the page ground is a warm off-white like heavy paper. Text and the booked-day fill are a near-black warm ink. A deep oxblood red is the only accent, used for the outline of rank-1 chips and for keyboard focus rings and nothing else. Secondary text is a muted warm grey. Every row is separated by a one-pixel hairline in a light sand tone. Error text uses the ink colour with an error icon and the word "Error:", never colour alone.
- Type: display headings use Fraunces, a high-contrast serif with soft wedge serifs, and public page titles set it about six times the body size. Body, labels and controls use Hanken Grotesk, a quiet grotesk, set small. Each step up the type scale is about a third larger than the step below. Every number in tables, chips, money and counts uses tabular figures so columns align.
- Density and composition: comfortable spacing on a twelve-column editorial grid with wide gutters. Public boards set large serif headings over tight portrait rows. The workspace splits a narrow left office rail from a full-width 14-day strip.
- Not by colour alone: every chip prints its rank (1st, 2nd, 3rd), a challenged chip prints "Challenged", a booked day prints "Booked", and licence statuses print Active, Expiring or Expired.
- Every interactive target is at least 44 by 44 pixels, and all text and focus indicators meet WCAG 2.2 AA contrast against their background. The automated WCAG 2.2 AA audit covers levels A and AA of WCAG 2.0, 2.1 and 2.2 and passes only with no violations at all, both in the default state and with each dialog or sheet open, on every screen in every viewport as DP-55 requires.

### Motion and effects (DP-09, DP-10, DP-18, DP-57)

All motion uses exactly three durations: short (140 milliseconds), middle (300 milliseconds) and long (560 milliseconds). Each motion starts briskly and settles with a long soft landing, never bouncing. Motion runs only as CSS transitions, CSS animations or element animations; nothing animates frame by frame from script. There are no decorative loops and no spinners: pending states show text.

| Motion | Meaning | Feel | Reduced-motion substitute |
|---|---|---|---|
| Route cover and reveal (public pages) | Leaving a page | A paper-coloured panel sweeps up from the bottom edge over the page in the middle duration, then sweeps off the top to reveal the new page in the middle duration. On Back, both sweeps run downward instead. When the reveal ends, focus moves to the new page's level-one heading and the title becomes `<page heading> — Vesper & Rowe Talent` | The new page appears with a short cross-fade |
| Heading line reveal | A page arriving | Each line of a large serif heading rises into view from behind its own lower edge over the long duration, each line starting one short duration after the previous one. The heading's accessible name is its full text once | The heading appears at once |
| Board cover preview | Pointing at a board | Fades in over the short duration and trails the mouse pointer | Appears and moves without fading |
| Tray fly and count roll | Added to tray | A copy of the portrait shrinks and travels to the tray link over the middle duration; the count's digit rolls up one glyph height over the middle duration | The count changes in place with a short cross-fade |
| Ladder chip slide (signature) | Rank change | A chip glides from its old rung to its new one over the middle duration, by moving the drawn chip rather than re-flowing the column; a move spans 0 to 2 rungs | Chips swap rungs at once |
| Rank numeral roll (signature) | The promoted chip | After the slide ends, the promoted chip's numeral rolls vertically from its old value to its new one over the long duration, one glyph height per rank step | The numeral changes in place with a short cross-fade |
| Booked fill (signature) | Day booked | The day column fills solid ink and the "Booked" label appears over the short duration | Instant |
| Released chip exit | Option released | The chip fades out over the short duration, then the column closes up with the slide | Removed at once |
| Dialogs and bottom sheets | Opening a task | Dialogs fade and grow slightly over the short duration; sheets rise from the bottom edge over the middle duration | Short cross-fade only |
| Press feedback | A press | The control darkens slightly over the short duration | Same; nothing moves |

The signature in steps: (1) a booker releases, confirms, or lets a challenge run out; (2) any chip leaving the ladder fades; (3) the chips below slide up their rungs; (4) the new 1st chip's numeral rolls to "1" and its accent outline appears; (5) on a confirm, the day fills ink and shows "Booked". `data-rank`, `data-state`, `data-day-state`, the day button's name and the live-region announcement change at step 1 and are identical with reduced motion.

### Feedback states (DP-13, DP-19, DP-22, DP-25, DP-30, DP-31, DP-35, DP-38, DP-39, DP-41, DP-42, DP-43, DP-45, DP-46, DP-47, DP-56, DP-58)

Every async action shows a pending state on its button (the button text changes to the pending copy and the button is disabled) and announces each outcome in the screen's named live region from the controls table. Pending copy ends with the single ellipsis character …, never three full stops. These placeholders are used throughout:

- `<date>` is a day as `Ddd D Mon YYYY` (Mon 15 Mar 2027).
- `<time>` is an instant in the office-time format: `Ddd D Mon YYYY, HH:MM <City> time` (Fri 12 Mar 2027, 12:00 Toronto time), in the talent's office for anything about a talent and otherwise in the signed-in member's office.
- `<name>` is a member's name, `<company>` a client's company, `<talent>` a display name, `<ordinal>` one of 1st, 2nd or 3rd, and `<amount>` money as `CAD 1,234.50`.

Shared copy:

| Situation | Copy |
|---|---|
| Session ended (401 `session_ended`) | Your session ended. Your draft is kept; sign in again to finish. |
| Draft restored | Your draft was restored. |
| Access removed (401 `access_removed`) | Your access to Rungboard was removed. Nothing more can be saved. |
| Newer version saved (412 `stale_version`) | <name> saved a newer version at <time>. Your changes were not saved. |
| Rate limited (429) | Too many requests from this connection. Try again in <seconds> seconds. |
| Billing outage (503 `billing_unavailable`), except on confirm | Billing is unreachable, so nothing was saved. Try again in a few minutes. |
| Storage outage (503 `storage_unavailable`) | Photo storage is unreachable, so nothing was saved. Try again in a few minutes. |
| Validation (422) | The Problems summary plus inline errors; the live region says: Please fix <n> problems. (or Please fix 1 problem.) |

Per action:

| Action | Pending | Success | Rare states |
|---|---|---|---|
| Sign in | Signing in… | (lands on the role's home) | 401 `invalid_credentials`: That email and password do not match. |
| Forgot password | Sending… | The API's `message` text | |
| Invite member | Sending… | The API's `message` text | |
| Place option | Placing option… | Placed <ordinal> option for <company> on <date>. | `ladder_full`: This day already holds three options. `client_already_holds`: <company> already holds an option on this day. `day_booked`: This day is already booked. |
| Release | Releasing… | Released <company>'s option. When the released option was 1st and another remains, this is added: <next company> now holds 1st. | `option_released`: This option was released at <time>. |
| Challenge | Sending challenge… | Challenged <company>'s 1st option. It must be answered by <time>. | `not_second`: Only the 2nd option can challenge the 1st. `already_challenged`: The 1st option is already challenged until <time>. |
| Confirm booking | Confirming booking… | Booked <talent list> for <company> on <date>. The confirmation email is on its way. | `already_booked`: Not booked: <name> confirmed this day first, at <time>. `not_first`: Only the 1st option can be confirmed. `option_released` as above. `challenge_expired`: The challenge deadline passed at <time>, so this option is being released. Billing outage: Billing is unreachable, so nothing was booked. The option is still 1st. Try again in a few minutes. |
| Sweep change seen on refresh | — | <company>'s option on <date> was released at <time>. | |
| Issue invoice | Issuing invoice… | Invoice issued in billing. | `already_invoiced`: This invoice was already issued by <name> at <time>. |
| Add or remove from tray | — | Added <talent> to your tray. <n> in tray. / Removed <talent>. <n> in tray. | Tray full: Your tray holds up to 12 talent. |
| Reorder tray | — | Moved <talent> to position <p> of <n>. | |
| Send cast request | Sending your cast request… | Cast request <reference> sent. A booker in <city> will reply by email. | |
| Record licence | Recording licence… | Recorded licence for <talent> with <company>, ending <date>. | |
| Extend licence | Extending licence… | Extended <talent>'s licence by <months> months to <date>. | Stale: <name> extended this licence at <time>. Check the new end date before extending again. |
| Record advance | Saving advance… | Recorded an advance of <amount> for <talent>. | |
| Reverse entry | Reversing… | Reversed <reference>. The balance is now <amount>. | `already_reversed`: This entry was already reversed by <name> at <time>. |
| Export CSV | Preparing export… | Statement for <Month YYYY> downloaded. | Storage outage copy |
| New package | Creating package… | Package sent to <recipient name>. The link works until <time>. | |
| Revoke link | Revoking… | Package link revoked. It no longer opens. | |
| Regenerate link | Creating new link… | New link sent to <recipient name>. The old link no longer opens. | |
| Shortlist, Pass, clear | (shown at once) | Shortlisted <talent>. / Passed on <talent>. / Cleared your choice for <talent>. | `link_revoked` or `link_replaced`: This package link was revoked, so your choice for <talent> was not saved. `link_expired`: This package link has expired, so your choice for <talent> was not saved. Talent withdrawn: <talent> is no longer in this package. |
| Download photos | Preparing photos… | Your download has started. | Storage outage: Photo storage is unreachable, so the download could not be prepared. Try again in a few minutes. |
| Dead package link page | — | Heading "This package link no longer opens", text "Ask your Vesper & Rowe booker for a new link." | |
| Application Next | Saving… | Step saved. | |
| Upload application photo | Uploading <slot label> photo… | <Slot label> photo added. | Storage outage copy |
| Send application | Sending application… | Adult: Application sent. Our scouts will be in touch by email. Minor: Application sent. We have emailed your guardian for consent and will review it once they approve. | `already_submitted`: This application was already sent. |
| Scout decision | Saving decision… | Approved <applicant>'s application. / Declined <applicant>'s application. / Signed <applicant> to the New Faces board. | `awaiting_guardian`: This applicant is a minor and a guardian has not approved yet. `already_decided`: <name> already decided this application at <time>. |
| Guardian decision | Saving… | Thank you. You approved <first name>'s application. / You declined <first name>'s application. We will not contact them again. | Used or expired link page: heading "This consent link no longer works", text "Ask Vesper & Rowe to send a new link if you still need to decide." |
| Save profile | Saving profile… | Profile saved. | Stale (shared copy) |
| Upload portfolio photo | Uploading photo… | Photo added to the portfolio. | Storage outage copy |
| Reorder portfolio | — | Moved photo to position <p> of <n>. | Stale order: <name> saved a newer order at <time>. The previous order is back. |
| Import roster | Importing roster… | Import finished: <c> created, <m> merged, <u> unchanged, <o> orphans. | |
| Withdraw, Restore, Erase | Saving… | Withdrew <talent>. They no longer appear on boards, packages or feeds. / Restored <talent> to their boards, packages and feed. / Erased <talent>'s personal data. Booking amounts are kept under Erased talent. | `already_withdrawn`, `not_withdrawn`, `erased`: That talent's record changed elsewhere. Reload to see it. |
| Regenerate feed link | Creating new link… | New feed link ready. The old link no longer works. | |
| Gone profile page | — | Heading "No longer represented", text "This talent is no longer represented by Vesper & Rowe Talent." | |

Field error copy, shown inline and in the Problems summary:

| Field rule | Copy |
|---|---|
| Required field empty | Enter <field label in lower case>. |
| Email not an address | Enter an email address like name@example.com. |
| Bio over limit | Your bio is <n> characters; the limit is 600. |
| Photo too large (413) | That photo is larger than 8,000,000 bytes. |
| Portfolio photo too large (413) | That photo is larger than 12,000,000 bytes. |
| Not a decodable image | That file is not a JPEG, PNG or WebP photo. |
| Hold-until in the spring-forward gap | That time does not exist in <city>: clocks skip that hour. |
| Hold-until not in the future | Choose a time in the future. |
| Hold-until not before automatic release | Choose a time before the automatic release at <time>. |
| Job day too late or too close | Options can be placed only while this day's automatic release is still ahead, up to 31 Dec 2027. |
| Tray talent no longer listed | <talent> is no longer available; remove them to continue. |

## Backend

### API (DP-02 to DP-04, DP-06, DP-12, DP-13, DP-15 to DP-17, DP-20 to DP-26, DP-29, DP-30, DP-32 to DP-34, DP-36 to DP-38, DP-41 to DP-46, DP-48 to DP-50, DP-53, DP-54)

Conventions. JSON keys are lowerCamelCase. Enum values are lower snake_case. Money is integer cents in fields ending in `Cents`. Instants are ISO 8601 UTC with whole seconds and a Z (`2027-03-12T17:00:00Z`). Office-local dates are `YYYY-MM-DD`, and office-local date-times are `YYYY-MM-DDTHH:MM` with optional `:SS`. IDs are opaque strings. JSON request bodies need `Content-Type: application/json` (a charset parameter is allowed), and uploads need `multipart/form-data` with one part named `file`.

Size limits. A JSON body may be at most 1,000,000 bytes. An application photo may be at most 8,000,000 bytes, a portfolio photo at most 12,000,000 bytes, and a roster CSV at most 2,000,000 bytes. A multipart request may be at most its file limit plus 100,000 bytes. Each limit itself is allowed; one byte more answers `413 {"error":"too_large","limitBytes":<n>}`.

Sessions. Sign-in sets an HttpOnly, SameSite=Lax cookie named `rb_session`. A session ends in one of three ways:
- SESSION_TTL_SECONDS after sign-in. The expiry instant itself is already ended.
- Sign-out from any tab or device holding that cookie. This deletes the session on the server.
- Removal of the member.

After an expiry or a sign-out, any request carrying that session's cookie answers `401 {"error":"session_ended"}`. After a removal, it answers `401 {"error":"access_removed"}`. Signing in again starts a new session. Tests can end a session mid-form either by setting SESSION_TTL_SECONDS low or by signing out with the same cookie from another browser context.

Error shape. Every error body is a JSON object with an `error` code. A 422 adds `"errors":{"<field>":"<copy>"}` with `"error":"validation"`. Conflicts add the fields named in their rows.

The one error precedence, applied to every API path in this order:
1. Routing: an unknown `/api` path answers `404 {"error":"not_found"}`, and a known path with a wrong method answers `405 {"error":"method_not_allowed"}` with an `Allow` header.
2. `429 {"error":"rate_limited","retryAfterSeconds":<n>}` with `Retry-After: <n>` for a rate-limited public request.
3. `401` when unauthenticated: `{"error":"unauthenticated"}` with no cookie, `{"error":"session_ended"}` when the cookie's session has ended, `{"error":"access_removed"}` when the member was removed.
4. `404 {"error":"not_found"}` for an unknown record or one the caller may not read (Business rules define visibility). The `410` answers of link and profile addresses (`gone`, `link_expired`, `link_used`, `link_revoked`, `link_replaced`) come at this same step.
5. `403 {"error":"forbidden"}` for a role that may not take the action.
6. `413`, then `415 {"error":"unsupported_media_type"}`, then `400 {"error":"bad_json"}` for unparseable JSON or `400 {"error":"idempotency_key_required"}` for a missing key.
7. Idempotent replay: the same member, the same key and an identical body return the stored status and body with header `Idempotent-Replayed: true`. The same key with a different body answers `409 {"error":"idempotency_key_reused"}`.
8. `409` state conflicts and `412` version conflicts.
9. `422` field validation.
A dependency outage answers `503` only after every check above has passed.

Public endpoints (no session):

| Method and path | Request | Success | Extra errors |
|---|---|---|---|
| GET `/api/health` | — | `200 {"status":"ok"}` | |
| GET `/api/offices` | — | `200 {"offices":[{"id":"toronto","city":"Toronto","timeZone":"America/Toronto","closures":["2026-01-01",…]}]}` | |
| GET `/api/public/boards` | — | `200 {"boards":[{"board":"women","title":"Women","count":8,"coverPhotoUrl":"/api/photos/<id>"}]}` | |
| GET `/api/public/talent?board=&office=&q=&sort=&page=` | — | `200 {"page":1,"pageSize":6,"total":8,"totalPages":2,"talent":[<card>]}` | 422 for an unknown board, office or sort |
| GET `/api/public/talent/{slug}` | — | `200 <profile>` | `410 {"error":"gone"}` when withdrawn or erased |
| GET `/api/photos/{photoId}` | — | `200` `image/jpeg` | 404 when the photo's talent is not active |
| POST `/api/cast-requests` | Header `Idempotency-Key`; body `{"name":"Sam Arsenault","company":"Northbound Outfitters","email":"sam@northbound.example","office":"toronto","shootDate":"2027-04-20","brief":"Two-day outdoor campaign","talentSlugs":["ines-okoro","callum-reid"]}` | `201 {"id":"…","reference":"CR-000123","receivedAt":"…Z"}` | |
| POST `/api/cast-requests/checks` | `{"step":2,"draft":{"name":"Sam Arsenault","company":"Northbound Outfitters","email":"sam@northbound.example","office":"toronto"}}`, where `draft` holds any keys of the cast request body and `step` is 1 to 4 | `200 {"ok":true}` | 422 with the errors of that step's fields only |
| POST `/api/applications` | `{"office":"toronto"}` | `201 {"id":"…","token":"…","status":"draft"}` | |
| GET `/api/applications/{id}` (header `X-Application-Token`) | — | `200 <application draft>` | 404 for a wrong or missing token |
| PATCH `/api/applications/{id}` (token header) | Any of `{"firstName","lastName","email","dateOfBirth":"2010-03-02","office","height":{"value":171,"unit":"cm"},"instagramFollowers":1200,"bio","guardianName","guardianEmail"}` | `200 <draft with "minor":true\|false>` | `409 {"error":"already_submitted"}` |
| PUT `/api/applications/{id}/photos/{slot}` (token header) | multipart `file`; `slot` is `front`, `profile`, `full_length` or `smile` | `200 {"slot":"front","width":1200,"height":1600}` | |
| POST `/api/applications/{id}/submit` (token header) | `{}` | `200 {"status":"submitted"\|"awaiting_guardian","minor":true\|false}`; `minor` is true exactly when `status` is `awaiting_guardian` | `409 already_submitted`; 422 for missing fields, photos or guardian details |
| GET `/api/consents/{token}` | — | `200 {"applicantFirstName":"Ava","office":"toronto","expiresAt":"…Z"}` | `410 {"error":"link_expired"}` or `410 {"error":"link_used"}` |
| POST `/api/consents/{token}` | `{"decision":"approve"\|"decline"}` | `200 {"decision":"approve"}` | the same 410s |
| GET `/api/p/{token}` | — | `200 <package view>` | `410 {"error":"link_expired"\|"link_revoked"\|"link_replaced"}` |
| PUT `/api/p/{token}/decisions/{slug}` | `{"decision":"shortlisted"\|"passed"\|"undecided"}` | `200 {"slug":"ines-okoro","decision":"shortlisted","shortlistedCount":2}` | the same 410s; `404` for a talent not in the package or withdrawn |
| GET `/api/p/{token}/photos.zip` | — | `200` `application/zip` | the same 410s |
| GET `/feeds/{token}.ics` | — | `200` `text/calendar; charset=utf-8` | 404 for an unknown or old token, or a withdrawn or erased talent |

A `<card>` has exactly these keys: `slug`, `displayName`, `office`, `board`, `measurements` (`heightCm`, `chestCm`, `waistCm`, `hipsCm`), `reach` (`instagram`, `tiktok`, `youtube`, `total`; exact integers) and `coverPhotoUrl`. A `<profile>` is a card plus `portfolio`: `[{"photoId","url","width","height"}]` in portfolio order. A `<package view>` is `{"title","expiresAt","shortlistedCount","talent":[<profile> plus "decision"]}`. Nothing else is ever included.

Workspace access:

| Method and path | Who | Request | Success | Extra errors |
|---|---|---|---|---|
| POST `/api/session` | anyone | `{"email":"priya.shah@vesperrowe.example","password":"Rungboard-2027"}` | `200 {"member":<member>,"home":"/workspace/board"}` | `401 {"error":"invalid_credentials"}` |
| DELETE `/api/session` | signed in | — | `204` | |
| GET `/api/me` | signed in | — | `200 <member>` | |
| POST `/api/password-resets` | anyone | `{"email":"…"}` | `202 {"message":"If that address has an account, a reset link is on its way."}` | |
| POST `/api/password-resets/{token}` | anyone | `{"password":"…"}` (at least 12 characters) | `200 {"member":<member>,"home":"…"}` and signed in | `410 {"error":"link_used"}`; 404 for an unknown token |
| POST `/api/invitations` | director | `{"email":"new.booker@vesperrowe.example","name":"Ari Novak","role":"booker","office":"vancouver"}` (talent invitations add `"talentId"`) | `202 {"message":"If that address has no account yet, an invitation is on its way."}` | |
| POST `/api/invitations/{token}/accept` | anyone | `{"password":"…"}` (at least 12 characters) | `200 {"member":<member>,"home":"…"}` and signed in | `410 link_used`; 404 for an unknown token |
| GET `/api/members` | staff | — | `200 {"members":[<member>]}` | |
| GET `/api/members/{id}` | staff; a talent for their own id | — | `200 <member>` | |
| PATCH `/api/members/{id}` | director | `{"role":"accounts_lead"}` | `200 <member>` | `409 {"error":"own_membership"}` |
| DELETE `/api/members/{id}` | director | — | `204` | `409 own_membership` |

`<member>` is `{"id","name","email","role","office","talentId"}`, where `talentId` is null for staff.

Talent, profiles and roster:

| Method and path | Who | Request | Success | Extra errors |
|---|---|---|---|---|
| GET `/api/talent?office=&state=` | staff | — | `200 {"talent":[<talent>]}` | |
| GET `/api/talent/{id}` | staff; a talent for their own id (no `officeNote`) | — | `200 <talent>` | |
| PATCH `/api/talent/{id}` | booker, director | `{"version":4,"displayName":"Ines Okoro","measurements":{"height":{"value":"5 ft 10 in","unit":"ft_in"},"waist":{"value":61,"unit":"cm"}},"reach":{"instagram":374650},"officeNote":"…"}` | `200 <talent>` | `412 {"error":"stale_version","savedBy":"<name>","savedAt":"…Z"}` |
| POST `/api/talent/{id}/photos` | booker, director | multipart `file` | `201 {"photoId","url","width","height","portfolioVersion"}` | 503 storage |
| DELETE `/api/talent/{id}/photos/{photoId}` | booker, director | — | `204` | 503 storage |
| PUT `/api/talent/{id}/photos/order` | booker, director | `{"portfolioVersion":7,"photoIds":["p3","p1","p2"]}` | `200 {"portfolioVersion":8,"photoIds":[…]}` | `412 stale_version` with `savedBy`, `savedAt`; 422 unless `photoIds` is exactly the current set |
| POST `/api/talent/{id}/withdraw` | director | `{}` | `200 <talent>` | `409 {"error":"already_withdrawn"}`, `409 {"error":"erased"}` |
| POST `/api/talent/{id}/restore` | director | `{}` | `200 <talent>` | `409 {"error":"not_withdrawn"}`, `409 erased` |
| POST `/api/talent/{id}/erase` | director | `{}` | `200 <talent>` | `409 erased` |
| POST `/api/roster/imports` | director | multipart `file` (CSV) | `200 <import report>` | 422 `{"errors":{"file":"The header row does not match the roster export format."}}` |
| GET `/api/roster/export.csv` | director | — | `200` `text/csv` | |

`<talent>` is `{"id","slug","displayName","state","office","board","dateOfBirth","email","phone","homeAddress","guardian":{"name","email","phone"}|null,"measurements":{…Cm},"reach":{…,"total"},"officeNote","portfolio":[…],"version","portfolioVersion"}`. State is `active`, `withdrawn` or `erased`; a restored talent is `active` again. The director creates a talent with `POST /api/talent`, for example `{"displayName":"Quinn Zed","email":"quinn.zed@talent.vesperrowe.example","office":"toronto","board":"women","measurements":{"height":{"value":175,"unit":"cm"}}}`, where only `displayName`, `office` and `board` are required and `measurements` takes the PATCH form; it answers `201 <talent>`, and 422 for an unknown office or board or an email another non-erased talent has. A talent created this way, by an import or by a signing starts `active` with no photos, so its `coverPhotoUrl` is null until its first photo, and its slug is its display name in lower case with accents removed and each run of other characters replaced by one hyphen; when that slug is taken, the lowest free number from 2 upward is added after one more hyphen (`-2`, then `-3`). The `<import report>` is `{"counts":{"created","merged","unchanged","orphan"},"rows":[{"row":2,"outcome":"created"|"merged"|"unchanged"|"orphan","talentId":"…"|null,"reason":null|"<code>","filled":["chestCm"]}]}`. Row numbers count the header as row 1.

Options and bookings:

| Method and path | Who | Request | Success | Extra errors |
|---|---|---|---|---|
| GET `/api/talent/{id}/ladder?from=YYYY-MM-DD&days=14` | staff | — | `200 {"talentId","office","days":[{"date","dayState":"open"\|"held"\|"booked","options":[<option>],"bookingId":null}]}` | |
| POST `/api/options` | booker, director | Header `Idempotency-Key`; `{"talentId":"…","clientId":"…","date":"2027-03-15","jobTitle":"Spring lookbook","note":"Two looks, studio","holdUntilLocal":null}` | `201 {"option":<option>}` | `409 {"error":"ladder_full"}`, `409 {"error":"client_already_holds"}`, `409 {"error":"day_booked"}` |
| GET `/api/options/{id}` | staff | — | `200 {"option":<option>}` | |
| PATCH `/api/options/{id}` | booker, director | `{"version":2,"holdUntilLocal":"2027-03-11T15:00","note":"…"}` (null clears the hold-until) | `200 {"option":<option>}` | `409 option_released`; `412 stale_version` |
| POST `/api/options/{id}/release` | booker, director | `{}` | `200 {"option":<option>,"ladder":[<option>]}` | `409 {"error":"option_released","releasedAt":"…Z"}`, `409 {"error":"challenge_expired","challengeDeadline":"…Z"}` |
| POST `/api/options/{id}/challenge` | booker, director | `{}` (sent on the 2nd option) | `200 {"ladder":[<option>]}` | `409 {"error":"not_second"}`, `409 {"error":"already_challenged","challengeDeadline":"…Z"}`, `409 option_released` |
| POST `/api/bookings` | booker, director | `{"options":[{"optionId":"…","dayType":"full_day","overtimeMinutes":50,"usage":[{"media":"digital","territory":"north_america","termMonths":6}]}]}` | `201 {"booking":<booking>}` | `409 {"error":"already_booked","bookedBy":"<name>","bookedAt":"…Z","bookingId":"…"}`, `409 {"error":"not_first"}`, `409 option_released`, `409 challenge_expired`, 422 for a mixed group, `503 {"error":"billing_unavailable"}` |
| GET `/api/bookings?office=&month=YYYY-MM` | booker, accounts lead, director | — | `200 {"bookings":[<booking>]}` | |
| GET `/api/bookings/{id}` | booker, accounts lead, director | — | `200 {"booking":<booking>}` | |
| POST `/api/bookings/{id}/issue` | accounts lead, director | `{}` | `200 {"booking":<booking>}` | `409 {"error":"already_invoiced","issuedBy":"<name>","issuedAt":"…Z"}`, `503 billing_unavailable` |

`<option>` is `{"id","talentId","clientId","clientCompany","date","jobTitle","note","rank","state","autoReleaseAt","holdUntil","holdUntilLocal","releaseAt","challengeDeadline","placedBy":{"id","name"},"placedAt","releasedAt","releaseReason","version"}`. `state` is `placed`, `challenged`, `confirmed`, `released` or `expired`. `rank` is null once the option leaves the ladder. `releaseAt` is the earlier of `holdUntil` and `autoReleaseAt`. `releaseReason` is `manual`, `challenge_timeout`, `day_booked`, `hold_expired`, `auto_release` or null.

`<booking>` is `{"id","reference":"VR-2027-0001","state":"confirmed"|"invoiced"|"corrected","date","office","clientId","clientCompany","jobTitle","rateCard":{"id","name","effectiveFrom"},"talent":[{"talentId","displayName","talentFeesCents","serviceFeeShareCents"}],"lines":[{"kind","label","talentId","amountCents"}],"talentFeesCents","serviceFeeCents","taxCents","totalCents","killbillInvoiceId","confirmedBy","confirmedAt","issuedBy","issuedAt"}`. Line `kind` is `day_rate`, `half_day_rate`, `overtime`, `usage`, `service_fee` or `tax`. Which lines appear, and their `talentId` values, follow the fee-line rule in Business rules.

Clients, rate cards, offices, packages, applications (staff side), feeds:

| Method and path | Who | Request | Success | Extra errors |
|---|---|---|---|---|
| GET `/api/clients` | staff | — | `200 {"clients":[{"id","slug","company","contactName","contactEmail","timeZone"}]}` | |
| POST `/api/clients` | booker, accounts lead, director | `{"company":"Harbourline Tea","contactName":"Dana Wu","contactEmail":"dana@harbourline.example","timeZone":"America/Vancouver"}` | `201 <client>` | 422 for an unknown IANA zone |
| GET `/api/rate-cards` | staff | — | `200 {"rateCards":[<rate card>]}` | |
| POST `/api/rate-cards` | director | `{"name":"2027 spring","effectiveFrom":"2027-04-01","boards":{"women":{"fullDayCents":260000,"halfDayCents":156000,"overtimeQuarterHourCents":9800},"men":{…},"creators":{…},"new_faces":{…}},"usageBaseCents":{"digital":62000,"print":82000,"out_of_home":125000,"broadcast":210000}}` | `201 <rate card>` | 422 when `effectiveFrom` is not later than every existing card's |
| POST `/api/offices/{office}/closures` | director | `{"date":"2027-08-20"}` | `201 {"office","closures":[…]}` | 422 outside 2026 and 2027, or a duplicate |
| POST `/api/packages` | booker, director | `{"title":"Northbound spring","recipientName":"Jess Kowalski","recipientEmail":"jess@castingroom.example","talentIds":["…","…"]}` | `201 {"package":<package>}` | 422 for a talent that is not active |
| GET `/api/packages`, GET `/api/packages/{id}` | booker, director | — | `200` | |
| POST `/api/packages/{id}/revoke` | booker, director | `{}` | `200 {"package":<package>}` | `409 {"error":"already_revoked"}` |
| POST `/api/packages/{id}/regenerate` | booker, director | `{}` | `200 {"package":<package>}` | |
| GET `/api/applications?status=` | scout, director | — | `200 {"applications":[…]}` (drafts are never listed) | |
| GET `/api/applications/{id}/photos/{slot}` | scout, director | — | `200` `image/jpeg` | |
| POST `/api/applications/{id}/decision` | scout, director | `{"decision":"approve"\|"decline"}` | `200 <application>` | `409 {"error":"awaiting_guardian"}`, `409 {"error":"already_decided","decidedBy":"<name>","decidedAt":"…Z"}` |
| POST `/api/applications/{id}/sign` | scout, director | `{}` | `201 {"talent":<talent>}` | `409 {"error":"not_approved"}` |
| GET `/api/me/calendar-feed` | talent | — | `200 {"url":"…/feeds/<token>.ics"}` | |
| POST `/api/me/calendar-feed` | talent | `{}` | `201 {"url":"…"}` | |

`<package>` is `{"id","title","recipientName","recipientEmail","state":"active"|"revoked","url","issuedAt","expiresAt","talent":[{"talentId","displayName","decision"}]}`.

Licences, ledger and statements:

| Method and path | Who | Request | Success | Extra errors |
|---|---|---|---|---|
| POST `/api/licences` | accounts lead, director | `{"clientId":"…","talentId":"…","media":"digital","territory":"canada","firstUseDate":"2027-01-31","termMonths":1,"monthlyFeeCents":45000}` | `201 {"licence":<licence>}` | |
| GET `/api/licences?status=` | accounts lead, director | — | `200 {"counts":{"active","expiring","expired"},"licences":[<licence>]}` | |
| GET `/api/licences/{id}` | accounts lead, director | — | `200 {"licence":<licence>}` | |
| POST `/api/licences/{id}/extensions` | accounts lead, director | Header `Idempotency-Key`; `{"months":3,"version":1}` | `201 {"licence":<licence>,"extension":{"id","months","amountCents","killbillInvoiceId","extendedBy","extendedAt"}}` | `412 {"error":"stale_version","savedBy":"<name>","savedAt":"…Z"}`, `503 billing_unavailable` |
| POST `/api/talent/{id}/advances` | accounts lead, director | `{"amountCents":50000,"note":"Travel to Vancouver shoot"}` | `201 {"movement":<movement>}` | |
| GET `/api/talent/{id}/ledger` | accounts lead, director; the talent themselves | — | `200 {"balanceCents","movements":[<movement>]}` | |
| POST `/api/ledger/movements/{id}/reversal` | accounts lead, director | `{"reason":"Advance keyed twice"}` | `201 {"movement":<movement>}` | `409 {"error":"already_reversed","reversedBy":"<name>","reversedAt":"…Z"}`, `409 {"error":"not_invoiced"}` (a booking not yet invoiced), `503 billing_unavailable` |
| GET `/api/talent/{id}/statements/{YYYY-MM}` | accounts lead, director; the talent themselves | — | `200 <statement>` | |
| GET `/api/talent/{id}/statements/{YYYY-MM}.csv` | accounts lead, director; the talent themselves | — | `200` `text/csv; charset=utf-8` with `Content-Disposition: attachment; filename="statement-<slug>-<YYYY-MM>.csv"` | `503 storage_unavailable` |

`<licence>` is `{"id","clientId","clientCompany","clientTimeZone","talentId","talentDisplayName","media","territory","firstUseDate","termMonths","endsOn","endsAt","status":"active"|"expiring"|"expired","monthlyFeeCents","version","lastExtension"}`. `<movement>` is `{"id","kind":"booking"|"advance"|"reversal","reference","talentId","bookingId","reversalOf","reversedBy","createdBy","createdAt","officeDate","entries":[{"account","amountCents"}]}`. `<statement>` is `{"talentId","displayName","month","openingBalanceCents","lines":[{"movementId","officeDate","kind","reference","client","description","amountCents","balanceCents"}],"totals":{"earningsCents","advancesCents","reversalsCents","netCents"},"closingBalanceCents","advances":[{"movementId","amountCents","recoupedCents","outstandingCents"}]}`.

### Business rules (DP-02 to DP-04, DP-07, DP-08, DP-12 to DP-17, DP-20 to DP-26, DP-29, DP-30, DP-32 to DP-34, DP-36, DP-37, DP-41 to DP-44, DP-46, DP-48 to DP-50, DP-54, DP-58)

Visibility and roles. Staff (director, booker, accounts lead, scout) may read every member record. A talent may read only their own member, talent, ledger and statement records; any other id answers exactly like an unknown id. Only the agency director invites, changes roles, removes members, creates talent, manages rate cards and closures, imports, exports, withdraws, restores and erases. A director cannot change their own role or remove themselves (`own_membership`). Removing a member ends their sessions (`access_removed`). After a role change, the next request is judged by the new role.

Account replies. Forgot-password answers the same 202 body for any email. It emails a single-use reset link only when the email belongs to a member. An invitation answers the same 202 body for any email. It emails an invitation only when no member has that email; an existing member gets no email. Reset and invitation links work until used or replaced by a newer one for the same email. A wrong password and an unknown email both answer `invalid_credentials`. Role homes: director `/workspace/overview`, booker `/workspace/board`, accounts lead `/workspace/licences`, scout `/workspace/applications`, talent `/workspace/me`.

Offices and closure dates. Toronto uses America/Toronto and Vancouver uses America/Vancouver. "Office time" and "office date" mean the wall clock and calendar in the talent's office zone. Published closure dates:
- Toronto 2026: 01-01, 02-16, 04-03, 05-18, 07-01, 08-03, 09-07, 10-12, 12-25, 12-28.
- Toronto 2027: 01-01, 02-15, 03-26, 05-24, 07-01, 08-02, 09-06, 10-11, 12-27, 12-28.
- Vancouver 2026: 01-01, 02-16, 04-03, 05-18, 07-01, 08-03, 09-07, 09-30, 10-12, 11-11, 12-25.
- Vancouver 2027: 01-01, 02-15, 03-26, 05-24, 07-01, 08-02, 09-06, 09-30, 10-11, 11-11, 12-27.

A business day is a weekday that is not one of that office's closure dates. A closure the director adds recomputes `autoReleaseAt` for every placed or challenged option of that office whose automatic release is still in the future.

Option ladder. Each option holds one talent for one job day for one client. A talent-day holds at most three live (placed or challenged) options, ranked 1, 2 and 3 with no gaps. A new option takes the next rank. A fourth answers `ladder_full`. A second live option from the same client answers `client_already_holds`. A booked day answers `day_booked`. When placements race, each committed placement takes the next free rank in commit order, so ranks stay distinct and gapless. Legal transitions:

| From | Event | To | Effect |
|---|---|---|---|
| placed | release by staff | released (`manual`) | Options below move up one rank |
| placed | the 2nd option challenges | challenged | `challengeDeadline` = now + OPTION_CHALLENGE_SECONDS, truncated to whole seconds |
| challenged | the 1st holder confirms or releases before the deadline | confirmed or released | Challenge outcome emails go to both clients |
| challenged | the deadline passes | released (`challenge_timeout`) | The sweep promotes the 2nd and emails both clients |
| challenged | the challenging 2nd option leaves the ladder | placed | No emails |
| placed or challenged | confirm (rank 1 only) | confirmed | The day becomes booked; every other live option that day is released (`day_booked`) |
| placed or challenged | `releaseAt` reached | expired (`hold_expired` or `auto_release`) | Options below move up |

Illegal edges: a confirm on a non-1st option answers `not_first`. A challenge from anything but the 2nd answers `not_second`. A challenge while the 1st is challenged answers `already_challenged`. Any action on a released or expired option answers `option_released`. A confirm or release of a challenged 1st at or after its deadline answers `challenge_expired`. A confirm on an option already confirmed answers `already_booked`, naming who booked and when. Of two simultaneous confirms of the same option, exactly one wins. Every change raises the option's `version`. A PATCH with an older version answers `stale_version` naming the last saver.

Placement idempotency. `Idempotency-Key` is required on placement and on licence extension. It is scoped to the member and kept for 24 hours. A replay returns the original status, body and rank even if the ladder has changed since. A different body under the same key answers `idempotency_key_reused`.

Automatic release. `autoReleaseAt` is 12:00 office time on the latest business day strictly before the job day. For example, a Toronto job on Mon 15 Mar 2027 releases at Fri 12 Mar 2027, 12:00 Toronto time, which is `2027-03-12T17:00:00Z`. A Toronto job on Tue 16 Mar 2027, after the clocks change, releases at `2027-03-15T16:00:00Z`. A Vancouver job on Mon 15 Mar 2027 releases at `2027-03-12T20:00:00Z`. Placement is allowed only while `autoReleaseAt` is still in the future and the job day is no later than 2027-12-31; otherwise it is refused with the job-day field error.

Hold-until. `holdUntilLocal` is an office-local date and time in the talent's office zone. A time inside the spring-forward gap is refused; for example, 2027-03-14T02:30 in Toronto does not exist. A repeated autumn time means its first occurrence, so 2027-11-07T01:30 in Toronto is `2027-11-07T05:30:00Z`. The resolved instant must be strictly in the future and strictly before `autoReleaseAt`.

Sweep. Every app copy runs the same sweep at least every 5 seconds. Within 10 seconds of an instant passing, the sweep expires holds past `releaseAt`, releases challenged 1st options past their deadline (promoting and emailing), and sends licence reminders. Each effect happens exactly once however many copies run.

Calendar feed. Each talent has one private feed token of at least 32 random URL-safe characters. Regenerating replaces it, and the old token answers 404 at once. The feed holds one VEVENT per option of the talent, in every state:
- UID `option-<optionId>@rungboard.vesperrowe.example`.
- All-day `DTSTART;VALUE=DATE` on the job day and `DTEND;VALUE=DATE` on the next day (exclusive).
- `STATUS:TENTATIVE` while placed or challenged, with SUMMARY `<ordinal> option: <job title> for <company>, releases <time>`.
- `STATUS:CONFIRMED` once confirmed, with SUMMARY `Booked: <job title> for <company>`.
- `STATUS:CANCELLED` once released or expired, keeping the last SUMMARY.

`SEQUENCE` starts at 0 and rises by 1 on every change to the option (rank, state, hold-until, automatic release, job title). Lines end with CRLF, and the feed includes `X-WR-CALNAME:<display name> — Rungboard`. As RFC 5545 requires, text values escape a backslash, semicolon or comma with a backslash and write a line break as `\n`, and any line longer than 75 octets is folded with CRLF and one space; the SUMMARY formats above are the text before escaping.

Fees. Rate cards hold per-board `fullDayCents`, `halfDayCents` and `overtimeQuarterHourCents`, plus `usageBaseCents` per media. A booking uses the card with the greatest `effectiveFrom` on or before its job day, by the talent's board at confirm time. For each talent:
1. A day line: full or half day.
2. An overtime line: the started quarter hours, which is overtime minutes divided by 15 rounded up (0 to 600 minutes allowed), times the quarter-hour rate.
3. One usage line per usage row: base for the media × territory percent (canada 100, north_america 150, worldwide 250) × term percent (3 months 50, 6 months 75, 12 months 100) ÷ 10,000, rounded half up to the cent.

Lines of zero cents are left out. The talent's fees are the sum of their lines. The agency service fee is 20% of the group's talent fees, rounded half up to the cent. It is split across the group's talent in proportion to each talent's fees: each share is rounded down to the cent, and leftover cents go one at a time to the largest dropped fraction, with ties going to the earlier talent in the request's order. The shares always sum to the fee. Tax applies to talent fees plus the service fee, by the talent's office:
- Toronto: one line `HST 13%`.
- Vancouver: two lines, `GST 5%` and `PST 7%`.

Each tax line is rounded half up on its own. The total is talent fees plus the service fee plus every tax line.

Labels are fixed at confirm: `Day rate: <talent>`, `Half-day rate: <talent>`, `Overtime: <talent>, <q> quarter hours`, `Usage: <talent>, <Media>, <Territory>, <m> months` (Media names: Digital, Print, Out of home, Broadcast; Territory names: Canada, North America, Worldwide), `Agency service fee 20%`, and the tax labels above.

Fee lines in a booking:
- Day, half-day, overtime and usage lines are per talent, and carry that talent's `talentId`.
- Exactly one `service_fee` line per booking holds the whole service fee, with `talentId` null, whatever the group size. Each talent's share appears only as `serviceFeeShareCents` in the booking's `talent` list.
- Each tax line also appears exactly once per booking with `talentId` null. That is one line for Toronto and two for Vancouver, each computed on the whole group's talent fees plus the service fee.

For example, a Toronto group of three talent each with a day line and nothing else has five lines: three day lines, one service-fee line and one HST line. Its Kill Bill draft invoice has five items. A group confirm needs every option to be a 1st option for the same client, day and office, for distinct talent; otherwise 422 on `options`. For example, with the seed card: a Toronto Women talent on a full day with 50 overtime minutes and digital North America usage for 6 months has fees of 250,000 + 37,600 + 67,500 = 355,100 cents. The service fee is 71,020, HST is 55,396, and the total is 481,516 cents.

Confirm atomicity. A confirm does four things together: it creates the client's Kill Bill draft invoice, writes the booking and its paired ledger movement, queues the confirmation email in the mail outbox, and changes the options. If Kill Bill fails, nothing is written and the option stays 1st. If anything fails after the draft invoice exists, that invoice is voided. Booking states: `confirmed` at confirm, `invoiced` after Issue invoice, `corrected` after its movement is reversed. Issue invoice on an invoiced booking answers `already_invoiced`. Reversing a booking that is not yet invoiced answers `not_invoiced`.

Ledger. Every movement writes entries that sum to zero. Accounts are `talent:<talentId>`, `client:<clientId>`, `agency_fees`, `tax_payable` and `agency_cash`. Positive amounts on a talent account are owed to the talent. Movements:
- A booking writes +talent fees to each talent, +service fee to `agency_fees`, +tax to `tax_payable`, and −total to the client.
- An advance writes −amount to the talent and +amount to `agency_cash`.
- A reversal writes the exact mirror of one movement, references it, and marks it reversed. A movement can be reversed once (`already_reversed`), and entries are never edited.

A talent's balance is the sum of their account's entries. Recoupment: the talent's booking earnings, net of their reversals, are applied to unreversed advances oldest first. Each advance shows `recoupedCents` and `outstandingCents`.

Statements. A statement covers one office calendar month for one talent. Booking lines use the job day. Advance and reversal lines use the office date on which they were recorded. Opening balance is the sum of entries before the month, and closing balance is opening plus the month's lines. `netCents` equals the sum of the lines, and each line's `balanceCents` is the running balance. Totals are recomputed on every read, so they match after any reversal.

Statement CSV columns, in order: `Date`, `Type`, `Reference`, `Client`, `Description`, `Amount (CAD)`, `Balance (CAD)`.
- `Type` is Booking, Advance or Reversal.
- Amounts are plain decimals with two places and a leading minus when negative, for example `-500.00`.
- Every field is wrapped in double quotes, with inner quotes doubled.
- Every row, including the last, ends with CRLF. The file is UTF-8 without a byte-order mark.
- Text cells (Reference, Client, Description) that begin with `=`, `+`, `-`, `@`, a tab or a carriage return get a leading apostrophe. Number cells are never altered.

Licences. `endsOn` is `firstUseDate` plus the total months, where the total is the term plus every extension. When the target month is shorter, the day clamps to its last day, so 2027-01-31 plus 1 month ends on 2027-02-28 and plus 2 months ends on 2027-03-31. `endsAt` is the start of the day after `endsOn` in the client's time zone, and that instant is already expired. Status is computed on every read:
- `expired` once `endsAt` has passed.
- Otherwise `expiring` when today's date in the client's zone is within the 30 calendar days ending on `endsOn`.
- Otherwise `active`.

Counts always equal the rows of each status. One renewal reminder goes out per licence per `endsOn`, within 10 seconds of the licence being expiring, including at recording or after an extension that leaves it expiring. An extension adds `months` (1 to 36), costs `monthlyFeeCents` × months and needs the current `version` (`stale_version` otherwise, naming the last extender). Its replay and conflict follow the idempotency rule.

Cast requests. All single-line fields (name, company, email, office) have every carriage return, line feed and other control character replaced by one space before storing. `brief` keeps line breaks but appears only in the email body. Talent must be active public slugs (1 to 12). A double submit sends one key, so it creates one request and one email. Limit: 5 cast requests per client address per 60 seconds. Every request to `POST /api/cast-requests` counts, and step checks never count. The sixth answers 429, where `<n>` is the whole seconds, rounded up and at least 1, until the oldest counted request leaves the window. The client address is the first address in the `X-Forwarded-For` header when the request carries one (the agency's proxy sets it), otherwise the connecting socket's address.

Applications. Limit: 3 new drafts per client address per 60 seconds, counted the same way. Bio: at most 600 user-perceived characters (grapheme clusters, so a family emoji or a flag counts as 1); 600 is allowed and 601 answers 422. Photos: four required slots (front, profile, full_length, smile). Each file must decode as a JPEG, PNG or WebP image, whatever its name or declared type; anything else, including SVG, answers 422 on `file`.

Minors: an applicant is a minor when their 18th birthday falls after today's date in the chosen office's zone. A 29 February birthday counts as 1 March in non-leap years.

Application transitions:
- Submit moves `draft` to `submitted` for an adult, or to `awaiting_guardian` for a minor, and emails the guardian a single-use link.
- The link expires CONSENT_LINK_TTL_SECONDS after issue. The expiry instant itself is expired.
- The guardian's approve moves `awaiting_guardian` to `submitted` with consent recorded; decline moves it to `declined`. Any later use of the link answers `link_used`.
- The scout decides only `submitted` applications: approve to `approved`, decline to `declined`. A decision on `awaiting_guardian` answers `awaiting_guardian`, and a second decision answers `already_decided`.
- Sign moves `approved` to `signed` and creates an active New Faces talent with the four photos as its first portfolio photos. Sign on anything else answers `not_approved`.

Packages. A link is issued at creation and at each regeneration. It expires PACKAGE_LINK_TTL_SECONDS after issue, and the expiry instant itself is expired (`link_expired`). A revoked link answers `link_revoked`, and a link replaced by regeneration answers `link_replaced`. Regeneration also reactivates a revoked package. Through the link, only decisions can be written; any other method on a link path answers 405. Withdrawn talent drop out of the view, the count and the ZIP at once.

Measurements. Stored as whole centimetres. Inch input converts as inches × 2.54 rounded half up to a centimetre. Display shows both units: inches are centimetres ÷ 2.54 rounded half up to a whole inch. Height is written as feet and inches (173 cm shows `173 cm / 5 ft 8 in`), and chest, waist and hips in inches only (`84 cm / 33 in`).

Reach. Below 1,000, show the whole number. From 1,000, show thousands with K. From 1,000,000, show millions with M. From 1,000,000,000, show billions with B. The value is truncated to one decimal, never rounded up, and a trailing `.0` is dropped. So 374,650 shows 374.6K, 999,999 shows 999.9K, 1,000,000 shows 1M and 999 shows 999. A total adds the exact counts, then formats the sum.

Portfolio reorder. Each portfolio has a `portfolioVersion` that rises on every upload, delete or reorder. A reorder with an older version answers `stale_version` with the name of the member who saved the current order and when. The server's order stays.

Roster import. The CSV header must be exactly `Email,First Name,Last Name,Date of Birth,Office,Division,Height,Chest,Waist,Hips,Instagram,TikTok,YouTube`.

Matching, in order:
1. Email, compared trimmed and case-insensitive, against non-erased talent.
2. First and last name (case-insensitive, inner spaces collapsed, accents kept) together with an equal date of birth (`YYYY-MM-DD`).
3. Otherwise, create a talent. Earlier rows in the same file count as existing.

A matched row fills only the talent's empty fields: `merged` if it filled any, `unchanged` if not. Non-empty values are never overwritten. A row is an orphan, with a reason, when:
- it has neither email nor date of birth (`no_identity`);
- it has an unknown office (`unknown_office`; accepted values are Toronto, TOR, Vancouver, VAN);
- it has an unknown division (`unknown_division`; accepted values are Women, Men, Creators, Digital meaning Creators, and New Faces);
- a new talent's height cannot be parsed (`bad_height`);
- or a date cannot be parsed (`bad_date`).

Units:
- Height accepts `5'9"`, `5' 9"`, `5 ft 9 in`, `69 in`, `175 cm`, `175` (a bare number means centimetres) and `1.75 m`. Feet and inches convert as total inches × 2.54, rounded half up.
- Chest, waist and hips accept `34"`, `34 in`, `86 cm` and `86`.
- Reach accepts digits with optional thousands commas.

Re-importing the same file creates nothing and changes nothing. The roster export has the same header, lists active talent only, and follows the CSV quoting and neutralisation rules above.

Withdraw, restore, erase. Withdraw takes effect at once. The talent is no longer on public boards or in board counts, search, packages, the ZIP, their calendar feed or the roster export, and is no longer on the availability board. Their options keep running and the sweep still applies. Restore returns the talent to `active` with the same packages in the same positions with the same decisions, the same feed token and the same board places. Erase works from active or withdrawn and is final. It:
- replaces names with the placeholder `Erased talent`;
- clears email, phone, home address, date of birth, guardian details, measurements, reach and office note;
- deletes the talent's MinIO objects, their member account and feed token, and their package entries;
- deletes every unsent outbox email that mentions them.

Bookings, fee amounts, ledger entries and statements stay, with labels showing `Erased talent`. The profile address of a withdrawn or erased talent answers the gone page with HTTP 410.

Formats on screen and in email. Office times use the `<time>` format, days the `<date>` format, licence end dates the day format in the client's zone, months `Month YYYY` (March 2027), and money `CAD 1,234.50` (currency code, thousands commas, two decimals).

### Services (DP-12, DP-14, DP-22, DP-25, DP-27, DP-29, DP-30, DP-36, DP-38, DP-43, DP-45, DP-50, DP-60)

Kill Bill:
- Each client has one CAD account with external key `rungboard-client-<clientSlug>`, the company as its name and the contact email. The app creates it on first use.
- A confirm adds one external charge per booking fee line (service fee and tax lines included) without committing, so Kill Bill holds one DRAFT invoice whose item descriptions are the line labels and whose amounts are the line cents as dollars.
- Issue invoice commits that invoice, so its Kill Bill status becomes COMMITTED.
- A licence extension adds one committed external charge, described as `Usage licence renewal: <talent>, <Media>, <Territory>, <months> months`, for `amountCents` as dollars.
- A booking reversal records one credit on the client's account equal to the invoice total, described as `Reversal of <reference>`.

When Kill Bill is unreachable, each of these actions answers `503 billing_unavailable`, records nothing in the app, and announces the billing outage copy from Feedback states (the confirm has its own copy). Every other action keeps working.

Mailpit. Every email goes through the PostgreSQL outbox. Any app copy delivers pending mail, each message exactly once, within 10 seconds when Mailpit is reachable; otherwise it retries. Every email is sent from `MAIL_FROM` (`Vesper & Rowe Talent <bookings@vesperrowe.example>`). Header values come only from cleaned single-line fields. Links are absolute, built from `APP_BASE_URL` when it is set and otherwise from `http://127.0.0.1:<port>`.

| Email | To | Subject |
|---|---|---|
| Invitation | Invitee | You're invited to Rungboard |
| Password reset | Member | Reset your Rungboard password |
| Cast request notification | `toronto-desk@vesperrowe.example` or `vancouver-desk@vesperrowe.example` by the request's office | Cast request from <company>: <n> talent |
| Booking confirmation | Client contact | Booking confirmed: <job title> on <date> |
| Challenge outcome | Each of the two clients, once | Option update: <talent> on <date> |
| Package link | Package recipient | Casting package: <title> |
| Guardian consent | Guardian email | Consent needed for <first name>'s application to Vesper & Rowe |
| Licence renewal reminder | Client contact | Usage licence ending <date>: <talent> |

The booking confirmation body lists the job title, the day, the talent display names, every fee line with its label and amount, the total and the rate card name. It attaches `booking-<reference>.ics`, written with the feed's line endings, escaping and folding: one VEVENT, `METHOD:PUBLISH`, all-day on the job day with an exclusive end, SUMMARY `<job title>: <talent names>`, and a DESCRIPTION with the total. Neither the email nor the file ever contains a home address, phone, date of birth, guardian detail, office note, or any other client's name or option. A challenge outcome email states only the recipient client's own result (`Your option is now 1st.`, `Your 1st option was released.`, `Your 1st option is confirmed.` or `This day is now booked.`) and never names the other client.

MinIO (bucket `S3_BUCKET`). Every stored photo is decoded, rotated by its camera orientation, stripped of all metadata (location included), scaled so its longer side is at most 2,400 pixels, and saved as JPEG. Object keys:
- `portfolio/<talentId>/<photoId>.jpg`
- `applications/<applicationId>/<slot>.jpg`
- `packages/<packageId>/photos.zip`, rebuilt on each download
- `statements/<talentId>/<YYYY-MM>.csv`, written on each export

An upload stores its object before its database row and removes the object if the row fails, so nothing is half-written. The ZIP holds `<slug>/<nn>.jpg` (portfolio position from 01) for each active talent and a root `manifest.json`: `{"package":"<title>","generatedAt":"…Z","files":[{"name":"ines-okoro/01.jpg","bytes":123456,"sha256":"<hex>"}]}`. Entry names never contain `..` or a leading slash. When MinIO is unreachable, uploads, the ZIP and CSV exports answer `503 storage_unavailable` and nothing is recorded.

PostgreSQL holds every other record: talent, options, bookings, fee lines, the ledger, licences, statements, packages, applications, idempotency keys, sessions, rate-limit counters and the outbox.

### Seed data (DP-01, DP-05 to DP-08, DP-26, DP-44)

Every seeded person and business is invented. The app seeds once, when the database is empty, and seeding is safe when several copies start together.

Members (every password is `Rungboard-2027`):

| Name | Email | Role | Office |
|---|---|---|---|
| Margot Vesper | director@vesperrowe.example | agency_director | toronto |
| Priya Shah | priya.shah@vesperrowe.example | booker | toronto |
| Jonah Ellis | jonah.ellis@vesperrowe.example | booker | toronto |
| Mei Castillo | mei.castillo@vesperrowe.example | booker | vancouver |
| Rosa Delgado | rosa.delgado@vesperrowe.example | accounts_lead | toronto |
| Theo Marchand | theo.marchand@vesperrowe.example | scout | vancouver |
| Ines Okoro | ines-okoro@talent.vesperrowe.example | talent (Ines Okoro) | toronto |
| Callum Reid | callum-reid@talent.vesperrowe.example | talent (Callum Reid) | toronto |

Clients:

| Slug | Company | Contact | Email | Time zone |
|---|---|---|---|---|
| northbound | Northbound Outfitters | Sam Arsenault | sam@northbound.example | America/Toronto |
| lakeshore | Lakeshore Beauty | Kit Ferreira | kit@lakeshore.example | America/Toronto |
| tidewater | Tidewater Coffee Co. | Robin Aucoin | robin@tidewater.example | America/Halifax |
| cedar-pine | Cedar & Pine Apparel | Alex Nakamura | alex@cedarpine.example | America/Vancouver |

Talent. All are active, and each has three generated portrait illustrations as portfolio photos. Measurements are in cm; reach is exact counts.

| Slug | Display name | Office | Board | Height | Chest | Waist | Hips | Instagram | TikTok | YouTube |
|---|---|---|---|---|---|---|---|---|---|---|
| ines-okoro | Ines Okoro | toronto | women | 178 | 84 | 61 | 89 | 374650 | 125350 | 0 |
| amara-lindqvist | Amara Lindqvist | toronto | women | 175 | 81 | 60 | 88 | 999999 | 0 | 0 |
| sofia-reyes-park | Sofia Reyes-Park | toronto | women | 173 | 83 | 62 | 90 | 999 | 0 | 0 |
| nadia-belhaj | Nadia Belhaj | toronto | women | 180 | 82 | 61 | 89 | 1000000 | 0 | 0 |
| elodie-fournier | Élodie Fournier | toronto | women | 176 | 80 | 59 | 87 | 48210 | 3020 | 0 |
| june-takahashi | June Takahashi | vancouver | women | 174 | 82 | 60 | 88 | 22140 | 61875 | 0 |
| maren-holt | Maren Holt | vancouver | women | 177 | 83 | 61 | 90 | 8800 | 0 | 0 |
| talia-brandt | Talia Brandt | vancouver | women | 172 | 81 | 62 | 89 | 151999 | 48001 | 0 |
| callum-reid | Callum Reid | toronto | men | 188 | 97 | 76 | 94 | 64300 | 0 | 0 |
| marcus-adeyemi | Marcus Adeyemi | toronto | men | 185 | 99 | 79 | 96 | 1250000 | 0 | 0 |
| tomas-varga | Tomas Varga | toronto | men | 183 | 96 | 77 | 95 | 5400 | 0 | 0 |
| kenji-morales | Kenji Morales | vancouver | men | 186 | 98 | 78 | 95 | 31750 | 0 | 0 |
| olu-bankole | Olu Bankole | vancouver | men | 189 | 100 | 80 | 97 | 87420 | 12580 | 0 |
| ethan-mcleod | Ethan McLeod | vancouver | men | 184 | 95 | 76 | 93 | 2100 | 0 | 0 |
| riley-chen | Riley Chen | vancouver | creators | 168 | 86 | 68 | 92 | 2450000 | 1830500 | 412000 |
| zara-qureshi | Zara Qureshi | toronto | creators | 165 | 84 | 66 | 91 | 712300 | 1499999 | 0 |
| noah-belanger | Noah Bélanger | toronto | creators | 179 | 94 | 78 | 94 | 99950 | 0 | 250050 |
| lumi-sato | Lumi Sato | vancouver | creators | 170 | 85 | 66 | 91 | 640000 | 0 | 0 |
| ava-sinclair | Ava Sinclair | toronto | new_faces | 171 | 80 | 60 | 86 | 0 | 0 | 0 |
| leo-dubois | Léo Dubois | vancouver | new_faces | 187 | 94 | 74 | 92 | 1200 | 0 | 0 |

Private seed values. Every talent has the email `<slug>@talent.vesperrowe.example`, an invented phone number, home address and date of birth, and an office note. Ines Okoro: home address `41 Wychwood Avenue, Toronto ON M6G 2T7`, date of birth `2001-05-14`, office note `Prefers morning call times`. Ava Sinclair: date of birth `2010-03-02`, guardian `Morgan Sinclair`, `morgan.sinclair@guardian.example`, `+1 416 555 0190`. Léo Dubois: date of birth `2007-06-19`.

Rate card `2026 standard`, effective `2026-01-01`:
- women: full day 250,000, half day 150,000, overtime per quarter hour 9,400 cents
- men: 220,000, 130,000, 8,300
- creators: 180,000, 110,000, 6,800
- new_faces: 120,000, 75,000, 4,500
- usage base: digital 60,000, print 80,000, out_of_home 120,000, broadcast 200,000 cents

Relative seed for screens only; tests create their own records:
- Ines Okoro holds a 1st option for Northbound Outfitters and a 2nd for Lakeshore Beauty on the office's 5th business day after first start, and a 1st for Tidewater Coffee Co. on the 7th.
- Three licences with Northbound Outfitters for Ines Okoro: one Active, one Expiring and one Expired at first start.
- An advance of CAD 500.00 for Ines Okoro.
- One submitted adult application from Jordan Ashby (Toronto).

## Technical requirements

### Deployment (DP-52)

The runtime is Node.js 22 LTS with npm, and the app is written in TypeScript. `/app/run.json` holds string commands and the schema marker, for example:

```json
{"_schema":"run-manifest-v1","install":"npm ci","build":"npm run build","serve":"npm run start"}
```

The server binds `0.0.0.0` on port 4173, or on `APP_PUBLIC_PORT` when set. `GET /api/health` answers HTTP 200 `{"status":"ok"}` once the database is reachable and start-up has finished. Every start-up step (schema, seed, bucket checks) is safe when several copies start together against one database.

### Configuration and secrets (DP-22, DP-36, DP-43, DP-60)

Read at start and never hard-coded or sent to the browser:
- `DATABASE_URL`
- `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_FORCE_PATH_STYLE`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`
- `KILLBILL_URL`, `KILLBILL_USERNAME`, `KILLBILL_PASSWORD`, `KILLBILL_API_KEY`, `KILLBILL_API_SECRET`
- `SMTP_HOST`, `SMTP_PORT`, `MAIL_FROM`
- `APP_BASE_URL` (optional), `APP_PUBLIC_PORT` (optional)
- `OPTION_CHALLENGE_SECONDS` (default 14400), `PACKAGE_LINK_TTL_SECONDS` (default 1209600), `CONSENT_LINK_TTL_SECONDS` (default 604800), `SESSION_TTL_SECONDS` (default 28800)

### Server boundary (DP-53, DP-58)

- The browser app and API share one origin, and the server sends no cross-origin headers.
- Request size limits are those in the API section.
- The server never serves source files, the run manifest, environment files, lockfiles or any credential.
- Photos and files come only from the app's own routes; the browser never receives MinIO or Kill Bill addresses.
- When Kill Bill or MinIO is unreachable at boot or later, the server still starts and stays healthy, and only the actions that need that service answer their 503.
- When PostgreSQL is unreachable at boot, the server retries until it connects, and health answers 503 `{"status":"starting"}` until then.

### Browser support and performance (DP-55)

Support the current Chromium, Firefox and Safari at 375x812, 768x1024 and 1280x800. Every screen is usable within three seconds on a local run, and every API call answers within one second apart from photo processing, ZIP building and imports. Fonts are bundled with the app.

## Working rules

- IF-01: `/app/run.json` contains exactly the string keys `_schema` (value `run-manifest-v1`), `install`, `build` and `serve`.
- IF-02: `/app/THIRD_PARTY_NOTICES.md` names every shipped package with its version and licence. Shipped packages means the production dependency tree from `npm ls --omit=dev --all --json`.
- IF-03: Every shipped package, and both fonts, use one of MIT, ISC, BSD-2-Clause, BSD-3-Clause, Apache-2.0, 0BSD or OFL-1.1; a package whose licence is an SPDX `OR` expression counts when any of its choices is on this list.
- IF-04: The app uses no datastore other than the provided PostgreSQL database and MinIO bucket: no SQLite, no Redis, no data files written to disk.
- IF-05: Fraunces and Hanken Grotesk are bundled with the app, and no page requests fonts, scripts or styles from another host.
- IF-06: `/app`, outside `node_modules`, ships no Docker Compose file of its own (no file named `compose*.yml`, `compose*.yaml`, `docker-compose*.yml` or `docker-compose*.yaml` at any depth) and no env file (no file named `.env` or `.env.*` at any depth other than `.env.example`).
- IF-07: `package-lock.json` is committed, and `npm ci` installs from it.

## Engineering standards

- The code is idiomatic, strictly typed TypeScript with no `any` escapes.
- Names match the terms in this brief: option, rank, ladder, challenge, hold-until, booking, fee line, rate card, licence, advance, reversal, statement, package, application.
- Each domain rule (an option transition, the release instant, the fee and split arithmetic, a licence status, recoupment, a display format) is decided in exactly one place in the source.
- No abstraction has only one implementation.
- There is no dead, commented-out or unreachable code, and no defensive checks for states the rules make impossible.
- Every API error uses the one error shape from the API section.
- Money is integer cents end to end, and instants are handled with real time-zone rules, never fixed offsets.
- The code contains no features, screens or endpoints beyond this brief.
