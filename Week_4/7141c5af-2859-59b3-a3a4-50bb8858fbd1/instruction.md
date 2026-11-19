# Bottega Semenza Semenza Desk

Semenza Desk is the working desk of one independent upholsterer and furniture conservator in Turin, who re-covers and restores twentieth-century design chairs for private owners, galleries and hotels in Turin, London, New York, Kyoto and Dubai. It carries one chair from stamp and condition pins through material, dye lot, hide layout, estimate, private client page, bench weeks and courier collection to a signed conservation dossier as a PDF. It also has a public site. The backend services are Postgres, MinIO, Mailpit, WireMock (standing in for two invented third-party APIs printed in full here), Gotenberg and Meilisearch. Out of scope: payments of any kind (estimates only state amounts), staff, roles, extra datastores, WebGL, canvas 3D and video. All imagery is procedural (generated drawings of invented chairs, generated grounds and leather grains) or files people upload.

## Problem and users

A conservator working alone holds each job together with paper condition sketches, an old workbook, a supplier's price list, generic estimating tools and long mail threads. Factory hide-nesting systems assume a scanner and a cutting table. Condition-report apps stop at the report. Neither knows a dye lot. The cost is direct:

- A second dye lot shows on a finished chair and cannot be matched later.
- A waste figure guessed per pattern swings widely and turns into a wrong estimate.
- A courier collection misses by an hour when the clock change falls on different dates in two towns.
- A glue line is loaded before it has cured.
- A client is written to in the wrong language.
- A material is remembered only by half its name, in one of four languages. A search box that forgives typing slips across the library, clients and pieces is how the conservator reaches every job. That box runs on Meilisearch, and the desk does not work without it.

Users:

- **Conservator (daily, all screens).** Records each chair, finds its material, holds one dye lot, lays the pattern on a hide, estimates, sends the private client page, sets out the bench weeks, books the courier and delivers the dossier. Three terms are used throughout. "Sign-off by typed name" is the product's approval by typed name. "The materials list file" is the materials schedule file (the download). "Repeat key" is the request key sent as the `Idempotency-Key` header on the supplier's `POST /v2/holds` and the courier's `POST /v1/collections`.
- **Client (occasional, only the private client page).** Reads the page in their own language, answers the seat-height question and gives approval by typed name.
- **Visitor (occasional, only the public site).** Reads the home page, the work page and finished cases, and sends an enquiry.

A second seeded conservator exists only to prove that one desk's data never reaches another.

## Journeys

1. **From stamp to condition.** Signed in with an empty search box on the Pieces list, the conservator adds a chair with its stamp number, places condition pins by keyboard or touch, and uploads before photographs many at once. The end state is a piece with pins in reading order and photographs marked `Stored`.
2. **From half a name to a held lot.** The conservator types a misspelt half-remembered material name into the search box, lands on the material in the library, reads its stock from the supplier and holds one dye lot for the piece. The end state is a hold whose state and last day the server has stated.
3. **Hide lay.** On a piece's hide, the conservator lifts each pattern piece from the tray, moves it by keyboard, mouse or phone bar, and asks the server to place it. Refused places by keyboard or phone bar say why and keep the piece lifted; a refused mouse drop says why and glides home. The end state is a used-leather figure beside the hide, which fills in the estimate.
4. **Estimate and client page.** The conservator works out an estimate whose totals change in place, saves it and sends the private client page. The client opens the mailed address in their own language, answers the seat-height question and signs off by typed name. The end state is a signed-off estimate, with the answer on the conservator's open screen.
5. **Bench and glue.** The conservator lays out the week's frame and cover jobs, moves cards by Alt+arrow or dialog, and records glue laid. A cover job placed too early is refused with the server's cure time. The end state is a week the glue rule allows.
6. **Collection and dossier.** The conservator asks the courier for a quote, books a collection in the client's local wall time and sees `Booked` once the label is stored. They then make the dossier from the signed-off estimate and sign it. The end state is a stored, signed PDF and a dossier history.
7. **Old workbook.** The conservator previews an old workbook file with new, matched and refused rows, saves it, saves it again and sees nothing change. The end state is the file kept byte for byte and the desk holding its rows exactly as written.
8. **A visitor's enquiry and a closed client.** A visitor reads a finished case through the numbered rail and sends an enquiry, which reaches the conservator by mail. Separately, the conservator closes a client, can bring it back within the wait, and after the wait reads `Erased` once everything is gone.

## Mandatory requirements

This is the complete list of mandatory requirements; every check traces to one of these lines and the detailed sections below.

- **DP-01 — Desk access** A new desk signs up, signs in with its email and password, signs out, changes its password so that its other sessions end at once and the new password works, and the sign-in form lands on `/pieces` with a live session, with the status codes published in API.
- **DP-02 — Clients on one desk** The conservator creates, reads, renames and deletes a client, and a client of another desk answers 404 exactly like an unknown id in the same shape.
- **DP-03 — Public site journey** `Work` opens its panel with focus kept and Tab or Down entering, the work filter and the shared drawing move as published, the case rail follows its rule at top, middle and very bottom, and the 4th enquiry, a line break in a name and a known address behave as published; checked on `/work` and POST /api/enquiries with the Work panel: an oversized request with no session answers 413 as JSON, instants are whole-second UTC with a Z, the session cookie has its published attributes, SR1 to SR28 hold, its keyboard and 375x812 touch journeys check SR8, SR11, SR12, Announcements copy and Problems links, its rare-state copy, precision rule and motion on the reply, refused and interrupted paths are read, and its screen meets the screen rules.
- **DP-04 — Public pages in the first response** The home page, the work page and every case page carry their text and level-one heading in the server's first response with no script run, and each has its published title.
- **DP-05 — Work panel** The header's `Work` opens a panel of six case tiles and a preview that changes in place, closes on Escape with focus back on `Work`, is a full-height panel at 375, and its tiles leave the Tab order the moment it starts closing.
- **DP-06 — Work page and shared drawing** The work page's kind filter lives in the URL with one history entry per change, leaving and entering items move as the same elements, and pressing a case moves its drawing to the case page's hero as one element, as qualified in Interactions.
- **DP-07 — Case page rail** A case page's six numbered sections have a rail that marks the section being read by the published line, jumps with focus on the heading when a number is pressed, and stays in view inside its own frame at 375.
- **DP-08 — Enquiries** An enquiry reaches the conservator by mail with a line break in a name read as a space, the same address is limited per window with Retry-After, and new and known addresses get the same answer.
- **DP-09 — Clients and pieces journey** The Pieces list keeps filters, sort and page in the URL and Back returns to the same place, paging is stable while pieces arrive, the action menu opens uncut on a framed table's last row, the stamp rules, search rules and closing rules hold on the primary, short-timers, MinIO-down and search-down copies; checked on `/pieces` and POST /api/pieces with the `New piece` dialog and the action menu: an oversized request with no session answers 413 as JSON, instants are whole-second UTC with a Z, the session cookie has its published attributes, SR1 to SR28 hold, its keyboard and 375x812 touch journeys check SR8, SR11, SR12, Announcements copy and Problems links, its rare-state copy, precision rule and motion on the reply, refused and interrupted paths are read, and its screen meets the screen rules.
- **DP-10 — Stamp numbers** A stamp number has eight digits ending in a Luhn check digit and is unique on its desk, with the refusals published in Feedback states.
- **DP-11 — Pieces list** The Pieces list filters by client and state, sorts by title or due date, pages 25 at a time with a cursor that never repeats or skips a piece while new ones arrive, and every row's `Actions for <piece title>` menu opens uncut.
- **DP-12 — Search through the engine** GET /api/search answers only from Meilisearch across material names, codes, client names and piece titles, forgives one typing slip in a word of five letters or more, holds each desk apart, finds a new or renamed piece within 5 seconds, and refuses over-long text, as qualified in Business rules.
- **DP-13 — Closing and erasing clients** A closed client can be brought back within the wait exactly as it was, and after the wait is erased from Postgres, MinIO and Meilisearch, reading `Erased` only after both providers have confirmed each deletion.
- **DP-14 — Condition and photographs journey** By keyboard `Add a pin` starts a crosshair at the centre and saved pins keep their values and one Tab stop, the popover opens uncut at a drawing's edge, markup renders only as published, uploads run many at once with rows of their own, the file-size, content, repeat and outage rules hold, and the slider follows its rule; checked on `/pieces/<id>/condition` and POST /api/pieces/<id>/pins with the `Pin` dialog and popover: an oversized request with no session answers 413 as JSON, instants are whole-second UTC with a Z, the session cookie has its published attributes, SR1 to SR28 hold, its keyboard and 375x812 touch journeys check SR8, SR11, SR12, Announcements copy and Problems links, its rare-state copy, precision rule and motion on the reply, refused and interrupted paths are read, and its screen meets the screen rules.
- **DP-15 — Condition pins** Pins are placed by tap, click or keyboard crosshair at percent coordinates to one decimal, form one keyboard composite with a single Tab stop ordered by y then x, and removing one moves focus to the next or to `Add a pin`.
- **DP-16 — Pin note markup** Pin notes render bold, italic and links to http, https and mailto addresses only, and anything else shows as plain text on every screen, the client page and the PDF.
- **DP-17 — Photograph upload** A photograph is judged from its own header bytes, may be at most 8,000,000 bytes counted on the file alone, answers 413 before anything else above that, and is kept in MinIO byte for byte with `Stored` shown only after MinIO has confirmed.
- **DP-18 — Before and after slider** A before and after pair compares with a slider whose keys, URL value and spoken value follow the published rule in both reading directions.
- **DP-19 — Material library journey** Swatches keep one Tab stop per family with one choice across families, a focused swatch is never covered, the compare tray holds four, refresh is all or nothing, stock and holds make the published calls in the WireMock journal, and the 429, connection failure and no-single-lot refusals read their copy; checked on `/library` and POST /api/pieces/<id>/holds with the `Hold a dye lot` dialog: an oversized request with no session answers 413 as JSON, instants are whole-second UTC with a Z, the session cookie has its published attributes, SR1 to SR28 hold, its keyboard and 375x812 touch journeys check SR8, SR11, SR12, Announcements copy and Problems links, its rare-state copy, precision rule and motion on the reply, refused and interrupted paths are read, and its screen meets the screen rules.
- **DP-20 — Library refresh** `Refresh library` reads all supplier pages or changes nothing, and the new entries are searchable only once Meilisearch has confirmed.
- **DP-21 — Swatches and compare tray** Swatches are grouped under sticky family headings as radio groups with one choice across the library, a choice changes the chair drawing in place, and up to four go in a compare tray whose members close up as the same elements when one leaves.
- **DP-22 — Stock reads** Choosing a material shows its lots read by the server, the latest choice wins over a late answer, and the same code never calls the supplier twice within STOCK_CACHE_SECONDS.
- **DP-23 — Dye lot holds** A hold makes one supplier call per piece, material and lot with one repeat key, all hides on a piece come from one lot, and hold state and retry minutes are decided by the server.
- **DP-24 — Hide layout journey** By keyboard, mouse at 1280 and bottom bar at 375, the five pattern pieces lift, move, rotate, return and place as published, each refusal reads its copy in order, with the piece still lifted by keyboard and bar and back home after a mouse drop refused for its place, the figure reads its exact values, a refresh with no new data starts no motion, another window's change moves that one piece and a stale save is refused; checked on `/pieces/<id>/hide` and PUT /api/pieces/<id>/layout/placements/<name> with the `Clear the hide` dialog: an oversized request with no session answers 413 as JSON, instants are whole-second UTC with a Z, the session cookie has its published attributes, SR1 to SR28 hold, its keyboard and 375x812 touch journeys check SR8, SR11, SR12, Announcements copy and Problems links, its rare-state copy, precision rule and motion on the reply, refused and interrupted paths are read, and its screen meets the screen rules.
- **DP-25 — Hide lay controls** The hide is one keyboard composite with one Tab stop and published keys, a mouse drag at 1280 does the same, and at 375 a bottom bar does it all with no drag.
- **DP-26 — Placement decisions** The server refuses a rotation the grain forbids, then decides each placement in the order off the hide, then flaw, then overlap, with touching edges allowed, and answers the used-leather figure half up on the exact value.
- **DP-27 — Hide lay motion** Lift, step, rotation, tray move, return and figure roll run for their published times as the same element, a further press during a glide carries on from where the piece is, and reduced motion shows each end state at once with the same function.
- **DP-28 — Stale layout saves** Saving over a layout changed elsewhere answers 412 with the lifted piece still lifted, and a piece stays lifted with its position through any refresh.
- **DP-29 — Estimates journey** Totals change in place on input with each settled change announced once, every worked amount and currency form is exact, hides, quarter metres and milestones are exact, a rate taking effect today applies only to new estimates, extra fields change nothing and a stale save keeps the dialog as typed; checked on `/pieces/<id>/estimate` and POST /api/pieces/<id>/estimates with the `Edit estimate` dialog: an oversized request with no session answers 413 as JSON, instants are whole-second UTC with a Z, the session cookie has its published attributes, SR1 to SR28 hold, its keyboard and 375x812 touch journeys check SR8, SR11, SR12, Announcements copy and Problems links, its rare-state copy, precision rule and motion on the reply, refused and interrupted paths are read, and its screen meets the screen rules.
- **DP-30 — Exact amounts and tax** Amounts are half up on the exact value, stored in minor units and printed in the published form for EUR, GBP, USD, JPY and AED, with tax on the subtotal by the client's country.
- **DP-31 — Hides, metres and milestones** Hides come from pattern area plus waste over the chosen lot's average rounded up, fabric from quarter metres rounded up, and the three milestones always sum exactly by the published rule.
- **DP-32 — Labour rates by date** A labour rate that takes effect on a Turin date applies to new estimates only, and earlier estimates keep theirs on every screen.
- **DP-33 — Estimate requests** Saving an estimate replaces the piece's open one, ignores any price, total, state or other desk's id sent under an unpublished key in the body, answers 412 over a change made elsewhere, and a signed-off estimate never changes.
- **DP-34 — Client page journey** The page works touch first in all four languages with `lang` and `dir` in the first response, mirrored in Arabic, reads heights the local way, ends at its instant answering 410 from the server, carries an unguessable address and no private data, mails once and reminds once, folds typed names, refuses a replaced estimate, signs off one time across two windows and reaches the conservator within 5 seconds; checked on `/c/<token>` and POST /api/client-pages/<token>/answer with the `Your answer` sheet: an oversized request with no session answers 413 as JSON, instants are whole-second UTC with a Z, the session cookie has its published attributes, SR1 to SR28 hold, its keyboard and 375x812 touch journeys check SR8, SR11, SR12, Announcements copy and Problems links, its rare-state copy, precision rule and motion on the reply, refused and interrupted paths are read, and its screen meets the screen rules.
- **DP-35 — Language of the client page** Every string on the client page comes from the published copy table in the client's language, with the matching `lang`, and `dir="rtl"` in Arabic, decided by the server before any script runs.
- **DP-36 — Seat height** The seat height is typed the local way, read by the published rule, stored as typed and answered as a decimal string, between 30 and 60 with one decimal at most.
- **DP-37 — Sign-off by typed name** Signing off needs the client's full name under the published folding table, a replaced estimate answers 409, and two windows record one approval.
- **DP-38 — Private address lifetime** The private address carries an unguessable token, an unknown one answers 404 with one page, a new address ends the old one, and the page ends at the published instant answering 410.
- **DP-39 — Client mail and reminder** The client's mail is in their language with the address and the due date in local wall time, one reminder follows only if no answer came, and neither carries a labour rate or another client's name.
- **DP-40 — Bench calendar journey** The week grid keeps a roving Tab stop, Alt+arrows move a card with focus kept through reply and refresh, the week's end and a taken bench read their copy, `Move <job> to…` is the way at 375, a drag settles and Escape glides home with nothing changed, the agenda has its published columns and glue times hold with a device clock three days on; checked on `/bench` and POST /api/bench-jobs with the `Move <job> to…` dialog: an oversized request with no session answers 413 as JSON, instants are whole-second UTC with a Z, the session cookie has its published attributes, SR1 to SR28 hold, its keyboard and 375x812 touch journeys check SR8, SR11, SR12, Announcements copy and Problems links, its rare-state copy, precision rule and motion on the reply, refused and interrupted paths are read, and its screen meets the screen rules.
- **DP-41 — Bench moves** A job card moves by mouse drag, Alt+arrow and dialog, one job per bench per day, with the published refusals.
- **DP-42 — Glue cure** Glue cures after 48 hours of real elapsed time across a 23-hour or 25-hour day, and a cover job goes on a day only if the glue has cured by the bench day's start, as decided by the server.
- **DP-43 — Courier collections journey** A collection keeps its local wall time across the next clock change while its Turin time moves, quote and booking bodies reach the journal as published, repeats make one call with one key, `Booked` needs the courier and the label's bytes in MinIO, and the failure, 429, taken-time and non-existent-time refusals read their copy; checked on `/pieces/<id>/collection` and POST /api/pieces/<id>/collections with the `Book a collection` dialog: an oversized request with no session answers 413 as JSON, instants are whole-second UTC with a Z, the session cookie has its published attributes, SR1 to SR28 hold, its keyboard and 375x812 touch journeys check SR8, SR11, SR12, Announcements copy and Problems links, its rare-state copy, precision rule and motion on the reply, refused and interrupted paths are read, and its screen meets the screen rules.
- **DP-44 — Collection wall time** A collection is booked in the client's local wall time, shows both towns' times in the published form, and is sent to the courier as a whole-second UTC instant.
- **DP-45 — Confirmed booking** A booking carries one repeat key per piece and quote, and shows `Booked` only after the courier has confirmed and its label is stored in MinIO.
- **DP-46 — Old workbook journey** A file with a byte order mark, CRLF, semicolons and a quoted line break previews with row numbers by record, an extra or missing column refuses the whole file, a refused row never blocks the others, matched rows and a second save change nothing, the kept file equals the sent bytes, the list file's dangerous cells carry the apostrophe and errors carry one shape; checked on `/workbook` and POST /api/workbook/preview with the `Save this file` dialog: an oversized request with no session answers 413 as JSON, instants are whole-second UTC with a Z, the session cookie has its published attributes, SR1 to SR28 hold, its keyboard and 375x812 touch journeys check SR8, SR11, SR12, Announcements copy and Problems links, its rare-state copy, precision rule and motion on the reply, refused and interrupted paths are read, and its screen meets the screen rules.
- **DP-47 — Workbook reading** The workbook file is read by the published format rules and previewed before anything is saved, with row numbers counting records.
- **DP-48 — Workbook saving** Rows match on the stamp number, saving the same file twice changes nothing, the file is kept in MinIO byte for byte and text is stored exactly as written.
- **DP-49 — Materials list file** The materials list file is comma separated UTF-8 with every field quoted and CRLF line ends, and any cell starting with =, +, -, @, a tab or a carriage return is prefixed with an apostrophe.
- **DP-50 — Conservation dossier journey** The strip follows the server's state and draws each check once, the rail follows the case-page rule, the PDF holds what is published and never unsigned notes or the labour rate, `Stored` needs Gotenberg and MinIO with nothing half-written on either outage copy, the print view shows only content, the 6th download reads its copy and signing locks it with its history; checked on `/pieces/<id>/dossier` and POST /api/pieces/<id>/dossier with the `Sign dossier` dialog: an oversized request with no session answers 413 as JSON, instants are whole-second UTC with a Z, the session cookie has its published attributes, SR1 to SR28 hold, its keyboard and 375x812 touch journeys check SR8, SR11, SR12, Announcements copy and Problems links, its rare-state copy, precision rule and motion on the reply, refused and interrupted paths are read, and its screen meets the screen rules.
- **DP-51 — Dossier contents** The dossier PDF holds the piece, its stamp, signed condition pins as a table, materials with dye lot, before and after photographs and a care card in the client's language, and never unsigned notes or a labour rate.
- **DP-52 — Render and store** POST /api/pieces/<id>/dossier answers 202, the three-step strip shows the server's state, and `Stored` shows only after Gotenberg has answered and MinIO has confirmed.
- **DP-53 — Downloads and signing** Dossier downloads are limited per desk per window with Retry-After, a dossier signed by typed name never changes, and its history lists who did what and when with no way to change it.
- **DP-54 — Route sweep** Every signed-in route and the client page meet SR4, SR5, SR6, SR14, SR15, SR16, SR25 and SR26.
- **DP-55 — Motion system** Every motion across the whole app runs for exactly 160, 320 or 640 ms by the browser's own animation, none loops forever, and reduced motion shows every end state at once, as qualified in Screen rules.
- **DP-56 — Published surface and error order** Only the published endpoints exist, every error has one shape with no internals in it, and one precedence order covers the whole API, as stated in Server boundary and API.
- **DP-57 — Sessions and return addresses** Sign-in takes focus on its heading and lands on `/pieces`, an ended session keeps the address and the draft through signing in again, and a return address is honoured only if it is a same-origin relative path.
- **DP-58 — Exact starting seed** A fresh database starts with exactly the records published in Seed data, on every copy, with dates set from the day the copy starts.
- **DP-59 — Bento look with grey grain** Every screen carries the white ground, flat grey tiles and exactly one mint tile, and swatches and hides are told apart by dot grain, name and code with no leather colour.
- **DP-60 — Provider wiring in source** Credentials and addresses are read from the environment and never reach the browser, search calls only Meilisearch, money is computed exactly, and no screen state is faked without its provider.

## Frontend

### Screens and layout (DP-03, DP-09, DP-14, DP-19, DP-24, DP-29, DP-34, DP-40, DP-43, DP-46, DP-50, DP-54)

No page scrolls sideways at 375x812, 768x1024 or 1280x800; only the named frames listed below scroll sideways. Every screen sits on one twelve-column bento grid. At 768 it uses fewer columns, and at 375 tiles stack in one column.

Each screen publishes its level-one heading and its page title. Every desk screen fetches its data through the published API.

| Route | Level-one heading | Page title |
|---|---|---|
| `/` | `ONE CHAIR AT A TIME.` | `Bottega Semenza` |
| `/work` | `Work` | `Work — Bottega Semenza` |
| `/work/<slug>` | `<case title>` | `<case title> — Bottega Semenza` |
| `/enquire` | `Send an enquiry` | `Enquire — Bottega Semenza` |
| `/sign-in` | `Sign in` | `Sign in — Semenza Desk` |
| `/sign-up` | `Start a desk` | `Start a desk — Semenza Desk` |
| `/pieces` | `Pieces` | `Pieces — Semenza Desk` |
| `/pieces/<id>` | `<title>` | `<title> — Semenza Desk` |
| `/pieces/<id>/condition` | `Condition of <title>` | same text `— Semenza Desk` |
| `/pieces/<id>/photographs` | `Photographs of <title>` | same text `— Semenza Desk` |
| `/pieces/<id>/hide` | `Hide for <title>` | same text `— Semenza Desk` |
| `/pieces/<id>/estimate` | `Estimate for <title>` | same text `— Semenza Desk` |
| `/pieces/<id>/collection` | `Collection of <title>` | same text `— Semenza Desk` |
| `/pieces/<id>/dossier` | `Dossier for <title>` | same text `— Semenza Desk` |
| `/clients` | `Clients` | `Clients — Semenza Desk` |
| `/clients/<id>` | `<name>` | `<name> — Semenza Desk` |
| `/library` | `Material library` | `Material library — Semenza Desk` |
| `/bench` | `Bench` | `Bench — Semenza Desk` |
| `/workbook` | `Old workbook` | `Old workbook — Semenza Desk` |
| `/rates` | `Labour rates` | `Labour rates — Semenza Desk` |
| `/c/<token>` | C01 of the client page copy table | same as its heading |
| ended `/c/<token>` | the ended copy (C20) in its language | same as its heading |
| any unknown address | `Page not found` | `Page not found` |

**Public site.** The header holds `Work`, `Enquire` and `Sign in`.

- **Home:** the headline runs across eight of twelve columns, with one line under it reading `A conservator's desk in Turin, re-covering twentieth-century design chairs for Turin, London, New York, Kyoto and Dubai.` and a solid mint link `Send an enquiry`. From about two-thirds of the way down, a cropped row of tiles shows a large mint tile with Bentwood armchair's hide figure, one tile with a generated dot-grain chair drawing and one tile with a real pin fragment from a condition map. On a phone the headline is about a ninth of the screen width tall and tiles stack, mint first.
- **Work page:** a filter and a grid of case tiles.
- **Case page:** a hero drawing, six numbered sections and a sticky numbered rail. The rail is at the side from 768 wide and a sideways-scrolling row of numbers at 375.
- **Enquiry page:** the form in one large tile.

**Desk shell.** A top bar holds the links `Pieces`, `Clients`, `Library`, `Bench`, `Workbook` and `Rates`, the search box, `Change password` and `Sign out`. At 375 the links, `Change password` and `Sign out` sit in a `Menu` sheet, and the search box stays in the top bar. Every desk screen at 375 has a bar fixed to the bottom holding its main action.

**Desk screens.**

| Screen | What it shows | Main action |
|---|---|---|
| `/pieces` | Filter tile, then the Pieces table in its frame `Pieces table`, with a mint tile for non-archived pieces due from today through today plus 14 days on the Turin date, both ends included (for example 1, Bentwood armchair, on the day a seeded copy starts) | `New piece` |
| `/pieces/<id>` | Facts, state select, links to the six sub-screens, accordions `Holds`, `Client page` and `Answers`, mint tile for days to due | `Send client page` |
| `/pieces/<id>/condition` | Condition map as the largest tile, pin list, mint tile for the pin count | `Add a pin` |
| `/pieces/<id>/photographs` | Upload rows, the slider, mint tile for stored files | `Add photographs` |
| `/pieces/<id>/hide` | Hide as the largest tile, tray beside it, mint figure tile | bar `Hide controls` at 375 |
| `/pieces/<id>/estimate` | Estimate lines and milestones, mint tile for the total | `Edit estimate` |
| `/pieces/<id>/collection` | Quote, collections with times and labels, mint tile for the next collection | `Book a collection` |
| `/pieces/<id>/dossier` | Strip, numbered rail, six sections, mint tile for the dossier's state | `Make dossier` |
| `/clients` | Clients table in frame `Clients table`, mint tile for client count | `New client` |
| `/clients/<id>` | Name, town, language, email, pieces, state, mint tile for piece count | `Rename client` |
| `/library` | Swatch grid under sticky family headings, drawing, stock tile, compare tray, mint tile for chosen price per unit | `Hold a dye lot` |
| `/bench` | Week grid as largest tile from 1280, agenda in two columns at 768x1024 and one at 375, mint tile for jobs this week | `Add job` |
| `/workbook` | File field, preview table in frame `Workbook preview`, materials list download, mint tile for new-row count | `Save` |
| `/rates` | Rate table in frame `Rates table`, mint tile for today's rate in EUR | `New rate` |

**Client page.** Built for 375x812 touch first, with one column of tiles: Before and after, The cover, Condition notes, The estimate. The steps row sits under the heading. A bottom bar holds `Your answer`. From 768 wide the tiles go into two columns and the sheet arrives from the side.

**Empty, loading and error states.** These are tiles the same size as the content they replace, so nothing moves when data arrives.

### Public screens and controls (DP-03, DP-05, DP-07, DP-11, DP-15, DP-18, DP-21, DP-25, DP-40, DP-50)

Only these are public; everything else is free.

| Where | Role and accessible name | Notes |
|---|---|---|
| Everywhere | `status "Announcements"` | one polite live region (C24 on the client page), present from first paint |
| Signed-in screens and client page | `status "Refresh state"` | holds only F-02, under the top bar, space reserved (C25 on the client page) |
| Everywhere | `region "Problems"` | form error summary with level-two heading `Problems` and one link per refused field, whose text is that field's message; a dialog holds its own (C26) |
| Bottom bar at 375 | `toolbar "Main action"` (C48 on the client page) | fixed to the bottom, on each screen that lists a main action, except the hide, whose bar is `toolbar "Hide controls"` |
| Public header | `button "Work"`, `link "Enquire"`, `link "Sign in"` | `Work` carries aria-expanded; the header carries `data-scrolled="true"` once past 24 px |
| Work panel | `navigation "Work"` | six `link "<case title>"` tiles and `img "Preview of <case title>"` |
| Work page | `radiogroup "Kind"` | `radio "All"`, `"Leather"`, `"Fabric"`, `"Frame only"` |
| Case tile | `link "<case title>"` | its drawing has `data-part="case-drawing"` and `data-case="<slug>"` |
| Case hero | the case page's hero drawing | the same element with `data-part="case-drawing"` and `data-case="<slug>"`, plus `data-hero="true"` |
| Case and dossier | `navigation "Sections"` | one link per section; its accessible name is number and heading; aria-current="true" on the current one |
| At 375 rail | `region "Section numbers"` | focusable sideways frame |
| Enquiry | `textbox "Name"`, `textbox "Email"`, `textbox "Message"`, `button "Send enquiry"` | |
| Sign-in | `textbox "Email"`, `textbox "Password"`, `button "Sign in"`, `link "Start a desk"` | |
| Sign-up | `textbox "Your name"`, `textbox "Email"`, `textbox "Password"`, `button "Start a desk"` | |
| Desk top bar | `searchbox "Search the desk"`, `list "Search results"`, `button "Change password"`, `button "Sign out"`, `button "Menu"` at 375, which opens `dialog "Menu"` holding those links and buttons and `button "Close"` | |
| Password | `dialog "Change password"`: `textbox "Current password"`, `textbox "New password"`, `button "Change password"`, `button "Close"` | |
| Session ended | `link "Sign in again"` | shows in the open dialog and in the Refresh state's place |
| Pieces | `combobox "Client"`, `combobox "State"`, `combobox "Sort"`, `region "Pieces table"`, `link "<piece title>"`, `button "Actions for <piece title>"`, `menu` with `menuitem "Open"`, `"Duplicate"`, `"Archive"`, `link "Next page"`, `button "New piece"` | |
| New piece | `dialog "New piece"`: `combobox "Client"`, `textbox "Title"`, `"Maker"`, `"Year"`, `"Stamp number"`, `"Width in cm"`, `"Depth in cm"`, `"Height in cm"`, `"Weight in kg"`, `"Due date"`, `"Notes"`, `button "Save piece"`, `button "Close"` | |
| Piece | `combobox "State"`, links `Condition`, `Photographs`, `Hide`, `Estimate`, `Collection`, `Dossier`, `button "Send client page"`, `button "End this page"`, accordion buttons `Holds`, `Client page`, `Answers` | |
| Clients | `region "Clients table"`, `button "New client"`, `dialog "New client"` with `textbox "Name"`, `combobox "Town"`, `combobox "Language"`, `textbox "Email"`, `button "Save client"` | |
| Client | `button "Rename client"`, `dialog "Rename client"`, `button "Close client"`, `dialog "Close this client"` with `button "Close client"` and `button "Keep client"`, `button "Bring back"`, `button "Delete client"` | |
| Condition | `button "Add a pin"`, `group "Condition map"` with `data-part="condition-map"`; pins are `button "Pin <n>: <kind>"` with `data-part="pin"`, `data-x`, `data-y`; crosshair `data-part="crosshair"` with `data-x`, `data-y` (one decimal, for example `50.0`) | |
| Pin dialog | `dialog "Pin"`: `combobox "Kind"` (`Tear`, `Crack`, `Stain`, `Loose joint`, `Woodworm`), `textbox "Note"`, `checkbox "Signed note"`, `button "Save pin"`, `button "Close"` | |
| Pin popover | `dialog "Pin <n>"`, non-modal, holding the note and `button "Remove pin"` | `<n>` is the pin's `number` from Business rules |
| Photographs | file field `button "Add photographs"` (labelled, 44 px), `radiogroup "Side"` with `radio "Before"` and `"After"`, `list "Uploads"` of rows each with state text and `button "Try again"`, `slider "Before and after"` | |
| Library | `radiogroup "<family>"`, `radio "<name> <code>"`, heading `Swatches`, `button "Refresh library"`, `button "Add to compare"`, `region "Compare tray"` with `button "Take out <name> <code>"`, `region "Stock"`, `button "Hold a dye lot"` | |
| Hold dialog | `dialog "Hold a dye lot"`: `combobox "Piece"`, `radiogroup "Lot"`, `textbox "Quantity"`, `button "Hold"`, `button "Close"` | |
| Hide | composite with `data-part="hide"` and name `Hide`; figure `status`-free text with `data-part="hide-figure"`; `region "Tray"`; `button "Clear the hide"`, `dialog "Clear the hide"` with `button "Clear"` | |
| Hide pieces | `data-part="pattern-piece"`, `data-piece`, `data-x`, `data-y`, `data-rotation`, `data-state` (`tray`, `lifted`, `placed`), `data-chosen="true"` on the chosen one; a piece in the tray has no `data-x` or `data-y` | |
| Hide flaws | `data-part="flaw"`, `data-x`, `data-y`, `data-width`, `data-height` | |
| Hide at 375 | `toolbar "Hide controls"`: `button` for `Seat`, `Back`, `Left side`, `Right side`, `Headrest`, then `Lift`, `Up`, `Down`, `Left`, `Right`, `Rotate`, `Place`, `Put back`, `To tray` | |
| Estimate | `button "Edit estimate"`, `dialog "Edit estimate"`: `combobox "Material"`, `combobox "Lot"`, `textbox "Pattern area in sq ft"` or `textbox "Metres"`, `textbox "Labour hours"`, `button "Save estimate"`, `button "Close"`; mint figure `data-part="estimate-total"` | |
| Rates | `button "New rate"`, `dialog "New rate"`: `textbox "Takes effect on"`, `textbox "EUR"`, `"GBP"`, `"USD"`, `"JPY"`, `"AED"`, `button "Save rate"` | |
| Client page | `navigation` C02, `slider` C03, `button` C06, `dialog` C06: `textbox` C08, `button` C09, `textbox` C10, `button` C11, `button` C12 | names in the client's language |
| Bench | `grid "Bench week"` with `gridcell`, `link "Earlier week"`, `link "Later week"`, card `data-part="job-card"` and `data-job`, `button "Move <job> to…"`, `button "Glue laid"`, `button "Add job"` | |
| Move | `dialog "Move <job> to…"`: `textbox "Day"`, `combobox "Bench"`, `button "Move"`, `button "Close"` | |
| Glue | `dialog "Glue laid"`: `textbox "Date"`, `textbox "Time"`, `button "Save glue time"`, `button "Close"` | |
| Add job | `dialog "Add job"`: `combobox "Piece"`, `combobox "Bench"`, `textbox "Day"`, `button "Save job"`, `button "Close"` | |
| Collection | `button "Get a quote"`, `button "Book a collection"`, `dialog "Book a collection"`: `textbox "Date"`, `textbox "Time"`, `button "Book"`, `button "Close"`, `link "Label for <id>"` | |
| Workbook | `button "Choose a file"`, `region "Workbook preview"`, `button "Save"`, `dialog "Save this file"` with `button "Save file"`, `link "Download materials list"` | each preview row expands with `button "Row <n>"` |
| Dossier | `list "Dossier steps"` with items `Waiting`, `Rendering`, `Stored`, each `data-part="dossier-step"` and `data-state` (`pending`, `current`, `done`), its check `data-part="step-check"`; `button "Make dossier"`, `link "Download PDF"`, `button "Sign dossier"`, `dialog "Sign dossier"`: `textbox "Your full name"`, `button "Sign"`; `list "Dossier history"` | |

Personal fields carry their autocomplete tokens: name, email, tel, current-password and new-password.

**Options and typed forms.**

| Control | Visible options, with the API value in brackets where it differs |
|---|---|
| `Language` | `English` (`en`), `Italian` (`it`), `Japanese` (`ja`), `Arabic` (`ar`) |
| `Town` | `Turin`, `London`, `New York`, `Kyoto`, `Dubai` |
| `Sort` | `Title` (`title`, the default), `Due date` (`dueDate`) |
| `Client` on the Pieces filter | `All clients` (no parameter, the default), then each client's name |
| `Client` in `New piece` | each client's name |
| `State` on the Pieces filter | `All but archived` (no parameter, the default), then the six state names from API |
| `State` on a piece | the six state names from API |
| `Piece` | each non-archived piece's title |
| `Bench` | `Frame bench` (`frame`), `Cover bench` (`cover`) |
| Estimate `Material` | `None (frame only)`, then `<name> <code>` for each material in the library, for example `Tabacco VM-2041` |
| Estimate `Lot` and each radio in `radiogroup "Lot"` | leather `<lot>, <hides> hides at <averageSqFt> sq ft`, for example `L-2041-A, 2 hides at 48.25 sq ft`, with `1 hide` for one, as in `L-2041-B, 1 hide at 52.75 sq ft`; fabric `<lot>, <metres> m`, for example `L-3000-A, 40.00 m` |

Choosing `None (frame only)` also removes `Lot`. `dialog "Rename client"` holds `textbox "Name"`, `button "Save client"` and `button "Close"`.

Every date textbox (`Due date`, `Takes effect on`, `Day`, `Date`) takes `YYYY-MM-DD`, for example `2027-03-26`; non-empty text in any other form reads F-07 (422). Every `Time` textbox takes 24-hour `HH:MM` in the town's wall time, for example `16:00`; non-empty text in any other form reads F-111 (422). An empty `Takes effect on`, `Day`, `Date` or `Time` is an empty required field and reads F-04 (422). An empty `Due date` is accepted and leaves the piece with no due date.

The number textboxes are `Width in cm`, `Depth in cm`, `Height in cm`, `Weight in kg`, `Quantity`, `Pattern area in sq ft`, `Metres`, `Labour hours`, `EUR`, `GBP`, `USD`, `JPY` and `AED`. They take Latin digits with `.` and no grouping, for example `12.50`; non-empty text in any other form, such as `12,50`, `abc` or `-5`, reads F-112 (422) in every one of them, and the API answers the same for a number or decimal-string body field with no rule of its own for such a value. Pin `x` and `y` and placement `x`, `y` and `rotation` have rules of their own: a negative or out-of-range JSON number keeps F-08, F-47 or F-50 as API and Business rules state, and only a non-numeric value reads F-112. An empty `Width in cm`, `Depth in cm`, `Height in cm` or `Weight in kg` is accepted, and any other empty number textbox reads F-04 (422). A value in the accepted form that a field's own rule refuses reads that rule's copy: `Labour hours` not on a quarter hour, such as `12.30`, reads F-56, and any other value outside a field's published range or precision reads F-08. `Stamp number`, `Year` and the client page's seat height are not number textboxes: `Stamp number` reads F-13, `Year` is free text, and the seat height reads C13 or C23.

### Interactions (DP-05, DP-06, DP-07, DP-11, DP-12, DP-15, DP-18, DP-21, DP-22, DP-25, DP-33, DP-41, DP-57)

**Work panel.**
- Pressing `Work` opens the panel. Focus stays on `Work` and moves into the panel only by Tab or Down.
- Moving focus or the pointer over a tile changes the preview in place.
- Escape closes the panel with focus back on `Work`. Tab past the last tile closes it and moves on.
- At 375 it is a full-height panel under the header with the same tiles and the same keys and motion. It is a menu panel at every width, not a dialog or sheet: it takes no focus on opening, does not keep Tab inside it and does not rise or slide from an edge.

**Header.** It is transparent at the top and solid past 24 px, and correct on arrival at a scrolled position.

**Work filter and case transition.**
- All shows with no parameter; otherwise the filter is `?kind=leather`, `fabric` or `frame-only`, each change one history entry.
- Items that leave and enter move as the same elements.
- Pressing a case moves its drawing to the case page's hero as one shared element with the new page in place when it ends. The tile's drawing element is kept and becomes the hero, gaining `data-hero="true"`. During the move the document holds exactly one element for that `data-case`, and that element has one running animation of 320 ms. The old page is inert during the move.
- Back during the move is honoured at once and ends on the newest address with no stray page.
- Focus lands on the new level-one heading when the move ends, and the title changes with the route.
- Back afterwards returns to the earlier scroll position once the list has loaded, with focus on the case just left, as one history entry.
- Under reduced motion there is no move at all.

**Case sections.** The six section headings and their address hashes:

| Heading | Hash |
|---|---|
| `01 As it came` | `#as-it-came` |
| `02 What we found` | `#what-we-found` |
| `03 The cover` | `#the-cover` |
| `04 The frame` | `#the-frame` |
| `05 Keeping it well` | `#keeping-it-well` |
| `06 Files` | `#files` |

The current section is the last section whose heading has passed the line 96 px under the top of the viewport, and at the very bottom of the page the last section, however short it is. A heading has passed the line when its top edge is at or above the line, so a heading exactly on the line has passed it. Before any heading has passed the line, the first number, `01`, is current.

Pressing a number lands with that section's heading fully below the sticky header and focus on that heading, at once with no animated scrolling. It marks that number current at once with no other number marked on the way and holds it current until the reader next scrolls. It puts the hash in the URL as one history entry. A direct address with a hash lands the same way on load. At 375 the current number stays fully in view inside its frame.

**Pieces list.**
- URL parameters are `client`, `state`, `sort` (`title` or `dueDate`) and `cursor`, each committed change one history entry.
- Back from a piece returns to the same filters, sort, page and scroll position, with focus on the link of the piece just left, once the list has loaded.
- The action menu opens uncut inside the viewport even on the last row, at 375 and 1280.

**Search.** The box asks after a 300 ms pause, always shows the latest input even when an earlier answer arrives later, lists results as links and closes on Escape.

**Condition map.**
- A tap or click places a pin at that point.
- By keyboard, `Add a pin` shows a crosshair at the centre. Arrows move it 1%, Shift+arrow 10%, Enter places it, Escape leaves with no pin.
- Placing opens the `Pin` dialog.
- Pins are one composite with one Tab stop, ordered by y and then x. Right and Down go to the next, Left and Up to the previous, wrapping at the ends. Enter opens the popover.
- After `Remove pin`, focus moves to the next pin, or to `Add a pin` when none is left.
- The popover opens uncut at any edge of the drawing. It is non-modal: opening moves focus to its first control, Tab moves through its controls, and Tab past the last or Shift+Tab before the first closes it with focus back on its pin. Escape does the same. Pins are at least 44 by 44 to the touch at 375.

**Photographs.** Drop or choose many files. Each gets its own row, showing its file name, and its own `Try again`, and a refused file never stops the others. The side defaults to `Before`, and the slider compares the latest of each.

**Slider.**
- Arrows move it 1%, Shift+arrow 10%.
- The value is in the URL as `?before=<share>`, replacing the history entry and never adding one, and in aria-valuetext as the share of the before picture shown (for example `62% before`).
- Pressing Left moves the handle left. In left-to-right pages the before picture is on the left, so Left shows less of it. In Arabic it is on the right, so Left shows more of it.
- A keyboard step glides; a drag follows the pointer with no glide.

**Library.**
- A family's swatches are one radio group with arrows wrapping and one Tab stop. The library has one choice, so choosing in one family clears the others.
- A swatch's touch area is at least 44 by 44 at 375, and a focused swatch is never under a sticky heading or a bar.
- A choice changes the drawing in place, and a further choice during the fade carries on from where it is.
- `/library?material=<code>` opens with that material chosen.
- When a tray member is removed, focus moves to the next one, or to the `Swatches` heading when the tray empties.

**Hide keyboard (the composite has one Tab stop).**
- Arrow keys choose among pieces in the order Seat, Back, Left side, Right side, Headrest, wrapping at the ends. The first is chosen at the start.
- Enter lifts the chosen piece. A piece lifted from the tray moves to 0, 0 on the hide.
- While lifted, arrows move it 1 cm and Shift+arrow 10 cm with no stop at the edge (the hide's frame clips what runs past it, and the server refuses it). `data-x` and `data-y` follow it past the edge, so Left at x 0 reads `-1`.
- R steps its rotation: Seat, Back and both sides go 0, 180, 0; Headrest goes 0, 90, 180, 270, 0. The screen never asks for a rotation the grain forbids. Delete sends it to the tray. Enter asks the server to place it. Escape glides it back to where it was lifted from.
- A refused place keeps the piece lifted with focus on the hide.

**Hide mouse at 1280.** Pressing a piece lifts it, dragging moves it on the 1 cm grid, and release asks the server. Escape during a drag glides it back. A drop refused with F-47, F-48 or F-49 glides it back and says the same copy, ending with `data-state` and position as they were before the lift (`tray` with no `data-x` or `data-y`, or `placed` at its old place). A drop refused with 412 is the one exception: the piece does not glide, stays `lifted` where it was dropped and says F-51. Enter or another drag then asks again on the newest version, and Escape puts it back. Nothing else on the hide moves.

**Hide at 375.** There is no drag. The bar's buttons choose, lift, step 1 cm, rotate, place, put back and send to tray. The pieces drawn on the hide are not controls.

**Estimate.** Totals change in place on every input with no submit or reload, in the dialog and in the tile behind it. The screen may ask the preview endpoint or work them out itself by the same rules. The field shown after `Material` depends on the unit, and choosing `None (frame only)` removes the material line.

**Bench.**
- Arrows move the roving stop through cells. Tab goes from a card to its own buttons and then out.
- Alt+Left and Alt+Right move a card one day. Alt+Up and Alt+Down move it to the other bench. Focus stays on that same card through the reply and any refresh.
- A mouse drag at 1280 settles on drop with the same element kept. Escape during a drag glides home and changes nothing on the server.
- At 375 `Move <job> to…` is the only way.
- `/bench` opens the current Turin week; `/bench?week=<Monday's date>` opens another.

**Client page.** `Your answer` opens the sheet. `Send my answer` and the sign-off button act separately. A new answer reaches the conservator's open screens within the 5-second refresh, in place, and is announced there (F-46).

**Moving between screens.** Following a link to another screen, on the desk or the public site, shows the new screen with no page move, moves focus to its level-one heading and changes the title. Pressing a case on the work page follows its own rule above.

**Landing addresses.** Signing up or signing in lands on `/pieces`, or on an honoured return address. Signing out lands on `/sign-in`. `Delete client` lands on `/clients` with focus on its level-one heading. `Save piece`, `Duplicate` and `Archive` stay on the `/pieces` address they started from, `Save client` stays on `/clients` or `/clients/<id>`, and `Open` goes to `/pieces/<id>`.

**Ended session.** See Server boundary for when a session ends. The open dialog stays as typed, Announcements reads F-03, and `Sign in again` goes to `/sign-in?returnTo=<same address>`. On return, the same address shows with the same dialog open and its values kept.

### Visual design (DP-59)

**Direction: bento showcase.** One typeface, Jost, serves both display and body. Each heading step is a quarter larger than the one below. Density is comfortable.

**Colour roles.**
- Ground: white.
- Surface: a flat very light grey, used for tiles.
- Ink: near-black charcoal.
- Muted: a mid grey.
- Accent: a pale mint green, with the same charcoal on top of it.

**Composition.** A twelve-column grid has narrow even gutters and generously rounded tile corners. Tiles in large, wide and small sizes each hold one working thing. Exactly one mint tile on each screen carries that screen's main figure or claim. Mint fills that one tile and the primary button and nothing else.

**Mood.** Exact: every tile holds a real figure. Bright: white ground and flat tiles. Workshop-plain: chairs and hides are drawn from one dot primitive, with no photographs on the public site.

**The risk this direction takes.** There is a leather library with no leather colour. Every swatch and hide is a dot-density grain in ink, muted and surface greys, told apart by grain, name and code. A conservator judges colour from the supplier's physical cutting, so the desk refuses to pretend, and the mint figure beside the grey hide is the only colour on the bench.

**Working screens.** Lists, forms, tables and dialogs sit inside large tiles on the white ground with the same corners and padding, and there are no ruled grids. The hide, the bench week and the condition map each fill the largest tile of their screen, with the mint tile beside them. Refused and current states carry a border, glyph or underline as well as tone.

**Type rules.** Jost comes from the app's own files (a font package or font files under OFL-1.1, named in `THIRD_PARTY_NOTICES.md`), never from another host. Capitals appear only on display words that are published in capitals, such as the home headline; every other published string prints in its published case. Numbers use tabular figures. No text falls under 14 px. Japanese and Arabic text uses the device's own faces with no capitals and no tightened spacing, so Arabic letters still join.

**Accessibility of the look.** Controls offer at least 44 px to tap, and contrast meets WCAG 2.2 AA.

### Motion and effects (DP-05, DP-06, DP-21, DP-27, DP-52, DP-55)

All motion starts quickly and settles softly. Durations are exactly 160, 320 or 640 ms; each is listed here because tests read it. There are no decorative loops, and a tile lifts very slightly only for a mouse pointer type, read from the event.

| Motion | Meaning | Duration |
|---|---|---|
| Work panel height and fade | opens and closes the menu | 320 ms |
| Work preview cross-fade | tile changes preview | 160 ms |
| Header turning solid | page has scrolled | 160 ms |
| Work items moving, shared drawing to hero | filter change, navigation | 320 ms |
| Rail marker glide | current number changes by scrolling | 160 ms |
| Slider keyboard step | value change | 160 ms |
| Swatch drawing cross-fade | choice changes | 320 ms |
| Compare tray rising | first swatch added | 320 ms |
| Compare members closing up | one removed | 160 ms |
| Bench drop settling | card lands | 160 ms |
| Bench Escape during a drag | card returns | 320 ms |
| Dossier step check drawing | step finished on an open screen | 320 ms |
| Dialogs growing from their centre, sheets rising or sliding | open and close | 320 ms |

**Signature: Hide lay.**
1. A piece in the tray lifts (160 ms) and moves to the hide as one element, never redrawn or replaced (320 ms).
2. It steps 1 cm or 10 cm with each glide (160 ms), and a further press during a glide carries on from where the piece is, with no jump and no restart from the old place.
3. R rotates it about its published box (320 ms).
4. Enter asks the server. On success the figure rolls old up and out and new up into place (320 ms). On refusal the piece stays lifted with the published copy.
5. A refused drop or a put back glides home (320 ms) while the rest of the hide stays still.
6. The pixels and `data-x`, `data-y`, `data-rotation` and `data-state` agree at each step. Ranges for a placed piece: top-left x 0 to 200 cm, y 0 to 240 cm; rotation 0, 90, 180, 270; figure 0 to 51.67 sq ft. A lifted piece's `data-x` and `data-y` may run outside this range.
7. A refresh with no new data starts no motion and replaces no element. A change from another window moves only that one piece, with its glide.

**Dossier checks.** A step that finishes while the screen is open draws its check one time and never again on a refresh. A step already finished when the screen opens shows its check with no motion.

**Page transitions.** A browser's built-in page transition default of 250 ms is never left in place.

**Reduced motion.** Each lift, step, rotation, tray move, return and figure roll shows its end state at once with the same function, the same server decisions and the same live-region copy. Under reduced motion a case press does no shared move at all.

### Feedback states (DP-03, DP-08 to DP-53)

Every async action shows a pending state (F-01 on its button), a success, a field error and an outage, each visible and announced through the one Announcements region. Announcements and Problems summaries stay until the next action. A hold's success announces F-33, and a booking's success announces F-75. Signing in, signing up and signing out land on a new page and announce nothing. A file download announces nothing unless refused. Choosing a swatch, adding to or taking out of the compare tray, filtering, sorting and paging write nothing and announce nothing, apart from F-32. These are exempt from the Announcements check; every other write action announces its row below.

**Placeholders.**
- `<minute>` is an instant rounded up to a whole minute, shown as 24-hour `HH:MM` Turin time. An instant already on a whole minute stays there.
- `<time>` is 24-hour `HH:MM` wall time in the town named by the sentence. Taken from an instant it drops the seconds, so 09:05:59 prints `09:05`; only `<minute>` rounds up.
- `<date>` is `Mon 29 Mar 2027` form on the local date of the town named.
- `<datetime>` is `Mon 29 Mar 2027, 06:20 Turin time` form, its time following the `<time>` rule.
- `<title>` is a piece's title, `<name>` a client's or material's name, `<part>` a pattern piece's name, `<job>` a bench job's piece title.
- In F-37, `<n>` and `<m>` are whole numbers and the words stay as printed: `No single dye lot holds 3 hides of Tabacco. The largest holds 2.`.
- In F-38, `<n>` and `<m>` are metres to two decimals: `No single dye lot holds 50.00 m of Loden. The largest holds 40.00 m.`.
- In F-39, `<m>` is the lot's amount with its unit, and in F-41, `<q>` is the held amount with its unit: `2 hides`, `1 hide` or `7.50 m`. For example `Lot L-2041-B holds 1 hide.` and `This lot is already held for this piece for 2 hides.`.
- `<collection time>` is `<date>, <time> <town> time` in the client's town, for example `Mon 29 Mar 2027, 09:00 New York time`.
- In F-05, `<n>` is the limit with a comma for thousands, for example `This is longer than 2,000 characters.`. Other counts and row numbers print as whole numbers.

| Id | Copy | When |
|---|---|---|
| F-01 | `Working…` | a button's request is open |
| F-02 | `Couldn't refresh. Trying again.` | one refresh failed |
| F-03 | `Your session ended. Sign in again to keep going — what you typed is still here.` | 401 sessionEnded |
| F-04 | `This field is required.` | empty required field, a required date, time or number textbox included |
| F-05 | `This is longer than <n> characters.` | over a field's limit |
| F-06 | `That is not an email address.` | |
| F-07 | `That is not a date.` | 422, non-empty date text in any other form |
| F-08 | `That number is out of range.` | 422, a number in the accepted form outside its field's published range or precision, or a pin coordinate or placement rotation sent as a JSON number outside its rule |
| F-09 | `That email and password do not match.` | sign-in 401, wrong current password |
| F-10 | `Use at least 10 characters.` | short password |
| F-11 | `Thank you. Your enquiry is on its way.` | enquiry accepted |
| F-12 | `Too many enquiries. You can try again at <minute> Turin time.` | 429 |
| F-13 | `That stamp number does not check out. Read it again from the frame.` | |
| F-14 | `Another piece on this desk has that stamp number.` | 409 |
| F-15 | `<title> saved.` | piece saved |
| F-16 | `<title> archived.` | Archive |
| F-17 | `Search is unavailable right now. The full list is still here.` | search down |
| F-18 | `Nothing found for <text>.` | no results; `<text>` as typed |
| F-19 | `<name> is closing. You can bring it back until <date>.` | Turin date |
| F-20 | `<name> is back.` | bring back |
| F-21 | `Erasing`, `Erased`, `Erased client` | client states and the erased row's name |
| F-22 | `Pin placed at <x>, <y>.` | one decimal each |
| F-23 | `Pin removed.` | |
| F-24 | `This file is not a PNG or JPEG.` | refused row |
| F-25 | `This file is over 8,000,000 bytes.` | refused row |
| F-26 | `Already on this piece as photograph <n>.` | 409 |
| F-27 | `The file store is unavailable right now. Nothing was saved.` | MinIO down |
| F-28 | `<file name> stored.` | row reads `Stored` |
| F-29 | `The supplier could not be read. Your library has not changed.` | refresh failed |
| F-30 | `Search could not take the new entries. Your library has not changed.` | refresh not confirmed |
| F-31 | `Library refreshed: <n> materials.` | |
| F-32 | `The tray holds four. Take one out first.` | fifth swatch |
| F-33 | `Held until <date>` | live hold, Turin date |
| F-34 | `Hold ended on <date>.` | ended hold, Turin date |
| F-35 | `The supplier is busy. You can try again at <minute> Turin time.` | 429 |
| F-36 | `The supplier is unavailable right now. Nothing changed.` | 503 |
| F-37 | `No single dye lot holds <n> hides of <name>. The largest holds <m>.` | leather |
| F-38 | `No single dye lot holds <n> m of <name>. The largest holds <m> m.` | fabric |
| F-39 | `Lot <lot> holds <m>.` | chosen lot too small while another is enough |
| F-40 | `This piece is held on lot <lot>. All its hides come from one dye lot.` | second lot |
| F-41 | `This lot is already held for this piece for <q>.` | same lot, other quantity |
| F-42 | `<part> lifted. Arrow keys move it, Enter places it, Escape puts it back.` | lift |
| F-43 | `<part> back in the tray.` | Delete, `To tray` |
| F-44 | `<part> put back.` | Escape, `Put back` |
| F-45 | `<part> placed at <x>, <y> cm.` | placed |
| F-46 | `<name> answered about <title> at <time> Turin time.` | new client answer; `<time>` comes from the answer's instant |
| F-47 | `<part> cannot go there. It runs off the hide.` | refused |
| F-48 | `<part> cannot go there. It crosses the flaw at <x>, <y> cm.` | refused; the flaw's top-left |
| F-49 | `<part> cannot go there. It overlaps <other part>.` | refused |
| F-50 | `<part> runs with the grain and turns only 0 or 180.` | 422 from the API for a grain-bound piece sent 90 or 270; the screen's R never reaches it |
| F-51 | `This layout was changed at <time> Turin time in another window. Your piece is still lifted.` | 412 |
| F-52 | `Used <used> sq ft of 51.67 sq ft (<percent>%)` | the figure |
| F-53 | `Total now <total>.` | each settled change, once |
| F-54 | `Estimate saved.` | |
| F-55 | `This estimate was changed at <time> Turin time in another window. Your figures are still here.` | 412 |
| F-56 | `Labour goes in quarter hours.` | 422, labour hours in the accepted number form not on a quarter hour |
| F-57 | `Rate saved. It applies to new estimates from <date>.` | |
| F-58 | `A rate already takes effect on that day.` | 409 |
| F-59 | `Rates take effect today or later.` | 422 |
| F-60 | `Client page sent to <email>.` | |
| F-61 | `Client page ended.` | |
| F-62 | `Give this piece a due date first.` | 409 |
| F-63 | `This client has no email address yet.` | 409 |
| F-64 | `<job> moved to <bench> on <date>.` | `<bench>` is `Frame bench` or `Cover bench` |
| F-65 | `No more days this week. Use Move to….` | Alt+arrow at the week's end |
| F-66 | `That bench is taken on <date> by <job>.` | 409 |
| F-67 | `The glue on <title> cures until <datetime>.` | 409 |
| F-68 | `<time> does not exist in <town> on <date>.` | 422 |
| F-69 | `Glue laid on <job>. It cures at <datetime>.` | |
| F-70 | `The bench works Monday to Friday.` | 422 |
| F-71 | `Glue goes on a frame bench job.` | 409 |
| F-72 | `The courier could not confirm. Nothing was booked.` | 503 |
| F-73 | `The courier is busy. You can try again at <minute> Turin time.` | 429 |
| F-74 | `That time was just taken at <time> Turin time. Pick another.` | 409, the present minute |
| F-75 | `Booked` | collection state text |
| F-76 | `Quote: <amount>.` | quote answered |
| F-77 | `The courier could not give a quote. Nothing changed.` | 503 |
| F-78 | `This piece needs its width, depth, height and weight first.` | 409 |
| F-79 | `This piece is already booked for <collection time>.` | 409, other time, same quote |
| F-80 | `This file has a column the desk does not know: <name>.` | 422 |
| F-81 | `This file is missing a column: <name>.` | 422 |
| F-82 | `This file is over 2,000,000 bytes.` | 413 |
| F-83 | `This file is not UTF-8 text.` | 422 |
| F-84 | `Row <n>: that stamp number does not check out.` | row refused |
| F-85 | `Row <n>: the piece has no title.` | row refused |
| F-86 | `Row <n>: the desk has no material <code>.` | row refused |
| F-87 | `Row <n>: that row does not have seven fields.` | row refused |
| F-88 | `Saved: <a> new, <b> matched, <c> refused.` | |
| F-89 | `Waiting`, `Rendering`, `Stored` | dossier steps; `Waiting`, `Sending`, `Stored`, `Refused` for upload rows |
| F-90 | `The PDF service is unavailable right now. Nothing was saved.` | Gotenberg down |
| F-91 | `Too many downloads. You can try again at <minute> Turin time.` | 429 |
| F-92 | `This piece has no signed-off estimate yet.` | 409 |
| F-93 | `Dossier stored.` | |
| F-94 | `Dossier signed.` | |
| F-95 | `That is not the name on this desk.` | 422 |
| F-96 | `A signed dossier never changes.` | 409 |
| F-97 | `The dossier is not stored yet.` | 409 |
| F-98 | `Close this client instead.` | delete with pieces, 409 |
| F-99 | `Loading…` | loading tile |
| F-100 | `Page not found` | server 404 page heading |
| F-101 | `Password changed.` | password changed |
| F-102 | `<name> saved.` | client created or renamed |
| F-103 | `<name> deleted.` | client deleted |
| F-104 | `<title> duplicated.` | Duplicate; `<title>` is the original's |
| F-105 | `<title> is now <state>.` | piece state set, `<state>` being its shown name; setting `Archived` reads F-16 instead |
| F-106 | `Hide cleared.` | Clear |
| F-107 | `<job> added to <bench> on <date>.` | Save job; `<bench>` as in F-64 |
| F-108 | `Preview ready: <a> new, <b> matched, <c> refused.` | workbook preview answered |
| F-109 | `That email already has a desk.` | sign-up, 409 |
| F-110 | `This client can no longer be brought back.` | bring-back after the wait |
| F-111 | `That is not a time. Write it like 09:00.` | 422, non-empty time text in any other form |
| F-112 | `That is not a number. Write it like 12.50.` | 422, non-empty number textbox text, an API number in any other form on a field with no rule of its own for it, or a non-numeric pin or placement value |

Empty tiles read `No pieces yet.`, `No clients yet.`, `No pins yet.`, `No photographs yet.`, `No holds yet.`, `No jobs this week.` and `No collections yet.`. A family with no swatches reads `Nothing here until the library is refreshed.`.

**Client page copy table.** Every string on `/c/<token>` comes from here, with nothing left in English on the other three. Numbers, amounts and times print in Latin digits in every language.

| Id | English | Italian | Japanese | Arabic |
|---|---|---|---|---|
| C01 heading, title | `Your piece` | `Il tuo pezzo` | `お預かりの品` | `قطعتك` |
| C02 steps name | `Steps` | `Passaggi` | `手順` | `الخطوات` |
| C03 step, slider name | `Before and after` | `Prima e dopo` | `施工前と施工後` | `قبل وبعد` |
| C04 step | `The cover` | `Il rivestimento` | `張地` | `الغطاء` |
| C05 step | `The estimate` | `Il preventivo` | `見積もり` | `التقدير` |
| C06 step, button, sheet | `Your answer` | `La tua risposta` | `あなたの回答` | `إجابتك` |
| C07 question | `What seat height would you like, in cm?` | `Quale altezza della seduta desideri, in cm?` | `ご希望の座面の高さ（cm）を教えてください。` | `ما ارتفاع المقعد الذي تفضله بالسنتيمتر؟` |
| C08 field | `Seat height in cm` | `Altezza della seduta in cm` | `座面の高さ（cm）` | `ارتفاع المقعد بالسنتيمتر` |
| C09 button | `Send my answer` | `Invia la risposta` | `回答を送信する` | `إرسال إجابتي` |
| C10 field | `Your full name` | `Il tuo nome completo` | `お名前（フルネーム）` | `اسمك الكامل` |
| C11 sign-off | `Approve this cover` | `Approva questo rivestimento` | `この張地を承認する` | `الموافقة على هذا الغطاء` |
| C12 close | `Close` | `Chiudi` | `閉じる` | `إغلاق` |
| C13 height refused | `Write the height like 44.5.` | `Scrivi l'altezza così: 44,5.` | `高さは 44.5 のように入力してください。` | `اكتب الارتفاع هكذا: ٤٤٫٥.` |
| C14 name refused | `That is not the name we hold. Type your full name.` | `Non è il nome che abbiamo. Scrivi il tuo nome completo.` | `お預かりしているお名前と一致しません。フルネームを入力してください。` | `هذا ليس الاسم المسجل لدينا. اكتب اسمك الكامل.` |
| C15 answer saved | `Your answer is with the conservator.` | `La tua risposta è arrivata al restauratore.` | `回答を修復担当者に届けました。` | `وصلت إجابتك إلى المرمِّم.` |
| C16 signed | `Approved at <time> <town> time.` | `Approvato alle <time>, ora di <town>.` | `<time>（<town>時間）に承認しました。` | `تمت الموافقة في الساعة <time> بتوقيت <town>.` |
| C17 second press | `Already approved at <time> <town> time.` | `Già approvato alle <time>, ora di <town>.` | `<time>（<town>時間）に承認済みです。` | `تمت الموافقة بالفعل في الساعة <time> بتوقيت <town>.` |
| C18 replaced | `A newer estimate was made at <time> Turin time. Read it first.` | `È stato fatto un preventivo più recente alle <time>, ora di Torino. Leggilo prima.` | `<time>（トリノ時間）に新しい見積もりが作成されました。先にお読みください。` | `أُعدّ تقدير أحدث في الساعة <time> بتوقيت تورينو. اقرأه أولاً.` |
| C19 due | `Please answer by <date>.` | `Rispondi entro il <date>.` | `<date> までにご回答ください。` | `يرجى الإجابة قبل نهاية يوم <date>.` |
| C20 ended | `This page has ended.` | `Questa pagina è scaduta.` | `このページは終了しました。` | `انتهت هذه الصفحة.` |
| C21 refresh failed | `Couldn't refresh. Trying again.` | `Aggiornamento non riuscito. Riprovo.` | `更新できませんでした。再試行します。` | `تعذر التحديث. نحاول مرة أخرى.` |
| C22 busy | `Working…` | `Attendi…` | `処理中…` | `جارٍ العمل…` |
| C23 required | `This field is required.` | `Questo campo è obbligatorio.` | `この項目は必須です。` | `هذا الحقل مطلوب.` |
| C24 region | `Announcements` | `Annunci` | `お知らせ` | `الإعلانات` |
| C25 region | `Refresh state` | `Stato di aggiornamento` | `更新の状態` | `حالة التحديث` |
| C26 region, heading | `Problems` | `Problemi` | `問題` | `المشكلات` |
| C27 caption | `Before` | `Prima` | `施工前` | `قبل` |
| C28 caption | `After` | `Dopo` | `施工後` | `بعد` |
| C29 slider value | `<n>% before` | `<n>% prima` | `施工前 <n>%` | `<n>% قبل` |
| C30 picture | `Photograph before the work` | `Foto prima del lavoro` | `施工前の写真` | `صورة قبل العمل` |
| C31 picture | `Photograph after the work` | `Foto dopo il lavoro` | `施工後の写真` | `صورة بعد العمل` |
| C32 picture | `Drawing of the chosen material` | `Disegno del materiale scelto` | `選んだ素材の図` | `رسم المادة المختارة` |
| C33 label | `Dye lot` | `Partita di tintura` | `染色ロット` | `دفعة الصبغ` |
| C34 label | `Material` | `Materiale` | `素材` | `المادة` |
| C35 label | `Labour` | `Manodopera` | `工賃` | `العمل` |
| C36 label | `Subtotal` | `Subtotale` | `小計` | `المجموع الفرعي` |
| C37 label | `Tax` | `Imposta` | `税` | `الضريبة` |
| C38 label | `Total` | `Totale` | `合計` | `الإجمالي` |
| C39 label | `Stage <n>` | `Fase <n>` | `第<n>段階` | `المرحلة <n>` |
| C40 no material | `Frame work only, no material` | `Solo lavoro sul telaio, nessun materiale` | `フレームの作業のみ（素材なし）` | `عمل على الهيكل فقط، بلا مادة` |
| C41 no estimate | `No estimate yet.` | `Ancora nessun preventivo.` | `見積もりはまだありません。` | `لا يوجد تقدير بعد.` |
| C42 heading | `Condition notes` | `Note sullo stato` | `状態の記録` | `ملاحظات الحالة` |
| C43 kind | `Tear` | `Strappo` | `裂け` | `تمزق` |
| C44 kind | `Crack` | `Crepa` | `ひび` | `شرخ` |
| C45 kind | `Stain` | `Macchia` | `しみ` | `بقعة` |
| C46 kind | `Loose joint` | `Giunto allentato` | `接合部のゆるみ` | `مفصل مرخي` |
| C47 kind | `Woodworm` | `Tarlo` | `虫食い` | `سوس الخشب` |
| C48 toolbar name | `Main action` | `Azione principale` | `主な操作` | `الإجراء الرئيسي` |
| C49 loading tile | `Loading…` | `Caricamento…` | `読み込み中…` | `جارٍ التحميل…` |
| C50 no photographs | `No photographs yet.` | `Ancora nessuna foto.` | `写真はまだありません。` | `لا توجد صور بعد.` |
| C51 no notes | `No condition notes yet.` | `Ancora nessuna nota sullo stato.` | `状態の記録はまだありません。` | `لا توجد ملاحظات حالة بعد.` |
| C52 failed send | `Your answer could not be sent. Try again.` | `Invio non riuscito. Riprova.` | `回答を送信できませんでした。もう一度お試しください。` | `تعذر إرسال إجابتك. حاول مرة أخرى.` |
| M1 mail subject | `Your estimate for <title>` | `Il preventivo per <title>` | `<title> のお見積もり` | `تقدير <title>` |
| M2 reminder subject | `Reminder: your estimate for <title>` | `Promemoria: il preventivo per <title>` | `リマインダー: <title> のお見積もり` | `تذكير: تقدير <title>` |
| M3 greeting | `Dear <name>,` | `Gentile <name>,` | `<name> 様` | `مرحبًا <name>،` |
| M4 address line | `Read it and answer here: <address>` | `Leggilo e rispondi qui: <address>` | `こちらからご確認のうえご回答ください: <address>` | `اقرأه وأجب من هنا: <address>` |
| K1 care card heading | `Care card` | `Scheda di cura` | `お手入れカード` | `بطاقة العناية` |
| K2 care card text | `Keep the piece out of direct sun and away from radiators. Dust it with a soft dry cloth. Ask the conservator before using any cleaner.` | `Tieni il pezzo lontano dal sole diretto e dai termosifoni. Spolveralo con un panno morbido e asciutto. Chiedi al restauratore prima di usare qualsiasi detergente.` | `直射日光と暖房器具を避けてください。乾いた柔らかい布でほこりを払ってください。クリーナーを使う前に修復担当者にご相談ください。` | `أبعد القطعة عن أشعة الشمس المباشرة والمدافئ. أزل الغبار بقطعة قماش ناعمة وجافة. استشر المرمِّم قبل استخدام أي منظف.` |

**Town names on the client page.**

| English | Italian | Japanese | Arabic |
|---|---|---|---|
| Turin | Torino | トリノ | تورينو |
| London | Londra | ロンドン | لندن |
| New York | New York | ニューヨーク | نيويورك |
| Kyoto | Kyoto | 京都 | كيوتو |
| Dubai | Dubai | ドバイ | دبي |

**Dates on the client page and in its mail.**
- English: `Mon 29 Mar 2027` form.
- Italian: `lun 29 mar 2027`. Days are lun mar mer gio ven sab dom; months are gen feb mar apr mag giu lug ago set ott nov dic.
- Japanese: `2027年3月29日(月)`. Days are 月 火 水 木 金 土 日.
- Arabic: `الاثنين 29 مارس 2027`. Days are الاثنين الثلاثاء الأربعاء الخميس الجمعة السبت الأحد; months are يناير فبراير مارس أبريل مايو يونيو يوليو أغسطس سبتمبر أكتوبر نوفمبر ديسمبر.

### Screen rules (DP-03, DP-09, DP-14, DP-19, DP-24, DP-29, DP-34, DP-40, DP-43, DP-46, DP-50, DP-54, DP-55)

- **SR1.** Every signed-in screen and the client page re-read their data from the server every 5 seconds while open. A refresh changes only what changed, in place: focus stays on the same control; an open dialog, sheet, menu or popover stays open with what was typed and does not play its opening again; a refused dialog keeps its message; an open accordion stays open; an expanded row stays expanded; the scroll position stays.
- **SR2.** Closing a dialog, sheet or popover (Escape, its Close button or a tap outside a sheet) returns focus to the control that opened it at once and leaves the page behind usable at once while the closing animation still runs. Pressing that control again during the closing animation opens it again, which no leftover close timer may undo.
- **SR3.** Under reduced motion every dialog, sheet, menu, popover and accordion opens and closes at once (a closed one is gone from the screen and the accessibility tree within 100 ms), every loop stops and every sequence shows its end state at once with the same function.
- **SR4.** At 375x812 every control offers a touch area of at least 44 by 44 CSS pixels: buttons, links (including links in list rows, table cells, navigation rows and back links), form fields, file inputs, menu items, accordion headers and the label of each radio and checkbox. Links inside a sentence of running text are the only exception.
- **SR5.** An automated WCAG 2.2 AA check (axe-core, tags wcag2a, wcag2aa, wcag21aa, wcag22aa) reports no violation on every screen at 375x812 and 1280x800 with its dialog or sheet open and closed. A wide table at 375 scrolls sideways inside its own frame, and that frame takes keyboard focus and has an accessible name.
- **SR6.** At 375x812 the main action of each screen that lists one sits in a bar fixed to the bottom, and a control that receives focus by Tab or tap is scrolled fully into view between the top bar, any sticky heading and the bottom bar. The public pages, `/sign-in` and `/sign-up` list no main action and have no bottom bar, so there a focused control is scrolled fully into view below the header.
- **SR7.** All motion is CSS transitions or animations or the element's own animate call with exactly the durations 160, 320 and 640 ms, never frames timed by script, never any other duration (no library or browser default) and nothing that loops forever.
- **SR8.** Every Tab stop shows a visible focus ring. Opening a dialog or sheet moves focus inside it to its first field (otherwise its first control) on every opening, not only the first. Every dialog and sheet keeps Tab and Shift+Tab inside it (a native dialog element alone does not), closes on Escape, even when it holds only links, and returns focus to its opener. The Work panel and the non-modal pin popover are exempt from the Tab trap and follow their own rules in Interactions, and the Work panel also takes no focus on opening.
- **SR9.** A closed accordion panel, menu, sheet or popover is hidden and inert: its controls leave the Tab order the moment it starts closing, and it leaves the accessibility tree when its closing animation ends (collapsing to zero height or moving off-screen is not closing).
- **SR10.** Pointer and touch behaviour follow each event's pointer type, never hover or pointer media queries.
- **SR11.** While a button's request is open, its visible text and its accessible name both read F-01. It carries aria-disabled="true" and never the disabled attribute, a further press does nothing, focus stays on it, and it reads its own name again afterwards.
- **SR12.** When an action closes a dialog or removes the control that opened it, focus moves to the screen's level-one heading if that control is gone, otherwise back to that control, and stays there through the following refresh and any list reload.
- **SR13.** A menu, popover, date picker or combobox list opened inside a scrolling frame or at the end of a list is never cut off: every one of its items is fully on screen and can be pressed where it shows, at 375 and 1280.
- **SR14.** Every screen prints the same characters whatever the browser's language, zone and clock: opened with German as the language, Pacific/Auckland as the zone and a device clock three days ahead, the same address shows the same visible text, because every date, number, count and time-dependent state is formatted in the published form and decided by the server.
- **SR15.** At 320x568 no page scrolls sideways (only the published frames do), and a name of up to 80 characters with no spaces wraps wherever it prints.
- **SR16.** No text is ever cut off, with an ellipsis or by clipping, on any screen at 375x812 or 1280x800, also with text spacing overridden (line height 1.5, letter spacing 0.12em, word spacing 0.16em, paragraph spacing 2em).
- **SR17.** At 812x375 every screen works: an open dialog or sheet scrolls inside itself so that each of its controls can be reached, and no bar covers the focused control.
- **SR18.** With forced colours on, every Tab stop still shows a ring and each selected, current, checked or pressed state still shows by a mark that is not a background colour (a border, outline, glyph or underline).
- **SR19.** The Announcements region is on the page from first paint, before any action, and one message made twice in a row is announced twice (the region's content changes each time).
- **SR20.** When one refresh fails (network or a 5xx, whatever address the screen refreshes from), everything on the screen stays where it is, focus stays, no dialog opens, the single line F-02 shows in `Refresh state`, and the next good refresh clears it.
- **SR21.** Escape closes only the innermost open thing: a combobox list, menu or tip inside a dialog closes first, and the dialog stays open with focus inside it.
- **SR22.** What a screen shows on arrival is right with no scroll or pointer event: after a reload or Back at a scrolled position, sticky and scroll-linked parts are already in their scrolled state.
- **SR23.** Turning reduced motion on or off while a page is open applies from the next animation, with no reload.
- **SR24.** Every sheet rises from the bottom edge at 375x812 and slides from the right edge from 768 px wide (from the left edge in Arabic), and every dialog grows from its centre at 1280. Neither the Work panel nor the pin popover is covered by this rule.
- **SR25.** The box of every picture and drawing is reserved before its file arrives, so no text or control moves when a held image finally loads.
- **SR26.** Printing a case page, an estimate, the client page or a dossier shows only its content: no header, rail, bottom bar, open sheet or live region prints, and nothing runs past the width of an A4 page.
- **SR27.** A dialog or sheet reopened or closed while it is still moving carries on from where it is, with no jump to its start or end.
- **SR28.** The Announcements region stays in the accessibility tree while a dialog or sheet is open, so whatever makes the page behind inert or hidden leaves that region out.

**Forms, everywhere.**
- Every form error also appears in a Problems summary whose links move focus to their fields.
- A refused field has aria-invalid="true" and its message as its accessible description.
- A dialog refused by the server stays open as typed, with focus on the message in its own Problems summary.
- Sign-in pages take focus on their level-one heading on load.
- All published copy renders character for character, with straight apostrophes and the published dashes.
- The conservator's screens and the public site are in English; only the client page, its mail and the dossier's care card follow the client's language.
- Dialogs grow from their centre from 768 px wide and rise as sheets at 375.

**What a journey requirement's checks mean.** These apply to every journey requirement other than desk access. The public site re-reads nothing, so SR1 and SR20 do not apply there, and its session-cookie check reads the cookie set by signing in:

1. One screen-rules check on the workflow's own screen and endpoint. It sends one request breaking two published rules at once and expects the earlier error of the order, reads that workflow's response instants as whole-second Z, reads the session cookie's attributes, and checks SR1 to SR28 with that workflow's dialog, sheet, menu, popover or accordion.
2. A keyboard-only journey with the published focus targets, in which every write action checks SR8 focus on opening, SR11 with focus kept, SR12 focus afterwards and the Announcements copy, and every refused form checks its Problems links and aria-invalid.
3. A 375x812 touch journey with the same per-action checks, closed sheets hidden and inert, and no bar covering the focused control.
4. Its rare-state copy verbatim with the name and local time.
5. Its own precision rule.
6. Its own motion, read on the path a real action takes and not only on the first one (the reply path, the refused path and the interrupted path).

## Backend

### API (DP-01, DP-02, DP-08 to DP-53, DP-56)

JSON is the content type unless a row says multipart. Every key and every enum value in every body is camelCase. Every instant is UTC in whole seconds with a Z (for example `2027-03-29T04:20:00Z`, never milliseconds). Date-only fields are `YYYY-MM-DD`. Decimal strings are read exactly.

**Error shape, for every error:** `{"error": {"code": "...", "message": "...", "fields": {"name": "..."}}}`, with `fields` only for field errors and always inside `error`. No stack dump, SQL, path or library name ever appears in one. `message` is the published copy where one applies. On the client's endpoints it is in the page's language.

**One order for every request.**

1. Unknown route (404) or wrong method (405 with Allow).
2. A body or file over its published size limit (413, decided before the body is parsed and before authentication, always answered as JSON, never a dropped connection).
3. A state-changing request with a foreign Origin (403).
4. Rate limit (429 with Retry-After in whole seconds).
5. Authentication (401).
6. Unknown resource (404, or 410 for an ended private page).
7. Content type (415).
8. Malformed JSON (400).
9. Field validation (422).
10. State (409).
11. A stale edit (412).

A request with no session has no desk to count, so the per-desk limit does not apply to it. An enquiry body that cannot be read has no address to count, so the per-address limit does not apply to it. Endpoint rows name only their own extras.

**Limits.**
- A JSON body may be up to and including 1,000,000 bytes.
- JSON nesting may be up to and including 16 levels; deeper answers 422 within a second.
- Any query text over 200 characters answers 422 within a second.
- Field lengths count characters as code points, so an emoji counts as 1.
- Limits: client name, piece title, maker, enquiry name 120; year 40; pin note, piece notes 2,000; enquiry message 5,000; email 254.
- A longer value reads F-05 with status 422.

**Access.**

| Endpoint | Request | Success |
|---|---|---|
| GET /api/health | none | 200 `{"status":"ok"}`, with no session and whatever is down |
| POST /api/sign-up | `{"name":"Lena Rossi","email":"lena@desk.example","password":"long-enough-1"}` | 201 `{"session":{"deskId":"…","name":"Lena Rossi","email":"lena@desk.example","landing":"/pieces"}}`; 409 F-109 for an email already held |
| POST /api/session | `{"email":"agnese@bottega-semenza.example","password":"…","returnTo":"/pieces/1"}` (`returnTo` optional) | 200 same body, `landing` being the honoured address; 401 for a wrong pair |
| GET /api/session | none | 200 `{"session":{"deskId","name","email","today","latestAnswer":{"id","message","at"}}}` (`today` is today's Turin date, for anything a screen counts from today; `latestAnswer` may be null); 401 without a live session |
| DELETE /api/session | none | 204 |
| POST /api/password | `{"currentPassword":"…","newPassword":"…"}` | 204; 422 for a wrong current or short new password |

401 codes: `notSignedIn` with no session cookie, `sessionEnded` for an ended session's cookie.

**Clients.** A client body reads `{"id","name","town","language","email","state","closesAt"}`. State is `active`, `closing`, `erasing` or `erased`. Town is one of `Turin`, `London`, `New York`, `Kyoto`, `Dubai`.

| Endpoint | Request | Success |
|---|---|---|
| GET /api/clients | none | 200 `{"clients":[…]}` |
| POST /api/clients | `{"name":"Marta Bianchi","town":"Turin","language":"it","email":"marta@clients.example"}` (language optional) | 201 `{"client":…}` |
| GET /api/clients/<id> | none | 200 `{"client":…}`; 404 from `erasing` on |
| PATCH /api/clients/<id> | `{"name":"Marta B. Bianchi"}` (name, town, language, email) | 200 |
| DELETE /api/clients/<id> | none | 204 for a client with no pieces; 409 F-98 otherwise |
| POST /api/clients/<id>/close | `{}` | 200, state `closing` |
| POST /api/clients/<id>/bring-back | `{}` | 200, state `active`; 409 F-110 once the wait has ended, as qualified in Business rules |

An erased row in GET /api/clients reads `{"id","name":"Erased client","state":"erased"}` with no other value.

**Pieces.** Piece state is `received`, `inSurvey`, `onTheBench`, `ready`, `collected` or `archived`, shown as `Received`, `In survey`, `On the bench`, `Ready`, `Collected` and `Archived`.

| Endpoint | Request | Success |
|---|---|---|
| GET /api/pieces?client=&state=&sort=title&cursor= | query | 200 `{"pieces":[…],"nextCursor":"…"}` (null at the end), at most 25; default leaves out `archived`; `sort` is `title` or `dueDate`, ascending, with empty due dates last |
| POST /api/pieces | `{"clientId":"…","title":"Lounge chair","maker":"Officina Bressan","year":"1957","stampNumber":"48201768","widthCm":66,"depthCm":70,"heightCm":78,"weightKg":12.5,"dueDate":"2027-03-29","notes":"Bought at auction"}` (only `clientId` and `title` required) | 201 `{"piece":…}` |
| POST /api/pieces (duplicate) | `{"duplicateOf":"<id>"}` | 201; title `<title> (copy)`, no stamp number, new layout, no pins or photographs, state `received` |
| GET /api/pieces/<id> | none | 200 |
| PATCH /api/pieces/<id> | any field above, or `{"state":"archived"}` | 200; 422 F-13, 409 F-14 |

Wrong methods on /api/pieces/<id> answer 405 with `Allow: GET, PATCH`.

**Pins.**

| Endpoint | Request | Success |
|---|---|---|
| GET /api/pieces/<id>/pins | none | 200 `{"pins":[{"id","number","x","y","kind","note","signed"}]}` by y then x |
| POST /api/pieces/<id>/pins | `{"x":12.5,"y":80,"kind":"looseJoint","note":"**Loose** at the back rail","signed":true}` | 201 `{"pin":…}`; 422 F-08 for a JSON number outside 0 to 100, a negative one included, or past one decimal; 422 F-112 for a non-numeric `x` or `y` |
| DELETE /api/pieces/<id>/pins/<pinId> | none | 204 |

Kinds: `tear`, `crack`, `stain`, `looseJoint`, `woodworm`.

**Photographs.**

| Endpoint | Request | Success |
|---|---|---|
| GET /api/pieces/<id>/photographs | none | 200 `{"photographs":[{"id","number","side","sha256","bytes","state","createdAt"}]}` |
| POST /api/pieces/<id>/photographs | multipart: part `file`, part `side` (`before` or `after`, default `before`) | 201 `{"photograph":…}`, state `stored`; 413 F-25; 422 F-24; 409 F-26; 503 F-27 |
| GET /api/pieces/<id>/photographs/<photoId>/file | none | 200, the stored bytes |

**Layout.** A layout body reads:

```json
{"layout":{"version":3,"hide":{"widthCm":200,"heightCm":240,"areaSqFt":"51.67"},"flaws":[{"x":120,"y":80,"width":30,"height":20},{"x":20,"y":200,"width":16,"height":12}],"pieces":[{"name":"Seat","width":62,"height":58,"x":62,"y":30,"rotation":0,"state":"placed"}],"usedSqFt":"3.87","usedPercent":"7.5","changedAt":"2027-03-29T09:05:00Z"}}
```

| Endpoint | Request | Success |
|---|---|---|
| GET /api/pieces/<id>/layout | none | 200 |
| POST /api/pieces/<id>/layout | `{"version":3,"placements":[{"name":"Seat","x":62,"y":30,"rotation":0}]}` | 200, replaces the whole layout under the same checks |
| PUT /api/pieces/<id>/layout/placements/<name> | `{"x":62,"y":30,"rotation":0,"version":3}` | 200; 422 F-08, F-47, F-48, F-49, F-50 or F-112; 412 F-51 |
| DELETE /api/pieces/<id>/layout/placements/<name>?version=3 | none | 200, the piece back in the tray; 412 F-51 |

Names are `Seat`, `Back`, `Left side`, `Right side` and `Headrest`, URL-encoded.

**Materials, stock and holds.**

| Endpoint | Request | Success |
|---|---|---|
| GET /api/materials | none | 200 `{"materials":[{"code","name","family","unit","prices":{"eur","gbp","usd","jpy","aed"}}]}`; `family` is the supplier's name as printed, `unit` is `sqFt` or `metre` |
| POST /api/materials/refresh | `{}` | 200 `{"count":24}`; 503 F-29 or F-30 |
| GET /api/materials/<code>/lots | none | 200 `{"code":"VM-2041","lots":[{"lot":"L-2041-A","hides":2,"averageSqFt":"48.25"}]}`; 429 F-35; 503 F-36 |
| GET /api/pieces/<id>/holds | none | 200 `{"holds":[{"id","holdId","code","lot","quantity","state","endsOn","label"}]}` |
| POST /api/pieces/<id>/holds | `{"code":"VM-2041","lot":"L-2041-A","quantity":2}` (for a fabric `"quantity":"7.50"`) | 201 `{"hold":…}`, or 200 with the same hold for a repeat; 409 F-34, F-37, F-38, F-39, F-40, F-41; 429 F-35; 503 F-36 |

Hold state is `held` or `ended`, and `label` is F-33 or F-34 from the server.

**Estimates.** An estimate body reads:

```json
{"estimate":{"id":"…","version":1,"state":"open","currency":"EUR","materialCode":"VM-2041","lot":"L-2041-A","patternAreaSqFt":"14.54","hides":1,"metres":null,"labourHours":"12.50","labourRateMinor":8500,"materialMinor":66103,"labourMinor":106250,"subtotalMinor":172353,"taxPercent":22,"taxMinor":37918,"totalMinor":210271,"milestones":[{"percent":30,"amountMinor":63082},{"percent":40,"amountMinor":84108},{"percent":30,"amountMinor":63081}],"display":{"material":"€661.03","labour":"€1,062.50","labourRate":"€85.00","subtotal":"€1,723.53","tax":"€379.18","total":"€2,102.71","milestones":["€630.82","€841.08","€630.81"]},"createdAt":"2027-03-29T09:05:00Z"}}
```

| Endpoint | Request | Success |
|---|---|---|
| GET /api/pieces/<id>/estimates | none | 200 `{"estimates":[…]}`, newest first |
| POST /api/pieces/<id>/estimates (leather) | `{"materialCode":"VM-2041","lot":"L-2041-A","patternAreaSqFt":"62.50","labourHours":"12.50","openVersion":1}` | 201 |
| POST /api/pieces/<id>/estimates (fabric) | `{"materialCode":"VM-3051","lot":"L-3000-A","metres":"7.30","labourHours":"4.00"}` | 201 |
| POST /api/pieces/<id>/estimates (frame only) | `{"materialCode":null,"lot":null,"labourHours":"2.75"}` | 201 |
| POST /api/pieces/<id>/estimates/preview | any of these bodies | 200 `{"estimate":…}` with no `id` and nothing kept, with the same 422 and 409 answers |

State is `open`, `replaced` or `signedOff`. Each new estimate on a piece takes the next `version`. `openVersion` is the version of the open estimate the screen has read and is optional; when it no longer matches, the answer is 412 F-55. 422 F-56 or F-112; 409 F-37, F-38 or F-39 when the lot cannot hold it.

**Rates.**

| Endpoint | Request | Success |
|---|---|---|
| GET /api/rates | none | 200 `{"rates":[{"takesEffectOn":"2020-01-01","eur":"85.00","gbp":"72.00","usd":"92.00","jpy":"13800","aed":"340.00"}]}` |
| POST /api/rates | `{"takesEffectOn":"2027-03-29","eur":"90.00","gbp":"76.00","usd":"97.00","jpy":"14600","aed":"360.00"}` | 201; 422 F-59; 409 F-58 |

**Client page.**

| Endpoint | Request | Success |
|---|---|---|
| POST /api/pieces/<id>/client-page | `{}` | 201 `{"clientPage":{"address":"http://…/c/<token>","endsAt":"…Z","sentAt":"…Z"}}`; 409 F-62, F-63 |
| GET /api/pieces/<id>/client-page | none | 200 `{"clientPage":{"address","endsAt","sentAt","state","answer":{"seatHeightCm","typed","answeredAt"},"signOff":{"typedName","at"}}}`; state `live` or `ended`; `address`, `answer`, `signOff` may be null |
| DELETE /api/pieces/<id>/client-page | none | 204; applies on the page's next request |
| GET /api/client-pages/<token> | none | 200 `{"page":…}`, keys below; 404; 410 |
| POST /api/client-pages/<token>/answer | `{"seatHeight":"44,5"}` | 200 `{"answer":{"seatHeightCm":"44.5","typed":"44,5","answeredAt":"…Z"}}`; 422 C13 or C23 |
| POST /api/client-pages/<token>/sign-off | `{"estimateId":"…","typedName":"zoe orsted"}` | 200 `{"signOff":{"at":"…Z"}}`; 422 C14 or C23; 409 C17, code `alreadySignedOff`; 409 C18, code `estimateReplaced` |
| GET /api/client-pages/<token>/photographs/before, /after | none | 200, the latest stored file of that side |

The page body holds only these keys: `language`, `dir`, `clientName`, `pieceTitle`, `dueDate`, `endsAt`, `estimateId`, `material` (`name`, `code`, `lot`), `estimate` (`material`, `labour`, `subtotal`, `tax`, `total`, `milestones`, all printed amounts), `notes` (signed notes with `kind` and `note`), `answer` and `signOff`. It never holds a rate or hours.

**Bench.**

| Endpoint | Request | Success |
|---|---|---|
| GET /api/bench-jobs?week=2027-03-15 | query | 200 `{"week":"2027-03-15","jobs":[{"id","pieceId","pieceTitle","bench","day","dayLabel","glue":{"laidAt","curesAt","state","label"}}]}`; `glue` may be null; state `curing` or `cured`; with no `week` it answers the current Turin week |
| POST /api/bench-jobs | `{"pieceId":"…","bench":"frame","day":"2027-03-15"}` | 201 `{"job":…}`; bench is `frame` or `cover`; 409 F-66, F-67; 422 F-70 |
| PATCH /api/bench-jobs/<id> | `{"bench":"cover","day":"2027-03-16"}` | 200; same refusals |
| POST /api/bench-jobs/<id>/glue | `{"date":"2027-03-26","time":"16:00"}` | 200 `{"job":…}`; 422 F-68; 409 F-71 |

`label` in `glue` is `Curing until <datetime>` or `Cured`, from the server.

**Collections.**

| Endpoint | Request | Success |
|---|---|---|
| POST /api/pieces/<id>/collections/quote | `{}` | 200 `{"quote":{"quoteId":"Q-5001","amount":"412.50","currency":"EUR","display":"€412.50"}}`; 409 F-78; 429 F-73; 503 F-77 |
| GET /api/pieces/<id>/collections | none | 200 `{"collections":[{"id","state","collectAt","localDate","localTime","town","display","labelSha256"}]}` |
| POST /api/pieces/<id>/collections | `{"quoteId":"Q-5001","localDate":"2027-03-29","localTime":"09:00"}` | 201 `{"collection":…}`, 200 with the same one for a repeat; 422 F-68; 409 F-74, F-79; 429 F-73; 503 F-72 |
| GET /api/pieces/<id>/collections/<collectionId>/label | none | 200, the stored bytes as application/pdf |

State is `booked`, `collected`, `delivered` or, only for a seeded collection whose label is not yet stored, `waiting`. A `waiting` collection reads `Waiting` on screen with `labelSha256` null and no label link, and its label address answers 503 F-27. A booking never produces this state.

**Workbook and list file.**

| Endpoint | Request | Success |
|---|---|---|
| POST /api/workbook/preview | multipart part `file` | 200 `{"rows":[{"row":2,"status":"new","reason":null,"client":"…","piece":"…","stamp":"…"}],"counts":{"new":1,"matched":0,"refused":0}}`; status `new`, `matched` or `refused`; 413 F-82; 422 F-80, F-81, F-83 |
| POST /api/workbook/save | multipart part `file` | 200 `{"created":1,"matched":0,"refused":0,"sha256":"…"}`; same errors; 503 F-27 |
| GET /api/materials-list.csv | none | 200 text/csv, the materials list file |

The workbook limit counts the file alone, up to and including 2,000,000 bytes.

**Dossier.** A dossier body reads `{"dossier":{"id","state","message","signedBy","signedAt","history":[{"at","who","what"}]}}`. State is `waiting`, `rendering`, `stored`, `failed` or `signed`. `message` is null except when `failed`, where it is F-27 or F-90. `what` is `asked`, `rendered`, `stored` or `signed`.

| Endpoint | Request | Success |
|---|---|---|
| POST /api/pieces/<id>/dossier | `{}` | 202 with the body above; 409 F-92, F-96 |
| GET /api/pieces/<id>/dossier | none | 200; 404 before the first one |
| GET /api/pieces/<id>/dossier/pdf | none | 200 application/pdf; 429 F-91; 409 F-97 |
| POST /api/pieces/<id>/dossier/sign | `{"typedName":"Agnese Ferrero"}` | 200; 422 F-95; 409 F-96, F-97 |

**Search and enquiries.**

| Endpoint | Request | Success |
|---|---|---|
| GET /api/search?q=tabaco | query | 200 `{"results":[{"kind":"material","id":"VM-2041","label":"Tabacco VM-2041","href":"/library?material=VM-2041"}]}`, kind `material`, `client` or `piece`, at most 20; empty `q` 200 with `[]` and no call to the engine; 422 over 200 characters; 503 F-17 |
| POST /api/enquiries | `{"name":"Tomas Weil","email":"tomas@example.org","message":"A bentwood armchair with a split seat."}` | 202 `{"received":true}`, identical for a new and a known address; 429 F-12 |

### Business rules (DP-08 to DP-13, DP-15 to DP-18, DP-20 to DP-23, DP-25 to DP-28, DP-30 to DP-33, DP-35 to DP-39, DP-41, DP-42, DP-44, DP-45, DP-47 to DP-49, DP-51 to DP-53, DP-56)

**Time.** Business time is Europe/Rome. Screens show dates on the local date of the town named, never the UTC date. Tax days and rate days follow Turin time. Test dates are computed from the real current date; every 2027 date here is a worked example.

**Towns.**

| Town | Zone | Currency | Country and tax | Starting language |
|---|---|---|---|---|
| Turin | Europe/Rome | EUR | Italy 22% | it |
| London | Europe/London | GBP | United Kingdom 20% | en |
| New York | America/New_York | USD | United States none | en |
| Kyoto | Asia/Tokyo | JPY | Japan none | ja |
| Dubai | Asia/Dubai | AED | United Arab Emirates none | ar |

A client's language starts as the town's and can be changed.

**Timers (environment variables, seconds unless named).**

| Variable | Default |
|---|---|
| ENQUIRY_RATE_WINDOW_SECONDS | 3600 |
| FILE_RATE_WINDOW_SECONDS | 3600 |
| STOCK_CACHE_SECONDS | 300 |
| CLOSURE_WAIT_SECONDS | 2592000 |
| HOLD_DAYS (days) | 7 |
| CLIENT_PAGE_SECONDS | 1209600 |
| REMINDER_AFTER_SECONDS | 604800 |
| SESSION_SECONDS | 604800 |

A session lasts SESSION_SECONDS from sign-in and use does not extend it. Hold state, glue cure, retry minutes, page ends and session ends are all decided by the server; a device clock changes none of them.

**Stamp numbers.** Eight digits, the last a Luhn check digit. For example, `48201768` is valid and `48201769` reads F-13. A stamp already on this desk reads F-14 (409). An absent stamp is allowed; a duplicated piece has none.

**Piece state.** The conservator may set any state from any state. Archive sets `archived`.

**Pieces paging.** The order is the sort value and then the piece's id, and the cursor records the last row's values. So a piece added while paging never makes an existing row repeat or go missing.

**Search.**
- GET /api/search answers from Meilisearch and nothing else.
- It tolerates one typing slip in a word of five letters or more (for example `tabaco` finds `Tabacco`).
- It covers English, Italian, Japanese and Arabic text.
- Each entry holds the name exactly as printed, and results are filtered to the session's desk, so no other desk's names or counts ever return.
- A new or renamed piece is findable within 5 seconds.
- On start the app builds its index from the database, whatever the engine holds, and keeps trying while the engine is down.
- Lists read Postgres and keep working when search is down.

**Client state.**
- `active` → `closing`: close.
- `closing` → `active`: bring back within the wait, leaving the client, its pieces and its search entries exactly as they were.
- `closing` → `erasing`: the moment CLOSURE_WAIT_SECONDS has passed, checked at least every 2 seconds.
- `erasing` → `erased`: only after MinIO and Meilisearch have both confirmed each deletion, asked even for a client with no files. While either is down it stays `erasing`.
- Bring-back after the wait has passed but before the client has moved to `erasing` answers 409 F-110. From `erasing` on it answers 404, like every address under the client. An open screen reads F-110 for either answer.

During `closing` the client's addresses keep answering and no reminder goes; a reminder due in the wait goes once after a bring-back. From `erasing` on, every address under the client answers 404, private pages included (404, never 410), and its name is gone from search. From `erased` on its row reads `Erased client` with no name, and queued mail for it is dropped.

**Pins and notes.**
- Pins hold percent coordinates to one decimal.
- A pin's `number` is given in creation order per piece, starting at 1. It never changes, and a removed pin's number is not used again, so a new pin takes one more than the highest number the piece has ever had.
- A note accepts `**bold**`, `*italic*` and `[words](address)` with an address starting http://, https:// or mailto: only. Anything else, HTML and every other address included, shows as plain text on every screen, the client page and the PDF.
- A note is signed when `Signed note` is ticked.
- Only signed notes reach the client page and the PDF. A piece's own `notes` are unsigned and stay on the desk's screens and the materials list file.

**Photographs.**
- One file per request; a screen sends one request per file.
- A file is judged by its own header bytes as PNG or JPEG, never its name or declared type. An SVG is refused.
- A file may be up to and including 8,000,000 bytes, counted on the file alone and never on the multipart body. For example, a 7,990,000-byte file in a bigger request is accepted, and an 8,000,001-byte one answers 413 before anything else, sign-in included. The other parts may total 1,000,000 bytes.
- A file with the same SHA-256 as one on this piece reads F-26, numbered in upload order per piece.

**Library refresh.**
- Read `GET /v2/materials` and then, while an answer has `nextCursor`, `GET /v2/materials?cursor=<nextCursor>`.
- A page that fails leaves the earlier library exactly as it was.
- Entries go to Meilisearch and count only once it has confirmed; only then does the library change.
- The press is the only time the catalogue is read, and the seed's rows make no call.

**Stock.** The same code never calls the supplier twice within STOCK_CACHE_SECONDS, including asking for A, then B, then A. A failed read is not cached. The latest choice on screen wins even when an earlier answer arrives later.

**Holds.**
- The repeat key is derived from piece, material and lot. Two quick presses, two windows and later repeats make one `POST /v2/holds`, and each gets the same hold back.
- The same piece and lot with another quantity reads F-41.
- All hides on one piece come from one dye lot, so a second lot while one is held reads F-40.
- Asking for more than every lot holds reads F-37 or F-38; a chosen lot too small while another holds enough reads F-39.
- A 429 with Retry-After (seconds or a date) means no supplier call before that instant, and the answer gives F-35. A connection failure, a timeout or a 5xx answers 503 F-36.
- A hold lasts HOLD_DAYS from today's Turin date, through 23:59:59 Turin time on its last day. For example, a hold placed on Mon 22 Mar 2027 reads as held until Mon 29 Mar 2027 with the default.
- An ended hold stays ended, and asking again reads F-34.
- A hold request is checked in this order, with no supplier hold call for any refusal: the same piece and lot already held with the same quantity returns that hold; an ended hold on the same piece and lot reads F-34; a live hold on that lot with another quantity reads F-41; a live hold on another lot reads F-40; no lot holding enough reads F-37 or F-38; a chosen lot too small while another holds enough reads F-39. An estimate's lot check uses the last two steps in the same order.

**Hide.**
- One hide per piece, usable box 200 by 240 cm (48,000 square cm, shown as 51.67 sq ft; one square foot is exactly 929.0304 square cm).
- Pattern pieces are rectangles on a 1 cm grid: Seat 62 x 58, Back 62 x 74, Left side 30 x 74, Right side 30 x 74, Headrest 40 x 22.
- Every piece has this same hide, with two flaws: 30 x 20 at 120, 80 cm and 16 x 12 at 20, 200 cm.
- Seat, Back and both sides run with the grain, so they rotate only 0 and 180. Headrest is free: 0, 90, 180 and 270, and at 90 or 270 its box is 22 x 40. Rotating keeps the top-left.
- Any `x`, `y` or `rotation` that is not a JSON number, a digit string, null or an absent key included, reads F-112 (422), before the checks below. A rotation is checked before the placement. A grain-bound piece sent 90 or 270 reads F-50 (422), and any other numeric rotation that is not published for the piece, such as -90 or 45, reads F-08 (422).
- A placement is then tested in the order off the hide, then flaw, then overlap, flaws and pieces in their published order. Boxes that only touch along an edge neither cross nor overlap. x and y are whole numbers: a non-negative value that is not whole reads F-08, and any box edge outside the usable box, a negative JSON number for x or y included, reads F-47.
- The used figure is the placed pieces' area, half up on the exact value, to two decimals in sq ft and one in percent. For example, with only Seat placed the figure reads 3.87 sq ft and 7.5%; with all five placed, 14.54 sq ft and 28.1%.
- Every change raises the version. The version a lift carries is the one read when it was lifted, and after a 412 the next try uses the newest version.

**Estimates.**
- Hides are the pattern area times 1.15, divided by the chosen lot's average, rounded up. For example, 62.50 sq ft × 1.15 = 71.875 over a 48.25 sq ft lot is 2 hides; 125.00 sq ft is 3 hides, which no Tabacco lot holds.
- The pattern area defaults to the hide's five pieces half up to two decimals and is open to change.
- Leather is sold by the whole hide: the material line is hides × the lot's averageSqFt × the price per sq ft.
- Fabric is sold in quarter metres rounded up, then metres × the price per metre. For example, 7.30 m is 7.50 m, 7.50 m stays 7.50 m, 7.51 m is 7.75 m.
- Each material has five prices, and the client's town decides which applies.
- Areas show both units half up, for example `48.25 sq ft (4.48 m²)`.
- Rounding happens at one stage: material line and labour line each half up to the smallest unit on the exact value; subtotal their sum; tax half up on the subtotal; total their sum. EUR, GBP, USD and AED have cents; JPY has whole yen. Amounts are stored in minor units.
- For example: 48.25 sq ft at €13.70 is exactly 661.025, shown `€661.03`. 30.25 sq ft at €6.10 is exactly 184.525, shown `€184.53`. 52.75 sq ft at ¥1,990 is exactly 104,972.5, shown `¥104,973`. Frame-only work of 2.75 hours at €85.00 is €233.75, whose tax at 22% is exactly 51.425, shown `€51.43`.
- Worked example in full: material €661.03, labour 12.5 hours at €85.00 is €1,062.50, subtotal €1,723.53, Italian tax €379.18, total €2,102.71.
- Amounts print `€2,102.71`, `£2,102.71`, `US$2,102.71`, `¥104,973`, `AED 2,102.71`, the same in every language.
- Milestones take 30%, 40% and 30% of the total, rounded down, with any remaining smallest units going one each to the earlier milestones first. For example, €4,250.55 is €1,275.17, €1,700.22 and €1,275.16; ¥333,333 is ¥100,000, ¥133,334 and ¥99,999.
- Labour hours are quarter hours.
- A price, total, state or another desk's id sent in a body under a key the estimate endpoint does not publish, such as `deskId` or `pieceId`, is ignored and changes nothing. An estimate's material, rate and currency are read by the server.
- A new estimate on a piece replaces its open one (`open` → `replaced`). `signedOff` never changes, and the piece can move on with a later one.

**Labour rates.** Rates belong to a desk, and GET and POST /api/rates read and write only the session desk's table. Sign-up gives a new desk the starting row from Seed data, and no row can be removed, so a rate always applies and an estimate has no refusal for a missing one. A rate whose `takesEffectOn` is on or before today's Turin date applies to new estimates; the latest such row wins. Earlier estimates keep the rate stored with them on every screen. The dossier PDF prints no rate at all.

**Client page.**
- The token is at least 128 bits of random data.
- The page ends at the earlier of 23:59:59 client local wall time on the piece's due date and CLIENT_PAGE_SECONDS after sending, exactly at that instant, so a request at that instant finds it ended.
- A new address ends the old one, and the conservator's press ends it on the page's next request.
- An ended page answers 410 and prints C20 in its language with the right `lang` and `dir` from the server, for a request with no script run.
- An unknown token answers the same 404 page whatever it was, and the page never reveals another client.

**Seat height.** Typed text is stored exactly as typed. Accepted forms:

| Page language | Accepted forms | Example |
|---|---|---|
| English | Latin digits with `.` | `44.5` |
| Italian | Latin digits with `,` | `44,5` |
| Japanese | Latin digits with `.`, or full-width digits with `．` | `44.5`, `４４．５` |
| Arabic | Arabic-Indic digits with `٫`, or Latin digits with `.` | `٤٤٫٥`, `44.5` |

Each may be a whole number. The value must be from 30 to 60 inclusive with one decimal at most. The server answers the decimal string with a Latin point, for example `"44.5"`. An empty height, spaces only included, reads C23 (422). Anything else is refused with C13 (422). So `44.5` on the Italian page and `44,5` on the English page are refused.

**Sign-off.**
- An empty typed name, spaces only included, reads C23 (422); any other mismatch reads C14 (422).
- The typed name must equal the client's full name ignoring case, accents and surrounding spaces, under this folding table: lower-case; decompose and drop combining marks; `ø` to `o`, `ß` to `ss`, `ı` and `İ` to `i`, `æ` to `ae`, `œ` to `oe`, `ł` to `l`, `đ` to `d`. For example, `zoe orsted` matches `Zoë Ørsted`.
- Two presses from two windows sign off one time, and the second reads C17.
- `<time>` and `<town>` in C16 and C17 are the client's town's wall time.
- A signed-off estimate can never change.

**Answers.** A later answer overwrites the earlier one and notifies again. A new answer reaches the conservator's open screens within the 5-second refresh through `latestAnswer`, in place, and is announced as F-46. It is announced only for answers arriving after the screen opened.

**Reminder.** One reminder goes REMINDER_AFTER_SECONDS after sending only if no answer or sign-off came and the page is live, exactly one, in the page's language, checked at least every 2 seconds.

**Bench.**
- A week grid in Turin time, two rows (Frame bench, Cover bench) and five working days, one job per bench per day. The first of two simultaneous moves wins, and the other reads F-66 with its dialog open as typed.
- A bench day starts at 09:00 Turin time. A cover job goes on a day only if the piece's glue has cured by then. For example, glue laid on a Monday at 10:00 cures on Wednesday at 10:00, so its cover job can go on Thursday and not on Wednesday. A piece with no glue record has no such limit.

**Glue.**
- Glue cures for 48 hours of real elapsed time. For example, glue laid at Fri 26 Mar 2027, 16:00 Turin time cures at Sun 28 Mar 2027, 17:00 Turin time (that day has 23 hours), and glue laid at Fri 29 Oct 2027, 16:00 cures at Sun 31 Oct 2027, 15:00 (that day has 25 hours).
- A wall time that does not exist on its day is refused with F-68, for example for 02:30 in Turin on Sun 28 Mar 2027. One that happens twice is the first of the two.

**Collections.**
- A collection is booked in the client's local wall time and keeps it across clock changes. Screens show both, for example `Mon 29 Mar 2027, 09:00 New York time · 15:00 Turin time`, and for a client in Turin the Turin time once.
- Worked examples: a 09:00 New York collection is 14:00:00Z and 15:00 Turin time on Fri 12 Mar 2027; 13:00:00Z and 14:00 Turin time on Mon 15 Mar and Fri 26 Mar 2027; 13:00:00Z and 15:00 Turin time on Mon 29 Mar 2027; 13:00:00Z and 14:00 Turin time on Mon 1 Nov 2027; 14:00:00Z and 15:00 Turin time on Mon 8 Nov 2027. A 09:00 Kyoto one is 01:00 Turin time on Fri 26 Mar and 02:00 on Mon 29 Mar 2027. A 09:00 London one is 10:00 Turin time on both. A 09:00 Dubai one is 06:00 and then 07:00.
- A New York day has 23 hours on 14 Mar 2027 (F-68 for 02:30) and 25 on 7 Nov 2027. Non-existent and repeated times follow the glue rule.
- The repeat key is derived from the piece and quote, so two presses, two windows and a repeat attempt make one call in the journal. A repeat after `booked` returns that booking; another time under the same quote reads F-79.
- A quote goes from Turin to the client's town.
- The file store is checked first: with it down, no booking call goes to the courier and the answer is F-72.
- `Booked` shows only after the courier has confirmed and its label is stored.
- A 429 with Retry-After means no courier call before that instant.
- The server reads a collection's state when its screen asks, at most once per 30 seconds per collection. A failed read keeps the last known state.

**Workbook.**
- UTF-8 with or without a byte order mark; LF or CRLF; comma or semicolon separated as decided by the header row; double-quoted fields may hold a line break.
- The header row is exactly client, piece, maker, year, stamp, material, notes, read by name. An extra column refuses the whole file with F-80, tested first, and a missing one with F-81.
- A preview lists new, matched and refused rows with row numbers and reasons before anything is saved. A row's number counts records, not lines, with the header as row 1, so a line break inside a quoted field does not move the numbers.
- A row's checks run in this order: field count (F-87), stamp (F-84, an empty stamp included), title (F-85), material if given (F-86). A refused row never blocks the others.
- Rows match on the stamp number within the desk, and a matched row changes nothing the desk holds. A second row in one file with the same stamp is matched.
- A row's client is matched by its exact name or made new (town Turin, language it, no email).
- Saving the same file twice changes nothing. Text is stored exactly as written, never trimmed or retyped.

**Materials list file.**
- Comma separated, UTF-8, every field in double quotes with inner quotes doubled, CRLF line ends.
- The columns are piece, client, material, code, lot, hides, notes, starting with a header row.
- One row per non-archived piece of the desk, by title, using its latest open or signed-off estimate's material, lot and hides, empty when it has none.
- Any cell starting with =, +, -, @, a tab or a carriage return is prefixed with an apostrophe.

**Dossier.**
- It is made from the piece's latest signed-off estimate.
- It holds the piece, its stamp, signed condition pins as a table, the materials with their dye lot, before and after photographs and the care card in the client's language. It has no amounts.
- Its screen sections and hashes are `01 The piece` `#the-piece`, `02 Condition` `#condition`, `03 Materials` `#materials`, `04 Photographs` `#photographs`, `05 Care card` `#care-card`, `06 History` `#history`, with a rail following the case-page rule.
- The state moves `waiting` → `rendering` → `stored`, then `signed`. Any failure moves to `failed` with F-90 or F-27, leaving no object and no `stored`, and another press starts again.
- Downloads are limited to 5 per desk per FILE_RATE_WINDOW_SECONDS. Each request of a live session counts, and a sixth reads F-91.
- Signing needs the desk's name under the folding table. A signed dossier never changes.
- Its history lists who did what and when in order, and no API changes it.

**Enquiries.**
- A valid enquiry mails the conservator. Each run of line breaks in a name reads as one space in the subject and every header.
- The same email address, compared ignoring case, is limited to 3 valid enquiries per ENQUIRY_RATE_WINDOW_SECONDS, the window starting at the first one.

**Isolation.** Every route checks that each id in the path and each published id field in a body belongs to the session's desk. The published id fields are `clientId` and `duplicateOf` on the pieces endpoints and `pieceId` on POST /api/bench-jobs. Another desk's id in any of these answers 404, never 422. A key an endpoint does not publish, such as `deskId`, is ignored, whatever id it holds. Every list, count, search and download is held to the session's desk.

**Passwords.** Changing a password ends that person's other sessions at once, and the current session stays signed in.

### Services (DP-12, DP-13, DP-17, DP-20, DP-22, DP-23, DP-39, DP-44, DP-45, DP-48, DP-51, DP-52, DP-60)

**Postgres.** The system of record for desks, sessions, clients, pieces, pins, materials, layouts, estimates, client pages, bench jobs, collections and dossier history. Every list keeps working from it when search is down. The app applies its schema idempotently on start and seeds itself on an empty database, safely when several copies start together.

**MinIO.** Every file persists here byte for byte in the bucket `S3_BUCKET`, made if missing, and is confirmed before any screen says so. Keys:
- `photographs/<deskId>/<pieceId>/<sha256>`
- `labels/<deskId>/<pieceId>/<collectionId>.pdf`
- `workbooks/<deskId>/<sha256>.csv`
- `dossiers/<deskId>/<pieceId>/<dossierId>.pdf`

While it is down, files read F-27 and nothing is half-written.

**Mailpit.** Mail goes through SMTP_HOST and SMTP_PORT, each copy delivering its own pending mail. From is MAIL_FROM when set, otherwise `Semenza Desk <desk@bottega-semenza.example>`.
- Client page mail: to the client's email, subject M1, body M3, M4 and C19 in the client's language, with the due date in the client's local wall time, no labour rate and no other client's name.
- Reminder: the same with subject M2.
- Enquiry: to `agnese@bottega-semenza.example`, subject `Enquiry from <name>`, Reply-To the visitor's address, body with name, address and message.

**Gotenberg.** The app posts its own HTML to `POST $GOTENBERG_URL/forms/chromium/convert/html` with the pictures inside the request, and Gotenberg never calls the app. The answer goes to MinIO as the delivered PDF. With Gotenberg down, F-90 shows and nothing is saved.

**Meilisearch.** One index named `<SEARCH_INDEX_PREFIX>_entries` (default prefix `main`), primary key `id`, documents `{"id":"<deskId>-<kind>-<refId>","deskId":"…","kind":"material","refId":"VM-2041","label":"Tabacco VM-2041","href":"/library?material=VM-2041"}`. Searchable: `label`. Filterable: `deskId`. The app waits for each task's success before treating a write as confirmed. Its key never reaches the browser. With the engine down, /api/search answers 503, the box shows F-17 and lists keep working.

**WireMock: the supplier and courier.** All provider data below is invented. The app calls `$WIREMOCK_URL` with these paths. It waits at most 5 seconds for any provider and then treats it as unavailable, answering 503, never 500. The call count in the journal is the proof of the stock cache and of every repeat key. These stand-ins answer the same `holdId`, `quoteId` and collection `id` to every call, so the app keeps each as a plain reference and never as a unique key.

Supplier:

- `GET /v2/materials`, then `GET /v2/materials?cursor=p2`, then `?cursor=p3`, answers `{"materials":[…],"nextCursor":"p2"}`, 10 rows per page, 24 in all (pages 10, 10, 4); page 3 has no `nextCursor`. Each row is `{"code","name","family","unit","prices":{"eur","gbp","usd","jpy","aed"}}`, every price a decimal string read exactly.

| Code | Name | Family | Unit | EUR | GBP | USD | JPY | AED |
|---|---|---|---|---|---|---|---|---|
| VM-2041 | Tabacco | Aniline | sqFt | 13.70 | 11.90 | 14.80 | 1990 | 54.40 |
| VM-2042 | Ruggine | Aniline | sqFt | 15.20 | 13.20 | 16.40 | 2210 | 60.40 |
| VM-2043 | Inchiostro | Aniline | sqFt | 16.85 | 14.60 | 18.20 | 2450 | 66.90 |
| VM-2044 | Salvia | Semi-aniline | sqFt | 6.10 | 5.30 | 6.60 | 885 | 24.20 |
| VM-2045 | Avena | Semi-aniline | sqFt | 7.35 | 6.40 | 7.95 | 1070 | 29.20 |
| VM-2046 | Prugna | Semi-aniline | sqFt | 8.90 | 7.70 | 9.60 | 1295 | 35.30 |
| VM-2047 | Cuoio | Pull-up | sqFt | 11.25 | 9.75 | 12.15 | 1635 | 44.65 |
| VM-2048 | Noce | Pull-up | sqFt | 12.40 | 10.75 | 13.40 | 1800 | 49.25 |
| VM-2049 | Grafite | Pull-up | sqFt | 10.60 | 9.20 | 11.45 | 1540 | 42.10 |
| VM-3051 | Loden | Wool | metre | 64.00 | 55.50 | 69.10 | 9300 | 254.00 |
| VM-3052 | Feltro | Wool | metre | 58.50 | 50.75 | 63.20 | 8500 | 232.20 |
| VM-3053 | Bouclé | Wool | metre | 72.25 | 62.65 | 78.00 | 10500 | 286.80 |
| VM-3054 | Tweed | Wool | metre | 61.75 | 53.55 | 66.70 | 8975 | 245.10 |
| VM-3055 | Panno | Wool | metre | 55.40 | 48.05 | 59.85 | 8050 | 219.90 |
| VM-3061 | Canapa | Linen | metre | 42.60 | 36.95 | 46.00 | 6190 | 169.10 |
| VM-3062 | Lino grezzo | Linen | metre | 38.20 | 33.15 | 41.25 | 5550 | 151.65 |
| VM-3063 | Juta | Linen | metre | 29.90 | 25.95 | 32.30 | 4345 | 118.70 |
| VM-3064 | Rafia | Linen | metre | 34.75 | 30.15 | 37.55 | 5050 | 137.95 |
| VM-2050 | Mogano | Aniline | sqFt | 17.30 | 15.00 | 18.70 | 2515 | 68.70 |
| VM-2051 | Sabbia | Semi-aniline | sqFt | 7.80 | 6.75 | 8.40 | 1135 | 30.95 |
| VM-2052 | Ardesia | Semi-aniline | sqFt | 9.15 | 7.95 | 9.90 | 1330 | 36.35 |
| VM-2053 | Miele | Pull-up | sqFt | 11.95 | 10.35 | 12.90 | 1735 | 47.45 |
| VM-2054 | Corteccia | Pull-up | sqFt | 12.85 | 11.15 | 13.90 | 1865 | 51.00 |
| VM-2055 | Fumo | Pull-up | sqFt | 10.15 | 8.80 | 10.95 | 1475 | 40.30 |

- `GET /v2/materials/<code>/lots` answers `{"lots":[…]}`. VM-2041 has `{"lot":"L-2041-A","hides":2,"averageSqFt":"48.25"}` and `{"lot":"L-2041-B","hides":1,"averageSqFt":"52.75"}`. VM-2044 has `{"lot":"L-2044-A","hides":5,"averageSqFt":"30.25"}`. Every other VM-2 code has `{"lot":"L-2000-A","hides":6,"averageSqFt":"48.25"}` and every VM-3 code `{"lot":"L-3000-A","metres":"40.00"}`.
- `POST /v2/holds` takes `{"code","lot","quantity","pieceRef"}` (`pieceRef` is the piece's id) with an `Idempotency-Key` header, the repeat key, and answers 201 `{"holdId":"H-7001"}`.

Courier:

- `POST /v1/quotes` takes `{"fromTown","toTown","widthCm","depthCm","heightCm","weightKg"}` and answers 200 `{"quoteId":"Q-5001","amount":"412.50","currency":"EUR"}`.
- `POST /v1/collections` takes `{"quoteId","collectAt","town"}` (`collectAt` a UTC instant in whole seconds with a Z, `town` the client's town) with an `Idempotency-Key` header, and answers 201 `{"id":"C-9001","state":"booked","labelPath":"/v1/labels/C-9001"}`, or 409 `{"code":"slotTaken"}` for a time already taken.
- `GET /v1/collections/C-9001` answers `{"id":"C-9001","state":"booked","labelPath":"/v1/labels/C-9001"}`. The state may be `booked`, `collected` or `delivered`.
- `GET /v1/labels/C-9001` answers the 23 bytes `%PDF-1.4 portico label` and one line feed as application/pdf, SHA-256 `10b41b820211bdb162a7ee68a13fc3425999ee467b8e38b9059514da8a66a956`. Those bytes are what MinIO keeps.

### Seed data (DP-58)

Every seeded person and business is invented. Dates are set from the Turin date the copy starts, `<start>`. The seed makes no call to the supplier or courier. Every new desk made by sign-up gets the first twelve materials and the starting labour-rate row, and nothing else.

**Conservators.**

| Name | Email | Password |
|---|---|---|
| Agnese Ferrero | agnese@bottega-semenza.example | `tacks-and-hide-2027` |
| Ruben Marchetti | ruben@bottega-semenza.example | `second-desk-2027` |

**Clients and pieces.** All pieces are `In survey` unless the row says otherwise. All clients are `active`.

| Desk | Client (town, language) | Client email | Piece | Stamp | Maker, year | W x D x H cm, kg | Due |
|---|---|---|---|---|---|---|---|
| Agnese | Giulia Ricci (Turin, it) | giulia@clients.example | Lounge chair, On the bench | 48201768 | Officina Bressan, 1957 | 66 x 70 x 78, 12.5 | `<start>` + 21 days |
| Agnese | Harriet Osei (London, en) | harriet@clients.example | Tubular armchair | 60319522 | Atelier Lindqvist, 1931 | 60 x 64 x 74, 9 | + 28 |
| Agnese | Dana Whitlock (New York, en) | dana@clients.example | Cantilever side chair | 71540835 | Harlan & Vance, 1949 | 48 x 54 x 80, 6.5 | + 35 |
| Agnese | 中村 葵 (Kyoto, ja) | aoi@clients.example | Folding deck chair | 30972186 | Kobo Tanizawa, 1962 | 58 x 90 x 84, 7 | + 42 |
| Agnese | سارة المنصوري (Dubai, ar) | sara@clients.example | Swivel desk chair | 52166048 | Studio Marchand, 1968 | 62 x 62 x 92, 14 | + 49 |
| Agnese | Zoë Ørsted (London, en, a gallery owner) | zoe@clients.example | Bentwood armchair, Ready | 83407197 | Werkstatt Adler, 1926 | 56 x 58 x 82, 5.5 | + 14 |
| Agnese | MANIFATTURATESSILEEPELLETTERIADELLEVALLISUPERIORIDIBIELLAETORINO (Turin, it) | manifattura@clients.example | Slat bench | 26750414 | Falegnameria Conti, 1953 | 120 x 44 x 42, 18 | + 56 |
| Ruben | Ivo Kranjc (London, en) | ivo@clients.example | Walnut stool | 91283564 | Dom Novak, 1960 | 36 x 36 x 44, 3 | + 30 |

**Every seeded piece also has:**
- Generated before and after photographs as PNG files, numbered 1 and 2. On a copy with the file store down, seeded rows read `Waiting` until confirmed.
- Three pins: number 1, Tear at 20.0, 30.0 note `**Tear** along the front seam` signed; number 2, Stain at 50.0, 60.0 note `*Stain* under the left arm` signed; number 3, Loose joint at 80.0, 30.0 note `Check again before quoting` unsigned. In reading order they are `Pin 1: Tear`, `Pin 3: Loose joint` and `Pin 2: Stain`.
- A hide layout at version 1 with Seat placed at 0, 0, rotation 0, and the other four in the tray.

A piece made after the start has all five in the tray.

**Materials.** The first twelve rows of the supplier's table on each desk (VM-2041 to VM-2049 and VM-3051 to VM-3053). Lots come from the supplier when asked.

**Labour rate.** On each desk, one starting row taking effect `2020-01-01`: €85.00, £72.00, US$92.00, ¥13,800, AED 340.00 an hour.

**Holds.**
- Lounge chair, VM-2041, L-2041-A, 2 hides, `H-6001`, ending tomorrow's Turin date.
- Tubular armchair, VM-2044, L-2044-A, 1 hide, `H-6002`, ended yesterday's Turin date.

**Estimates.**

| Piece | Material, lot | Area sq ft | Hours | Material | Labour | Tax | Total | State |
|---|---|---|---|---|---|---|---|---|
| Lounge chair | VM-2041, L-2041-A | 14.54 | 12.50 | €661.03 | €1,062.50 | €379.18 | €2,102.71 | open |
| Tubular armchair | VM-2044, L-2044-A | 14.54 | 10.00 | £160.33 | £720.00 | £176.07 | £1,056.40 | open |
| Cantilever side chair | VM-2047, L-2000-A | 14.54 | 8.00 | US$586.24 | US$736.00 | US$0.00 | US$1,322.24 | open |
| Folding deck chair | VM-2041, L-2041-B | 14.54 | 6.00 | ¥104,973 | ¥82,800 | ¥0 | ¥187,773 | open |
| Swivel desk chair | VM-2043, L-2000-A | 14.54 | 5.00 | AED 3,227.93 | AED 1,700.00 | AED 0.00 | AED 4,927.93 | open |
| Bentwood armchair | VM-2042, L-2000-A | 14.54 | 9.00 | £636.90 | £648.00 | £256.98 | £1,541.88 | signed off by Zoë Ørsted, `<start>` − 1 day |

**Collections.** Two on Cantilever side chair, each at 09:00 New York time: `C-8001` on the last Monday before the next New York clock change, and `C-8002` on the first Monday after it. Each is `booked`, with the label bytes above stored (on a copy with the file store down, a seeded row has state `waiting` until its label is stored).

**Dossier.** One signed dossier on Bentwood armchair, signed by Agnese Ferrero on `<start>` − 1 day, rendered and stored on start when Gotenberg and MinIO are reachable, its strip otherwise waiting.

**Bench jobs in the current Turin week.** Lounge chair on the Frame bench on Monday; Tubular armchair on the Cover bench on Wednesday.

**Finished cases on the public site.**

| Slug | Case | Kind | Figure |
|---|---|---|---|
| `bentwood-armchair` | Bentwood armchair | leather | 38.75 sq ft |
| `tubular-lounge` | Tubular lounge | leather | 47.20 sq ft |
| `swivel-desk-chair` | Swivel desk chair | leather | 31.40 sq ft |
| `folding-deck-chair` | Folding deck chair | fabric | 8.25 m |
| `cantilever-side-chair` | Cantilever side chair | fabric | 6.50 m |
| `slat-bench` | Slat bench | frame-only | 0.00 sq ft |

## Technical requirements

### Deployment (DP-56, DP-58)

Backend: TypeScript on Node 22 with npm. Frontend: TypeScript built with Node 22 in the same `build`, with public pages server-rendered by the backend.

`/app/run.json` holds string `install`, `build` and `serve` and `"_schema":"run-manifest-v1"`, for example:

```json
{"_schema":"run-manifest-v1","install":"npm ci","build":"npm run build","serve":"npm run serve"}
```

The app binds `0.0.0.0` on 4173, honouring `APP_PUBLIC_PORT`. `/api/health` answers HTTP 200 JSON `{"status":"ok"}`.

The same build runs as these copies, each with its own database, bucket and search prefix, each safe when several start together, seeding itself on an empty database and delivering its own pending mail:

| Copy | Differences from the primary |
|---|---|
| primary | `SEARCH_INDEX_PREFIX` unset, meaning `main` |
| MinIO down | S3_ENDPOINT unreachable, `${DATABASE_URL}_storage`, `${S3_BUCKET}-storage`, prefix `storage`, CLOSURE_WAIT_SECONDS=5 |
| Gotenberg down | GOTENBERG_URL unreachable, `${DATABASE_URL}_render`, `${S3_BUCKET}-render`, prefix `render` |
| search down | MEILISEARCH_URL unreachable, `${DATABASE_URL}_search`, `${S3_BUCKET}-search`, prefix `search`, CLOSURE_WAIT_SECONDS=5 |
| short timers | `${DATABASE_URL}_short`, `${S3_BUCKET}-short`, prefix `short`, CLIENT_PAGE_SECONDS=20, REMINDER_AFTER_SECONDS=10, ENQUIRY_RATE_WINDOW_SECONDS=30, FILE_RATE_WINDOW_SECONDS=30, STOCK_CACHE_SECONDS=10, CLOSURE_WAIT_SECONDS=20 |
| short session | `${DATABASE_URL}_session`, `${S3_BUCKET}-session`, prefix `session`, SESSION_SECONDS=20 |
| spare | `${DATABASE_URL}_spare`, `${S3_BUCKET}-spare`, prefix `spare`, used for price tables that take effect today |

There is no WireMock-down copy; third-party failures are set per test through stubs and faults.

### Configuration and secrets (DP-60)

Read at start, never hard-coded or sent to the browser:

- DATABASE_URL
- S3_ENDPOINT, S3_REGION, S3_BUCKET, S3_FORCE_PATH_STYLE, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY
- SMTP_HOST, SMTP_PORT, MAILPIT_URL, MAIL_FROM
- WIREMOCK_URL
- GOTENBERG_URL
- MEILISEARCH_URL, MEILISEARCH_API_KEY, SEARCH_INDEX_PREFIX
- APP_PUBLIC_PORT, APP_PUBLIC_URL (the base of the private address when set, otherwise the request's own host)
- the timers listed in Business rules

### Server boundary (DP-13, DP-17, DP-56, DP-57)

**Published surface.** Only the published routes and endpoints exist, plus built files under `/assets/`, with no debug or test endpoints.
- An unknown API path answers 404 JSON.
- An unknown page address answers a server 404 page with heading F-100, never the app shell with 200.
- The desk's pages answer the same 404 for another desk's id or an erased or erasing client's records.
- A wrong method answers 405 with Allow, and a wrong content type 415.
- Source files and credentials are never served.

**Sessions.**
- The session cookie is HttpOnly, SameSite=Lax, never Secure (the app is served over plain http) and a browser-session cookie (no Max-Age or Expires).
- A signed-out request for a desk page redirects to `/sign-in?returnTo=<address>`.
- A return address is honoured only if it is a same-origin relative path: one leading `/`, no second `/` or `\` after it, and no scheme. Anything else lands on `/pieces`.

**Same origin.** The API is same-origin only. A state-changing request whose Origin is present and differs from the app's own origin answers 403.

**Size.** Limits are those in API, decided before the body is parsed. A file limit is counted on the file alone.

**Dependencies.** The app starts and serves with MinIO, Gotenberg or the search engine down, and retries. A provider failure on one action answers 503, never 500. The Meilisearch key and every provider credential stay on the server.

### Browser support and performance (DP-12, DP-54)

Chromium, Firefox and WebKit at 375x812, 768x1024 and 1280x800, also at 320x568 and 812x375 as Screen rules say. Each screen is usable within three seconds on the seed data. Over-long search text and over-deep JSON answer within one second. A search answer on the seed data arrives within one second of its pause.

## Working rules

- **IF-01** `/app/run.json` exists with string `install`, `build`, `serve` and `"_schema":"run-manifest-v1"`.
- **IF-02** `THIRD_PARTY_NOTICES.md` at `/app` lists every shipped package with its licence; shipped packages means the production dependency tree (`npm ls --omit=dev --all --json`).
- **IF-03** Shipped packages use only MIT, MIT-0, Apache-2.0, BSD-2-Clause, BSD-3-Clause, ISC, MPL-2.0, 0BSD, BlueOak-1.0.0 or CC0-1.0 licences, and a font package may be OFL-1.1.
- **IF-04** No datastore beyond the listed services is added, and no state that must outlive a restart is kept in process memory or on local disk.
- **IF-05** No payment provider, payment code or payment screen exists anywhere.
- **IF-06** No WebGL, canvas 3D or video file ships, and no image from outside the repository is copied in; imagery is generated by the app.
- **IF-07** Provided service configuration is left untouched, and the app calls the supplier and courier only through `WIREMOCK_URL`.

## Engineering standards

- Code is idiomatic strict TypeScript, with no use of an any type where a domain type exists.
- Names match the domain terms in this brief: desk, piece, pin, lot, hold, layout, placement, estimate, milestone, client page, bench job, collection, dossier.
- Each domain rule, such as a hold's end, a placement refusal, a milestone split or a client state move, is decided in exactly one place in the source.
- Money and decimal arithmetic never pass through a binary floating-point value.
- No abstraction has a single implementation, unless a language boundary demands it.
- There is no dead, commented-out or unreachable code, and no defensive check for an impossible state.
- All API errors are produced through one consistent error shape.
- No feature, endpoint or screen exists beyond this brief.
