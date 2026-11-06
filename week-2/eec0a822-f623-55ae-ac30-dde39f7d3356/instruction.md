# Lumen Tide Tidewright

Tidewright is an operations workspace for small and mid-size companies that run crewed solar-electric catamarans on week-long Mediterranean charters from a home base in Split and a second base in Lavrio. Each company gets one sealed workspace for selling weeks (holds, deposits and invoices), planning passages within the battery reserve, keeping a lawful crew rota, booking berths and shore power, running ship's stores, keeping the energy log, and collecting the guest manifest. It also gets a public fleet site, private pages for partner brokers, and a private manifest page for each lead guest. Build it in TypeScript on four backend services. Postgres holds every record and decides every status. MinIO stores passport photos and battery logs. Kill Bill receives one invoice per recorded deposit. Mailpit receives every mail the app sends. Out of scope: self-service sign-up, password reset, online card payment, any datastore beyond Postgres and MinIO, a members screen (member management is API only in this release), and any feature this brief does not describe.

## Problem and users

Today these companies spread the work over a broker availability platform, spreadsheets of weekly rates and holds, chat threads for crew rotas, and a builder's PDF range table that the captain checks by hand. Every season this costs money in the same ways:

- Two people hold the same last week, and one client has to be let down.
- A hold that lapsed hours ago still looks live on a phone whose clock is wrong.
- Rotas break the maritime rest rules across the October clock change, which risks detention at a port state inspection.
- Passages are planned below the 20% battery reserve because nobody added up the solar yield.
- Deposits are invoiced in the wrong currency, or with VAT charged on the provisioning allowance as well as the charter fee.

The fleet director pays for this in lost weeks, inspection fines and refunds. The charter manager pays for it in evenings spent reconciling.

Users:

- **Fleet director**: adds and removes members and sets their roles, edits yacht profiles, withdraws a yacht and puts it back on sale, and sees guest passport data. Weekly.
- **Charter manager**: places and converts holds, records deposits, and issues and ends broker pages and manifest pages. Daily.
- **Finance lead**: keeps marina tariffs and exchange tables current and checks on the Charters screen which charters Kill Bill has invoiced (a read-only check; invoicing itself happens only when a deposit is recorded). Weekly.
- **Captain**: plans passages within the battery reserve, keeps a lawful crew rota, books berths and shore power, uploads the energy log and closes charters. Daily.
- **Crew member**: sees their own yacht's rota, passages and stores, and logs stores received, used and spoiled. Daily.
- **Charter broker**: sees yachts, weeks and rates on a private broker page and places holds for their own clients. Weekly.
- **Lead guest**: browses the public fleet and completes the guest manifest with passport details and photos. Occasional.

## Journeys

1. **Selling a week.** The charter manager starts signed in on the Holds screen. They open a yacht's screen, choose a free week on its availability strip and place a hold for a named client in the Place hold dialog. The address bar shows the new hold's address. Later they open the hold, choose Record deposit, enter the client's email and currency, check the priced lines and confirm. They land on the charter, marked Invoiced. Kill Bill holds the invoice and Mailpit holds the client's confirmation.
2. **A partner broker sells for the company.** The charter manager starts on the Brokers screen and issues a broker page. The broker opens the address from their mail, sees the yachts, weeks and rates, and places a hold for one of their clients. The hold appears in the broker's own list and on the manager's Holds screen. When the manager ends the page or sends a new one, the old address shows the ended page.
3. **Planning a passage.** The captain starts on Passages, creates a passage for a yacht with a departure date and time, and adds legs between anchorages. They drag or key each leg's speed and watch the charge ribbon and every later leg's arrival charge change. Below-reserve legs are marked and Send to crew stays disabled until every leg arrives at or above the reserve. They save, then send. The crew member sees the sent passage.
4. **Keeping the rota lawful.** The captain starts on a yacht's rota for a week and marks work and rest in half-hour cells for each crew member, by keyboard or by touch. They save. A save that breaks a rest rule is refused with the crew member, rule and window named. A save over a newer save is refused naming who saved and when. Either way the typed cells stay on screen.
5. **Arriving in port.** The captain starts on Berths, picks a marina, a yacht, an arrival date and a number of nights, and sees which berths fit and what each night costs. They book a fitting berth from the Book berth sheet and land on the booking's address. On Shore power they book 30-minute slots on a pontoon. When another captain takes a slot's last capacity first, they are told who took it and when.
6. **The guest manifest.** The charter manager starts on a charter page and sends the lead guest a manifest page. The lead guest opens it from their mail, adds each guest, enters nationality, date of birth and passport number, and adds a passport photo for each. The captain sees the full manifest on the charter page. After the guests leave, the captain closes the charter. After the retention time, only the guest names remain.
7. **Fleet upkeep.** The fleet director starts on Fleet, opens a yacht's profile, corrects its measurements and season rates and saves. Later they withdraw the yacht, and its public page shows the gone page. Putting it back on sale returns it to the public fleet. The finance lead adds a marina tariff and an exchange table from future dates on Tariffs and exchange tables, and existing bookings and charters keep their prices. A lead guest browses the public fleet, filters it and opens a yacht page.
8. **Life aboard.** A crew member starts on Today, opens their yacht's stores, searches and pages through the list, adds a new item and lands on its address. They log bottles received, used and spoiled and see the on-hand count change. The captain uploads the day's battery log in the Upload daily log dialog and sees each day's charge and solar yield as a chart and as a table.

## Mandatory requirements

This is the complete list of mandatory requirements; every check traces to one of these lines and the detailed sections below.

- **DP-01 — Sign-in and sign-out without enumeration.** A wrong password and an email that belongs to no member get the identical 401 status and body, the right password starts a session, and signing out ends it.
- **DP-02 — Member management by the fleet director.** The fleet director lists the workspace's members, adds a member with a name, email, starting password and role, changes a member's role and removes a member.
- **DP-03 — Members sealed per workspace.** Any member id of the other company's workspace answers 404 with the same body as an unknown id on every member endpoint.
- **DP-04 — Member endpoints refuse other roles.** A charter manager, finance lead, captain or crew member calling any member endpoint of their own workspace gets 403.
- **DP-05 — Public fleet journey.** A lead guest browses a company's public fleet as a horizontal strip from 1024 px wide and as one column below it, moves the strip one card at a time from any of its controls, filters it in the Filters sheet (hidden and inert when closed, Tab kept inside it while open, kept open when reopened during its exit) and opens a yacht page, with the sun badge and loader stopped under reduced motion.
- **DP-06 — Fleet filters and filter sheet.** The base, cabins, season and week filters live in the address with each change adding one history entry that Back and Forward restore, and they sit in a Filters sheet.
- **DP-07 — Yacht page and availability strip.** Each public yacht page shows the yacht's measurements in the published metric and imperial format and its next 26 charter weeks with each week's status and weekly rate.
- **DP-08 — Withdrawn yacht is gone.** A withdrawn yacht's public address and public API answer 410 with the published gone copy, and the yacht leaves the fleet page, the fleet search and the sitemap until it is back on sale.
- **DP-09 — Hold placement journey.** A charter manager places a hold for a named client from a yacht's availability strip through the Place hold dialog, which keeps Tab inside it and returns focus to the week's button on Escape, then sees the hold's own address in the address bar and the same hold after a reload, and on the hold screen an action's message stays through the 10-second refresh.
- **DP-10 — Hold line and lapse.** A hold lapses HOLD_SECONDS after it is placed or moved up, an action at or after that instant is refused as too late, and the next hold in line for the week becomes live within 10 seconds, as qualified in Business rules.
- **DP-11 — Last free week goes to one.** Of two hold requests that reach the same free week together, exactly one becomes the live hold and the other is refused with the name of who took the week and when, shown and announced in the published copy.
- **DP-12 — Hold times and statuses from the server.** Every hold screen shows each hold's status exactly as the server reports it and its lapse time in Split time, also for Lavrio yachts and with the device clock hours off, and enables its buttons from that status.
- **DP-13 — Charge ribbon journey.** A captain creates a passage, adds legs between published anchorages, tunes each leg's speed until no leg arrives below the 20% reserve and sends the passage to the crew, with every charge announcement in Passage updates character for character and, below 1024 px, the Leg speeds sheet hidden and inert when closed and its sticky Save passage bar never covering the focused slider.
- **DP-14 — Leg distance, arrival charge and reserve.** Each leg's distance, arrival time, arrival charge and reserve state follow the passage energy rule in Business rules, alike on screen, in the leg's data attributes and in the API.
- **DP-15 — Planner keyboard and legs strip.** Each leg speed slider steps 0.5 kn on the arrow keys and 2.0 kn on Page Up and Page Down and jumps to 4.0 and 12.0 kn on Home and End, [ and ] select the previous and next leg whichever control of the legs has focus, and the vertical wheel moves the wide legs strip one leg at a time.
- **DP-16 — Departures across clock changes.** A departure typed inside its base's spring-forward gap is refused on its field, a repeated autumn time means its first occurrence, and each arrival is shown in its anchorage's base time.
- **DP-17 — Charge ribbon motion.** On every speed change the changed digits roll over 180 ms, reserve bands fade over 360 ms and the ribbon eases over 720 ms, all starting together, and under reduced motion all three show their end state at once.
- **DP-18 — Rota editing journey.** A captain fills in a week of half-hour work and rest cells for a yacht's crew, saves it and, when a save is refused for a rest rule or a newer save, sees the published copy with every typed cell kept, with the grid scrolling sideways only inside its own frame at 768x1024 and 375x812 and the Discard changes dialog keeping Tab inside it and returning focus to its opener.
- **DP-19 — Rota grid keyboard and touch.** The rota grid is a single Tab stop in which arrow keys move one cell, Shift with an arrow extends the selection, Space switches work and rest, Home and End jump within the row, and a tap switches a cell.
- **DP-20 — Rest rules on elapsed hours.** A rota save that breaks a rest rule answers 422 naming the crew member, the rule and the first window that breaks it, with every window counted in real elapsed hours across clock changes.
- **DP-21 — Stale rota save.** A rota save based on an older version answers 412 naming who saved and when, and the screen keeps every typed cell.
- **DP-22 — Rota visibility.** A crew member sees only their own yacht's rota and passages, and another yacht's rota or passages answer 404.
- **DP-23 — Berth booking journey.** A captain searches a marina's berths for a yacht and dates in one column at 768x1024 and 375x812, books a berth that fits through the Book berth sheet, which keeps Tab inside it and returns focus to its opener, lands on the booking's own address and books shore-power slots on a pontoon.
- **DP-24 — Berth fit.** A berth fits when the yacht's length is at most the berth's length, its beam at most the berth's width and its draft plus 0.30 m at most the berth's depth, equal values fitting, and booking a berth that does not fit answers 409.
- **DP-25 — Marina tariffs by night.** Each booked night is priced from the marina tariff in force on that night's local date, and existing bookings keep their prices on every surface after a finance lead adds a tariff.
- **DP-26 — Shore-power slots.** Shore power is booked in 30-minute local slots within a pontoon's kilowatt limit, exactly one of two simultaneous claims on a slot's last capacity wins while the other is told who took it and when, and every slot shows open, full or past as the server reports.
- **DP-27 — Deposit journey.** A charter manager opens a live hold, records the client's deposit in the client's currency through the Record deposit dialog, which keeps Tab inside it and stays open as typed when refused, and lands on a charter marked Invoiced with its priced lines, shown in one column at 768x1024 and 375x812.
- **DP-28 — Charter pricing.** A charter is priced from the season's weekly rate, a 30% provisioning allowance and the base country's VAT on the charter fee only, with each line converted to the client's currency and rounded half up to the minor unit, as qualified in Business rules.
- **DP-29 — Deposit, invoice and mail together.** Recording a deposit creates the charter, one Kill Bill invoice with one item per line and one mail to the client together or creates none of them, and a double click records it once.
- **DP-30 — Invoicing outage.** While Kill Bill is unreachable a deposit answers 503 with nothing recorded, invoiced or mailed, the published outage copy stays on screen through every later repaint, and every other screen keeps working.
- **DP-31 — Exchange tables by effective date.** A deposit uses the exchange table in force on its Split date, and charters priced earlier keep their amounts on the charter page, the invoice and the mail after a finance lead adds a table.
- **DP-32 — Manifest journey.** A charter manager sends the lead guest a private manifest page, the lead guest enters every guest's details and passport photo on it, with the Save manifest bar fixed to the bottom at 768x1024 and 375x812 without covering the focused field and the Add guest sheet hidden and inert when closed, and the captain sees the complete manifest on the charter page.
- **DP-33 — Manifest page lifetime.** A manifest page ends MANIFEST_PAGE_SECONDS after issue, when the charter manager ends it, when a new page replaces it or when the charter is closed, and from then on answers 410 with the published ended copy whatever the device clock says.
- **DP-34 — Passport photo checks.** A passport photo is accepted only when its content decodes as a JPEG or PNG image, is stored without location data and with its camera orientation applied, and a refused photo stores nothing.
- **DP-35 — Passport data reach.** Passport numbers, dates of birth and passport photos reach only the captain and the fleet director, never the manifest page, broker pages, crew screens, any mail or any other role's API response.
- **DP-36 — Erasure after closing.** Within 10 seconds of MANIFEST_RETENTION_SECONDS after the captain closes a charter, its guests' passport numbers, dates of birth, nationalities and photos are erased from the database and from storage, leaving only the guest names.
- **DP-37 — Energy log journey.** A captain uploads a yacht's battery daily log through the Upload daily log dialog, which keeps Tab inside it and returns focus to its opener, and sees charge and solar yield per day as a chart with a table alternative, in two columns only from 1024 px.
- **DP-38 — Log kept as uploaded.** The stored daily log object is byte for byte the uploaded file, and the chart and table read from a separate working copy.
- **DP-39 — Log upload limits.** A log file of up to 2,000,000 bytes, counted on the file alone, is accepted within the request envelope allowance in API and a larger file answers 413, a request that is not a multipart form answers 415, and a wrong method answers 405 with an Allow header.
- **DP-40 — Storage outage and recovery.** On a copy started while MinIO is unreachable, staff sign in and use every other screen, log and passport photo uploads answer 503 with the published outage copy and nothing stored, and each upload tries MinIO again so the app recovers without a restart.
- **DP-41 — Stores journey.** A crew member adds a store item for their own yacht, lands on the item's own address, and logs stores received, used and spoiled from the Log movement sheet (hidden and inert when closed, Tab kept inside it while open, kept open when reopened during its exit) with its saved message kept after the list repaints.
- **DP-42 — On-hand counts.** Every store item's on-hand count equals received minus used minus spoiled, and a movement that would take it below zero answers 409 with the published copy, also when movements arrive together.
- **DP-43 — Stores paging and search.** The stores list pages by a cursor of at most 50 items that never repeats or skips an item while items are added or removed, another yacht's stores answer 404, and the search shows the results for its latest input.
- **DP-44 — Broker page journey.** A charter manager issues a partner broker a private broker page sent by mail, and the broker places holds for their own clients from it through the Hold for a client sheet, which keeps Tab inside it and returns focus to its opener, with each yacht's weeks as a strip only from 1024 px.
- **DP-45 — Broker page fields.** A broker page, its API and its mail carry only the published broker fields, never other brokers' clients, crew, passport data, internal notes or staff email addresses.
- **DP-46 — Broker hold rate limit.** A broker page takes at most 5 hold requests within BROKER_RATE_WINDOW_SECONDS, and the sixth answers 429 with Retry-After in whole seconds before the page or the request is checked.
- **DP-47 — Broker page lifetime.** A broker page ends BROKER_PAGE_SECONDS after issue, when the charter manager ends it or when a new page replaces it, and from then on answers 410 with the published ended copy whatever the device clock says.
- **DP-48 — Profile editing journey.** The fleet director edits a yacht's name, cabins, measurements and season rates in the two-column profile from 1024 px and saves them from the Save profile bar, which never covers the focused field below 1024 px, and withdraws the yacht and puts it back on sale through their confirm dialogs, each keeping Tab inside it and staying open when reopened during its exit.
- **DP-49 — Metric and imperial figures.** Yacht and berth measurements are entered in metres and shown everywhere as metres to one decimal, a spaced en dash, and feet and inches with 12 inches carrying into the next foot, as set out in Business rules.
- **DP-50 — Profile form errors.** A refused profile save shows each field error inline and in a Problems summary whose links move focus to their fields, and keeps everything typed.
- **DP-51 — Sign-in landing and ended sessions.** Sign-in lands each role on its published home address, and a session that ends or loses access mid-form refuses the next action with the published copy, keeps what was typed and, for an ended session, puts it back after signing in again.
- **DP-52 — Error precedence and published surface.** Every API request that breaks several rules gets the earliest answer of the single error ladder in API, unpublished paths answer 404, a wrong method answers 405 with an Allow header and a wrong content type answers 415.
- **DP-53 — Exact starting state.** A fresh copy on its own empty database and bucket starts with exactly the seed data and no other records.
- **DP-54 — Published layouts.** At 1280x800 every screen shows its wide layout and at 768x1024 and 375x812 its one-column layout, with no sideways overflow and no control covered by a sheet or sticky bar.
- **DP-55 — Dialogs, sheets and shortcuts.** Every dialog, sheet and menu is hidden and inert when closed, moves focus to its published first control on open, keeps Tab and Shift+Tab inside, closes on Escape, returns focus to its opener and stays open when reopened during its exit, and each published shortcut works from any control of its region but never while typing.
- **DP-56 — Motion system.** Every motion runs as a style transition, style animation or element animation lasting 180, 360 or 720 ms, every loop stops and every sequence shows its end state at once under reduced motion, and touch handling follows each event's pointer type.
- **DP-57 — Accessibility check.** An automated WCAG 2.2 AA check passes on every screen at every published viewport, also with each of its dialogs and sheets open.
- **DP-58 — Chart-paper look.** Screens read as a calm chart-paper workspace with serif display headings, tabular mono figures, hairline-ruled strips of cards and amber kept for charge and solar data alone.
- **DP-59 — Charge ribbon craft.** The charge ribbon reads at a glance as the yacht's battery across the passage, with clear arrival points, a dashed reserve line and hatched below-reserve legs that look made for this product.
- **DP-60 — Credentials from the environment.** Every service URL and credential is read from its environment variable at start, and none is written in the source or sent to the browser.

## Frontend

### Screens and layout (DP-05, DP-07, DP-09, DP-13, DP-18, DP-23, DP-27, DP-32, DP-37, DP-41, DP-44, DP-48, DP-54)

There are three published viewports: 1280x800, 768x1024 and 375x812. Every wide layout (horizontal strips and two-column screens) starts at 1024 px wide. 768x1024 and 375x812 therefore both show the one-column layout. No breakpoint between them may give 768 a two-column or strip layout. No screen scrolls sideways at any of the three sizes. The rota grid and the energy chart scroll sideways only inside their own framed areas. Bottom sheets and sticky action bars never cover the control that was just tapped or focused: the page or sheet scrolls that control into view above the bar.

Every screen has exactly one level-1 heading, listed below. Each named list, table or strip renders even when empty, with an empty line of text (for example `No holds yet.`, `No passages yet.`, `No items match.`, `No logs yet.`).

Every address below can be reloaded or opened directly and shows the same screen. `<ws>` is the workspace slug. Sign-in sends each role to its home address:

- fleet director: `/w/<ws>/fleet`
- charter manager: `/w/<ws>/holds`
- finance lead: `/w/<ws>/charters`
- captain: `/w/<ws>/today`
- crew member: `/w/<ws>/today`

Public screens:

| Address | Level-1 heading | Shows | 1280x800 | 768x1024 and 375x812 |
|---|---|---|---|---|
| `/sign-in` | `Sign in to Tidewright` | Email and password form | Centred narrow form | Same, full width |
| `/fleet/<ws>` | `<workspace name> fleet` | Sun badge, search box, Filters button, list `Yachts` of yacht cards (line drawing of the hull, name, base, cabins, length, weekly rate) | Cards in one horizontal strip with a progress hairline under it | Cards stacked in one column, no hairline |
| `/fleet/<ws>/<yacht slug>` | `<yacht name>` | Hull drawing, measurements, cabins, season rates, list `Weeks` (availability strip) | Weeks as a horizontal strip | Weeks stacked |
| Gone page (withdrawn yacht's address) | gone heading from Feedback states | Gone copy and a link to the fleet | One column | One column |
| `/m/<token>` | `Guest manifest for <yacht name>` | Week dates, one fieldset per guest, Add guest button, sticky Save manifest bar | One column with the bar at the end of the form | One column with the Save manifest bar fixed to the bottom of the screen |
| `/b/<token>` | `Availability for <broker company name>` | One section per yacht with list `Weeks for <yacht name>`, then table `Your holds` | Each yacht's weeks as a horizontal strip | Weeks stacked |
| Ended page (ended manifest or broker page) | ended heading from Feedback states | Ended copy | One column | One column |
| Any other address | `We couldn't find that page` | Link to sign in | One column | One column |

Staff screens. Each has a top bar with the brand, the workspace name, navigation `Workspace` and the Sign out button. Navigation shows only the links the role may use (see Roles in Business rules). At 1280x800 the navigation is always visible. Below 1024 px it sits in the Menu dialog opened by the Menu button.

| Address | Level-1 heading | Shows | 1280x800 | 768x1024 and 375x812 |
|---|---|---|---|---|
| `/w/<ws>/today` | `Today` | List `Your yachts` (captain: every yacht; crew member: their own) with links Rota, Passages, Stores, plus Energy for the captain; list `Upcoming passages` | One column | One column |
| `/w/<ws>/fleet` | `Fleet` | List `Yachts` with name, base, `On sale` or `Withdrawn`, links Weeks and Profile (Profile for the fleet director only) | One column | One column |
| `/w/<ws>/yachts/<yacht slug>` | `<yacht name>` | List `Weeks` (availability strip with a hold button per week), table `Holds on this yacht` | Weeks strip across the top, table below | Weeks stacked, table below |
| `/w/<ws>/yachts/<yacht slug>/profile` | `<yacht name> profile` | Profile form, Problems summary, figures preview in the published format, Withdraw yacht or Put back on sale | Two columns: form left, preview and status actions right; Save profile at the end of the form | One column; Save profile in a sticky bar fixed to the bottom |
| `/w/<ws>/holds` | `Holds` | Table `Holds` | One column | One column; the table becomes a list of stacked rows |
| `/w/<ws>/holds/<hold id>` | `Hold for <client name>` | Hold details, status, lapse time, Record deposit and Release hold | Two columns: details left, actions right | One column |
| `/w/<ws>/charters` | `Charters` | Table `Charters` | One column | Stacked rows |
| `/w/<ws>/charters/<charter id>` | `Charter for <client name>` | Table `Charter lines`, invoice status, manifest section with table `Guests` and its page actions, Close charter | Two columns: lines and invoice left, manifest right | One column |
| `/w/<ws>/passages` | `Passages` | Table `Passages`, New passage link | One column | Stacked rows |
| `/w/<ws>/passages/new` | `New passage` | New passage form | One column | One column |
| `/w/<ws>/passages/<passage id>` | `<passage name>` | Departure fields, ribbon `Charge ribbon`, list `Legs` with a progress hairline, Add leg, Save passage, Send to crew | Legs in a horizontal strip with the ribbon running across it, sliders inside the leg cards | Legs stacked, ribbon above them; sliders in the Leg speeds bottom sheet with a sticky Save passage bar |
| `/w/<ws>/yachts/<yacht slug>/rota?week=<YYYY-MM-DD>` | `<yacht name> rota` | Week links, tab list `Rota days`, grid `Rota`, Save rota | Grid at full width | Grid in its own framed area that scrolls sideways, crew names fixed at the left |
| `/w/<ws>/berths` | `Berths` | Search form, list `Berths` | Two columns: form left, results right | One column |
| `/w/<ws>/berth-bookings/<booking id>` | `Berth <berth code>, <marina name>` | Booking details, table `Nights` | One column | One column |
| `/w/<ws>/shore-power` | `Shore power` | Pickers, list `Slots` | Two columns: pickers left, slot board right | One column |
| `/w/<ws>/yachts/<yacht slug>/stores` | `<yacht name> stores` | Search box, list `Stores`, Load more, Add item | One column | One column |
| `/w/<ws>/yachts/<yacht slug>/stores/<item id>` | `<item name>` | Received, used, spoiled and on-hand counts, Log movement, Remove item | One column | One column |
| `/w/<ws>/yachts/<yacht slug>/energy` | `<yacht name> energy` | Chart `Charge and solar by day`, table `Energy by day`, table `Uploaded logs`, Upload daily log | Two columns: chart and day table left, uploaded logs right | One column: chart, then day table, then logs |
| `/w/<ws>/brokers` | `Brokers` | Table `Brokers` with each page's status and actions | One column | Stacked rows |
| `/w/<ws>/tariffs` | `Tariffs and exchange tables` | Table `Marina tariffs`, table `Exchange tables`, Add buttons | Two columns: tariffs left, exchange tables right | One column |

Every screen that shows a time says which base's time it is (the formats in Business rules carry the base's name).

### Public screens and controls (DP-05, DP-06, DP-09, DP-13, DP-15, DP-18, DP-19, DP-23, DP-27, DP-32, DP-37, DP-41, DP-44, DP-48, DP-50, DP-55)

Only the roles, names and copy below are public. Everything else is free. Each accessible name equals the control's visible text, with no part of it repeated. Placeholders in angle brackets are filled from the record.

The whole app shares two live regions: `status "Announcements"` (polite) and, on the planner only, `status "Passage updates"`. Every action message in Feedback states appears on the page next to its action and, with the same characters, in Announcements.

Shared and sign-in:

| Role and name | Where | Notes |
|---|---|---|
| `textbox "Email"`, `textbox "Password"`, `button "Sign in"` | Sign-in | |
| `navigation "Workspace"` | Staff top bar | Links `Today`, `Fleet`, `Holds`, `Charters`, `Passages`, `Berths`, `Shore power`, `Brokers`, `Tariffs`, by role |
| `button "Menu"` → `dialog "Menu"` | Staff top bar below 1024 px | First control: the first navigation link |
| `button "Sign out"` | Staff top bar | |
| `link "Sign in again"` | Session-ended message | Opens `/sign-in` and returns to the same address afterwards |
| `region "Problems"` with heading `Problems` | Top of every form that is not in a dialog | One link per field error, text `<field label>: <message>`; activating a link moves focus to that field |

Public fleet and yacht page:

| Role and name | Notes |
|---|---|
| `img "Solar-electric fleet"` | The sun badge in the fleet header |
| `searchbox "Search yachts"` | Filters by yacht name as you type |
| `button "Filters"` → `dialog "Filters"` | First control: `combobox "Base"` |
| `combobox "Base"` | Options `Any base` (default), `Split`, `Lavrio` |
| `combobox "Cabins"` | Options `Any cabins` (default), `3 or more`, `4 or more`, `5 or more`, `6` |
| `combobox "Season"` | Options `Any season` (default), `Low season`, `Shoulder season`, `High season` |
| `combobox "Week"` | Options `Any week` (default), then the 26 weeks labelled `Week of <week date>` |
| `button "Show yachts"`, `button "Clear filters"` | Inside Filters; Show yachts closes the sheet |
| `list "Yachts"` with one `listitem` per yacht containing `link "<yacht name>"` | |
| `progressbar "Fleet position"` | Hairline under the strip, 0 to 100, from 1024 px only |
| `list "Weeks"` with one `listitem` per week | Text `Week of <week date>`, then `Free`, `Held` or `Booked`, then the weekly rate |
| `img "<yacht name> hull drawing"` | Line drawing of the hull, sized from the yacht's length and beam |

Holds (staff):

| Role and name | Notes |
|---|---|
| `button "Hold week of <week date>"` | On each free or held week of the staff yacht screen; not shown on booked weeks |
| `dialog "Place hold"` | First control `textbox "Client name"`; buttons `button "Place hold"` (free week) or `button "Join the line"` (held week), `button "Cancel"` |
| `table "Holds"` and `table "Holds on this yacht"` | Columns Yacht, Week, Client, Placed by, Status, Lapses (the lapse time, or `—` for a waiting hold) |
| `button "Record deposit"` → `dialog "Record deposit"` | First control `textbox "Client email"`; `radiogroup "Currency"` with `EUR` (default), `GBP`, `USD`; `table "Price"` showing the quote; buttons `button "Record deposit"`, `button "Cancel"` |
| `button "Release hold"` → `dialog "Release hold"` | First control `button "Keep hold"`; then `button "Release hold"` |
| `link "Open charter"` | On a hold whose status is charter |

Hold status labels: `Live`, `Waiting, <position> in line`, `Lapsed`, `Released`, `Charter`.

Charters and manifest (staff):

| Role and name | Notes |
|---|---|
| `table "Charters"` | Columns Yacht, Week, Client, Total, Invoice; Invoice reads `Invoiced` or `Not invoiced` |
| `table "Charter lines"` | Rows Charter fee, Provisioning allowance (30%), VAT <rate>% on charter fee, Total; columns EUR and client currency |
| `button "Send manifest page"` → `dialog "Send manifest page"` | First control `textbox "Lead guest name"`; `textbox "Lead guest email"`; buttons `button "Send manifest page"`, `button "Cancel"` |
| `button "End manifest page"` → `dialog "End manifest page"` | First control `button "Keep page"`; then `button "End page"` |
| Manifest page status text | `Manifest page live until <time>`, `Manifest page ended` or `No manifest page sent` |
| `table "Guests"` | Captain and fleet director: Name, Nationality, Date of birth, Passport number, Photo (a link `Photo of <guest name>`). Charter manager: Name only |
| `button "Close charter"` → `dialog "Close charter"` | Captain and fleet director; first control `button "Cancel"`; then `button "Close charter"` |

Manifest page (lead guest):

| Role and name | Notes |
|---|---|
| `group "Guest <n>"` per guest | Contains `textbox "Full name"`, `combobox "Nationality"` (default `Choose a country`, then every ISO 3166-1 country by its English name in alphabetical order, each option's value its two-letter code, for example `Croatia` (HR), `Germany` (DE), `Greece` (GR) and `United Kingdom` (GB)), `textbox "Date of birth"`, `textbox "Passport number"`, and the file input `Passport photo for <guest name>` opened by `button "Add passport photo for <guest name>"` |
| Saved-detail notes | `Passport details on file` and `Photo on file` show under a guest whose data is stored; stored values are never shown again |
| `button "Add guest"` → `dialog "Add guest"` | Bottom sheet below 1024 px; first control `textbox "Full name"`; buttons `button "Add guest"`, `button "Cancel"` |
| `button "Save manifest"` | In the sticky bar |

Passage planner:

| Role and name | Notes |
|---|---|
| `combobox "Yacht"` | New passage only; default the first yacht by name |
| `textbox "Passage name"`, `textbox "Departure date"` (YYYY-MM-DD), `textbox "Departure time"` (HH:MM, 24-hour, the yacht's base time) | |
| `spinbutton "Starting charge"` | Whole percent, default 100 |
| `combobox "Start anchorage"` | New passage only; default the anchorage of the yacht's base marina |
| `button "Create passage"` | New passage |
| `img "Charge ribbon"` | Carries `data-min-charge` (whole percent, the lowest arrival charge; empty when there are no legs) |
| `list "Legs"` with one `listitem` per leg | Carries `data-arrival-charge` (whole percent) and `data-reserve` (`ok` or `below_reserve`); shows heading `Leg <n>: <from> to <to>`, distance, arrival time in the arrival base's time, `Arrives with <charge>%`, and, when below, the words `Below reserve` |
| `slider "Leg <n> speed"` | 4.0 to 12.0, step 0.5, value text `<speed> kn`; in the leg card from 1024 px, in the Leg speeds sheet below |
| `button "Remove leg <n>"` | In each leg card |
| `progressbar "Legs position"` | Hairline under the strip, from 1024 px only |
| `button "Add leg"` → `dialog "Add leg"` | First control `combobox "Arrive at"`, default the first anchorage in seed order that is not the passage's current end; buttons `button "Add leg"`, `button "Cancel"`; new legs start at 6.0 kn |
| `button "Set speeds"` → `dialog "Leg speeds"` | Below 1024 px only; bottom sheet; first control the selected leg's slider; contains every leg's slider and the sticky `button "Save passage"` |
| `button "Save passage"`, `button "Send to crew"` | Send to crew is disabled while any leg is below reserve or there are no legs |
| `status "Passage updates"` | Charge announcements |

Rota:

| Role and name | Notes |
|---|---|
| `link "Previous week"`, `link "Next week"` | |
| `tablist "Rota days"` | Seven tabs labelled `<day> <date> <month>` (for example `Sat 27 Mar`) |
| `grid "Rota"` | One row per crew member with a `rowheader` of their name; one `columnheader` per half-hour slot of the chosen day labelled `HH:MM`, with the second run of a repeated autumn hour labelled `HH:MM (repeat)`; each `gridcell` shows `W` for work or `R` for rest and is selected when in the selection |
| `button "Save rota"` | |
| `dialog "Discard changes"` | Opens when leaving a week with unsaved cells; first control `button "Keep editing"`; then `button "Discard changes"` |

Berths and shore power:

| Role and name | Notes |
|---|---|
| `combobox "Yacht"` | Default the first yacht by name |
| `combobox "Marina"` | Berths: default the chosen yacht's base marina. Shore power: default `Split Marina` |
| `textbox "Arrival date"`, `spinbutton "Nights"` (default 1), `button "Search berths"` | |
| `list "Berths"` | Each item shows `Berth <code>`, its measurements, `Fits` or `Doesn't fit`, `Available` or `Booked`, the nightly fees and the total; plus `button "Book berth <code>"` on fitting available berths |
| `dialog "Book berth"` | Booking sheet (bottom sheet below 1024 px); `table "Nights"`; first control `button "Book berth"`; then `button "Cancel"` |
| `combobox "Pontoon"` | Default the marina's first pontoon by code |
| `textbox "Date"` | Default today's local date at the marina, as the server reports it |
| `list "Slots"` | Each item shows `<HH:MM>–<HH:MM>` (en dash), `Open`, `Full` or `Past`, the booked and limit kilowatts, and `button "Book <HH:MM> slot"`, enabled only while the server says Open |

Stores:

| Role and name | Notes |
|---|---|
| `searchbox "Search stores"` | |
| `list "Stores"` | Each item: `link "<item name>"`, `<on hand> <unit> on hand`, and `button "Log movement for <item name>"` |
| `button "Load more"` | Shown while the server returns a next cursor |
| `dialog "Log movement"` | Sheet (bottom sheet below 1024 px); first control `radiogroup "Movement"` with `Received` (default), `Used`, `Spoiled`; `textbox "Quantity"`; buttons `button "Log movement"`, `button "Cancel"` |
| `button "Add item"` → `dialog "Add item"` | First control `textbox "Item name"`; `textbox "Unit"`; `combobox "Category"` with `Provisions` (default), `Drinks`, `Cleaning`, `Engine room`, `Safety`; buttons `button "Add item"`, `button "Cancel"` |
| `button "Remove item"` → `dialog "Remove item"` | Item page; first control `button "Keep item"`; then `button "Remove item"` |

Energy:

| Role and name | Notes |
|---|---|
| `button "Upload daily log"` → `dialog "Upload daily log"` | First control the file input `Log file`; buttons `button "Upload log"`, `button "Cancel"` |
| `img "Charge and solar by day"` | Bars of solar yield per day with a charge line |
| `table "Energy by day"` | Columns Date, Start charge, End charge, Lowest charge, Solar yield |
| `table "Uploaded logs"` | Columns File, Size, Uploaded, By |

Brokers:

| Role and name | Notes |
|---|---|
| `table "Brokers"` | Columns Broker, Contact, Page; Page reads `Live until <time>`, `Ended` or `No page` |
| `button "Issue broker page for <broker name>"` → `dialog "Issue broker page"` | First control `button "Cancel"`; then `button "Issue page"`; the dialog says `Any earlier page for this broker ends at once.` |
| `button "End broker page for <broker name>"` → `dialog "End broker page"` | First control `button "Keep page"`; then `button "End page"` |

Broker page (public):

| Role and name | Notes |
|---|---|
| `list "Weeks for <yacht name>"` | Each week shows its date, status and rate, and `button "Hold <yacht name>, week of <week date>"` when free or held |
| `dialog "Hold for a client"` | Hold sheet (bottom sheet below 1024 px); first control `textbox "Client name"`; buttons `button "Place hold"` or `button "Join the line"`, and `button "Cancel"` |
| `table "Your holds"` | Columns Client, Yacht, Week, Status, Lapses |

Yacht profile and tariffs:

| Role and name | Notes |
|---|---|
| `textbox "Name"`, `spinbutton "Cabins"`, `textbox "Length (m)"`, `textbox "Beam (m)"`, `textbox "Draft (m)"` | |
| `textbox "Low season weekly rate (EUR)"`, `textbox "Shoulder season weekly rate (EUR)"`, `textbox "High season weekly rate (EUR)"` | Typed as euros with up to two decimals |
| `button "Save profile"` | Sticky bar below 1024 px |
| `button "Withdraw yacht"` → `dialog "Withdraw yacht"` | First control `button "Cancel"`; then `button "Withdraw yacht"` |
| `button "Put back on sale"` → `dialog "Put back on sale"` | First control `button "Cancel"`; then `button "Put back on sale"` |
| `table "Marina tariffs"`, `table "Exchange tables"` | |
| `button "Add tariff"` → `dialog "Add tariff"` | First control `combobox "Marina"` (default `Split Marina`); `textbox "Effective date"`; `textbox "Rate per metre per night (EUR)"`; buttons `button "Add tariff"`, `button "Cancel"` |
| `button "Add exchange table"` → `dialog "Add exchange table"` | First control `textbox "Effective date"`; `textbox "EUR to GBP"`; `textbox "EUR to USD"`; buttons `button "Add exchange table"`, `button "Cancel"` |

### Interactions (DP-05, DP-06, DP-09, DP-12, DP-13, DP-15, DP-18, DP-19, DP-23, DP-27, DP-41, DP-43, DP-44, DP-51, DP-55)

Dialogs, sheets and the menu:
- Opening moves focus to the published first control.
- Tab past the last control wraps to the first, and Shift+Tab before the first wraps to the last. A native dialog element alone does not do this, so build the wrap yourself.
- Escape closes, and focus returns to the control that opened it.
- A closed dialog, sheet or menu is hidden and inert at every viewport. Nothing inside it is visible, focusable or in the accessibility tree. Sliding it off-screen does not count as closed.
- Opening it again during its closing animation keeps it open. No leftover timer may hide it later.
- When the server refuses a dialog's action, the dialog stays open with everything typed, the error shows inline, and focus moves to the first field in error (or to the action button when the error is not about a field).
- Forms never use the browser's own required or length blocking. The server's 422 errors show inline under each field and, outside dialogs, also in the Problems summary.

Shortcuts:
- Each single-key shortcut works whichever control of its region has focus, a button or link included.
- It never fires while focus is in a text field or a text-like spinbutton.

Public fleet:
- From 1024 px the cards form one horizontal strip. ArrowLeft and ArrowRight move it one card per press, whichever control of the strip has focus.
- Each wheel event over the strip with a vertical delta counts as one notch: a positive delta moves it one card on and a negative one a card back, at most one card per 360 ms, and a notch within 360 ms of the last move is ignored. At the first or last card the wheel scrolls the page instead.
- The Fleet position hairline shows the current card's place as its position (0 for the first card) ÷ (cards − 1) × 100, rounded half up to a whole number, so 0 at the first card and 100 at the last; with one card it is 0.
- Each change to Base, Cabins, Season or Week applies at once and adds exactly one history entry. Back and Forward return to the earlier filter set and show it in the controls.
- Typing in Search yachts updates the list and replaces the current history entry without adding one.
- Choose Show yachts to close the sheet. Clear filters resets every filter to its default and adds one history entry.
- With `Any season` each card shows `From <low rate> a week`. With a season chosen it shows `<that season's rate> a week`.

Holds:
- On the staff yacht screen, Hold week of <week date> opens Place hold for that week. Place hold sends a hold with queue off. Join the line, offered on a held week, sends it with queue on.
- On success the address bar shows `/w/<ws>/holds/<hold id>` and the hold screen opens. On refusal the dialog stays open with the copy from Feedback states. Escape or Cancel returns focus to the week's button.
- Hold screens read statuses and lapse times only from the server. They read them when they open, after every action, and again every 10 seconds. They never count down or change a status from the device clock. Record deposit is enabled only while the server says live. Release hold is enabled while it says live or waiting.
- Record deposit loads the quote for the chosen currency, and changing Currency loads it again. Confirm disables the button until the answer arrives, so a double click sends one request. Success opens `/w/<ws>/charters/<charter id>`. Refusal keeps the dialog open as typed.

Passage planner:
- Create passage saves the passage and opens `/w/<ws>/passages/<passage id>`.
- Moving a slider by pointer, touch or key updates, all at the same moment:
  - the ribbon from that leg rightward;
  - every later leg's arrival time and charge;
  - each reserve band and `Below reserve` label;
  - Send to crew's enabled state;
  - each leg's data attributes and the ribbon's `data-min-charge`.
- Each move also puts one message in Passage updates about the moved leg only, using the charge announcement in Feedback states.
- Figures update in under a tenth of a second. They are exactly what the server returns for the same inputs once saved.
- Slider keys: ArrowLeft and ArrowDown lower 0.5 kn, ArrowRight and ArrowUp raise 0.5 kn, Page Down lowers 2.0 kn, Page Up raises 2.0 kn, Home sets 4.0 and End sets 12.0. Every value is clamped to 4.0 to 12.0.
- [ selects the previous leg and ] the next, whichever control of the legs has focus (a slider, a Remove leg button or the strip itself). Focus moves to that leg's slider where it is shown (in the leg card from 1024 px, or in the open Leg speeds sheet), and otherwise to that leg's Remove leg button. From 1024 px the strip glides to the leg. Below 1024 px the leg scrolls into view, or into view inside the Leg speeds sheet when it is open.
- From 1024 px the vertical wheel over the legs strip moves one leg per notch, as on the fleet strip, and the Legs position hairline follows by the same formula.
- Below 1024 px, Set speeds opens the Leg speeds bottom sheet. Sliders there take touch drags. The sheet scrolls so the focused slider is always above its sticky Save passage bar.
- Save passage saves the departure, starting charge and every leg. Send to crew sends the saved passage. Editing a sent passage and saving it returns it to draft.
- Crew members see sent passages of their own yacht as the same screen without sliders, add, remove or send controls. A draft passage answers 404 to a crew member, as a record they may not see.

Rota:
- The grid is one Tab stop. Arrow keys move the active cell one cell. Shift with an arrow extends a rectangular selection from the anchor. Home and End jump to the first and last slot of the row.
- Space switches the active cell between work and rest. With a selection, Space sets every selected cell to the opposite of the active cell's state.
- Tapping a cell at 375x812 or 768x1024 switches it. Whether an input is a touch is decided from the event's pointer type.
- Choosing a day tab shows that day's slots. A day of 46 or 50 slots shows exactly those slots.
- Save rota sends every crew member's work slots for the whole week with the version that was loaded. On refusal every typed cell stays as typed.
- Leaving the week with unsaved cells opens Discard changes.

Berths and shore power:
- Search berths lists every berth of the marina with its fit and availability.
- Book berth <code> opens the Book berth sheet with each night's fee. Book berth then opens `/w/<ws>/berth-bookings/<booking id>`.
- The Slots board reads from the server when it opens, after each booking and every 10 seconds.

Stores:
- Typing in Search stores updates the list after every keystroke with no submit. When answers arrive out of order, the list always shows the answer for the latest text and drops older ones.
- Load more appends the next page.
- Add item opens `/w/<ws>/yachts/<yacht slug>/stores/<item id>` when it succeeds.
- Logging a movement updates the item's counts in place and shows the saved message. Later list refreshes and searches never clear that message. Only the next movement action or leaving the screen clears it.

Broker page:
- A week's Hold button opens the Hold for a client sheet. Your holds and the week statuses are read from the server when the page opens, after each action and every 10 seconds.

Messages and sessions:
- A status, outage or saved message that an action just showed stays until the user's next action on that screen. Polling, repaints or a refresh of the data never replace it.
- When an action meets an ended session, the screen keeps every typed value, shows the session-ended copy with Sign in again, and after sign-in returns to the same address and puts the values back.
- When an action meets removed access, the screen keeps the typed values and shows the access-removed copy.

### Visual design (DP-58, DP-59)

- **Ground:** a warm off-white like chart paper, with faint thin graticule lines (a light grid as on a nautical chart) behind the content.
- **Colours:**
  - Text is a deep blue-black ink.
  - Links, buttons and focus rings use a muted sea teal.
  - A single warm amber marks only non-text charge and solar data: the ribbon line, solar bars and marks, and the edges of reserve hatching.
  - A brick red marks the reserve: the dashed 20% line, the hatched band and the `Below reserve` words.
  - Every figure and every piece of text, including statuses and the reserve words, stays in an ink colour that passes WCAG 2.2 AA contrast on its ground. Amber is never used for text.
- **Type:**
  - Headings use Newsreader, an editorial serif, set on a wide measure.
  - Body text uses Inter.
  - Every figure, time, amount, distance, speed and percentage uses IBM Plex Mono with tabular numerals, so digits line up in columns and do not shift when they change.
  - Each heading level is about a quarter larger than the one below it.
  - Ship all three fonts with the app.
- **Composition:** serif headings sit above full-width strips of yacht or leg cards separated by hairline rules. Density is comfortable, with generous space around cards and between rows. Every tap target is at least 44 by 44 px.
- **Illustrations:** each yacht is drawn as a simple line drawing of a catamaran in profile, generated from its own length and beam, in ink on the paper ground. No photographs.
- **Charge ribbon:**
  - One continuous line runs across the legs. Its height shows 0% at the bottom to 100% at the top, with a small point at each arrival.
  - A dashed red line marks 20%.
  - Any leg arriving below the reserve has a diagonal hatched band in its card, with amber edges and the words `Below reserve` in ink.
  - From 1024 px the ribbon is drawn directly over the strip so each point sits above its leg.

### Motion and effects (DP-17, DP-56)

Use exactly three durations:

- **180 ms, feedback:** hover and press on controls, and each rolling digit.
- **360 ms, state changes:** reserve bands fading in or out, a strip gliding one card or leg, and sheets, dialogs and the menu opening and closing.
- **720 ms, entrances:** the ribbon easing to a new shape, each page's headings rising into place once when the page first shows, and the loader leaving.

Every motion starts quickly and settles softly. Run all motion as style transitions, style animations or element animations, never frame by frame from script.

Effects and what they mean:
- **Rolling digits:** on a speed change, only the digits of an arrival charge that actually changed roll to the new value. Unchanged digits stay still.
- **Reserve bands:** a band fades in when a leg drops under 20% and fades out when it returns to 20% or more.
- **Ribbon:** eases from the changed leg rightward into its new shape.
- **All three start together:** the digit roll (180 ms), band fade (360 ms) and ribbon ease (720 ms) begin at the same moment as the slider moves.
- **Strips:** glide one card or leg per step.
- **Sheets:** rise from the bottom edge. Dialogs fade and settle.
- **Sun badge:** rocks a few degrees back and forth on a loop, each swing 720 ms.
- **Loader:** a small row of three dots pulsing on a 720 ms loop while a screen's first data loads, then fading out.

These are the only loops. Add no other decorative loop.

Reduced motion (when the device asks for it):
- The sun badge and the loader stop.
- Digits swap without rolling.
- The ribbon and hatched bands appear in their final state at once.
- Strips jump instead of gliding.
- Sheets and dialogs appear and disappear at once.
- Headings show in place at once.
- Slider control, keys, wheel steps, announcements and data attributes work exactly as with motion on.

Decide touch versus mouse from each input event's pointer type, never from what the device reports about hover or pointer precision.

### Feedback states (DP-08, DP-11, DP-18, DP-20, DP-21, DP-26, DP-30, DP-33, DP-40, DP-42, DP-47, DP-51)

Every async action follows the same pattern:

- While pending, its button is disabled and shows the pending label below. Announcements carries the same words.
- The success or refusal copy appears next to the action and in Announcements with the same characters.
- Field errors appear inline (and in Problems outside dialogs).

All copy below renders character for character, with straight apostrophes and exactly the dashes shown (— is an em dash, – is an en dash).

Placeholder sources and formats are in Display formats in Business rules:

- `<time>`: Split time.
- `<base time>`: the time in the record's base.
- `<week date>`: the week's Saturday as a date.
- `<taker>`: the winning member's name, or the broker company's name for a broker hold.
- `<slot taker>`: `<member name> for <yacht name>` of the winning booking.
- A count of 1 takes the singular noun in every copy (`1 day charted`, `try again in 1 second`).

Pending labels: `Signing in`, `Placing hold`, `Releasing hold`, `Recording deposit`, `Creating passage`, `Saving passage`, `Sending to crew`, `Saving rota`, `Booking berth`, `Booking slot`, `Logging movement`, `Adding item`, `Removing item`, `Uploading log`, `Saving manifest`, `Uploading photo`, `Sending page`, `Ending page`, `Closing charter`, `Saving profile`, `Adding tariff`, `Adding exchange table`.

Messages:

| Situation | Copy |
|---|---|
| Sign-in refused | `The email or password isn't right.` |
| Session ended | `Your session has ended. Sign in again — what you typed is kept.` |
| Access removed | `Your access to this workspace was removed. Ask your fleet director if this is a mistake.` |
| Hold placed (live) | `Hold placed for <client name> on <yacht name>, week of <week date>. It lapses <time>.` |
| Joined the line | `<client name> is number <position> in line for <yacht name>, week of <week date>.` |
| Week taken | `Too late — <taker> took this week at <time>.` |
| Week booked | `This week is already booked.` |
| Hold released | `Hold released.` |
| Hold lapsed | `Too late — this hold lapsed at <time>.` |
| Hold no longer live | `This hold is no longer live.` |
| Yacht withdrawn (hold refused) | `This yacht has been withdrawn from charter.` |
| Deposit recorded | `Deposit recorded. Charter invoiced and confirmation sent to <client email>.` |
| Invoicing outage | `Invoicing is unavailable right now — no charter was recorded and no mail was sent. Try again in a few minutes.` |
| Mail outage on deposit | `Mail is unavailable right now — no charter was recorded. Try again in a few minutes.` |
| Charge announcement | `Leg <n> to <anchorage name>: arrives with <charge>%.` or, when below 20%, `Leg <n> to <anchorage name>: arrives with <charge>% — below reserve.` |
| Passage created | `Passage created.` |
| Passage saved | `Passage saved.` |
| Passage sent | `Passage sent to crew.` |
| Send refused, below reserve | `A leg arrives below the 20% reserve — raise its charge before sending.` |
| Send refused, no legs | `Add at least one leg before sending.` |
| Rota saved | `Rota saved.` |
| Rest rule broken | `<crew name> breaks the rest rules: <rule text>, from <base time> to <base time>.` |
| Stale rota | `<member name> saved this rota at <base time>. Your changes are still here — check them and save again.` |
| Berth booked | `Berth <code> booked from <arrival date>.` |
| Berth does not fit | `<yacht name> doesn't fit berth <code>.` |
| Berth taken | `Berth <code> is already booked for one of those nights.` |
| Slot booked | `Shore power booked for <base time>.` |
| Slot taken | `Too late — <slot taker> took this slot at <time>.` |
| Slot past | `That slot has already started.` |
| Slot already yours | `This yacht already has that slot.` |
| Movement logged | `Logged <quantity> <unit> <kind> — <on hand> <unit> on hand.` (`<kind>` is `received`, `used` or `spoiled`) |
| Not enough on hand | `Only <on hand> <unit> on hand — you can't log more than that.` |
| Item added | `<item name> added.` |
| Item exists | `There's already an item called <item name>.` |
| Item removed | `<item name> removed.` |
| Log uploaded | `Log uploaded — <day count> days charted.` |
| Log too large | `That log is larger than 2,000,000 bytes.` |
| Photo saved | `Passport photo saved for <guest name>.` |
| Photo too large | `That photo is larger than 5,000,000 bytes.` |
| Storage outage | `Uploads are unavailable right now — nothing was saved. Try again in a few minutes.` |
| Manifest saved | `Manifest saved.` |
| Guest added | `<guest name> added.` |
| Manifest full | `This yacht takes at most <max guests> guests.` |
| Manifest page sent | `Manifest page sent to <lead guest email>.` |
| Broker page sent | `Broker page sent to <broker email>.` |
| Page ended (staff action) | `Page ended.` |
| Charter closed | `Charter closed. Passport details will be erased <time>.` |
| Charter already closed | `This charter is already closed.` |
| Profile saved | `Profile saved.` |
| Yacht withdrawn | `<yacht name> withdrawn from sale.` |
| Yacht back on sale | `<yacht name> is back on sale.` |
| Tariff added | `Tariff added from <date>.` |
| Exchange table added | `Exchange table added from <date>.` |
| Same effective date exists | `There's already one from that date.` |
| Too many broker holds | `Too many hold requests — try again in <seconds> seconds.` |
| Unexpected server error | `Something went wrong — nothing was changed. Try again.` |

Pages:

| Page | Heading | Body |
|---|---|---|
| Gone (withdrawn yacht) | `This yacht isn't available` | `It's been withdrawn from charter. Browse the fleet for yachts that are sailing.` |
| Ended (manifest or broker page) | `This link has ended` | `Links from Tidewright stop working after a set time or when a new one is sent. Ask your charter contact for a new link.` |
| Not found | `We couldn't find that page` | `Check the address, or sign in to your workspace.` |

Field error messages (each is the 422 value for its field and shows inline):

| Rule | Message |
|---|---|
| Blank required field | `This field is required.` |
| Text longer than its limit | `Use at most <max> characters.` |
| Email | `Enter an email address like name@example.com.` |
| Password shorter than 10 characters | `Use at least 10 characters.` |
| Value not among the listed options | `Choose one of the listed options.` |
| Crew member without a yacht | `Choose a yacht for a crew member.` |
| Date format | `Enter a date as YYYY-MM-DD.` |
| Time format | `Enter a time as HH:MM.` |
| Number outside its range | `Enter a number from <min> to <max>.` |
| More than two decimals in metres | `Use at most two decimals.` |
| Whole number outside its range | `Enter a whole number from <min> to <max>.` |
| Money outside its range | `Enter an amount from <min> to <max>.` (min and max in the money format) |
| Week start | `Choose a Saturday after today.` |
| Saturday required | `Choose a Saturday.` |
| Arrival date | `Choose today or a later date.` |
| Effective date | `Choose a date after today.` |
| Speed | `Choose a speed from 4.0 to 12.0 kn in 0.5 kn steps.` |
| Departure time in the spring-forward gap | `That time doesn't exist here — the clocks go forward an hour.` |
| Too many legs | `Use at most 12 legs.` |
| Leg ending where it starts | `Choose a different anchorage.` |
| Slot start | `Choose a slot that starts on the hour or half hour.` |
| Rota slot | `Use slot start times inside this week.` |
| Passport number | `Enter 5 to 20 capital letters or digits.` |
| Date of birth | `Enter a date of birth in the past.` |
| Photo content | `Choose a JPEG or PNG photo.` |
| Exchange rate | `Enter a rate above 0 with at most six decimals.` |
| Log line | `Line <n> isn't a valid log entry.` |
| Empty log | `The log has no entries.` |
| Cursor | `This cursor isn't valid.` |

## Backend

### API (DP-01, DP-02, DP-03, DP-04, DP-08, DP-10, DP-11, DP-21, DP-26, DP-29, DP-39, DP-43, DP-45, DP-46, DP-52)

Conventions:
- JSON keys are lowerCamelCase. Enum values are lower snake_case.
- Money is integer minor units in fields ending in `Minor`, next to an ISO currency code (`currency`).
- Instants are ISO 8601 UTC with whole seconds and a `Z` (`2027-07-03T15:00:00Z`).
- Base-local dates are `YYYY-MM-DD`.
- Measurements are numbers in metres with at most two decimals.
- Requests with a body send `application/json` (any charset). Uploads send `multipart/form-data`.
- JSON bodies are at most 100,000 bytes.
- Staff endpoints use the session cookie set at sign-in.
- `<ws>` is the workspace slug. Yachts are named by slug. Marinas, anchorages, berths and pontoons are named by their seeded ids and codes.

Error ladder. One ladder covers the whole API. When a request breaks several rules, it gets the first answer that applies:

1. `404 {"error":"not_found"}` for an unknown path. `405 {"error":"method_not_allowed"}` with an `Allow` header listing the path's methods for a wrong method.
2. `429 {"error":"rate_limited","retryAfterSeconds":<n>}` with `Retry-After: <n>` for a rate-limited request.
3. `401 {"error":"unauthenticated"}` with no valid session, `401 {"error":"session_ended"}` when the session's time is up or it was signed out, and `401 {"error":"access_removed"}` when the member was removed.
4. `404 {"error":"not_found"}` for an unknown record named in the path or one the caller may not see (another workspace's record, or a crew member asking about another yacht). `410 {"error":"yacht_withdrawn"}` for a withdrawn yacht where noted. `410 {"error":"page_ended"}` for an ended private page.
5. `403 {"error":"forbidden"}` for a role that may not act.
6. `413 {"error":"too_large","limitBytes":<n>}` for a body or file over its limit.
7. `415 {"error":"unsupported_media_type"}` for a wrong content type.
8. `400 {"error":"invalid_json"}` for a body that does not parse.
9. `404 {"error":"not_found"}` for an unknown or unseen record named inside a parsed body (never 422).
10. `409 {"error":"<code>", ...}` or `412 {"error":"<code>", ...}` state refusals.
11. `422 {"errors":{"<field>":"<message>"}}` field validation, with dotted paths for nested fields (`legs.0.speedKn`, `guests.1.passportNumber`, `rates.highMinor`) and the messages from Feedback states.
12. `503 {"error":"billing_unavailable"}`, `{"error":"storage_unavailable"}` or `{"error":"mail_unavailable"}` for a provider outage.

Every listed path answers 405 with `Allow` for any method it does not list. Endpoint rows below name only their own extra errors.

Session and members:

| Method and path | Body | Success | Extra errors |
|---|---|---|---|
| `POST /api/session` | `{"email":"mira.kovac@adriatic-sunline.example","password":"Sunlit-Tide-2027"}` | `200 {"member":{"id","name","role","workspaceSlug","workspaceName"},"homePath":"/w/<ws>/<home>"}` and an HttpOnly session cookie | `401 {"error":"invalid_credentials"}`, identical for a wrong password and an unknown email |
| `GET /api/session` | | `200` same shape as above | |
| `DELETE /api/session` | | `204` | |
| `GET /api/w/<ws>/members` | | `200 {"members":[{"id","name","email","role","yachtSlug"}]}` (`yachtSlug` null except for crew members) | |
| `POST /api/w/<ws>/members` | `{"name":"Karla Novak","email":"karla.novak@adriatic-sunline.example","password":"Starting-Pass-01","role":"crew_member","yachtSlug":"sunwake"}` | `201 {"member":{...}}` | `409 {"error":"email_in_use"}` when a member of either workspace has that email (sign-in is by email alone); name 1 to 80 characters; role one of `fleet_director`, `charter_manager`, `finance_lead`, `captain`, `crew_member`; `yachtSlug` required for crew members and ignored otherwise |
| `PATCH /api/w/<ws>/members/<member id>` | `{"role":"captain"}` (`yachtSlug` required when the new role is crew member) | `200 {"member":{...}}` | `409 {"error":"cannot_change_self"}` |
| `DELETE /api/w/<ws>/members/<member id>` | | `204` | `409 {"error":"cannot_remove_self"}` |

Only the fleet director may call the member endpoints. Member ids are unique across workspaces.

Health and public:

| Method and path | Success | Extra errors |
|---|---|---|
| `GET /api/health` | `200 {"status":"ok"}`, also while Kill Bill or MinIO is unreachable | |
| `GET /api/public/fleets/<ws>?base=&cabins=&season=&week=&q=` | `200 {"workspace":{"slug","name"},"yachts":[{"slug","name","base","cabins","lengthM","beamM","draftM","rates":{"lowMinor","shoulderMinor","highMinor"},"currency"}]}`, on-sale yachts only, ordered by name | 422 for a bad filter value |
| `GET /api/public/fleets/<ws>/yachts/<yacht slug>` | `200` the same yacht fields plus `"weeks":[{"weekStart","weekEnd","status","season","weeklyRateMinor","currency"}]` | 410 yacht withdrawn |
| `GET /sitemap.xml` | XML listing `/fleet/<ws>` for both workspaces and every on-sale yacht page | |

The public yacht page address `/fleet/<ws>/<yacht slug>` itself answers HTTP 410 with the gone page when the yacht is withdrawn, and 404 with the not-found page when unknown.

Yachts, weeks and holds:

| Method and path | Body | Success | Extra errors |
|---|---|---|---|
| `GET /api/w/<ws>/yachts` | | `200 {"yachts":[profile]}` | |
| `GET /api/w/<ws>/yachts/<yacht slug>` | | `200 {"yacht":profile}`, where profile is `{"slug","name","base","status","cabins","lengthM","beamM","draftM","batteryKwh","hotelKw","solarKw","dragKwPerKnCubed","shorePowerKw","rates":{"lowMinor","shoulderMinor","highMinor"},"currency":"EUR","crew":[{"id","name","position"}]}` | |
| `PATCH /api/w/<ws>/yachts/<yacht slug>` | `{"name":"Sunwake","cabins":4,"lengthM":18.29,"beamM":9.04,"draftM":1.55,"rates":{"lowMinor":1890000,"shoulderMinor":2450000,"highMinor":3290000}}` (any subset) | `200 {"yacht":profile}` | name 1 to 80 characters; cabins whole 2 to 6; lengthM 8.00 to 40.00; beamM 3.00 to 15.00; draftM 0.50 to 3.00; each rate whole 100000 to 100000000 |
| `POST /api/w/<ws>/yachts/<yacht slug>/withdraw` | | `200 {"yacht":profile}` | `409 {"error":"already_withdrawn"}` |
| `POST /api/w/<ws>/yachts/<yacht slug>/return-to-sale` | | `200 {"yacht":profile}` | `409 {"error":"already_on_sale"}` |
| `GET /api/w/<ws>/yachts/<yacht slug>/weeks` | | `200 {"weeks":[{"weekStart","weekEnd","status","season","weeklyRateMinor","currency","liveHoldId","waitingCount"}]}` | |
| `GET /api/w/<ws>/holds?yachtSlug=&weekStart=` | | `200 {"holds":[hold]}`, where hold is `{"id","yachtSlug","weekStart","weekEnd","clientName","placedBy":{"kind","name"},"status","position","placedAt","liveSince","lapsesAt","charterId"}` | |
| `POST /api/w/<ws>/holds` | `{"yachtSlug":"sunwake","weekStart":"2027-07-03","clientName":"Harriet Lowe","queue":false}` | `201 {"hold":hold}` | 410 yacht withdrawn; `409 {"error":"week_taken","takenBy":"<taker>","takenAt":"<instant>"}`; `409 {"error":"week_booked"}`; clientName 1 to 80 characters; weekStart must be a Saturday after Split today |
| `GET /api/w/<ws>/holds/<hold id>` | | `200 {"hold":hold}` | |
| `POST /api/w/<ws>/holds/<hold id>/release` | | `200 {"hold":hold}` | `409 {"error":"hold_lapsed","lapsedAt":"<instant>"}`; `409 {"error":"hold_not_live","status":"<status>"}` |
| `GET /api/w/<ws>/holds/<hold id>/quote?currency=GBP` | | `200 {"quote":{"currency","exchangeTableId","rate","lines":[line],"totalEurMinor","totalMinor"}}` | 422 currency |
| `POST /api/w/<ws>/holds/<hold id>/deposit` | `{"clientEmail":"harriet.lowe@example.com","currency":"GBP"}` | `201 {"charter":charter}` | `409 hold_lapsed`; `409 hold_not_live` (also for the second click); 503 `billing_unavailable` or `mail_unavailable` |

In a hold, `placedBy.kind` is `member` or `broker`, and `placedBy.name` is the member's name or the broker company's name. `status` is `waiting`, `live`, `lapsed`, `released` or `charter`. `position` is a whole number for waiting holds and null otherwise. `lapsesAt` and `liveSince` are null for waiting holds.

In a week, `status` is `free`, `held` or `booked`, and `season` is `low`, `shoulder` or `high`.

Charters, manifest and close:

| Method and path | Body | Success | Extra errors |
|---|---|---|---|
| `GET /api/w/<ws>/charters` | | `200 {"charters":[charter]}` | |
| `POST /api/w/<ws>/charters` (recorded directly, without invoicing or mail) | `{"yachtSlug":"halcyon-drift","weekStart":"2027-08-07","clientName":"Owen Marsh","clientEmail":"owen.marsh@example.com","currency":"EUR"}` | `201 {"charter":charter}` with `invoiceStatus` `not_invoiced` | 410 yacht withdrawn; `409 week_taken`; `409 week_booked`; weekStart must be a Saturday (any date) |
| `GET /api/w/<ws>/charters/<charter id>` | | `200 {"charter":charter}` | |
| `POST /api/w/<ws>/charters/<charter id>/close` | | `200 {"charter":charter}` | `409 {"error":"charter_closed"}` |
| `GET /api/w/<ws>/charters/<charter id>/manifest` | | `200 {"page":{"status","issuedAt","endsAt","path"},"guests":[guest]}`; see Passport data in Business rules for the guest fields each role gets | |
| `POST /api/w/<ws>/charters/<charter id>/manifest-page` | `{"leadGuestName":"Harriet Lowe","leadGuestEmail":"harriet.lowe@example.com"}` | `201 {"page":{"status":"live","issuedAt","endsAt","path":"/m/<token>"}}` | `409 charter_closed` |
| `POST /api/w/<ws>/charters/<charter id>/manifest-page/end` | | `200 {"page":{"status":"ended",...}}` | `409 {"error":"page_not_live"}` |
| `GET /api/w/<ws>/charters/<charter id>/manifest/guests/<guest id>/photo` | | `200` the stored image with its image content type | 404 when there is no photo |

A charter is `{"id","holdId","yachtSlug","weekStart","weekEnd","clientName","clientEmail","currency","season","depositDate","exchangeTableId","rate","lines":[line],"totalEurMinor","totalMinor","invoiceStatus","killbillInvoiceId","invoicedAt","status","closedAt","erasesAt"}`:

- `line` is `{"kind","label","eurMinor","amountMinor"}`, with `kind` one of `charter_fee`, `provisioning_allowance` or `vat`.
- `invoiceStatus` is `invoiced` or `not_invoiced`.
- `status` is `open` or `closed`.
- `rate` is the EUR-to-client-currency rate as a decimal string (`"1"` for EUR).
- `holdId`, `depositDate`, `killbillInvoiceId`, `invoicedAt`, `closedAt` and `erasesAt` are null when they do not apply.

The manifest page `status` is `live`, `ended` or `none`. Its `path` is given only to the charter manager and the fleet director.

Manifest page (no session, the token is the access):

| Method and path | Body | Success | Extra errors |
|---|---|---|---|
| `GET /api/manifest/<token>` | | `200 {"yachtName","weekStart","weekEnd","maxGuests","status":"live","endsAt","guests":[{"id","fullName","nationality","passportOnFile","dateOfBirthOnFile","photoOnFile"}]}` | 404 unknown token; 410 page ended |
| `POST /api/manifest/<token>/guests` | `{"fullName":"Harriet Lowe"}` | `201 {"guest":{...}}` | `409 {"error":"manifest_full","maxGuests":<n>}`; fullName 1 to 80 characters |
| `PUT /api/manifest/<token>/guests` | `{"guests":[{"id":"<guest id>","fullName":"Harriet Lowe","nationality":"GB","dateOfBirth":"1984-05-12","passportNumber":"533817402"}]}` | `200 {"guests":[...]}` | 404 for a guest id not on this manifest; nationality an ISO 3166 two-letter code; passportNumber 5 to 20 capital letters or digits; dateOfBirth before Split today and no more than 120 years ago |
| `DELETE /api/manifest/<token>/guests/<guest id>` | | `204` | |
| `POST /api/manifest/<token>/guests/<guest id>/photo` | multipart field `photo` | `201 {"guest":{...}}` | 413 when the file is over 5,000,000 bytes; 422 `photo` when the content is not a JPEG or PNG; 503 `storage_unavailable` |

In the manifest PUT, a blank or missing `dateOfBirth` or `passportNumber` keeps the value already on file, and is required only when none is on file.

Brokers and broker page:

| Method and path | Body | Success | Extra errors |
|---|---|---|---|
| `GET /api/w/<ws>/brokers` | | `200 {"brokers":[{"id","name","contactName","email","notes","page":{"status","issuedAt","endsAt"}}]}` | |
| `POST /api/w/<ws>/brokers/<broker id>/page` | `{}` | `201 {"page":{"status":"live","issuedAt","endsAt","path":"/b/<token>"}}` | |
| `POST /api/w/<ws>/brokers/<broker id>/page/end` | | `200 {"page":{"status":"ended",...}}` | `409 page_not_live` |
| `GET /api/broker/<token>` | | `200`, the broker fields listed in Business rules | 404 unknown token; 410 ended |
| `POST /api/broker/<token>/holds` | `{"yachtSlug":"sunwake","weekStart":"2027-07-10","clientName":"Theo Brandt","queue":false}` | `201 {"hold":{"id","yachtSlug","weekStart","clientName","status","position","lapsesAt"}}` | 429 as in Business rules; 410 yacht withdrawn; `409 week_taken`; `409 week_booked` |
| `POST /api/broker/<token>/holds/<hold id>/release` | | `200 {"hold":{...}}` | 404 for a hold this broker did not place; `409 hold_lapsed`; `409 hold_not_live` |

Passages and anchorages:

| Method and path | Body | Success | Extra errors |
|---|---|---|---|
| `GET /api/w/<ws>/anchorages` | | `200 {"anchorages":[{"id","name","base","latitude","longitude"}]}` in seed order | |
| `GET /api/w/<ws>/passages?yachtSlug=` | | `200 {"passages":[passage]}` | |
| `POST /api/w/<ws>/passages` | `{"yachtSlug":"sunwake","name":"Hvar and Vis loop","startAnchorageId":"split-base","departureDate":"2027-07-03","departureTime":"09:00","startChargePct":100,"legs":[{"toAnchorageId":"hvar-stari-grad","speedKn":6.0},{"toAnchorageId":"vis-town","speedKn":7.5}]}` | `201 {"passage":passage}` | name 1 to 80 characters; startChargePct whole 0 to 100; at most 12 legs; speedKn 4.0 to 12.0 in 0.5 steps; a leg may not end where it starts; departureTime refused inside the spring-forward gap |
| `GET /api/w/<ws>/passages/<passage id>` | | `200 {"passage":passage}` | |
| `PUT /api/w/<ws>/passages/<passage id>` | the create body without `yachtSlug` | `200 {"passage":passage}` with status `draft` | |
| `POST /api/w/<ws>/passages/<passage id>/send` | | `200 {"passage":passage}` with status `sent` | `409 {"error":"below_reserve","legIndex":<n>}`; `409 {"error":"no_legs"}` |

A passage is `{"id","yachtSlug","name","status","base","startAnchorageId","departureDate","departureTime","departsAt","startChargePct","legs":[{"index","fromAnchorageId","toAnchorageId","speedKn","distanceNm","departsAt","arrivesAt","arrivalBase","arrivalChargePct","reserve"}],"minChargePct","updatedAt"}`:

- `status` is `draft` or `sent`.
- `distanceNm` is rounded half up to two decimals.
- `reserve` is `ok` or `below_reserve`.
- `minChargePct` is null when there are no legs.

Rota:

| Method and path | Body | Success | Extra errors |
|---|---|---|---|
| `GET /api/w/<ws>/yachts/<yacht slug>/rota?weekStart=2027-03-27` | | `200 rota` | 422 when weekStart is not a Saturday |
| `PUT /api/w/<ws>/yachts/<yacht slug>/rota?weekStart=2027-03-27` | `{"version":0,"work":{"<crew id>":["2027-03-27T05:00:00Z","2027-03-27T05:30:00Z"]}}` | `200 rota` with version one higher | `412 {"error":"stale_rota","savedBy":"<member name>","savedAt":"<instant>"}`; `422 {"error":"rest_rule","crewId","crewName","rule","windowStart","windowEnd"}`; 422 `work` for a slot start outside the week; 404 for a crew id not on this yacht |

A rota is `{"yachtSlug","weekStart","base","version","savedBy","savedAt","crew":[{"id","name","position"}],"slots":[{"startsAt","date","label"}],"work":{"<crew id>":["<slot start>"]}}`:

- `version` is 0 and `savedBy` and `savedAt` are null for a week never saved.
- `label` is `HH:MM` or `HH:MM (repeat)`.
- Slots not listed in `work` are rest.
- `rule` is one of `min_rest_24h`, `min_rest_168h`, `rest_periods_24h` or `max_gap_14h`.

Berths, tariffs, exchange tables and shore power:

| Method and path | Body | Success | Extra errors |
|---|---|---|---|
| `GET /api/w/<ws>/marinas` | | `200 {"marinas":[{"id","name","base","today","berths":[{"code","lengthM","widthM","depthM"}],"pontoons":[{"code","limitKw"}],"tariffs":[{"id","effectiveDate","ratePerMetreMinor","currency"}]}]}` (`today` is the marina's local date) | |
| `GET /api/w/<ws>/marinas/<marina id>/berths?yachtSlug=sunwake&arrivalDate=2027-07-10&nights=3` | | `200 {"berths":[{"code","lengthM","widthM","depthM","fits","available","nights":[{"date","tariffId","ratePerMetreMinor","feeMinor"}],"totalMinor","currency"}]}` | 422 dates and nights |
| `POST /api/w/<ws>/berth-bookings` | `{"yachtSlug":"sunwake","marinaId":"split-marina","berthCode":"A4","arrivalDate":"2027-07-10","nights":3}` | `201 {"booking":{"id","yachtSlug","marinaId","berthCode","arrivalDate","departureDate","nights":[...],"totalMinor","currency","bookedBy","bookedAt"}}` | `409 {"error":"does_not_fit"}`; `409 {"error":"berth_taken"}`; nights whole 1 to 14; arrivalDate on or after the marina's local today |
| `GET /api/w/<ws>/berth-bookings/<booking id>` | | `200 {"booking":{...}}` | |
| `POST /api/w/<ws>/marinas/<marina id>/tariffs` | `{"effectiveDate":"2028-05-01","ratePerMetreMinor":560}` | `201 {"tariff":{...}}` | `409 {"error":"date_exists"}`; effectiveDate after the marina's local today; rate whole 1 to 100000 |
| `GET /api/w/<ws>/exchange-tables` | | `200 {"exchangeTables":[{"id","effectiveDate","rates":{"GBP","USD"}}]}` | |
| `POST /api/w/<ws>/exchange-tables` | `{"effectiveDate":"2028-05-01","rates":{"GBP":"0.8812","USD":"1.1630"}}` | `201 {"exchangeTable":{...}}` | `409 date_exists`; effectiveDate after Split today; each rate a decimal string above 0 with at most six decimals |
| `GET /api/w/<ws>/marinas/<marina id>/pontoons/<code>/slots?date=2027-07-10` | | `200 {"date","base","limitKw","slots":[{"startsAt","endsAt","status","bookedKw","bookings":[{"yachtSlug","yachtName"}]}]}` (`status` is `open`, `full` or `past`) | |
| `POST /api/w/<ws>/shore-power-bookings` | `{"yachtSlug":"sunwake","marinaId":"split-marina","pontoonCode":"D","slotStart":"2027-07-10T16:00:00Z"}` | `201 {"booking":{"id","yachtSlug","marinaId","pontoonCode","slotStart","slotEnd","kw","bookedBy","bookedAt"}}` | `409 {"error":"slot_taken","takenBy":"<slot taker>","takenAt":"<instant>"}`; `409 {"error":"slot_past"}`; `409 {"error":"already_booked"}`; 422 slot boundary |

Stores:

| Method and path | Body | Success | Extra errors |
|---|---|---|---|
| `GET /api/w/<ws>/yachts/<yacht slug>/stores?q=&limit=&cursor=` | | `200 {"items":[item],"nextCursor":"<opaque>"}` (`nextCursor` null on the last page) | 422 `cursor` |
| `POST /api/w/<ws>/yachts/<yacht slug>/stores` | `{"name":"Sparkling water","unit":"bottles","category":"drinks"}` | `201 {"item":item}` | `409 {"error":"item_exists"}`; name 1 to 60 characters; unit 1 to 20 characters; category one of `provisions`, `drinks`, `cleaning`, `engine_room`, `safety` |
| `GET /api/w/<ws>/yachts/<yacht slug>/stores/<item id>` | | `200 {"item":item}` | |
| `DELETE /api/w/<ws>/yachts/<yacht slug>/stores/<item id>` | | `204` | |
| `POST /api/w/<ws>/yachts/<yacht slug>/stores/<item id>/movements` | `{"kind":"used","quantity":6}` | `201 {"movement":{"id","kind","quantity","loggedBy","loggedAt"},"item":item}` | `409 {"error":"insufficient_stock","onHandQty":<n>}`; kind one of `received`, `used`, `spoiled`; quantity whole 1 to 100000 |

An item is `{"id","name","unit","category","receivedQty","usedQty","spoiledQty","onHandQty"}`. `limit` is 1 to 50 (default 50). A larger value is treated as 50. `q` is at most 60 characters.

Energy:

| Method and path | Body | Success | Extra errors |
|---|---|---|---|
| `POST /api/w/<ws>/yachts/<yacht slug>/energy-logs` | multipart field `log` | `201 {"log":{"id","fileName","sizeBytes","uploadedAt","uploadedBy","objectKey","dayCount"}}` | 413 when the file is over 2,000,000 bytes; 415 when the request is not `multipart/form-data`; 422 `log`; 503 `storage_unavailable` |
| `GET /api/w/<ws>/yachts/<yacht slug>/energy-logs` | | `200 {"logs":[...]}` | |
| `GET /api/w/<ws>/yachts/<yacht slug>/energy-days` | | `200 {"base","days":[{"date","startChargePct","endChargePct","lowestChargePct","solarKwh"}]}` | |

Text lengths count Unicode code points, so an emoji counts as 1.

The file limits count the uploaded file's bytes alone. Around the file, the multipart request may add up to 100,000 bytes (the envelope allowance), so the whole request may be up to the file limit plus 100,000 bytes. A file within its limit is accepted whenever the request stays within that allowance. A request larger than the file limit plus 100,000 bytes answers 413 whatever the file's own size.

A file of exactly the limit is accepted, and so is a request of exactly the file limit plus 100,000 bytes.

### Business rules (DP-10, DP-11, DP-12, DP-14, DP-16, DP-20, DP-21, DP-24, DP-25, DP-26, DP-28, DP-29, DP-31, DP-33, DP-35, DP-36, DP-42, DP-43, DP-45, DP-46, DP-47, DP-49)

**Roles.** The fleet director may do every staff action. Other roles may do only these:

| Action | Charter manager | Finance lead | Captain | Crew member |
|---|---|---|---|---|
| Read yachts, weeks | yes | yes | yes | own yacht only |
| Read, place and release holds; quotes; deposits; direct charters | yes | read holds and quotes only | no | no |
| Read charters | yes | yes | yes | no |
| Send and end manifest pages | yes | no | no | no |
| Close a charter | no | no | yes | no |
| Read and issue or end broker pages | yes | no | no | no |
| Add tariffs and exchange tables | no | yes | no | no |
| Read marinas, tariffs, exchange tables | yes | yes | yes | no |
| Passages (create, edit, send) | no | no | yes | read sent passages of own yacht |
| Rota | no | no | read and save | read own yacht |
| Berth and shore-power bookings | no | no | yes | no |
| Stores (list, add, remove, movements) | no | no | yes | own yacht only |
| Energy logs | no | no | yes | no |
| Yacht profile, withdraw, return to sale | no | no | no | no |
| Member endpoints | no | no | no | no |

A role without an action gets 403. A crew member asking about another yacht gets 404, as does any member asking about another workspace. Navigation shows only permitted screens.

**Sessions.** A session ends SESSION_SECONDS after sign-in, judged by the server. Signing out ends it at once. Removing a member ends all their sessions, and their next request answers `access_removed`. A role change applies from the member's next request.

**Business time.**
- Split (Europe/Zagreb) decides today, charter weeks, deposit dates, hold lapse times shown to staff and brokers, and exchange-table dates, whatever the browser's zone.
- Lavrio (Europe/Athens, one hour ahead of Split all year) decides Lavrio yachts' rota slots, departures and berth and shore-power local dates.
- Times appear in the base named in their format.

**Charter weeks.**
- A week runs from Saturday to the next Saturday on the Split calendar. `weekStart` is its first Saturday and `weekEnd` the following Saturday.
- The availability window is the 26 weeks whose Saturdays come after Split today, starting with the first.
- A week's season comes from its start date's month: July and August are `high`; May, June and September are `shoulder`; every other month is `low`.

**Holds.**
- A hold is `waiting`, `live`, `lapsed`, `released` or `charter`.
- A week is `booked` when it has a charter, `held` when it has a live or waiting hold, and `free` otherwise.
- Placing a hold:
  - On a free week, it becomes `live`.
  - With `queue` off on a held week, it is refused with `409 week_taken`. `takenBy` is the live hold's `<taker>` and `takenAt` is its `liveSince`.
  - With `queue` on, a held week gives a `waiting` hold at the end of the line and a free week gives a live one.
  - A booked week is refused with `409 week_booked`.
  - When requests for the same free week arrive together, the database decides exactly one live winner. Every other request with queue off gets `week_taken` naming the winner.
- A live hold lapses exactly HOLD_SECONDS after it became live (`lapsesAt` = `liveSince` + HOLD_SECONDS). From that instant on, including the instant itself, the server reports it `lapsed`, and a release or deposit on it answers `409 hold_lapsed`.
- When a live hold lapses or is released, the waiting hold with the lowest position becomes live, with `liveSince` the moment it moved up. The remaining positions close up. For a lapse this happens on the server's timed sweep, which runs at least every 10 seconds, so within 10 seconds of the lapse instant.
- Legal moves: waiting → live (moved up), waiting → released, live → lapsed, live → released, live → charter (deposit).
- Any other action on a hold answers `409 hold_not_live` with the current status.

**Charter pricing.**
1. The charter fee is the yacht's weekly rate for the week's season, in EUR.
2. The provisioning allowance is 30% of the charter fee.
3. VAT is the base country's charter rate on the charter fee only: Croatia 13% for Split yachts, Greece 12% for Lavrio yachts. The allowance carries no VAT.
4. Each line is rounded half up to the euro cent on its own.
5. Each line is then converted to the client's currency on its own: the EUR amount times the rate of the exchange table in force on the deposit's Split date (for a direct charter, Split today), in exact decimal arithmetic, rounded half up to the minor unit. EUR uses rate 1. This conversion is the one published rounding.
6. Totals are the sums of the lines.
7. A charter's lines, rate and table are stored when it is priced and never recomputed. The charter page, the Kill Bill invoice and the mail all show the stored amounts.

For example, with the seed data and a deposit dated before 1 Apr 2028: Sunwake's high-season week charged in GBP has lines of EUR 32,900.00, EUR 9,870.00 and EUR 4,277.00. These become GBP 27,800.50, GBP 8,340.15 and GBP 3,614.07 (3,614.065 rounded half up), for a total of GBP 39,754.72.

**Deposit atomicity.** Recording a deposit on a live hold does all of the following or none of them:
- creates the charter;
- creates one Kill Bill invoice in the client's currency with one item per line;
- marks the charter `invoiced` with the invoice id Kill Bill returned;
- sends one mail to the client;
- turns the hold into `charter`.

If Kill Bill does not return the invoice, nothing is recorded and the answer is `503 billing_unavailable`. If the mail cannot be handed to the mail server, the invoice is voided in Kill Bill, nothing is recorded and the answer is `503 mail_unavailable`.

The hold is locked for the whole action. A second deposit on the same hold, such as a double click, answers `409 hold_not_live` and creates nothing. A charter shows `Invoiced` only once a Kill Bill invoice id is stored. A directly recorded charter stays `not_invoiced`.

**Exchange tables.** A table applies from 00:00 Split time on its effective date until the next table's date. New tables must start after Split today. Two tables in one workspace may not share a date (`409 date_exists`).

**Passage energy rule.**
- A leg's distance is the great-circle (haversine) distance between its two anchorages' coordinates on a sphere of radius 3440.065 nautical miles. It is used at full precision; the API rounds it half up to two decimals, and screens round the full-precision value half up to one decimal.
- Hours underway = distance ÷ speed.
- Net draw in kW = `dragKwPerKnCubed` × speed³ + `hotelKw` − `solarKw`. The solar yield is credited for every hour underway, and the net draw may be negative.
- Charge starts at `startChargePct` of `batteryKwh`.
- After each leg, charge = charge before − net draw × hours, kept between 0 and `batteryKwh`, and carried at full precision into the next leg.
- `arrivalChargePct` is the arrival charge as a percentage of `batteryKwh`, first rounded to six decimals, then rounded down to a whole percent.
- A leg is `below_reserve` when its arrival charge is under 20, and `ok` at 20 or more.
- `minChargePct` is the lowest arrival charge.
- Leg 1 departs at the departure instant. Each arrival instant is rounded to the nearest whole second, and the next leg departs at the previous arrival.
- A passage can be sent only when it has at least one leg and no leg is below reserve. Saving a sent passage returns it to draft.

**Departure local times.**
- A departure is a local date and time in the yacht's base zone.
- A time inside the spring-forward gap is refused on `departureTime`. In 2027 the gap is Sun 28 Mar 2027 02:00 to 02:59 in Split and 03:00 to 03:59 in Lavrio.
- A time that repeats in autumn means its first occurrence, the one before the clocks go back (Sun 31 Oct 2027 02:00 to 02:59 in Split, 03:00 to 03:59 in Lavrio).
- Each arrival shows in its arrival anchorage's base time.

**Rota and rest rules.**
- A rota week runs from Saturday 00:00 to the next Saturday 00:00 in the yacht's base time, split into half-hour slots as they really occur (a day has 46, 48 or 50 slots). Each slot is work or rest.
- Rules are checked on rolling windows of real elapsed time. A window starts at every slot start of the week, 24 hours or 168 hours long. Time outside the week counts as rest. The rules, in this order:
  1. `max_gap_14h`: no run of work longer than 14 hours. Its window is that work run. Rule text: `no more than 14 hours between rest periods`.
  2. `min_rest_24h`: at least 10 hours of rest in every 24-hour window. Rule text: `at least 10 hours of rest in any 24 hours`.
  3. `min_rest_168h`: at least 77 hours of rest in every 168-hour window. Rule text: `at least 77 hours of rest in any 7 days`.
  4. `rest_periods_24h`: in every 24-hour window, rest falls into at most two separate runs, and one of them is at least 6 hours long. A run cut by the window's edge counts only its part inside. Rule text: `rest in no more than two periods, one of at least 6 hours`.
- A save is checked crew member by crew member in the rota's crew order. The first crew member breaking any rule is reported, with the first rule broken in the order above and the earliest window that breaks it (`windowStart` inclusive, `windowEnd` exclusive).
- Each save carries the version it was based on. When the stored version is newer, the save answers `412 stale_rota` with the last saver's name and time, ahead of any rest-rule check.

**Berths.**
- A berth fits when yacht length ≤ berth length, yacht beam ≤ berth width, and yacht draft + 0.30 m ≤ berth depth, with equal values fitting. Compare in whole centimetres, never in binary fractions: 1.55 m + 0.30 m fits a 1.85 m depth.
- A berth is available when no booking on it shares a night.
- Nights are local dates at the marina from the arrival date, one per night.
- Each night's fee is the tariff in force on that night's local date times the yacht's length in metres, rounded half up to the cent. A tariff applies from 00:00 local time on its effective date, so a stay across that date mixes both prices.
- Fees are stored with the booking and never change when tariffs are added.
- New tariffs must start after the marina's local today. Two tariffs at one marina may not share a date.

For example, with the seed data and a night before 1 Apr 2028, Sunwake at Split Marina pays EUR 82.31 a night (18.29 × 450 = 8,230.5 cents, rounded half up).

**Shore power.**
- Slots are 30-minute local periods on a pontoon, starting on the local hour or half hour.
- Each booking draws the yacht's `shorePowerKw`.
- A slot is `past` from its start instant on. It is `full` when its remaining kilowatts (limit minus booked) are below 22. Otherwise it is `open`. Status is judged by the server at each request.
- A booking that would exceed the limit answers `409 slot_taken` with the latest booking's `<slot taker>` and time. Of simultaneous claims on the last capacity, exactly one wins.
- Booking a past slot answers `409 slot_past`. The same yacht may hold a slot once.

**Stores.**
- An item's on-hand count is always received minus used minus spoiled, recomputed from its movements' totals in the same transaction as each movement. It never goes below zero.
- A `used` or `spoiled` movement larger than the on-hand count answers `409 insufficient_stock`. Movements on one item are applied one at a time, so movements arriving together never take it negative.
- Removing an item removes its movements.
- Item names are unique per yacht, ignoring case.
- The list is ordered by name ignoring case, then by id. The cursor marks the last item returned, so the next page starts strictly after it. Items added or removed meanwhile never cause a repeat or a skip of items that existed throughout.
- `q` matches any part of the name, ignoring case.

**Private pages.**
- A manifest page or broker page is `live` until it ends, then `ended`, judged by the server at each request. It ends at its end instant (the instant itself is already ended), at once when a manager ends it, and at once when a new page is issued for the same charter or broker.
- A manifest page also ends at once when its charter closes.
- Manifest pages last MANIFEST_PAGE_SECONDS. Broker pages last BROKER_PAGE_SECONDS.
- Tokens are random, at least 128 bits, and unguessable. An ended page answers 410 on its address and its API.
- Staff screens show page status as the server reports it.

**Broker page fields.**
- The broker API returns exactly these keys:
  - `broker`: `{"name"}`, the broker company name.
  - `company`: `{"name"}`, the workspace name.
  - `status`, `endsAt`.
  - `yachts`: `[{"slug","name","base","cabins","lengthM","weeks":[{"weekStart","weekEnd","status","weeklyRateMinor","currency"}]}]`, the on-sale yachts and their availability window.
  - `holds`: `[{"id","yachtSlug","weekStart","clientName","status","position","lapsesAt"}]`, the holds placed through this broker's pages only.
- `takenBy` in a broker's `week_taken` refusal is the `<taker>`.
- Nothing else ever reaches a broker: no other broker's clients, crew, passport data, internal notes, staff names beyond `<taker>`, or staff email addresses, in the page, its API or its mail.

**Broker rate limit.**
- Each broker page token may make at most 5 hold placements (`POST .../holds`) within any BROKER_RATE_WINDOW_SECONDS. Every request counts whatever its outcome, including ones to an unknown or ended token.
- The sixth answers 429. `Retry-After` is the whole number of seconds, rounded up, until the oldest counted request leaves the window.
- This check comes before the token, page state or body is checked.

**Guests.** A manifest takes at most twice the yacht's cabins in guests.

**Passport data.**
- Passport numbers, dates of birth and photos are returned only to the captain and the fleet director, on the staff manifest endpoint and the photo endpoint.
- The charter manager gets only guest `id` and `fullName`. Finance leads and crew members get 403.
- The manifest page answers with `passportOnFile`, `dateOfBirthOnFile` and `photoOnFile` flags only.
- No mail, broker page or log line carries these values.

**Erasure.**
- Closing a charter records `closedAt` and sets `erasesAt` = `closedAt` + MANIFEST_RETENTION_SECONDS.
- Within 10 seconds after `erasesAt`, the server removes every guest's passport number, date of birth and nationality, and deletes their photo objects from MinIO. Only `fullName` remains, everywhere. Unsent mail never holds these values, because no mail ever includes them.

**Withdrawal.**
- A yacht is `on_sale` or `withdrawn`. Withdrawing an on-sale yacht and returning a withdrawn one are the only moves. The reverse of each answers 409 (`already_withdrawn`, `already_on_sale`).
- While withdrawn, its public addresses and APIs answer 410. Placing a hold or a direct charter on it answers 410.
- It is left out of public fleet lists, search, the sitemap and broker pages. Staff still read it, and the fleet director can return it to sale.

**Display formats.** These are used on every screen and in every mail.

- **Times:**
  - `<time>` is `Sat 3 Jul 2027, 17:00 Split time`: weekday, day, month abbreviation, year, 24-hour time and the base's name.
  - `<base time>` uses the record's base, for example `Sat 3 Jul 2027, 18:00 Lavrio time`.
  - Dates alone, including `<week date>`, are `Sat 3 Jul 2027`.
  - Times show the minute, rounded down.
- **Money:** the currency code, a space, then the amount with comma thousands and two decimals (`EUR 12,450.00`).
- **Measurements:**
  - Metres to one decimal, rounded half up on the stored decimal value, then a space, an en dash, a space, then feet and inches.
  - Feet and inches come from the stored metres ÷ 0.0254, rounded to the nearest whole inch. Every 12 inches carry into a foot, and both parts are always shown.
  - Examples: `24.4 m – 80 ft 1 in`; 3.65 m shows `3.7 m – 12 ft 0 in`.
- **Distances, speeds and charge:** `12.3 nm` and `6.5 kn`, always with one decimal (`6.0 kn`), and `34%`.
- **Energy:** daily charge figures show rounded down to whole percents, and solar yield to one decimal in kWh.

**Energy log.**
- A daily log is UTF-8 text with one JSON object per line: `at` (an instant in the API's format, such as `2027-07-03T15:00:00Z`), `chargePct` (a number from 0 to 100), `solarWh` (a whole number, 0 or more) and `packKw` (a number). Other keys are allowed and ignored by the working copy. Blank lines are skipped.
- Any other line is refused as `Line <n> isn't a valid log entry.`, numbering lines from 1.
- Days are the yacht's base-local dates of `at`. For each day:
  - `startChargePct` is the charge on the earliest line;
  - `endChargePct` is the charge on the latest line;
  - `lowestChargePct` is the lowest charge;
  - `solarKwh` is the sum of `solarWh` ÷ 1000.
- When two logs cover the same day, the later upload's lines decide that day.

### Services (DP-29, DP-30, DP-34, DP-36, DP-38, DP-40, DP-44, DP-45)

- **Postgres** (`DATABASE_URL`) holds every record:
  - workspaces, members and sessions;
  - yachts, weeks and holds, charters and their lines;
  - passages and legs, rota cells and versions;
  - marinas, berths, pontoons and tariffs, exchange tables, berth and shore-power bookings;
  - store items and movements;
  - energy log working copies;
  - private page tokens;
  - the guest manifest.

  It decides every live, lapsed, charter, ended, open, full and past status and every concurrency winner. Apply the schema idempotently each time the app starts. On an empty database, insert the seed data once.
- **MinIO** (`S3_*`):
  - Create the bucket `S3_BUCKET` when it is missing.
  - Each passport photo is stored at `passport-photos/<charter id>/<guest id>.jpg` or `.png`, in its uploaded format, re-encoded with the camera orientation applied to the pixels (width and height swap for sideways orientations), no orientation tag other than upright, and no location or other camera metadata.
  - Each daily log is stored at `energy-logs/<yacht slug>/<log id>.jsonl`, byte for byte as uploaded and never rewritten. Its parsed working copy lives apart from it, in the database or under a different key.
  - When MinIO cannot be reached, an upload answers `503 storage_unavailable`, leaves no record and no object, and shows the storage outage copy.
  - Every upload tries MinIO afresh, so service returns without a restart.
- **Kill Bill** (`KILLBILL_*`, using the tenant API key and secret on every call, with created-by `tidewright`):
  - For each recorded deposit, create an account with external key `tidewright-<charter id>`, the client's name and email, and the client's currency.
  - Then create one committed invoice on that account with three external charges in the client's currency, amounts in major units:
    - `Charter fee — <yacht name>, week of <weekStart>`
    - `Provisioning allowance (30%)`
    - `VAT <rate>% on charter fee`
  - Store the returned invoice id on the charter.
  - When Kill Bill cannot be reached or does not return the invoice, the deposit answers `503 billing_unavailable`, records nothing and sends nothing, and shows the invoicing outage copy. Every deposit tries Kill Bill afresh.
- **Mailpit** (SMTP at `SMTP_HOST`:`SMTP_PORT`). Every mail is plain text from `MAIL_FROM`. Links are `APP_PUBLIC_URL` followed by the page's path. No mail contains passport numbers, dates of birth, nationalities, other brokers' clients, internal notes or staff email addresses.

  | Mail | To | Subject | Body |
  |---|---|---|---|
  | Deposit confirmation | the client email | `Charter confirmed: <yacht name>, week of <week date>` | The client's name, the yacht, week start and end dates, each line and the total in the client's currency in the money format, and the Kill Bill invoice id |
  | Manifest page | the lead guest email | `Guest manifest for <yacht name>, week of <week date>` | The link `<APP_PUBLIC_URL>/m/<token>` and `This link works until <time>.` |
  | Broker page | the broker's email | `Your <workspace name> broker page` | The link `<APP_PUBLIC_URL>/b/<token>` and `This link works until <time>.` |

### Seed data (DP-53)

Every seeded person and business is invented. Every member's password is `Sunlit-Tide-2027`. A fresh database starts with exactly these records:

- no holds, charters, passages, rota saves, bookings, guests, energy logs or private pages;
- no members, yachts, anchorages, marinas, tariffs, exchange tables, store items or brokers beyond those listed.

Workspaces:

| Slug | Name |
|---|---|
| `adriatic-sunline` | Adriatic Sunline Charters |
| `saronic-lightwater` | Saronic Lightwater Yachts |

Members:

| Workspace | Name | Email | Role | Yacht |
|---|---|---|---|---|
| adriatic-sunline | Mira Kovac | mira.kovac@adriatic-sunline.example | fleet_director | |
| adriatic-sunline | Luka Babic | luka.babic@adriatic-sunline.example | charter_manager | |
| adriatic-sunline | Ana Peric | ana.peric@adriatic-sunline.example | finance_lead | |
| adriatic-sunline | Ivo Matic | ivo.matic@adriatic-sunline.example | captain | |
| adriatic-sunline | Nina Horvat | nina.horvat@adriatic-sunline.example | crew_member | sunwake |
| saronic-lightwater | Eleni Papadaki | eleni.papadaki@saronic-lightwater.example | fleet_director | |
| saronic-lightwater | Nikos Vlachos | nikos.vlachos@saronic-lightwater.example | charter_manager | |
| saronic-lightwater | Sofia Andreou | sofia.andreou@saronic-lightwater.example | finance_lead | |
| saronic-lightwater | Yannis Karras | yannis.karras@saronic-lightwater.example | captain | |
| saronic-lightwater | Dimitra Lekka | dimitra.lekka@saronic-lightwater.example | crew_member | meltemi-glow |

Yachts, all `on_sale` with `shorePowerKw` 22. Rates are weekly, in EUR:

| Workspace | Slug | Name | Base | Cabins | Length m | Beam m | Draft m | Battery kWh | Hotel kW | Solar kW | Drag kW/kn³ | Low | Shoulder | High |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| adriatic-sunline | sunwake | Sunwake | split | 4 | 18.29 | 9.04 | 1.55 | 280 | 3.0 | 9.0 | 0.110 | EUR 18,900.00 | EUR 24,500.00 | EUR 32,900.00 |
| adriatic-sunline | halcyon-drift | Halcyon Drift | split | 6 | 24.40 | 11.20 | 1.80 | 420 | 4.5 | 14.0 | 0.160 | EUR 31,500.00 | EUR 39,800.00 | EUR 52,000.00 |
| adriatic-sunline | kelp-lantern | Kelp Lantern | lavrio | 4 | 16.15 | 8.65 | 1.35 | 240 | 2.5 | 8.0 | 0.095 | EUR 14,500.00 | EUR 18,900.00 | EUR 24,900.00 |
| saronic-lightwater | meltemi-glow | Meltemi Glow | lavrio | 5 | 19.65 | 9.85 | 1.60 | 300 | 3.2 | 10.0 | 0.120 | EUR 21,000.00 | EUR 27,500.00 | EUR 36,000.00 |
| saronic-lightwater | brightwater | Brightwater | split | 3 | 14.95 | 7.95 | 1.20 | 200 | 2.0 | 7.0 | 0.080 | EUR 12,450.00 | EUR 15,900.00 | EUR 21,500.00 |
| saronic-lightwater | salt-ember | Salt Ember | split | 5 | 21.35 | 10.40 | 1.65 | 360 | 4.0 | 12.0 | 0.140 | EUR 26,000.00 | EUR 33,000.00 | EUR 44,500.00 |

For example, with the seed data at start, Sunwake's length shows `18.3 m – 60 ft 0 in` and Halcyon Drift's shows `24.4 m – 80 ft 1 in`.

Crew, in rota order (position in brackets):

- Sunwake: Ivo Matic (captain), Nina Horvat (deckhand), Petra Juric (chef)
- Halcyon Drift: Tomislav Rados (captain), Marta Vukovic (stewardess), Dario Simic (deckhand)
- Kelp Lantern: Stavros Mela (captain), Irini Daskalou (chef), Marko Lisac (deckhand)
- Meltemi Glow: Yannis Karras (captain), Dimitra Lekka (deckhand), Thanos Ritsos (chef)
- Brightwater: Josip Bilic (captain), Lea Grgic (stewardess), Pavlos Zervas (deckhand)
- Salt Ember: Kresimir Tadic (captain), Vesna Bozic (chef), Andreas Mavros (deckhand)

Anchorages. Both workspaces see the same twelve, in this order (latitude north, longitude east, in decimal degrees):

| Id | Name | Base | Latitude | Longitude |
|---|---|---|---|---|
| split-base | Split Marina | split | 43.5040 | 16.4290 |
| solta-maslinica | Maslinica, Solta | split | 43.3985 | 16.2060 |
| hvar-stari-grad | Stari Grad, Hvar | split | 43.1855 | 16.5960 |
| pakleni-palmizana | Palmizana, Pakleni Islands | split | 43.1620 | 16.3940 |
| vis-town | Vis Town | split | 43.0615 | 16.1855 |
| brac-bol | Bol, Brac | split | 43.2600 | 16.6550 |
| lavrio-base | Lavrio Marina | lavrio | 37.7150 | 24.0580 |
| kea-vourkari | Vourkari, Kea | lavrio | 37.6670 | 24.3230 |
| kythnos-kolona | Kolona, Kythnos | lavrio | 37.4300 | 24.3950 |
| poros-town | Poros Town | lavrio | 37.4985 | 23.4555 |
| aegina-port | Aegina Port | lavrio | 37.7465 | 23.4275 |
| sounio-bay | Sounio Bay | lavrio | 37.6520 | 24.0250 |

Each yacht's base marina anchorage is `split-base` or `lavrio-base`.

Marinas. Each workspace has its own copy of both marinas, with the same ids and contents:

- `split-marina`, Split Marina, base split:
  - Berths (length × width × depth in metres): A1 15.00 × 8.00 × 3.00, A2 20.00 × 10.00 × 3.50, A3 25.00 × 12.00 × 4.00, A4 18.29 × 9.04 × 1.85, A5 18.29 × 9.04 × 1.84, A6 14.95 × 7.95 × 1.50.
  - Pontoons: C with a limit of 44 kW, D with a limit of 22 kW.
  - Tariffs: from 2026-01-01 at 450 cents per metre per night; from 2028-04-01 at 520.
- `lavrio-marina`, Lavrio Marina, base lavrio:
  - Berths: B1 17.00 × 9.00 × 3.00, B2 22.00 × 11.00 × 3.20, B3 16.15 × 8.65 × 1.65, B4 19.65 × 9.85 × 1.90.
  - Pontoon: P with a limit of 22 kW.
  - Tariffs: from 2026-01-01 at 380 cents per metre per night; from 2028-04-01 at 430.

Exchange tables, in each workspace (1 EUR =): from 2026-01-01 GBP `0.8450` and USD `1.0820`; from 2028-04-01 GBP `0.8700` and USD `1.1500`.

Store items. Every yacht starts with these four items (received, used, spoiled → on hand):

| Item | Unit | Category | Received | Used | Spoiled | On hand |
|---|---|---|---|---|---|---|
| Still water | bottles | drinks | 48 | 12 | 0 | 36 |
| Olive oil | litres | provisions | 10 | 3 | 0 | 7 |
| Lemons | kg | provisions | 8 | 2 | 1 | 5 |
| Deck cleaner | bottles | cleaning | 6 | 1 | 0 | 5 |

Brokers, with no pages issued at start:

| Workspace | Id | Name | Contact | Email | Notes (internal) |
|---|---|---|---|---|---|
| adriatic-sunline | bluewake | Bluewake Brokers | Hana Ostrova | desk@bluewake-brokers.example | Commission 10%, pays within 14 days |
| adriatic-sunline | cetina | Cetina Yacht Partners | Rafael Oyelaran | charters@cetina-partners.example | Commission 12%, prefers July weeks |
| saronic-lightwater | aegean-keel | Aegean Keel Agency | Clio Varga | hello@aegean-keel.example | Commission 10%, Greek clients only |
| saronic-lightwater | northstar | Northstar Charter Desk | Bram Ellery | desk@northstar-charter.example | Commission 11%, invoices quarterly |

## Technical requirements

### Deployment (DP-53)

- Node.js 22 LTS with npm is available. Write the app in TypeScript.
- At the root of `/app`, ship `/app/run.json` with string fields `install`, `build` and `serve` and `"_schema":"run-manifest-v1"`, for example:

  ```json
  {"_schema":"run-manifest-v1","install":"npm ci","build":"npm run build","serve":"npm run start"}
  ```

- The served app binds `0.0.0.0` on the port in `APP_PUBLIC_PORT` when it is set, and on 4173 otherwise.
- `GET /api/health` answers 200 `{"status":"ok"}` once the app serves requests.
- Graders may start extra copies of the app at the same time. Each has its own empty database and bucket, and some have a dependency pointed at an unreachable address or short timers set through the environment. Each copy applies its schema, creates its bucket and seeds itself at start, and shares nothing with any other copy.

### Configuration and secrets (DP-60)

Read these at start. Never hard-code them, and never send them to the browser:

- **Postgres:** `DATABASE_URL`.
- **MinIO:** `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_FORCE_PATH_STYLE`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`.
- **Kill Bill:** `KILLBILL_URL`, `KILLBILL_USERNAME`, `KILLBILL_PASSWORD`, `KILLBILL_API_KEY`, `KILLBILL_API_SECRET`.
- **Mail:** `SMTP_HOST`, `SMTP_PORT`, `MAIL_FROM` (the From line of every mail, set to `Tidewright <bookings@tidewright.example>`; use that same value when the variable is unset).
- **Links:** `APP_PUBLIC_URL`, used to build mail links.
- **Timers,** in whole seconds:
  - `HOLD_SECONDS` (default 172800)
  - `BROKER_PAGE_SECONDS` (default 1209600)
  - `MANIFEST_PAGE_SECONDS` (default 604800)
  - `MANIFEST_RETENTION_SECONDS` (default 2592000, 30 days)
  - `SESSION_SECONDS` (default 28800)
  - `BROKER_RATE_WINDOW_SECONDS` (default 600)

Timed work (hold lapses and move-ups, page endings and manifest erasure) runs on the server at least every 10 seconds. Session endings are judged on each request.

### Server boundary (DP-40, DP-52)

- The app serves its pages, assets and API from one origin. It sends no cross-origin permission headers and loads nothing from other origins.
- Session cookies are HttpOnly and SameSite=Strict.
- Body and file limits are those in API.
- The server never serves source files, environment files, the lockfile, maps of server code or any credential. Every path outside the published routes answers 404.
- No test, debug, seed or reset route ships.
- When Kill Bill or MinIO is unreachable at start, the app still starts, signs members in and serves every screen. Only the actions that need that service answer with its 503. Each such action tries the service again, so the app recovers when it returns without a restart.
- Postgres is required, and the app waits for it at start.

### Browser support and performance (DP-54, DP-57)

- Support current Chromium, Firefox and WebKit at 1280x800, 768x1024 and 375x812, with touch at the two smaller sizes.
- Each screen shows its data and is usable within three seconds on the local network.
- Slider changes update every figure in under a tenth of a second.
- Every screen passes an automated WCAG 2.2 AA check at each viewport, also with each of its dialogs and sheets open.

## Working rules

- IF-01: `/app/run.json` exists with string fields `install`, `build` and `serve` and `"_schema":"run-manifest-v1"`, and its commands run the app as described in Deployment.
- IF-02: `/app/THIRD_PARTY_NOTICES.md` names every shipped package with its version and licence, and every bundled font with its licence. Shipped packages means the production dependency tree as `npm ls --omit=dev --all --json` reports it.
- IF-03: Every shipped package and bundled font uses one of the MIT, ISC, BSD-2-Clause, BSD-3-Clause, Apache-2.0, 0BSD, BlueOak-1.0.0, CC0-1.0 or OFL-1.1 licences.
- IF-04: The app keeps records only in Postgres and objects only in MinIO. No other database, cache server, SQLite file or data file under `/app` holds app records.
- IF-05: A lockfile at `/app` (`package-lock.json`, `pnpm-lock.yaml` or `yarn.lock`) pins the dependency tree, and the install command uses it.
- IF-06: Fonts, scripts and styles are files of the app itself, and no page references another origin.
- IF-07: The source contains no credential values. Service credentials (the Postgres, MinIO, Kill Bill and SMTP values) appear only as environment variable names; the brief's published seed password and `MAIL_FROM` default are not service credentials.
- IF-08: The source defines no route for tests, debugging, seeding or resetting data.

## Engineering standards

- The code is idiomatic, strictly typed TypeScript. Names match this brief's domain terms (hold, week, charter, leg, arrival charge, reserve, rota, rest rule, berth, slot, tariff, exchange table, movement, manifest, broker page).
- Each domain rule is decided in exactly one place in the source. That covers each hold transition, the pricing and rounding rule, the passage energy rule, each rest rule, the berth fit, the slot status and the private page lifetime.
- Every status the app shows comes from a server decision. No client code compares the device clock to a server instant to decide a status.
- Money is handled as integer minor units and exact decimals throughout. Floating-point arithmetic never touches an amount or a measurement comparison.
- Every API error uses the one error shape in API. No abstraction has only a single implementation.
- There is no dead, commented-out or unreachable code, and no defensive check for a state the rules make impossible.
- The app has no feature, endpoint, screen or setting beyond this brief.
