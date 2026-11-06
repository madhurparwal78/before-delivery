# Ashgrove Mesh Works Turnstone Studio

Turnstone Studio is a self-hosted shop and publishing desk for one independent 3D model author. It is the author's own storefront for hard-surface props, printable miniatures and scanned objects. Visitors browse a faceted catalogue and inspect each model in a measured 3D viewer called the Survey Ring. They buy personal, commercial or studio licences, or a numbered copy of a limited edition. Behind the shop, every uploaded package goes through a publishing queue that validates it and produces a real-time GLB in metres, a print-ready STL in millimetres and a rendered preview, then indexes and publishes it. Contributors submit drafts and texture sets for review. An editor moves drafts through review. Staff answer buyer support. The server uses PostgreSQL as the source of truth, MinIO for files, Kill Bill for the author's plan subscription and for every licence purchase and refund, Mailpit for outgoing email, and Meilisearch for the public catalogue index and its facets. Out of scope: buyer accounts (buyers are identified by email at checkout), other authors or marketplaces, tax calculation, real payment cards, social features, and any datastore beyond these five services.

## Problem and users

Independent 3D model authors give up 12 to 50 percent of every sale to marketplaces. Some marketplaces offer a better share only if the author sells nowhere else. Authors who leave end up with a patchwork: a generic shop plugin that can't preview a model, a file host that renames or recompresses uploads, a hand-run conversion script, and a spreadsheet of who bought which licence. That patchwork leaks money and trust in several ways:

- A private commission turns up in a search result or a facet count.
- A rebuilt model ships with yesterday's STL.
- A cancelled plan leaves embeds running on other sites for months.
- Two buyers both "win" the last numbered copy of an edition.
- The receipt and the invoice disagree by a cent.

The author pays for all of it twice: in refunds and chargebacks, and in evenings spent reconciling by hand. Turnstone Studio makes each of these outcomes impossible by construction.

Users:

- **Author** (daily): uploads a model with its dependent files and watches it move through the publishing queue. Sets visibility, prices and licences, sets the default camera and hotspots, and keeps plan limits, collections and catalogue files in order.
- **Visitor** (daily, no account): browses the faceted catalogue and inspects a model in the Survey Ring. Buys a licence or a numbered limited-edition copy.
- **Contributor** (weekly): submits model drafts and texture sets to the author's studio for review and sees nothing else of the author's.
- **Editor** (weekly): reviews submitted drafts, moves models between draft, in review, published and withdrawn, and curates collections.
- **Staff** (occasional): answers buyer support. Looks up orders, issues full and seat-prorated refunds, and checks queue and service health without ever seeing a provider credential.
- **Third-party developer** (acting with visitor rights): reads the public catalogue through the read API with a key the author issued.

## Journeys

1. **Upload and publish.** The author starts signed in on `/studio` on the Pro plan.
   1. They open the upload screen, choose a `.glb` file, enter a title, pick the source unit and category, and press Upload.
   2. The address bar shows `/studio/models/<slug>/queue`. The five queue stages turn from Pending to Confirmed one by one, and each confirmation is announced.
   3. They press Send to review, then Publish. The model page shows the state `Published`.
   4. Within five seconds the model appears in the public catalogue, with correct facet counts.
2. **Browse and inspect.** A visitor starts on `/catalogue`.
   1. They tick Commercial and STL, sort by price from low to high, and go to page 3. The count announcement updates after every change, without a reload.
   2. They press Back and see page 1 with the same filters, then press Forward to return to page 3. Pasting the address into a fresh browser shows the same page.
   3. They open a model. Using only the keyboard, they orbit, tilt, zoom and step through the hotspots, watching the Survey Ring numerals and the caliper line follow.
3. **Buy a licence.** A visitor starts on `/models/survey-lantern`.
   1. They press Buy Personal licence, enter an email, accept the terms and pay.
   2. They land on `/receipts/<receipt token>`, which shows the amount, download links and an invoice PDF.
   3. A receipt email with the same amount arrives. Kill Bill holds an invoice and a payment for that amount.
   4. Later the visitor upgrades to Commercial from the receipt page and pays only the difference.
4. **Race for the last copy.** Two visitors have the Basalt Warden checkout open when one copy is left. Both press Pay now. One lands on a receipt for copy No. 25 of 25. The other sees the sold-out refusal appear in their open dialog, and the edition shows Sold out everywhere without a reload.
5. **Contribute and review.** A contributor signs in and lands on `/contribute`. They upload a draft, attach a texture set and press Send to review. The editor signs in and lands on `/studio/review`, then either publishes the draft or returns it to draft. A stale button press shows the exact refusal for an illegal move.
6. **Control who sees what.** The author makes a model unlisted and copies its share link. They regenerate the link, and the old link stops working at once. They set a password on another model, and a visitor unlocks it with that password. They create an embed for a public model. Private, unlisted and password models never appear in search results, facet counts, recommendations, the export or the read API.
7. **Change plan.** The author opens `/studio/plan` and switches from Pro to Basic. The page says when the change takes effect, using the date Kill Bill confirmed, and nothing changes before that date. On that date, models over the Basic limit become read-only and leave the catalogue, and embeds stop working. Upgrading takes effect at once, and the prorated charge Kill Bill invoiced shows on the page and in an email.
8. **Support a buyer.** Staff sign in, land on `/staff`, look up an order by email, and refund one seat of a studio licence and then the rest. The refund amounts match on the order screen, in Kill Bill, on the receipt's invoice PDF and in the refund email. The health panel shows each service as up or down with no credentials.

## Mandatory requirements

This is the complete list of mandatory requirements; every check traces to one of these lines and the detailed sections below.

- **DP-01 — Plan-checked package limits.** The server refuses a package over the author's plan size limit, or of a type the plan doesn't accept, before any queue work starts, as qualified in API and Business rules.
- **DP-02 — Package type judged by content.** The server identifies a package by its bytes, not its file name, refuses a .glb that isn't a glTF binary with the published refusal, and refuses packages whose entries escape their folder.
- **DP-03 — Original stored byte for byte.** Every accepted package is stored in object storage under its content checksum exactly as uploaded, and downloading the original returns the same bytes and checksum whatever its derivatives went through.
- **DP-04 — Ordered publishing queue.** Each upload passes validate, transcode, preview, index and publish in that order, each stage pending, running, confirmed or failed, and nothing a stage produces is served before that stage confirms.
- **DP-05 — Unit-scaled derivatives.** The transcode stage writes a GLB in metres and a binary STL in millimetres, scaled from the declared source unit by the published factors.
- **DP-06 — Rebuilds never serve stale files.** Replacing a model's source invalidates its GLB, STL and preview at once so no outdated file is served again, and until the new revision's publish stage confirms every public and buyer route that would serve them answers the published rebuilding response, as qualified in API for studio sessions.
- **DP-07 — Upload lands on its queue page.** After an upload from the studio the address bar shows that model's queue page, each stage confirmation is announced in the queue live region, and reloading the address shows the same queue.
- **DP-08 — Published retry schedule.** A queue stage that fails on a dependency is retried on the published schedule, then marked failed, and the author can requeue a failed upload.
- **DP-09 — Storage and search outages.** When object storage or search is unreachable the studio shows the published outage banner, the affected endpoints answer the published 503 responses, and queue work waits on the retry schedule and resumes without a restart when the service returns.
- **DP-10 — Requeue a failed upload.** The author sees a failed stage on the queue page, presses Requeue and watches the stages run again with each change announced.
- **DP-11 — Faceted public catalogue.** The catalogue searches only indexed public models with category, licence and format facets, three sort orders and eight results per page, and returns facet counts for the current result set.
- **DP-12 — Catalogue state lives in the address.** Search text, facets, sort and page are kept in the address, Back and Forward restore them, and a cold load of the same address shows the same results.
- **DP-13 — Facet changes update in place.** Changing a facet, the sort or the search updates the result grid and facet counts without a page reload and announces the published result-count copy in the catalogue live region.
- **DP-14 — Catalogue breakpoints.** The catalogue and model page switch layout exactly at 768 and 1280 pixels wide as described in Screens and layout, with no horizontal overflow.
- **DP-15 — Browse to a model and back.** A visitor filters, sorts and pages through the catalogue, opens a model, returns with Back to the same page of results, and finds the model reachable at its deep link.
- **DP-16 — Survey Ring camera readout.** The viewer root publishes the camera's distance, field of view, tilt and azimuth computed and clamped by the published viewer geometry, and the ring's numerals and index mark show the same values.
- **DP-17 — Keyboard and touch viewer controls.** The published keys, drags, wheel and pinch move the camera in the published steps, the keys work whichever viewer control has focus, and a visible focus ring follows the published tab order.
- **DP-18 — Hotspots and caliper line.** Stepping between hotspots turns the camera to each hotspot, publishes its projected screen point, draws the caliper line to it and announces it in the viewer live region.
- **DP-19 — First-person heading mode.** First-person mode replaces the ring with a heading strip, places the eye at the published scaled eye height, leaves the heading unclamped and clamps the pitch.
- **DP-20 — Viewer motion and reduced motion.** Camera steps tween for about a fifth of a second and hotspot moves and resets for about a third, and under reduced motion every camera change, numeral and caliper snaps to its end value with identical attributes and announcements.
- **DP-21 — No-acceleration fallback.** When the browser can't create a hardware-accelerated 3D context the viewer shows the rendered preview image and the published fallback sentence, and the ring still shows the default camera's values.
- **DP-22 — Survey Ring craft.** The Survey Ring reads as a calibrated measuring instrument: hairline ticks, mono numerals with units, and vermilion only on the index mark, the caliper line and the active hotspot.
- **DP-23 — Author sets the default view.** The author orbits a model in the studio viewer, saves the default view, places and labels hotspots, saves them, and the public model page opens on that view with those hotspots.
- **DP-24 — One money computation.** Every amount is computed once in integer euro cents with half-up rounding at the published step, displayed in the viewer's locale format, and identical on screen, in Kill Bill, on the invoice PDF and in email.
- **DP-25 — Licence purchase recorded in Kill Bill.** A checkout records one external charge and one successful PURCHASE payment for the exact amount on the buyer's Kill Bill account before the receipt exists.
- **DP-26 — Idempotent checkout.** Repeating a checkout with the same Idempotency-Key and body returns the identical status and body with exactly one Kill Bill charge, and reusing the key with a different body answers the published 409.
- **DP-27 — Receipt email and invoice agree.** After Kill Bill confirms, the buyer receives one receipt email in their checkout locale, and the receipt's invoice PDF repeats the same amount.
- **DP-28 — Licence upgrade charges the difference.** A buyer upgrades a personal or commercial licence from its receipt and is charged the target licence's current price minus what the earlier order paid net of refunds.
- **DP-29 — Keyboard checkout to the receipt page.** A visitor using only the keyboard opens checkout from the licence table, completes the dialog in the published tab order, and lands on the receipt page with focus on its heading.
- **DP-30 — Staff order lookup and health.** Staff find orders by buyer email or order reference and see each service's up or down status and the queue counts, with no credential, provider URL or internal identifier in any response.
- **DP-31 — Full and seat-prorated refunds.** Staff refund a whole order or, for a studio licence, some of its seats at the published proration; each refund is recorded as a Kill Bill REFUND, is idempotent, and sends one refund email after Kill Bill confirms.
- **DP-32 — Refund a buyer.** Staff look up a buyer's order, refund one seat and then the rest, and the order screen announces each refunded amount and shows the matching status.
- **DP-33 — One winner for the last copy.** When several checkouts claim the last copy of a limited edition at the same moment, exactly one gets it and every other answers the published sold-out refusal.
- **DP-34 — Live edition availability.** The edition counter on the model page updates within two seconds of any sale without a reload, and an open checkout dialog for a sold-out edition shows the sold-out refusal live.
- **DP-35 — Buy a numbered copy.** A visitor buys an edition copy and lands on a receipt naming the copy number and edition size.
- **DP-36 — Visibility holds on every derived surface.** Private, unlisted, password-protected, withdrawn and over-limit models never appear in the search index, results, facet counts, recommendations, catalogue export or read API.
- **DP-37 — Unlisted share links.** An unlisted model is reachable only through its share link, and regenerating the link makes the old one answer not found at once.
- **DP-38 — Password-protected models.** A password-protected model reveals its page, files and checkout only after the correct password, and changing the password, withdrawing the model or making it read-only ends every earlier unlock.
- **DP-39 — Embeds follow entitlement.** An embed shows its model only while the model is published, public or unlisted, within plan, and the active plan includes embeds; otherwise it shows the published unavailable page.
- **DP-40 — Change a model's visibility.** The author switches a model between public, unlisted, private and password-protected in the studio, and the catalogue counts and share controls reflect each change.
- **DP-41 — Plan comes from Kill Bill.** The plan the studio shows and enforces is the plan Kill Bill reports as active, and a change made in Kill Bill takes effect in the app within twenty seconds.
- **DP-42 — Upgrades apply at once with proration.** An upgrade takes effect immediately, and the prorated amount Kill Bill invoiced is shown and emailed to the author.
- **DP-43 — Downgrades wait for the confirmed date.** A downgrade changes no quota, read-only state or embed until the effective date Kill Bill confirmed, and on that date over-limit models become read-only and capabilities above the new plan stop everywhere.
- **DP-44 — Publish quota per billing cycle.** Each move to published uses one publish from the plan's quota for the current billing cycle, and the quota badge shows the count and the reset date taken from Kill Bill.
- **DP-45 — Change plan from the plan page.** The author changes plan in a confirmation dialog, stays on /studio/plan, and sees the published notice for that change.
- **DP-46 — Model state machine.** Models move only along the published legal edges by the published roles, every illegal move answers the published refusal, and studio controls are enabled only in states that allow them.
- **DP-47 — Contributors reach only their own drafts.** A contributor who names any model other than their own, in a route or in a request body, gets the published not-found response.
- **DP-48 — Texture set submissions.** A contributor attaches a ZIP of PNG and JPEG images to their own draft, checked entry by entry by content and stored byte for byte.
- **DP-49 — Review a contributor draft.** A contributor submits a draft for review, the editor publishes it or returns it to draft, and a stale control shows the exact illegal-move refusal.
- **DP-50 — Counters agree with their rows.** Collection item counts, catalogue totals and the quota badge equal a recount of the underlying records after every create, move, delete, state change and failed queue job.
- **DP-51 — Public catalogue export.** The author downloads a CSV of exactly the models the public catalogue shows, with spreadsheet formula characters neutralised by the published rule.
- **DP-52 — Curate collections.** The author or editor creates a collection, adds models, moves one to another collection and deletes one, and every count on screen updates after each action.
- **DP-53 — Read API published surface.** The read API exposes only its two published routes and published fields, refuses unknown query parameters, and answers 404, 405 and 415 outside its surface.
- **DP-54 — Read API keys and rate limits.** Read API keys are issued and revoked by the author, limited per plan, and rate-limited per key with a Retry-After hint.
- **DP-55 — Sign-in and role landing routes.** Signing in lands each role on its published route, and every studio, contributor and staff route refuses other roles.
- **DP-56 — Two locales.** Every screen, amount and date renders in English or German in the published formats, switching keeps the reading position, and the address carries the choice so a cold load reads in the same locale.
- **DP-57 — Studio dashboard breakpoints.** The studio dashboard switches layout exactly at 768 and 1280 pixels wide as described in Screens and layout, with no horizontal overflow.
- **DP-58 — Server boundary.** The server applies the published request limits, accepts state changes only from its own origin, serves no source, configuration or credential files, and starts and recovers with any provider unreachable.
- **DP-59 — Drafting-table visual identity.** Every screen uses the bone ground, ink text, hairline rules, teal actions, the 12-column drafting grid and mono numerals with units described in Visual design.
- **DP-60 — Credentials stay on the server.** Every provider URL and credential is read from the environment at start, used only on the server, and never written into code, pages, scripts or responses.

## Frontend

### Screens and layout (DP-07, DP-14, DP-15, DP-23, DP-29, DP-57)

Every screen has a top bar with the wordmark link, a Catalogue link, the language picker and either a Sign in link or the signed-in role's area link with Sign out. Content sits on a 12-column drafting grid with hairline rules between regions. At every published viewport (375x812, 768x1024, 1280x800) no page scrolls horizontally. Layouts switch exactly when the viewport is 768 pixels wide or wider, and 1280 pixels wide or wider.

- **Catalogue** (`/catalogue`): a heading, a search box, the facet rail (Category, Licence, Format groups, each value with its count beside it), a sort picker, the card grid and pagination. Each card shows the preview, title, category, format tags and the "from" price.
  - Below 768: the cards form one column. The facet rail is hidden behind a Filters button above the grid that opens the Filters sheet from the bottom of the screen.
  - 768 to 1279: the facet rail takes four of twelve columns on the left and the grid shows two cards per row.
  - 1280 and up: the rail takes three columns and the grid shows four cards per row.
- **Model page** (`/models/<slug>`, `/u/<share token>`): the viewer inside the Survey Ring, a readout of the camera numbers, the hotspot and view buttons, then the Licences table (licence, seats, price, buy button), the Specifications table (width, height and depth in millimetres, formats, figure scale, edition), and "More from the workshop" with up to four cards.
  - 768 and up: the viewer takes eight of twelve columns and the tables sit in the remaining four.
  - Below 768: the viewer spans the full width, with the tables stacked under it. The ring's diameter fits the viewport width less the page margins.
- **Password gate** (`/models/<slug>` of a password-protected model before unlocking): the model title, a Password field and an Unlock button, and nothing else of the model.
- **Embed** (`/embed/<embed token>`): only the viewer, the ring and a link back to the model page. Without entitlement it shows only the embed-unavailable copy from Feedback states.
- **Receipt** (`/receipts/<receipt token>`): the receipt heading, licence, amount, refunded amount and status, the edition copy line when there is one, download links for GLB and STL, the Invoice PDF link and the upgrade buttons the order allows.
- **Sign in** (`/sign-in`).
- **Studio dashboard** (`/studio`): the studio navigation (Dashboard, Upload, Review, Collections, Plan, API keys, Export), the quota badge, the Catalogue totals region, the Models table (Title, State, Visibility, Price from, Queue) and the Queue panel listing the latest five uploads.
  - Below 768: the navigation collapses into a Studio menu button that opens the Studio menu sheet. The totals form two columns, the Models table shows only Title and State, and the Queue panel sits below the table.
  - 768 to 1279: the navigation is a horizontal bar under the top bar. Totals, badge, table and Queue panel are stacked full width.
  - 1280 and up: the navigation is a left sidebar of two columns. The Models table takes seven columns and the Queue panel the remaining three.
- **Studio model page** (`/studio/models/<slug>`): the settings form (title, description, category, visibility, password, prices, discount, edition size), state controls, the studio viewer with view and hotspot controls, the share link and embeds panel, the Replace source button and the original download link. It uses the same column split as the public model page.
- **Queue page** (`/studio/models/<slug>/queue`, and `/contribute/models/<slug>` for contributors): the five stages in order, each with its status, attempt count and next retry time, plus a Requeue button when the upload has failed. On a contributor's queue page there is also a Send to review button, enabled only while the model is a draft.
- **Upload** (`/studio/upload`): the model file, title, source unit and category fields, the Upload button and an upload progress bar.
- **Review** (`/studio/review`): the in-review models with their submitter and the four state buttons.
- **Collections** (`/studio/collections`): each collection with its item count and items, plus add, move, remove, rename and delete controls.
- **Plan** (`/studio/plan`): the current plan, any pending change with its date, the quota badge and the four-plan comparison table with Switch buttons.
- **API keys** (`/studio/api-keys`): the key list (name, reference, created date) with Revoke buttons and a create form.
- **Contributor area** (`/contribute`): the contributor's own models with their states, an upload form and the texture set form.
- **Staff** (`/staff`, `/staff/orders/<order ref>`): the order search, results and order detail with the refund controls, and the Service health panel.

### Public screens and controls (DP-12, DP-13, DP-17, DP-18, DP-21, DP-29, DP-34, DP-55, DP-56)

Only the controls and regions below are public. Every other element is free. Names are listed in English, then German. Placeholders are filled from the record.

| Screen | Role and accessible name (en / de) | Notes |
|---|---|---|
| All | `link "Turnstone Studio"` | Goes to `/catalogue`, keeping `lang`. |
| All | `link "Catalogue"` / `link "Katalog"` | |
| All | `combobox "Language"` / `combobox "Sprache"` | Options `English`, `Deutsch`. |
| All | `link "Sign in"` / `link "Anmelden"`, `button "Sign out"` / `button "Abmelden"` | The signed-in area link is named `Studio` for author and editor, `Contribute` / `Beitragen` for a contributor, and `Staff` / `Support` for staff. The top bar order is wordmark, Catalogue, Language, then Sign in or the area link and Sign out. |
| All | `region "Service status"` / `region "Dienststatus"` | Present only during an outage. Holds the banner copy. |
| Catalogue | `heading "Catalogue"` / `heading "Katalog"` (level 1) | |
| Catalogue | `searchbox "Search models"` / `searchbox "Modelle suchen"` | |
| Catalogue | `group "Category"` / `group "Kategorie"` with `checkbox "Hard-surface prop"` / `"Hard-Surface-Requisite"`, `checkbox "Miniature"` / `"Miniatur"`, `checkbox "Scanned object"` / `"Gescanntes Objekt"` | The count is shown as text right after each label. |
| Catalogue | `group "Licence"` / `group "Lizenz"` with `checkbox "Personal"` / `"Privat"`, `checkbox "Commercial"` / `"Kommerziell"`, `checkbox "Studio"` / `"Studio"` | Same. |
| Catalogue | `group "Format"` / `group "Format"` with `checkbox "GLB"`, `checkbox "STL"` | Same. |
| Catalogue | `combobox "Sort"` / `combobox "Sortierung"` | Options `Newest` / `Neueste`, `Price: low to high` / `Preis aufsteigend`, `Price: high to low` / `Preis absteigend`. |
| Catalogue | `status "Catalogue results"` / `status "Katalogergebnisse"` | Holds the result-count copy. |
| Catalogue | `list "Results"` / `list "Ergebnisse"`, one `listitem` per card, each with `link "<title>"` | |
| Catalogue | `navigation "Pages"` / `navigation "Seiten"` with `link "Previous page"` / `"Vorherige Seite"`, `link "Page <n>"` / `"Seite <n>"`, `link "Next page"` / `"Nächste Seite"` | The current page link carries `aria-current="page"`. |
| Catalogue below 768 | `button "Filters"` / `button "Filter"` opens `dialog "Filters"` / `dialog "Filter"`, which has `button "Show results"` / `button "Ergebnisse anzeigen"` | |
| Model page | `heading "<title>"` (level 1) | |
| Model page | `group "Model viewer"` / `group "Modellansicht"` | The viewer root. Focusable, and carries the viewer data attributes. |
| Model page | `img "Survey Ring"` / `img "Messring"` | SVG ring with 72 tick lines, each carrying `data-azimuth-tick` with its degree value 0, 5, …, 355. In first-person mode it is `img "Heading strip"` / `img "Kursleiste"`. |
| Model page | Ring parts, found by `data-part` inside `img "Survey Ring"` | `data-part="index-mark"` carries `data-angle`, the azimuth in degrees (equal to the root's `data-azimuth`). `data-part="tilt-marker"` carries `data-angle`, the tilt in degrees. `data-part="caliper"` exists only while a hotspot is active and carries `data-x1`, `data-y1` (the centre of the index mark) and `data-x2`, `data-y2` (the hotspot point, equal to `data-hotspot-x` and `data-hotspot-y`). `data-part="hotspot-dot"` exists once per hotspot with `data-index` (1-based), and the active one carries `data-active="true"`. All coordinates are canvas CSS pixels rounded to 0.1. The ring is centred on the canvas centre with a radius of half the canvas's shorter side, so the index mark's centre is (W/2 + r·sin a, H/2 − r·cos a). Like the root's attributes, these hold end values at once while the drawn marks tween (see Motion and effects). In first-person mode these parts are absent. |
| Model page | `group "Camera readout"` / `group "Kamerawerte"` | Mono lines `Distance <d> mm`, `FOV <f>°`, `Tilt <t>°`, `Azimuth <a>°` (de: `Abstand`, `Blickwinkel`, `Neigung`, `Azimut`). |
| Model page | `button "Previous hotspot"` / `"Vorheriger Hotspot"`, `button "Next hotspot"` / `"Nächster Hotspot"`, `button "First-person view"` / `"Ich-Perspektive"` (with `aria-pressed`), `button "Reset view"` / `"Ansicht zurücksetzen"` | |
| Model page | `status "Viewer announcements"` / `status "Ansichtsmeldungen"` | |
| Model page | `img "Rendered preview of <title>"` / `img "Gerenderte Vorschau von <title>"` | Fallback only. |
| Model page | `table "Licences"` / `table "Lizenzen"` with `button "Buy Personal licence"` / `"Privatlizenz kaufen"`, `button "Buy Commercial licence"` / `"Kommerzielle Lizenz kaufen"`, `button "Buy Studio licence"` / `"Studiolizenz kaufen"`, `button "Buy numbered copy"` / `"Nummeriertes Exemplar kaufen"` | Only the licences the model offers. |
| Model page | `table "Specifications"` / `table "Technische Daten"` | |
| Model page | `status "Edition availability"` / `status "Verfügbarkeit der Edition"` | Edition models only. |
| Model page | `region "More from the workshop"` / `region "Mehr aus der Werkstatt"` | |
| Checkout | `dialog "Checkout"` / `dialog "Kasse"` containing `textbox "Email"` / `textbox "E-Mail"`, `checkbox "I accept the licence terms"` / `"Ich akzeptiere die Lizenzbedingungen"`, `button "Pay now"` / `"Jetzt bezahlen"`, `button "Cancel"` / `"Abbrechen"`, and `status "Checkout status"` / `status "Kassenstatus"` | The dialog shows the licence name and the amount. |
| Any form | `alert` titled with the error-summary copy | One link per field error, which focuses the field. |
| Password gate | password field labelled `Password` / `Passwort`, `button "Unlock"` / `"Entsperren"` | |
| Receipt | `heading "Receipt <order ref>"` / `heading "Beleg <order ref>"` (level 1) | |
| Receipt | `link "Download GLB"` / `"GLB herunterladen"`, `link "Download STL"` / `"STL herunterladen"`, `link "Invoice PDF"` / `"Rechnung (PDF)"`, `button "Upgrade to Commercial"` / `"Auf Kommerziell upgraden"`, `button "Upgrade to Studio"` / `"Auf Studio upgraden"` | |
| Sign in | `textbox "Email"` / `"E-Mail"`, password field `Password` / `Passwort`, `button "Sign in"` / `"Anmelden"` | |
| Studio | `navigation "Studio"` | Below 768 it sits behind `button "Studio menu"` / `"Studiomenü"`, which opens `dialog "Studio menu"` / `dialog "Studiomenü"`. |
| Studio | `status "Quota"` / `status "Kontingent"` | Holds the quota badge copy. |
| Studio | `region "Catalogue totals"` / `region "Katalogsummen"` | Lines `Public <n>`, `Unlisted <n>`, `Password <n>`, `Private <n>`, `Drafts <n>`, `In review <n>`, `Withdrawn <n>` (de: `Öffentlich`, `Nicht gelistet`, `Passwort`, `Privat`, `Entwürfe`, `In Prüfung`, `Zurückgezogen`). |
| Studio | `table "Models"` / `table "Modelle"`, `region "Queue"` / `region "Warteschlange"` | |
| Studio | `status "Studio notices"` / `status "Studiohinweise"` | |
| Upload | file input labelled `Model file` / `Modelldatei`, `textbox "Title"` / `"Titel"`, `combobox "Source unit"` / `"Quelleinheit"` (options `Millimetres`, `Centimetres`, `Metres`, `Inches` / `Millimeter`, `Zentimeter`, `Meter`, `Zoll`), `combobox "Category"` / `"Kategorie"`, `button "Upload"` / `"Hochladen"`, `progressbar "Upload progress"` / `"Upload-Fortschritt"` | |
| Queue page | `list "Queue stages"` / `list "Warteschlangenschritte"` with one `listitem` per stage showing its stage name and status, `button "Requeue"` / `"Erneut einreihen"`, `status "Queue progress"` / `status "Warteschlangenfortschritt"` | |
| Studio model | `button "Send to review"` / `"Zur Prüfung senden"`, `button "Return to draft"` / `"Zurück zum Entwurf"`, `button "Publish"` / `"Veröffentlichen"`, `button "Withdraw"` / `"Zurückziehen"` | All four are always present, and disabled where the state machine doesn't allow them. |
| Studio model | `combobox "Visibility"` / `"Sichtbarkeit"` (options `Public`, `Unlisted`, `Private`, `Password protected` / `Öffentlich`, `Nicht gelistet`, `Privat`, `Passwortgeschützt`), `button "Save changes"` / `"Änderungen speichern"`, `button "New share link"` / `"Neuer Freigabelink"`, `button "Create embed"` / `"Einbettung erstellen"`, `button "Remove embed"` / `"Einbettung entfernen"`, `button "Replace source"` / `"Quelle ersetzen"`, `link "Download original"` / `"Original herunterladen"`, `button "Save as default view"` / `"Als Standardansicht speichern"`, `button "Add hotspot"` / `"Hotspot hinzufügen"`, `textbox "Hotspot label"` / `"Hotspot-Beschriftung"`, `button "Save hotspots"` / `"Hotspots speichern"` | |
| Studio model | `status "Read-only"` / `status "Schreibgeschützt"` | Present only when the model is read-only. |
| Collections | `textbox "Collection name"` / `"Name der Sammlung"`, `button "Create collection"` / `"Sammlung erstellen"`, one `region "<collection name>"` per collection with `button "Move <title>"` / `"<title> verschieben"`, `button "Remove <title>"` / `"<title> entfernen"`, `button "Delete collection"` / `"Sammlung löschen"` | The item count is shown in the region heading as `<name> (<count>)`. |
| Plan | `heading "Plan"` / `heading "Tarif"`, `table "Plans"` / `table "Tarife"` with `button "Switch to <plan>"` / `"Zu <plan> wechseln"`, `dialog "Change plan"` / `dialog "Tarif ändern"` with `button "Confirm change"` / `"Änderung bestätigen"` | |
| Export | `link "Download catalogue CSV"` / `"Katalog-CSV herunterladen"` | |
| API keys | `textbox "Key name"` / `"Schlüsselname"`, `button "Create key"` / `"Schlüssel erstellen"`, `button "Revoke <name>"` / `"<name> widerrufen"` | |
| Contributor | `textbox "Texture set name"` / `"Name des Textursets"`, file input `Texture archive` / `Texturarchiv`, `combobox "Draft"` / `"Entwurf"`, `button "Submit texture set"` / `"Texturset einreichen"`, and `button "Send to review"` / `"Zur Prüfung senden"` on the contributor's queue page at `/contribute/models/<slug>` | |
| Staff | `searchbox "Find orders"` / `"Bestellungen finden"`, `table "Orders"` / `"Bestellungen"`, `button "Refund in full"` / `"Vollständig erstatten"`, `spinbutton "Seats to refund"` / `"Zu erstattende Plätze"`, `button "Refund seats"` / `"Plätze erstatten"`, `region "Service health"` / `"Dienstzustand"`, `status "Staff notices"` / `"Mitarbeiterhinweise"` | |

### Interactions (DP-12, DP-13, DP-15, DP-17, DP-18, DP-19, DP-23, DP-29, DP-34, DP-56)

**Catalogue**

- Ticking or unticking a facet, changing the sort, or typing in the search box updates the results in place. Search fires 300 milliseconds after the last keystroke. The page doesn't reload.
- Each change replaces the address query with the parameters of `GET /api/catalogue`, plus the address's `lang` value when it carries one. It pushes one history entry. Any facet, sort or search change resets the page to 1.
- Facet values in the address are listed in the order shown in the rail, separated by commas. Parameters with default values (sort `newest`, page 1, empty search) are left out.
- Back and Forward restore the facets, sort, search and page in place and refresh the results. A cold load of the address renders the same state on first paint.
- Page links are real links to the full address.
- Below 768, the Filters sheet holds the same controls. The results update behind it as values change, and Show results closes it.

**Viewer**

The viewer root takes focus with Tab. Keys act while focus is on the viewer root or any of its four buttons. They never act while typing in a text field. The step sizes and limits are in Business rules, Viewer geometry.

- ArrowRight and ArrowLeft add or subtract one azimuth step.
- ArrowUp and ArrowDown add or subtract one tilt step.
- `+` (or `=`) moves the camera one distance step closer. `-` moves it one step away.
- `]` and `[` widen or narrow the field of view by one step.
- `H` steps to the next hotspot. `Shift+H` steps to the previous one, wrapping at either end.
- `F` toggles first-person mode. `0` resets to the default camera with no active hotspot.
- Escape leaves first-person mode.
- Dragging on the canvas (mouse or one finger) moves one azimuth step for every whole 24 pixels of horizontal travel, dragging right adds. It moves one tilt step for every whole 24 pixels of vertical travel, dragging up adds. Travel accumulates during one drag, so 36 pixels is one step, and travel under 24 pixels that ends on release changes nothing.
- One mouse-wheel notch is one distance step: scrolling up (wheel away from the user) moves closer, scrolling down moves away. A two-finger pinch moves one distance step for every whole 10 percent change in finger spread relative to the spread at the last step: spreading the fingers apart moves closer, pinching them together moves away. A partial change under 10 percent counts as nothing.
- Selecting a hotspot by key or button turns the camera to that hotspot, draws the caliper line from the ring to the hotspot's projected point, and announces the hotspot. Orbiting keeps the hotspot active and the caliper follows it.
- In first-person mode, ArrowRight adds one heading step and ArrowLeft subtracts one (the heading convention is in Viewer geometry), and ArrowUp raises the pitch by one step and ArrowDown lowers it. Only F, Escape and the arrow keys act. `+`, `-`, `[`, `]`, `H`, `Shift+H` and `0` do nothing, and the hotspot attributes are absent.

**Studio viewer**

- Save as default view stores the current azimuth, tilt, distance and field of view.
- Add hotspot puts the viewer into placing mode. The next click or tap on the model places a hotspot at the surface point under the pointer. Enter places it where the line of sight through the canvas centre meets the model.
- The new hotspot's label field then takes focus. Save hotspots stores every hotspot.
- The public page opens on the saved view and lists the hotspots in saved order.

**Tab order**

- Model page: the top bar (wordmark, Catalogue, Language, then Sign in or the role's area link and Sign out), the viewer root, Previous hotspot, Next hotspot, First-person view, Reset view, the licence buy buttons in table order, then the recommendation links.
- Catalogue: the top bar in the same order, Search models, the facet checkboxes group by group in rail order, Sort, the result links in grid order, then the pagination links.

Focus shows as a vermilion ring around the control, with a small gap, on every focusable element.

**Dialogs and sheets** (Checkout, Filters, Studio menu, Change plan)

- Opening one moves focus to its first field or control.
- Tab from the last control wraps to the first, and Shift+Tab from the first wraps to the last. Focus never reaches the page behind.
- Escape or Cancel closes it and returns focus to the control that opened it.
- Checkout tab order: Email, I accept the licence terms, Pay now, Cancel.
- Enter on Pay now submits. On success the browser navigates to `/receipts/<receipt token>` and focus lands on the receipt heading.
- One Idempotency-Key is made when the dialog opens and is reused for every submit from that dialog, so pressing Pay now twice or retrying after a network error never charges twice.

**Edition availability**

The edition availability text refreshes at least once a second while the page is open, so a sale shows within two seconds. When it reaches zero, every Buy numbered copy button disables. If a Checkout dialog for that edition is open, the sold-out refusal appears in its `alert` and Pay now disables, without a reload.

**Queue page**

The page refreshes at least once a second while open, so the stage list and its announcements show any stage change within two seconds.

**Language**

Choosing a language re-renders every published string, amount and date in place. It rewrites `lang` in the address with a replace (no new history entry), as stated in Locale formats, keeps the scroll position, and keeps focus on the language picker.

**Touch**

Every control is operable by tap. The viewer orbits by one-finger drag and zooms by pinch at every viewport.

### Visual design (DP-22, DP-59)

- **Mood.** The product looks like a quiet drafting table. The page ground is a warm bone off-white. Text is a near-black blue-tinted ink. Regions are separated by one-pixel hairline rules in a warm stone grey, with no drop shadows and no rounded blobs.
- **Colour roles.**
  - A deep sea-teal fills primary buttons and colours links.
  - Vermilion is reserved for active measurement marks (the ring's index mark, the caliper line and the active hotspot dot) and for the focus ring. It never colours body text or decorative areas.
  - Disabled controls are stone grey on bone, with the label still readable.
- **Type.**
  - Headings use Space Grotesk, a squared geometric sans with open letterforms.
  - Body text uses IBM Plex Sans.
  - Every numeral that carries a unit (millimetres, degrees, euros, byte limits, counts with units) is set in IBM Plex Mono with its unit.
  - Each heading level is one quarter larger than the level below it, starting from body size.
- **Density.** Comfortable spacing. Catalogue cards show the preview at a four-by-three proportion with title, category and price beneath, separated by hairlines. Tables use hairline row rules and generous row height.
- **Composition.** The 12-column grid is visible in the alignment of rails, tables and the ring. The model page gives two thirds of its width to the viewer inside the ring at 768 and above.
- **Survey Ring.**
  - A thin calibrated circle surrounds the canvas, with 72 short hairline ticks. Every sixth tick is longer and labelled in mono degrees.
  - A tilt arc runs along its right edge from minus 10 to plus 80 degrees, with its own marker.
  - A vermilion index mark sits on the ring at the current azimuth.
  - The four camera numerals sit in a mono readout block beside or under the ring.
- **Accessibility.** Every interactive control is at least 44 by 44 pixels to tap. Text and controls meet WCAG 2.2 AA contrast (4.5 to 1 for body text, 3 to 1 for large text, icons and the focus ring) on the bone ground.

### Motion and effects (DP-20, DP-21)

All motion starts quickly and settles gently. Nothing loops: no spinners, no shimmer, no idle rotation and no decorative movement of any kind. The 3D model holds still until the visitor gives input.

- **Camera steps.** Each single key, drag or wheel step tweens the camera, the ring's index mark, the tilt marker and the caliper line from the old value to the new one in 150 to 220 milliseconds. The mono numerals count through the intermediate values in the same time.
- **Hotspot moves and resets.** Moving to a hotspot and Reset view tween over 280 to 380 milliseconds. The caliper line grows from the ring to the hotspot point in the same time.
- **The `data-animating` attribute.** While a tween runs, the viewer root carries `data-animating="true"`. Otherwise it is `"false"`. The data attributes in Viewer geometry hold the end value from the moment the input lands, so they never show intermediate values.
- **Sheets and dialogs.** Sheets slide up from the bottom and dialogs fade in, in about a quarter of a second. They leave the same way in about a fifth of a second.
- **Results.** The catalogue result grid cross-fades its cards in under a fifth of a second when results change.
- **Queue stages.** A stage that confirms draws its tick mark in under a fifth of a second. A running stage shows a still marker, not a spinner.
- **Upload progress.** The upload progress bar fills in step with the bytes sent.
- **Hover and press.** Hovering a card or button darkens its hairline border to ink within a tenth of a second. Pressing a button nudges it down by one pixel.
- **Reduced motion.** When the operating system asks for reduced motion:
  - Camera moves, the index mark, the tilt marker and the caliper line jump straight to their end values, and `data-animating` stays `"false"`.
  - The numerals swap directly to the new values.
  - Sheets, dialogs, result changes and tick marks appear and disappear at once.
  - The data attributes, key steps, drag and pinch behaviour and every announcement stay exactly the same. Orbiting by drag and keyboard keeps working at 375 pixels wide.
- **No hardware acceleration.** If the browser refuses a hardware-accelerated 3D context, the canvas is never created:
  - The viewer shows the model's rendered preview image and the fallback sentence from Feedback states.
  - The ring still draws with its index mark, tilt marker and numerals set to the default camera.
  - The viewer root carries `data-render="preview"`, with the default camera's attributes. Viewer keys and drags change nothing.
  - With a 3D context, the viewer root carries `data-render="webgl"`.

### Feedback states (DP-09, DP-13, DP-18, DP-21, DP-29, DP-31, DP-34, DP-38, DP-44, DP-46, DP-56)

Every async action shows a pending state, then success, field errors or an outage message. Each is shown visibly and announced through the named live region listed for it. API `message` values are the English copy below for their error code. The UI shows the copy in the current locale. Placeholders are formatted in the current locale.

**Error codes**

| Code | English (also the API message) | German |
|---|---|---|
| `not_found` | `Not found.` | `Nicht gefunden.` |
| `method_not_allowed` | `Method not allowed.` | `Methode nicht erlaubt.` |
| `unsupported_media_type` | `This content type isn't accepted here.` | `Dieser Inhaltstyp wird hier nicht angenommen.` |
| `body_too_large` | `This request is too large.` | `Diese Anfrage ist zu groß.` |
| `unknown_parameter` | `Unknown parameter: <name>.` | `Unbekannter Parameter: <name>.` |
| `idempotency_key_required` | `Add an Idempotency-Key header to this request.` | `Füge dieser Anfrage einen Idempotency-Key-Header hinzu.` |
| `idempotency_key_invalid` | `The Idempotency-Key must be 8 to 64 letters, digits, - or _.` | `Der Idempotency-Key muss aus 8 bis 64 Buchstaben, Ziffern, - oder _ bestehen.` |
| `idempotency_key_reused` | `This Idempotency-Key was already used with a different request.` | `Dieser Idempotency-Key wurde bereits für eine andere Anfrage verwendet.` |
| `cross_origin` | `This request came from another site.` | `Diese Anfrage kam von einer anderen Website.` |
| `unauthenticated` | `Sign in to continue.` | `Melde dich an, um fortzufahren.` |
| `invalid_credentials` | `That email and password don't match.` | `E-Mail und Passwort passen nicht zusammen.` |
| `invalid_api_key` | `This API key isn't valid.` | `Dieser API-Schlüssel ist ungültig.` |
| `rate_limited` | `Too many requests. Retry after <seconds> seconds.` | `Zu viele Anfragen. Versuche es in <seconds> Sekunden erneut.` |
| `forbidden` | `You don't have access to this.` | `Darauf hast du keinen Zugriff.` |
| `not_in_plan` | `Your plan doesn't include this.` | `Dein Tarif enthält das nicht.` |
| `password_required` | `This model is password protected.` | `Dieses Modell ist passwortgeschützt.` |
| `wrong_password` | `That password doesn't match.` | `Das Passwort stimmt nicht.` |
| `illegal_transition` | `A model that is <from> can't become <to>.` | `Ein Modell im Status <from> kann nicht zu <to> wechseln.` |
| `not_ready` | `This model has no finished files to publish yet.` | `Dieses Modell hat noch keine fertigen Dateien zum Veröffentlichen.` |
| `not_deletable` | `Only a draft can be deleted.` | `Nur ein Entwurf kann gelöscht werden.` |
| `quota_reached` | `You've used all <limit> publishes for this billing cycle.` | `Du hast alle <limit> Veröffentlichungen dieses Abrechnungszeitraums genutzt.` |
| `read_only` | `This model is over your plan's limit and is read-only.` | `Dieses Modell liegt über dem Limit deines Tarifs und ist schreibgeschützt.` |
| `visibility_conflict` | `Embeds work only for public or unlisted models.` | `Einbettungen funktionieren nur für öffentliche oder nicht gelistete Modelle.` |
| `not_failed` | `Only a failed upload can be requeued.` | `Nur ein fehlgeschlagener Upload kann erneut eingereiht werden.` |
| `already_in_collection` | `This model is already in that collection.` | `Dieses Modell ist bereits in dieser Sammlung.` |
| `plan_unchanged` | `You're already on this plan.` | `Du nutzt diesen Tarif bereits.` |
| `edition_sold_out` | `Someone else just claimed the last copy. This edition is sold out.` | `Jemand anderes hat gerade das letzte Exemplar erhalten. Diese Edition ist ausverkauft.` |
| `edition_unavailable` | `This edition isn't on sale right now.` | `Diese Edition ist gerade nicht im Verkauf.` |
| `edition_locked` | `The edition size can't change after the first sale.` | `Die Editionsgröße kann nach dem ersten Verkauf nicht mehr geändert werden.` |
| `upgrade_not_possible` | `This licence can't be upgraded to that one.` | `Diese Lizenz kann nicht auf diese Lizenz erweitert werden.` |
| `nothing_to_refund` | `Nothing is left to refund on this order.` | `Für diese Bestellung ist nichts mehr zu erstatten.` |
| `licence_refunded` | `This licence was refunded, so its files are no longer available.` | `Diese Lizenz wurde erstattet, ihre Dateien sind nicht mehr verfügbar.` |
| `derivatives_rebuilding` | `This model's files are being rebuilt. Try again in a few minutes.` | `Die Dateien dieses Modells werden neu erstellt. Versuche es in ein paar Minuten noch einmal.` |
| `file_too_large` | `This file is larger than your plan allows (<limit> bytes).` | `Diese Datei ist größer, als dein Tarif erlaubt (<limit> Bytes).` |
| `content_mismatch` | `This file is named .glb but isn't a glTF binary.` | `Diese Datei heißt .glb, ist aber kein glTF-Binary.` |
| `unsupported_type` | `This file isn't a glTF binary or a glTF package.` | `Diese Datei ist weder ein glTF-Binary noch ein glTF-Paket.` |
| `type_not_in_plan` | `Your plan accepts .glb files only.` | `Dein Tarif akzeptiert nur .glb-Dateien.` |
| `validation_failed` | `Check the highlighted fields.` | `Prüfe die markierten Felder.` |
| `storage_unavailable` | `File storage is unavailable right now. Try again shortly.` | `Der Dateispeicher ist gerade nicht erreichbar. Versuche es gleich noch einmal.` |
| `search_unavailable` | `Search is unavailable right now. Try again shortly.` | `Die Suche ist gerade nicht erreichbar. Versuche es gleich noch einmal.` |
| `billing_unavailable` | `Billing is unavailable right now. Nothing has been charged or changed.` | `Die Abrechnung ist gerade nicht erreichbar. Es wurde nichts berechnet oder geändert.` |

In error copy, `<limit>` in `file_too_large` is plain digits with no separators. `<from>` and `<to>` are the state labels: `draft`, `in review`, `published`, `withdrawn` (de: `Entwurf`, `In Prüfung`, `Veröffentlicht`, `Zurückgezogen`).

**Field errors** (in `fields`, English in the API)

| Field | English | German |
|---|---|---|
| `title` | `Enter a title of 1 to 120 characters.` | `Gib einen Titel mit 1 bis 120 Zeichen ein.` |
| `description` | `Keep the description to 2000 characters.` | `Die Beschreibung darf höchstens 2000 Zeichen haben.` |
| `email` | `Enter a valid email address.` | `Gib eine gültige E-Mail-Adresse ein.` |
| `terms` | `Accept the licence terms to continue.` | `Akzeptiere die Lizenzbedingungen, um fortzufahren.` |
| `password` | `Use 8 to 64 characters.` | `Verwende 8 bis 64 Zeichen.` |
| `price` | `Enter a price from 1.00 to 1000.00 euros.` | `Gib einen Preis von 1,00 bis 1000,00 Euro ein.` |
| `discount` | `Enter a whole number from 0 to 90.` | `Gib eine ganze Zahl von 0 bis 90 ein.` |
| `camera` | `Keep the camera within the viewer's limits.` | `Halte die Kamera innerhalb der Grenzen der Ansicht.` |
| `hotspots` | `Use up to 8 hotspots inside the model's bounds, each labelled with 1 to 60 characters.` | `Verwende bis zu 8 Hotspots innerhalb des Modells mit je 1 bis 60 Zeichen Beschriftung.` |
| `file` (path escape) | `The package contains a path outside its folder.` | `Das Paket enthält einen Pfad außerhalb seines Ordners.` |
| `file` (texture content) | `Every file in a texture set must be a PNG or JPEG image.` | `Jede Datei in einem Texturset muss ein PNG- oder JPEG-Bild sein.` |
| `seats` | `Choose fewer seats than the licence still holds.` | `Wähle weniger Plätze, als die Lizenz noch hat.` |
| `name` | `Use 1 to 60 characters that no other collection or key uses.` | `Verwende 1 bis 60 Zeichen, die keine andere Sammlung und kein anderer Schlüssel nutzt.` |
| `category`, `visibility`, `source_unit`, `licence`, `locale`, `sort`, `format`, `to`, `plan` | `Choose one of the listed values.` | `Wähle einen der angebotenen Werte.` |
| `page` | `Use a whole number of 1 or more.` | `Verwende eine ganze Zahl ab 1.` |
| `q` | `Keep the search to 100 characters.` | `Die Suche darf höchstens 100 Zeichen haben.` |
| `edition_total` | `Use a whole number from 1 to 500.` | `Verwende eine ganze Zahl von 1 bis 500.` |
| `lookup` | `Give either an email or an order reference.` | `Gib entweder eine E-Mail-Adresse oder eine Bestellnummer an.` |
| `file` (missing) | `Choose a file to upload.` | `Wähle eine Datei zum Hochladen aus.` |
| `file` (package contents) | `A glTF package needs exactly one .gltf file and every file it references.` | `Ein glTF-Paket braucht genau eine .gltf-Datei und alle Dateien, auf die sie verweist.` |
| any other | `Unknown field.` | `Unbekanntes Feld.` |

The error summary `alert` is titled `There's a problem` / `Es gibt ein Problem` and lists one link per field error.

**Announcements and screen copy**

| Where | Moment | English | German |
|---|---|---|---|
| `status "Catalogue results"` | Results change | `<n> models match` | `<n> Modelle gefunden` |
| | Exactly one | `1 model matches` | `1 Modell gefunden` |
| | None | `No models match` | `Keine Modelle gefunden` |
| `status "Viewer announcements"` | Hotspot selected | `Hotspot <n> of <total>: <label>` | `Hotspot <n> von <total>: <label>` |
| Viewer fallback | No 3D context | `Your browser can't draw the 3D view here, so this is the rendered preview.` | `Dein Browser kann die 3D-Ansicht hier nicht darstellen, deshalb siehst du die gerenderte Vorschau.` |
| Card or viewer | Revision rebuilding | `Preview rebuilding` | `Vorschau wird neu erstellt` |
| `status "Queue progress"` | Arriving after upload | `Upload received. Queue work has started.` | `Upload erhalten. Die Verarbeitung hat begonnen.` |
| | Stage confirmed | `<stage> confirmed.` | `<stage> bestätigt.` |
| | Stage will retry | `<stage> failed. Retry <k> of <n> in <seconds> seconds.` | `<stage> fehlgeschlagen. Neuer Versuch <k> von <n> in <seconds> Sekunden.` |
| | Stage out of retries | `<stage> failed. No retries left.` | `<stage> fehlgeschlagen. Keine Versuche mehr.` |
| | Validation failed | `Validate failed. The package couldn't be read as a 3D model.` | `Prüfen fehlgeschlagen. Das Paket konnte nicht als 3D-Modell gelesen werden.` |
| | All confirmed | `All stages confirmed. Files are ready.` | `Alle Schritte bestätigt. Die Dateien sind bereit.` |
| | Requeued | `Upload requeued.` | `Upload erneut eingereiht.` |
| Upload progressbar | Sending | `Uploading <percent>%` | `Wird hochgeladen <percent> %` |
| `status "Checkout status"` | Pending | `Processing payment` | `Zahlung wird verarbeitet` |
| `status "Edition availability"` | Copies left | `<remaining> of <total> copies left` | `<remaining> von <total> Exemplaren übrig` |
| | None left | `Sold out` | `Ausverkauft` |
| Receipt | Edition line | `No. <n> of <total>` | `Nr. <n> von <total>` |
| Receipt | Total line | `Total <amount>` | `Summe <amount>` |
| Receipt | Refunded line | `Refunded <amount>` | `Erstattet <amount>` |
| `status "Studio notices"` | Saved | `Changes saved.` | `Änderungen gespeichert.` |
| | State moved | `Moved to <state>.` | `Verschoben nach <state>.` |
| | Share link | `New share link ready. The old link no longer works.` | `Neuer Freigabelink bereit. Der alte Link funktioniert nicht mehr.` |
| | Embed created or removed | `Embed created.` / `Embed removed.` | `Einbettung erstellt.` / `Einbettung entfernt.` |
| | Collection actions | `Added to <collection>.` / `Model moved to <collection>.` / `Removed from <collection>.` / `Collection deleted.` | `Zu <collection> hinzugefügt.` / `Modell nach <collection> verschoben.` / `Aus <collection> entfernt.` / `Sammlung gelöscht.` |
| | Key created | `Key created. Copy it now; it won't be shown again.` | `Schlüssel erstellt. Kopiere ihn jetzt; er wird nicht noch einmal angezeigt.` |
| | Key revoked | `Key revoked.` | `Schlüssel widerrufen.` |
| | Texture set | `Texture set submitted.` | `Texturset eingereicht.` |
| | Pending (any save) | `Saving` | `Wird gespeichert` |
| | Downgrade accepted | `Your plan changes to <plan> on <date>.` | `Dein Tarif wechselt am <date> zu <plan>.` |
| | Upgrade done | `You're now on <plan>. Charged today: <amount>.` | `Du nutzt jetzt <plan>. Heute berechnet: <amount>.` |
| | Plan pending | `Changing plan` | `Tarif wird geändert` |
| Plan page | Pending change | `Changes to <plan> on <date>` | `Wechselt am <date> zu <plan>` |
| `status "Quota"` | Limited plan | `<used> of <limit> publishes · resets <date>` | `<used> von <limit> Veröffentlichungen · neu ab <date>` |
| | Premium | `<used> publishes · no limit` | `<used> Veröffentlichungen · kein Limit` |
| `status "Read-only"` | Over limit | `Read-only on your plan` | `Schreibgeschützt in deinem Tarif` |
| `status "Staff notices"` | Refund pending | `Issuing refund` | `Erstattung läuft` |
| | Refund done | `Refunded <amount> on <order ref>.` | `<amount> für <order ref> erstattet.` |
| Embed page | No entitlement | `This embed is no longer available.` | `Diese Einbettung ist nicht mehr verfügbar.` |
| Share page | Dead link | `This link is no longer available.` | `Dieser Link ist nicht mehr verfügbar.` |
| `region "Service status"` on catalogue and model pages | Search down | the `search_unavailable` copy | |
| `region "Service status"` in studio | Search down | `Search is unavailable. Index work is waiting and will retry on schedule.` | `Die Suche ist nicht erreichbar. Die Indexierung wartet und wird planmäßig wiederholt.` |
| | Storage down | `File storage is unavailable. Uploads are paused and queue work will retry on schedule.` | `Der Dateispeicher ist nicht erreichbar. Uploads sind pausiert, die Verarbeitung wird planmäßig wiederholt.` |
| | Billing down | `Billing is unavailable. Showing the plan last confirmed by billing.` | `Die Abrechnung ist nicht erreichbar. Angezeigt wird der zuletzt bestätigte Tarif.` |
| Checkout and staff `alert` | Billing down | the `billing_unavailable` copy | |

**Stage names** (in order): `Validate`, `Transcode`, `Render preview`, `Index`, `Publish` (de: `Prüfen`, `Umwandeln`, `Vorschau rendern`, `Indexieren`, `Bereitstellen`).

**Stage statuses**: `Pending`, `Running`, `Confirmed`, `Failed` (de: `Wartend`, `Läuft`, `Bestätigt`, `Fehlgeschlagen`).

**Order statuses** (receipt and staff screens): `Paid`, `Partially refunded`, `Refunded` (de: `Bezahlt`, `Teilweise erstattet`, `Erstattet`).

**Service health** (staff panel): the services `Database`, `Storage`, `Search`, `Billing`, `Mail` (de: `Datenbank`, `Speicher`, `Suche`, `Abrechnung`, `Mail`), each with the state `Up` or `Down` (de: `Aktiv`, `Gestört`). The queue counts read `Pending <n>`, `Running <n>`, `Failed <n>` (de: `Wartend <n>`, `Läuft <n>`, `Fehlgeschlagen <n>`).

**Models table values.** The State column shows `Draft`, `In review`, `Published`, `Withdrawn` (de: `Entwurf`, `In Prüfung`, `Veröffentlicht`, `Zurückgezogen`). The Visibility column shows the visibility option labels. The Queue column shows `In progress`, `Completed`, `Failed` or `None` for the API values `in_progress`, `completed`, `failed` and `none` (de: `In Arbeit`, `Abgeschlossen`, `Fehlgeschlagen`, `Keine`).

**When banners appear.** Studio banners appear within ten seconds of the server finding a service unreachable and disappear within ten seconds of it answering again. Field errors appear next to their fields and in the error summary. Every other refusal shows its copy in an `alert` in the current screen or dialog.

## Backend

### API (DP-01, DP-02, DP-03, DP-06, DP-08, DP-11, DP-25, DP-26, DP-28, DP-30, DP-31, DP-37, DP-38, DP-39, DP-41, DP-47, DP-48, DP-51, DP-53, DP-54, DP-55, DP-58)

**Formats and limits**

- JSON in and out, UTF-8. JSON endpoints require `Content-Type: application/json`, and upload endpoints require `multipart/form-data`.
- A JSON body may be up to 64,000 bytes; 64,001 bytes or more answers 413 `body_too_large`.
- A multipart body may be up to 101,000,000 bytes; more answers 413 `body_too_large`.
- A JSON body with an unknown field answers 422 with that field set to the unknown-field copy.

**Error shape.** Every error has the body `{"error":"<code>","message":"<English copy>"}`. A 422 adds `"fields":{"<field>":"<English field copy>"}`.

**Error precedence.** One order applies to the whole API:

1. Unknown route: 404 `not_found`. Wrong method: 405 `method_not_allowed` with an `Allow` header.
2. Request-wide checks: 413 `body_too_large`, 415 `unsupported_media_type`, 400 `unknown_parameter`, 400 `idempotency_key_required`, 400 `idempotency_key_invalid`.
3. A state-changing request whose `Origin` header names another origin: 403 `cross_origin`.
4. Missing session or key: 401 `unauthenticated` or `invalid_api_key`.
5. Idempotent replay. A stored response for the same key and body is returned as is. The same key with a different body answers 409 `idempotency_key_reused`.
6. 429 `rate_limited` (read API).
7. 404 `not_found`: the resource doesn't exist or this caller may not reach it, including identifiers inside request bodies.
8. 403 `forbidden` (wrong role), `not_in_plan` (the active plan lacks the capability), `password_required`, `wrong_password`, `licence_refunded`.
9. 409 state conflicts.
10. Package checks: 413 `file_too_large`, then 415 `content_mismatch`, `unsupported_type`, `type_not_in_plan`.
11. 422 `validation_failed`.
12. 503 when a needed provider is unreachable.

The rows below name only their own success shapes and extra errors.

**Identifiers.** Public identifiers are model slugs, upload references (`up_` plus 12 letters and digits), order references (`TS-` plus 8 capital letters and digits), receipt tokens, share tokens, embed tokens, collection slugs and key references (`k_` plus 8 letters and digits). Receipt, share and embed tokens are at least 32 URL-safe random characters, except the seeded ones. No database id, Kill Bill id, object key or provider URL appears in any response.

**Session**

- `POST /api/session` with `{"email","password"}` answers 200 `{"role":"author|editor|contributor|staff","landing":"<route>"}` and sets an HttpOnly, SameSite=Lax session cookie. Errors: 401 `invalid_credentials`.
- `GET /api/session` answers 200 `{"role","email","landing"}`.
- `DELETE /api/session` answers 204.

**Public catalogue and models**

- `GET /api/catalogue` takes these parameters. Values within one of `category`, `licence` or `format` combine with OR (a model matches if it has any ticked value), and the three groups combine with AND. The facet counts of a group are computed with that group's own selection left out and every other filter applied, so ticking a value doesn't zero its siblings:
  - `q`: 0 to 100 characters.
  - `category`, `licence`, `format`: comma lists of `hard-surface,miniature,scan`, `personal,commercial,studio` and `glb,stl`.
  - `sort`: `newest`, `price_asc` or `price_desc`.
  - `page`: a whole number of at least 1.

  It answers 200 `{"total":<int>,"page":<int>,"page_size":8,"pages":<int>,"items":[<card>],"facets":{"category":{"hard-surface":<int>,"miniature":<int>,"scan":<int>},"licence":{"personal":<int>,"commercial":<int>,"studio":<int>},"format":{"glb":<int>,"stl":<int>}}}`. A card is `{"slug","title","category","formats":[...],"licences":[...],"price_from_cents":<int>,"preview_url":"/media/<slug>/preview.png","rebuilding":<bool>}`. A page past the last answers 200 with `"items":[]`. Errors: 422 `validation_failed` with the offending parameter as the `fields` key (`category`, `licence`, `format`, `sort`, `page` or `q`) for a value outside the published lists or ranges, 503 `search_unavailable`.
- `GET /api/models/{slug}` answers 200 with a model detail for a public, published, within-plan model, or a password model with a valid unlock. The detail is:

  `{"slug","title","category","description","formats":[...],"licences":[{"type","seats","list_price_cents","price_cents"}],"discount_percent","dimensions_mm":{"width","height","depth"},"bounding_radius_mm","scale_denominator","default_camera":{"azimuth","tilt","distance","fov"},"hotspots":[{"label","x_mm","y_mm","z_mm"}],"edition":{"total","remaining","price_cents"}|null,"rebuilding":<bool>}`

  Errors: 403 `password_required` for a password model without an unlock (body has no model fields), 404 otherwise.
- `POST /api/models/{slug}/unlock` with `{"password"}` answers 204 and sets an unlock cookie for that model. Errors: 403 `wrong_password`, 404 for any model that isn't a published, within-plan, password-protected model.
- `GET /api/shared/{share token}` answers 200 with the model detail of the unlisted model, or 404.
- `GET /api/models/{slug}/recommendations` answers 200 `{"items":[<card>]}`. Errors: 503 `search_unavailable`.
- `GET /api/models/{slug}/edition` answers 200 `{"total","remaining","on_sale":<bool>}` for an edition model the caller may see, or 404.
- `GET /media/{slug}/preview.png` and `GET /media/{slug}/view.glb`, with optional `access=<share or embed token>`, answer 200 with the current revision's preview or GLB (the newest revision whose publish stage has confirmed) when the caller may see the model. Two rules qualify this:
  - **Rebuilding overrides the current revision for public callers.** Once a replaced source is accepted (see Business rules, Replacing a source), the older revision's files are outdated and are never served to anyone. Every caller without a studio session (visitors, share-link and embed access, password unlocks) gets 409 `derivatives_rebuilding` until the new revision's publish stage confirms.
  - **Studio sessions see the newest revision early.** A signed-in author or editor, and a contributor for their own models, may fetch media of a model in any state, visibility or read-only status. They always get the newest revision's file, as soon as that file's own stage has confirmed (transcode for the GLB, preview for the PNG). Before that stage confirms they also get 409 `derivatives_rebuilding`, never an older revision's file.

  Errors: 404, 409 `derivatives_rebuilding`, 503 `storage_unavailable`.

**Checkout and receipts**

- `POST /api/checkout` needs an `Idempotency-Key` header of 8 to 64 letters, digits, `-` and `_`. The same key format applies to refunds and plan changes, and a header outside it answers 400 `idempotency_key_invalid`. The body is `{"model":"<slug>","licence":"personal|commercial|studio|edition","email":"<email>","terms":true,"locale":"en|de","access":"<share token>"?,"upgrade_from":"<receipt token>"?}`.
  - It answers 201 `{"order":"<order ref>","receipt_url":"/receipts/<receipt token>","licence","amount_cents":<int>,"currency":"EUR","edition_number":<int>|null}`.
  - Errors: 404 (model not purchasable by this caller, including a read-only model, or unknown `upgrade_from`; a receipt for such a model lists no `upgrade_options`), 403 `password_required`, 409 `edition_sold_out`, 409 `edition_unavailable`, 409 `upgrade_not_possible`, 422, 503 `billing_unavailable`.
- `GET /api/receipts/{receipt token}` answers 200 `{"order","email","model":{"slug","title"},"licence","seats","amount_cents","refunded_cents","status":"paid|partially_refunded|refunded","edition_number","edition_total","locale","created_at","upgraded_to":<licence>|null,"upgrade_options":[{"licence","amount_cents"}]}`.
- `GET /api/receipts/{receipt token}/invoice.pdf` answers 200 `application/pdf`.
- `GET /api/receipts/{receipt token}/files/model.glb` and `.../model.stl` answer 200 with the file. Errors: 403 `licence_refunded`, 409 `derivatives_rebuilding`, 503 `storage_unavailable`.
- `GET /receipts/{receipt token}`, `GET /u/{share token}` and `GET /embed/{embed token}` are HTML pages. The share and embed pages answer 404 with their dead-link copy when not entitled.

**Studio** (author unless noted; "author, editor" means both)

- `GET /api/studio/summary` (author, editor) answers 200 `{"totals":{"public","unlisted","password","private","draft","in_review","withdrawn"},"quota":{"used","limit":<int>|null,"resets_on":"YYYY-MM-DD"},"collections":[{"slug","name","item_count"}]}`.
- `GET /api/studio/models?state=<state>` (author, editor) answers 200 `{"items":[{"slug","title","state","visibility","read_only","price_from_cents","queue_status":"in_progress|completed|failed|none"}]}`.
- `GET /api/studio/models/{slug}` (author, editor) answers 200 with the model detail plus `"state"`, `"visibility"`, `"read_only"`, `"revision"`, `"share_url"|null`, `"embeds":[{"token","url"}]`, `"latest_upload":"<upload ref>"|null` and `"owner":"author|<contributor email>"`.
- `PATCH /api/studio/models/{slug}` with any of `{"title","description","category","visibility":"public|unlisted|private|password","password","prices":{"personal_cents","commercial_cents"|null,"studio_cents"|null},"discount_percent","edition_total"|null,"edition_price_cents"}` answers 200 with the studio detail. Errors: 409 `read_only`, 403 `not_in_plan` (edition on a plan without editions), 409 `edition_locked` (changing or clearing `edition_total` after the first edition sale), 422.
- `PUT /api/studio/models/{slug}/view` with `{"default_camera":{"azimuth","tilt","distance","fov"},"hotspots":[{"label","x_mm","y_mm","z_mm"}]}` answers 200 with the studio detail. In `default_camera`, `distance` is the distance factor k (a multiple of the bounding radius, not millimetres), and Save as default view stores the viewer's current k. The model detail returns it the same way. Errors: 409 `read_only`, 422 `camera` or `hotspots`.
- `POST /api/studio/models/{slug}/transitions` (author, editor) with `{"to":"draft|in_review|published|withdrawn"}` answers 200 `{"slug","state"}`. Errors: 409 `illegal_transition`, `not_ready`, `quota_reached`, `read_only`.
- `DELETE /api/studio/models/{slug}` answers 204. Errors: 409 `not_deletable`.
- `POST /api/studio/uploads` (multipart) takes `file` (required), `source_unit` (`mm|cm|m|in`, required), and either `title` and `category` for a new model or `model` (slug) to replace a source. It answers 202 `{"model":"<slug>","upload":"<upload ref>","queue_url":"/studio/models/<slug>/queue"}`. Errors: 409 `read_only`, 413 `file_too_large`, 415 `content_mismatch` / `unsupported_type` / `type_not_in_plan`, 422, 503 `storage_unavailable`.
- `GET /api/studio/uploads/{upload ref}` (author, editor) answers 200 `{"upload","model","status":"in_progress|completed|failed","stages":[{"name":"validate|transcode|preview|index|publish","status":"pending|running|confirmed|failed","attempts":<int>,"next_attempt_at":"<ISO 8601 UTC>"|null}]}`.
- `POST /api/studio/uploads/{upload ref}/requeue` answers 202 with the upload body. Errors: 409 `not_failed`.
- `GET /api/studio/models/{slug}/original` (author, editor) answers 200 with the original bytes, `Content-Type: application/octet-stream`, `Content-Disposition: attachment; filename="<original file name>"` and `X-Checksum-SHA256: <lowercase hex>`. Errors: 503 `storage_unavailable`.
- `POST /api/studio/models/{slug}/share-link` answers 201 `{"share_url":"/u/<share token>"}`. Errors: 409 `visibility_conflict` unless the model is unlisted, 409 `read_only`.
- `POST /api/studio/models/{slug}/embeds` answers 201 `{"token","url":"/embed/<embed token>"}`. Errors: 403 `not_in_plan`, 409 `visibility_conflict`, 409 `read_only`.
- `DELETE /api/studio/embeds/{embed token}` answers 204.
- Collections (author, editor):
  - `GET /api/studio/collections` answers 200 `{"items":[{"slug","name","item_count","models":[<slug>]}]}`.
  - `POST /api/studio/collections` with `{"name"}` answers 201 with the item.
  - `PATCH /api/studio/collections/{c}` with `{"name"}` answers 200.
  - `DELETE /api/studio/collections/{c}` answers 204.
  - `POST /api/studio/collections/{c}/items` with `{"model"}` answers 201 with the collection. Errors: 409 `already_in_collection`.
  - `DELETE /api/studio/collections/{c}/items/{slug}` answers 204.
  - `POST /api/studio/collections/{c}/items/{slug}/move` with `{"to":"<collection slug>"}` answers 200 `{"from":<collection>,"to":<collection>}`. Errors: 409 `already_in_collection`.
- `GET /api/studio/exports/catalogue.csv` answers 200 `text/csv; charset=utf-8`. Errors: 503 `search_unavailable`.
- `GET /api/studio/plan` answers 200 `{"plan":"free|basic|pro|premium","pending":{"plan","effective_date":"YYYY-MM-DD"}|null,"billing_cycle_day":<int>,"confirmed_at":"<ISO 8601 UTC>","quota":{...as in summary}}`.
- `POST /api/studio/plan` needs an `Idempotency-Key` and takes `{"plan"}`.
  - An upgrade answers 200 `{"plan":<new>,"pending":null,"charged_cents":<int>,"redirect":"/studio/plan"}`.
  - A downgrade answers 202 `{"plan":<current>,"pending":{"plan","effective_date"},"redirect":"/studio/plan"}`.
  - Errors: 409 `plan_unchanged`, 503 `billing_unavailable`.
- `GET /api/studio/api-keys` answers 200 `{"items":[{"ref","name","created_at","active":<bool>}]}`.
- `POST /api/studio/api-keys` with `{"name"}` answers 201 `{"ref","name","key","created_at"}`. The `key` appears only in this response. Only active keys count toward the plan's allowance. Creating a key when the active keys already equal the allowance answers 403 `not_in_plan`, and an invalid or duplicate name answers 422 `name`.
- `DELETE /api/studio/api-keys/{ref}` answers 204.

**Contributor**

- `GET /api/contrib/models` answers 200 with the caller's own models.
- `GET /api/contrib/models/{slug}` answers 200 with the caller's own model.
- `POST /api/contrib/models` (multipart) takes the same fields as the studio upload. With `model`, the slug must be the caller's own draft. It answers 202 `{"model","upload","queue_url":"/contribute/models/<slug>"}`.
- `GET /api/contrib/uploads/{upload ref}` answers 200 with the upload body.
- `POST /api/contrib/models/{slug}/submit` answers 200 `{"slug","state":"in_review"}`. Errors: 409 `illegal_transition`.
- `GET /api/contrib/models/{slug}/original` answers like the studio original.
- `POST /api/contrib/texture-sets` (multipart) takes `model` (slug), `name` (1 to 60 characters) and `file`. It answers 201 `{"texture_set":"ts_<12 letters and digits>","model","images":<int>,"checksum":"<sha256 hex>"}`. Errors: 413 `file_too_large`, 415 `unsupported_type` when the archive isn't a ZIP, 422 `file`.
- Contributor routes answer 404 for any slug that isn't the caller's own model, whether it is in the route or in the `model` field. That includes the author's models, the other contributor's models and unknown slugs.

**Staff**

- `GET /api/staff/orders?email=<email>` or `?order=<order ref>` (exactly one; both or neither answers 422 with `lookup`) answers 200 `{"orders":[{"order","email","model","licence","seats","refunded_seats","amount_cents","refunded_cents","refundable_cents","status","edition_number","created_at","locale"}]}`.
- `POST /api/staff/orders/{order ref}/refunds` needs an `Idempotency-Key` and takes `{"kind":"full"}` or `{"kind":"seats","seats":<int>}`. It answers 201 `{"order","refund_cents","refunded_cents","refundable_cents","status"}`. Errors: 409 `nothing_to_refund`, 422 `seats`, 503 `billing_unavailable`.
- `GET /api/staff/health` answers 200 `{"services":{"database":"up|down","storage":"up|down","search":"up|down","billing":"up|down","mail":"up|down"},"checked_at":"<ISO 8601 UTC>","queue":{"pending":<int>,"running":<int>,"failed":<int>}}`. The queue counts are uploads: `pending` is uploads in progress whose current stage is pending (including a stage waiting on a retry), `running` is uploads whose current stage is running, and `failed` is uploads with status failed.

**Read API** (header `Authorization: Bearer <key>`)

- `GET /api/v1/models` takes `q`, `category`, `licence`, `format`, `sort` and `page`, with the catalogue semantics. It answers 200 `{"total","page","page_size":8,"items":[{"slug","title","category","formats","licences","price_from_cents","url":"/models/<slug>"}]}`.
- `GET /api/v1/models/{slug}` answers 200 `{"slug","title","category","description","formats","licences":[{"type","price_cents"}],"dimensions_mm":{"width","height","depth"},"url"}`.
- Every read API response carries `X-RateLimit-Limit` and `X-RateLimit-Remaining`. A 429 also carries `Retry-After`.
- The read API answers only these two routes and these fields. Any other query parameter answers 400 `unknown_parameter`, and a non-GET method answers 405 with `Allow: GET`. A GET that carries a request body or a `Content-Type` header answers 415 `unsupported_media_type`. Errors: 401 `invalid_api_key` for a missing, unknown or revoked key, 403 `not_in_plan` for a key beyond the active plan's key allowance, 503 `search_unavailable`.

**Health.** `GET /api/health` answers 200 `{"status":"ok"}` whenever the HTTP server is running.

### Business rules (DP-01, DP-02, DP-04, DP-05, DP-06, DP-08, DP-16, DP-18, DP-19, DP-24, DP-26, DP-28, DP-31, DP-33, DP-36, DP-37, DP-38, DP-39, DP-41, DP-42, DP-43, DP-44, DP-46, DP-48, DP-50, DP-51, DP-54, DP-56)

**Roles**

| Role | May do |
|---|---|
| Author | Everything under `/api/studio`. |
| Editor | Summary, model lists and detail, original download, transitions, uploads read, and collections. Every other studio route answers 403 `forbidden`. |
| Contributor | Only `/api/contrib`. |
| Staff | Only `/api/staff`. |

A signed-in role calling another role's area answers 403 `forbidden`. A signed-in role requesting a page it may not open gets that page with status 403, showing the `forbidden` copy and a link to its own landing route. The editor may open `/studio`, `/studio/review`, `/studio/collections`, `/studio/models/<slug>` (state buttons only) and the queue pages. `/studio/upload`, `/studio/plan`, `/studio/api-keys` and `/studio/export` are author-only. Signed-out page requests to `/studio`, `/contribute` or `/staff` redirect to `/sign-in?next=<path>`. Landing routes after sign-in: author `/studio`, editor `/studio/review`, contributor `/contribute`, staff `/staff`. After a successful sign-in the browser goes to `next` when it is a same-origin path (one leading `/`) that the role may open, and otherwise to the landing route.

**Plans** (from Kill Bill, monthly, in euros)

| Plan | Monthly price | Max package (bytes, limit allowed) | Packages accepted | Publishes per billing cycle | Published models within plan | Embeds | Limited editions | Read API keys |
|---|---|---|---|---|---|---|---|---|
| Free | €0.00 | 2,000,000 | glTF binary | 3 | 5 | no | no | 0 |
| Basic | €9.00 | 8,000,000 | glTF binary, glTF package | 10 | 30 | no | no | 1 |
| Pro | €19.00 | 25,000,000 | glTF binary, glTF package | 40 | 200 | yes | yes | 5 |
| Premium | €39.00 | 100,000,000 | glTF binary, glTF package | no limit | no limit | yes | yes | 20 |

- A file exactly at the max package size is accepted. One byte more answers 413 `file_too_large`. The size check runs before the type check, and both run before anything is stored or queued.
- **Within plan.** Published models are ranked by when they were first published, earliest first. The first ones up to the plan's limit are within plan. The rest are read-only.
- **Read-only.** A read-only model keeps all its data and its original, and the author can still download it. It is served nowhere public (catalogue, model page, share link, password page, embed, read API, media) and is removed from the search index. Every change to it except withdrawing answers 409 `read_only`.
- **Read API keys.** Only active (not revoked) keys count. Active keys are ranked by creation, earliest first, and keys beyond the plan's allowance answer 403 `not_in_plan` when used. Creating a key beyond the allowance is refused as stated in API.
- **Plans without editions.** Edition checkouts answer 409 `edition_unavailable`.
- **Plans without embeds.** Every embed page answers with the embed-unavailable page.
- These effects follow the active plan both ways. When a higher plan becomes active again, models within the new limit become writable and are re-indexed.

**Plan changes and time**

- The active plan is what Kill Bill reports as the author's subscription plan today.
- The app reads it at least every ten seconds, and on every plan page load and plan change. When Kill Bill reports a different active plan, every entitlement above follows within twenty seconds, whether or not the change was made through the app.
- An upgrade is sent to Kill Bill with immediate effect. Kill Bill prorates and invoices it, the app records the invoiced amount as `charged_cents`, and the new limits apply at once.
- A downgrade is sent to Kill Bill to take effect at the end of the billing period. The `effective_date` the app shows is the change date Kill Bill reports for the pending change. Until Kill Bill reports the lower plan as active, nothing changes.
- When Kill Bill is unreachable, the app enforces the last plan Kill Bill confirmed. On a database that has never reached Kill Bill, it enforces Free.
- **Quota.** The billing cycle starts on the most recent date whose day of month equals the account's billing-cycle day from Kill Bill, or the month's last day when the month is shorter. `resets_on` is the next such date.
  - Each successful move to published within the cycle uses one publish, including a republish after withdrawal.
  - Withdrawing doesn't give a publish back, and failed queue jobs use none.
  - A move to published once the quota is used up answers 409 `quota_reached`.
  - The billing-cycle day is the day of the month on which Kill Bill started the author's subscription at first start, so the first `resets_on` is the next date with that day. At first start `used` is 0, and seeded publishes never count.

**Model state machine**

States: `draft`, `in_review`, `published`, `withdrawn`. These are the only legal moves:

| From | To | Who |
|---|---|---|
| draft | in_review | author, editor, or the contributor who owns it |
| in_review | draft | author, editor |
| in_review | published | author, editor |
| published | withdrawn | author, editor |
| withdrawn | in_review | author, editor |

- Every other pair, including a move to the current state, answers 409 `illegal_transition` with the from and to labels. Contributors can make only their one move and get 403 `forbidden` for any other target.
- Moving to published needs a revision whose publish stage has confirmed, or it answers 409 `not_ready`. Moves to in review need no confirmed stage and are allowed while the queue is still running.
- Withdrawing, or moving out of published in any way, removes the model from the search index and ends its share link, password unlocks and embeds.
- Studio state buttons are enabled exactly when their move is legal from the current state for the signed-in role.

**Visibility**

- `public`: listed in the catalogue.
- `unlisted`: reachable only at `/u/<share token>`. `/models/<slug>` answers 404 for it.
- `private`: studio only.
- `password`: `/models/<slug>` shows the password gate until unlocked.

Rules:

- Choosing `password` needs a `password` of 8 to 64 characters.
- Making a model unlisted creates a share token. Regenerating one, or leaving unlisted, ends the old token at once.
- An unlock lasts for the browser session and ends when the password changes, the visibility changes, the model leaves published, or the model becomes read-only.
- Only public, published, within-plan models whose index stage confirmed are in the search index. That is the only source for search results, facet counts, recommendations, the catalogue export and the read API.
- The index stage is not the only writer. A transition, visibility change, password change, plan change or within-plan change that makes a model public, published and within plan writes its search document. Any change that takes a model out of that set deletes its document. Within five seconds of the change's response, or of the plan change taking effect, the catalogue, facet counts, recommendations, export and read API reflect it.
- A change that removes a model from public view first deletes its index document and waits for Meilisearch to confirm the deletion. While such a removal is unconfirmed, for example during a search outage, every catalogue, recommendation, export and read API request answers 503 `search_unavailable`, so no stale entry can be served.

**Embeds**

- Only for published public or unlisted models, and only on plans with embeds. Otherwise creation answers 403 `not_in_plan` or 409 `visibility_conflict`.
- The embed page and its media are served only while all of these hold: the model is published, public or unlisted, and within plan, and the active plan has embeds. Every request is checked.
- Removing an embed ends it for good.

**Uploads and packages**

- **glTF binary.** The first four bytes are the ASCII letters `glTF`, the next four are the number 2 (little-endian), the next four equal the file's length in bytes, and the first chunk is the JSON chunk.
- **glTF package.** A ZIP archive (first four bytes `PK` 3 4) containing exactly one `.gltf` file, with every buffer and image it references present in the archive. An entry with `..` in its path, an absolute path, a drive letter or a backslash answers 422 with the path-escape `file` copy. A package with no `.gltf` file, more than one, or a referenced buffer or image missing from the archive answers 422 with the package-contents `file` copy.
- The type comes only from the bytes:
  - A file named `.glb` whose bytes aren't a glTF binary answers 415 `content_mismatch`.
  - Bytes that are neither type answer 415 `unsupported_type`.
  - A glTF package on a plan that accepts glTF binaries only answers 415 `type_not_in_plan`.
  - A glTF binary named anything is accepted as a glTF binary.
- **Titles.** 1 to 120 characters, counted as user-perceived characters, so an emoji or an accented letter counts as one. Descriptions are 0 to 2000 counted the same way.
- **Slugs.** Made from the title: lowercase ASCII letters and digits, every other run of characters becomes one hyphen, with no leading or trailing hyphen, at most 60 characters. When the slug is taken, `-2`, `-3` and onwards is added. A slug never changes.
- An accepted upload creates a new revision (1, 2, 3 and onwards per model). A new model starts in `draft` with visibility `private`.

**Queue**

- Stages run in order: validate, transcode, preview, index, publish. A stage starts only after the previous one confirmed.
  - **Validate** reads the package as a 3D model. It fails at once, with one attempt and no retry, when the JSON chunk isn't valid glTF JSON, the model has no triangle mesh with positions, an accessor or buffer view reaches past its buffer, or the bounding box has zero size on any axis. Otherwise it confirms.
  - **Transcode** writes the GLB and STL.
  - **Preview** renders a 1024 by 768 pixel PNG of the model from its default camera on the bone ground.
  - **Index** writes the search document when the model is public, published and within plan, and otherwise removes any document. It confirms only when Meilisearch confirms.
  - **Publish** makes the revision current, so it is what the model page, media and receipts serve.
- A stage confirms only after its provider confirms. For object writes, the object reads back with the expected length.
- **Unit scaling.** The source unit factor to metres is: `mm` 0.001, `cm` 0.01, `m` 1, `in` 0.0254.
  - The GLB keeps the source's up direction (Y up) with positions multiplied by the factor.
  - The STL is binary, in millimetres, Z up: STL x = GLB x × 1000, STL y = −GLB z × 1000, STL z = GLB y × 1000.
- **Dimensions.** Width, height and depth are the GLB's bounding-box sizes along X, Y and Z in millimetres, rounded to 0.1. The bounding radius is half the box diagonal in millimetres. The orbit target is the box centre.
- **Replacing a source** marks the current GLB, STL and preview outdated the moment the upload is accepted (202). An outdated file is never served again to anyone. From then until the new revision's publish stage confirms:
  - Media for every caller without a studio session, receipt file downloads and buyer downloads answer 409 `derivatives_rebuilding`. Studio sessions get the new revision's media file once that file's own stage confirms, and 409 before that, as stated in API.
  - Cards and the viewer show the preview-rebuilding copy.
  - The search document stays, with `"rebuilding":true` on cards.
- **Retries.** A stage that fails because a provider is unreachable or errors is retried after each delay in `QUEUE_RETRY_SECONDS` in turn. The default is 30 seconds, 2 minutes and 10 minutes, so there are at most four attempts. While waiting, its status is `pending` with `next_attempt_at` set. When the delays run out, it is `failed` and the upload's status is `failed`.
- Validate failures caused by the package itself fail at once, with one attempt and no retry.
- Requeue restarts a failed upload from its failed stage with attempts reset.
- Queue work continues across provider outages without a restart. A waiting stage resumes on its next scheduled attempt after the provider answers again.

**Viewer geometry** (published on the viewer root, numbers with a dot decimal, rounded to 0.1)

- **Orbit values.** Let R be the bounding radius in millimetres.
  - Azimuth a is in degrees: steps of 15, wrapping to 0 to 345.
  - Tilt t is in degrees: steps of 5, from −10 to 80 inclusive.
  - The distance factor k has steps of 0.2, from 1.2 to 6 inclusive. The distance D is k × R millimetres.
  - The vertical field of view f is in degrees: steps of 5, from 20 to 60 inclusive.
  - A step that would pass a limit stops at the limit.
- **Camera position.** Relative to the box centre, the camera sits at (D·cos t·sin a, D·sin t, D·cos t·cos a), looks at the centre, with world up +Y.
- **Attributes.** The root carries `data-mode="orbit"`, `data-camera-distance` (D), `data-fov` (f), `data-tilt` (t) and `data-azimuth` (a).
- **Hotspot projection.** A hotspot p (millimetres, relative to the box centre) is projected for the canvas's displayed width W and height H in CSS pixels.
  - Let forward = −position / |position|, right = normalise(forward × up), camera-up = right × forward, and v = p − position.
  - Then xc = v·right, yc = v·camera-up and zc = v·forward.
  - The screen point is x = (xc / (zc·tan(f/2)·W/H) + 1) / 2 × W and y = (1 − yc / (zc·tan(f/2))) / 2 × H.
- **Hotspot attributes.** With an active hotspot, the root carries `data-hotspot-index` (1-based) and `data-hotspot-x` / `data-hotspot-y` (x and y). Without one, those three attributes are absent.
- **Turning to a hotspot.** The camera turns to azimuth = atan2(p.x, p.z) in degrees, normalised to 0 to 360 and rounded to the nearest 15, with halves rounding up and 360 becoming 0. Tilt, distance and field of view stay unchanged.
- **First-person.** The root carries `data-mode="first-person"`, `data-heading`, `data-pitch` and `data-eye-height`.
  - The eye stands at horizontal distance D from the centre along the current azimuth, at `data-eye-height` = 1600 ÷ the model's scale denominator millimetres above the box's lowest point.
  - Heading is the compass direction the eye faces, using the azimuth convention: a horizontal view direction (dx, dz) has heading atan2(dx, dz) in degrees, so 0 faces +Z and 90 faces +X. It starts facing the centre, at (azimuth + 180) modulo 360. It moves in steps of 15 with no clamp (ArrowRight adds, ArrowLeft subtracts) and is shown wrapped to 0 to 359.9.
  - Pitch starts at 0, moves in steps of 5 (ArrowUp adds, looking up; ArrowDown subtracts), and is clamped to −45 to 45.
  - Leaving first-person mode restores the orbit values from before.
- The default camera and hotspots of a model are its saved view. Saving a camera outside the limits or off-step, or more than 8 hotspots, a label outside 1 to 60 characters, or a point outside the bounding box, answers 422.

**Money**

- Prices are whole euro cents from 100 to 100,000 inclusive.
- A licence's price is its list price × (100 − discount percent) / 100, rounded half up to the cent. This is computed once, when the order is created, and stored as the order amount. Every display, Kill Bill record, PDF and email uses that stored amount.
- Licences: `personal` (1 seat), `commercial` (1 seat) and `studio` (3 seats). An edition copy costs its edition price, has no discount, and carries a personal licence.
- The "from" price is the discounted personal price.
- **Upgrades.** Personal can go to commercial or studio, and commercial to studio. The upgrade amount is the target licence's current discounted price minus the net amount paid, after refunds, across the source order and every earlier order in its upgrade chain (so a second upgrade from an upgrade order deducts the original and the first upgrade). Upgrading an edition copy, a fully refunded order, an order that already has `upgraded_to`, or an amount of zero or less, answers 409 `upgrade_not_possible`. The source order shows `upgraded_to`.
- **Seat refunds** (studio licences only). The refund is amount × seats ÷ 3, rounded half up to the cent. `seats` must be at least 1 and less than the seats not yet refunded, otherwise 422 `seats`.
- **Full refunds** refund all of the remaining refundable amount. With nothing left to refund the answer is 409 `nothing_to_refund`.
- A fully refunded order's files answer 403 `licence_refunded`. A refunded edition copy's number is retired and not sold again.

**Locale formats**

| | English (`en`) | German (`de`) |
|---|---|---|
| Amounts | `€1,234.56` | `1.234,56 €`, with a no-break space before the euro sign |
| Dates | `2 Nov 2026` | `02.11.2026` |
| Plain numbers | `1,234.5` | `1.234,5` |

Plain numbers include the camera readout and counts. The `lang` parameter reads `en` for English and `de` for German. On every page except a receipt, the picker writes `lang=de` for German and removes `lang` for English, and an address without `lang` reads in English. On a receipt page (`/receipts/<receipt token>`), the picker always writes the choice explicitly, `lang=en` or `lang=de`, because a receipt address without `lang`, such as the link in the receipt email, reads in the order's checkout locale. So choosing English on a German order's receipt gives `?lang=en`, and a cold load of that address reads in English. Any page accepts `lang=en` as English. Every internal link and every redirect the browser follows after an action keeps the address's `lang` value when it carries one (the browser adds it to the `receipt_url` and `redirect` values it receives).

**Idempotency**

- Checkout, refund and plan-change requests need an `Idempotency-Key`. Within one endpoint, the first request with a key decides the outcome. Responses with status below 500 are stored and replayed byte for byte, with the same status, for the same key and an identical body. The same key with a different body answers 409 `idempotency_key_reused`.
- A second request that arrives while the first is still running waits for it and returns the same response.
- A 503 isn't stored, and a retry with the same key never creates a second Kill Bill charge or refund.
- Replays never send a second email.

**Editions**

- A limited edition has 1 to 500 copies, set only before its first edition sale. Changing or clearing `edition_total` after that sale answers 409 `edition_locked`. The edition price is set with `edition_price_cents` (100 to 100,000, outside which the answer is 422 `price`) and may change at any time. A copy costs the price in force when its order is created.
- Copies are numbered from 1 in claim order.
- When several checkouts claim the last remaining copy at once, exactly one claims it. Every other one answers 409 `edition_sold_out` and charges nothing.
- A claimed copy whose Kill Bill charge fails is released.

**Read API limits.** Each key may make 60 requests in any rolling 60 seconds. The 61st answers 429 `rate_limited`, and `Retry-After` is the whole number of seconds (1 to 60) until a request is allowed again, the same number as in the message.

**Derived counters** (always equal to a recount of their rows)

- A collection's `item_count` is the number of models in it, of any state.
- `totals.public`, `unlisted`, `password` and `private` count published models by visibility. `draft`, `in_review` and `withdrawn` count models by state.
- Quota `used` is the number of moves to published in the current cycle.
- A model can be in many collections. Deleting a model removes it from every collection. Deleting a collection removes no models.

**Catalogue export.** The CSV has the header `slug,title,category,formats,licences,price_from_eur,published_on`.

- There is one row per catalogue model, newest first. Formats and licences are joined with `;`, the price has two decimals with a dot, and the date is `YYYY-MM-DD`.
- A cell whose first character is `=`, `+`, `-`, `@`, a tab or a carriage return gets a leading apostrophe `'`.
- A cell containing a comma, a double quote or a line break is wrapped in double quotes, with inner quotes doubled.
- Lines end with CRLF.

### Services (DP-03, DP-09, DP-25, DP-27, DP-31, DP-41, DP-42, DP-43)

**PostgreSQL** is the source of truth for models, revisions, uploads and stage attempts, states, plans projected from Kill Bill, collections, licences, orders, refunds, edition copies, idempotency records, embeds, share tokens, read API keys (stored only as hashes) and sessions. The app creates or updates its schema and seed idempotently every time it starts serving.

**MinIO** (bucket `S3_BUCKET`)

- Originals live at `originals/<sha256 of the bytes, lowercase hex>`, stored exactly as uploaded.
- Derivatives live at `derivatives/<slug>/r<revision>/model.glb`, `.../model.stl` and `.../preview.png`.
- Texture sets live at `texture-sets/<sha256>`.
- Objects are never overwritten or recompressed.
- When MinIO is down:
  - Uploads, texture sets, original downloads, media and buyer downloads answer 503 `storage_unavailable`.
  - Stages that need storage wait on the retry schedule.
  - The studio shows the storage banner.

**Kill Bill** (tenant from `KILLBILL_API_KEY` / `KILLBILL_API_SECRET`)

- **Catalogue.** At start, the app uploads its catalogue to the tenant if the tenant has none. It has monthly EUR plans `turnstone-free-monthly`, `turnstone-basic-monthly`, `turnstone-pro-monthly` and `turnstone-premium-monthly` for products `Free`, `Basic`, `Pro` and `Premium`, at the prices in the plan table.
- **Author account.** External key `turnstone-<STUDIO_INSTANCE>-author`, EUR, with the external payment method as default. It holds one subscription, created on Pro at first start, in bundle `turnstone-<STUDIO_INSTANCE>-studio-plan`.
- **Buyer accounts.** External key `turnstone-<STUDIO_INSTANCE>-buyer-<email in lowercase>`, EUR, external payment method, created on first purchase.
- **Purchases.** Each purchase is one external charge on the buyer's account for the order amount in euros. Its description is `<title> · <Licence> licence`, `<title> · Edition copy No. <n>` or `<title> · Upgrade to <Licence> licence`, where `<Licence>` is `Personal`, `Commercial` or `Studio`. The charge goes on a committed invoice, then one payment for the same amount with a successful `PURCHASE` transaction. The order and receipt exist only after both confirm.
- **Refunds.** Each refund is a `REFUND` transaction on that payment for the refund amount.
- **When Kill Bill is down:**
  - Checkout, refunds and plan changes answer 503 `billing_unavailable`, and nothing is recorded or emailed.
  - The plan page shows the last confirmed plan with the billing banner.

**Mailpit** (SMTP `SMTP_HOST`:`SMTP_PORT`, From `MAIL_FROM`). Each message is sent once, only after Kill Bill confirms. Amounts and dates follow the stated locale's formats.

| Message | To | Locale | Subject (en / de) | Body includes |
|---|---|---|---|---|
| Receipt | the buyer | checkout locale | `Your Turnstone Studio receipt <order ref>` / `Deine Turnstone Studio Quittung <order ref>` | the receipt Total line, the licence, the edition line when there is one, and the absolute receipt link built from `APP_PUBLIC_URL` |
| Refund notice | the buyer | checkout locale | `Refund for <order ref>` / `Erstattung für <order ref>` | the Refunded line with this refund's amount |
| Plan-change notice (downgrade) | the author | English | `Your plan changes to <plan> on <date>` | |
| Plan-change notice (upgrade) | the author | English | `Your plan is now <plan>` | `Charged today <amount>` |

Mail that can't be sent is retried on the queue retry schedule.

**Invoice PDF.** Rendered by the app in the receipt's locale. Its extractable text contains `Invoice <order ref>` / `Rechnung <order ref>`, the receipt Total line, and one Refunded line per refund.

**Meilisearch** (index `MEILISEARCH_INDEX`, default `models`, primary key `slug`)

- Searchable: `title`, `description`, `category`. Filterable: `category`, `licences`, `formats`. Sortable: `price_from_cents`, `published_at`.
- Documents have exactly these fields: `slug`, `title`, `description`, `category`, `licences`, `formats`, `price_from_cents`, `published_at` (Unix seconds), `rebuilding`.
- Facet counts are Meilisearch's distribution for the current query and filters.
- When Meilisearch is down:
  - The catalogue, recommendations, export and read API answer 503 `search_unavailable`.
  - The catalogue and model pages show the search banner, and the studio shows its search banner.
  - Index stages wait on the retry schedule.

### Seed data (DP-11, DP-15, DP-24, DP-33, DP-36, DP-50, DP-55)

Every person, business, model and file below is invented. The app generates all seed geometry procedurally on first start: box and cylinder composites matching the stated dimensions, stored as revision 1 originals with confirmed stages. The seed is idempotent and never duplicates.

**Users**

| Name | Email | Password | Role |
|---|---|---|---|
| Rowan Teague | `author@ashgrove.test` | `turnstone-author-1` | author (studio name Ashgrove Mesh Works) |
| Imre Castell | `editor@ashgrove.test` | `turnstone-editor-1` | editor |
| Kit Arden | `kit@contrib.test` | `turnstone-contrib-1` | contributor A |
| Sol Varga | `sol@contrib.test` | `turnstone-contrib-2` | contributor B |
| Dana Mire | `support@ashgrove.test` | `turnstone-staff-1` | staff |

**Plan.** The author is on Pro, created in Kill Bill at first start. There are no orders and no buyer accounts at start.

**Defaults for seeded models** unless a row says otherwise: owner author, formats GLB and STL, dimensions 50 × 50 × 50 mm (width × height × depth, radius 43.3 mm), default camera azimuth 30, tilt 20, distance factor 2.4, FOV 35, scale 1:1, no hotspots, no discount, licences personal only.

| Slug | Title | Category | State / visibility | First published (UTC) | Specifics |
|---|---|---|---|---|---|
| `survey-lantern` | Survey Lantern | hard-surface | published / public | 2026-10-20 10:00 | 80 × 120 × 90 mm, radius 85.0 mm. Personal 2161, commercial 6483, studio 17288 cents list, discount 15. Hotspots: `Handle loop` (0, 55, 0), `Glass panel` (40, 0, 0), `Fuel cap` (30, −50, 20). Embed token `emb_seed_lantern_7f3a91c2`. |
| `basalt-warden` | Basalt Warden | miniature | published / public | 2026-10-25 10:00 | 20 × 60 × 30 mm, radius 35.0 mm, scale 1:30, camera azimuth 0, tilt 10, factor 3.0, FOV 30. Personal 1200, commercial 3600. Edition of 25 at 3400 with copies 1 to 24 claimed (sold before the move, no Kill Bill records). Hotspots `Rune shield` (8, 5, 12), `Basalt base` (0, −28, 0). |
| `gearbox-cutaway` | Gearbox Cutaway | hard-surface | published / unlisted | 2026-10-15 10:00 | Share token `shr_seed_gearbox_4kq7w2`. Personal 1500. |
| `commission-ketch` | Commission Ketch | scan | published / password | 2026-10-18 10:00 | Password `ketch-proof-7`. Personal 4000. GLB only. |
| `client-bust-halden` | Client Bust Halden | scan | published / private | 2026-08-20 10:00 | Personal 9000. GLB only. |
| `pressure-gauge-mk1` | Pressure Gauge Mk1 | hard-surface | withdrawn / public | 2026-08-25 10:00 | Personal 800. |
| `arch-window-trim` | Arch Window Trim | hard-surface | draft / private | — | Personal 1000. |
| `lichen-plinth` | Lichen Plinth | scan | draft / private | — | Owner Kit Arden. Personal 1000. |
| `ferry-bollard` | Ferry Bollard | hard-surface | in_review / public | — | Owner Kit Arden. Personal 1100. |
| `tin-robot` | Tin Robot | miniature | draft / private | — | Owner Sol Varga. Personal 900. |

**Fillers.** For n = 1 to 40, slug `workshop-piece-<nn>` and title `Workshop Piece <nn>` (two digits), with description `Workshop study piece <nn> for the demo catalogue.` Each is published and public, first published 2026-09-01 10:00 UTC plus (n − 1) days.

- Category: `hard-surface` when n mod 3 = 1, `miniature` when n mod 3 = 2, `scan` when n mod 3 = 0.
- Personal price: 500 + 37 × n cents.
- Commercial (3 × personal) when n mod 3 ≠ 0. Studio (8 × personal) when n mod 5 = 0.
- STL when n mod 4 ≠ 0. GLB always.

**Collections**

| Slug | Name | Models |
|---|---|---|
| `workshop-lighting` | Workshop Lighting | survey-lantern, workshop-piece-01, workshop-piece-04 |
| `tabletop-wardens` | Tabletop Wardens | basalt-warden, workshop-piece-02, workshop-piece-05, workshop-piece-08 |
| `client-work` | Client Work | client-bust-halden, commission-ketch |

**Read API key.** Name `Demo reader`, reference `k_seed0001`, key `tsr_seed_5d0c2b7e91a4f368`.

For example, with the seed data at start:

- The catalogue holds 42 models.
- Category counts: hard-surface 15, miniature 14, scan 13.
- Licence counts: personal 42, commercial 29, studio 9.
- Format counts: glb 42, stl 32.
- Commercial with STL matches 22 models, which is three pages of 8, 8 and 6.
- Survey Lantern's personal licence costs €18.37, commercial €55.11 and studio €146.95. An upgrade from personal to commercial costs €36.74.
- Totals: public 42, unlisted 1, password 1, private 1, drafts 3, in review 1, withdrawn 1. Collection counts: 3, 4, 2.
- On Basic, the within-plan published models are Client Bust Halden and Workshop Pieces 01 to 29.

## Technical requirements

### Deployment (DP-58)

- The runtime is Node.js 22 LTS with npm, and the app is written in TypeScript.
- `/app/run.json` holds string commands `install`, `build` and `serve`, plus `"_schema":"run-manifest-v1"`. For example: `{"_schema":"run-manifest-v1","install":"npm ci","build":"npm run build","serve":"npm run start"}`.
- The server binds `0.0.0.0` on port 4173, or on `APP_PUBLIC_PORT` when it is set.
- `GET /api/health` answers HTTP 200 `{"status":"ok"}`.
- The app may be started several times at once against different databases, buckets, indexes and `STUDIO_INSTANCE` values, and every instance must work.

### Configuration and secrets (DP-60)

The app reads every value below at start:

- Database: `DATABASE_URL`.
- Object storage: `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_FORCE_PATH_STYLE`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`.
- Billing: `KILLBILL_URL`, `KILLBILL_USERNAME`, `KILLBILL_PASSWORD`, `KILLBILL_API_KEY`, `KILLBILL_API_SECRET`.
- Mail: `SMTP_HOST`, `SMTP_PORT`, `MAIL_FROM`.
- Search: `MEILISEARCH_URL`, `MEILISEARCH_API_KEY`, `MEILISEARCH_INDEX` (default `models`).
- Instance and queue: `STUDIO_INSTANCE` (default `main`), `QUEUE_RETRY_SECONDS` (comma-separated whole seconds, default `30,120,600`).
- Public address: `APP_PUBLIC_PORT`, `APP_PUBLIC_URL`.

The app creates its own session signing secret on first start and stores it in PostgreSQL. No credential or provider URL is hard-coded, logged in responses, or sent to the browser.

### Server boundary (DP-58)

- The browser talks only to the app's own origin. The app calls every provider server-side.
- A state-changing request whose `Origin` header names another origin answers 403 `cross_origin`. Requests without an `Origin` header are accepted.
- Pages may be framed only by the app's own origin, except `/embed/<embed token>`, which any site may frame.
- Request size limits are those in API.
- The server never serves source files, source maps, `run.json`, environment files, lockfiles, the `.git` folder or any credential. Such paths answer 404 `not_found`. No debug, test or seed endpoints exist.
- With any provider unreachable at boot, the server still starts, answers health, shows the matching banner, and reconnects within ten seconds of the provider answering, without a restart.
- Schema creation, Kill Bill catalogue upload, author account creation, index settings and the seed retry until they succeed.

### Browser support and performance (DP-14, DP-57)

- Latest Chromium, Firefox and WebKit, at 375x812, 768x1024 and 1280x800, with mouse, keyboard and touch.
- The catalogue shows its first results within two seconds of navigation, and a facet change updates within one second.
- The viewer accepts input within three seconds of the model page loading.

## Working rules

- IF-01: `/app/run.json` exists with string `install`, `build` and `serve` commands and `"_schema":"run-manifest-v1"`, and nothing else is needed to install, build and serve.
- IF-02: `THIRD_PARTY_NOTICES.md` at `/app` lists every shipped package (the production dependency tree from `npm ls --omit=dev --all --json`) with its name, version and licence, plus every bundled font.
- IF-03: Every shipped package (same definition as IF-02) and every bundled font is under MIT, ISC, BSD-2-Clause, BSD-3-Clause, Apache-2.0, 0BSD, MPL-2.0 or the SIL Open Font License 1.1.
- IF-04: The app uses no datastore beyond PostgreSQL, MinIO, Kill Bill, Mailpit and Meilisearch: no SQLite, no other key-value store, and no model or order data on the local disk.
- IF-05: The provided development service definitions (compose files and their seed jobs) are left unchanged.
- IF-06: All application source is TypeScript compiled with `strict` enabled.
- IF-07: Fonts are served from the app itself. No page loads a script, style or font from another origin.

## Engineering standards

- Code is idiomatic, strictly typed TypeScript with no `any` escapes and no ignored type errors.
- Names in code match the domain terms in this brief: model, revision, upload, stage, visibility, licence, edition copy, plan, quota, collection, embed, share link, read key.
- Each domain rule is decided in exactly one place in the source: legal state moves, plan entitlements, the money computation and rounding, the within-plan ranking, idempotent replay, the edition claim, and the visibility filter for derived surfaces.
- No abstraction has only one implementation, and there is no dead, commented-out or unreachable code.
- There are no defensive checks for states the domain rules make impossible.
- Every API error is produced through one error shape with the published codes.
- Nothing is built beyond this brief.
