# Kipwell Stays

Kipwell Stays is a complete hotel and guesthouse marketplace for one solo founder running a small, honest regional platform for independent properties in invented destinations. Travellers search a destination for dates and a party, compare exact all-in totals in their own currency, read each night's price line by line, hold rooms on a server-timed hold, pay with a simulated test card, and later cancel, change or review the stay under the property's own clock. Property managers run a rate and availability calendar, import a season's rates from a file, export reservations and read monthly commission statements at a published 9 percent. The founder, as operator, moderates reviews. The product is one TypeScript web app (a Node server and a browser client). It uses Postgres as the system of record and MinIO for property pictures, uploaded rate files, invoices and commission statements. Out of scope: AI trip planners, flights, cars, taxis, attractions, real payments or any payment provider, live currency feeds (the currency table is a published table set only by the grading route), messaging with properties, wishlist sharing, paid plans, sound, email, outside sign-in, map tile providers, any outside integration, and any rate import format other than the one published here. There is no other datastore, queue, cache, mail or search service.

## Problem and users

Independent hotels and guesthouses get about two thirds of their bookings through large online travel agencies. Those agencies charge 15 to 25 percent commission, keep the guest data and work out prices and rankings in ways nobody outside can see. Travellers pay too. The law now requires the headline price to include every mandatory tax and fee, yet sites still show a nightly rate first and add city tax, extra-guest supplements and currency rounding at the last step. Cancellation deadlines are given without saying whose midnight they mean, and refunds arrive as a different number from the one promised. Hosts pay their share in commission and in disputes. White-label booking engines cover only one property, and building a marketplace means writing the rate, occupancy, tax, currency and policy logic by hand. Kipwell Stays publishes every price rule, tax layer, rounding step, cancellation clause, review weight and commission line, and every screen shows the same figure.

Users:

- **Traveller** (occasional): finds a stay for given dates and party, compares exact all-in totals in their own currency, shares or bookmarks the search, reserves one or several rooms and pays before the hold lapses. Needs no account.
- **Returning guest** (occasional): changes or cancels a stay before the property's local deadline and gets the exact refund promised, keeps a loyalty tier, and reviews a completed stay.
- **Property manager** (daily): sets nightly rates, minimum stays and rooms left on a calendar, imports a season's rates, exports reservations and reads monthly commission statements, for their own properties only.
- **Founder operator** (weekly): moderates reviews.

The device clock of any user may be wrong. Every business date and time comes from the server.

## Journeys

1. **Search by keyboard.** Start: the home page in a fresh browser. The traveller tabs to the destination combobox, types part of a name, picks a destination, opens the date picker, hears each day's availability and minimum stay, picks an arrival and departure, sets two adults and a child of 7, and searches. End: the result count is announced, each row shows the property name and its all-in total, and Enter on a row's name opens the property page.
2. **Share and return.** Start: a results page. The traveller ticks filters, changes the sort, pans the map and presses `Search this area`, pages forward, then copies the link into a second browser. End: the second browser shows the same results with focus on the results heading; in the first browser, back and forward restore each earlier search with its scroll position and focused control.
3. **Quote, hold and pay.** Start: a property page for chosen dates. The traveller accepts the recommended rooms, reads Night Strip night by night, presses Reserve, sees the acid-yellow hold band count down, fills in the guest and card fields and pays. End: the booking page `Booking KW-…` with its ledger and cancellation deadlines. Along the way a manager's rate edit raises a price-change dialog live, and a second traveller who wanted the last room sees the sold-out dialog.
4. **Arabic and dinars.** Start: an English results page. The traveller switches to Arabic and KWD. The layout mirrors with no reload and keeps every filter; the date picker's arrow keys follow the reading direction. End: a quote in KWD whose nights add up to the total exactly.
5. **On a phone.** Start: a results link on a touch phone. The traveller opens filters and the map as bottom sheets, taps a pin to select its row, picks dates by two taps, swipes the property's pictures, and pays from the sticky price bar. End: a booking page that never scrolls sideways at 320 pixels wide.
6. **Cancel or change.** Start: a confirmed two-room booking, opened from another time zone near the property's daylight saving day. The guest reads each deadline in the property's clock and their own, cancels one room and sees the refund and a balanced ledger pair; or changes dates, is refused one range with its reason, and settles the difference for another. End: the booking page shows the new state, and the cancelled room's nights are back on sale in search.
7. **Review.** Start: a completed stay. The guest follows the inbox link, scores five aspects and sends. The operator publishes the review. End: the property's score and its position in search change at once.
8. **Run the property.** Start: the manager calendar. The manager selects weekday nights by keyboard, edits rate and minimum stay, resolves a season overlap, closes a night to sale, previews and applies a rate file, exports reservations and downloads last month's statement. End: travellers see the new prices and closures live, and the statement shows 9 percent of each published base.

## Mandatory requirements

This is the complete list of mandatory requirements; every check traces to one of these lines and the detailed sections below.

- **DP-01 — Run manifest and health** `/app/run.json` installs, builds and serves the app on port 4173, and `GET /api/health` answers as qualified in Deployment and Services.
- **DP-02 — Grading routes** With `KIP_GRADING=1` the seed, session, clock, currency and storage routes behave exactly as published in API, and without it every one answers 404.
- **DP-03 — Server clock and live events** Every business time follows the server clock, and `GET /api/events` delivers the five published events to the calling browser context, which applies them to the page without a reload.
- **DP-04 — Server boundary and limits** Body sizes, content types, cross-origin writes, rate limits and private files are refused with the published statuses in Server boundary.
- **DP-05 — Configuration from the environment** Every service credential, URL and published setting is read from its environment variable at start and never hard-coded or sent to the browser.
- **DP-06 — Focus, dialogs and forced colours** Every dialog and sheet keeps Tab inside, closes on Escape and returns focus to its opener, and focus and selection stay visible in forced-colours mode.
- **DP-07 — Motion and reduced motion** The bottom sheets, gallery and Night Strip run their named animations with the published durations, and under reduced motion they jump to the same end state.
- **DP-08 — Visual design** Every screen carries the published type-only look: heavy Chivo totals larger than names, flat colour blocks for money states with text tags, square corners and the cropped NIGHTS hero.
- **DP-09 — Destination and party controls** The destination combobox and the guest spinbuttons work by keyboard exactly as published in Interactions, and the age comboboxes follow the child count.
- **DP-10 — Date picker** The date picker labels every day with availability, price and minimum stay or the blocking reason, moves by the published keys, and names the chosen range on its opener.
- **DP-11 — Stay restrictions** Every stay is checked in the published order and the first failure wins, with its published reason everywhere it is shown.
- **DP-12 — Keyboard search journey** A traveller completes a search by keyboard alone, hearing the published date help and result count, and reaches a property page from a result row.
- **DP-13 — Search results and paging** Results are filtered, counted, ranked, bucketed and paged by the published rules, and paging never repeats or skips a property whose position did not change.
- **DP-14 — Search links and history** Every search setting lives in the URL in the published order, invalid links normalise with the published notice, and back and forward restore results, scroll and focus.
- **DP-15 — Map** The drawn map clusters, pans, zooms, searches its area and stays in sync with the result rows by the published rules, by pointer and by keyboard.
- **DP-16 — Shared search journey** A traveller filters, sorts, searches a map area and pages, shares the link into a second browser, and goes back and forward through each earlier search.
- **DP-17 — Nightly price build** Every night of every room is priced in whole cents by the published steps and rounding, and every screen and document shows the same totals.
- **DP-18 — Currency split and price display** A total in USD, JPY or KWD is converted by the published rule and split across nights so the nights add up exactly, and the price display switches follow the published rules.
- **DP-19 — Room allocation** The property page recommends the cheapest room combination by the published rule, and a refused override shows the published room advice and keeps the previous prices.
- **DP-20 — Night Strip** Night Strip shows one column per night with its amount and its rate state by the published rule, and expands by keyboard into the published price lines.
- **DP-21 — Quote journey** A traveller builds a two-room quote with a child, a loyalty tier and tax on tax, switches currencies and display, and reads each night by keyboard.
- **DP-22 — Quotes and holds** Quotes and holds last their published lifetimes on the server clock with the published edges, and exactly one of several simultaneous holds on the last room wins.
- **DP-23 — Payment and booking** Paying follows the published error order, test cards and repeat-request rule so a double submit books and charges once.
- **DP-24 — Live checkout dialogs** An open checkout shows the published hold countdown and announcements and raises the hold-ended, price-changed and just-taken dialogs live from server events.
- **DP-25 — Checkout journey** Two travellers compete for one last room while a manager edits the rate, and the winner pays after a declined card and a double click.
- **DP-26 — Languages** English, German and Arabic show the published strings, plurals, number and date forms, and Arabic mirrors the layout and the reading-direction arrow keys.
- **DP-27 — Arabic journey** A traveller switches a search to Arabic and KWD without losing state, picks dates with mirrored keys, and reads a KWD quote whose nights add up.
- **DP-28 — Phone layout and touch** At each published viewport the screens follow their layouts with no sideways scroll at 320 pixels, and on a phone the sheets, sticky bar, touch range and gallery swipe work as published.
- **DP-29 — Phone journey** A traveller on a touch phone picks dates by touch, filters and selects on the map in sheets, swipes the gallery under reduced motion and pays at 320 pixels wide.
- **DP-30 — Deadlines in property time** Cancellation deadlines are resolved in the property's time zone across daylight saving days, shown in both clocks, and the refund status comes from the server and updates live.
- **DP-31 — Room cancellation and ledger** Cancelling one room refunds the published amount, returns its nights to sale at once and adds a balanced ledger pair without changing earlier entries.
- **DP-32 — Cancellation journey** A guest in another time zone cancels one room around a property's daylight saving day while a second browser sees the room back in search.
- **DP-33 — Date changes** A date change rechecks restrictions, re-prices at current rates and tier, and pays or refunds the difference by the published rule.
- **DP-34 — Change journey** A returning guest is refused one new date range with its reason, then changes to another and settles the difference under the refund tier in force.
- **DP-35 — Reviews and score** Review links open only inside the published window, moderation follows the published states, and published reviews set the weighted score that ranking uses.
- **DP-36 — Review journey** A guest is refused before the stay ends, reviews through the inbox link afterwards, and the operator's publication moves the property's score and rank in search.
- **DP-37 — Rate calendar and seasons** A manager edits nights on the keyboard grid with the published validation and season overlap rule, and each edit reaches searches and open checkouts live.
- **DP-38 — Calendar journey** A manager bulk-edits weekday nights by keyboard, resolves a season overlap and closes a night, and a traveller in another browser sees it closed.
- **DP-39 — Accounts, sessions and tab sync** Sign-up, sign-in and sign-out follow the published rules, and language, currency and sign-out everywhere reach every open tab live.
- **DP-40 — Loyalty tiers** The tier comes from completed stays in the published rolling period and applies to new quotes only.
- **DP-41 — Two-tab journey** A signed-in guest changes language and currency in one tab and sees the other follow, gains a tier that only a new quote uses, and signs out everywhere.
- **DP-42 — Rate import** A rate file in the published format is stored byte for byte and applied in one step only when valid, with every error listed by line and a preview first.
- **DP-43 — Storage outage and recovery** When storage is down, imports and documents show the published outage copy, search keeps working, and a retry succeeds once storage returns with no restart.
- **DP-44 — Access order** Bookings, manager pages and moderation answer other people's resources with 404 before any 403, by the published error order.
- **DP-45 — Reservation and statement exports** Reservation CSVs and monthly statements carry the published columns and 9 percent commission figures, with formula-leading cells neutralised.
- **DP-46 — Invoice and print** The stored invoice and the printed confirmation show the published content and match the booking's figures.

## Frontend

### Screens and layout (DP-08, DP-09, DP-13, DP-15, DP-20, DP-28)

Viewports are named by width: **phone** under 768 pixels, **tablet** 768 to 1279 pixels, **desk** 1280 pixels and wider. The published sizes 375x812 (phone), 768x1024 (tablet) and 1280x800 (desk) each get exactly the layout of their band; no other breakpoint changes which layout these sizes get. No page scrolls sideways at any width from 320 pixels up: the document is never wider than the window. The manager calendar grid may scroll sideways inside its own frame; the page around it does not.

Every page has a site header: the KIPWELL wordmark at the start (a link to `/`), then the links `Destinations` and `For properties`, `combobox "Language"` and `combobox "Currency"`, and a sign-in link or the signed-in username linking to `/account`. On a phone the header is one row with the wordmark and the two comboboxes; the two links move under it as a second row.

Screens:

- **Home** (`/`): the hero (Visual design), then four typographic sections in this order: the five price layers one per line; the cancellation rule on a sage field; the two numerals `9%` and `180`, each with its sentence; one large drawn illustration of a harbour town at night (procedural SVG, `img "Harbour town at night"`). Below the hero sentence sits `link "Search stays"` to `/search`. Desk and tablet: the sentence and link on the left margin, the cancellation paragraph in a narrow column on the right. Phone: one column, the hero word vertical down the right edge.
- **Search** (`/search?…`): the search form (destination, Dates, Adults, Children, ages, Search), `heading "Results"`, the price display controls and sort, the result rows, paging links, filters, histogram and map. Desk: three columns — filters and histogram on the start side (about a fifth of the width), result rows in the middle, the map on the end side (about two fifths), staying in view while the rows scroll. Tablet: two columns — filters on the start side, rows on the other, with the map as a band about a third of the screen high above the rows. Phone: one column — form, then a row with `button "Filters"` and `button "Map"`, then the rows; filters and map open as bottom sheets.
- **Result row**: an `article` named by the row label (Public screens and controls). No pictures. The property name on the start side as a `link` to the property page; the all-in total on the end side, in the heaviest weight and larger than the name; stars, score, distance and refundability as small text; a sage block with the word `Refundable` when it applies; `button "Show {name} on the map"`. On a phone the total sits under the name, aligned to the end.
- **Empty results**: the single huge word `NOTHING` with one sentence of help (Feedback states).
- **Property page** (`/properties/<code>?…` with the same search parameters): the name, stars, score and distance; `button "Dates"` for this property; `group "Rooms"`; one rate radiogroup and breakfast checkbox per selected room; Night Strip; `button "Show pictures"` near the end of the page; `region "Price and reserve"` holding the total and `button "Reserve"`. Desk and tablet: details on the start side, `region "Price and reserve"` as a column on the end side that stays in view. Phone: `region "Price and reserve"` stays fixed at the bottom of the window. When nothing can be booked for the dates, the page shows the huge word `SOLD` with its sentence.
- **Checkout** (`/checkout/<quote id>`): one white centred column. Night Strip full width at the top, then the rooms summary, the acid-yellow hold band with `timer "Time left"`, the guest and card fields, `region "Problems"` when present, and the single orange `button "Pay"`. `region "Price and reserve"` follows the property page's placement per viewport and holds `button "Reserve"` until the hold exists.
- **Booking page** (`/bookings/<code>`): `heading "Booking {code}"`, guest, property and its time zone, dates, rooms with their states, Night Strip, totals, `region "Cancellation"` on a sage field with `status "Refund status"`, the cancel and change buttons, `table "Ledger"`, `link "Invoice"`. Managers of the property also see `button "Mark no-show"`.
- **Find a booking** (`/find`): `form "Find a booking"`.
- **Invoice** (`/bookings/<code>/invoice`): the stored printable invoice page.
- **Review** (`/reviews/<token>`): the review form or the server's refusal sentence.
- **Inbox** (`/inbox`): `region "Inbox"` listing messages, newest first.
- **Account** (`/account`): `region "Loyalty"` and `button "Sign out everywhere"`.
- **Sign in** (`/signin`) and **Create account** (`/signup`).
- **Moderation** (`/moderation`, operator only): one `article` per pending review, oldest first, with its five scores, comment, property and the publish and reject buttons.
- **Manager pages** (`/manage/<code>/calendar`, `/reservations`, `/import`, `/statements`): a manager navigation row, then the page body. Calendar: the dense grid on the light grey surface, full width. Reservations: `table "Reservations"` full width. Import: the file control, buttons, error list and preview table in one column. Statements: `combobox "Month"`, then `table "Statement"` full width in one text size.
- **Not found and no access**: a page with the huge word and one sentence (Feedback states).

At every width the order in the reading direction is header, main content, then (phone only) the fixed price bar.

### Public screens and controls (DP-06, DP-09, DP-10, DP-15, DP-19, DP-20, DP-23, DP-26, DP-37, DP-42)

Only the controls and regions below are public; everything else is free. Each accessible name contains its visible text. Names are given in English, German and Arabic; `{…}` placeholders are defined in the Placeholders table under Feedback states. Live regions and dialogs are named in the page's language too.

| Where | Role and English name | German | Arabic |
|---|---|---|---|
| Header | `combobox "Language"` | Sprache | اللغة |
| Header | `combobox "Currency"` | Währung | العملة |
| Header | `link "Destinations"` | Reiseziele | الوجهات |
| Header | `link "For properties"` | Für Unterkünfte | لأماكن الإقامة |
| Header | `link "Sign in"` | Anmelden | تسجيل الدخول |
| Header | `link "Inbox"` | Posteingang | البريد الوارد |
| Home | `link "Search stays"` | Unterkünfte suchen | ابحث عن إقامة |
| Home | `img "Harbour town at night"` | Hafenstadt bei Nacht | مدينة ميناء ليلًا |
| Search | `combobox "Destination"` with `listbox` of `option "{name}, {count:property}"` | Reiseziel | الوجهة |
| Search, property | `button "Dates"`; once a range is chosen `button "Dates, {in} to {out}, {count:night}"` | Reisedaten; Reisedaten, {in} bis {out}, {count:night} | التواريخ؛ التواريخ، {in} إلى {out}، {count:night} |
| Date picker | `dialog "Choose dates"` | Reisedaten wählen | اختر التواريخ |
| Date picker | `grid "{month year}"`, `gridcell` with one day `button` named by the day label | — | — |
| Date picker | `button "Previous month"` | Vorheriger Monat | الشهر السابق |
| Date picker | `button "Next month"` | Nächster Monat | الشهر التالي |
| Search | `spinbutton "Adults"` | Erwachsene | البالغون |
| Search | `spinbutton "Children"` | Kinder | الأطفال |
| Search | `combobox "Age of child {n}"` | Alter von Kind {n} | عمر الطفل {n} |
| Search | `button "Search"` | Suchen | بحث |
| Search | `heading "Results"` | Ergebnisse | النتائج |
| Search | `combobox "Sort by"`, options `Best match`, `Price, low to high`, `Price, high to low`, `Highest score`, `Nearest` | Sortieren nach; Beste Übereinstimmung, Preis aufsteigend, Preis absteigend, Beste Bewertung, Nächstgelegen | ترتيب حسب؛ أفضل تطابق، السعر من الأقل، السعر من الأعلى، أعلى تقييم، الأقرب |
| Search, property, checkout | `radiogroup "Price display"` | Preisanzeige | عرض السعر |
| Search, property, checkout | `radio "Per night"` | Pro Nacht | لكل ليلة |
| Search, property, checkout | `radio "Total"` | Gesamt | الإجمالي |
| Search, property, checkout | `switch "Include taxes"` | Steuern einbeziehen | تشمل الضرائب |
| Filters | `group "Stars"`; `checkbox "3 stars ({count})"`, `4 stars`, `5 stars` | Sterne; 3 Sterne ({count}) | النجوم؛ 3 نجوم ({count}) |
| Filters | `group "Amenities"`; checkboxes `Pool ({count})`, `Parking ({count})`, `Wi-Fi ({count})`, `Spa ({count})`, `Pets allowed ({count})` | Ausstattung; Pool, Parkplatz, WLAN, Spa, Haustiere erlaubt | المرافق؛ مسبح، موقف سيارات، واي فاي، منتجع صحي، يسمح بالحيوانات الأليفة |
| Filters | `group "Cancellation"`; `checkbox "Free cancellation ({count})"` | Stornierung; Kostenlose Stornierung | الإلغاء؛ إلغاء مجاني |
| Filters | `spinbutton "Lowest price"` | Mindestpreis | أدنى سعر |
| Filters | `spinbutton "Highest price"` | Höchstpreis | أقصى سعر |
| Filters | histogram bar `img "{from} to {to} euros, {count:property}"`; last bar `img "{from} euros and up, {count:property}"` | {from} bis {to} Euro, {count:property}; {from} Euro und mehr, {count:property} | {from} إلى {to} يورو، {count:property}؛ {from} يورو فأكثر، {count:property} |
| Results | `article "{name}, {stars} stars, score {score}, {distance} kilometres, total {amount}"` | {name}, {stars} Sterne, Bewertung {score}, {distance} Kilometer, gesamt {amount} | {name}، {stars} نجوم، التقييم {score}، {distance} كيلومتر، الإجمالي {amount} |
| Results | text tag `Refundable` | Erstattbar | قابل للاسترداد |
| Results | `button "Show {name} on the map"` | {name} auf der Karte zeigen | عرض {name} على الخريطة |
| Results | `link "Next page"` | Nächste Seite | الصفحة التالية |
| Results | `link "Previous page"` | Vorherige Seite | الصفحة السابقة |
| Map | `region "Map"` | Karte | الخريطة |
| Map | pin `button "{name}, score {score}, from {amount}"` | {name}, Bewertung {score}, ab {amount} | {name}، التقييم {score}، من {amount} |
| Map | cluster `button "{count:property}, zoom in"` | {count:property}, hineinzoomen | {count:property}، تكبير |
| Map | `button "Pan north"`, `Pan south`, `Pan east`, `Pan west` | Nach Norden schwenken, Nach Süden schwenken, Nach Osten schwenken, Nach Westen schwenken | تحريك شمالًا، تحريك جنوبًا، تحريك شرقًا، تحريك غربًا |
| Map | `button "Zoom in"` | Vergrößern | تكبير الخريطة |
| Map | `button "Zoom out"` | Verkleinern | تصغير الخريطة |
| Map | `button "Search this area"` | In diesem Gebiet suchen | ابحث في هذه المنطقة |
| Phone | `button "Filters"`, `dialog "Filters"` | Filter | عوامل التصفية |
| Phone | `button "Map"`, `dialog "Map"` | Karte | الخريطة |
| Property, checkout | `region "Price and reserve"` | Preis und Reservierung | السعر والحجز |
| Property, checkout | `button "Reserve"` | Reservieren | احجز |
| Property | `group "Rooms"` | Zimmer | الغرف |
| Property | `spinbutton "{room type name} rooms"` | {room type name} Zimmer | غرف {room type name} |
| Property | `button "Use recommended rooms"` | Empfohlene Zimmer verwenden | استخدم الغرف الموصى بها |
| Property | text tag `Recommended` | Empfohlen | موصى به |
| Property | `radiogroup "Rate for room {n}"` with `radio "Flexible"` and `radio "Nonrefundable"` | Tarif für Zimmer {n}; Flexibel; Nicht erstattbar | سعر الغرفة {n}؛ مرن؛ غير قابل للاسترداد |
| Property | `checkbox "Breakfast for room {n}"` | Frühstück für Zimmer {n} | إفطار للغرفة {n} |
| Property | `button "Show pictures"` | Bilder zeigen | عرض الصور |
| Gallery | `dialog "Pictures"` | Bilder | الصور |
| Gallery | `img "Picture {i} of {n}"` | Bild {i} von {n} | الصورة {i} من {n} |
| Gallery | `button "Previous picture"`, `button "Next picture"` | Vorheriges Bild, Nächstes Bild | الصورة السابقة، الصورة التالية |
| Night Strip | `group "Night Strip"` (same name in every language) | Night Strip | Night Strip |
| Night Strip | night `button "{weekday day month}, {amount}"` | same pattern | same pattern |
| Night Strip | rate state tags `Base`, `Discount`, `Held`, `Closed` | Basis, Rabatt, Reserviert, Geschlossen | أساسي، خصم، محجوز، مغلق |
| Night Strip | `list "Price lines"`, each `listitem "{label}: {amount}"` | Preiszeilen | بنود السعر |
| Price line labels | `Plan rate`, `Occupancy`, `Children`, `Length of stay`, `Early booking`, `Last minute`, `Loyalty`, `Breakfast`, `VAT`, `City tax`, `Tourism levy`, `Night total` | Tarif, Belegung, Kinder, Aufenthaltsdauer, Frühbucher, Last Minute, Treue, Frühstück, MwSt., Kurtaxe, Tourismusabgabe, Summe der Nacht | سعر الخطة، الإشغال، الأطفال، مدة الإقامة، الحجز المبكر، اللحظة الأخيرة، الولاء، الإفطار، ضريبة القيمة المضافة، ضريبة المدينة، رسوم السياحة، إجمالي الليلة |
| Checkout | `timer "Time left"` showing `mm:ss` | Verbleibende Zeit | الوقت المتبقي |
| Checkout | `textbox "Given name"` | Vorname | الاسم الأول |
| Checkout | `textbox "Surname"` | Nachname | اسم العائلة |
| Checkout, change | `textbox "Card number"` | Kartennummer | رقم البطاقة |
| Checkout, change | `textbox "Expiry"` | Ablaufdatum | تاريخ الانتهاء |
| Checkout, change | `textbox "Security code"` | Sicherheitscode | رمز الأمان |
| Checkout, change | `button "Pay"` | Bezahlen | ادفع |
| Checkout, change, calendar | `region "Problems"` with `heading` (Feedback states) and one `link "{field label}: {message}"` per problem | Probleme | المشكلات |
| Checkout | `dialog "Confirm your payment"`, `textbox "Code"`, `button "Confirm"` | Zahlung bestätigen; Code; Bestätigen | أكد الدفع؛ الرمز؛ تأكيد |
| Checkout | `alertdialog "Your hold ended"` | Ihre Reservierung ist abgelaufen | انتهى حجزك المؤقت |
| Checkout | `alertdialog "The price changed"` | Der Preis hat sich geändert | تغير السعر |
| Checkout | `alertdialog "Just taken"` | Gerade vergeben | حُجزت للتو |
| Checkout dialogs | `button "Search again"` | Erneut suchen | ابحث مجددًا |
| Checkout dialogs | `button "Accept new price"` | Neuen Preis akzeptieren | اقبل السعر الجديد |
| Checkout dialogs | `button "Keep searching"` | Weiter suchen | تابع البحث |
| Booking | `heading "Booking {code}"` | Buchung {code} | الحجز {code} |
| Booking | `region "Cancellation"` | Stornierung | الإلغاء |
| Booking | `status "Refund status"` | Erstattungsstatus | حالة الاسترداد |
| Booking | `button "Cancel room {n}"` | Zimmer {n} stornieren | إلغاء الغرفة {n} |
| Booking | `button "Cancel booking"` | Buchung stornieren | إلغاء الحجز |
| Booking | `dialog "Cancel this room?"`, `dialog "Cancel this booking?"` | Dieses Zimmer stornieren?; Diese Buchung stornieren? | إلغاء هذه الغرفة؟؛ إلغاء هذا الحجز؟ |
| Booking | `button "Confirm cancellation"` | Stornierung bestätigen | تأكيد الإلغاء |
| Booking | `button "Keep booking"` | Buchung behalten | الإبقاء على الحجز |
| Booking | `button "Change dates"`, `dialog "Change dates"` | Daten ändern | تغيير التواريخ |
| Booking | `button "Confirm change"` | Änderung bestätigen | تأكيد التغيير |
| Booking | `button "Mark no-show"` | Als nicht erschienen markieren | تسجيل عدم الحضور |
| Booking | `table "Ledger"`, column headers `Kind`, `Account`, `Debit`, `Credit`, `Time`; kinds `Charge`, `Refund`, `Change`; accounts `Guest`, `Property` | Kontobuch; Art, Konto, Soll, Haben, Zeit; Belastung, Erstattung, Änderung; Gast, Unterkunft | السجل المالي؛ النوع، الحساب، مدين، دائن، الوقت؛ خصم، استرداد، تغيير؛ الضيف، مكان الإقامة |
| Booking | `link "Invoice"` | Rechnung | الفاتورة |
| Find | `form "Find a booking"`, `textbox "Booking code"`, `textbox "Surname"`, `button "Find booking"` | Buchung finden; Buchungscode; Nachname; Buchung suchen | ابحث عن حجز؛ رمز الحجز؛ اسم العائلة؛ ابحث |
| Inbox | `region "Inbox"`; review message `link "Review your stay at {property name}"` | Posteingang; Bewerten Sie Ihren Aufenthalt in {property name} | البريد الوارد؛ قيّم إقامتك في {property name} |
| Review | `spinbutton "Cleanliness"`, `Comfort`, `Location`, `Staff`, `Value` | Sauberkeit, Komfort, Lage, Personal, Preis-Leistung | النظافة، الراحة، الموقع، الموظفون، القيمة |
| Review | `textbox "Comment"`, `button "Send review"` | Kommentar; Bewertung senden | تعليق؛ أرسل التقييم |
| Moderation | `button "Publish review {id}"`, `button "Reject review {id}"` | Bewertung {id} veröffentlichen; Bewertung {id} ablehnen | انشر التقييم {id}؛ ارفض التقييم {id} |
| Account | `region "Loyalty"` | Treue | الولاء |
| Account | `button "Sign out everywhere"` | Überall abmelden | تسجيل الخروج من كل الأجهزة |
| Sign in | `form "Sign in"`, `textbox "Username"`, `textbox "Password"`, `button "Sign in"`, `link "Create account"` | Anmelden; Benutzername; Passwort; Anmelden; Konto erstellen | تسجيل الدخول؛ اسم المستخدم؛ كلمة المرور؛ تسجيل الدخول؛ إنشاء حساب |
| Create account | `form "Create account"`, `textbox "Username"`, `textbox "Password"`, `button "Create account"` | Konto erstellen | إنشاء حساب |
| Calendar | `grid "Rates and availability"`, `rowheader` per room type, `gridcell` per room type and date | Preise und Verfügbarkeit | الأسعار والتوفر |
| Calendar | `button "Earlier dates"`, `button "Later dates"` | Frühere Daten, Spätere Daten | تواريخ سابقة، تواريخ لاحقة |
| Calendar | `dialog "Edit nights"` | Nächte bearbeiten | تعديل الليالي |
| Edit nights | `spinbutton "Rate"`, `Rooms`, `Minimum stay`, `Maximum stay` | Preis, Zimmer, Mindestaufenthalt, Höchstaufenthalt | السعر، الغرف، الحد الأدنى للإقامة، الحد الأقصى للإقامة |
| Edit nights | `checkbox "Closed to arrival"`, `Closed to departure`, `Stop sell` | Keine Anreise, Keine Abreise, Verkaufsstopp | مغلق للوصول، مغلق للمغادرة، إيقاف البيع |
| Edit nights | `group "Weekdays"` of seven checkboxes named by the language's long weekday names from the week start | Wochentage | أيام الأسبوع |
| Edit nights | `textbox "Season name"`, `button "Apply"`, `button "Replace {season}"` | Saisonname; Übernehmen; {season} ersetzen | اسم الموسم؛ تطبيق؛ استبدل {season} |
| Reservations | `table "Reservations"`, headers `Code`, `Surname`, `Arrival`, `Departure`, `Rooms`, `Total`; `link "Export CSV"` | Reservierungen; Code, Nachname, Anreise, Abreise, Zimmer, Gesamt; CSV exportieren | الحجوزات؛ الرمز، اسم العائلة، الوصول، المغادرة، الغرف، الإجمالي؛ تصدير CSV |
| Import | file input labelled `Rate file`, `button "Preview"`, `button "Apply"` | Tarifdatei; Vorschau; Übernehmen | ملف الأسعار؛ معاينة؛ تطبيق |
| Import | `list "Import errors"`, `table "Import preview"` | Importfehler; Importvorschau | أخطاء الاستيراد؛ معاينة الاستيراد |
| Statements | `combobox "Month"`, `table "Statement"` with headers `Code`, `Kind`, `Base`, `Commission`, kinds `Stay`, `Cancellation`, last row `Total`; `link "Download statement"` | Monat; Abrechnung; Code, Art, Basis, Provision; Aufenthalt, Stornierung; Summe; Abrechnung herunterladen | الشهر؛ الكشف؛ الرمز، النوع، الأساس، العمولة؛ إقامة، إلغاء؛ المجموع؛ تنزيل الكشف |
| Live regions | `status "Search announcements"` | Suchmeldungen | إعلانات البحث |
| Live regions | `status "Hold announcements"` | Reservierungsmeldungen | إعلانات الحجز المؤقت |
| Live regions | `status "Date help"` | Datumshilfe | مساعدة التاريخ |
| Live regions | `status "Link notice"` | Link-Hinweis | تنبيه الرابط |
| Live regions | `status "Room advice"` | Zimmerhinweis | نصيحة الغرف |
| Live regions | `status "Toast"` | Mitteilung | إشعار |
| Outages | `alert` band (no name) holding outage copy | — | — |

`combobox "Language"` options read `English`, `Deutsch`, `العربية` in every language. `combobox "Currency"` options read `EUR`, `USD`, `JPY`, `KWD`. `combobox "Age of child {n}"` options are the whole numbers 0 to 17. `combobox "Month"` options are months in the language's long `{month year}` form, newest first, from the property's first booking month to the current property-local month.

Data attributes tests read:

- Every money amount on any screen is visible text inside an element carrying `data-minor` (integer minor units) and `data-currency` (`EUR`, `USD`, `JPY` or `KWD`).
- `<body data-pending>` holds the number of client requests in flight; a change has settled when it reads `0`.
- Each filter checkbox has `data-count`. Each histogram bar has `data-from` (minor units) and `data-count`.
- `region "Map"` has `data-zoom`, `data-cx`, `data-cy` (one decimal). Pins have `aria-pressed`; the selected result row has `aria-current="true"`.
- Each date picker day button has `data-date` (`YYYY-MM-DD`); its `gridcell` has `aria-selected="true"` when inside the chosen range.
- Each Night Strip night button has `data-date` and `data-state` (`base`, `discount`, `held` or `closed`, by Business rules, Night states); its amount has `data-minor` and `data-currency` in the currency set by Business rules (Currency conversion and split).
- Each price line `listitem` has `data-minor` and `data-currency`, in the currency set by Business rules (Currency conversion and split).
- Each cancellation deadline has `data-deadline-utc` (ISO UTC instant).
- `table "Ledger"` has `data-balance-minor`; each row has `data-kind`, `data-account`, `data-pair`, and its Debit and Credit cells both carry `data-minor`, as qualified in Business rules (Currency conversion and split).
- Each calendar `gridcell` has `data-date`, `data-room-type`, `data-rate-minor`, `data-allotment`, `data-left`; selected cells have `aria-selected="true"`.
- Gallery `dialog "Pictures"` has `data-index` (1-based current picture). Bottom sheets have `data-sheet`.
- Each focusable control on the search page carries a stable `data-focus-key`.

### Interactions (DP-06, DP-09, DP-10, DP-14, DP-15, DP-19, DP-20, DP-24, DP-26, DP-28, DP-37, DP-39)

**General keyboard.** Every action works by keyboard. Tab order follows the reading order of each layout. Tab and Shift+Tab wrap inside every open dialog, alertdialog and sheet (the last control goes to the first and back); nothing behind it takes focus. Escape closes any dialog or sheet except the three checkout alertdialogs, which close only through their buttons. Closing returns focus to the control that opened it, unless a rule below names another target.

**Destination combobox.** It follows the ARIA combobox pattern with a listbox popup. Typing filters destinations by a case-insensitive match anywhere in the name, `KIP_TYPE_DEBOUNCE_MS` after the last keystroke on a page timer; the listbox opens with the matches. ArrowDown and ArrowUp move the active option through `aria-activedescendant`, with focus staying in the combobox. Enter picks the active option, fills the combobox with its name, closes the list and keeps focus in the combobox. Escape closes the list; a second Escape clears the text.

**Guests.** `spinbutton "Adults"` runs 1 to 16, default 2. `spinbutton "Children"` runs 0 to 8, default 0. ArrowUp adds 1, ArrowDown subtracts 1, Home sets the minimum, End the maximum; typing a number also works. Each child adds a `combobox "Age of child {n}"` after the spinbuttons, defaulting to 8; lowering Children removes the last ones.

**Search and URL.** `button "Search"` runs the search for the destination, dates and party. Filters, sort, price range, display and taxes update the results in place, with no submit button and no reload, as soon as they change (spinbuttons after the debounce of the destination combobox). Every user change pushes exactly one history entry, carrying every setting in the URL as listed in Business rules (Search link form): the search box (one entry per press of Search), a filter, the sort, a page change, `Search this area`, a selection, a language or currency change. Normalisation by the server replaces the current entry instead.

**Back, forward and deep links.** Back and forward re-run the search from the URL and restore the results exactly. Once the results have rendered, the page scrolls to the position it had when that entry was left, within 1 pixel, and focus returns to the control with the same `data-focus-key` that had focus; if that control is gone, focus goes to `heading "Results"` (which is focusable by script but not by Tab). A first load, a reload or a deep link opened in a new browser shows the same results with focus on `heading "Results"`, scroll at the top, and the result count announced. `link "Next page"` loads the next page and pushes an entry. `link "Previous page"` appears only on a page reached by `Next page` in this tab; its target is the previous page's URL and activating it goes back one history entry.

**Map.** The map is a drawn plane of invented coastlines, never mirrored. Click or Space on a pin selects it: the pin gets `aria-pressed="true"`, the matching row `aria-current="true"` and scrolls into view, and `sel` enters the URL. `button "Show {name} on the map"` selects the same way and centres the map on the pin. Enter on a pin opens the property page. Activating a cluster zooms in by one level centred on it. Pins and clusters form one roving tab stop: Tab enters on the selected pin (or the first by code), and arrow keys move to the nearest pin in that direction by the rule in Business rules (Map); with none, focus stays. The arrow keys work the same in Arabic. Escape moves focus to `button "Zoom in"`. The pan buttons, zoom buttons and a pointer drag of the plane move the view. Every move restarts a `KIP_MAP_DEBOUNCE_MS` page timer; when it ends, `button "Search this area"` appears; pressing it searches only inside the view and pushes `zoom`, `cx`, `cy`. The button is hidden while the view equals the last searched view.

**Date picker.** `button "Dates"` opens `dialog "Choose dates"` with focus on the chosen arrival day (or today in the destination's zone by the server clock). Desk and tablet show two months side by side; a phone shows one. The day grid is one roving tab stop. ArrowLeft and ArrowRight move one day (swapped in Arabic, so the arrow pointing toward the next day in reading order moves forward); ArrowUp and ArrowDown move one week; PageUp and PageDown move one month; Shift+PageUp and Shift+PageDown move one year; Home and End move to the start and end of the week. The week starts on Monday in English and German and on Saturday in Arabic. Enter picks the arrival, then the departure. Picking a blocked day keeps focus on it and puts its label's reason into `status "Date help"`. After the departure is picked, the dialog closes and focus returns to the Dates button, whose name now shows the range. Escape closes without changing the range and returns focus to the Dates button. Day labels and `status "Date help"` text follow Business rules (Date availability) with copy from Feedback states. On a touch screen, the first tap on a day sets the arrival and the next tap the departure, in the same grid.

**Rooms.** `group "Rooms"` shows the recommendation (Business rules, Room allocation) in its spinbuttons with the `Recommended` tag while they equal it. Changing a spinbutton asks the server to place the party in the chosen rooms; a refused change puts the room advice in `status "Room advice"` and keeps the previous prices on screen. `button "Use recommended rooms"` restores the recommendation.

**Night Strip.** `group "Night Strip"` is one roving tab stop across its night buttons. ArrowRight and ArrowLeft move between nights in reading order (swapped in Arabic); Home and End go to the first and last night. Enter expands the focused night into `list "Price lines"` under it, collapsing any other expanded night; the column grows and its neighbours reflow. Enter again or Escape collapses it and keeps focus on the night button. Moving to a night announces its button name in `status "Search announcements"`.

**Checkout.** On the property page, `button "Reserve"` creates a quote for the current selection and opens its checkout page. On the checkout page, `button "Reserve"` places the hold; then the guest and card fields and `button "Pay"` become usable and the hold band appears. `button "Pay"` disables at the first press until the reply. Client checks run on Pay: with any problem, `region "Problems"` appears above the fields and takes focus, listing one link per problem in field order; following a link focuses its field. A card outcome refusal is shown the same way. On the step-up outcome, `dialog "Confirm your payment"` opens with focus in `textbox "Code"`; a wrong code shows its message under the field and keeps the dialog open. In `alertdialog "The price changed"`, `button "Accept new price"` re-quotes, keeps the hold, closes the dialog and moves focus to `button "Pay"`; `button "Keep searching"` releases the hold and returns to the search. `button "Search again"` returns to the search for the same settings.

**Booking.** `button "Cancel room {n}"` opens `dialog "Cancel this room?"` with the server's refund figure; `button "Cancel booking"` opens `dialog "Cancel this booking?"` for every active room. `button "Change dates"` opens `dialog "Change dates"` holding the same date picker grid; after a range is picked, the dialog shows the server's figures and either the card fields with `button "Pay"` or `button "Confirm change"`.

**Gallery.** `button "Show pictures"` opens `dialog "Pictures"`. ArrowRight and ArrowLeft (swapped in Arabic), or the picture buttons, move one picture. On touch, a horizontal drag of 60 CSS pixels or more moves one picture toward the next in reading order (a leftward drag in English and German, a rightward drag in Arabic); a shorter drag snaps back. Escape closes and returns focus to `button "Show pictures"`.

**Phone sheets.** `button "Filters"` and `button "Map"` open `dialog "Filters"` and `dialog "Map"` as bottom sheets. A pin chosen inside the map sheet selects its row, closes the sheet and returns focus to that row's `Show on the map` button.

**Manager calendar.** `grid "Rates and availability"` is one roving tab stop. Arrow keys move the active cell (left and right swapped in Arabic); Shift+arrow keys extend a rectangular selection from the anchor cell. Enter opens `dialog "Edit nights"` for the selection, prefilled from the active cell, with every weekday ticked. Escape closes it and returns focus to the same active cell. `button "Earlier dates"` and `button "Later dates"` move the 28-day window by 28 days; the first window starts on property-local today.

**Rate import.** Choosing a file and pressing `button "Preview"` shows either `list "Import errors"` or `table "Import preview"`; `button "Apply"` is enabled only after a preview with no errors.

**Language and currency.** Changing `combobox "Language"` or `combobox "Currency"` re-renders the page in place, with no reload, keeping every setting, field value, selection and scroll position, and pushes one history entry. Other open tabs of the same browser follow live (Business rules, Accounts and preferences).

**Print.** When a page is printed, the navigation, header, live regions, buttons and `region "Map"` are hidden. The printed booking page shows the code, guest name, property with its time zone, dates, rooms, every night's price lines and the total.

### Visual design (DP-08)

The direction is a type-only statement. Two typefaces, both bundled with the app: **Chivo** for everything in Latin script, from its heaviest weight for figures and the hero word down to its regular weight for body text, and **IBM Plex Sans Arabic** for Arabic, in its boldest weight wherever Chivo is at its heaviest.

Colour roles, in words: the ground is plain white; panels and the manager calendar sit on a very light grey surface; text is pure black; secondary text is a mid grey dark enough to pass contrast; the accent is a bright warm orange, always carrying black text, and it appears exactly where money changes hands. Three more flat blocks carry meaning and always come with a text tag, so colour is never the only signal: a soft sage green for refundable and cancellation content, an acid yellow for a live hold, and black (with off-white text) for closed nights and outages.

Scale: each heading step is one and a half times the size of the step below it. Body text is small and plain. Every total is set in Chivo at its heaviest weight with figures of equal width, and is always larger than the property name next to it. Density is comfortable: generous space between modules, never cramped rows.

Composition: each screen pairs one enormous capitalised figure or word with small text. Whole modules are flat colour blocks: orange for paying, sage for refundable, acid yellow for a live hold, black for outages. Type changes its horizontal position from section to section instead of using rules or cards. There are no cards, no shadows, no rounded corners (corners are square throughout), no hairline rules, no paper or cream ground, no monospace labels, no index numbering, no glass effects, and no stock lobby photography.

Hero: the word NIGHTS in Chivo's heaviest weight, uppercase, orange on white, so large it is cropped by the left, right and bottom edges of the first screen. The top third holds the small KIPWELL wordmark at the top left, the three header links at the top right, and further down on the left margin the hero sentence with the black-on-orange `Search stays` rectangle beneath it. On a phone the word turns vertical and runs down the right edge, roughly three fifths of the screen width tall per letter. In Arabic the hero word is the Arabic word set in the same heaviest weight, and the whole layout mirrors.

Working screens carry the same language. Result rows have no pictures: the name in bold on the start side, the total in the heaviest weight on the end side, small text for the rest, and a sage block with `Refundable` when it applies. Filters are a column of text toggles with counts. The map is an original drawing of invented coastlines with black price labels; the selected pin turns orange. Checkout is one white column with Night Strip on top, the hold in an acid-yellow band, and `Pay` as the only orange rectangle. The manager calendar is a dense grid of equal-width figures on the light grey surface, with closed nights in black and off-white text. The commission statement is a full-width table in one text size. Empty states are one huge word (`NOTHING`, `SOLD`) with one sentence of help. Outages are a full-width black band with off-white text. Pictures are drawn SVG and appear only large and late on the property page.

Night Strip: a full-width band with one column per night (up to 30) in property-local dates. Each column shows the weekday, the date and that night's amount in equal-width Chivo figures, over a flat block for the rate state with its text tag: sage `Base`, orange `Discount`, acid yellow `Held`, black `Closed`.

Every control people tap is at least 44 by 44 pixels. All text and controls meet WCAG 2.2 AA contrast. Focus is always visible as a thick ring in black on light grounds and in white on black or orange grounds.

### Motion and effects (DP-07, DP-20, DP-28)

Motion only explains a change of state; there are no decorative or looping animations anywhere. Each named motion runs through the browser's Web Animations interface with the `id` given here, so it can be read from the element's running animations. All three start quickly and settle softly.

| Motion | `id` | Duration | What it shows |
|---|---|---|---|
| A bottom sheet opens | `sheet-open` | 240 milliseconds | The sheet rises from below the window edge to its resting place. |
| The gallery moves one picture | `gallery-slide` | 240 milliseconds | The current picture slides out toward the previous side as the next slides in. |
| A Night Strip night expands | `night-expand` | 320 milliseconds | The column widens to show its price lines while the neighbouring columns shift aside. One expansion per Enter press. |

Pressing a button darkens or inverts it for as long as it is held. Hovering a result row or a pin underlines the name or inverts the pin. Hold countdown seconds change in place with no motion.

Under reduced motion, none of these animations is created: sheets appear in place, the gallery jumps to the next picture, and Night Strip columns expand and collapse at once. The end state, the `data-` attributes, the colour blocks with their text tags and every live-region announcement are the same as with motion.

Forced colours: in forced-colours mode, every focus ring is a solid outline at least 3 pixels thick in the system highlight colour, and a selected date picker day or selected calendar cell is filled with the system highlight colour and its text set in the system highlight text colour, so selection never relies on the colour blocks.

### Feedback states (DP-10, DP-11, DP-13, DP-14, DP-19, DP-22, DP-23, DP-24, DP-26, DP-30, DP-31, DP-33, DP-35, DP-37, DP-39, DP-42, DP-43)

Every live region named here is polite. While any request is in flight, the control that started it has `aria-busy="true"` and is disabled, and `<body data-pending>` counts it.

Per async action:

| Action | Pending | Success | Field error or refusal | Storage outage |
|---|---|---|---|---|
| Search, filter, sort, page, map area | rows region busy | count announced in `status "Search announcements"` (`count.found`) | normalisation notices in `status "Link notice"` | unaffected |
| Destination typing | combobox busy | listbox updates | — | unaffected |
| Date picker load | grid busy | day labels | blocked reason in `status "Date help"` | unaffected |
| Room override | group busy | prices update | advice in `status "Room advice"` | unaffected |
| Reserve (hold) | button busy | hold band appears | sold out opens `alertdialog "Just taken"`; restriction reason in `status "Room advice"` | unaffected |
| Pay | Pay disabled | booking page | `region "Problems"` | unaffected |
| Cancel | dialog busy | `toast.cancelled` in `status "Toast"` | reason in `status "Toast"` | unaffected |
| Change dates | dialog busy | `toast.changed` | reason in the dialog's `region "Problems"` | unaffected |
| Send review | button busy | `toast.review_sent` | field messages | unaffected |
| Publish or reject review | button busy | `toast.published` or `toast.rejected` | — | unaffected |
| Edit nights | Apply busy | `toast.nights_saved` | `region "Problems"` in the dialog | unaffected |
| Import preview | Preview busy | preview table and `import.count` | `list "Import errors"` | unaffected (preview stores nothing) |
| Import apply | Apply busy | `toast.imported` | — | `storage.import` in the black `alert` band; the preview stays and `Apply` retries |
| Invoice, statement download | link busy | download | — | `storage.doc` in the black `alert` band |
| Property pictures | — | pictures | — | `storage.pictures` in place of the gallery |
| Sign in, create account | button busy | redirect | message under the form | unaffected |

Toasts stay for `KIP_TOAST_MS` on page timers.

**Placeholders.** `{n}`, `{m}` whole numbers in Western digits. `{amount}` a money amount through the language's currency formatter (`Intl.NumberFormat` with locale `en-GB`, `de-DE` or `ar-KW`, numbering system `latn`, currency style, the currency's own decimals). `{date}` a calendar date in the long date form: `Intl.DateTimeFormat` with weekday long, day numeric, month long, year numeric, numbering system `latn`, in the property's zone (for example `Saturday 13 March 2027` in English). `{day month}` the same with only day numeric and month long; `{weekday day month}` with weekday long, day numeric, month long; `{month year}` with month long and year numeric. `{moment}` an instant with weekday long, day numeric, month long, year numeric, hour and minute two-digit on a 24-hour clock, in the zone named by the sentence. `{zone}` the property's IANA zone id, for example `Europe/Lisbon`. `{score}` and `{distance}` one decimal in the language's number format. `{count:noun}` the counted phrase below. `{currency words}` from the currency words table. `{field label}` the visible label of the field in the page's language. `{code}` a booking code. `{in}` and `{out}` the chosen arrival and departure dates in `{day month}` form in the property's zone (on a search, the destination's zone, which its properties share). `{old}` and `{new}` in `price.changed` and `price.refreshed` are the quote's previous and current converted totals as `{amount}` in the quote's currency; in `import.row` they are the night's previous and new refundable base rate as `{amount}` in EUR. `{tier}` the tier name `Wren`, `Heron` or `Kestrel`, the same in every language. `{p}` the refund percentage as a whole number. `{a}` the name typed for the season being saved; `{b}` and `{season}` the existing season's name; in `season.overlap`, `{from}` and `{to}` are the first and last shared nights in `{date}` form. In `import.order`, `{from}` and `{to}` are FROM and TO as written in the file; on a histogram bar they are whole euros (Business rules, Search results). `{x}` and `{value}` the offending value as written. `{name}` is the parameter name as written in `notice.ignored` and `notice.reset`, the room type name in `advice.left`, and the property name in result rows, pins and map buttons. `{room}` a room type code. `{iso date}` a `YYYY-MM-DD` date. `{reason}` the full reason message from the `reason.*` keys, final full stop included. `{label}` a price line label. `{stars}` the star count, `{i}` the picture's position from 1, `{id}` the review id as the API returns it. `{last4}` the card's last 4 digits. `{property name}` and `{room type name}` the seeded names. `{moment in property zone}` and `{moment in browser zone}` are `{moment}` in the property's zone and in the browser's own `Intl` zone. Language, plural and number rules are owned by Business rules (Languages).

**Counted phrases** (plural category by `Intl.PluralRules` for the language):

| Noun | en one | en other | de one | de other | ar zero | ar one | ar two | ar few | ar many | ar other |
|---|---|---|---|---|---|---|---|---|---|---|
| property | {n} property | {n} properties | {n} Unterkunft | {n} Unterkünfte | لا توجد أماكن إقامة | مكان إقامة واحد | مكانان للإقامة | {n} أماكن إقامة | {n} مكان إقامة | {n} مكان إقامة |
| night | {n} night | {n} nights | {n} Nacht | {n} Nächte | {n} ليلة | ليلة واحدة | ليلتان | {n} ليالٍ | {n} ليلة | {n} ليلة |
| day | {n} day | {n} days | {n} Tag | {n} Tage | {n} يوم | يوم واحد | يومان | {n} أيام | {n} يومًا | {n} يوم |
| minute | {n} more minute | {n} more minutes | noch {n} Minute | noch {n} Minuten | {n} دقيقة | دقيقة واحدة | دقيقتان | {n} دقائق | {n} دقيقة | {n} دقيقة |
| problem | {n} problem | {n} problems | {n} Problem | {n} Probleme | {n} مشكلة | مشكلة واحدة | مشكلتان | {n} مشكلات | {n} مشكلة | {n} مشكلة |
| stay | {n} completed stay | {n} completed stays | {n} abgeschlossener Aufenthalt | {n} abgeschlossene Aufenthalte | {n} إقامة مكتملة | إقامة مكتملة واحدة | إقامتان مكتملتان | {n} إقامات مكتملة | {n} إقامة مكتملة | {n} إقامة مكتملة |

**Currency words:**

| Code | en | de | ar |
|---|---|---|---|
| EUR | euros | Euro | يورو |
| USD | US dollars | US-Dollar | دولار أمريكي |
| JPY | yen | Yen | ين ياباني |
| KWD | Kuwaiti dinars | Kuwait-Dinar | دينار كويتي |

**Messages.** Every status sentence, reason, error and notice, by key:

| Key | en | de | ar |
|---|---|---|---|
| `count.found` | `{count:property} found` | `{count:property} gefunden` | `{count:property}` |
| `hold.minutes` | `Your room is held for {count:minute}` | `Ihr Zimmer ist {count:minute} reserviert` | `يبقى حجز غرفتك {count:minute}` |
| `hold.ended` | `The rooms are back on sale.` | `Die Zimmer sind wieder buchbar.` | `عادت الغرف إلى البيع.` |
| `price.changed` | `The total changed from {old} to {new}.` | `Der Gesamtpreis hat sich von {old} auf {new} geändert.` | `تغير الإجمالي من {old} إلى {new}.` |
| `price.refreshed` | `Your quote expired. The total is still {new}.` | `Ihr Angebot ist abgelaufen. Der Gesamtpreis bleibt {new}.` | `انتهت صلاحية عرض السعر. لا يزال الإجمالي {new}.` |
| `just.taken` | `Someone else just took the last room.` | `Jemand anderes hat gerade das letzte Zimmer genommen.` | `حجز شخص آخر الغرفة الأخيرة للتو.` |
| `reason.release` | `Booking closes {count:day} before arrival.` | `Die Buchung schließt {count:day} vor der Anreise.` | `يغلق الحجز قبل الوصول بمدة {count:day}.` |
| `reason.no_arrival` | `No arrivals on {date}.` | `Keine Anreise am {date}.` | `لا وصول في {date}.` |
| `reason.no_departure` | `No departures on {date}.` | `Keine Abreise am {date}.` | `لا مغادرة في {date}.` |
| `reason.min_stay` | `Minimum stay is {count:night} from {date}.` | `Mindestaufenthalt ab {date}: {count:night}.` | `الحد الأدنى للإقامة {count:night} من {date}.` |
| `reason.max_stay` | `Maximum stay is {count:night} from {date}.` | `Höchstaufenthalt ab {date}: {count:night}.` | `الحد الأقصى للإقامة {count:night} من {date}.` |
| `reason.stop_sell` | `Not on sale on {date}.` | `Am {date} nicht buchbar.` | `غير متاح للبيع في {date}.` |
| `reason.sold_out` | `Sold out on {date}.` | `Am {date} ausgebucht.` | `نفدت الغرف في {date}.` |
| `day.available` | `{date}, available, from {n} {currency words}, minimum stay {count:night}` | `{date}, verfügbar, ab {n} {currency words}, Mindestaufenthalt {count:night}` | `{date}، متاح، من {n} {currency words}، الحد الأدنى للإقامة {count:night}` |
| `day.blocked` | `{date}, not available, {reason}` | `{date}, nicht verfügbar, {reason}` | `{date}، غير متاح، {reason}` |
| `day.before` | `{date}, not available, before your arrival` | `{date}, nicht verfügbar, vor Ihrer Anreise` | `{date}، غير متاح، قبل وصولك` |
| `day.short` | `{date}, not available, too short, minimum stay {count:night}` | `{date}, nicht verfügbar, zu kurz, Mindestaufenthalt {count:night}` | `{date}، غير متاح، مدة قصيرة جدًا، الحد الأدنى للإقامة {count:night}` |
| `date.start` | `Pick your arrival date.` | `Wählen Sie Ihr Anreisedatum.` | `اختر تاريخ وصولك.` |
| `date.end` | `Minimum stay from {date} is {count:night}. Pick your departure date.` | `Mindestaufenthalt ab {date}: {count:night}. Wählen Sie Ihr Abreisedatum.` | `الحد الأدنى للإقامة من {date} هو {count:night}. اختر تاريخ مغادرتك.` |
| `notice.ignored` | `Ignored {name}.` | `{name} ignoriert.` | `تم تجاهل {name}.` |
| `notice.arrival` | `Arrival moved to {date}.` | `Anreise auf {date} verschoben.` | `نُقل الوصول إلى {date}.` |
| `notice.departure` | `Departure moved to {date}.` | `Abreise auf {date} verschoben.` | `نُقلت المغادرة إلى {date}.` |
| `notice.adults` | `Adults set to {n}.` | `Erwachsene auf {n} gesetzt.` | `تم ضبط عدد البالغين على {n}.` |
| `notice.age` | `Removed child age {value}.` | `Kinderalter {value} entfernt.` | `تمت إزالة عمر الطفل {value}.` |
| `notice.reset` | `Reset {name}.` | `{name} zurückgesetzt.` | `تمت إعادة ضبط {name}.` |
| `notice.swapped` | `Price range swapped.` | `Preisspanne getauscht.` | `تم تبديل نطاق السعر.` |
| `advice.capacity` | `These rooms sleep {n}. Your party is {m}.` | `Diese Zimmer bieten Platz für {n}. Ihre Gruppe umfasst {m}.` | `تتسع هذه الغرف لـ {n}. عدد مجموعتك {m}.` |
| `advice.adult` | `Each room needs an adult.` | `Jedes Zimmer braucht einen Erwachsenen.` | `تحتاج كل غرفة إلى شخص بالغ.` |
| `advice.left` | `Only {n} left of {name}.` | `Nur noch {n} frei: {name}.` | `تبقى {n} فقط من {name}.` |
| `problems.heading` | one: `There is 1 problem`; other: `There are {count:problem}` | `Es gibt {count:problem}` | `توجد {count:problem}` |
| `field.given` | `Enter your given name.` | `Geben Sie Ihren Vornamen ein.` | `أدخل اسمك الأول.` |
| `field.surname` | `Enter your surname.` | `Geben Sie Ihren Nachnamen ein.` | `أدخل اسم عائلتك.` |
| `field.card` | `Enter a card number.` | `Geben Sie eine Kartennummer ein.` | `أدخل رقم بطاقة.` |
| `field.expiry` | `Enter a date as MM/YY.` | `Geben Sie ein Datum als MM/JJ ein.` | `أدخل التاريخ بصيغة MM/YY.` |
| `field.code` | `Enter a 3-digit code.` | `Geben Sie einen 3-stelligen Code ein.` | `أدخل رمزًا من 3 أرقام.` |
| `card.unknown` | `Use a test card from the published table.` | `Verwenden Sie eine Testkarte aus der veröffentlichten Tabelle.` | `استخدم بطاقة اختبار من الجدول المنشور.` |
| `card.declined` | `Your card was declined. Try another card.` | `Ihre Karte wurde abgelehnt. Versuchen Sie eine andere Karte.` | `رُفضت بطاقتك. جرّب بطاقة أخرى.` |
| `card.expired` | `This card has expired.` | `Diese Karte ist abgelaufen.` | `انتهت صلاحية هذه البطاقة.` |
| `card.wrong_code` | `That code is wrong.` | `Dieser Code ist falsch.` | `هذا الرمز غير صحيح.` |
| `find.none` | `We couldn't find that booking.` | `Wir konnten diese Buchung nicht finden.` | `لم نتمكن من العثور على هذا الحجز.` |
| `deadline.line` | `Until {moment in property zone} {zone} ({moment in browser zone} your time)` | `Bis {moment in property zone} {zone} ({moment in browser zone} Ihre Zeit)` | `حتى {moment in property zone} {zone} ({moment in browser zone} بتوقيتك)` |
| `tier.free` | `Free cancellation` | `Kostenlose Stornierung` | `إلغاء مجاني` |
| `tier.partial` | `{p}% refund` | `{p}% Erstattung` | `استرداد {p}%` |
| `tier.nonrefundable` | `Nonrefundable` | `Nicht erstattbar` | `غير قابل للاسترداد` |
| `refund.free` | `Free cancellation until {moment in property zone}.` | `Kostenlose Stornierung bis {moment in property zone}.` | `إلغاء مجاني حتى {moment in property zone}.` |
| `refund.partial` | `{p}% refund until {moment in property zone}.` | `{p}% Erstattung bis {moment in property zone}.` | `استرداد {p}% حتى {moment in property zone}.` |
| `refund.none` | `No refund now.` | `Derzeit keine Erstattung.` | `لا يوجد استرداد الآن.` |
| `refund.amount` | `Refund: {amount}` | `Erstattung: {amount}` | `المبلغ المسترد: {amount}` |
| `change.new_total` | `New total: {amount}` | `Neuer Gesamtpreis: {amount}` | `الإجمالي الجديد: {amount}` |
| `change.paid` | `Already paid: {amount}` | `Bereits bezahlt: {amount}` | `المدفوع مسبقًا: {amount}` |
| `change.pay` | `You pay: {amount}` | `Sie zahlen: {amount}` | `تدفع: {amount}` |
| `change.nonrefundable` | `Nonrefundable stays can't be changed.` | `Nicht erstattbare Aufenthalte können nicht geändert werden.` | `لا يمكن تغيير الإقامات غير القابلة للاسترداد.` |
| `change.not_now` | `This stay can't be changed now.` | `Dieser Aufenthalt kann jetzt nicht geändert werden.` | `لا يمكن تغيير هذه الإقامة الآن.` |
| `review.early` | `You can review after your stay ends.` | `Sie können nach Ihrem Aufenthalt bewerten.` | `يمكنك التقييم بعد انتهاء إقامتك.` |
| `review.closed` | `This review window has closed.` | `Der Bewertungszeitraum ist abgelaufen.` | `انتهت فترة التقييم.` |
| `review.used` | `You already reviewed this stay.` | `Sie haben diesen Aufenthalt bereits bewertet.` | `لقد قيّمت هذه الإقامة بالفعل.` |
| `review.score_range` | `Choose a score from 1 to 10.` | `Wählen Sie eine Bewertung von 1 bis 10.` | `اختر تقييمًا من 1 إلى 10.` |
| `loyalty.line` | `{tier}: {count:stay}` | `{tier}: {count:stay}` | `{tier}: {count:stay}` |
| `perk.late` | `Free late checkout` | `Kostenloser später Check-out` | `تسجيل خروج متأخر مجاني` |
| `perk.drink` | `Welcome drink` | `Begrüßungsgetränk` | `مشروب ترحيبي` |
| `edit.max_below_min` | `Maximum stay must not be below minimum stay.` | `Der Höchstaufenthalt darf nicht unter dem Mindestaufenthalt liegen.` | `يجب ألا يقل الحد الأقصى للإقامة عن الحد الأدنى.` |
| `edit.rate_min` | `Rate must be at least 1.` | `Der Preis muss mindestens 1 betragen.` | `يجب أن يكون السعر 1 على الأقل.` |
| `edit.rooms_sold` | `Rooms can't be below the {n} already sold.` | `Die Zimmerzahl darf nicht unter den {n} bereits verkauften liegen.` | `لا يمكن أن يقل عدد الغرف عن {n} المباعة بالفعل.` |
| `edit.season_name` | `Enter a season name.` | `Geben Sie einen Saisonnamen ein.` | `أدخل اسم الموسم.` |
| `season.overlap` | `Season {a} overlaps {b} from {from} to {to}.` | `Saison {a} überschneidet sich mit {b} vom {from} bis {to}.` | `الموسم {a} يتداخل مع {b} من {from} إلى {to}.` |
| `import.header` | `Line {n}: this file must start with KIPRATES 1.` | `Zeile {n}: Diese Datei muss mit KIPRATES 1 beginnen.` | `السطر {n}: يجب أن يبدأ هذا الملف بـ KIPRATES 1.` |
| `import.fields` | `Line {n}: expected 8 fields, found {m}.` | `Zeile {n}: 8 Felder erwartet, {m} gefunden.` | `السطر {n}: المتوقع 8 حقول، وُجد {m}.` |
| `import.room` | `Line {n}: unknown room {x}.` | `Zeile {n}: unbekanntes Zimmer {x}.` | `السطر {n}: غرفة غير معروفة {x}.` |
| `import.plan` | `Line {n}: unknown plan {x}.` | `Zeile {n}: unbekannter Tarif {x}.` | `السطر {n}: خطة غير معروفة {x}.` |
| `import.date` | `Line {n}: bad date {x}.` | `Zeile {n}: ungültiges Datum {x}.` | `السطر {n}: تاريخ غير صالح {x}.` |
| `import.order` | `Line {n}: {from} is after {to}.` | `Zeile {n}: {from} liegt nach {to}.` | `السطر {n}: {from} بعد {to}.` |
| `import.weekdays` | `Line {n}: bad weekdays {x}.` | `Zeile {n}: ungültige Wochentage {x}.` | `السطر {n}: أيام أسبوع غير صالحة {x}.` |
| `import.rate` | `Line {n}: rate must be a whole number above 0.` | `Zeile {n}: Der Preis muss eine ganze Zahl über 0 sein.` | `السطر {n}: يجب أن يكون السعر عددًا صحيحًا أكبر من 0.` |
| `import.limits` | `Line {n}: bad stay limits {x}.` | `Zeile {n}: ungültige Aufenthaltsgrenzen {x}.` | `السطر {n}: حدود إقامة غير صالحة {x}.` |
| `import.overlap` | `Line {n}: overlaps line {m}.` | `Zeile {n}: überschneidet sich mit Zeile {m}.` | `السطر {n}: يتداخل مع السطر {m}.` |
| `import.too_large` | `This file is larger than {n} bytes.` | `Diese Datei ist größer als {n} Bytes.` | `هذا الملف أكبر من {n} بايت.` |
| `import.row` | `{room} {iso date} {old} to {new}` | `{room} {iso date} {old} bis {new}` | `{room} {iso date} {old} إلى {new}` |
| `import.count` | `{count:night} will change.` | `Änderungen: {count:night}.` | `ستتغير {count:night}.` |
| `storage.import` | `Storage is unavailable. Your file was not saved. Try again.` | `Der Speicher ist nicht verfügbar. Ihre Datei wurde nicht gespeichert. Versuchen Sie es erneut.` | `التخزين غير متاح. لم يُحفظ ملفك. حاول مرة أخرى.` |
| `storage.doc` | `Storage is unavailable. Try again.` | `Der Speicher ist nicht verfügbar. Versuchen Sie es erneut.` | `التخزين غير متاح. حاول مرة أخرى.` |
| `storage.pictures` | `Pictures are unavailable right now.` | `Bilder sind gerade nicht verfügbar.` | `الصور غير متاحة حاليًا.` |
| `signin.failed` | `That username and password don't match.` | `Benutzername und Passwort passen nicht zusammen.` | `اسم المستخدم وكلمة المرور غير متطابقين.` |
| `signup.username` | `Use 3 to 24 lower-case letters, digits or _.` | `Verwenden Sie 3 bis 24 Kleinbuchstaben, Ziffern oder _.` | `استخدم من 3 إلى 24 حرفًا صغيرًا أو رقمًا أو _.` |
| `signup.password` | `Use at least 8 characters.` | `Verwenden Sie mindestens 8 Zeichen.` | `استخدم 8 أحرف على الأقل.` |
| `signup.taken` | `That username is taken.` | `Dieser Benutzername ist vergeben.` | `اسم المستخدم هذا مستخدم بالفعل.` |
| `signed.out` | `You were signed out.` | `Sie wurden abgemeldet.` | `تم تسجيل خروجك.` |
| `rate.limited` | `Too many tries. Wait a minute and try again.` | `Zu viele Versuche. Warten Sie eine Minute und versuchen Sie es erneut.` | `محاولات كثيرة جدًا. انتظر دقيقة ثم حاول مرة أخرى.` |
| `toast.cancelled` | `Cancelled. Refund: {amount}` | `Storniert. Erstattung: {amount}` | `تم الإلغاء. المبلغ المسترد: {amount}` |
| `toast.changed` | `Dates changed.` | `Daten geändert.` | `تم تغيير التواريخ.` |
| `toast.review_sent` | `Thanks. Your review is waiting for moderation.` | `Danke. Ihre Bewertung wartet auf Prüfung.` | `شكرًا. تقييمك بانتظار المراجعة.` |
| `toast.published` | `Review published.` | `Bewertung veröffentlicht.` | `تم نشر التقييم.` |
| `toast.rejected` | `Review rejected.` | `Bewertung abgelehnt.` | `تم رفض التقييم.` |
| `toast.nights_saved` | `Nights updated.` | `Nächte aktualisiert.` | `تم تحديث الليالي.` |
| `toast.imported` | `Rates imported.` | `Preise importiert.` | `تم استيراد الأسعار.` |
| `empty.results.word` | `NOTHING` | `NICHTS` | `لا شيء` |
| `empty.results` | `No stays match. Remove a filter or change your dates.` | `Keine Unterkünfte passen. Entfernen Sie einen Filter oder ändern Sie Ihre Daten.` | `لا توجد إقامات مطابقة. أزل عامل تصفية أو غيّر تواريخك.` |
| `empty.sold.word` | `SOLD` | `AUSGEBUCHT` | `مباع` |
| `empty.sold` | `Every room is taken for these dates.` | `Alle Zimmer sind für diese Daten vergeben.` | `جميع الغرف محجوزة لهذه التواريخ.` |
| `inbox.empty` | `No messages yet.` | `Noch keine Nachrichten.` | `لا توجد رسائل بعد.` |
| `moderation.empty` | `No reviews are waiting.` | `Keine Bewertungen warten.` | `لا توجد تقييمات بانتظار المراجعة.` |
| `page.missing` | `We couldn't find that page.` | `Wir konnten diese Seite nicht finden.` | `لم نتمكن من العثور على هذه الصفحة.` |
| `page.forbidden` | `You don't have access to this page.` | `Sie haben keinen Zugriff auf diese Seite.` | `ليس لديك صلاحية الوصول إلى هذه الصفحة.` |
| `invoice.paid_by` | `Paid by card ending {last4}` | `Bezahlt mit Karte mit Endziffern {last4}` | `مدفوع ببطاقة تنتهي بـ {last4}` |

**Home copy:**

| Key | en | de | ar |
|---|---|---|---|
| `hero.word` | `NIGHTS` | `NÄCHTE` | `ليالٍ` |
| `hero.sentence` | `Every night priced in the open, every tax shown, every refund to the cent.` | `Jede Nacht offen berechnet, jede Steuer sichtbar, jede Erstattung auf den Cent.` | `كل ليلة مسعّرة بوضوح، وكل ضريبة ظاهرة، وكل استرداد حتى آخر سنت.` |
| `home.layers` | `Rate by night`, `Party and discounts`, `Breakfast`, `VAT`, `City tax and levy` | `Preis pro Nacht`, `Gruppe und Rabatte`, `Frühstück`, `MwSt.`, `Kurtaxe und Abgabe` | `السعر لكل ليلة`، `المجموعة والخصومات`، `الإفطار`، `ضريبة القيمة المضافة`، `ضريبة المدينة والرسوم` |
| `home.cancel` | `Each stay shows its cancellation deadlines in the property's own clock and in yours, and the refund we show is the refund you get.` | `Jeder Aufenthalt zeigt seine Stornofristen in der Ortszeit der Unterkunft und in Ihrer, und die angezeigte Erstattung ist die Erstattung, die Sie erhalten.` | `تعرض كل إقامة مواعيد الإلغاء بتوقيت مكان الإقامة وبتوقيتك، والمبلغ المسترد الذي نعرضه هو ما تحصل عليه.` |
| `home.commission` | `9%` with `Commission on net room revenue, printed on every statement.` | `Provision auf den Netto-Zimmerumsatz, auf jeder Abrechnung ausgewiesen.` | `عمولة على صافي إيرادات الغرف، مطبوعة في كل كشف.` |
| `home.reviews` | `180` with `Days for a review's weight to halve, so recent stays count most.` | `Tage, bis sich das Gewicht einer Bewertung halbiert, damit neue Aufenthalte am meisten zählen.` | `يومًا حتى يتناقص وزن التقييم إلى النصف، لتكون الإقامات الحديثة الأكثر تأثيرًا.` |

Several notice sentences in `status "Link notice"` are joined with one space, in the order of the normalisation table. The Problems link for a card outcome is `{Card number label}: {message}`. A refusal with no field of its own (a restriction reason on Pay or in `dialog "Change dates"`, `change.nonrefundable`, `change.not_now`) is listed as `{Dates label}: {message}` with the language's `Dates` label (`Dates`, `Reisedaten`, `التواريخ`); following it focuses the first night button of Night Strip on the checkout page, or the focused day of the grid in `dialog "Change dates"`. In `dialog "Edit nights"`, `edit.rate_min` uses the `Rate` label, `edit.rooms_sold` `Rooms`, `edit.max_below_min` `Maximum stay`, and `edit.season_name` and `season.overlap` `Season name`. A not-found page shows the huge word `NOTHING` with `page.missing`; a no-access page shows `page.forbidden`.

## Backend

### API (DP-02, DP-03, DP-04, DP-13, DP-14, DP-17, DP-22, DP-23, DP-30, DP-31, DP-33, DP-35, DP-37, DP-39, DP-42, DP-44, DP-45, DP-46)

All API routes are under `/api`, take and return `application/json; charset=utf-8` unless stated, and use ISO 8601 UTC instants with milliseconds (`2027-03-01T09:00:00.000Z`) and `YYYY-MM-DD` dates. All money fields end in `_minor` and are integers.

**Error shape.** Every error body is JSON with an `error` code and, where stated, more fields: `{"error":"validation","fields":{"<field>":"<code>"}}` with field codes `required`, `invalid`, `too_long`, `out_of_range`, or a message key from Feedback states; `{"error":"restricted","reason":{"code":"<reason code>","date":"YYYY-MM-DD","n":<n>}}` where `code` is one of `release`, `no_arrival`, `no_departure`, `min_stay`, `max_stay`, `stop_sell`, `sold_out` and `date`/`n` appear when the reason has them.

**Error order (one rule for the whole API).** Checks run in this order and the first failure answers: 413 or 415 (transport, Server boundary), 429 rate limit, 401 not signed in or no visitor where needed, 404 unknown resource or one belonging to another guest, another manager's property or another visitor (it is hidden), then a stored repeat-request response is replayed if the request carries a known `Idempotency-Key`, then 403 forbidden (the caller can see the resource but their role, or the moment, does not allow the action), 410 gone (hold, quote or review window over), 409 conflict with the current state, 422 invalid input or a broken restriction, 402 card outcome. Endpoint rows list only their own codes.

**Core**

| Method and path | Request | Success | Errors |
|---|---|---|---|
| `GET /api/health` | — | 200 `{"status":"ok"}`, or 200 `{"status":"unavailable"}` while storage is unreachable | 503 `{"status":"starting"}` until Postgres is reached |
| `GET /api/time` | — | 200 `{"now":"<instant>"}`; sets `kip_visitor` if missing | — |
| `GET /api/events` | — | 200 `text/event-stream` (Business rules, Live events) | — |
| `GET /api/currency` | — | 200 `{"EUR":1000000,"USD":…,"JPY":…,"KWD":…}` | — |
| `GET /api/destinations?q=<text>` | — | 200 `[{"code","name","zone","cx","cy","property_count"}]` ordered by name | — |

**Accounts**

| Method and path | Request | Success | Errors |
|---|---|---|---|
| `POST /api/signup` | `{"username","password"}` | 201 `{"username","role":"guest"}` and signs in | 422 fields `signup.username` or `signup.password`; 409 `{"error":"username_taken"}` |
| `POST /api/signin` | `{"username","password"}` | 200 `{"username","role","manages":["<code>"]}` | 401 `{"error":"bad_credentials"}`; 429 per username |
| `POST /api/signout` | — | 204 | — |
| `POST /api/signout-everywhere` | — | 204 | 401 |
| `GET /api/me` | — | 200 `{"user":{"username","role","manages"}|null,"lang","cur","tier","completed_stays","perks":[…]}` | — |
| `PATCH /api/me/preferences` | `{"lang"?,"cur"?}` | 200 same as `GET /api/me` | 422 fields |
| `GET /api/inbox` | — | 200 `[{"id","at","kind":"review","property","link"}]` newest first | — |

**Search and properties**

| Method and path | Request | Success | Errors |
|---|---|---|---|
| `GET /api/search?<search link parameters>` | query string | 200 `{"canonical":"<query string>","notices":[{"key","name"?,"date"?,"n"?,"value"?}],"count","results":[{"code","name","stars","score","distance_km","x","y","total_minor","avg_night_minor","display_minor","display_currency","refundable","rank"}],"counts":{"stars":{"3","4","5"},"amen":{"pool","parking","wifi","spa","pets"},"free"},"histogram":[{"from_minor","count"}],"pins":[{"code","name","x","y","score","display_minor"}],"next_cursor":"<cursor>"|null}` | 429 per visitor |
| `GET /api/dates?dest=<code>` or `?property=<code>`, `&from&to&cur&lang`, optional `&start` | — | 200 `{"days":[{"date","available","from_minor","min_stay","reason":{…}|null,"after_start":"before"|"short"|null}]}` | 404 |
| `GET /api/properties/<code>?in&out&adults&ages&cur` | — | 200 `{"code","name","zone","stars","amenities","score","distance_km","pictures","policy":[…],"room_types":[{"code","name","max_adults","max_guests","left"}],"recommendation":{"rooms":[{"room_type","adults","ages"}],"total_minor"}|null}` | 404 |
| `POST /api/allocations` | `{"property","in","out","adults","ages","counts":{"<room type>":<n>}}` | 200 `{"rooms":[{"room_type","adults","ages"}],"total_minor"}` | 422 `{"error":"room_advice","advice":{"code":"capacity"|"adult"|"left","n","m"?,"room_type"?}}` |
| `GET /images/<code>/<n>.svg` | — | 200 `image/svg+xml` read from storage | 404; 503 `{"error":"storage_unavailable"}` |

**Quotes, holds and bookings**

| Method and path | Request | Success | Errors |
|---|---|---|---|
| `POST /api/quotes` | `{"property","in","out","currency","adults"?,"ages"?,"rooms"?:[{"room_type","plan":"refundable"|"nonrefundable","breakfast":bool,"adults","ages"}],"hold_id"?}`; without `rooms` the recommendation with the refundable plan and no breakfast | 201 quote object | 401; 404; 422 fields or restricted |
| `GET /api/quotes/<id>` | — | 200 quote object | 404 |
| `POST /api/holds` | `{"quote_id"}` | 201 `{"id","quote_id","expires_at","rooms":[…]}` | 401; 404; 410 `{"error":"quote_expired"}`; 409 `{"error":"sold_out","date"}`; 422 restricted |
| `DELETE /api/holds/<id>` | — | 204 | 404 |
| `POST /api/bookings` | header `Idempotency-Key`; `{"hold_id","quote_id","given_name","surname","card_number","expiry","security_code","step_up_code"?}` | 201 booking object; a replay answers 200 with the same body | 401; 404 hold or quote not the caller's; 410 `{"error":"hold_expired"}`; 409 `{"error":"price_changed","old_total_minor","new_total_minor"}` or `{"error":"idempotency_conflict"}`; 422 fields or restricted; 402 `{"error":"card","outcome":"declined"|"expired"|"unknown"|"step_up"|"wrong_code"}` |
| `GET /api/bookings/<code>` | — | 200 booking object, header `ETag: "<version>"` | 404 |
| `POST /api/bookings/find` | `{"code","surname"}` | 200 `{"code"}` | 404 `{"error":"not_found"}`; 429 per visitor |
| `GET /api/bookings/<code>/cancellations/preview?rooms=1,2` | — | 200 `{"refund_minor","refund_pct"}` | 404; 409 `{"error":"invalid_state"}` |
| `POST /api/bookings/<code>/cancellations` | header `If-Match: "<version>"`; `{"rooms":[1,2]}` | 201 `{"refund_minor","booking":{…}}` | 404; 409 `{"error":"version_conflict"}` or `invalid_state`; 422 fields |
| `POST /api/bookings/<code>/changes/preview` | `{"in","out"}` | 200 `{"new_total_minor","paid_minor","pay_minor"|"refund_minor"}` | 404; 409 `invalid_state`; 422 restricted or `{"error":"nonrefundable"}` |
| `POST /api/bookings/<code>/changes` | headers `If-Match`, `Idempotency-Key`; `{"in","out","card_number"?,"expiry"?,"security_code"?,"step_up_code"?}` | 200 booking object; a replay with the same key and body answers 200 with the stored body (a stored 402 replays as the same 402) | 404; 409 `version_conflict`, `invalid_state`, `idempotency_conflict`; 422 restricted, `nonrefundable` or fields; 402 card |
| `POST /api/bookings/<code>/no-show` | header `If-Match` | 200 booking object | 404; 403 `{"error":"forbidden"}`; 409 `{"error":"too_early"}`, `invalid_state`, `version_conflict` |
| `GET /bookings/<code>/invoice` | — | 200 `text/html` read from storage (also the `Invoice` link target) | 404; 503 HTML page with `storage.doc` |

Quote object: `{"id","property","in","out","nights_count","currency","tier","rates_ppm":{…},"rooms":[{"room_type","plan","breakfast","adults","ages","nights":[{"date","lines":[{"key","minor"}],"total_minor","taxable_minor"}],"total_minor"}],"nights":[{"date","total_minor","taxable_minor","converted_minor","converted_taxable_minor","state"}],"total_minor","taxable_minor","converted_total_minor","converted_taxable_minor","expires_at","hold_id"}`. Line keys, in order: `plan_rate`, `occupancy`, `children`, `length_of_stay`, `early_booking`, `last_minute`, `loyalty`, `breakfast`, `vat`, `city_tax`, `tourism_levy`, `night_total`; zero lines are left out. `state` is `base`, `discount`, `held` or `closed`.

Booking object: `{"code","version","state","property":{"code","name","zone"},"in","out","given_name","surname","card_last4","quote_currency","rooms":[{"n","room_type","plan","breakfast","adults","ages","state","paid_minor","refunded_minor","nights":[…]}],"total_minor","paid_minor","refunded_minor","cancellation":{"tiers":[{"refund_pct","deadline_utc","deadline_local"}],"status":{"kind":"free"|"partial"|"none","refund_pct","until_utc"|null}},"no_show_open","ledger":[{"id","pair","kind":"charge"|"refund"|"change","account":"guest"|"property","debit_minor","credit_minor","at"}],"balance_minor"}`. `deadline_local` is `YYYY-MM-DDTHH:mm` in the property's zone.

**Reviews and moderation**

| Method and path | Request | Success | Errors |
|---|---|---|---|
| `GET /api/reviews/<token>` | — | 200 `{"property","in","out","open_until"}` | 404; 403 `{"error":"too_early"}`; 410 `{"error":"window_closed"}`; 409 `{"error":"already_reviewed"}` |
| `POST /api/reviews/<token>` | `{"cleanliness","comfort","location","staff","value","comment"}` | 201 `{"id","state":"pending"}` | as GET; 422 fields (`review.score_range`, comment over 2,000 characters `too_long`) |
| `GET /api/moderation/reviews` | — | 200 pending reviews, oldest first | 401; 403 |
| `POST /api/moderation/reviews/<id>/publish` and `/reject` | — | 200 `{"id","state"}` | 401; 404; 403; 409 `{"error":"not_pending"}` |

**Manager** (the caller must be signed in; a property they do not manage answers 404)

| Method and path | Request | Success | Errors |
|---|---|---|---|
| `GET /api/manage/<code>/calendar?from=<date>&days=28` | — | 200 `{"room_types":[…],"cells":[{"room_type","date","rate_minor","allotment","left","min_stay","max_stay","closed_to_arrival","closed_to_departure","stop_sell","release_days"}]}` | 401; 404 |
| `PATCH /api/manage/<code>/nights` | `{"room_types":[…],"from","to","weekdays":[1..7 with 1 Monday],"rate_minor"?,"rooms"?,"min_stay"?,"max_stay"?,"closed_to_arrival"?,"closed_to_departure"?,"stop_sell"?,"season_name"?,"replace"?}` | 200 `{"changed_nights","season":{"name"}|null}` | 401; 404; 409 `{"error":"season_overlap","season","other","from","to"}`; 422 fields with `edit.*` keys (`rooms_sold` carries `n`) |
| `GET /api/manage/<code>/reservations` | — | 200 `[{"code","surname","arrival","departure","rooms","total_minor","state"}]` | 401; 404 |
| `GET /api/manage/<code>/reservations.csv` | — | 200 `text/csv; charset=utf-8` | 401; 404 |
| `POST /api/manage/<code>/imports/preview` | raw file bytes, `text/plain` or `application/octet-stream` | 200 `{"sha256","changes":[{"room","date","old_minor","new_minor"}],"count"}` | 401; 404; 413 `{"error":"too_large"}`; 422 `{"error":"import_invalid","lines":[{"line","key","params"}]}` |
| `POST /api/manage/<code>/imports` | the same raw bytes | 201 `{"sha256","count","key"}` | as preview; 503 `{"error":"storage_unavailable"}` |
| `GET /api/manage/<code>/statements/<yyyy-mm>` | — | 200 `{"month","lines":[{"code","kind":"stay"|"cancellation","base_minor","commission_minor"}],"total_base_minor","total_commission_minor","downloadable"}` | 401; 404 |
| `GET /api/manage/<code>/statements/<yyyy-mm>.csv` | — | 200 `text/csv` read from storage | 401; 404; 409 `{"error":"month_open"}`; 503 `{"error":"storage_unavailable"}` |

**Grading routes** (only when `KIP_GRADING=1`; otherwise each answers 404 `{"error":"not_found"}`)

- `POST /api/grading/seed` with any of these keys; every key and field not marked required is optional:

```json
{
  "users": [{"username": "g1", "password": "secret-pass", "role": "guest|manager|operator",
             "manages": ["P1"], "completed_stays": [{"property": "P1", "checkout": "2027-01-10"}]}],
  "destinations": [{"code": "d1", "name": "Brineholm", "zone": "Europe/Lisbon", "cx": 500.0, "cy": 500.0}],
  "properties": [{"code": "P1", "name": "Lantern Rooms", "destination": "d1", "x": 503.0, "y": 498.0,
                  "stars": 4, "amenities": ["wifi"],
                  "policy": [{"days_before": 3, "hour": 18, "refund_pct": 100}],
                  "vat_pct": 7, "city_minor": 300, "levy_pct": 10, "breakfast_minor": 900, "single_pct": 10,
                  "room_types": [{"code": "P1-DBL", "name": "Double", "included_adults": 2, "max_adults": 2,
                                  "max_guests": 3, "extra_adult_minor": 2500, "child_minor": 1500,
                                  "rooms": 1, "base_rate_minor": 12000}]}],
  "nights": [{"room_type": "P1-DBL", "from": "2027-03-01", "to": "2027-03-31", "base_rate_minor": 12000,
              "allotment": 1, "min_stay": 1, "max_stay": 30, "closed_to_arrival": false,
              "closed_to_departure": false, "stop_sell": false, "release_days": 0}],
  "bookings": [{"guest": "g1", "given_name": "Ada", "surname": "Lind", "property": "P1",
                "in": "2027-03-10", "out": "2027-03-13", "currency": "EUR",
                "rooms": [{"room_type": "P1-DBL", "plan": "refundable", "breakfast": false, "adults": 2, "ages": []}],
                "state": "held|confirmed|completed|cancelled|no_show"}],
  "reviews": [{"property": "P1", "guest": "g1", "scores": [9, 9, 9, 9, 9], "comment": "Quiet harbour room.",
               "age_days": 0, "state": "pending|published|rejected"}]
}
```

  A seeded property gets nights at `base_rate_minor` from 2026-01-01 to 2028-12-31 with allotment equal to `rooms`, minimum stay 1, maximum 30, nothing closed and release 0; `nights` entries (inclusive `from` and `to`) override fields. `policy` defaults to empty (refund 0 percent). A seeded booking is priced by the normal rules at the current server clock with the guest's current tier, pays with the approved card and records its charge pair; `held` creates a live hold and quote; `completed` sets its completion at 11:00 property-local on `out`. `completed_stays` creates completed one-room bookings for that user. `guest` null makes a visitor booking found only through `/find`. Seeded reviews are created `age_days` whole days before the server clock. Statements derive from seeded bookings. Response 201: `{"users":["g1"],"destinations":["d1"],"properties":["P1"],"bookings":[{"code","state","version","quote_id","hold_id","expires_at","review_link"}],"reviews":[{"id","state"}]}`, where `review_link` is `/reviews/<token>` and `hold_id`, `quote_id`, `expires_at` are null unless held. Duplicate codes answer 409 `{"error":"exists","code"}`; a bad field 422 fields.
- `POST /api/grading/session {"username":"g1"}`: signs that user in for the calling browser context (sets `kip_session`) and answers 200 `{"username","role"}`; unknown user 404.
- `POST /api/grading/clock {"set":"2027-03-01T09:00:00Z"}` or `{"advance_ms":60000}`: sets or moves the server clock and answers 200 `{"now":"<instant>"}`. Everything that falls due up to the new time applies at once, in time order, and is broadcast at once, followed by a `clock` event to every open stream.
- `POST /api/grading/currency {"EUR":1000000,"USD":1080000,"JPY":161500000,"KWD":332000}`: replaces the currency table (all four codes, positive integers) and answers 200 with it; otherwise 422 fields.
- `POST /api/grading/storage {"down":true}` or `{"down":false}`: makes every storage call fail as if storage were unreachable, or restores it, with no restart; answers 200 `{"down":bool}`.

### Business rules (DP-03, DP-10, DP-11, DP-13, DP-14, DP-15, DP-17, DP-18, DP-19, DP-20, DP-22, DP-23, DP-24, DP-26, DP-30, DP-31, DP-33, DP-35, DP-37, DP-39, DP-40, DP-42, DP-44, DP-45, DP-46)

**Money and rounding.** All money is integer minor units. `round(a / b)` on non-negative integers means half up: `floor((2a + b) / (2b))`. `off(x, p)` means `x − round(x × p / 100)`. Each step below rounds once, per night and per room. Payments and refunds are always in EUR.

**Rate plans.** Each room type has a `base_rate` in EUR cents per night. The `refundable` plan (shown as `Flexible`) uses `base_rate`; the `nonrefundable` plan uses `off(base_rate, 10)` and always refunds 0 percent. Breakfast is a per-property `breakfast_minor` per person per night, charged from age 3; children aged 0 to 2 eat free. The traveller chooses plan and breakfast per room.

**Nightly price build.** For each night from the arrival date up to, and never including, the checkout date, and for each room, in this order:

1. Plan rate.
2. Occupancy: add `extra_adult_minor` for each adult above the room type's `included_adults`. A room with exactly one adult and `included_adults` of 2 or more takes `off(x, single_pct)` instead.
3. Children by age: 0 to 2 adds 0; 3 to 11 adds `child_minor`; 12 to 17 adds `extra_adult_minor`.
4. Length of stay, by the stay's number of nights: 7 to 13 nights `off(x, 8)`; 14 or more `off(x, 12)`.
5. Early booking or last minute, by whole calendar days from the property-local date of the server clock to the arrival date: 60 or more days `off(x, 10)` (early booking); 3 or fewer days `off(x, 15)` (last minute). Last minute is skipped when step 4 applied. The nonrefundable plan never takes step 5.
6. Loyalty: `off(x, tier percent)` for the quote's pinned tier.

The result is the discounted room amount, the base for statements.

7. Breakfast: `breakfast_minor` × persons aged 3 or more in the room, when breakfast is chosen; it takes no discount. Taxable amount `t` = discounted room amount + breakfast.
8. VAT: `round(t × vat_pct / 100)`.
9. City tax: `city_minor` × persons aged 12 or more; younger children are exempt.
10. Tourism levy (tax on tax): `round(city tax × levy_pct / 100)`.

Night total = `t` + VAT + city tax + levy. The stay total is the sum over nights and rooms. Price lines carry each step's change (`plan_rate` the step 1 amount, then the difference made by each later step, negative for discounts), so the lines add up to the night total. With several rooms, a night's lines are summed over rooms.

Worked example (one refundable room, three nights with base 12000, 15000, 12000; 3 adults and children aged 7 and 1; `included_adults` 2, `extra_adult_minor` 2500, `child_minor` 1500; booked 90 days ahead; tier Heron 5 percent; breakfast 900; VAT 7 percent; city tax 300; levy 10 percent): first night 12000 → occupancy 14500 → children 16000 → early booking 14400 → loyalty 13680; breakfast 3600 (4 persons aged 3 or more), so `t` = 17280; VAT 1210; city tax 900; levy 90; night total 19480. Second night: loyalty step 16245, `t` 19845, VAT 1389, total 22224. Third night 19480. Stay total 61184.

**Currency conversion and split.** The currency table holds parts per million per 1 EUR. Decimals: EUR 2, USD 2, JPY 0, KWD 3. For a night amount `a` in EUR cents and rate `ppm`, its exact share is `a × ppm × 10^decimals / (100 × 10^6)`. The converted total is `round(Σ(a × ppm × 10^decimals) / (100 × 10^6))` over all nights (rooms summed per night). The total is split across nights so they add up exactly: each night takes the whole part of its exact share, and the units still missing go one each to the nights with the largest fractional parts, ties to the earlier night. Compute with integers of unlimited size. Worked examples: nights 10001, 10002, 10003 cents give JPY total 48460 split 16152, 16153, 16155, and KWD total 99620 split 33203, 33207, 33210. The stay above, 61184, gives USD 66079 (21039, 24002, 21038), JPY 98812 (31460, 35892, 31460), KWD 203131 (64674, 73784, 64673). A quote pins the currency table at quote time. Where each currency appears: on the search, property and checkout pages, totals, row totals, pins, the price bar and each Night Strip night button show the chosen currency (the converted total and its split, `data-currency` the chosen code). The price lines in `list "Price lines"` are always in EUR, the currency they are computed in (`data-currency="EUR"`), so they add up to the night's EUR total, never to the converted night figure; with EUR chosen the two agree. The booking page (its Night Strip and price lines included), the cancel and change dialogs, the invoice, the ledger, reservations and statements show EUR. The one exception is a single figure under `table "Ledger"`, outside its cells: the booking's total in the quote currency, as `≈ {amount}` with `data-minor`, `data-currency` the quote currency, and `data-approx`. In `table "Ledger"` each row's Debit and Credit cells both carry `data-minor` and `data-currency="EUR"`; the side an entry does not use is an empty cell with `data-minor="0"`, so the balance is the sum of Debit cells minus the sum of Credit cells.

**Price display.** `display=total` shows the stay total; `display=night` shows `round(converted total / nights)`. With taxes off (`tax=0`), the same rules apply to the sum of `t` instead of night totals, converted by the same split. Defaults: total, with taxes.

**Night states.** The server sets each quote night's `state`, and Night Strip shows it, by the first rule that holds: `held` when a live hold of this browser context covers the night (the checkout page from Reserve until payment or the hold's end); `closed` when the night is not held and, by the server's current inventory, the quoted selection now fails the stop-sell or sold-out check on that night (for example after a manager stops sale, or another traveller holds the last room, while this page is open), the column keeping its last priced amount; `discount` when, in any room, the plan is nonrefundable or any of the lines `occupancy`, `length_of_stay`, `early_booking`, `last_minute` or `loyalty` is negative; `base` otherwise. Pages re-read the states on `availability` and `quote.changed`. The booking page's Night Strip shows only `base` or `discount`, from the booking's price snapshot. When the property page shows `SOLD`, it shows no Night Strip.

**Stay restrictions.** Per room type and date there are `allotment`, `min_stay`, `max_stay`, `closed_to_arrival`, `closed_to_departure`, `stop_sell` and `release_days`. Rooms left = allotment − rooms held − rooms booked (confirmed, changed or no-show); it never goes below zero. A stay for a room type and a number of rooms is checked in this order, and the first failure wins:

| Check | Reason code | Message |
|---|---|---|
| Arrival is before property-local today + `release_days` of the arrival date | `release` (`n` = release days) | `reason.release` |
| `closed_to_arrival` on the arrival date | `no_arrival` | `reason.no_arrival` |
| `closed_to_departure` on the departure date | `no_departure` | `reason.no_departure` |
| Nights fewer than `min_stay` of the arrival date | `min_stay` | `reason.min_stay` |
| Nights more than `max_stay` of the arrival date | `max_stay` | `reason.max_stay` |
| Each night in date order: `stop_sell` | `stop_sell` | `reason.stop_sell` |
| Each night in date order: rooms left below rooms wanted | `sold_out` | `reason.sold_out` |

No stay is longer than 30 nights.

**Date availability.** On a search, a day is available as an arrival if any room type in the destination passes the arrival-only checks (release, closed to arrival, stop sell and at least one room left that night); otherwise its reason is that of the room type with the lowest code. On a property page the same uses that property's room types. A day's `{n}` amount is the lowest step 1 refundable rate among the room types accepting arrival, converted to the chosen currency and shown in whole major units rounded half up, digits only; its minimum stay is the lowest among them. After an arrival is picked, each earlier day is `day.before`; each later day is checked as a departure for that arrival by the remaining checks, skipping the arrival-only ones: a day under the minimum stay is `day.short`, any other failure `day.blocked` with its reason, and a passing day `day.available`. `status "Date help"` reads `date.start` before an arrival is picked and `date.end` after.

**Room allocation.** The party is adults and children with ages. Every combination of up to 4 rooms (a multiset of room types with enough rooms left on every night and passing the stay restrictions) is considered, with every placement of the party: how many adults and how many children of each age band (0 to 2, 3 to 11, 12 to 17) go into each room, children of one band assigned in input order to rooms in code order. Each room holds at least one adult, at most `max_adults` adults and at most `max_guests` guests. Each candidate is priced with the refundable plan and no breakfast. The recommendation is the lowest stay total; ties go to fewer rooms, then to the room codes in ascending order, then to the placement with the most adults in the first room, then in the second room, then in each later room in code order, then the same for children aged 12 to 17, 3 to 11 and 0 to 2. An override (chosen room counts) is placed by the same rule among its own placements. It is refused when total capacity is short (`advice.capacity`, `n` = the rooms' summed `max_guests`, `m` = party size), when there are more rooms than adults (`advice.adult`), or when a room type has fewer rooms left than chosen (`advice.left`, `n` = rooms left, the room type's name). With no valid combination the property is unavailable.

**Search results.** `GET /api/search` uses the search link parameters. A property is a result when it is in the destination, it has a recommendation for the dates and party, and it matches the filters (and lies inside the view when `zoom`, `cx`, `cy` are present). Distance is straight-line on the plane, with `x` and `y` in kilometres from the destination centre, shown to one decimal half up. `score` comes from Reviews (6.0 with no published reviews). `avg_night_minor` = `round(recommended total in EUR / nights)`. Rank = `3 × (score × 10) − 2 × floor(distance) − floor(avg_night_minor / 1000)`; for example score 7.9, distance 12.3 and total 35855 for 3 nights give 237 − 24 − 11 = 202. Sort values: `rank` (Best match, highest first, ties by lower total then code), `price_asc`, `price_desc` (by EUR recommended total), `score_desc` (by score), `distance_asc`; every order breaks remaining ties by code ascending. Filters: `stars` (3, 4, 5), `amen` (`pool`, `parking`, `wifi`, `spa`, `pets`), `free` (a 100 percent tier whose deadline for this arrival is still ahead on the server clock; the same test sets the `Refundable` tag). Options inside a group combine with OR, and groups combine with AND. The count beside an option is the number of results matching every other group, the price range and the map view together with that option, ignoring its own group's selection. Price range: `min` and `max` in whole euros, a property matching when `min × 100 ≤ avg_night_minor ≤ max × 100`. Histogram: 12 buckets of `avg_night_minor`, bucket `i` holding `5000 × i ≤ avg < 5000 × (i + 1)` and the last holding 55000 and up; `{from}` and `{to}` in its name are `50 × i` and `50 × (i + 1)` euros; it honours every filter except the price range. Pins cover every result, not only the page.

**Stable paging.** Pages hold `KIP_PAGE_SIZE` results. `next_cursor` names the last result's sort value and code: `<sort value>_<code>`, where the sort value is the rank followed by `~` and the EUR total for `rank`, the EUR total for the price orders, `score × 10` for `score_desc`, and the distance in whole metres (rounded half up) for `distance_asc`. The next page starts strictly after that position in the current order. A property whose sort value did not change between page loads appears exactly once across the pages; a new property, or one whose value a manager's change moved, appears where its current value places it.

**Search link form.** Every setting lives in the URL query in this order: `dest, in, out, adults, ages, lang, cur, display, tax, stars, amen, free, min, max, sort, cursor, zoom, cx, cy, sel`. `dest`, `in`, `out`, `lang` and `cur` are always present, so a shared link carries the sender's language and currency; the others are left out at their defaults (adults 2, no children, `display=total`, `tax=1`, no filters, `sort=rank`, first page, whole destination, nothing selected). A link without `lang` or `cur` gets the caller's stored value (else `en` and `EUR`) added by normalisation, with no notice. Lists are comma-separated in ascending order. `zoom`, `cx`, `cy` appear together only after `Search this area`. The server normalises the link by these rules, in this order, returning the canonical query and one notice per rule applied:

| Input | Normal form | Notice |
|---|---|---|
| Unknown parameter | dropped | `notice.ignored` with its name |
| `in` before property-local today in the destination's zone, or unparsable | that today | `notice.arrival` |
| `out` not after `in`, or more than 30 nights after it | `in` + 1 | `notice.departure` |
| `adults` outside 1 to 16 | clamped | `notice.adults` |
| An age outside 0 to 17 or not whole | that age dropped | `notice.age` |
| `sort`, `cur`, `lang` or `display` unknown | default (for `lang` and `cur`, the caller's stored value, else `en` and `EUR`) | `notice.reset` with its name |
| `min` above `max` | swapped | `notice.swapped` |

Parameters out of canonical order are reordered with no notice. The page replaces its URL with the canonical form and puts the notices in `status "Link notice"`.

**Map.** The plane is 1000 by 1000 km, with the Y axis pointing down (north is smaller Y), zoom 0 to 5 (default 2), and the view a square of side `1000 / 2^zoom` km centred at `cx`, `cy` (default the destination centre, clamped to 0 to 1000). Clustering uses a grid with cell size `200 / 2^zoom` km and cell `floor(x / size), floor(y / size)`; a cell with 2 or more results is one cluster at the mean of its members rounded to 0.1 km, and activating it zooms by 1 centred there. A single result is a pin. Only results inside the current view (the same test as `Search this area` below) are clustered and drawn. A cluster's code, used for the first tab stop and for ties, is the lowest code among its members. Pan buttons move the centre by `100 / 2^zoom` km. `Search this area` keeps only results with `|x − cx| ≤ side / 2` and `|y − cy| ≤ side / 2`. Arrow keys among pins and clusters: a candidate lies on that side of the focused one (smaller Y for ArrowUp, larger Y for ArrowDown, smaller X for ArrowLeft, larger X for ArrowRight) with `|d along the arrow| ≥ |d across it|`; the nearest by straight-line distance wins, ties to the lower code; with none, focus stays.

**Quotes and holds.** A quote pins prices, rates, tier and currency table and lives `KIP_QUOTE_TTL_MS` on the server clock. A hold reserves every room of a quote or none, all together in one step, reduces rooms left at once, broadcasts `availability`, and lives `KIP_HOLD_MS`. A hold or quote is live while `now < expires_at` and over at exactly `expires_at`. When a hold ends, its rooms return to sale, and the server broadcasts `hold.expired` to its owner and `availability` to everyone. When several holds are requested for the last rooms of overlapping nights at the same moment, exactly one succeeds (201) and every other answers 409 `sold_out`. A quote goes stale when a manager's edit changes any of its nights' rates, or when it expires; the server then sends `quote.changed` to the quote's owner with `old_total_minor` and `new_total_minor` (the same selection priced now with the current tier and currency table). Re-quoting with `hold_id` creates a new quote attached to the live hold.

**Hold countdown.** Each page keeps `server_now` from `GET /api/time` and each `clock` event. The remaining time is `expires_at − (last server_now + page time elapsed since it arrived)`, recomputed on every `clock` event and on a page interval of 1000 milliseconds, shown in `timer "Time left"` as `mm:ss` of whole seconds rounded up, never below `00:00`. When the remaining time crosses from above 5 minutes, 2 minutes or 1 minute to at most that, while the page is open, `status "Hold announcements"` reads `hold.minutes` with that number. Only the server ends a hold: the browser countdown reaching zero ends nothing.

**Checkout dialogs.** On `hold.expired`, or a 410 on pay, `alertdialog "Your hold ended"` shows `hold.ended`. On `quote.changed`, or a 409 `price_changed`, `alertdialog "The price changed"` shows `price.changed` (or `price.refreshed` when the totals are equal). When an open checkout without a hold receives `availability` for its property and its selection no longer fits, or its Reserve answers 409 `sold_out`, `alertdialog "Just taken"` shows `just.taken`.

**Payment.** Fields: given name and surname required (up to 80 characters); card number 16 digits, spaces ignored; expiry `MM/YY` with month 01 to 12; security code 3 digits. Only these cards exist:

| Card number | Outcome |
|---|---|
| `9000 0000 0000 0002` | approved |
| `9000 0000 0000 0010` | declined, `card.declined` |
| `9000 0000 0000 0028` | expired, `card.expired` |
| `9000 0000 0000 0036` | step-up: the first attempt answers 402 `step_up`; resent with `step_up_code` `1234` it is approved, any other code answers `wrong_code` (`card.wrong_code`) |

Any other number is `card.unknown`. A card refusal keeps the hold and the fields. Only the last 4 digits are stored and shown, as `•••• 0002`. Repeat requests: `POST /api/bookings` and `POST /api/bookings/<code>/changes` take an `Idempotency-Key` header (missing: 422 field `Idempotency-Key` `required`); the checkout page and `dialog "Change dates"` send a fresh key for each press of Pay, each press of Confirm change and each step-up confirmation. Every 2xx and every 402 reply to a keyed request is stored with its key for 24 hours of server time. A request with the same key and the same body gets the stored reply: a stored 201 comes back as 200 with the same body, and a stored 200 or 402 comes back with its own status and body; nothing is charged, refunded or changed again. The same key with a different body answers 409 `idempotency_conflict`. A double submit therefore books, charges or changes once. A booking code is `KW-` followed by 6 characters from the letters A to Z and the digits 2 to 9. A successful booking turns the hold into confirmed rooms and records the charge pair.

**Booking states.** Room booking: `held` → `confirmed` (paid) or `expired` (hold over). `confirmed` or `changed` → `changed` (date change), `cancelled`, `no_show` or `completed`. `cancelled`, `no_show`, `completed` and `expired` are final; any action on a final room answers 409 `invalid_state`. Completion: at 11:00 property-local on the checkout date each confirmed or changed room completes. No-show: managers of the property only, from 12:00 property-local on the day after arrival until completion (`no_show_open` reports it; earlier answers 409 `too_early`); it applies to every active room, refunds nothing, does not return rooms and does not count for loyalty. A booking's `state` is the state shared by its non-cancelled rooms, or `cancelled` when all are. Every change to a booking increments `version`; cancellations, changes and no-shows require `If-Match` with the current version (missing: 422 field `If-Match` `required`; stale: 409 `version_conflict`).

**Cancellation deadlines.** Each property has policy tiers `[{days_before, hour, refund_pct}]`. Each deadline is the wall-clock time `hour:00` on the date `arrival − days_before` days in the property's IANA zone. A wall-clock time skipped on a daylight saving day moves forward to the first valid minute after the gap; a repeated time uses its first occurrence. The refund in force is the tier with the earliest deadline still ahead (`now < deadline`); after the last deadline, 0 percent; the nonrefundable plan is 0 percent always. `region "Cancellation"` lists each tier as `tier.free` (100 percent) or `tier.partial`, with `deadline.line` showing the moment in the property's zone, its zone id, and the same moment in the browser's own zone. `status "Refund status"` shows the server's `status`: `refund.free`, `refund.partial` or `refund.none`. The page re-reads the status on every `clock` event, so it changes within one second of the server clock passing a deadline while the page is open; the browser never decides it from its own clock.

**Cancellation and ledger.** Refund per room = `round(room paid × refund_pct / 100)`, room paid being the room's charges minus its refunds so far. Cancelling some rooms leaves the others booked; the cancelled rooms' nights return to sale at once and `availability` is broadcast. Every money movement is one pair of entries with the same `pair` number: a `charge` debits `guest` and credits `property`; a `refund` debits `property` and credits `guest`; a `change` pays (debit `guest`, credit `property`) or refunds (debit `property`, credit `guest`) a date-change difference. Entries are never edited or deleted; a correction is a new reversing pair. The booking's `balance_minor` (debits minus credits over all entries) is always 0, and `table "Ledger"` shows it in `data-balance-minor`. A cancelled booking never completes, so it never counts for loyalty.

**Date changes.** A date change keeps the rooms, plans, breakfast and party, and is allowed while the booking is confirmed or changed and its arrival date is after property-local today (otherwise 409 `invalid_state`, shown as `change.not_now`). Nonrefundable rooms cannot be changed (422 `nonrefundable`, `change.nonrefundable`). The new stay is checked by the stay restrictions, ignoring this booking's own rooms; a failure answers 422 restricted and changes nothing. The new stay is priced at current rates and the current tier. Difference `d` = new total − paid total. `d > 0`: the guest pays `d` with the test card table. `d < 0`: the refund is `round(|d| × refund_pct / 100)` at the refund in force now for the old stay. The old nights return to sale and the new nights are taken in one step, with `availability` broadcast. The dialog shows `change.new_total`, `change.paid` and `change.pay` or `refund.amount`.

**Reviews.** Each booking has one review capability link `/reviews/<token>`. At completion, an inbox message with that link reaches the booking's guest (signed-in user, or the booking's visitor). Anyone holding the link can use it. Before completion: 403 `too_early` (`review.early`). The window is open while `completion ≤ now < completion + KIP_REVIEW_WINDOW_MS`; after it: 410 `window_closed` (`review.closed`). A second review: 409 `already_reviewed` (`review.used`). The review page re-reads the link status on every `clock` event and switches between the refusal and the form within one second, with no reload. Five whole scores from 1 to 10 and a comment of up to 2,000 characters. Moderation: `pending` → `published` or `rejected` by an operator; other transitions answer 409 `not_pending`. Only published reviews count. Property score: each review's value is the mean of its five scores, with weight `0.5^(age_days / 180)`, where `age_days` is whole days from the review's creation to now on the server clock. `score = floor(x × 10 + 0.5 + 1e-9) / 10` where `x = Σ(weight × value) / Σ weight`. For example means 9, 7 and 5 at ages 0, 180 and 360 give 7.857, shown as 7.9. Publishing moves the score, and so the rank, at once.

**Loyalty.** Tiers come from the user's completed bookings whose completion falls in the 730 days up to now on the server clock: `Wren` (0 or 1 stays, 0 percent), `Heron` (2 to 4 stays, 5 percent, perk `perk.late`), `Kestrel` (5 or more stays, 10 percent, perks `perk.late` and `perk.drink`). Cancelled and no-show bookings never count. Visitors without an account are `Wren`. A tier change applies to new quotes only; a live quote and a booking keep their pinned tier. `region "Loyalty"` shows `loyalty.line` and the perks, and updates on `account.changed`, which the server sends to the user's tabs whenever their tier or count changes.

**Accounts and preferences.** Usernames are 3 to 24 characters of `a-z`, `0-9` and `_`, stored lower case (input is lower-cased first); passwords at least 8 characters. Sessions use the `kip_session` cookie (`HttpOnly; SameSite=Lax`, no `Secure`). Every browser context has a `kip_visitor` cookie (`HttpOnly; SameSite=Lax`), set by the first page load or `GET /api/time`; write routes without it answer 401 `{"error":"no_visitor"}`. Roles: `guest`, `manager` (of one or more properties), `operator`. Language and currency are stored on the session when signed in, else on the visitor. A change by one tab is stored and broadcast as `account.changed` to every other tab of that browser (and of the same signed-in user's sessions), which applies it live and replaces its URL's `lang` and `cur` (replace, not push). On load the URL's `lang` and `cur` always win for that page and do not change the stored values; when absent they are filled in by the link normalisation in Search link form. Only a change through `combobox "Language"` or `combobox "Currency"` stores a new value. `Sign out everywhere` ends all of the user's sessions; every open tab of those sessions receives `account.changed` with `signed_out: true`, moves to `/signin`, and shows `signed.out` in `status "Toast"`. Failed sign-ins show `signin.failed`.

**Booking access.** A booking is visible to the visitor that made it, the signed-in user who made it, a visitor that found it through `/find` (code case-insensitive, surname compared trimmed and case-insensitive), and managers of its property. Anyone else gets 404, the same answer as an unknown code. `/find` answers a wrong code and a wrong surname alike with 404 and `find.none`. Managers see and act on only the properties they manage; another property's pages and routes answer 404. Moderation routes answer 403 to signed-in non-operators. A guest who can see their own booking but calls the no-show route gets 403.

**Manager calendar and seasons.** An edit applies to the selected room types and dates on the ticked weekdays only. Validation (422): `edit.max_below_min`; `edit.rate_min` (the Rate spinbutton is in whole euros and is stored as `rate × 100`); `edit.rooms_sold` with `n` = the most rooms held or booked on any affected night. An edit covering more than one night is a season and needs a name (`edit.season_name`); a single-night edit is not a season. Two seasons overlap when they share a room type and a night whose weekday both include. An overlapping season answers 409 `season_overlap` naming the existing season with the lowest name, and the first and last shared nights; the dialog shows `season.overlap` and `button "Replace {b}"`, which resends with `replace` and deletes that season record before saving. Every saved edit changes the nights at once, broadcasts `availability`, and makes affected quotes stale.

**Reservation export.** `reservations.csv` has a header line `code,surname,arrival,departure,rooms,total_minor` and one line per booking that is not held or expired, ordered by arrival then code; `rooms` counts non-cancelled rooms and `total_minor` is the paid total minus refunds. Lines end with a line feed. A cell containing a comma, double quote or line break is wrapped in double quotes with inner quotes doubled. A cell beginning with `=`, `+`, `-`, `@`, a tab or a carriage return gets a leading `'` so spreadsheets show it as text.

**Commission statements.** For a property and a month: one `stay` line per booking whose rooms check out in that month in property-local time, with `base_minor` = the sum of discounted room amounts plus breakfast over its non-cancelled rooms (no-show rooms included), and `commission_minor = round(base × 9 / 100)`; plus one `cancellation` line per cancellation made in that month in property-local time, with `base_minor` = the amount retained (room paid minus refund) and `commission_minor = round(retained × 9 / 100)`. For example base 50550 gives 4550 and retained 1000 gives 90. Lines are ordered by kind (`stay` first), then code. `table "Statement"` shows the month live. The CSV has a header `code,kind,base_minor,commission_minor`, the lines, and a final line `total,,<base sum>,<commission sum>`, with the same quoting and neutralising as reservations. It is downloadable only for months that have ended in property-local time (`downloadable`; earlier answers 409 `month_open` and the link is hidden): the first download writes it to storage, and every download serves the stored object.

**Invoice and print.** The invoice is a printable HTML page with the code, guest, property and zone, dates, rooms, every night's price lines, the total, every ledger row, the VAT and city tax totals for the stay, and `invoice.paid_by`. The first request after a ledger change writes it to storage; every request serves the stored object.

**Rate import.** Files are UTF-8 text with LF or CRLF line ends. Line 1 is exactly `KIPRATES 1`; otherwise the only error is `import.header` for line 1 (an undecodable file counts as this). Every other line is blank, a `#` comment, or `ROOM|PLAN|FROM|TO|WEEKDAYS|RATE_MINOR|MIN|MAX`. Each line is checked in field order and reports its first error: `import.fields` (`m` fields found), `import.room` (a room type code of this property), `import.plan` (the only plan code a file may name is `refundable`, because the nonrefundable plan is derived), `import.date` (FROM, then TO, as real `YYYY-MM-DD` dates), `import.order`, `import.weekdays` (7 characters, position `i` either the `i`-th letter of `MTWTFSS` or `-`), `import.rate`, `import.limits` (MIN and MAX each empty or a whole number of at least 1, and MAX not below MIN when both are given; `x` is `MIN|MAX` as written). Then each valid line that shares a room and a night on a ticked weekday with an earlier valid line reports `import.overlap` against the earliest such line. Line numbers count every line from 1. All errors are listed in line order and nothing applies. A valid file previews one row per night whose rate, minimum or maximum would change, ordered by room then date, shown as `import.row` with the old and new rates in EUR, plus `import.count`. Apply stores the exact bytes first, then applies every line in one transaction; when storage fails nothing applies. Applying a file identical to one already applied changes nothing and reports a count of 0. Files are limited to `KIP_IMPORT_MAX_BYTES` (that size itself is allowed); larger files answer 413 and show `import.too_large`.

**Live events.** `GET /api/events` streams to the calling browser context (its visitor and session). Event names are exactly `clock` (`{"now"}`), `availability` (`{"property","room_type","dates":[…]}`), `quote.changed` (`{"quote_id","reason":"rate"|"expired","old_total_minor","new_total_minor"}`), `hold.expired` (`{"hold_id"}`) and `account.changed` (`{"lang","cur","tier","completed_stays","signed_out"}`). The server sends a comment line every `KIP_SSE_HEARTBEAT_MS`, a `clock` event on every grading clock change and every 60 seconds, and on each new connection a `clock` event followed by the current state of each open hold and quote of that context (a `hold.expired` or `quote.changed` for any that ended or went stale while disconnected). Pages apply each event to the page inside the event handler, with no wait on a timer or animation frame. Search pages re-run their current search on `availability` for their destination, updating counts and rows in place with no history entry. Browsers reconnect on their own.

**Languages.** Languages are `en`, `de` and `ar` with the strings in Frontend. Number and date output uses `Intl` with locale `en-GB`, `de-DE` or `ar-KW` and numbering system `latn`, stay dates in the property's zone. Plurals use `Intl.PluralRules`: `en` and `de` have `one` and `other`; `ar` has `zero`, `one`, `two`, `few`, `many` and `other`. Arabic sets `dir="rtl"` on the page root and mirrors the layout (the header's start is on the right, and the visual left-to-right order of every row is reversed); Night Strip, the date picker, the gallery and the calendar grid swap left and right arrows; the map does not.

### Services (DP-01, DP-42, DP-43, DP-45, DP-46)

**Postgres** is the system of record: users and sessions, visitors and their preferences, destinations, properties, room types, nightly rates and restrictions, seasons, quotes, holds, bookings with their price snapshots, ledger entries, repeat-request keys, reviews and inbox messages, the currency table and the server clock offset. The schema is applied idempotently every time the app serves, and the base seed is inserted when absent.

**MinIO** (bucket from `S3_BUCKET`) holds, with these exact keys:

- `images/<property code>/<n>.svg`: 3 procedurally drawn pictures per property, written at start when missing (retrying every 5 seconds while storage is unreachable) and served by `GET /images/<code>/<n>.svg`.
- `imports/<property code>/<sha256>.kiprates`: every applied rate file, byte for byte, written before it is applied; `<sha256>` is the lower-case hex digest of the bytes.
- `invoices/<booking code>.html`: the invoice page.
- `statements/<property code>/<yyyy-mm>.csv`: the downloaded statement CSV.

Each object is written and then read back by the route that serves it.

When storage is unreachable or set down by the grading route: search, quotes, holds, payment, cancellation, changes, reviews and the calendar keep working; importing answers 503 `storage_unavailable` with `storage.import`, keeping the preview so `Apply` retries; invoices and statement downloads answer 503 with `storage.doc`; pictures answer 503 and the gallery shows `storage.pictures`; `GET /api/health` reports `unavailable`. When storage returns, the next request succeeds with no restart. A storage failure never undoes a booking, so booking success copy holds during an outage.

### Seed data (DP-02, DP-13, DP-40)

Every destination, property, brand and person below is invented. Present at start (the base seed):

Destinations:

| Code | Name | Zone | Centre (x, y) | VAT | City tax per person aged 12+ | Tourism levy | Policy tiers |
|---|---|---|---|---|---|---|---|
| `harrowmere` | Harrowmere Bay | `Europe/Lisbon` | 300.0, 400.0 | 6% | 200 | 10% | 100% until 18:00 3 days before; 50% until 18:00 1 day before |
| `vellicombe` | Vellicombe Heights | `Europe/Berlin` | 650.0, 250.0 | 7% | 300 | 10% | 100% until 12:00 7 days before; 30% until 12:00 2 days before |
| `qasrayn` | Qasr Ayn Oasis | `Asia/Kuwait` | 700.0, 750.0 | 5% | 400 | 5% | 100% until 14:00 1 day before |

Each property takes its destination's zone, taxes and policy. Properties (base rates in EUR cents; Sun–Thu nights / Fri–Sat nights):

| Code | Name | Dest | x | y | Stars | Amenities | Double | Family | Breakfast |
|---|---|---|---|---|---|---|---|---|---|
| `HRB-QUAY` | Quayside Lantern House | harrowmere | 306.0 | 404.0 | 4 | wifi, parking | 12000 / 15000 | 18000 / 21000 | 1200 |
| `HRB-GULL` | The Gullrest Inn | harrowmere | 290.0 | 395.0 | 3 | wifi, pets | 8500 / 9900 | 13000 / 15000 | 900 |
| `HRB-NETT` | Netmender's Rooms | harrowmere | 312.0 | 410.0 | 3 | wifi | 7900 / 8900 | 12500 / 14000 | 800 |
| `HRB-TIDE` | Tidewrack Hotel | harrowmere | 320.0 | 380.0 | 5 | pool, spa, wifi, parking | 21000 / 26000 | 30000 / 36000 | 1800 |
| `HRB-SALT` | Saltgrass Guesthouse | harrowmere | 280.0 | 420.0 | 4 | wifi, pets, parking | 11000 / 12500 | 16500 / 18500 | 1000 |
| `HRB-BEAC` | Beaconfold Lodge | harrowmere | 340.0 | 430.0 | 4 | pool, wifi | 13500 / 16000 | 19500 / 23000 | 1100 |
| `HRB-OYST` | Oyster Lane Rooms | harrowmere | 296.0 | 412.0 | 3 | wifi | 7200 / 8400 | 11500 / 13000 | 800 |
| `VLC-PINE` | Pinecrest Hall | vellicombe | 655.0 | 245.0 | 4 | spa, wifi, parking | 14000 / 17000 | 20000 / 24000 | 1300 |
| `VLC-LARK` | Larkspur Chalet | vellicombe | 640.0 | 262.0 | 3 | pets, wifi | 9000 / 10500 | 14000 / 16000 | 1000 |
| `VLC-FERN` | Fernhollow House | vellicombe | 668.0 | 238.0 | 5 | pool, spa | 24000 / 29000 | 33000 / 39000 | 2000 |
| `QSA-PALM` | Palmshade Courtyard | qasrayn | 705.0 | 748.0 | 4 | pool, wifi | 15000 / 16500 | 22000 / 24000 | 1200 |
| `QSA-DUNE` | Dunewatch Rooms | qasrayn | 690.0 | 760.0 | 3 | parking, wifi | 8000 / 8800 | 12500 / 13500 | 700 |

Every property has two room types: `<code>-DBL` named `Double` (included adults 2, max adults 2, max guests 3, 5 rooms) and `<code>-FAM` named `Family` (included adults 2, max adults 4, max guests 5, 2 rooms), each with extra adult 2500, child 1500 and single-adult discount 10 percent. Nights exist from 2026-01-01 to 2028-12-31 with allotment equal to the room count, minimum stay 1, maximum 30, release 0 and nothing closed. Each property has 3 pictures.

Users (password in brackets): `founder` operator (`kipwell-founder-01`); `mara` manager of `HRB-QUAY` and `HRB-GULL` (`kipwell-mara-01`); `tomas` manager of `VLC-PINE` (`kipwell-tomas-01`); `ada` guest with no stays (`kipwell-ada-01`).

Currency table at start: EUR 1000000, USD 1080000, JPY 161500000, KWD 332000. There are no bookings, holds, reviews or seasons at start. The server clock starts equal to real time.

## Technical requirements

### Deployment (DP-01)

Backend: TypeScript on Node 22 with npm. Frontend: TypeScript built with Node 22 in the same `build` step and served by the app.

`/app/run.json` holds string commands and the schema tag, for example:

```json
{"_schema":"run-manifest-v1","install":"npm ci","build":"npm run build","serve":"node dist/server.js"}
```

The server binds `0.0.0.0` on port 4173, or on `APP_PUBLIC_PORT` when it is set. `GET /api/health` is the health path, answering as published in API. The lockfile is committed.

### Configuration and secrets (DP-05)

The app reads at start, and never hard-codes or sends to the browser: `DATABASE_URL`; `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_FORCE_PATH_STYLE`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`; `APP_PUBLIC_PORT`, `APP_PUBLIC_URL`; and the published settings below. Settings the browser needs (debounces, toast lifetime) reach it through the page, never credentials.

| Setting | Env var | Default | Unit |
|---|---|---|---|
| Grading routes on (404 when unset) | `KIP_GRADING` | unset | `1` turns on |
| Hold lifetime | `KIP_HOLD_MS` | 900000 | milliseconds of server clock |
| Quote lifetime | `KIP_QUOTE_TTL_MS` | 600000 | milliseconds of server clock |
| Review window after completion | `KIP_REVIEW_WINDOW_MS` | 2592000000 | milliseconds of server clock |
| Map pause before `Search this area` | `KIP_MAP_DEBOUNCE_MS` | 400 | milliseconds of page time |
| Destination typing pause | `KIP_TYPE_DEBOUNCE_MS` | 200 | milliseconds of page time |
| Results page size | `KIP_PAGE_SIZE` | 20 | results |
| Event stream heartbeat | `KIP_SSE_HEARTBEAT_MS` | 15000 | milliseconds |
| Toast lifetime | `KIP_TOAST_MS` | 5000 | milliseconds of page time |
| Sign-ins per username per minute | `KIP_LOGIN_RATE` | 10 | requests |
| Booking lookups per visitor per minute | `KIP_LOOKUP_RATE` | 10 | requests |
| Search requests per visitor per minute | `KIP_SEARCH_RATE` | 120 | requests |
| Rate file size | `KIP_IMPORT_MAX_BYTES` | 1000000 | bytes, inclusive |

### Server boundary (DP-04)

- Same origin only: the browser talks only to this app. A write request (POST, PUT, PATCH, DELETE) whose `Origin` header names another origin answers 403 `{"error":"cross_origin"}`.
- JSON bodies are at most 65,536 bytes (that size itself is allowed); larger answers 413 `{"error":"too_large"}`. A JSON route given another content type answers 415 `{"error":"unsupported_media_type"}`. Rate files follow `KIP_IMPORT_MAX_BYTES`.
- Rate limits are counted per minute on real time; over a limit the answer is 429 with a `Retry-After` header in whole seconds and `{"error":"rate_limited"}`, and the page shows `rate.limited`.
- The server never serves source files, the manifest, lockfiles, environment files or credentials; such paths answer 404 like any unknown path.
- Unknown API paths answer 404 `{"error":"not_found"}`; unknown pages show the not-found page with status 404.
- If Postgres is unreachable at boot, the app keeps running, retries every second and answers health with 503 `starting` until connected. If storage is unreachable at boot or later, the app starts and serves everything that does not need storage, and storage features work again as soon as it returns, with no restart.
- No service worker; no WebSocket. Client countdowns, debounces and toasts run on the page's standard timers and clock; Web Animations run on the document timeline. Business dates and times never come from the browser clock.

### Browser support and performance (DP-28)

Current Chromium, Firefox and WebKit at 375x812, 768x1024 and 1280x800, with touch on phones, and widths down to 320 pixels. With the seed data, any page is usable within three seconds of navigation, and a filter, sort or display change shows its new results within one second. Fonts are bundled files the app serves; no request leaves the app's origin.

## Working rules

- IF-01: `/app/run.json` is valid JSON with string `install`, `build` and `serve` and `"_schema":"run-manifest-v1"`, and nothing else is needed to run the app.
- IF-02: `THIRD_PARTY_NOTICES.md` at `/app` lists every shipped package (the production dependency tree from `npm ls --omit=dev --all --json`) and the two bundled font families, each with its licence.
- IF-03: every shipped package and bundled font is under MIT, ISC, BSD-2-Clause, BSD-3-Clause, Apache-2.0, 0BSD, CC0-1.0 or OFL-1.1.
- IF-04: the app uses only Postgres and MinIO as services: no other datastore, queue, cache, mail, search or payment service, and no outside network request at runtime.
- IF-05: the provided service configuration (compose files, service credentials and the dev bucket and database) is left untouched.
- IF-06: all server and browser source is written in TypeScript.

## Engineering standards

- Code is idiomatic TypeScript with strict type checking on, and names match this brief's domain terms (quote, hold, booking, night, price line, ledger pair, season, tier, statement).
- Each domain rule, such as a price step, the currency split, a restriction check, a state transition, a deadline or the commission, is decided in exactly one place in the source and reused everywhere it is shown.
- Money is integer minor units throughout the source; no floating-point money arithmetic anywhere.
- There is no abstraction with a single implementation, no dead, commented-out or unreachable code, and no defensive checks for states the rules make impossible.
- Every API error leaves through one error shape, with codes from this brief.
- Every user-visible string comes from the published language tables, never from inline literals.
- There are no features beyond this brief.
