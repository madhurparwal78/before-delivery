# Pain de Lune Loafline

Loafline is the shop and back room for Pain de Lune, a one-person cold-process soap studio. The studio sells small loaves of limited scents in timed drops, and a subscribe-and-save bundle called the Trio. It ships across Québec and the rest of Canada, and it sells in Canadian French and Canadian English. Shoppers watch a cured batch drop, hold a bar, confirm their email with a one-time code and pay. Subscribers manage their Trio from their account. The maker logs loaves and schedules drops. A finance assistant refunds, credits and reconciles. A packing helper sees what ships today. Build it as one TypeScript web app on three services:
- PostgreSQL holds all shop data.
- Kill Bill is the system of record for money: customer accounts, the subscription catalog, invoices, payments, refunds, item adjustments, billing blocks and credits.
- An SMTP mail server receives every customer email. It is Mailpit in development and grading.

Out of scope: card capture (payments go through Kill Bill's external payment method), customer passwords (customers sign in with an emailed code), wholesale ordering, stock for anything other than drop bars, currencies other than Canadian dollars, and any datastore other than PostgreSQL.

## Problem and users

A cold-process soap maker pours a loaf, cuts it into a fixed number of bars and then waits at least four weeks for the bars to cure before any can be sold. Each limited scent is therefore a small, fixed stock that becomes sellable on a known date. When a drop opens, the bars are gone in minutes. Today the storefront, the subscription app and the maker's spreadsheet each show a different stock figure. Shoppers pay for bars that were already sold. The maker refunds by hand and issues apology credits that never match the billing system. A bookkeeper spends an evening each month matching subscription invoices, refunds and goodwill credits against payouts. Subscription tools don't understand cure dates or loaf-sized stock, and drop tools don't understand subscribe-and-save. Every receipt and notice must also arrive in both official languages, with correct tax.

Users:
- **Shopper** (occasional): watches a cured batch drop at its published time, holds a bar, confirms their email with a code at checkout and either gets the bar or a clear sold-out answer.
- **Subscriber** (weekly): keeps one Trio on a monthly, two-month or three-month cadence. They skip, swap scent, change cadence, pause or cancel without writing to support.
- **Maker** (daily): logs a new loaf with its pour date and cure time, records how many bars it was cut into, schedules its drop, and watches true stock and held bars live.
- **Finance assistant** (weekly): looks up any order or subscription, issues refunds and goodwill credits within a cap, and reconciles the shop's records against Kill Bill each Toronto calendar month.
- **Packing helper** (daily): sees what to pack and ship today and marks orders shipped, without seeing money, payment details or refund tools.

## Journeys

1. **Catch a drop.** The shopper starts on the drop page with no session and a live batch on screen, on a desktop or a phone. They scroll (wheel, keys or touch) and watch the wire cut through the loaf, read the stock off the standing slices, pick a scent, and choose "Hold a bar". On the checkout page they enter their email, receive a six-digit code, verify it, enter a Canadian address and pay. The journey ends on the "Order PDL-…" placed page, with one bilingual order confirmation in their inbox. If the last bar went to someone else, or their hold ran out, they see the published sold-out or hold-ended message, and nothing is charged.
2. **Start a Trio.** The subscriber starts on the subscribe page. They pick a scent, open the cadence menu, choose a cadence, confirm their email by code, enter an address and start the subscription. The journey ends on the subscription's page, which shows what was charged today and the next bill date, with one bilingual subscription-started email in their inbox. Pressing start again, in the same tab or another one, never creates a second Trio.
3. **Run a Trio.** The subscriber signs in by code from the account page and opens a subscription. They skip the next delivery and undo it, swap scent, change cadence, pause and resume. Each change shows its result and the updated next bill date, and Kill Bill holds the matching billing block or dated plan change. Inside the lock window before a bill date, changes are refused with the published locked message.
4. **Log, cut and drop a loaf.** The maker signs in to the studio and logs a loaf with its scent, pour date and cure days. They record the cut with its bar count and schedule the drop in Toronto time (or open it at once when cured). The batch board then shows the batch go live and its counts change as shoppers hold and buy.
5. **Pack today's orders.** The packing helper signs in and opens "Pack today". They see each unshipped order due to ship by today, with name, address and bars but no money, and they mark orders shipped. A second click, or a colleague marking the same order, never ships it twice. Finance tools are refused to them by the server.
6. **Refund, credit and reconcile.** The finance assistant signs in and finds an order. They refund one bar with restock and later the rest of the order, and add a goodwill credit; the customer receives one notice for each, and Kill Bill shows each refund adjusted item by item. They then open the month's reconciliation, filter it to mismatches, accept Kill Bill's figure for a mismatched line and refund an orphan payment. Every action appears in the audit log.
7. **Write to the shop.** A visitor fills in the contact form and sends it. They see their reference number, and they receive one bilingual acknowledgement email, even if the mail server was briefly down. If mail stayed down long enough for the notice to fail, staff resend it once.

## Mandatory requirements

This is the complete list of mandatory requirements; every check traces to one of these lines and the detailed sections below.

- **DP-01 — Run manifest and health** Ship /app/run.json with install, build and serve commands, serve on port 4173 (or APP_PUBLIC_PORT) on all interfaces, and answer GET /api/health with 200 {"status":"ok"} even while Kill Bill or the mail server is unreachable.
- **DP-02 — Server boundary and secrets** Accept only same-origin JSON within the published size limit, never serve source or configuration files, and never let a service credential reach the browser, an API body or an email, as set out in Server boundary.
- **DP-03 — One error shape, order and allowed keys** Every API error uses the single published error body and precedence, and a request body carrying any key outside its route's published keys answers 422 at that key's dotted path and changes nothing.
- **DP-04 — Two languages without layout shift** Every screen, live-region message and email is available in Canadian French and Canadian English, and switching language moves the loaf figure by at most 1 pixel.
- **DP-05 — Three viewports without sideways scrolling** Every screen works at 375×812, 768×1024 and 1280×800 without the page scrolling sideways, with the stacked layout and the "Show bar list" disclosure below 1024 pixels wide.
- **DP-06 — Keyboard focus rules** Every page's first Tab stop is the "Skip to content" link, and menus, dialogs, alerts, skip controls and error summaries move and return focus exactly as published in Interactions.
- **DP-07 — Waxy, quiet, exact look** Screens use the matte oat ground, near-black ink, one rust accent reserved for actions and the wire, the published type pairing, equal-width figures for every number and tap targets of at least 44 pixels with WCAG 2.2 AA contrast, and the loaf reads as a matte soap loaf with a seeded swirl, a taut wire and paper-wrapped held bars.
- **DP-08 — Real integrations in source** Source reads every credential from the environment, records money only through real Kill Bill calls, sends mail only through SMTP from the outbox, draws the loaf procedurally with WebGL, and has no endpoint or flag that fakes state.
- **DP-09 — Motion timing and reduced motion** Motions run at the three published durations within their tolerance, nothing animates while idle, and the reduced-motion preference is followed live within 500 milliseconds, ending any running motion at its end state and replacing every motion with its published instant substitute.
- **DP-10 — Wire through the loaf** Scrolling the drop section by wheel, keyboard or touch moves the wire across the loaf so that the published progress, wire position and cut step follow the published scroll formula in both directions, and touch never turns the loaf.
- **DP-11 — Bars told apart by label and shape** Available, held and sold bars differ by visible label and shape, not colour alone, on the loaf, the bar list and the batch board.
- **DP-12 — Scent chips and deep links** Choosing a scent by pointer or keyboard retints the loaf and recomputes its cut step at once, and a bar deep link opens at the published scroll position.
- **DP-13 — Scene survives context loss** When the WebGL context is lost or unavailable, the figure shows the published state values and the loaf diagram fallback, and it returns to the live scene when the context is restored.
- **DP-14 — Loaf pixels match stock** The figure publishes the loaf band and every bar's front-face screen span, and when the cut is complete each sold bar's span shows the bare ground with the loaf turned straight, while every available or held bar's span is covered at any yaw, for any batch.
- **DP-15 — One stock figure on the drop page** The counts strip, bar list and scene show the server's cut, available, held and sold counts and catch up within 7 seconds of any change by another shopper.
- **DP-16 — Hold a bar** A shopper can hold the lowest-numbered available bar of a live batch, up to 2 bars per batch, and release a hold, with the published responses.
- **DP-17 — Last bar goes to one shopper** When several shoppers try to hold the last available bar at once, exactly one gets it and every other one gets the published sold-out or all-held answer with no charge.
- **DP-18 — Holds end on the server's clock** A hold stops at its published server-side expiry edge, a checkout received at or after that instant fails with 410 and no charge, creating no Kill Bill account, invoice or payment for that shopper, and the bar returns to the drop.
- **DP-19 — Announced cart updates** Hold start, the one-minute mark, hold end, total changes, releases and sold-out results are announced in the "Cart updates" polite live region with the published copy in the active language.
- **DP-20 — Step-up code without account hints** Requesting or checking a one-time code gives the same response for known and unknown emails within 2 seconds even when mail is down, allows at most the published number of code requests per email in the rolling window before the published 429 with Retry-After, and locks out after the fifth incorrect code with the published alert.
- **DP-21 — Your account shows only your records** An order or subscription number that belongs to someone else answers exactly like one that does not exist, on the page and in the API.
- **DP-22 — Checkout from hold to confirmation** A shopper can hold a bar, confirm their email by code, enter a Canadian address, pay, see the "Order … placed" heading and receive one bilingual order confirmation in Mailpit.
- **DP-23 — Drop order totals and taxes** Drop order subtotal, shipping, tax lines and total follow the published province table and rounding, and the Kill Bill invoice and payment match them to the cent.
- **DP-24 — One payment per checkout key** Retrying a checkout with the same idempotency key returns the original response and creates no second payment, order or email, and reusing the key with a different body answers 409.
- **DP-25 — All-or-nothing checkout** A checkout either records the order, Kill Bill invoice and payment, stock sale and confirmation notice together, or records none of them and leaves the holds as they were, whether Kill Bill failed or the request was refused.
- **DP-26 — Start a Trio subscription** A subscriber can pick a scent and cadence, confirm their email, start a Trio, land on its page and receive one bilingual subscription-started email in Mailpit.
- **DP-27 — Trio price matches Kill Bill** The Trio's 12 percent discount and taxes follow the published formula, a missing cadence is rejected with the published 422, and the first Kill Bill invoice matches to the cent.
- **DP-28 — Credit-covered first invoice** When a subscriber's goodwill credit covers their first Trio invoice, Kill Bill applies it, nothing is charged, and the app and email show $0.00 charged today.
- **DP-29 — One Trio per customer** A customer holds at most one active or paused Trio, so simultaneous starts yield exactly one subscription, one Kill Bill subscription and one email, and any other start answers the published 409.
- **DP-30 — Skip, swap and change cadence** A subscriber can skip or unskip the next delivery, swap scent, change cadence, pause, resume and cancel along the published state machine until the cycle locks in Toronto time.
- **DP-31 — Kill Bill mirrors subscription changes** Skips, unskips, pauses, resumes, cadence changes and cancellations appear in Kill Bill as the published blocking states and dated plan events, and a change that fails leaves none of them behind.
- **DP-32 — Billing outage shown honestly** While Kill Bill is unreachable, checkout and subscription changes answer 503 without changing any record, reconciliation is marked stale, the published banners show, and all of it recovers without a restart.
- **DP-33 — Batch lifecycle** The maker can log a loaf, cut it, schedule or open its drop and withdraw it only along the published batch state machine, with the cure-date rule enforced.
- **DP-34 — Drop times in Toronto time** Drop times and the packing cutoff are entered and shown in Toronto time with the published format in both languages, whatever the browser's time zone, across daylight-saving changes.
- **DP-35 — Batch board** The maker's batch board shows every batch with its state, dates and the same stock counts and per-bar marks as the drop page, refreshed within 7 seconds.
- **DP-36 — Packing list and cutoff** The packing helper sees every unshipped, not fully refunded order due to ship on or before today under the published cutoff and listing rules, with no money fields, and can mark them shipped.
- **DP-37 — Staff roles enforced by the server** Each staff route answers 403 for roles outside the published role table, whatever the interface shows.
- **DP-38 — One shipment wins** Of simultaneous ship requests for one order exactly one succeeds, and when a ship races a refund of every remaining bar exactly one of the two succeeds and the other gets its published answer.
- **DP-39 — Refund bars with exact allocation** The finance assistant or maker can refund chosen bars of an order with optional restock, each refund splits its amount across bars, shipping and each tax by the published rule, Kill Bill's item adjustments match that split to the cent, and the customer receives one refund notice.
- **DP-40 — Goodwill credits within the cap** Staff can add a goodwill credit from $1.00 to $25.00 to a customer's Kill Bill account through an order or subscription, and amounts outside that range get the published field error.
- **DP-41 — Money actions refuse stale views** Refunds and credits must name the record version the staff member saw, so of two simultaneous submissions exactly one succeeds and the other answers 412.
- **DP-42 — Append-only finance audit** Every refund, credit, accepted reconciliation figure and orphan refund writes one audit entry with actor, reason, amount and Kill Bill reference, and no one can edit or delete it.
- **DP-43 — Reconcile a month** The finance assistant can load a Toronto calendar month's reconciliation of shop records against Kill Bill with every line placed by its published Toronto date, filter to mismatches and accept Kill Bill's figure with the published confirmation.
- **DP-44 — Orphan payments found and refunded** A Kill Bill payment with no matching shop record appears as a Kill Bill-only line, and refunding it returns the published amount and records it.
- **DP-45 — Notices retry and resend once** A notice that cannot be sent is retried after 5, 15 and then 45 seconds, in that order, is marked failed after the fourth attempt, and of simultaneous resends of a failed notice exactly one succeeds.
- **DP-46 — Backlog drains oldest first, once** When the mail server returns, waiting notices are sent strictly in enqueue order with the published tie-break, and each notice key reaches Mailpit exactly once.
- **DP-47 — Emails carry only public identifiers** Every email contains only the published identifiers, never a credential, internal host, Kill Bill id, token or link, and no user-entered text ever appears in a header.
- **DP-48 — Contact form and reply** A visitor can send the contact form, see the published reference message and receive one bilingual acknowledgement in Mailpit even if mail was briefly unreachable, and a name or email holding a line break or other control character is refused with its field error.

## Frontend

### Screens and layout (DP-04, DP-05, DP-07, DP-10, DP-15, DP-22, DP-26, DP-35, DP-36, DP-43)

Every page has a slim header with the brand name "Pain de Lune", the main navigation, and the language toggle. The main content follows it. Customer pages and studio pages share the same grid of twelve columns.

**Drop page** (`/`, deep links `/?batch=<code>` and `/?batch=<code>#bar-<k>`). The drop section begins at the top of the page. Its height is the viewport height measured once at page load plus 2,400 pixels, so the page always has at least 2,400 pixels of scroll travel inside it, and a phone browser's toolbar collapsing or reappearing never changes that travel. A footer follows the section.
- At 1024 pixels wide and above, the loaf figure stays pinned in the left seven columns for the whole drop section. The right five columns scroll a stack of sections divided by fine rules: the scent chips, Batch (batch code and bars cut), Cure date, Scent notes, Drop time, Price, the counts strip, the hold control with its result line, and the bar list.
- Below 1024 pixels wide, the layout stacks. The loaf figure stays pinned at the top at 56 percent of the viewport height while the sections scroll beneath it. The bar list starts collapsed behind the "Show bar list" disclosure.
- The page heading (level 1) is the selected batch's scent name.

**Checkout** (`/checkout`). The heading is "Checkout". Below it, in this order: the held-bars region with a countdown and release control per hold; the province picker; the order total; the email step (email, send code, code, verify); the shipping address; and the pay control. At 1024 pixels and above, the forms sit in the left seven columns and the order total stays pinned in the right five. Below 1024 pixels, everything stacks in the order listed.

**Order placed** (`/checkout/placed/<order number>`). A level 1 heading, a line saying where the confirmation goes, the order lines with tax and total, and the ship-on date.

**Subscribe** (`/subscribe`). The heading is "Trio subscription". Below it come the Trio description (three bars of one core scent per delivery), the scent radios, the cadence menu, the province picker and price breakdown, the email step, the shipping address and the start control. The province picker and the shipping address are the same controls as on checkout, with the same roles and accessible names from the table. The column layout follows the checkout page.

**Account** (`/account`). Without a session, this page shows the sign-in-by-code form. With a session, it shows "Your account" with lists of orders and subscriptions and a sign-out control.
- `/account/orders/<number>` shows an order. Its heading is "Order <number>".
- `/account/subscriptions/<number>` shows a subscription. Its heading is "Subscription <number>". The page shows state, scent, cadence, any pending cadence, the next bill date, the lock date and the price breakdown, with the controls.

**Contact** (`/contact`). A single-column form with name, email, topic and message. The topic control is a native select whose first option is an empty placeholder reading "Choose a topic" / "Choisissez un sujet", selected until the visitor picks a topic, so submitting the untouched form reports a topic error.

**Not found**. Any unknown page, or an order or subscription that is not yours, shows the heading "We couldn't find that", the line from Feedback states, and a link to the drop page. The status is 404.

**Studio** (`/studio` sign-in, then `/studio/batches`, `/studio/packing`, `/studio/finance`, `/studio/reconciliation`, `/studio/audit`, `/studio/notices`). A staff member who is already signed in and opens `/studio` gets the studio shell with the studio navigation, not the sign-in form. The studio navigation stays on screen and operable at all three viewport widths; it is never collapsed behind a menu or disclosure. It shows only the pages the signed-in role may use. Studio pages use dense tables divided by fine rules on the same grid. At 375 and 768 pixels wide, each wide table scrolls sideways inside its own labelled container, while the page itself never does.
- **Batch board**: a "Log a loaf" form above a table with one row per batch: code, scent, state, pour date, cure date, drop time, cut, available, held, sold, and a row of per-bar marks. Each row has its action buttons. The packing-cutoff setting sits below the table.
- **Pack today**: one row per order due to ship, with its bars and address and a "Mark shipped" control.
- **Finance**: a search box. Submitting it, by pressing Enter in the box or activating its button, runs the lookup; when exactly one record matches the term the record opens directly, with no result list and no further click. The selected order or subscription opens below it with its lines, refunds (each with its allocation), credits, the refund form and the credit form.
- **Reconciliation**: a month picker, the "Only mismatches" switch, a status line, and a table of lines with their totals.
- **Audit**: a read-only table of audit entries, newest first.
- **Notices**: a table of outgoing emails with status and attempt times, and a resend control on failed notices.

At 375×812, 768×1024 and 1280×800 no page scrolls sideways, and no text or control is clipped.

### Public screens and controls (DP-04, DP-06, DP-11, DP-12, DP-13, DP-15, DP-16, DP-19, DP-20, DP-22, DP-26, DP-29, DP-30, DP-33, DP-35, DP-36, DP-38, DP-39, DP-40, DP-43, DP-44, DP-45, DP-48)

These roles and accessible names are the public contract, given as English / French. Placeholders in angle brackets are defined under the table. Only these controls and regions are public; everything else is free.

**Every page**

| Role and name | Notes |
|---|---|
| link "Skip to content" / "Aller au contenu" | First Tab stop on every page. Moves focus to the main heading. |
| navigation "Main" / "Principal" | Links "Drop" / "Vente", "Subscribe" / "S'abonner", "Account" / "Compte", "Contact" / "Contact". Every link, and the language toggle beside them, stays on screen and operable at all three viewport widths; neither is collapsed behind a menu or disclosure. |
| button "Français" (shown in English) / "English" (shown in French) | Language toggle. |
| status "Service status" / "État du service" | Outage banners. Empty when all is well. |

**Drop page**

| Role and name | Notes |
|---|---|
| figure "Loaf" / "Bloc" | Holds the scene and carries the scene data attributes from Motion and effects. Its caption reads "Cut <c> of <N>" / "Coupe <c> sur <N>". |
| img "Loaf cross-section" / "Coupe du bloc" | The WebGL canvas inside the figure. |
| img "Loaf diagram" / "Schéma du bloc" | The fallback inside the figure. Present only while `data-state` is `lost` or `fallback`. |
| radiogroup "Scent" / "Parfum" | One radio per batch shown, named by the scent name. |
| region "Batch" / "Lot" | Batch code and "<N> bars cut" / "<N> pains coupés". |
| region "Cure date" / "Date de cure" | The cure date in the long date format. |
| region "Scent notes" / "Notes" | The scent's notes. |
| region "Drop time" / "Heure de la vente" | A time element whose machine value is the UTC instant and whose text is in the drop-time format. |
| region "Price" / "Prix" | "<price> a bar" / "<price> le pain". |
| status "Batch counts" / "Décompte du lot" | Visible counts strip: "Cut <cut> · Available <a> · Held <h> · Sold <s>" / "Coupés <cut> · Disponibles <a> · Réservés <h> · Vendus <s>". |
| button "Hold a bar" / "Réserver un pain" | Present only while the batch is live. |
| button "Show bar list" / "Afficher la liste des pains" | Present only below 1024 pixels wide. Carries an expanded state and controls the bar list. Its name stays the same when expanded. |
| list "Bars in this batch" / "Pains de ce lot" | One item per bar: "Bar <k>: available" / "Pain <k> : disponible", "Bar <k>: held" / "Pain <k> : réservé", "Bar <k>: sold" / "Pain <k> : vendu". |
| link "Go to checkout (<n>)" / "Passer au paiement (<n>)" | Present while the cart has active holds. `<n>` is the number of active holds. |
| status "Cart updates" / "Mises à jour du panier" | Polite live region. |

**Checkout and order placed**

| Role and name | Notes |
|---|---|
| heading "Checkout" / "Paiement" (level 1) | |
| region "Your held bars" / "Vos pains réservés" | One row per active hold: "Bar <k> · <scent> · <batch>". |
| timer "Hold time left for bar <k>" / "Temps restant pour le pain <k>" | Text `m:ss`. |
| button "Release bar <k>" / "Libérer le pain <k>" | |
| link "Back to the drop" / "Retour à la vente" | |
| combobox "Province" / "Province" | Native select. Values and labels from the province table in Business rules. It has no empty option and starts on `QC`, the same default as `GET /api/cart`, so the order total and the pay control are priced before the shopper touches it. |
| region "Order total" / "Total de la commande" | Lines Subtotal / Sous-total, Shipping / Livraison, one per tax, and Total. |
| textbox "Email" / "Courriel" | |
| button "Send code" / "Envoyer le code" | |
| textbox "Code" / "Code" | |
| button "Verify" / "Vérifier" | |
| textbox "Full name" / "Nom complet" | |
| textbox "Street address" / "Adresse" | |
| textbox "City" / "Ville" | |
| textbox "Postal code" / "Code postal" | |
| button "Pay <total>" / "Payer <total>" | Disabled names are in Feedback states. |
| alert "Check these fields" / "Vérifiez ces champs" | Error summary. One link per invalid field. |
| alert "Too many incorrect codes" / "Trop de codes erronés" | Lock-out alert. |
| alert "Too many code requests" / "Trop de demandes de code" | Shown when a code request is rate-limited. Also on `/account` sign-in. |
| heading "Order <order> placed" / "Commande <order> passée" (level 1) | On the order-placed page. |

**Subscribe, account and subscription**

| Role and name | Notes |
|---|---|
| heading "Trio subscription" / "Abonnement Trio" (level 1) | |
| radiogroup "Trio scent" / "Parfum du Trio" | Radios named by core scent name. |
| button "Cadence" / "Fréquence" | Opener with a listbox popup. Its visible text shows the chosen cadence label, or "Choose…" / "Choisir…" before a choice. |
| listbox "Cadence" / "Fréquence" | Options "Every month" / "Chaque mois", "Every two months" / "Tous les deux mois", "Every three months" / "Tous les trois mois". |
| region "Trio price" / "Prix du Trio" | Subtotal, subscribe-and-save discount, taxes, total and "Charged today" / "Prélevé aujourd'hui". The discount is shown as a negative money amount in the locale's negative format, for example `-$3.96`. |
| button "Start subscription" / "Commencer l'abonnement" | |
| heading "Sign in" / "Se connecter" (level 1) | On `/account` without a session. Uses the same email and code controls as checkout. |
| heading "Your account" / "Votre compte" (level 1) | |
| list "Orders" / "Commandes", list "Subscriptions" / "Abonnements" | Each item links to the record by its number. |
| button "Sign out" / "Se déconnecter" | |
| heading "Order <order>" / "Commande <order>" (level 1) | |
| heading "Subscription <sub>" / "Abonnement <sub>" (level 1) | |
| region "Next bill date" / "Prochaine date de facturation" | The date in the long date format, or "Paused" / "En pause". |
| button "Skip next delivery" / "Sauter la prochaine livraison" | |
| button "Undo skip" / "Annuler le saut" | Replaces the skip button while a skip is set. |
| button "Swap scent" / "Changer de parfum" | Applies the radio chosen in "Trio scent". |
| button "Pause" / "Mettre en pause", button "Resume" / "Reprendre" | Only the one that applies is present. |
| button "Cancel subscription" / "Résilier l'abonnement" | Opens the dialog below. |
| dialog "Cancel subscription?" / "Résilier l'abonnement?" | Buttons "Yes, cancel" / "Oui, résilier" and "Keep it" / "Le garder". |
| status "Account updates" / "Mises à jour du compte" | Polite live region on subscribe and account pages. |
| heading "We couldn't find that" / "Introuvable" (level 1) | Not-found page. |

**Contact**

| Role and name | Notes |
|---|---|
| textbox "Name" / "Nom" | |
| textbox "Email" / "Courriel" | |
| combobox "Topic" / "Sujet" | Native select. Values in Business rules. |
| textbox "Message" / "Message" | |
| button "Send message" / "Envoyer le message" | |
| status "Contact status" / "État du message" | Polite live region. |

**Studio**

| Role and name | Notes |
|---|---|
| textbox "Email" / "Courriel", textbox "Password" / "Mot de passe", button "Sign in" / "Se connecter" | `/studio`. |
| navigation "Studio" / "Atelier" | Links "Batches" / "Lots", "Packing" / "Emballage", "Finance" / "Finances", "Reconciliation" / "Rapprochement", "Audit" / "Journal", "Notices" / "Avis", in that order. Only the role's pages are shown, keeping that relative order. |
| status "Studio updates" / "Mises à jour de l'atelier" | Polite live region on every studio page. |
| region "Log a loaf" / "Consigner un bloc" | combobox "Scent" / "Parfum" (native select; one option per drop scent, each option's value is that scent's `Slug` from the drop scents table and its label the scent name in the active locale), textbox "Pour date" / "Date de coulée" (date input), spinbutton "Cure days" / "Jours de cure", button "Log loaf" / "Consigner le bloc". |
| table "Batches" / "Lots" | One row per batch. The per-bar marks cell is a list named "Bars of <code>" / "Pains de <code>" with the same item text as the drop page bar list. |
| button "Cut <code>" / "Couper <code>" | Opens dialog "Cut <code>" / "Couper <code>" with spinbutton "Bars cut" / "Pains coupés" and button "Save cut" / "Enregistrer la coupe". |
| button "Schedule <code>" / "Programmer <code>" | Opens dialog "Schedule <code>" / "Programmer <code>" with textbox "Drop date and time (Toronto)" / "Date et heure de la vente (Toronto)" (date-and-time input, minute precision) and button "Save drop time" / "Enregistrer l'heure". |
| button "Open now <code>" / "Ouvrir maintenant <code>" | |
| button "Withdraw <code>" / "Retirer <code>" | Opens dialog "Withdraw <code>?" / "Retirer <code>?" with "Yes, withdraw" / "Oui, retirer" and "Keep it" / "Le garder". |
| textbox "Packing cutoff (Toronto)" / "Heure limite d'emballage (Toronto)", button "Save cutoff" / "Enregistrer l'heure limite" | Maker only. |
| heading "Pack today" / "À emballer aujourd'hui" (level 1), table "Orders to pack" / "Commandes à emballer" | |
| button "Mark <order> shipped" / "Marquer <order> expédiée" | |
| searchbox "Find order or subscription" / "Chercher une commande ou un abonnement" | Accepts an order number, subscription number or email. |
| checkbox "Refund bar <k>" / "Rembourser le pain <k>" | One per unrefunded bar of the open order. |
| checkbox "Return bars to stock" / "Remettre en stock" | |
| textbox "Refund reason" / "Motif du remboursement", button "Issue refund" / "Rembourser" | |
| table "Refunds of <order>" / "Remboursements de <order>" | One row per refund: number, status, bars, shipping, one column per tax, amount. |
| textbox "Credit amount" / "Montant du crédit" | Dollars with two decimals. |
| textbox "Credit reason" / "Motif du crédit", button "Add credit" / "Ajouter le crédit" | |
| textbox "Month" / "Mois" | Month input, `YYYY-MM`. |
| switch "Only mismatches" / "Seulement les écarts" | |
| table "Reconciliation lines" / "Lignes de rapprochement" | Columns Key, Kind, Shop, Kill Bill, Status. Totals in the table footer. |
| status "Reconciliation status" / "État du rapprochement" | Stale banner. |
| button "Accept Kill Bill figure for <key>" / "Accepter le montant de Kill Bill pour <key>" | Mismatch rows only. |
| button "Refund orphan payment <key>" / "Rembourser le paiement orphelin <key>" | Kill Bill-only rows only. |
| table "Finance audit" / "Journal financier" | |
| table "Notices" / "Avis", button "Resend <notice>" / "Renvoyer <notice>" | Resend appears on failed notices only. |

Placeholders on screens:
- `<code>` is a batch code such as `B-0412`.
- `<k>` is a bar number.
- `<N>` and `<cut>` are the batch's bars cut.
- `<c>` is the current cut step.
- `<a>`, `<h>` and `<s>` are the available, held and sold counts from the server.
- `<order>`, `<sub>`, `<notice>` and `<key>` are numbers and keys in the formats from Business rules.
- `<price>` and `<total>` are money in the active locale's format.
- `<scent>` is the scent name in the active language.

### Interactions (DP-06, DP-10, DP-12, DP-16, DP-19, DP-20, DP-22, DP-26, DP-30, DP-43)

- **Skip link.** On every page the first Tab press focuses "Skip to content". Enter moves focus to the level 1 heading of the main content.
- **Language toggle.** Activating it sets the `pdl_locale` cookie to `fr-CA` or `en-CA`, switches every visible string and accessible name in place without reloading the page, and sets the document's language to `fr-CA` or `en-CA`. Focus stays on the toggle, which now has the other name. Switching never moves the loaf figure's box by more than 1 pixel in any direction at any of the three viewports. When no cookie is set, the active locale is `fr-CA` if the browser's preferred language starts with `fr`, and `en-CA` otherwise.
- **Scroll on the drop page.** Scrolling down moves the wire through the loaf and tips slices as it passes bar boundaries. Scrolling back up stands the slices back up, one boundary at a time, in reverse. Keyboard scrolling (Space, Page Down, arrows, Home, End) and touch scrolling (a finger drag or fling on a phone or tablet) drive the scene exactly as wheel scrolling does, by the same formula and in the same frame. Page scrolling is instant, not smoothed.
- **Pointer on the loaf.** Moving a mouse or pen across the figure turns the loaf slightly toward the pointer, by the yaw rule in Motion and effects. When the pointer leaves, the loaf turns back to straight. Touch contacts (taps, drags, flings) never turn the loaf.
- **Scent chips.** The scent radiogroup is one Tab stop. Left and Right arrows (and Up and Down) move to the next or previous scent and select it, wrapping in both directions: Right or Down from the last chip selects the first, Left or Up from the first selects the last. Clicking or tapping a chip selects it. Selecting a scent updates the URL to `/?batch=<code>`, replaces the heading and sections with that batch, and retints the loaf, as set out in DP-12.
- **Deep links.** Opening `/?batch=<code>` selects that batch with the page at the top. Opening `/?batch=<code>#bar-<k>` selects the batch and scrolls to the published deep-link position. An unknown or non-public batch code selects the default batch. The default batch, used for `/` and for any unknown or non-public code, is the first batch in `GET /api/drop` order whose state is `live`, or the first batch listed when none is live. For example, with the seed data at start it is B-0412.
- **Show bar list** (below 1024 pixels). Enter, Space or a tap toggles the list open or closed and updates the expanded state. Focus stays on the button.
- **Hold a bar.** Enter, Space or a click sends the hold. Focus stays on the button. On success, "Go to checkout (<n>)" appears and the hold is announced.
- **Release bar <k>.** Releasing removes the row. Focus moves to the next row's release button, or to the previous row's if there is no next row, or to "Back to the drop" if no holds are left.
- **Countdown.** Each hold's timer counts down once a second from the server's expiry, using the server time returned with the cart. When it reaches 0:00, the row is replaced within 1 second by the hold-ended message, without waiting for a poll.
- **Email step.** "Send code" requests a code. "Verify" checks it. Pressing Enter in the code field verifies. After verifying, the email step collapses to "Signed in as <email>" / "Connecté en tant que <email>", and focus moves to "Full name".
- **Rate-limited code request.** When "Send code" gets the 429 `rate_limited` answer, the "Too many code requests" alert appears above the email step and takes focus. It stays until the next code request that succeeds.
- **Lock-out.** When "Verify" gets 429 `stepup_locked`, the "Too many incorrect codes" alert appears above the email step and takes focus.
- **Error summary.** When a submitted form has field errors, the "Check these fields" alert appears above the form and takes focus. It holds one link per invalid field, in the form's order, whose text is that field's message. Activating a link focuses the field. Each field also shows its message beneath itself and is marked invalid with `aria-invalid="true"` on the field itself.
- **Cadence menu.** Enter, Space or Down Arrow on the "Cadence" button opens the listbox and moves focus to the currently selected option, or to the first option if none is chosen. Up and Down Arrows move between options. Enter or a click chooses the option, closes the listbox and returns focus to the button. Escape closes the listbox without changing the cadence and returns focus to the button. Tab closes it without change. On a subscription page, choosing a different cadence sends the change at once.
- **Skip and undo.** "Skip next delivery" sends the skip. On success it is replaced by "Undo skip", which receives focus. "Undo skip" sends the unskip, and on success "Skip next delivery" returns and receives focus. Focus never falls to the page body.
- **Dialogs** (cancel subscription, cut, schedule, withdraw). Opening a dialog moves focus to its first control. Tab and Shift+Tab stay inside the dialog. Escape or the dismissing button closes it and returns focus to the button that opened it. After a confirming button succeeds, focus moves to the level 1 heading.
- **Reconciliation switch.** Space, Enter or a click toggles "Only mismatches". When it is on, only lines whose status is `mismatch` stay in the table. Focus stays on the switch.
- **Polling.** The drop page and checkout poll the shown batch and cart every 5 seconds. The batch board polls every 5 seconds. Every page polls `GET /api/status` every 5 seconds. A value shown from a poll reflects a server change within 7 seconds of that change. No other value on screen changes except on the user's own action.

### Visual design (DP-07, DP-11)

- **Mood.** The pages feel waxy, quiet and exact.
  - Waxy: every surface is matte, like the face of a cured bar, with no gloss, sheen, gradient or drop shadow.
  - Quiet: a single accent colour, only on things you act on.
  - Exact: every price, count, date and countdown is set in figures of equal width, so columns of numbers line up and timers never jitter.
- **Colour roles.**
  - Ground: a pale warm oat, like unbleached paper.
  - Ink: a warm near-black for all text.
  - Accent: a burnt rust used only for primary buttons, focused or pressed controls, the switch when on, and the cutting wire. Never decoration.
  - Sage: a muted grey-green used only for shapes and marks such as the available-bar marks, never for body text.
  - Rule: a light tan used for hairline dividers and table rules.
  - Text and controls meet WCAG 2.2 AA contrast against the oat ground: at least 4.5 to 1 for text and 3 to 1 for control outlines, focus rings and status marks. Primary buttons use oat-coloured text on the rust fill.
  - Focus is shown by a two-pixel rust ring with a small gap.
- **Type.** Headings use Fraunces, a soft, slightly old-style serif with rounded wedge serifs. Body text and controls use Instrument Sans, a compact, neutral sans-serif. Each heading level is one and a quarter times the size of the level below it, starting from body size. Both families are bundled with the app under their open-font licences.
- **Density.** Comfortable on customer pages, with generous space around each ruled section. Dense on studio tables, with tighter rows divided by tan hairlines.
- **Composition.**
  - On wide screens, the loaf figure is a large still-life on the left, and the right column reads like a label card: fine rules between Batch, Cure date, Scent notes, Drop time and Price.
  - On narrow screens, the loaf sits on top with the label card below.
  - The studio uses the same grid with ledger-like tables.
- **Bar states, never colour alone.**
  - Available bar: an upright solid block with the word "available" / "disponible".
  - Held bar: a block wrapped in brown kraft paper with a folded corner and a small tag reading "held / réservé".
  - Sold bar: an empty dashed outline with the word "sold" / "vendu".
  - These shapes and words appear in the loaf scene (sold bars there are simply gone), in the bar list, and in the batch board's per-bar marks.
- **The loaf.** A long rectangular block with a slightly domed, hand-textured top, like a loaf unmoulded from a wooden box. Its sides carry the scent's tint. Each cut face shows a two- or three-tone marbled swirl in the scent's tint family, generated from the batch code, so the same batch always shows the same swirl. The light is soft and directional with no specular shine. Every scent tint and the kraft paper are clearly darker than the oat ground, so a standing bar never reads as background. The scene has no floor, backdrop or shadow: behind the loaf is only the ground. The wire is a thin, taut rust line spanning the loaf's depth, with a small handle at each end.
- **Controls.** Every control and tap target is at least 44 by 44 pixels. Buttons have square-cut corners with a small radius.

### Motion and effects (DP-09, DP-10, DP-12, DP-13, DP-14)

Durations come in three sizes. Each run must fall inside its tolerance band.

| Size | Duration | Tolerance | Used for |
|---|---|---|---|
| Short | about 0.18 seconds | 0.12 to 0.24 s | Hover and press feedback, chip selection, the switch thumb |
| Medium | about a third of a second (0.32 s) | 0.24 to 0.40 s | Wire snap after a scent change, the loaf turning back after the pointer leaves, disclosure and dialog open and close |
| Long | about 0.6 seconds | 0.48 to 0.72 s | A slice tipping away or standing back up, paper wrapping or unwrapping a held bar |

Every motion starts quickly and settles softly, slowing into its end position with no bounce and no overshoot.

What each motion means:
- **Hover and press.** Primary buttons deepen slightly and the pressed button sinks by one pixel.
- **Chip selection.** The selected chip's outline fills in rust.
- **Switch thumb.** The thumb slides across the track, and the track fills rust when on.
- **Disclosure and dialogs.** Panels open downward and dialogs fade and rise slightly into place. On close they reverse.
- **Hold rows.** A new hold row slides in from the right. A released or ended row folds away.

**Signature: Wire through the loaf.** The figure "Loaf" exposes these data attributes, always kept current:

| Attribute | Value |
|---|---|
| `data-state` | `ready` (scene drawing), `lost` (context lost), or `fallback` (WebGL unavailable at load) |
| `data-batch` | The selected batch code |
| `data-tint` | The selected scent's tint name from Seed data |
| `data-swirl-seed` | The selected batch code |
| `data-bars-total` | N, the batch's bars cut |
| `data-progress` | Scroll progress p, rounded half up to exactly three decimals, from `0.000` to `1.000` |
| `data-wire` | The wire position w in bars, cut down (never rounded up) to exactly two decimals |
| `data-cut-step` | The cut step c, an integer from 0 to N |
| `data-bars` | N letters, one per bar in bar-number order: `A` available, `H` held, `S` sold |
| `data-yaw` | The loaf's turn in whole degrees |
| `data-loaf-band` | `<y0>-<y1>`: the top and bottom of the standing loaf on screen |
| `data-bar-spans` | N entries `<x0>-<x1>` separated by single spaces, in bar-number order: each bar's front-face slot on screen |
| `data-motion` | `full` or `reduced` |
| `data-animating` | `true` while any slice, wrap or wire motion is running, otherwise `false` |

Constants and formulas:
- **Scroll offset.** s is the window's vertical scroll offset (scrollY) in whole pixels, rounded down if the browser reports a fraction, then clamped to 0 to 2,400 inclusive. This is the same at every viewport and for wheel, keyboard and touch scrolling; the pinned figure's size never changes it. Every value below is computed from the integer s in exact integer arithmetic, never from the rounded p, so floating-point error cannot change a result.
- **Progress.** p = s ÷ 2400, rounded half up to three decimals: `data-progress` = floor((s × 1000 + 1200) ÷ 2400) ÷ 1000, shown with exactly three decimals.
- **Wire position.** w = s × N ÷ 2400 bars. `data-wire` = floor(s × N ÷ 24) ÷ 100, shown with exactly two decimals, so it is cut down and never rounded up.
- **Cut step.** c = floor(s × N ÷ 2400), so c = N exactly when s = 2,400.
  - For example, with the seed batch B-0412 (N = 12): scrollY 0 gives `0.000`, `0.00`, step 0. scrollY 200 gives `0.083`, `1.00`, step 1. scrollY 1,199 gives `0.500`, `5.99`, step 5. scrollY 1,200 gives `0.500`, `6.00`, step 6. scrollY 2,400 or more gives `1.000`, `12.00`, step 12. At 375×812, scrollY 2,400 gives `1.000` whether or not the browser's toolbar has collapsed.
- **Bar deep link.** `/?batch=<code>#bar-<k>`, with k from 1 to N, opens at scrollY = ceil(2400 × k ÷ N). The figure then reads cut step k.
  - For N = 12 that is 200 × k.
  - For N = 10 it is 240 × k.
  - For N = 14: k = 1 → 172, k = 7 → 1,200, k = 13 → 2,229.
  - A k outside 1 to N leaves the page at the top.
- **Yaw.** While a mouse or pen is over the figure, yaw = round((x ÷ width − 0.5) × 24), where x is the pointer's horizontal offset inside the figure. That gives −12 at the left edge, 0 at the centre and +12 at the right edge. When the pointer leaves, yaw returns to 0 over the medium duration. Without a mouse or pen over the figure, for every touch contact, and always with reduced motion, `data-yaw` is `0`.
- **Screen geometry.** `data-loaf-band` and `data-bar-spans` are whole CSS pixels measured from the figure box's top-left corner, clamped to the figure box, so they are never negative. y0 < y1. Each span is the bar's front-face slot: the left and right screen edges, along the middle row of the loaf band, of the stretch of the loaf's front face between that bar's two cut planes, at the current camera and yaw. It is the same whether or not the bar is standing (a sold bar keeps the slot it would occupy). Side faces are never part of a span. Spans run left to right in bar order, each at least 8 pixels wide; neighbouring spans share at most their touching edge pixel and never overlap further. Both attributes are updated in the same frame as any yaw, resize or batch change.
- **What changes when.**
  - `data-progress`, `data-wire` and `data-cut-step` update on every scroll frame, with no lag.
  - The visible slices follow the cut step: crossing a boundary starts that slice's long tip motion. Crossing back starts it standing up again. Each boundary crossed is its own motion, so scrolling back reverses step by step.
  - `data-animating` is `true` from the first frame of a motion to its last, so a tip lasts exactly as long as `data-animating` stays `true` for it alone.
- **Through and after the cut.**
  - While c < N, each bar with k ≤ c lies tipped forward on its face, below the loaf band, showing its swirl; bars with k > c stand in the loaf.
  - A sold bar is absent at every step, so nothing tips at its boundary. A held bar, standing or tipped, already wears its paper wrap and tag.
  - When c reaches N, the cut is complete: every bar that is not sold stands back upright in its own place over the long duration, giving the stock arrangement. Available bars stand bare, held bars stand wrapped with the "held / réservé" tag, and sold bars are absent, leaving the ground visible in their span.
- **Pixels match state.** The canvas clears to exactly the page's ground colour. With `data-state` `ready`, the cut complete and `data-animating` `false`, sampling the row of pixels halfway between y0 and y1:
  - at yaw 0, across the middle 60 percent of each sold bar's span, at least 90 percent of pixels are within 16 per colour channel of the page's ground colour. At yaw 0 the camera looks square at the loaf's front face, so the side face a neighbouring bar shows into a sold bar's gap covers no more than 10 percent of that middle 60 percent;
  - at yaw 0, −12 and +12, across the middle 60 percent of each available or held bar's span, at most 20 percent are.
  - At yaw −12 and +12 a neighbour's side face may legitimately show inside a sold bar's gap, so the sold-bar check applies at yaw 0 only. Both checks hold for every batch shown.
- **Scent change** (pointer, keyboard or deep link):
  - `data-batch`, `data-tint`, `data-swirl-seed`, `data-bars-total`, `data-bars`, `data-bar-spans` and `data-cut-step` take the new batch's values at once, with the cut step recomputed from the current scroll and the new N.
  - The loaf retints and reseeds its swirl.
  - The wire snaps to the new position over the medium duration.
  - Choosing a scent with the keyboard gives exactly the same end state as clicking it.
- **Stock changes from the server.** A bar that becomes held is wrapped. A held bar whose hold ends is unwrapped. A sold bar disappears. Each takes the long duration and is reflected in `data-bars` as soon as the poll returns.
- **Context loss.**
  - When the WebGL context is lost, within 1 second `data-state` becomes `lost`, the canvas is hidden from view and from assistive tech, and the img "Loaf diagram" appears in its place. The diagram is a flat drawing of N bars in a row with the wire line at the current cut step and each bar drawn in its state shape. All other data attributes keep updating.
  - When the context is restored, within 1 second `data-state` returns to `ready`, the diagram is removed, and the scene redraws at the current cut step, batch and stock without replaying motions.
  - If WebGL cannot start at load, `data-state` is `fallback` and the diagram stays.
- **Caption.** The figure caption always reads "Cut <c> of <N>" / "Coupe <c> sur <N>".
- **Idle.** Nothing loops or animates without a cause. When the user is not scrolling, pointing or acting and no stock change arrives, `data-animating` is `false` and the document reports no running animations. The countdown text changing once a second is a text update, not an animation. Unnamed decorative loops (floating, shimmer, pulsing, idle rotation) are not allowed.

**Reduced motion** (the user's system asks for reduced motion). `data-motion` is `reduced` and `data-animating` is never `true`.
- The wire and slices jump straight to the cut step for the current scroll, with no tweening. The caption carries the numbered step.
- A scent change applies the new batch's tint, swirl and final state for the current scroll instantly. The scene must show the selected batch, never stay on the first one.
- Wraps appear and disappear instantly.
- The loaf never turns toward the pointer.
- Hover, press, chip, switch-thumb, disclosure, dialog and hold-row motions become instant state changes.
- The bar list stays fully keyboard-reachable. Holding and buying work the same way.

**Following the preference live.** The page follows the system setting while open, with no reload:
- When it changes to reduced, within 500 milliseconds `data-motion` reads `reduced`, every running slice, wrap and wire motion jumps to its end state, `data-animating` becomes `false` and stays `false`, and the document reports no running animations.
- When it changes back to full, within 500 milliseconds `data-motion` reads `full`, and the next boundary crossing animates again within the long band.

### Feedback states (DP-16, DP-17, DP-18, DP-19, DP-20, DP-22, DP-26, DP-29, DP-30, DP-32, DP-33, DP-36, DP-38, DP-39, DP-40, DP-43, DP-44, DP-45, DP-48)

French copy rule: in French strings, the space before `:`, before `$`, before `%`, and between thousands is a no-break space (U+00A0). Every other space is ordinary. Pending labels end with the single ellipsis character (U+2026). While an action is pending, its control is disabled and marked busy, and its name is the pending label.

Placeholders used in copy:
- `<k>` is a bar number.
- `<left>` is the time left as `m:ss`.
- `<total>` and `<amount>` are money in the active locale.
- `<email>` is the email entered.
- `<date>` is a date in the long date format.
- `<order>`, `<sub>`, `<rf>`, `<cr>`, `<ct>`, `<notice>` and `<key>` are record numbers and keys.
- `<when>` is a drop time in the drop-time format.
- `<checked>` is a time shown as the drop-time format.

**Cart updates** (status "Cart updates", polite)

| Event | English | French |
|---|---|---|
| Hold succeeded | Bar <k> is held for you. Time left: <left>. | Le pain <k> est réservé pour vous. Temps restant : <left>. |
| Time left crosses 60 seconds | One minute left on your hold for bar <k>. | Plus qu'une minute pour votre réservation du pain <k>. |
| Hold ended (timer or poll) | Your hold on bar <k> ended. The bar is back in the drop. | Votre réservation du pain <k> a pris fin. Le pain est de retour dans la vente. |
| Released | Bar <k> released. | Pain <k> libéré. |
| Cart total changed | Total is now <total>. | Le total est maintenant de <total>. |
| 409 `sold_out` | Sold out. The last bar is gone. You were not charged. | Épuisé. Le dernier pain est parti. Aucun montant n'a été prélevé. |
| 409 `all_held` | Every bar is held right now. A bar comes back if a hold ends without payment. | Tous les pains sont réservés pour le moment. Un pain revient si une réservation se termine sans paiement. |
| 409 `hold_limit` | You can hold up to 2 bars from one batch. | Vous pouvez réserver au plus 2 pains d'un même lot. |
| 409 `not_live` | This batch isn't on sale yet. | Ce lot n'est pas encore en vente. |
| Code requested | If <email> can receive mail, a code is on its way. It works once and expires in a few minutes. | Si <email> peut recevoir des courriels, un code est en route. Il ne sert qu'une fois et expire dans quelques minutes. |
| 410 at checkout | Your hold ended before payment. You were not charged. | Votre réservation a pris fin avant le paiement. Aucun montant n'a été prélevé. |
| Network failure | We couldn't reach the shop. Check your connection and try again. | Impossible de joindre la boutique. Vérifiez votre connexion et réessayez. |

- The one-minute message is announced only if a hold starts with more than 60 seconds left.
- The total message is announced whenever the cart total changes, after a hold, release, end or province change.
- **Region content.** This rule holds for every named live region in this brief, including "Cart updates", "Studio updates" and "Account updates": each action or server event replaces that region's whole text; earlier messages are not kept, so the region always reads as exactly the latest action's message. When one action or event produces several messages, they are joined with a single space in this order: the event messages (one per affected bar, in bar-number order), then the total message when the cart total changed. For example, holding the first bar of B-0412 with the province at QC leaves exactly "Bar 1 is held for you. Time left: 10:00. Total is now $23.00.", and releasing it afterwards leaves exactly "Bar 1 released. Total is now $0.00."
- A 410 from checkout leaves exactly the "410 at checkout" message, followed by the total message when the cart total changed. No hold-ended message is added for that response.
- Pending labels: "Hold a bar" becomes "Holding…" / "Réservation…". "Send code" becomes "Sending…" / "Envoi…". "Verify" becomes "Checking…" / "Vérification…".
- **Lock-out.** The alert "Too many incorrect codes" / "Trop de codes erronés" reads: "Too many incorrect codes. Wait a few minutes, then request a new code." / "Trop de codes erronés. Patientez quelques minutes, puis demandez un nouveau code."
- **Rate limit.** The alert "Too many code requests" / "Trop de demandes de code" reads exactly the 429 `rate_limited` message: "Too many codes were requested for this email. Wait a few minutes, then try again." / "Trop de codes ont été demandés pour ce courriel. Patientez quelques minutes, puis réessayez." The same text is that response's `message`.
- **Hold control.** When the batch has no available bar but some are held, "Hold a bar" is disabled and named "All bars are held" / "Tous les pains sont réservés". When the batch is sold out, the control is replaced by the text "Sold out" / "Épuisé". When the batch is scheduled, it is replaced by "Drop opens <when>" / "La vente ouvre le <when>". A scheduled batch's page switches to live within 7 seconds of its drop time, without a reload.

**Pay control** (checkout). The first matching state wins:

| State | Name | Enabled |
|---|---|---|
| Payment in flight | Paying… / Paiement en cours… | no |
| Billing unavailable | Checkout paused / Paiement en pause | no |
| No active hold in the cart | No bars held / Aucun pain réservé | no |
| Email not verified in this session | Verify your email first / Confirmez d'abord votre courriel | no |
| Otherwise | Pay <total> / Payer <total> | yes |

- On success, the browser goes to the order-placed page. Its heading is "Order <order> placed" / "Commande <order> passée", whether the shopper came from the plain drop page or from a batch deep link. Below the heading it says "We'll email your confirmation to <email>." / "Nous enverrons votre confirmation à <email>." That line is true whether the email is sent at once or queued.

**Start subscription control.** The first matching state wins: "Starting…" / "Démarrage…" (disabled); "Subscriptions paused" / "Abonnements en pause" (disabled, billing unavailable); "Verify your email first" / "Confirmez d'abord votre courriel" (disabled); otherwise "Start subscription" / "Commencer l'abonnement".

**Account updates** (status "Account updates", polite)

| Event | English | French |
|---|---|---|
| Subscription started (shown on its page) | Subscription started. Charged today: <amount>. | Abonnement commencé. Prélevé aujourd'hui : <amount>. |
| 409 `subscription_exists` (on the subscribe page) | You already have a Trio. Manage it from your account. | Vous avez déjà un Trio. Gérez-le depuis votre compte. |
| Skip | Your <date> delivery is skipped. Next bill date: <date>. | Votre livraison du <date> est sautée. Prochaine date de facturation : <date>. |
| Undo skip | Skip undone. Next bill date: <date>. | Saut annulé. Prochaine date de facturation : <date>. |
| Scent swapped | Your Trio scent is now <scent>. | Le parfum de votre Trio est maintenant <scent>. |
| Cadence changed | From <date>, your Trio arrives <cadence lower-case label>. | À partir du <date>, votre Trio arrive <cadence lower-case label>. |
| Paused | Paused. Nothing is billed after <date>. | En pause. Rien n'est facturé après le <date>. |
| Resumed | Resumed. Next bill date: <date>. | Repris. Prochaine date de facturation : <date>. |
| Cancelled | Cancelled. Your last delivery is the one already paid. | Résilié. Votre dernière livraison est celle déjà payée. |
| 409 `cycle_locked` | This cycle is locked. Changes open again after <date>. | Ce cycle est verrouillé. Les modifications rouvrent après le <date>. |
| 409 `invalid_transition` | That change isn't possible right now. | Cette modification n'est pas possible pour le moment. |

- The cadence label in "Cadence changed" is lower-cased: "every three months" / "tous les trois mois".
- "Changes open again after <date>" uses the bill date that caused the lock.
- Pending labels for every account control: "Saving…" / "Enregistrement…".

**Service status banners** (status "Service status"). These appear within 20 seconds of Kill Bill becoming unreachable and clear within 20 seconds of its return, without a reload:
- Drop and checkout pages: "Checkout is paused: our payment system is unreachable. Held bars stay held until their timer ends." / "Le paiement est en pause : notre système de paiement est injoignable. Les pains réservés le restent jusqu'à la fin de leur minuterie."
- Subscribe and account pages: "Subscription changes are paused: our billing system is unreachable. Nothing has been changed." / "Les modifications d'abonnement sont en pause : notre système de facturation est injoignable. Rien n'a été modifié."

**Reconciliation status** (status "Reconciliation status"):
- Stale with earlier figures: "Reconciliation is stale: Kill Bill could not be reached. Showing figures from <checked>." / "Le rapprochement n'est pas à jour : Kill Bill est injoignable. Montants du <checked>."
- Stale with no earlier figures: "Reconciliation is stale: Kill Bill could not be reached. No earlier figures for this month." / "Le rapprochement n'est pas à jour : Kill Bill est injoignable. Aucun montant antérieur pour ce mois."
- Current: empty.

**Studio updates** (status "Studio updates", polite)

| Event | English | French |
|---|---|---|
| Loaf logged | Loaf <code> logged. | Bloc <code> consigné. |
| Cut saved | <code> cut into <N> bars. | <code> coupé en <N> pains. |
| Drop scheduled | <code> drops <when>. | <code> sera en vente le <when>. |
| Opened now | <code> is on sale now. | <code> est en vente maintenant. |
| Withdrawn | <code> withdrawn. | <code> retiré. |
| Cutoff saved | Packing cutoff is now <HH:MM> Toronto time. | L'heure limite d'emballage est maintenant <HH:MM>, heure de Toronto. |
| Shipped | <order> marked shipped. | <order> marquée expédiée. |
| 409 `already_shipped` | <order> was already shipped. | <order> a déjà été expédiée. |
| 409 `order_refunded` | <order> is fully refunded. Don't ship it. | <order> est entièrement remboursée. Ne l'expédiez pas. |
| Refund issued | Refund <rf> issued: <amount>. | Remboursement <rf> effectué : <amount>. |
| Refund failed (503) | Kill Bill is unreachable. Refund <rf> is recorded as failed; nothing was paid back. | Kill Bill est injoignable. Le remboursement <rf> est consigné comme échoué; rien n'a été remboursé. |
| Credit added | Credit <cr> added: <amount>. | Crédit <cr> ajouté : <amount>. |
| Credit failed (503) | Kill Bill is unreachable. Credit <cr> is recorded as failed; nothing was added. | Kill Bill est injoignable. Le crédit <cr> est consigné comme échoué; rien n'a été ajouté. |
| 412 `stale_version` | Someone else changed this record. Reload it and try again. | Quelqu'un d'autre a modifié ce dossier. Rechargez-le et réessayez. |
| Figure accepted | Kill Bill's figure of <amount> is now the shop record for <key>. | Le montant de Kill Bill, <amount>, est maintenant celui de la boutique pour <key>. |
| Orphan refunded | Orphan payment <key> refunded: <amount>. | Paiement orphelin <key> remboursé : <amount>. |
| Notice resent | <notice> queued again. | <notice> remis en file. |
| 409 `notice_not_failed` | <notice> isn't failed. It may already be queued again. | <notice> n'est pas en échec. Il est peut-être déjà remis en file. |
| Other 503 `billing_unavailable` | Kill Bill is unreachable. Nothing was changed. | Kill Bill est injoignable. Rien n'a été modifié. |
| 403 | Your role can't do that. | Votre rôle ne permet pas cette action. |

- Pending label for every studio control: "Saving…" / "Enregistrement…", except "Issue refund", which becomes "Refunding…" / "Remboursement…".
- Studio sign-in failure appears in an alert: "Email or password is incorrect." / "Courriel ou mot de passe incorrect."

**Contact status** (status "Contact status"):
- Success: "Thanks. Your reference is <ct>. We'll reply by email." / "Merci. Votre référence est <ct>. Nous vous répondrons par courriel." This is true whether the acknowledgement is sent at once or queued.
- Pending: "Sending…" / "Envoi…".

**Not found page line.** "That page or record doesn't exist, or it isn't yours." / "Cette page ou ce dossier n'existe pas, ou ne vous appartient pas."

**Field messages.** API `fields` values and on-screen field messages. A field that breaks the text rule in Business rules (a control character, or for `email` the address form) gets that field's own message below.

| Field | English | French |
|---|---|---|
| any key outside the route's published keys | This field can't be set. | Ce champ ne peut pas être défini. |
| email | Enter an email address like name@example.ca. | Entrez une adresse courriel comme nom@exemple.ca. |
| code | That code doesn't match or has expired. Request a new code. | Ce code ne correspond pas ou a expiré. Demandez un nouveau code. |
| name | Enter your full name. | Entrez votre nom complet. |
| line1 | Enter your street address. | Entrez votre adresse. |
| city | Enter your city. | Entrez votre ville. |
| postal_code | Enter a Canadian postal code like H2T 1S6. | Entrez un code postal canadien comme H2T 1S6. |
| province | Choose a province or territory. | Choisissez une province ou un territoire. |
| scent | Choose a scent. | Choisissez un parfum. |
| cadence (missing) | Choose how often your Trio arrives. | Choisissez la fréquence de votre Trio. |
| cadence (same as current) | That is already your cadence. | C'est déjà votre fréquence. |
| bars (refund) | Choose at least one bar from this order. | Choisissez au moins un pain de cette commande. |
| bars (cut) | Enter a bar count from 1 to 24. | Entrez un nombre de pains de 1 à 24. |
| restock | This batch was withdrawn; its bars can't go back on sale. | Ce lot a été retiré; ses pains ne peuvent pas revenir en vente. |
| amount_cents | Enter an amount from $1.00 to $25.00. | Entrez un montant de 1,00 $ à 25,00 $. |
| reason | Give a reason of 3 to 500 characters. | Indiquez un motif de 3 à 500 caractères. |
| topic | Choose a topic. | Choisissez un sujet. |
| message | Write a message of 10 to 2,000 characters. | Écrivez un message de 10 à 2 000 caractères. |
| poured_on | The pour date can't be in the future. | La date de coulée ne peut pas être dans le futur. |
| cure_days | Cure time is 28 to 60 days. | La cure dure de 28 à 60 jours. |
| drop_at_local (format) | Enter a date and time like 2026-11-07T10:00. | Entrez une date et une heure comme 2026-11-07T10:00. |
| drop_at_local (past) | Choose a time in the future. | Choisissez un moment dans le futur. |
| drop_at_local (before cure) | The drop can't be before the cure date, <date>. | La vente ne peut pas précéder la date de cure, le <date>. |
| drop_at_local (gap) | That time doesn't exist in Toronto: clocks spring forward. | Cette heure n'existe pas à Toronto : on avance l'heure. |
| open (not cured) | This batch is still curing until <date>. | Ce lot est en cure jusqu'au <date>. |
| packing_cutoff_local | Enter a time like 14:00. | Entrez une heure comme 14:00. |
| month | Enter a month like 2026-10. | Entrez un mois comme 2026-10. |
| holds | Choose at least one held bar. | Choisissez au moins un pain réservé. |
| batch | Choose a batch. | Choisissez un lot. |
| purpose | Use checkout or sign_in. | Utilisez checkout ou sign_in. |
| q | Enter an order number, subscription number or email. | Entrez un numéro de commande, un numéro d'abonnement ou un courriel. |
| status | Choose queued, retrying, sent or failed. | Choisissez queued, retrying, sent ou failed. |

The "open (not cured)" message is returned under the field key `drop_at_local`. Nested shipping fields are reported under their dotted path (for example `shipping.name` carries the `name` message).

## Backend

### API (DP-01, DP-03, DP-16, DP-17, DP-18, DP-20, DP-21, DP-22, DP-23, DP-24, DP-26, DP-27, DP-29, DP-30, DP-32, DP-33, DP-35, DP-36, DP-37, DP-38, DP-39, DP-40, DP-41, DP-42, DP-43, DP-44, DP-45, DP-48)

**General rules**
- All endpoints live under `/api` on the app's own origin.
- Request and response bodies are `application/json; charset=utf-8`, except 204 responses, which have no body.
- Object keys appear in the order shown.
- Timestamps are UTC with millisecond precision, like `2026-10-27T15:04:05.123Z`.
- Dates are `YYYY-MM-DD` in Toronto.
- **Money** is always `{"cents": <integer>, "currency": "CAD"}`. Negative cents appear only in reconciliation differences and audit amounts of accepted figures.
- Text in `message` and `fields` follows the request's active locale: the `pdl_locale` cookie, else `fr-CA` when the `Accept-Language` header starts with `fr`, else `en-CA`. The texts are the copy in Feedback states. Codes are always the English identifiers shown.

**Allowed keys.** The Request column of each endpoint table is the complete list of keys its body may carry; a body shown as `{}` (or none) may carry no keys. Nested objects are closed the same way: `shipping` carries exactly `name`, `line1`, `city`, `province`, `postal_code`; each refund `bars` item carries exactly `batch` and `bar`. Any other key, at any depth, is a validation error under its dotted path (array items by zero-based index, for example `total`, `shipping.country`, `bars.0.price`) with the "can't be set" message, and nothing is changed: no Kill Bill call, no number taken, no hold or record touched. For example, a subscription PATCH with `{"state":"cancelled"}` or `{"next_bill_date":"2026-12-01"}` answers 422 and the subscription reads back byte-identical.

**Error body.** Every error has one shape:
```
{"error": {"code": "<code>", "message": "<text>"}}
```
For validation errors (status 422, code `invalid`) a third key is added:
```
{"error": {"code": "invalid", "message": "Check these fields.", "fields": {"<field>": "<text>"}}}
```
In French the message is "Vérifiez ces champs." Every failing field is reported, and the keys of `fields` appear in byte order of their path.

**Error precedence** (one rule for the whole API). The first failing check decides the response:
1. Boundary: 415 `unsupported_media_type`, 413 `payload_too_large`, 403 `cross_origin` (Server boundary).
2. 401 `unauthenticated`: no valid session of the kind the route needs.
3. 404 `not_found`: an unknown resource, or a resource that belongs to another customer.
4. 403 `forbidden`: a staff role outside the role table.
5. Idempotency: 400 `idempotency_key_required` or `idempotency_key_invalid`. An exact replay returns the stored response at this point, before any later check. 409 `idempotency_key_reused`, 409 `request_in_progress`.
6. Preconditions: 428 `precondition_required`, 412 `stale_version`.
7. State conflicts: 409 and 410 codes, and 429 `stepup_locked`.
8. Validation: 422 `invalid`, including keys that may not be set.
9. Rate: 429 `rate_limited`.
10. Dependency: 503 `billing_unavailable`.

Unknown `/api` paths answer 404 `not_found`. A known path with a wrong method answers 405 `method_not_allowed`, except the audit routes, which answer 405 `audit_immutable`. Rows below list only their own extra errors.

**Cookies.** All are HttpOnly, SameSite=Lax, Path=/, except `pdl_locale`, which the page script may read and write.
- `pdl_locale`: `fr-CA` or `en-CA`.
- `pdl_cart`: an opaque cart id, created on the first hold.
- `pdl_session`: a customer session, valid 12 hours.
- `pdl_staff`: a staff session, valid 12 hours.

**Idempotency.** `POST /api/checkout`, `POST /api/subscriptions`, `POST /api/staff/orders/{number}/refunds` and `POST /api/staff/credits` require the header `Idempotency-Key`: 8 to 64 characters drawn from letters, digits, `-` and `_`.
- A key is scoped to the session's customer or staff member and to the route.
- It is kept for 24 hours.
- The same key with a body that parses to the same JSON value (key order ignored) returns the stored status and body exactly, with the header `Idempotent-Replayed: true`.
- The same key with a different body answers 409 `idempotency_key_reused`.
- While the first request with a key is still running, a second request with that key answers 409 `request_in_progress`.
- Responses with status 2xx, 409 (except `request_in_progress`), 410, 412 and 422 are stored. 5xx responses are not stored, so a retry after an outage runs fresh.

**Shapes**

Batch (public):
```
{"code":"B-0412","scent":"lavender-oat","state":"live","bars_cut":12,"available":12,"held":0,"sold":0,
 "bars":[{"number":1,"status":"available"}, ...],
 "unit_price":{"cents":1100,"currency":"CAD"},"cure_date":"YYYY-MM-DD",
 "drop_at":"<UTC>","drop_at_local":"YYYY-MM-DDTHH:MM"}
```
- `bars` lists every bar from 1 to `bars_cut`, with status `available`, `held` or `sold`.
- `drop_at` and `drop_at_local` are null before scheduling.

Staff batch: the batch fields, then `"poured_on"`, `"cure_days"`, and `"holds":[{"bar":3,"expires_at":"<UTC>"}]`.

Hold:
```
{"id":"<uuid>","batch":"B-0412","bar":3,"status":"active","created_at":"<UTC>","expires_at":"<UTC>",
 "amount":{"cents":1100,"currency":"CAD"}}
```

Tax line:
```
{"code":"GST","rate":"5%","amount":<money>}
```
The codes are `GST`, `QST` and `HST`; the rate strings are `5%`, `9.975%`, `13%`, `14%` and `15%`.

Order:
```
{"number":"PDL-000001","status":"paid","fulfilment":"to_pack","placed_at":"<UTC>","ship_on":"YYYY-MM-DD",
 "locale":"en-CA","email":"...","shipping":{"name":"...","line1":"...","city":"...","province":"QC","postal_code":"H2T 1S6"},
 "lines":[{"batch":"B-0412","scent":"lavender-oat","bar":3,"unit_price":<money>,"refunded":false}],
 "subtotal":<money>,"shipping_fee":<money>,"taxes":[<tax line>...],"total":<money>,"refunded":<money>,"version":1}
```
- `status` is `paid`, `partially_refunded` or `refunded`.
- `fulfilment` is `to_pack` or `shipped`.
- `lines` are ordered by batch code, then bar number.

Subscription:
```
{"number":"SUB-000001","state":"active","scent":"oat-milk","cadence":"MONTHLY","pending_cadence":null,
 "started_on":"YYYY-MM-DD","next_bill_date":"YYYY-MM-DD","skipped_bill_date":null,"paused_from":null,
 "locks_at":"<UTC>","locked":false,"shipping":{...},
 "price":{"subtotal":<money>,"discount":<money>,"pre_tax":<money>,"taxes":[...],"total":<money>},"version":1}
```
- `state` is `active`, `paused` or `cancelled`.
- `next_bill_date` and `locks_at` are null while paused or cancelled.

Refund:
```
{"number":"RF-000001","order":"PDL-000001","status":"issued","bars":[{"batch":"B-0412","bar":3}],"restock":true,
 "amount":<money>,"allocation":{"bars":<money>,"shipping":<money>,"taxes":[<tax line>...]},
 "reason":"...","killbill_ref":"<Kill Bill transaction id or null>","created_at":"<UTC>"}
```
- `allocation.taxes` has one tax line per tax line of the order, in the order's order. A failed refund's allocation has every amount zero.

Credit:
```
{"number":"CR-000001","target":"PDL-000001","status":"issued","amount":<money>,"reason":"...",
 "killbill_ref":"<id or null>","created_at":"<UTC>"}
```

Audit entry:
```
{"id":1,"at":"<UTC>","actor":"<staff email>","role":"finance","action":"refund","target":"PDL-000001",
 "reason":"...","amount":<money>,"killbill_ref":"<id or null>","outcome":"issued"}
```
- `action` is `refund`, `credit`, `reconciliation_accept` or `orphan_refund`.
- `outcome` is `issued` or `failed`.

Notice:
```
{"number":"NT-000001","key":"order.PDL-000001","kind":"order_confirmation","to":"...","locale":"en-CA",
 "subject":"...","status":"sent","enqueued_at":"<UTC>","attempts":[{"at":"<UTC>","outcome":"sent"}]}
```
- `kind` is `stepup_code`, `order_confirmation`, `subscription_started`, `refund`, `credit` or `contact_reply`.
- `status` is `queued`, `retrying`, `sent` or `failed`.
- Attempt `outcome` is `sent` or `failed`.
- For `stepup_code` notices, the code in `subject` is replaced by `••••••`.

Reconciliation line:
```
{"key":"order:PDL-000001","kind":"order","shop":<money or null>,"killbill":<money or null>,"status":"match"}
```
`kind` is `order`, `subscription`, `credit` or `payment`.

Packing order:
```
{"number":"PDL-000001","ship_on":"YYYY-MM-DD","name":"...","address":{"line1":"...","city":"...","province":"QC","postal_code":"..."},
 "bars":[{"batch":"B-0412","scent":"lavender-oat","bar":3}],"fulfilment":"to_pack","version":1}
```

**Public and customer endpoints**

| Method and path | Request | Success | Extra errors |
|---|---|---|---|
| GET /api/health | none | 200 `{"status":"ok"}` | none |
| GET /api/status | none | 200 `{"billing":"up"\|"down","mail":"up"\|"down","checked_at":"<UTC>"}` | none |
| GET /api/drop | none | 200 `{"server_now":"<UTC>","batches":[Batch...]}`: batches in state scheduled, live or sold_out, ordered by drop_at then code | none |
| GET /api/batches/{code} | none | 200 Batch | 404 for poured, curing, withdrawn or unknown batches |
| POST /api/holds | `{"batch":"B-0412"}` | 201 `{"hold":Hold,"cart":Cart}`; sets `pdl_cart` if absent | 404 unknown or non-public batch; 409 `not_live`, `hold_limit`, `sold_out`, `all_held`; 422 `batch` missing |
| DELETE /api/holds/{id} | none | 200 `{"hold":Hold}` with `status` `released` and the bar's `amount` | 404 not this cart's hold; 409 `hold_not_active` |
| GET /api/cart?province=QC | `province` optional, default `QC` | 200 Cart | 422 `province` not in the table |
| POST /api/auth/code | `{"email":"...","purpose":"checkout"\|"sign_in"}` | 202 `{"status":"sent"}` | 422 `email`, `purpose`; 429 `rate_limited` with header `Retry-After` |
| POST /api/auth/verify | `{"email":"...","code":"123456"}` | 200 `{"customer":{"email":"...","locale":"en-CA"}}`; sets `pdl_session` | 422 `code`; 429 `stepup_locked` |
| POST /api/auth/sign-out | none | 204, clears `pdl_session` | none |
| POST /api/checkout | header `Idempotency-Key`; `{"holds":["<id>",...],"shipping":{"name","line1","city","province","postal_code"}}` | 201 `{"order":Order}` | 404 a hold not in this cart; 409 `hold_not_active`; 410 `hold_expired`; 422 `holds` empty, shipping fields, extra keys; 503 |
| GET /api/account | session | 200 `{"customer":{...},"orders":[{"number","placed_at","total","status"}],"subscriptions":[{"number","state","scent","cadence","next_bill_date"}]}` | none |
| GET /api/account/orders/{number} | session | 200 Order | 404 |
| POST /api/subscriptions | header `Idempotency-Key`; `{"scent":"oat-milk","cadence":"MONTHLY","shipping":{...}}` | 201 `{"subscription":Subscription,"charged_today":<money>,"credit_applied":<money>}` | 409 `subscription_exists`; 422 `scent`, `cadence`, shipping fields, extra keys; 503 |
| GET /api/account/subscriptions/{number} | session | 200 Subscription | 404 |
| POST /api/account/subscriptions/{number}/skip, /unskip, /pause, /resume, /cancel | `{}` | 200 `{"subscription":Subscription}` | 404; 409 `cycle_locked`, `invalid_transition`, `already_skipped`, `not_skipped`; 503 |
| PATCH /api/account/subscriptions/{number} | `{"scent":"cedar-sage"}` and/or `{"cadence":"QUARTERLY"}` | 200 `{"subscription":Subscription}` | 404; 409 `cycle_locked`, `invalid_transition`; 422 `scent`, `cadence`, extra keys; 503 |
| POST /api/contact | `{"name","email","topic","message"}` | 201 `{"reference":"CT-000001"}` | 422 fields |

Cart is:
```
{"server_now":"<UTC>","holds":[Hold...],"batches":[{"code","available","held","sold"}],"province":"QC",
 "subtotal":<money>,"shipping_fee":<money>,"taxes":[...],"total":<money>}
```
- `holds` lists only active holds.
- `batches` lists each batch with an active hold in the cart.
- With no active holds, every amount is zero and `taxes` is empty.

The 401 rule applies to `/api/account*`, `/api/subscriptions` and `/api/checkout`. A subscription page for someone else's number, and one for an unknown number, both answer 404 `not_found` with the same body. The not-found page is likewise the same for both.

**Staff endpoints** (all need `pdl_staff`):

| Method and path | Request | Success | Extra errors |
|---|---|---|---|
| POST /api/staff/sign-in | `{"email","password"}` | 200 `{"staff":{"email","name","role"}}`; sets `pdl_staff` | 401 `invalid_credentials` (same for unknown email and wrong password) |
| POST /api/staff/sign-out | none | 204 | none |
| GET /api/staff/me | none | 200 `{"staff":{...}}` | none |
| GET /api/staff/batches | none | 200 `{"server_now","batches":[Staff batch...]}` ordered by code | none |
| POST /api/staff/batches | `{"scent":"wild-mint","poured_on":"YYYY-MM-DD","cure_days":28}` | 201 `{"batch":Staff batch}` state `poured` | 422 `scent`, `poured_on`, `cure_days` |
| POST /api/staff/batches/{code}/cut | `{"bars":12}` | 200 `{"batch":...}` state `curing` | 404; 409 `invalid_transition`; 422 `bars` |
| POST /api/staff/batches/{code}/schedule | `{"drop_at_local":"YYYY-MM-DDTHH:MM"}` | 200 `{"batch":...}` state `scheduled` | 404; 409 `invalid_transition`; 422 `drop_at_local` |
| POST /api/staff/batches/{code}/open | `{}` | 200 `{"batch":...}` state `live`, `drop_at` = now | 404; 409 `invalid_transition`; 422 `drop_at_local` (not cured) |
| POST /api/staff/batches/{code}/withdraw | `{}` | 200 `{"batch":...}` state `withdrawn` | 404; 409 `invalid_transition` |
| GET /api/staff/batches/{code}/movements | none | 200 `{"movements":[{"at","kind":"cut"\|"sale"\|"restock","bars":[3],"ref":"PDL-000001"\|"RF-000001"\|null}]}` oldest first | 404 |
| GET /api/staff/settings | none | 200 `{"packing_cutoff_local":"14:00","time_zone":"America/Toronto"}` | none |
| PUT /api/staff/settings | `{"packing_cutoff_local":"HH:MM"}` | 200 same shape | 422 |
| GET /api/staff/packing | none | 200 `{"date":"YYYY-MM-DD","cutoff_local":"14:00","orders":[Packing order...]}` | none |
| POST /api/staff/orders/{number}/ship | `{}` | 200 `{"order":Packing order}` | 404; 409 `already_shipped`, `order_refunded` |
| GET /api/staff/search?q= | `q`: order number, subscription number or email | 200 `{"orders":[...],"subscriptions":[...]}` (summaries as in GET /api/account) | 422 `q` empty |
| GET /api/staff/orders/{number} | none | 200 Order plus `"refunds":[Refund...]` and `"credits":[Credit...]`; header `ETag: "<version>"` | 404 |
| GET /api/staff/subscriptions/{number} | none | 200 Subscription plus `"email"` and `"credits"`, holding only the credits issued against this subscription and not the customer's other credits; `ETag` | 404 |
| POST /api/staff/orders/{number}/refunds | headers `Idempotency-Key`, `If-Match: "<version>"`; `{"bars":[{"batch","bar"}],"restock":true,"reason":"..."}` | 201 `{"refund":Refund,"order":Order}` | 404; 409 `already_refunded`; 422 `bars`, `restock`, `reason`, extra keys; 503 (refund recorded `failed`) |
| POST /api/staff/credits | headers `Idempotency-Key`, `If-Match: "<version of target>"`; `{"target":"PDL-000001"\|"SUB-000001","amount_cents":2500,"reason":"..."}` | 201 `{"credit":Credit}` | 404 target; 422 `amount_cents`, `reason`, extra keys; 503 (credit recorded `failed`) |
| GET /api/staff/audit | none | 200 `{"entries":[Audit entry...]}` newest first | none |
| PUT, PATCH, DELETE /api/staff/audit/{id}; POST, PUT, PATCH, DELETE /api/staff/audit | any | never succeeds | 405 `audit_immutable` for every role |
| GET /api/staff/reconciliation?month=YYYY-MM | `month` optional, default the current Toronto month | 200 `{"month","stale":false,"checked_at":"<UTC>"\|null,"lines":[Line...],"totals":{"shop":<money>,"killbill":<money>}}` | 422 `month` |
| POST /api/staff/reconciliation/accept | `{"month","key"}` | 200 `{"line":Line,"audit":Audit entry}` | 404 unknown key; 409 `line_not_mismatched`; 503 |
| POST /api/staff/reconciliation/refund-orphan | `{"month","key"}` | 200 `{"line":Line,"refund":{"amount":<money>,"killbill_ref":"..."},"audit":Audit entry}` | 404; 409 `line_not_orphan`; 503 |
| GET /api/staff/notices?status= | `status` optional filter | 200 `{"notices":[Notice...]}` newest first | 422 `status` |
| POST /api/staff/notices/{number}/resend | `{}` | 200 `{"notice":Notice}` status `queued` | 404; 409 `notice_not_failed` |

- On refunds and credits, a missing `If-Match` answers 428 `precondition_required`. A version other than the record's current one answers 412 `stale_version`.
- In `POST /api/staff/credits`, an `amount_cents` that is not an integer from 100 to 2,500 inclusive answers 422 with the `amount_cents` message.
- The `Retry-After` header on 429 `rate_limited` is a whole number of seconds, computed as in Business rules.

**Role table** (enforced by the server, whatever the interface shows; everything else answers 403 `forbidden`):

| Routes | maker | finance | packing |
|---|---|---|---|
| sign-in, sign-out, me | yes | yes | yes |
| batches (all), movements, settings (GET and PUT) | yes | no | no |
| packing, ship | yes | no | yes |
| search, orders, subscriptions, refunds, credits | yes | yes | no |
| reconciliation (all), audit (GET), notices (all) | yes | yes | no |

### Business rules (DP-10, DP-15, DP-16, DP-17, DP-18, DP-20, DP-23, DP-24, DP-25, DP-27, DP-28, DP-29, DP-30, DP-33, DP-34, DP-36, DP-38, DP-39, DP-40, DP-41, DP-42, DP-43, DP-44, DP-45, DP-46, DP-48)

**Identifiers.** All are sequential from 000001 and are never reused. An order number and a subscription number are both taken before Kill Bill is called; a checkout or subscription start that then fails or does not commit leaves its number unused, so those numbers rise but may skip (gaps are allowed), and the next one always takes a new number. That way a payment left behind by a lost response keeps a key no later record can collide with, and reconciliation still reports it as an orphan. A request refused before Kill Bill would be called (by any check in the error precedence) takes no number. The other numbers are taken only when their record is committed, so they have no gaps:
- order `PDL-` plus six digits
- subscription `SUB-` plus six digits
- refund `RF-` plus six digits
- credit `CR-` plus six digits
- contact `CT-` plus six digits
- notice `NT-` plus six digits
- step-up code issue `SC-` plus six digits

Batch codes are `B-` plus four digits, with new batches continuing after the seed batches.

**Enumerations** (values used exactly as published):
- Locales: `fr-CA`, `en-CA`.
- Cadences: `MONTHLY` (every month), `BIMESTRIAL` (every two months), `QUARTERLY` (every three months).
- Contact topics: `order` "Order question" / "Question sur une commande"; `subscription` "Subscription" / "Abonnement"; `wholesale` "Wholesale" / "Vente en gros"; `other` "Something else" / "Autre chose".
- Batch states: `poured`, `curing`, `scheduled`, `live`, `sold_out`, `withdrawn`. Labels: Poured / Coulé, Curing / En cure, Scheduled / Programmé, Live / En vente, Sold out / Épuisé, Withdrawn / Retiré.
- Province codes, with English / French names and the taxes charged on shipments there:

| Code | English | French | Taxes |
|---|---|---|---|
| AB | Alberta | Alberta | GST 5% |
| BC | British Columbia | Colombie-Britannique | GST 5% |
| MB | Manitoba | Manitoba | GST 5% |
| NB | New Brunswick | Nouveau-Brunswick | HST 15% |
| NL | Newfoundland and Labrador | Terre-Neuve-et-Labrador | HST 15% |
| NS | Nova Scotia | Nouvelle-Écosse | HST 14% |
| NT | Northwest Territories | Territoires du Nord-Ouest | GST 5% |
| NU | Nunavut | Nunavut | GST 5% |
| ON | Ontario | Ontario | HST 13% |
| PE | Prince Edward Island | Île-du-Prince-Édouard | HST 15% |
| QC | Québec | Québec | GST 5% and QST 9.975% |
| SK | Saskatchewan | Saskatchewan | GST 5% |
| YT | Yukon | Yukon | GST 5% |

Pain de Lune is not registered for provincial sales tax in British Columbia, Manitoba or Saskatchewan, so only GST applies there. Tax labels on screen and in email: GST / TPS, QST / TVQ, HST / TVH. Tax lines always appear in the order GST, QST, HST.

**Text fields.**
- Every single-line text field (names, shipping fields, email, code, reasons, search) is rejected with its own field message if it contains any control character (U+0000 to U+001F or U+007F), including carriage return and line feed. The contact `message` is multi-line: it may contain line feed and carriage return, and no other control character.
- An `email` is 3 to 254 characters, holds exactly one `@` with a non-empty part before it and a domain containing a dot after it, and contains no space, comma, semicolon, angle bracket, quote or control character. It is a bare address: a display name such as `Ana <a@b.ca>` is rejected. Emails are compared and stored in lower case.

**Prices**
- Every drop bar costs $11.00.
- A drop order's shipping is $9.00, whatever the number of bars.
- The Trio's list price is three bars at $11.00, so $33.00. Subscribe-and-save takes 12 percent off. Shipping is free.

**Money rules.** Money is held in whole cents. A percentage is applied in hundred-thousandths:
- 12% = 12,000
- 5% = 5,000
- 9.975% = 9,975
- 13% = 13,000
- 14% = 14,000
- 15% = 15,000

Applying rate r to base b gives floor((b × r + 50,000) ÷ 100,000) cents. This rounds half up, and it is the only rounding in the shop. It is applied in this order:
1. subtotal = the sum of the bar prices (for a Trio, the list price);
2. discount = the rate applied to the subtotal (subscriptions only, 12%);
3. pre-tax = subtotal − discount + shipping;
4. each tax line = its rate applied to the pre-tax amount, separately (QST is never charged on GST);
5. total = pre-tax + every tax line.

Worked examples:
- Drop, 1 bar, QC: subtotal $11.00, shipping $9.00, pre-tax $20.00, GST $1.00, QST $2.00 (1.995 rounds up), total **$23.00**.
- Drop, 2 bars, QC: $22.00 + $9.00 = $31.00, GST $1.55, QST $3.09 (3.09225), total **$35.64**.
- Drop, 1 bar, ON: $20.00, HST $2.60, total **$22.60**.
- Drop, 3 bars, ON: $33.00 + $9.00 = $42.00, HST $5.46, total **$47.46**.
- Trio, QC: subtotal $33.00, discount $3.96, pre-tax $29.04, GST $1.45 (1.452), QST $2.90 (2.896776), total **$33.39**.
- Trio, NS: pre-tax $29.04, HST $4.07 (4.0656), total **$33.11**.

Money is displayed as follows:
- en-CA: `$1,234.56`, with a hyphen-minus before the `$` for negatives (`-$3.96`).
- fr-CA: `1 234,56 $`, with no-break spaces and a hyphen-minus before the number for negatives (`-3,96 $`).
- Rates are displayed as `9.975%` and `9,975 %`.

**Refund allocation.** Every refund is split into an allocation, and its amount is the allocation's sum.
- A refund is *final* when it covers the order's last unrefunded bars (including a single refund of every bar).
- A refund that is not final: `bars` = the sum of the refunded bars' prices; `shipping` = $0.00; each tax = that tax's rate applied to `bars`.
- A final refund: `bars` = the sum of the refunded bars' prices; `shipping` = the order's shipping fee; each tax = the order's tax line minus the same tax in every earlier issued refund of the order (never recomputed from the rate).
- `amount` = `bars` + `shipping` + every tax. Over an order's life the issued refunds therefore sum exactly to the order total, per bar, per tax and for shipping.
- Example, the two-bar QC order ($35.64): the first one-bar refund is bars $11.00, shipping $0.00, GST $0.55, QST $1.10 (1.09725), amount **$12.65**. The final refund is bars $11.00, shipping $9.00, GST $1.55 − $0.55 = $1.00, QST $3.09 − $1.10 = $1.99, amount **$22.99**.
- Example, the three-bar ON order ($47.46): refunding bar 1, then bar 2, gives two refunds of bars $11.00, HST $1.43, amount **$12.43** each. The final refund of bar 3 is bars $11.00, shipping $9.00, HST $5.46 − $2.86 = $2.60, amount **$22.60**.
- A failed refund allocates nothing and does not count as an earlier refund.

**Stock.** Every change to a batch's stock is one movement in the stock ledger:
- `cut` adds the bars cut.
- `sale` removes the bars a paid order converted.
- `restock` returns refunded bars.

Derived counts, computed once from the ledger and active holds and shown the same way on every surface:
- **cut** = bars cut
- **sold** = sale bars − restocked bars
- **held** = holds whose status is active at the moment of the request
- **available** = cut − sold − held

A bar's status is `sold` if its latest movement is a sale, `held` if it has an active hold, and `available` otherwise. Holds always take the lowest-numbered available bar. A restocked bar becomes available again with its own number.

**Holds**
- **State machine.** `active` → `converted` (paid checkout), `expired` (time), or `released` (shopper release, or the batch is withdrawn). No other transitions exist.
- **Lifetime.** A hold lasts `HOLD_TTL_SECONDS` seconds. `expires_at` = `created_at` + that many seconds. A hold is active while the server's time is strictly before `expires_at`, and expired at and after it.
- **Limits.** Holds are allowed only while the batch is live, with at most 2 active holds per cart per batch (409 `hold_limit`). A hold on a batch that is poured, curing, withdrawn or unknown answers 404 `not_found`, because those batches are not public. A hold on a scheduled batch answers 409 `not_live`. A hold on a sold_out batch answers 409 `sold_out`.
- **No bar free.** If the batch has no available bar, the answer is 409 `sold_out` when it has no active holds, or 409 `all_held` when it has some.
- **Race.** When several holds are requested at once for a batch with one available bar, exactly one gets 201. Each of the others gets the 409 that is true at the moment it is decided. No hold race ever reaches Kill Bill.
- **Ending.** Releasing or expiring a hold makes the bar available immediately on every surface.

**Checkout**
- The server judges every hold named in the body at the moment the request arrives:
  - if any is past its edge, the answer is 410 `hold_expired`, and the active ones stay active;
  - if any is already converted or released, the answer is 409 `hold_not_active`.
- On success, in one all-or-nothing unit:
  - the order is recorded;
  - the Kill Bill invoice and payment from Services exist;
  - each hold becomes `converted`;
  - one `sale` movement is written per batch;
  - one order-confirmation notice is queued.
- If Kill Bill is unreachable or rejects the charge, none of these exist afterwards, the holds are exactly as before, and the answer is 503 `billing_unavailable`. A request refused by validation (including extra keys) likewise leaves the holds active and makes no Kill Bill call.
- If a payment exists in Kill Bill but the shop's record of it was never committed, reconciliation shows it as a Kill Bill-only line, and staff refund it there.
- A checkout never sends a confirmation for a failed or losing attempt.
- **Ship date.** An order's `ship_on` is set when it is paid. An order row exists only once its payment has succeeded, so that paid instant is the order's own `placed_at`. Let t be `placed_at` in Toronto. If t falls on Monday to Friday and its time of day is strictly before the packing cutoff, `ship_on` is that date. Otherwise it is the next Monday-to-Friday date after it. There are no holiday rules.

**Order state.** `paid` → `partially_refunded` → `refunded`, or `paid` → `refunded` when one refund covers every bar. Fulfilment is `to_pack` → `shipped` only. The order's `version` starts at 1 and goes up by one on each refund (issued or failed), credit targeting it, and shipment.

**Shipping races.**
- Shipping a shipped order answers 409 `already_shipped`. Shipping a fully refunded order answers 409 `order_refunded`.
- Of N simultaneous ship requests for one to-pack order, exactly one answers 200; every other answers 409 `already_shipped`, and `version` rises by exactly 1.
- A ship and a refund of every remaining bar, sent with the version the staff member saw, never both succeed:
  - if the ship commits first, the refund answers 412 `stale_version` and Kill Bill receives no refund;
  - if the refund commits first, the ship answers 409 `order_refunded`.
- A ship request that arrives while a refund of that order is waiting on Kill Bill waits for the refund to finish and then answers by its outcome. No order is ever newly shipped and fully refunded from the same version.

**Packing list.** `GET /api/staff/packing` and the Pack today page list every order whose fulfilment is `to_pack`, whose status is not `refunded`, and whose `ship_on` is on or before today's Toronto date, so overdue unshipped orders stay listed. Orders are sorted by `ship_on`, then by order number. Each order's `bars` are its unrefunded bars in order-line order. `date` is today's Toronto date. Shipped and fully refunded orders never appear.

**Step-up codes**
- **Requesting.** `POST /api/auth/code` answers 202 with the same body whether or not the email has orders or subscriptions, and also while the email is locked out, within 2 seconds even with mail or billing down. Known and unknown emails take the same work: over ten requests each, their median response times differ by no more than 150 milliseconds. Each 202 issues a new six-digit code with its own SC number. Earlier codes for that email keep working until they expire or one is used. One step-up code notice is queued unless the email is locked out.
- **Rate limit.** Requests answered 202 are counted per lower-cased email. A counted request stays in the rolling window while the server's time is strictly before its time + `STEPUP_RATE_WINDOW_SECONDS`.
  - When the window already holds `STEPUP_RATE_LIMIT` counted requests, the next request answers 429 `rate_limited` with the copy from Feedback states and the header `Retry-After: <s>`, where `<s>` = ceil(seconds until the oldest counted request leaves the window), at least 1.
  - A rate-limited request is not counted, issues no code, takes no SC number and queues no notice, so SC numbers keep running without a gap.
  - The 429 status, body and headers are identical for known, unknown and locked-out emails.
  - For example, with the defaults (3 per 600 seconds), the fourth request inside ten minutes answers 429, and a request after the oldest leaves the window answers 202 again.
- **Lifetime.** A code works once, while the server's time is strictly before issue time + `STEPUP_CODE_TTL_SECONDS`. Using any code of an email ends all of that email's codes.
- **Verifying.** `POST /api/auth/verify` answers within 2 seconds. A wrong, expired or used code answers 422 with the `code` message, the same for known and unknown emails.
- **Lock-out.** Incorrect attempts are counted per email since its last successful verification:
  - the first four incorrect attempts answer 422;
  - the fifth answers 429 `stepup_locked` and starts a lock-out of `STEPUP_LOCK_SECONDS`;
  - during the lock-out every verify for that email answers 429 `stepup_locked`, even with the right code;
  - when the lock-out ends, the count resets.
- **Session.** A successful verify creates the customer on first use, records the active locale as the customer's locale, and starts a session that counts as verified for checkout.

**Batches**
- **State machine.**
  - `poured` → `curing` by cut (1 to 24 bars inclusive).
  - `curing` or `scheduled` → `scheduled` by schedule.
  - `curing` or `scheduled` → `live` by open now.
  - `scheduled` → `live` when the server's time reaches `drop_at` (inclusive).
  - `live` → `sold_out` when sold equals cut.
  - `sold_out` → `live` when a restocking refund returns a bar.
  - `poured`, `curing`, `scheduled` or `live` → `withdrawn` by withdraw, which releases its active holds.
  - Every other action answers 409 `invalid_transition` with message "A batch in state <state> can't <action>." / "Un lot à l'état <state> ne peut pas <action>.", where `<state>` is the batch state's label in the active language written entirely in lower case, and `<action>` is cut / être coupé, schedule / être programmé, open / ouvrir, or withdraw / être retiré. For example, opening a withdrawn batch reads "A batch in state withdrawn can't open." / "Un lot à l'état retiré ne peut pas ouvrir.", and cutting a sold-out batch reads "A batch in state sold out can't cut." / "Un lot à l'état épuisé ne peut pas être coupé."
- **Cure date.** `cure_date` = `poured_on` + `cure_days`. `cure_days` is an integer from 28 to 60 inclusive. `poured_on` may be any past date or today in Toronto, but not a future one.
- **Scheduling.** `drop_at_local` is a Toronto wall-clock time. It must be later than now (422, past), and its Toronto date must be on or after `cure_date` (422, before cure).
- **Open now.** Allowed only when today's Toronto date is on or after `cure_date`. Otherwise 422 with the not-cured message.

**Toronto time.** The business time zone is America/Toronto, with daylight saving respected.
- A local time inside the spring-forward gap is rejected with the gap message.
- A local time that occurs twice in the fall-back hour means its first occurrence (daylight time).
- For example: `2026-11-01T10:00` is stored as `2026-11-01T15:00:00.000Z`. `2026-10-31T10:00` is stored as `2026-10-31T14:00:00.000Z`. `2026-11-01T01:30` is stored as `2026-11-01T05:30:00.000Z`. `2027-03-14T02:30` is rejected.
- **Drop-time format** on screen, in the shopper's or staff member's locale, whatever the browser's time zone:
  - en-CA: `<Weekday>, <Month> <D>, <YYYY> at <H>:<MM> (Toronto time)`, for example "Sunday, November 1, 2026 at 10:00 (Toronto time)".
  - fr-CA: `<jour> <D> <mois> <YYYY> à <H> h <MM> (heure de Toronto)`, with day 1 written `1er` and lower-case weekday and month, for example "dimanche 1er novembre 2026 à 10 h 00 (heure de Toronto)".
  - The hour has no leading zero and runs 0 to 23.
- **Long date format:** "November 30, 2026" / "30 novembre 2026" (and "1er" for day 1).
- Emails write dates as `YYYY-MM-DD`.
- The packing cutoff is a Toronto `HH:MM`, default 14:00.
- A Toronto month runs from 00:00 Toronto time on its 1st to 00:00 Toronto time on the next month's 1st, so its UTC edges move with daylight saving.

**Subscriptions**
- **One Trio per customer.** A customer holds at most one Trio that is active or paused. A start for a customer who already has one answers 409 `subscription_exists` with no Kill Bill call and no number taken. Starts for one customer are decided one at a time, so of simultaneous starts with different idempotency keys exactly one answers 201 and every other answers 409 `subscription_exists`, leaving one subscription, one Kill Bill subscription and one subscription-started notice. After a cancel, a new start succeeds.
- **Starting.** Starting requires a verified session, one core scent, an explicit cadence and a shipping address.
  - There is no default cadence. A missing or unknown cadence is rejected with 422 and the `cadence` missing message.
  - The price is the Trio formula for the shipping province.
  - `started_on` is today in Toronto.
  - `next_bill_date` is `started_on` plus one cadence period (1, 2 or 3 months), on the same day of the month, or on the month's last day when that month is shorter. Example: started 2026-01-31 monthly, the next bill date is 2026-02-28.
  - Bill dates form a series stepping by the current cadence from an anchor date, each taken on the anchor's day of the month, or on the month's last day when that month is shorter, so a short month never shifts the series. The anchor is `started_on`, and it is reset to the effective bill date of a cadence change, or to the charge date of a resume on or after the missed bill date. Example: started 2026-01-31 monthly bills on 2026-02-28, then 2026-03-31, then 2026-04-30, because the anchor day stays 31. Skipping a bill date moves billing to the next date in the series, so skipping 2026-02-28 makes the next bill date 2026-03-31.
- **Credit applied.** `credit_applied` = min(the customer's Kill Bill account credit, total). `charged_today` = total − `credit_applied`.
  - Example: a customer with two goodwill credits of $25.00 and $20.00 starts a QC Trio. Total $33.39, credit applied $33.39, charged today **$0.00**, credit left $11.61.
- **State machine.**
  - `active` → `paused` by pause, and `paused` → `active` by resume.
  - `active` → `cancelled` by cancel.
  - `cancelled` is final.
  - Pause on paused, pause while a skip is set, resume on active, cancel on paused, and any action on cancelled answer 409 `invalid_transition`.
- **Skip next.** Allowed once per cycle while active:
  - it sets `skipped_bill_date` to the current next bill date and moves `next_bill_date` to the next date in the bill-date series;
  - unskip reverses it;
  - skipping when a skip is already set answers 409 `already_skipped`; unskipping without one answers 409 `not_skipped`;
  - skip or unskip on a paused or cancelled subscription answers 409 `invalid_transition`.
  - Example: monthly, next bill date 2026-11-27. Skip makes it 2026-12-27 with skipped date 2026-11-27.
- **Scent swap** applies from the next delivery and leaves the price unchanged.
- **Cadence change** takes effect on the next bill date. Nothing is charged now. `pending_cadence` holds the new cadence until then, and a second change replaces it. Choosing the current cadence answers 422 with the "same as current" message.
  - Example: monthly, started 2026-10-27, changed to `QUARTERLY` on 2026-11-02. Charged now **$0.00**. The next bill on 2026-11-27 is $33.39, and the bill date after that is 2027-02-27.
- A scent swap or a cadence change on a paused or cancelled subscription answers 409 `invalid_transition`: both are judged against the next bill date, which is null while paused.
- **Pause.** Sets `paused_from` to the current next bill date and sets `next_bill_date` to null.
- **Resume.**
  - Before `paused_from`: restores `next_bill_date` to `paused_from` and charges nothing.
  - On or after it: charges one full Trio that day and sets the next bill date to that day plus one cadence period.
- **Cancel.** Ends the subscription after the cycle already paid. Nothing is refunded.
- **Lock.** A subscription with a next bill date locks at that date's 00:00 Toronto time minus `SUBSCRIPTION_LOCK_HOURS` hours.
  - `locks_at` gives that instant, and `locked` is true at and after it.
  - While locked, skip, unskip, scent swap, cadence change, pause and cancel answer 409 `cycle_locked`.
  - Unskip is judged against the skipped date's lock instant.
  - Resume is never locked.
  - Example: next bill date 2026-11-27 gives `locks_at` `2026-11-25T05:00:00.000Z`.
- Subscription `version` goes up by one on every successful change and every credit targeting it. A refused or failed change leaves the subscription byte-identical.

**Refunds and credits**
- **Refund state machine.** `requested` → `issued` (Kill Bill accepted) or `failed` (Kill Bill unreachable or refused). A failed refund leaves the order's bars refundable.
- **Refund rules.**
  - Bars already in an issued refund answer 409 `already_refunded`.
  - `restock: true` writes a `restock` movement for the refunded bars, unless their batch is withdrawn, which answers 422 with the `restock` message.
  - `restock: false` leaves the bars sold.
  - An issued refund updates the order's `refunded` and `status` and queues one refund notice.
- **Credit rules.** A credit is `issued` or `failed`. It targets an order or subscription and goes to that customer's Kill Bill account. An issued credit queues one credit notice.
- **Versions.** Refunds and credits carry `If-Match` with the target's version. Of two submissions made with the same version, exactly one succeeds. The other answers 412 `stale_version` and changes nothing. A replay with the same idempotency key returns the stored response instead.

**Audit**
- One entry is written for every refund and credit (issued or failed), every accepted reconciliation figure, and every orphan refund, in the same unit as the action itself.
- Entries record actor email, role, action, target, reason, amount, Kill Bill reference and outcome. The `target` is exact per `action`: `refund` → the order number; `credit` → the order or subscription number the credit was issued against; `reconciliation_accept` → that reconciliation line's key verbatim; `orphan_refund` → the Kill Bill payment id. An entry's `amount` and `killbill_ref` are the very same values the refund or credit itself reports, character for character, never a different identifier for the same transaction:
  - for an accepted figure, the amount is Kill Bill's figure minus the shop's previous figure, and the reason is "Accepted Kill Bill figure";
  - for an orphan refund, the reason is "Orphan payment".
- Entries can never be changed or removed, through the API or in the database.

**Reconciliation**
- **Placing a line in a month.** Every line belongs to exactly one Toronto month:
  - an order line by its `placed_at`;
  - a credit line by its `created_at`;
  - a subscription line by its Kill Bill invoice date (a Toronto date, because accounts use the Toronto time zone);
  - a payment line by the effective date of its Kill Bill purchase transaction, converted to Toronto time.
  - Examples: `2026-10-01T03:30:00.000Z` → 2026-09; `2026-11-01T03:30:00.000Z` → 2026-10; `2026-11-01T04:30:00.000Z` → 2026-11; `2026-12-01T04:30:00.000Z` → 2026-11.
- **Lines.**
  - `order:<order>` for each order placed that month: shop = total − issued refunds; Kill Bill = the purchased amount minus refunded amounts on the Kill Bill payment whose external key is the order number.
  - `subscription:<sub>:<YYYY-MM-DD>` for each subscription invoice that month, dated by its invoice date: shop = the Trio total; Kill Bill = that invoice's amount before credit is used.
  - `credit:<cr>` for each issued credit that month: shop = the credit amount; Kill Bill = the credit amount recorded in Kill Bill.
  - `payment:<Kill Bill payment id>` for each Kill Bill purchase that month on a shop customer's account whose external key matches no order number and no subscription payment key. Its shop figure is always null, and its Kill Bill figure is the purchased amount minus refunded amounts, so after its orphan refund the line reads shop null, Kill Bill $0.00, status `refunded`.
- **Status.**
  - `match` when both figures are equal.
  - `mismatch` when they differ.
  - `shop_only` when Kill Bill has no counterpart.
  - `kb_only` for payment lines.
  - `accepted` after a mismatch is accepted. The shop's figure for that key then equals Kill Bill's. A later change in Kill Bill makes the line a mismatch again.
  - `refunded` after an orphan payment is refunded.
- **Order and totals.** Lines are sorted by key in byte order. Totals are the sums of the non-null figures.
- **Actions.** Accept applies only to `mismatch` lines (otherwise 409 `line_not_mismatched`). Refund-orphan applies only to `kb_only` lines of any month (otherwise 409 `line_not_orphan`). It refunds the whole payment, and its response always carries the refunded amount.
  - Example: if the shop records $35.64 for an order and Kill Bill shows $34.64 net because of a $1.00 adjustment made directly in Kill Bill, the line is a mismatch. Accepting makes the shop figure $34.64, the audit amount is −$1.00, and the confirmation reads "Kill Bill's figure of $34.64 is now the shop record for order:PDL-000001." (with that line's own key).
- **Snapshots.** Every successful reconciliation run saves a snapshot of the month. While Kill Bill is unreachable, the response is 200 with `"stale": true`, the last snapshot's lines, and its `checked_at`, or `[]` and `null` when there is none. Accept and refund-orphan answer 503 while Kill Bill is unreachable. The first request after Kill Bill returns runs fresh and answers `"stale": false`.

**Notices (the outbox)**
- **Queueing.** Every customer email is a notice written in the same unit as the event that causes it, with a unique key:
  - `code.<SC number>`
  - `order.<order>`
  - `subscription.<sub>`
  - `refund.<rf>`
  - `credit.<cr>`
  - `contact.<ct>`
- **Uniqueness.** A key is never queued twice, and at most one message per key ever reaches the mail server, across retries, resends and recovery.
- **First attempt.** Made within 2 seconds of queueing.
- **Retries.** After a failed attempt, the notice is `retrying`. Retries follow the delays 5 seconds, then 15 seconds, then 45 seconds, in exactly that order. Each delay is measured from the start of the previous attempt, and each retry starts no earlier than its delay and no later than 4 seconds after it. A schedule with the right delays in a different order is wrong.
- **Ceiling.** At most 4 attempts in total. After the fourth fails, the notice is `failed` and is not retried automatically.
- **Resend.** Resend applies only to a `failed` notice: it sets the notice back to `queued` with a fresh attempt list and a fresh enqueue time, keeping its key, number and Message-ID. Of N simultaneous resends of one failed notice, exactly one answers 200 with status `queued`; every other answers 409 `notice_not_failed`. A resend made while mail is still down follows the 5, 15, 45 second schedule again from its new first attempt.
- **Recovery.** From start, and at all times whether or not any notice is waiting, the server checks the mail server every 5 seconds by opening an SMTP connection. As soon as a check or a send succeeds after a failure, every `queued` and `retrying` notice becomes due at once. Due notices are sent one at a time, strictly oldest first by `enqueued_at`, with ties broken by ascending notice number. A notice queued during the drain waits behind every older one. A notice is picked up by exactly one sender at a time, so a drain and a resend never both send it.
- **Status.** `GET /api/status` reports `mail` as `down` from the first failed attempt or check until the next success. It reports `billing` as `down` when the last Kill Bill check, made every 5 seconds, failed. Each reflects a change within 15 seconds.

**Contact.** Name 1 to 120 characters, a valid email, a topic from the list, message 10 to 2,000 characters (all limits inclusive), under the text-field rules above. Each message gets a CT number and queues one contact-reply notice in the request's locale.

### Services (DP-08, DP-22, DP-23, DP-25, DP-26, DP-27, DP-28, DP-29, DP-31, DP-32, DP-39, DP-40, DP-43, DP-44, DP-45, DP-46, DP-47, DP-48)

**Kill Bill** (system of record for money)
- **Requests.** Every request carries the tenant's API key and secret and basic credentials from the environment. `X-Killbill-CreatedBy` is the acting staff member's email for staff actions, and `loafline` otherwise.
- **Catalog.** At start, and every 10 seconds until it succeeds, the app makes sure the tenant's catalog holds product `trio` in currency CAD with three in-advance recurring plans at $29.04 and no trial:
  - `trio-monthly` (MONTHLY)
  - `trio-bimestrial` (BIMESTRIAL)
  - `trio-quarterly` (QUARTERLY)
  
  Uploading the catalog is idempotent.
- **Account.** One Kill Bill account per customer, created at their first checkout or subscription:
  - external key = the email in lower case;
  - currency CAD;
  - time zone America/Toronto;
  - locale `fr_CA` or `en_CA`;
  - name = the shipping name;
  - the default payment method is Kill Bill's external payment method.
  
  A customer never gets a second account.
- **Drop order.** One committed invoice on the customer's account, holding:
  - one external charge of $11.00 per bar, described "Bar <k> · <batch> · <English scent name>";
  - one external charge "Shipping" of $9.00;
  - one tax item per tax line, described `GST`, `QST` or `HST`, with the order's amounts.
  
  It is paid in full by one purchase payment whose payment external key and transaction external key are the order number. The invoice balance is $0.00. The payment is created through Kill Bill's account or invoice payment routes, whose paths contain `/accounts/`, `/invoices/` or `/invoicePayments`, followed by `/payments`.
- **Subscription start.**
  - Kill Bill subscription on the plan for the cadence.
  - Its first invoice holds the recurring item at $29.04 plus one tax item per tax line, totalling the Trio total.
  - Any account credit is applied to that invoice by Kill Bill.
  - The rest is paid by one purchase payment with external key `<sub>-<YYYY-MM-DD>`, where the date is the subscription's `started_on`.
  - When credit covers the whole invoice, there is no payment, and the invoice balance is $0.00.
  - Every later subscription invoice carries the same tax items for the subscription's province.
  - Every later charge is keyed the same way: a renewal on its bill date, and a resume charged on the day it resumes, is paid by one purchase payment whose external key is `<sub>-<YYYY-MM-DD>` with that charge's own date, so no subscription payment is ever left for Kill Bill to key and none reads as an orphan.
- **Subscription changes.** Each is a subscription-level blocking state with service `loafline`, or a dated entitlement event. `TRIO_SKIP` and `TRIO_PAUSE` block billing only (not entitlement or changes); `TRIO_CLEAR` blocks nothing. "00:00 Toronto" means midnight Toronto time on the named date.
  - Skip: `TRIO_SKIP` effective at the skipped bill date's 00:00 Toronto, plus `TRIO_CLEAR` effective at the new next bill date's 00:00 Toronto.
  - Unskip: `TRIO_CLEAR` effective at the skipped bill date's 00:00 Toronto.
  - Pause: `TRIO_PAUSE` effective at `paused_from`'s 00:00 Toronto.
  - Resume: `TRIO_CLEAR` effective at the later of now and `paused_from`'s 00:00 Toronto.
  - Cadence change: a plan change to `trio-<cadence in lower case>` with a requested date equal to the next bill date. When a pending change is replaced, the pending one is undone in Kill Bill first, so at most one plan change is ever pending.
  - Cancel: a cancellation with a requested date equal to the next bill date, with no refund or credit.
  - Scent swap is a shop-only change and makes no Kill Bill call.
  - A change that answers 503 leaves no blocking state or entitlement event behind in Kill Bill.
- **Refund.** A refund transaction on the order's invoice payment, issued through Kill Bill's invoice payment refund route (path containing `/invoicePayments/` followed by `/refunds`), for exactly the refund amount, with invoice item adjustment requested and one adjustment per invoice item:
  - each refunded bar's item by its price;
  - the Shipping item by the allocated shipping, only on the final refund;
  - each tax item by that tax's allocated amount.
  
  The item adjustments on each invoice item therefore sum exactly to the allocations made to it. Over an order's life every item is adjusted to exactly its amount, and the invoice balance stays $0.00.
- **Goodwill credit.** An account credit for exactly the credit amount, described "Goodwill <cr>".
- **Orphan refund.** A refund of the whole payment amount, through Kill Bill's payment refund route (path containing `/payments/` or `/invoicePayments/` followed by `/refunds`).
- **When Kill Bill is unreachable** (connection refused or no answer within 5 seconds). A request that was delivered but whose response never arrives is "no answer": the call counts as failed even if Kill Bill in fact carried it out, and the app must not go looking for the result to commit on instead. It answers 503 as below and leaves the shop record uncommitted, which is exactly how an orphan payment comes to exist for reconciliation to surface:
  - checkout, subscription start, subscription changes, refunds, credits, accept and refund-orphan answer 503 `billing_unavailable` within 6 seconds, with `message` set per route family:
    - checkout: "Checkout is paused: our payment system is unreachable." / "Le paiement est en pause : notre système de paiement est injoignable.";
    - subscription start and every subscription change that calls Kill Bill (skip, unskip, pause, resume, cancel, cadence change): the full two-sentence subscribe and account banner from Feedback states;
    - refunds: the "Refund failed (503)" copy from Studio updates, with `<rf>` the number of the refund just recorded as failed;
    - credits: the "Credit failed (503)" copy from Studio updates, with `<cr>` the number of the credit just recorded as failed;
    - reconciliation accept and refund-orphan: the "Other 503 `billing_unavailable`" copy from Studio updates;
  - holds, browsing, sign-in, contact, scent swaps and packing keep working;
  - the failed calls move no money and change no state: an order's and a subscription's amounts, state, fulfilment, ship date, bars and cadence read back unchanged, and only the `version`, the `failed` refund or credit row and its audit entry differ;
  - refunds and credits are recorded as `failed` with their audit entries.
- **Recovery.** When Kill Bill returns, everything works again within 15 seconds, without a restart.

**Mail** (SMTP to `SMTP_HOST`:`SMTP_PORT`, no authentication, no TLS)
- **Envelope and headers.** Every message is from `MAIL_FROM` (`Pain de Lune <bonjour@paindelune.example>`) to one recipient.
  - The To header and the envelope recipient are the bare address only, with no display name.
  - Message-ID `<` + notice key + `@paindelune.example>`, for example `<order.PDL-000001@paindelune.example>`.
  - The subject is in the customer's locale. User-entered text never appears in any header; the only placeholders in subjects are record numbers and the one-time code.
  - The plain-text UTF-8 body is the customer's-locale block, then a line of exactly ten hyphens, then the other locale's block. Any HTML part carries the same lines.
- **Locale.** The order's or subscription's locale for order, subscription, refund and credit notices; the request locale for codes and contact replies.
- Block lines are listed below, one per line, in order. In French, the no-break space rule from Feedback states applies.
- **Step-up code** (to the email entered):
  - Subject: "Your Pain de Lune code: <code>" / "Votre code Pain de Lune : <code>".
  - Lines: "Your one-time code is <code>." / "Votre code à usage unique est <code>."; "It works once and expires at <H>:<MM> Toronto time." / "Il ne sert qu'une fois et expire à <H> h <MM>, heure de Toronto."; "If you didn't ask for it, ignore this email." / "Si vous ne l'avez pas demandé, ignorez ce courriel."
- **Order confirmation** (to the order email, only after payment succeeds):
  - Subject: "Order <order> confirmed" / "Commande <order> confirmée".
  - Lines: "Order: <order>" / "Commande : <order>".
  - Then one line per bar in order-line order: "Bar <k> · <batch> · <scent>: <price>" / "Pain <k> · <batch> · <parfum> : <price>".
  - Then "Subtotal: <money>" / "Sous-total : <money>"; "Shipping: <money>" / "Livraison : <money>".
  - Then one line per tax: "<GST|QST|HST> (<rate>): <money>" / "<TPS|TVQ|TVH> (<rate>) : <money>".
  - Then "Total: <money>" / "Total : <money>"; "Ships on: <YYYY-MM-DD>" / "Expédition le : <YYYY-MM-DD>".
  - For example, the one-bar QC order reads "GST (5%): $1.00", "QST (9.975%): $2.00", "Total: $23.00".
- **Subscription started** (to the subscriber):
  - Subject: "Subscription <sub> started" / "Abonnement <sub> commencé".
  - Lines: "Subscription: <sub>" / "Abonnement : <sub>"; "Trio: <scent>" / "Trio : <parfum>"; "Cadence: <cadence label>" / "Fréquence : <cadence label>"; "Subtotal: <money>" / "Sous-total : <money>"; "Subscribe-and-save (12%): -<money>" / "Abonnement-épargne (12 %) : -<money>".
  - Then the tax lines as above.
  - Then "Total: <money>"; "Charged today: <money>" / "Prélevé aujourd'hui : <money>"; "Next bill date: <YYYY-MM-DD>" / "Prochaine date de facturation : <YYYY-MM-DD>".
- **Refund:**
  - Subject: "Refund <rf> for order <order>" / "Remboursement <rf> pour la commande <order>".
  - Lines: "Refund: <rf>" / "Remboursement : <rf>"; "Order: <order>" / "Commande : <order>".
  - One bar line per refunded bar, without price: "Bar <k> · <batch> · <scent>" / "Pain <k> · <batch> · <parfum>".
  - "Refunded: <money>" / "Remboursé : <money>"; "It reaches your original payment method within 5 to 10 business days." / "Il apparaîtra sur votre moyen de paiement d'origine d'ici 5 à 10 jours ouvrables."
- **Credit:**
  - Subject: "Credit <cr> added to your account" / "Crédit <cr> ajouté à votre compte".
  - Lines: "Credit: <cr>" / "Crédit : <cr>"; "Amount: <money>" / "Montant : <money>"; "It applies automatically to your next invoice." / "Il s'applique automatiquement à votre prochaine facture."
- **Contact reply** (to the sender):
  - Subject: "We received your message <ct>" / "Nous avons bien reçu votre message <ct>".
  - Lines: "Reference: <ct>" / "Référence : <ct>"; "Topic: <topic label>" / "Sujet : <topic label>"; "Thanks, <name>. We reply within two business days." / "Merci, <name>. Nous répondons en deux jours ouvrables."
- **What an email may contain.** Only:
  - the recipient's own address (and, in the contact reply body only, the name they entered);
  - order, subscription, refund, credit and contact numbers;
  - batch codes, bar numbers and scent names;
  - dates, times, amounts and rates;
  - the one-time code (only in its own email and subject);
  - the Message-ID header built from the notice key.
  
  No email body, subject or header may contain any URL or link, a Kill Bill identifier, any UUID, a session or cart id, a service credential, an environment value, or an internal host name such as `killbill`, `postgres`, `mailpit`, `localhost` or `127.0.0.1`. Emails have no attachments.
- **When mail is unreachable.** Events still succeed with their normal responses and copy. The notice follows the retry schedule in Business rules. The Notices table shows each attempt time and the outcome "failed" with no error text beyond "mail server unreachable".

**PostgreSQL**
- Holds everything else: batches, holds, the stock ledger, customers, codes and code-request counts, orders, subscriptions, refunds and their allocations, credits, idempotency records, notices, staff, settings, reconciliation snapshots and the audit log.
- The schema and seed data are applied idempotently every time the server starts, so an empty database comes up seeded.

### Seed data (DP-12, DP-15, DP-33, DP-37)

Every person and business below is invented. "Seed day" is the Toronto date on which an empty database is first seeded. Seed records are written once, when their table is empty.

Drop scents (the only values the "Scent" picker on the batch board offers):

| Slug | English | French | Tint | Notes (en / fr) |
|---|---|---|---|---|
| lavender-oat | Lavender & Oat | Lavande et avoine | lilac | Lavender, colloidal oat, a little honey / Lavande, avoine colloïdale, un peu de miel |
| smoked-birch | Smoked Birch | Bouleau fumé | ash | Birch tar, cedar leaf, black pepper / Goudron de bouleau, feuille de cèdre, poivre noir |
| wild-mint | Wild Mint | Menthe sauvage | mint | Spearmint, nettle, green clay / Menthe verte, ortie, argile verte |
| rose-clay | Rose Clay | Argile rose | rose | Rose geranium, pink kaolin / Géranium rosat, kaolin rose |

Trio core scents: `oat-milk` Oat Milk / Lait d'avoine, `cedar-sage` Cedar & Sage / Cèdre et sauge, `unscented` Unscented / Sans parfum.

Batches:

| Code | Scent | Poured on | Cure days | Bars cut | State | Drop time |
|---|---|---|---|---|---|---|
| B-0412 | lavender-oat | seed day − 35 | 28 | 12 | live | seed day − 1 at 10:00 Toronto |
| B-0413 | smoked-birch | seed day − 30 | 28 | 10 | scheduled | seed day + 7 at 10:00 Toronto |
| B-0414 | wild-mint | seed day − 3 | 35 | 14 | curing | none |

No bars are held or sold at start. The next new batch is B-0415.

Staff:

| Name | Email | Password | Role |
|---|---|---|---|
| Odile Arsenault | maker@paindelune.example | lune-maker-2026 | maker |
| Samir Boucher | finance@paindelune.example | lune-finance-2026 | finance |
| Jade Poirier | packing@paindelune.example | lune-packing-2026 | packing |

Settings: packing cutoff 14:00. There are no customers, orders, subscriptions, refunds, credits, notices or audit entries at start.

## Technical requirements

### Deployment (DP-01)

- The runtime is Node.js 22 with npm. The app is written in TypeScript.
- `/app/run.json` holds string commands run from `/app`, for example:
  ```
  {"_schema":"run-manifest-v1","install":"npm ci","build":"npm run build","serve":"npm run start"}
  ```
- `serve` binds `0.0.0.0` on port 4173, or on `APP_PUBLIC_PORT` when it is set. Health is served at `/api/health` as published in API.
- `install` and `build` need no running services. `serve` works whether or not Kill Bill and the mail server are up at start.

### Configuration and secrets (DP-02, DP-08)

The server reads these environment variables at start. None is hard-coded, and none is ever sent to the browser.

| Variable | Use |
|---|---|
| `DATABASE_URL` | PostgreSQL connection (non-superuser owner of its database) |
| `KILLBILL_URL`, `KILLBILL_USERNAME`, `KILLBILL_PASSWORD`, `KILLBILL_API_KEY`, `KILLBILL_API_SECRET` | Kill Bill |
| `SMTP_HOST`, `SMTP_PORT` | Outgoing mail |
| `MAILPIT_URL` | Mail server's HTTP address. The app may ignore it. |
| `MAIL_FROM` | The From line, `Pain de Lune <bonjour@paindelune.example>` |
| `APP_PUBLIC_PORT` | Listening port, default 4173 |
| `HOLD_TTL_SECONDS` | Hold lifetime in seconds, default 600 (10 minutes), allowed 10 to 3,600 inclusive. The instance being graded runs with the default, so a hold always outlasts a browser journey; values near the lower bound are only used on an extra instance started to exercise the expiry edge |
| `STEPUP_CODE_TTL_SECONDS` | Code lifetime in seconds, default 300 |
| `STEPUP_LOCK_SECONDS` | Lock-out length in seconds, default 900 |
| `STEPUP_RATE_LIMIT` | Code requests allowed per email in the window, default 3 |
| `STEPUP_RATE_WINDOW_SECONDS` | Length of the rolling code-request window in seconds, default 600 |
| `SUBSCRIPTION_LOCK_HOURS` | Lock window before a bill date in hours, default 48 |
| `SESSION_SECRET` | Signs session cookies. If unset, a random secret is generated at start. |

The verifier may set the time variables to small values. Every server-side duration in this brief comes from one of these variables or is at most 60 seconds, apart from two lifetimes stated in their own sections: the 12-hour session cookies in Cookies and the 24-hour idempotency-key retention in Idempotency.

### Server boundary (DP-02, DP-03, DP-32)

- **Same origin only.** No cross-origin resource sharing headers. A mutating request (POST, PUT, PATCH or DELETE) whose `Origin` header is present and differs from the app's own origin answers 403 `cross_origin`.
- **Request bodies.** Mutating requests with a body must send `Content-Type: application/json`; otherwise the answer is 415 `unsupported_media_type`. Bodies up to and including 65,536 bytes are accepted; larger ones answer 413 `payload_too_large`.
- **Third parties.** Pages load no third-party resources. Fonts, scripts and styles are served from the app.
- **Files never served.** The server never serves TypeScript sources, source maps, `package.json`, lockfiles, `run.json`, `.env` files, `node_modules`, `.git`, or any file outside the built public assets. Such paths answer 404.
- **Secrets never sent.** No response body, header, HTML attribute, script bundle or email contains any value of `DATABASE_URL`, `KILLBILL_PASSWORD`, `KILLBILL_API_SECRET`, `KILLBILL_API_KEY`, `SESSION_SECRET` or the database password. Browser requests never carry them either.
- **Dependencies down at boot.** If Kill Bill or the mail server is unreachable at start, the server still starts, serves pages and answers health. It reports the service as down in `GET /api/status` and recovers as described in Services, without a restart. If PostgreSQL is unreachable at start, the server retries every 2 seconds and starts serving once the database answers.

### Browser support and performance (DP-05, DP-09, DP-15)

- Current Chromium is required, on desktop and in phone emulation with touch input. Current Firefox and WebKit should work, with the WebGL fallback where needed.
- The three viewports are 375×812, 768×1024 and 1280×800.
- On the test machine, the drop page shows the counts strip and the bar list within 3 seconds of navigation, and the loaf scene reaches `data-state` `ready` (or `fallback`) within 5 seconds.
- API reads answer within 1 second.
- A scroll frame updates the figure's data attributes in the same frame.

## Working rules

- IF-01: `/app/run.json` exists and is JSON with string fields `install`, `build` and `serve` and `"_schema":"run-manifest-v1"`.
- IF-02: `THIRD_PARTY_NOTICES.md` at `/app` lists every shipped package and the bundled Fraunces and Instrument Sans fonts, each with its licence. "Shipped packages" means the production dependency tree (`npm ls --omit=dev --all --json`, or the lockfile's non-dev packages).
- IF-03: Every shipped package and bundled asset is licensed under MIT, ISC, BSD-2-Clause, BSD-3-Clause, Apache-2.0, 0BSD, CC0-1.0, BlueOak-1.0.0 or, for fonts only, OFL-1.1.
- IF-04: PostgreSQL is the only datastore. No SQLite, Redis, file-based store, or in-memory store used as the source of truth.
- IF-05: The provided service configuration (the development compose files and their seed steps) is left unchanged.
- IF-06: The application's server and client source is TypeScript. Plain JavaScript appears only in configuration files.

## Engineering standards

- The code is idiomatic, strictly typed TypeScript with no `any` escaping a module boundary, and names that match this brief's domain terms (batch, bar, hold, cut step, bar span, Trio, cadence, allocation, notice, reconciliation line).
- Each domain rule is decided in exactly one place in the source: stock on hand, the money formula and rounding, refund allocation, each state machine's transitions, hold expiry, the code-request window, the lock window, Toronto time and Toronto month conversion.
- Each request body's allowed keys are declared once per route, and the same declaration both rejects extra keys and reads the accepted ones.
- No abstraction has only one implementation, and no wrapper exists only to rename another call.
- There is no dead, commented-out or unreachable code, and no defensive check for a state the types or the state machines already rule out.
- Every API error is produced through the one published error shape and precedence.
- Money is handled only as integer cents from input to Kill Bill and email.
- Nothing is built beyond this brief: no extra screens, endpoints, flags or test-only shortcuts.
