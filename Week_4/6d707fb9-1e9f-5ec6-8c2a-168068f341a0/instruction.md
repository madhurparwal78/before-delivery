# Fio Contado Desk

Fio Contado Desk is a working desk for one independent life-cycle assessor who works alone from Porto, Portugal, for a handful of fashion labels. For each style the assessor gathers fibre, factory and transport facts through private answer pages sent by mail in the supplier's language, records meter readings on a phone in factories with poor signal, works out the footprint across six measures with factors read from a third-party factor library, compares reduction scenarios, asks a third-party score service for the national textile score, makes a signed-off dossier PDF and publishes a public product passport. It is built in TypeScript on Postgres, MinIO, Mailpit, WireMock (which plays the two invented third-party providers) and Gotenberg. Out of scope: money and payments of any kind, staff and roles, accounts for suppliers, label contacts or shoppers, any other datastore, and any legal claim or compliance advice. The product stores, converts units, works out published sums and shows what the providers answered.

## Problem and users

An independent assessor spends most of each study chasing facts rather than working them out. The official free simulator takes one garment at a time by hand, catalogue-wide platforms are quoted for big brands, the ISO software costs thousands a year, and none of them gathers the supplier's numbers. Fibre, factory and transport facts at the supply chain tiers arrive as long mail threads in English, French, Turkish and Arabic, where a comma and a dot mean opposite things. Meter readings go on paper in factories with poor signal. A visit booked in Izmir's wall time lands an hour off in the Lisbon diary after a clock change. A figure that floating point rounds the wrong way reaches a label's dossier. The assessor pays in unpaid evenings of retyping and in figures nobody can later stand behind, and the labels pay in passports that cannot be shown to be right.

- **Independent assessor (daily, all signed-in screens):** runs every style from supplier facts through footprint, scenarios, score, dossier and passport from one desk, including on a phone in a factory with poor signal.
- **Supplier contact (occasional, only the private answer page):** gives energy, water and fibre origin facts in their own language without an account.
- **Label contact (occasional, only the private sign-off page):** reads the current dossier and signs it off by typing their name.
- **Shopper (occasional, only the public passport and public site):** reads a garment's public passport in their language and reads the public site.

## Journeys

1. **From first look to a desk.** A shopper arrives at `/` for the first time. The intro plays and ends, Try one garment answers in place, the method and questions pages read at every width, and the assessor then starts a desk or signs in and lands on Styles.
2. **Setting up a style.** Marta Quintela starts on Styles with the seeded labels. She brings styles in from a catalogue file through a preview, opens a style, adds material lines and a transport leg, and reorders the lines. The Materials screen shows exact masses and the new order.
3. **Asking a supplier.** The assessor sends a request in Turkish to a supplier in Izmir. The contact opens the private page on a phone, types numbers the Turkish way, attaches an evidence file and sends once. The page shows the sent copy, and the assessor's open screens show the answer within the 5-second refresh.
4. **A factory visit with poor signal.** The assessor books a visit in Izmir wall time and reads it in both times. On the visit page with no network, readings wait on the phone with a live count. When the network returns they arrive in the order taken and the waiting line says all are sent.
5. **Reading the footprint.** The assessor presses `Work out footprint` on a style. The Stage strata show which stage carries each of the six measures, choosing a measure moves the same bands, and a later supplier answer moves them again while every earlier result stays readable.
6. **Trying a reduction.** From a result the assessor tries a recycled share and other changes. Totals and differences answer in place, a ghost band keeps the baseline visible, the address holds the scenario, and the scenario is saved under a name.
7. **Score and passport.** The assessor asks for the textile score, which shows only after the service answers, then publishes. A shopper reads `/p/<gtin>` in any of four languages with no sign-in. A correction makes a new edition while the old one stays as it was.
8. **Dossier, sign-off and closing a label.** The assessor makes a dossier, which shows Ready when the PDF is stored. The label contact reads it on a private page and signs by typing a name. Later the assessor closes the label, can bring it back within the wait, and otherwise sees it Erased once the file store has confirmed each deletion.

## Mandatory requirements

This is the complete list of mandatory requirements; every check traces to one of these lines and the detailed sections below.

- **DP-01 — Starting a desk, signing in and out, changing the password.** A new desk signs up, a wrong password gets 401, the right one signs in, signing out ends the session with 401 from the session endpoint, and changing the password ends that person's other sessions while the new password signs in.
- **DP-02 — Labels on one desk.** The assessor creates, reads, renames and deletes a label, a deleted label answers 404 from then on, and a label of another desk answers 404 exactly like an unknown id in the same shape.
- **DP-03 — Sign-in form.** Filling the sign-in form lands on `/styles` with a live session, and signing out there leaves the session endpoint answering 401.
- **DP-04 — Public site journey.** A shopper walks `/`, `/method` and `/questions` through the intro, the label strip, the mega menu, the questions and Try one garment, checked by a screen-rules check on `/` with the mega menu and on `/questions` with an accordion where `POST /api/estimate` with an over-limit body answers the earlier 405, a keyboard-only journey, a 375x812 touch journey, the not-found copy verbatim and Try one garment's figure as its precision rule, and its screen meets the screen rules.
- **DP-05 — First-visit intro.** A first visit to `/` plays the intro described in Motion and effects once in that browser with `Skip intro` holding focus and the page behind inert, ending by itself, by Escape or by that button with focus on the level-one heading, and never on another address or under reduced motion.
- **DP-06 — Label strip, header, underline and mega menu.** The label-name strip, the header, the navigation underline and the mega menu behave as published in Interactions, with a closed menu's tiles out of the Tab order.
- **DP-07 — Questions page.** Questions start closed, open by height one at a time, and hold the open question in the address with each change one history entry that Back and Forward return to.
- **DP-08 — Try one garment.** Choosing a garment, fibre and country answers the climate figure from the server in place after the published pause, always for the latest choice even when an earlier request answers later, with rolling numerals and the choices in the address.
- **DP-09 — Method page layout.** The method page shows its stages side by side from 1100 px wide, in two columns at 1099 px, 1024x768 and 768x1024, and in one column at 375x812.
- **DP-10 — Styles journey.** The assessor filters, sorts, searches and pages Styles, returns with Back, uses the row menu and brings in a catalogue file, checked by a screen-rules check on `/styles` with the `New style` dialog and the row menu where an oversized `POST /api/styles` without a session answers 413 as JSON, a keyboard-only journey, a 375x812 touch journey, the GTIN and catalogue refusal copy verbatim and the GTIN check digit and folding table as its precision rule, and its screen meets the screen rules.
- **DP-11 — Style records and the GTIN check digit.** A style keeps its published details and states, and a GTIN with a wrong mod-10 check digit is refused with copy naming the right digit.
- **DP-12 — Styles list held in the address.** The list filters by label, season and state, sorts by name or climate figure, searches with the folding table, pages 25 at a time with a cursor that never repeats or skips a style while new ones arrive, holds it all in the address with each committed change one history entry, and restores filters, sort, page, scroll and focus on Back.
- **DP-13 — Row action menu, Duplicate and Archive.** Each row's action menu opens uncut inside the viewport on the last row of a table scrolling in its frame at 375 and 1280 with each item pressable where it shows, Duplicate opens the copy, and Archive removes the row with focus on the level-one heading.
- **DP-14 — Catalogue file.** A catalogue file with or without a byte order mark and with LF or CRLF previews new, matched and refused rows with row numbers and reasons before anything is saved, and saving the same file twice changes nothing.
- **DP-15 — Bill of materials journey.** The assessor adds, edits and reorders material lines and transport legs on the Materials screen, checked by a screen-rules check with the `Add material` dialog where an oversized `POST /api/styles/<id>/lines` without a session answers 413 as JSON, a keyboard-only journey, a 375x812 touch journey with the dialog as a full-height sheet, the fibres and stale-save copy verbatim with the name and local time, and exact half-up mass as its precision rule, and its screen meets the screen rules.
- **DP-16 — Exact mass and fibre shares.** Mass is computed in exact decimals and shown half up to 0.1 g, and a line's fibre shares of one decimal must add up to exactly 100.0 or are refused with the published copy.
- **DP-17 — Add material combobox.** The `Add material` dialog searches the published materials through an ARIA combobox with a listbox, using Up, Down and Enter, and the latest input wins even when an earlier search answers later.
- **DP-18 — Reordering lines.** Move up, Move down, Alt+Up and Alt+Down reorder lines, keep focus on the moved line's control, keep end controls focusable with aria-disabled, persist the order and announce the new position.
- **DP-19 — Stale saves on a style.** Saving over a style changed elsewhere meanwhile answers 412 and the dialog stays open as typed with the published copy naming the time and the change.
- **DP-20 — Supplier requests journey.** The assessor sends, re-addresses and ends requests from `/requests`, checked by a screen-rules check with the `New request` dialog where an oversized `POST /api/requests` without a session answers 413 as JSON, a keyboard-only journey, a 375x812 touch journey, the rate-limit and answer-arrived copy verbatim with the name and local time, and the page's edge instant and local due date as its precision rule, and its screen meets the screen rules.
- **DP-21 — Request mail.** The request mail arrives in the chosen language with the private address and the due date in the supplier's local wall time, and holds no footprint figure and no other label's or supplier's name.
- **DP-22 — Private page lifetime and one reminder.** An answer page ends at the published instant, a request at that instant finds it ended, a new address ends the old one, the assessor can end it, an ended page answers 410 with the ended copy in its language, and exactly one reminder goes if still unanswered.
- **DP-23 — Request rate limit.** A desk sends at most the published number of requests in a window, and the next answers 429 with Retry-After and the published copy, keyed on the desk and never the network address.
- **DP-24 — Answers reach open screens.** An answer reaches the assessor's open screens within the 5-second refresh, in place, and is announced with the supplier's name and local time.
- **DP-25 — Answer page journey.** A supplier opens `/a/<token>` at 375x812 and answers through the steps without an account, checked by a screen-rules check with the Unit sheet where an oversized `POST /api/a/<token>/evidence` without a session answers 413 as JSON, a keyboard-only journey, a 375x812 touch journey, the whole copy table verbatim in all four languages, and local number typing, MJ conversion and file-only size as its precision rule, and its screen meets the screen rules.
- **DP-26 — Four languages, Arabic mirrored.** The page renders in the request's language with the matching `lang`, and Arabic adds `dir="rtl"`, a mirrored step rail and arrow keys, a Unit sheet from the left edge and number fields left to right.
- **DP-27 — Local numbers and exact megajoules.** Numbers typed the local way are stored as the exact value they mean, anything else is refused with that language's number copy, and energy is kept in exact MJ.
- **DP-28 — Evidence files.** An evidence file is judged by its content as PDF, JPEG or PNG, is held to 5,000,000 bytes counted on the file alone with 413 as JSON before anything else, and is kept in MinIO byte for byte.
- **DP-29 — Sent once, drafts kept.** The page shows Sent only after MinIO has confirmed any file, while MinIO is down the file is refused in that language with nothing half-written, a draft survives a reload, and pressing Send answers twice sends once.
- **DP-30 — Factory visits journey.** The assessor books visits on `/visits` and records readings on `/visits/<id>`, checked by a screen-rules check with the `Book visit` dialog where an oversized `POST /api/visits` without a session answers 413 as JSON, a keyboard-only journey, a 375x812 touch journey, the offline, sign-out and lower-reading copy verbatim with the name and local time, and local wall time across a clock change as its precision rule, and its screen meets the screen rules.
- **DP-31 — Visit times across clock changes.** A visit keeps its wall-clock time, moves in the Lisbon diary, shows both times, refuses a time the change skips, takes the first of a time that happens twice, and the diary counts 23-hour and 25-hour Lisbon days correctly.
- **DP-32 — Readings wait on the device.** With no network the page stays in place and counts waiting readings, then sends them in the order taken within the next 5-second refresh, each with its own request key so a repeat answers the first response and changes nothing, with `takenAt` stamped by the server, and sign-out refused while any wait.
- **DP-33 — A lower reading.** A reading lower than the meter's last one opens the published dialog with Keep mine and Keep recorded while the other waiting readings keep going.
- **DP-34 — Footprint journey.** The assessor works out a footprint on `/styles/<id>` and reads it through the Stage strata, checked by a screen-rules check with the factors popover where an oversized `POST /api/styles/<id>/results` without a session answers 413 as JSON, a keyboard-only journey including the measures composite, a 375x812 touch journey, the library-unavailable and newer-factors copy verbatim, and the three-significant-figures rule and library call count in the WireMock journal as its precision rule, and its screen meets the screen rules.
- **DP-35 — Library reading and exact sums.** `Work out footprint` reads the edition list and every page of the newest edition in effect, keeps those rows with the new result, and works out the published sums in exact decimals shown by the published display rule.
- **DP-36 — Results kept for good.** Each result keeps its edition on every screen and file, working out again or a supplier's answer makes a new result, every earlier result stays readable exactly as it was, and hotspot, shares and data quality follow the published rules.
- **DP-37 — Stage strata.** Each result shows five strata exposing stage and share, and choosing a measure or receiving an answer moves the same elements as published in Motion and effects, while a refresh with no new data starts no motion and replaces no element.
- **DP-38 — Measures composite and factors popover.** The measures are one keyboard composite with a single Tab stop, and Enter opens a factors popover uncut inside the viewport at 375 and 1280, with Up and Down also moving at 375.
- **DP-39 — Newer factors.** `Check for newer factors` reads only the edition list, and the style shows the newer-factors copy, decided by the server, only once a newer edition takes effect on or before today's Lisbon date.
- **DP-40 — Scenarios journey.** The assessor tries changes on `/styles/<id>/scenarios` without touching the result, checked by a screen-rules check with the `Save scenario` dialog where an oversized `POST /api/styles/<id>/scenarios` without a session answers 413 as JSON, a keyboard-only journey, a 375x812 touch journey with the comparison table in its own focusable, named frame, the stale-baseline copy verbatim with the local time, and half-up differences with no library call in the WireMock journal as its precision rule, and its screen meets the screen rules.
- **DP-41 — Live scenario totals and saving.** Totals and differences answer from the server in place after the published pause with the latest input winning and a ghost baseline band behind, the scenario is held in the address with each committed change one history entry, and saving over a re-worked baseline answers 412 with the dialog open as typed.
- **DP-42 — Textile score journey.** The assessor asks for the score on `/styles/<id>`, checked by a screen-rules check with the factors popover and the score panel where an oversized `POST /api/styles/<id>/score` without a session answers 413 as JSON, a keyboard-only journey, a 375x812 touch journey, the missing-origin, worst-case, busy and unavailable copy verbatim with the local time, and the provider call count in the WireMock journal as its precision rule, and its screen meets the screen rules.
- **DP-43 — Score rules.** The score shows only after the service has answered, missing origin refuses before any call, same inputs never call twice, a busy answer blocks calls until a server-held instant, a connection failure keeps the old score, and changed inputs show `Outdated` as decided by the server.
- **DP-44 — Product passports journey.** The assessor publishes, corrects and withdraws from the style screen and `/passports`, checked by a screen-rules check with the `Withdraw passport` dialog where an oversized `POST /api/styles/<id>/passport` without a session answers 413 as JSON, a keyboard-only journey, a 375x812 touch journey, the withdrawn, corrected and taken-GTIN copy verbatim with the date, and the unchanged edition page as its precision rule, and its screen meets the screen rules.
- **DP-45 — Published fields only.** `/p/<gtin>` reads with no sign-in in all four languages and shows only the published fields, never a supplier contact's name or mail and never the assessor's notes, in the page or its JSON.
- **DP-46 — Editions, corrections and withdrawal.** A published edition never changes, a correction makes a new edition while earlier editions stay readable exactly as they were, withdrawing answers 410 with the published copy, and a GTIN is unique across every desk once published.
- **DP-47 — Dossier and sign-off journey.** The assessor makes a dossier, sends the sign-off page and closes a label, checked by a screen-rules check on `/styles/<id>` and `/labels/<id>` with the `Close label` dialog where an oversized `POST /api/styles/<id>/dossiers` without a session answers 413 as JSON, a keyboard-only journey, a 375x812 touch journey, the outage, replaced-dossier and download-limit copy verbatim with the local time, and the results file cell and PDF text as its precision rule, and its screen meets the screen rules.
- **DP-48 — Dossier PDF.** A dossier shows Ready only after Gotenberg has answered and MinIO has confirmed, its text holds the published facts and no supplier contact details, and nothing is half-written when either service is down.
- **DP-49 — Private sign-off page.** The label contact signs by typing a name without an account on a page with the published lifetime, a new address ends the old one, and signing a replaced dossier answers 409 with the published copy.
- **DP-50 — Results file and download limit.** The results file is UTF-8, every field quoted, CRLF, with published columns and the apostrophe rule on risky cells, and downloads are limited per desk with 429 and Retry-After, keyed on the desk and never the network address.
- **DP-51 — Closing, bringing back and erasing a label.** A closed label comes back exactly as it was within the wait, and after the wait its contacts, supplier contacts and files are erased everywhere, Erased shows only after MinIO has confirmed each deletion, its addresses answer 404 and its passports 410.
- **DP-52 — Exact starting state.** An untouched copy holds exactly the published seed data and nothing else.
- **DP-53 — Route sweep at 375x812.** Every signed-in screen and private page meets SR4, SR5 and SR6 at 375x812, and SR14, SR15, SR16 and SR17 as published.
- **DP-54 — Motion system.** Every motion the app runs is a CSS transition, CSS animation or element animation of exactly 160, 320 or 640 ms, plus 64 seconds for one pass of the label-name strip.
- **DP-55 — Addresses, headings, titles and the Menu sheet.** Each create action lands on its published address with its heading, title and focus target, and below 1100 px wide the closed Menu sheet is hidden and inert.
- **DP-56 — A session that ends mid-form.** A session the server has ended answers 401 session_ended for that cookie, keeps the open dialog as typed, announces the published copy, and signing in again returns to the same address with the draft kept.
- **DP-57 — One API convention.** Every endpoint uses camelCase keys and enum values, whole-second UTC instants with a Z, one error shape, one precedence ladder and the published session cookie attributes, and answers 503 rather than 500 for a provider failure.
- **DP-58 — The public face.** The home page carries the dealt composition: a light left-aligned headline on flat bone, a green stage with a shirt-collar cut, the working Try one garment panel on it, and cropped picture fragments down one off-centre edge.
- **DP-59 — The working screens.** Working screens carry the same type and palette as the home page, with flat bone ground, stone panels, one green button per screen, plain tables with tabular figures, strata told apart by weave and printed name as well as colour, and outage copy as flat text in a stone band.
- **DP-60 — Real wiring.** The source reads every service credential and address from the environment, calls the two providers, MinIO, Mailpit and Gotenberg for real, works every published sum in exact decimals, and bundles its typefaces and generated imagery.

## Frontend

### Screens and layout (DP-04, DP-09, DP-10, DP-15, DP-20, DP-25, DP-30, DP-34, DP-40, DP-44, DP-47, DP-53, DP-55)

Every screen publishes a level-one heading and a page title, and none scrolls sideways at 375x812, 768x1024 or 1280x800. A page title is always `<heading> — Fio Contado Desk`.

| Address | Who | Level-one heading |
|---|---|---|
| `/` | public | `Count every thread of a garment's footprint.` |
| `/method` | public | `How a footprint is worked out` |
| `/questions` | public | `Questions` |
| `/sign-in` | public | `Sign in` |
| `/sign-up` | public | `Start a desk` |
| `/p/<gtin>`, `/p/<gtin>/e/<n>` | public | the edition's style name, or the withdrawn copy |
| `/a/<token>` | private address | the answer page heading in its language, or the ended copy |
| `/s/<token>` | private address | `Sign off <style name>`, or the ended copy |
| `/styles` | signed in | `Styles` (where sign-in lands) |
| `/styles/<id>` | signed in | the style's name |
| `/styles/<id>/materials` | signed in | `Materials for <style name>` |
| `/styles/<id>/scenarios` | signed in | `Scenarios for <style name>` |
| `/labels` | signed in | `Labels` |
| `/labels/<id>` | signed in | the label's name |
| `/requests` | signed in | `Requests` |
| `/visits` | signed in | `Visits` |
| `/visits/<id>` | signed in | `Visit to <factory name>` |
| `/passports` | signed in | `Passports` |
| any other address | public | `We couldn't find that page.` |

The document request itself answers the status: 404 for an unknown or erased address, 410 for an ended private page or a withdrawn passport, so the server sets status, `lang` and `dir` before any script runs. A signed-out visit to a signed-in address goes to `/sign-in?next=<address>`, and signing in returns there.

**Signed-in frame.** From 1100 px wide a side rail holds the links Styles, Labels, Requests, Visits and Passports and a Sign out button. Below 1100 px (so also at 1024x768, 768x1024 and 375x812) a top bar holds a `Menu` button that opens a sheet holding the same controls.

**Main actions at 375x812.** Each screen's main action sits in a bar fixed to the bottom: `/` `See the method`, `/sign-in` `Sign in`, `/sign-up` `Start a desk`, `/styles` `New style`, `/styles/<id>` `Work out footprint`, materials `Add material`, scenarios `Save scenario`, `/labels` `New label`, `/labels/<id>` `Rename label`, `/requests` `New request`, `/visits` `Book visit`, `/visits/<id>` `Record reading`, `/a/<token>` `Next` and `Back` (or `Send answers` on the last step), `/s/<token>` `Sign off`. `/method`, `/questions`, passport pages and `/passports` have no main action and no bar.

**Public pages.**
- **Home:** the hero, then the Try one garment panel on the green stage, then one column of two-line statements each beside a cropped picture fragment, including the section that pins the strata fragment while three statements each choose another measure, then the label-name strip.
- **Method:** one section per stage, with a level-two heading for each of Materials, Making, Transport, Use and End of life and a section on the six measures. The stages sit five side by side from 1100 px wide, in two columns from 768 to 1099 px wide (so at 1024x768 and 768x1024), and in one column below 768 px (so at 375x812).
- **Questions:** one column of accordions.

**Styles.** Filters above a plain table in a scrolling frame with columns Style (a link named the style's name), Label, Season, State, Suppliers, Climate and Actions, then a `Next page` button. At 375 the table scrolls sideways inside its frame.

**Style.**
- A header with the label, GTIN, garment and state, and links `Materials` and `Scenarios`.
- The footprint panel: edition, data quality, measures composite, strata band, figures and total.
- The score panel, dossier panel and passport panel.
- `Earlier results`, a list of links to `/styles/<id>?result=<result id>`, which show that result exactly as it was.

With no result yet, the footprint panel is an empty state: a cropped fragment showing `Work out footprint` as the first action.

**Materials.** A list of lines with position, material, shown mass, fibre shares, tiers and line controls, then a list of transport legs.

**Scenarios.** Change controls for each line and leg, the band with its ghost band, a `Comparison` table in its own frame, then saved scenarios by name. At 375 the table scrolls sideways inside its frame.

**Labels.**
- `/labels` is a table of labels with name, state and contact, plus `New label` and `Change password`.
- `/labels/<id>` shows the contact, suppliers with their contacts, styles, and the state with the erase date when closed, plus `Rename label`, `Delete label`, `Close label` or `Bring back`.

**Requests.** A table with Supplier, Style, Language, Town, Due, State and row controls. An expanded row shows the answer and its evidence.

**Visits.** A diary grouped by Lisbon date, each group heading showing the date and, on a day that does not have 24 hours, its hours.

**Visit.** Both times, the waiting line, the reading form and a table of recorded readings, one column at every width.

**Passports.** A table with one row per edition: style, GTIN, edition, state, published date and a link to `/p/<gtin>/e/<n>`. `Withdraw <style name>` shows only on the newest edition's row while it is published, and it withdraws every edition.

**Answer page.** One column built for 375x812: heading, intro, due line, step rail, the current step's fields, then the bottom bar. At wider sizes the same column sits against the left margin (the right margin in Arabic) and the bottom bar's buttons stay in the same fixed bar.

**Sign-off page.** Heading, the dossier's figures, edition and data quality, the `Read the dossier` link, the `Your name` field and `Sign off`.

**Passport.** Heading, language links, label, garment, the six measures, score, factor edition, data quality, edition line and claim note, one column at every width.

### Public screens and controls (DP-05, DP-06, DP-07, DP-08, DP-13, DP-17, DP-18, DP-26, DP-32, DP-37, DP-38, DP-41, DP-45, DP-49, DP-55, DP-56)

Only these are public; everything else is free. Every screen, including private and public pages, has one polite live region: `status` named `Announcements`.

| Screen | Role and accessible name | Notes |
|---|---|---|
| Home | `button "Skip intro"` | intro only; intro element marked `data-part="intro"` |
| Home | `link "See the method"` | green fill |
| Public header | a `banner` holding `button "Explore"` with aria-expanded; `link "Method"`, `link "Questions"`, `link "Sign in"` | below 768 px only `Explore` and the brand show |
| Mega menu | `navigation "Explore"` from 768 px, `dialog "Explore"` below; links `The five stages`, `Six measures`, `Questions`, `Try one garment`, `Sign in`, `Start a desk` | link tiles only, no buttons |
| Home | `region "Labels on the desk"` marked `data-part="label-strip"` | focusable while it loops |
| Home | `region "Try one garment"`; `radiogroup "Garment"` with radios `T-shirt`, `Shirt`, `Jeans`, `Coat`; `combobox "Main fibre"` with `Organic cotton`, `Cotton`, `Polyester`, `Wool`; `combobox "Making country"` with `Portugal`, `Turkey`, `Vietnam`, `Egypt` | figure marked `data-part="estimate-figure"`; native selects count |
| Questions | `button` per question with aria-expanded, slugs under Interactions | |
| Sign-in | `textbox "Email"`; a masked password input labelled `Password`; `button "Sign in"` | a password input has no textbox role, so it is located by its label |
| Sign-up | textboxes `Name`, `Email`; a masked password input labelled `Password`; `button "Start a desk"` | located as on Sign-in |
| Signed-in frame | `button "Menu"`, `dialog "Menu"`, links `Styles`, `Labels`, `Requests`, `Visits`, `Passports`, `button "Sign out"` | |
| After session end | `link "Sign in again"` | |
| Forms | `region "Problems"` holding one link per field error | |
| Styles | `combobox "Label"`, `"Season"`, `"State"`, `"Sort by"` with options `Name`, `Climate figure`; `searchbox "Search styles"`; `button "New style"`; `button "Bring in catalogue"`; `button "Next page"`; `region "Styles table"` (focusable frame) | |
| Styles rows | `button "Actions for <style name>"`, `menu`, menuitems `Open`, `Duplicate`, `Archive` | |
| `dialog "New style"` | `Label`, `Name`, `Style code`, `Season`, `GTIN`, `Garment`, `Washes`, `Repair service offered`, `Range size`, `Notes`; `button "Save style"`, `button "Close"` | |
| `dialog "Bring in catalogue"` | `Label`, `Catalogue file`; `button "Preview"`, `button "Save catalogue"`, `button "Close"`; `table "Catalogue preview"` | |
| Materials | `button "Add material"`, `button "Add leg"`; per line `button "Move up"`, `button "Move down"`, `button "Edit"`, `button "Remove"` in a `listitem` named the material; per leg `button "Remove leg"` | |
| `dialog "Add material"` (or `"Edit material"`) | `combobox "Material"` with `listbox "Materials"`; `radiogroup "How to give the mass"` with `Fabric weight and area`, `Plain mass`; `Fabric weight (g/m²)`, `Area (m²)`, `Mass (g)`; `Fibre 1 name`, `Fibre 1 share (%)`, `button "Add fibre"`; `Tier 1 factory`, `Tier 1 town`, `Tier 1 country`, and the same for tiers 2 and 3; `button "Save material"`, `button "Close"` | full-height sheet below 768 px |
| `dialog "Add leg"` | `Mode`, `Distance (km)`; `button "Save leg"`, `button "Close"` | |
| Requests | `button "New request"`; per row `button "Show answer for <supplier>"`, `button "New address for <supplier>"`, `button "End page for <supplier>"`; in an expanded row `button "Download evidence <n> for <supplier>"` per evidence file; `region "Requests table"` | `<n>` counts from 1 in the order of the answer's `evidenceIds` |
| `dialog "New request"` | `Style`, `Material line`, `Supplier`, `Contact name`, `Contact email`, `Town`, `Language`, checkboxes `Energy`, `Water`, `Fibre origin`, `Due date`; `button "Send request"`, `button "Close"` | |
| Answer page | `group` named by the steps copy, buttons per step with `aria-current="step"`; field labels, `button` Unit, `dialog` Unit with radios; `button` Next, Back, Send answers; file input | names from the copy table |
| Visits | `button "Book visit"`; `dialog "Book visit"` with `Factory`, `Label`, `Town`, `Date`, `Local time`, `button "Save visit"`, `button "Close"` | |
| Visit | `Meter`, `Reading`, `Unit`, `button "Record reading"`; waiting line marked `data-part="waiting-line"`; `button "Keep mine"`, `button "Keep recorded"` in the lower-reading dialog named by its question | |
| Style | `button "Work out footprint"`, `button "Check for newer factors"`, `button "Ask for score"`, `button "Make dossier"`, `button "Download dossier"`, `button "Download results file"`, `button "Send sign-off page"`, `button "Publish passport"` (reads `Publish correction` once published) | |
| Style strata | `radiogroup "Measure"` with radios `Climate`, `Water`, `Fossil energy`, `Land use`, `Freshwater toxicity`, `Microfibres`; `dialog "Factors for <stage>"` with `button "Next stage"`, `button "Close"` | |
| Scenarios | `slider "Recycled share for <material>"`; `combobox "Material for <material>"`, `"Factory country for <material>"`, `"Mode for leg <n>"`; `region "Comparison"` (focusable frame); `button "Save scenario"`; `dialog "Save scenario"` with `Name`, `button "Save"`, `button "Close"` | |
| Labels | `button "New label"`, `button "Change password"`, `region "Labels table"`; on a label `button "Rename label"`, `button "Delete label"`, `button "Close label"`, `button "Bring back"` | |
| `dialog "New label"` | textboxes `Name`, `Contact name`, `Contact email`; `button "Save label"`, `button "Close"` | |
| `dialog "Rename label"` | `textbox "Name"`; `button "Save name"`, `button "Close"` | |
| `dialog "Delete label"` | `button "Delete"`, `button "Keep"` | |
| `dialog "Close label"` | `button "Close this label"`, `button "Keep open"` | |
| `dialog "Bring back"` | `button "Bring back label"`, `button "Keep closed"` | |
| `dialog "Change password"` | masked password inputs labelled `Current password` and `New password`; `button "Save password"`, `button "Close"` | located by label, as on Sign-in |
| Passports | `region "Passports table"`, per row `link "<style name> edition <n>"`, `button "Withdraw <style name>"`, `dialog "Withdraw passport"` with `button "Withdraw"`, `button "Keep"` | the button shows only as Passports describes |
| Passport | `navigation "Language"` with links `English`, `Français`, `Türkçe`, `العربية` | |
| Sign-off | `link "Read the dossier"`, textbox `Your name`, `button "Sign off"` | |

**Options and typed forms.** A native select counts as a combobox. Each option is printed as its visible name, then its API value.

| Control | Role | Options or typed form |
|---|---|---|
| `Garment` | combobox | `T-shirt` `tshirt`, `Shirt` `shirt`, `Jeans` `jeans`, `Coat` `coat` |
| `Repair service offered` | combobox | `Not stated` `null`, `Yes` `true`, `No` `false` |
| `Label` in a dialog | combobox | each open label's name, its id |
| `Label` filter | combobox | `All labels` (no parameter), then each label's name, its id |
| `Season` filter | combobox | `All seasons` (no parameter), then each season on the desk, its own text |
| `State` filter | combobox | `All states` (no parameter), `Draft` `draft`, `Worked` `worked`, `Published` `published`, `Archived` `archived` |
| `Sort by` | combobox | `Name` `name`, `Climate figure` `climate` |
| `Style` | combobox | each unarchived style's name, its id |
| `Material line` | combobox | each line of the chosen style as `<material> (line <position>)`, its id, for example `Organic cotton (line 1)` |
| `Language` | combobox | `English` `en`, `French` `fr`, `Turkish` `tr`, `Arabic` `ar` |
| `Town` | combobox | `Porto` `porto`, `Izmir` `izmir`, `Ho Chi Minh City` `hoChiMinhCity`, `Cairo` `cairo` |
| `Mode`, `Mode for leg <n>` | combobox | `Sea` `sea`, `Road` `road`, `Rail` `rail`, `Air` `air` |
| `Tier 1 country`, `Tier 2 country`, `Tier 3 country` | combobox | `Not known yet` `null`, `Portugal` `PT`, `Turkey` `TR`, `Vietnam` `VN`, `Egypt` `EG`, `India` `IN`, `Bangladesh` `BD` |
| `Factory country for <material>` | combobox | the six countries above, without `Not known yet` |
| `Material for <material>` | combobox | the twelve material names and ids from the table in Services |
| `Unit` on the visit page | combobox | `kWh` `kWh`, `MJ` `MJ`, `m³ of natural gas` `m3` |
| `Due date`, `Date` | textbox, no date picker | typed as `YYYY-MM-DD`, for example `2027-03-29` |
| `Local time` | textbox | typed as 24-hour `HH:MM`, for example `07:20` |

`<n>` in `Mode for leg <n>` counts from 1, so the first leg's control is `Mode for leg 1`, while `legIndex` and the `mode=` address value count from 0. A tier whose factory and town are empty and whose country is `Not known yet` is sent as `null`. The answer page's origin field is a combobox of the copy table's country names in the page's language, with the same country codes as values.

Machine-readable marks on the strata:
- A band is marked `data-part="strata"`.
- Each stratum is marked `data-part="stratum"`, `data-stage` (`materials`, `making`, `transport`, `use`, `endOfLife`) and `data-share` (the share in percent with one decimal).
- Each stage's printed figure is marked `data-part="stratum-figure"` and `data-stage`.
- The total is `data-part="total-figure"`, and the marker is `data-part="hotspot-marker"` with `data-stage` naming the hotspot.
- On Scenarios the baseline band's strata are `data-part="ghost-stratum"`.
- Every picture fragment on the home page is marked `data-ui` and is aria-hidden with no focusable control. The Try one garment panel is also marked `data-ui` but is the one working fragment.

### Interactions (DP-05, DP-06, DP-07, DP-08, DP-12, DP-13, DP-17, DP-18, DP-26, DP-32, DP-38, DP-41, DP-55, DP-56)

**Intro.** The sequence and timing are in Motion and effects. `Skip intro` holds focus from the first frame, and Escape or that button ends it at once. However it ends, focus moves to the level-one heading.

**Label strip.** The strip names are in Seed data. It loops from 768 px wide, pauses while hovered or focused, stops under reduced motion and at 375x812 wraps into rows with no sideways scroll and no loop.

**Mega menu.**
- It opens on press of `Explore`. Escape closes it from any tile and from its opener with focus back on the opener, and a press or focus outside closes it.
- From 768 px focus stays on the opener and Tab enters the tiles.
- Below 768 px it is a sheet from the top that leaves a band of page to tap, with focus on the first tile, kept inside by Tab and Shift+Tab.

**Navigation links and header.** A hand-drawn underline grows under each navigation link on hover and on keyboard focus alike. The header is see-through at the top and turns solid surface once the page has scrolled 24 px.

**Questions.** The question slugs are `who-is-it-for` (`Who is the desk for?`), `legal-claim` (`Does the desk make a legal claim?`), `factors` (`Where do the factors come from?`), `supplier-accounts` (`Do suppliers need an account?`), `poor-signal` (`What happens with poor signal?`) and `shopper` (`What does a shopper see?`). `legal-claim` answers `No. The desk stores, converts units, works out published sums and shows what the providers answered. It gives no compliance advice.` Other answers are free text in that voice. The open question is `?q=<slug>`, and closing it removes the parameter. Each change is one history entry that Back and Forward return to.

**Try one garment.** It starts on T-shirt, Organic cotton, Portugal unless the address says otherwise. The address reads `/?garment=<id>&fibre=<id>&country=<id>`, and a choice replaces the current history entry. After a 300 ms pause since the last change the figure answers in place. An answer to an earlier choice is ignored.

**Styles.** The address holds `label`, `season`, `state`, `sort`, `q` and `cursor` with the same values as the API. A filter or sort choice is committed on selection, a search on Enter or on leaving the field, and `Next page` on press. Each committed change is one history entry. Back from a style restores the filters, sort, page and scroll position, and once the list has loaded focus lands on the link of the style just left.

**Row menu.** Enter or press opens it with focus on `Open`. Up and Down move, Escape closes with focus on its button, and a press outside closes it. It shows above the frame and inside the viewport, even on the last row.

**Material lines.**
- With focus on any control in a line, Alt+Up and Alt+Down move the line. At 375 only the buttons exist.
- Focus stays on the moved line's same control.
- `Move up` on the first line and `Move down` on the last stay in the Tab order with aria-disabled="true", never the disabled attribute, and pressing them does nothing.
- While a move's request is open the button reads `Working…` with aria-disabled="true" rather than the disabled attribute, so a move never loses focus.

**Combobox.** Typing searches through `GET /api/materials?q=` after a 300 ms pause, Up and Down move the active option, Enter picks it, and Escape closes the list. An absent or empty `q` returns all twelve materials in the table's order, and any other `q` returns those whose folded name holds it, in the same order. An answer to an earlier input is ignored.

**Measures composite.**
- It starts on Climate and has one Tab stop. Left and Right move and choose, Home and End jump, and at 375 Up and Down also move.
- Enter opens the factors popover for the chosen measure's hotspot stage. `Next stage` moves it through the five stages.
- With a pointer, pressing a stratum opens that stage's popover.
- The popover shows `Factor edition <edition>` and one line per kept factor row used in that stage for that measure, reading `<row name>: <value> <unit>`, for example `Turkey: 0.124 kg CO₂e per MJ`. `<value>` is the library's decimal string exactly as read, not rounded by the display rule.
- `<unit>` is the measure's unit (`kg CO₂e`, `L`, `MJ`, `points`, `CTUe` or `mg`) followed by `per kg` for material and endOfLife rows, `per MJ` for grid rows, `per tonne-km` for mode rows and `per wash` for the use row.
- `<row name>` is the material's name, the country's name, the mode's name from Options and typed forms, `Wash` or `Disposal`.
- A line whose Making Water figure comes from a supplier's answer adds no row.
- The popover fits uncut inside the viewport at 375 and 1280.

**Scenarios.**
- The slider runs 0 to 100 in steps of 5, and arrow keys step it.
- The address holds the changes as `recycled=<line id>:<percent>`, `material=<line id>:<material id>`, `factory=<line id>:<country>` and `mode=<leg index>:<mode>`, each repeatable.
- A change is committed once its 300 ms pause has ended, as one history entry, and Back restores it.
- An answer to an earlier input is ignored.

**Answer page steps.**
- The rail lists the questions asked, then Evidence and Send, as one composite with a single Tab stop and `aria-current="step"` on the current step.
- In left-to-right languages Right moves to the next step and Left to the previous. In Arabic Left moves to the next and Right to the previous. Home and End jump.
- At 375 each step also has Next and Back in the bottom bar.
- The Unit choice is a sheet of radio buttons sliding in from the right edge, or the left edge in Arabic.
- Number fields stay left to right in every language.

**Visit page.** The device saves each reading first and then tries to send it. Any request that does not reach the server counts as no network, whether the browser is offline or the request fails, and then the page stays in place with no error dialog. Every 5-second refresh tries the waiting readings in the order taken. A reading refused with 422 leaves the device and the waiting count and is not tried again, and on a refresh its copy is announced without moving focus. A lower reading met on a refresh opens its published dialog, which takes focus under SR8 and returns it to `Record reading`, and it stays in the waiting count until Keep mine or Keep recorded answers it. Any other refusal keeps the reading waiting for the next refresh. The later readings keep going in every case. A failing refresh never leaves the page.

**Focus after actions.**
- Landing on a new address moves focus to its level-one heading.
- Closing a dialog returns focus to its opener, or to the level-one heading if the opener is gone.
- A dialog opened by the server's answer, such as the lower-reading dialog, returns focus to `Record reading`.
- A button that stays has focus again when its text returns.

| Action | Address afterwards | Focus afterwards |
|---|---|---|
| `Sign in`, `Start a desk` | `/styles` (or the `next` address after `Sign in`) | level-one heading |
| `Save style`, `Duplicate` | `/styles/<new id>` | level-one heading |
| `Save label` | `/labels/<new id>` | level-one heading |
| `Save visit` | `/visits/<new id>` | level-one heading |
| `Delete` in `Delete label` | `/labels` | level-one heading |
| `Save name` | stays on `/labels/<id>` | `Rename label` |
| `Close this label`, `Bring back label` | stays on `/labels/<id>` | level-one heading, because the opener is gone |
| `Save password` | stays on `/labels` | `Change password` |
| `Save catalogue` | stays on `/styles`, dialog closed | `Bring in catalogue` |
| `Send request` | stays on `/requests`, dialog closed | `New request` |
| `Save material` | stays on the materials address, dialog closed | `Add material`, or the line's `Edit` when editing |
| `Save leg` | stays on the materials address, dialog closed | `Add leg` |
| `Record reading` | stays on `/visits/<id>` | `Record reading` |
| `Save` in `Save scenario` | stays on the scenarios address, dialog closed | `Save scenario` |
| `Work out footprint`, `Ask for score`, `Make dossier`, `Send sign-off page`, `Publish passport` | stays on `/styles/<id>` | the pressed button |

**Session end.** When any request answers 401 session_ended, an open dialog stays as typed, the session-end copy is announced and the `Sign in again` link shows in a band. The typed draft and which dialog was open stay on the device. Signing in returns to the same address with the dialog open and the draft kept.

**Screen rules.**

- **SR1.** Every signed-in screen, the answer page and the sign-off page re-read their data from the server every 5 seconds while open, and a refresh changes only what changed, in place. Focus stays on the same control. An open dialog, sheet, menu or popover stays open with what was typed and does not play its opening again. A refused dialog keeps its message. An open accordion stays open, an expanded row stays expanded, and the scroll position stays.
- **SR2.** Closing a dialog, sheet or popover (Escape, its Close button or a tap outside a sheet) returns focus to the control that opened it at once and leaves the page behind usable at once while the closing animation still runs. Pressing that control again during the closing animation opens it again, which no leftover close timer may undo.
- **SR3.** Under reduced motion every dialog, sheet, menu, popover and accordion opens and closes at once (a closed one is gone from the screen and the accessibility tree within 100 ms), every loop stops, and every sequence shows its end state at once with the same function.
- **SR4.** At 375x812 every control offers a touch area of at least 44 by 44 CSS pixels: buttons, links (including links in list rows, table cells and back links), form fields, file inputs, menu items, accordion headers and the label of each radio and checkbox. Links inside a sentence of running text are the only exception.
- **SR5.** An automated WCAG check at WCAG 2.2 AA (axe-core, tags wcag2a, wcag2aa, wcag21aa, wcag22aa) reports no violation on every screen at 375x812 and 1280x800 with its dialog or sheet open and closed. A wide table at 375 scrolls sideways inside its own frame, and that frame takes keyboard focus and has an accessible name.
- **SR6.** At 375x812 each screen's main action sits in a bar fixed to the bottom, and a control that receives focus by Tab or tap is scrolled fully into view between the top bar and the bottom bar.
- **SR7.** All motion is CSS transitions, CSS animations or element animations with exactly the durations 160, 320 and 640 ms, plus 64 seconds for one pass of the label-name strip, never frames timed by script and never any other duration, including library defaults.
- **SR8.** Every Tab stop shows a visible focus ring. Opening a dialog or sheet moves focus inside it to its first field (otherwise its first control) on every opening, not only the first. Every dialog and sheet keeps Tab and Shift+Tab inside it (a native dialog element alone does not), closes on Escape even when it holds only links, and returns focus to its opener.
- **SR9.** A closed accordion panel, menu, sheet or popover is hidden and inert. Its controls leave the Tab order the moment it starts closing, and it leaves the accessibility tree when its closing animation ends. Collapsing to zero height or moving off-screen is not closing.
- **SR10.** Pointer and touch behaviour follow each event's pointer type, never hover or pointer media queries.
- **SR11.** While a button's request is open its visible text and its accessible name both read `Working…` (the answer page uses its language's copy) and it is disabled, by the disabled attribute or aria-disabled="true", and it reads its own name again afterwards. `Record reading` saves on the device at once and the download buttons hand over to the browser, so neither reads `Working…`.
- **SR12.** When an action closes a dialog or removes the control that opened it, focus moves to the screen's level-one heading if that control is gone, otherwise back to that control, and stays there through the following refresh and any list reload.
- **SR13.** A menu, popover, date picker or combobox list opened inside a scrolling frame or at the end of a list is never cut off: every one of its items is fully on screen and can be pressed where it shows, at 375 and 1280.
- **SR14.** Every screen prints the same characters whatever the browser's language, time zone and clock. Opened with German as the language, Pacific/Auckland as the zone and a device clock three days ahead, the same address shows the same visible text, because every date, number, count and time-dependent state is formatted in the published form and decided by the server.
- **SR15.** At 320x568 no page scrolls sideways (only the published frames do), and a name of up to 80 characters with no spaces wraps wherever it prints.
- **SR16.** No text is ever cut off, with an ellipsis or by clipping, on any screen at 375x812 or 1280x800, also with text spacing overridden (line height 1.5, letter spacing 0.12em, word spacing 0.16em, paragraph spacing 2em). The home page's aria-hidden picture fragments, a rolling numeral's mask while it moves and, from 768 px wide, the label-name strip's names at the edges of its frame, whether the strip is looping, paused or stopped, are the only exceptions.
- **SR17.** At 812x375 every screen works: an open dialog or sheet scrolls inside itself so that each of its controls can be reached, and no bar covers the focused control.
- **SR18.** The Announcements region is on the page from first paint, before any action, and one message made twice in a row is announced twice (the region's content changes each time).
- **SR19.** When one refresh fails (network or a 5xx) everything on the screen stays where it is, focus stays, no dialog opens, and the single line `Couldn't refresh. Trying again.` (the answer page uses its language's copy) shows directly under the level-one heading, marked `data-part="refresh-line"`, until the next good refresh clears it. On the visit page the waiting line does this job and no refresh line shows.
- **SR20.** Escape closes only the innermost open thing: a combobox list, menu or popover inside a dialog closes first, and the dialog stays open with focus inside it.
- **SR21.** Turning reduced motion on or off while a page is open applies from the next animation, with no reload.

**How each journey is checked.** Every workflow's journey requirement other than desk access names five checks on its own screen.
1. One screen-rules check on its own main screen and main write endpoint: one request breaking two published rules answers the earlier error of the ladder, its response instants read as whole-second Z, the session cookie's attributes are read, and SR1 to SR21 are walked with its dialog, sheet, menu, popover or accordion.
2. A keyboard-only journey with the published focus targets.
3. A 375x812 touch journey, with closed sheets hidden and inert and no bar covering the focused control.
4. Its rare-state copy verbatim with the name and local time.
5. Its own precision rule.

In the keyboard and touch journeys every write action also checks SR8 focus on opening, SR11 `Working…`, SR12 focus afterwards and its Announcements copy, and every refused form checks its Problems links.

### Visual design (DP-58, DP-59)

**Direction.** The product performs: the page shows the working desk rather than talking about it. The mood is exact (every figure on screen is a real worked result with its unit and edition), calm (light headlines stay modest and left-aligned on flat bone with no decoration) and tactile (the only texture is the generated weave inside each stratum). Density is comfortable.

**Type.** Display and body are both Sora, with headlines in its light weight. Each heading step is a quarter larger than the step below it. Interface text is compact, a little smaller than running body text. Arabic copy and any glyph Sora lacks (the subscript 2 and superscripts in CO₂e and powers of ten) fall back to Noto Sans Arabic and Noto Sans. All three are bundled with the app under the Open Font Licence and never loaded from anywhere at runtime. Digits sit in fixed-width tabular slots so rolling never shifts the line.

**Palette.**
- The ground is a flat bone.
- Panels are a slightly deeper stone.
- Text is a near-black chocolate ink.
- Secondary text is a warm grey-brown.
- The one accent is a mat green with white text on it.

Green only ever appears as a fill with white text, because green text on bone falls just short of AA. Grey-brown text appears only on the bone ground, for the same reason on stone. Text on stone is always ink. Everything meets WCAG 2.2 AA contrast.

**Composition.** One off-centre left edge at a narrow margin carries a single column of five-sevenths rows, each a two-line statement beside one cropped working fragment (a material line, a strata band, a row action menu, a phone meter reading), varied in size. One home section pins the strata fragment in place while three short statements scroll past, each choosing another measure. Every fragment except the working Try one garment panel is a picture: nothing in it can be pressed.

**Hero.** The headline sits on two lines upper left with one sentence (`One desk for an independent assessor: supplier facts in, exact figures out, and a passport a shopper can read.`) and the green `See the method` button. A flat green stage spans the right two-thirds of the page from a little above halfway down, bleeds off the right and bottom edges, and has its top-left corner cut into a shirt-collar notch two columns wide. On it sits the working Try one garment panel, about half the page wide at 1280, with compact labels. The stage's bottom edge crops only the panel's decorative weave below the figure, so every control and the figure stay fully on screen and can be reached by scrolling. At 375 the stage runs full width with a smaller collar cut and the panel sits just inside it. Generated glyphs for fibres, factories and transport legs stand in for photographs, because all imagery is procedural or uploaded. The only garment imagery is the five generated weave patterns in the data band.

**Working screens.**
- They use the same type and palette: bone ground, stone panels, ink text, one green button per screen, compact interface text.
- Lists are plain tables with tabular figures and a focusable scrolling frame, separated by spacing and stone bands rather than ruled grids.
- Forms show one column of labelled fields above a Problems summary.
- Empty states are a cropped fragment showing the first action with a real label.
- Loading keeps the last figures in place.
- Outage and error copy sits as flat text in a stone band with its published wording and no alarm icon.
- Controls have barely rounded corners and are at least 44 px tall to tap comfortably. Strata and bars are square. A small cut corner appears only on the hero stage and the small tabs heading sections, never on a focusable control, because it would cut the focus ring.
- Strata are told apart by weave pattern and printed stage name as well as colour.

### Motion and effects (DP-05, DP-06, DP-07, DP-08, DP-37, DP-54)

Motion starts quickly and settles softly, and every duration comes from the set in SR7. There are no unnamed decorative loops: the label-name strip is the only loop.

- **Intro.** It plays over the home page. The product name draws in (640 ms), then three stage words `Materials`, `Making` and `Transport` appear one after another (320 ms each), and it ends by itself after 1600 ms.
- **Label strip.** One pass takes 64 seconds.
- **Accordion.** A question opens by height over 320 ms.
- **Underline and header.** The underline grows, and the header turns solid, in 160 ms.
- **Dialogs, sheets, menus and popovers.** They enter and leave within 160 or 320 ms. A closing one has already given focus back and already left the Tab order.
- **Rolling numerals.** The old figure moves one line up and out while the new one moves up into place, both starting together, in 320 ms. This applies to Try one garment and the strata figures.
- **Home strata fragment.** As each of the three statements reaches the pinned fragment it moves to that statement's measure in 320 ms, and it returns step by step when the user scrolls back.

**Signature: Stage strata.** The assessor sees at once which of the five stages carries a style's footprint for each of six measures, so a hotspot is read rather than hunted through tables. Each style shows one horizontal band of five strata in stage order with the figure of each stage printed with its stage name, and a hotspot marker. Choosing another measure:
1. moves the same elements (never redrawn or replaced): each stratum's width runs from its old share of the band to its new share in 320 ms;
2. rolls the numerals in 320 ms, starting together with the strata;
3. slides the hotspot marker from the old hotspot stratum to the new one in 640 ms;
4. on a third choice while they move, carries on from where they are, with no jump.

A refresh with no new data starts no motion and replaces no element. A refresh that brings a supplier's answer moves the strata in the same way and announces it. At 375 the strata stack vertically, each row's bar taking the share's width.

**Reduced motion.** Everything changes at once with the same figures, shares, hotspot marker, popover and announcements. The intro never plays, the strip stops, and every sequence shows its end state at once.

### Feedback states (DP-04, DP-11, DP-14, DP-16, DP-19, DP-23, DP-24, DP-25, DP-27, DP-29, DP-32, DP-33, DP-35, DP-39, DP-41, DP-43, DP-46, DP-48, DP-49, DP-50, DP-51, DP-56)

**General rules.**
- Pending: the pressed button follows SR11.
- Every async action announces its exact copy in `Announcements`, including the rare states.
- Announcements and Problems summaries stay until the next action.
- Every form error also appears in a Problems summary whose links move focus to their fields, and each such field carries aria-invalid="true". Pressing an action that a form refuses moves focus to that summary (the region or anything inside it), whether the browser or the server refused it, in place of the button keeping focus. A refusal with no `fields` shows its copy as plain text in the summary, with no link and no aria-invalid field.
- A dialog refused by the server stays open as typed with focus on the message, shown in its own Problems summary inside the dialog.

**Placeholders.**
- `<time>` is 24-hour `HH:MM` wall time of the town named, or Lisbon where the copy says Lisbon.
- `<date>` is the form `Mon 29 Mar 2027` on the local date of the town named, or Lisbon when none is named.
- `<name>`, `<supplier>`, `<factory>`, `<material>`, `<contact>` and `<style>` are the record's own text.
- `<material>` is the material's name from the table in Services.
- Date-times on screen read `Mon 29 Mar 2027, 05:20 Lisbon time`. Visits read `Mon 29 Mar 2027, 07:20 Izmir time · 05:20 Lisbon time`.

**Announcements for each action.**

| Action | Success copy |
|---|---|
| Change password | `Password changed.` |
| New label / rename / delete | `Label <name> added.` / `Label renamed to <name>.` / `Label <name> deleted.` |
| Close label | `Label <name> closed. It will be erased on <date>, <time> Lisbon time unless you bring it back.` |
| Bring back / erased on a refresh | `Label <name> is back.` / `Label <name> erased.` |
| New style / Duplicate | `Style <name> added.` (the copy's name for Duplicate) |
| Archive | `Style <name> archived.` |
| Filter, sort, search or page | `<n> styles shown.` (`1 style shown.` for one) |
| Catalogue preview / save | `Preview ready: <n> new, <m> matched, <r> refused.` / `Catalogue saved: <n> new, <m> matched, <r> refused.` |
| Add / edit / remove a line | `<material> added.` / `<material> saved.` / `<material> removed.` |
| Move a line | `<material> moved to position <p> of <t>.` for example `Organic cotton moved to position 2 of 4.` |
| Add / remove a leg | `Transport leg added.` / `Transport leg removed.` |
| Send request / new address / end page | `Request sent to <supplier>.` / `New address sent to <supplier>.` / `Page ended for <supplier>.` |
| An answer arrives on a refresh | `<supplier> answered at <time> <town> time.` with the supplier's town |
| Book visit | `Visit to <factory> booked.` |
| Reading recorded | `Reading for meter <n> recorded.` |
| Work out footprint | `Footprint worked out with edition <edition>.` |
| Choose a measure | `<measure>: <total shown>, hotspot <stage>.` |
| Check for newer factors | the newer-factors copy, or `No newer factors.` |
| Scenario totals / save | `Scenario climate total <total shown>.` / `Scenario <name> saved.` |
| Ask for score | the score line below |
| Publish / correct / withdraw | `Passport edition <n> published.` / `Passport edition <n> published.` / `Passport for <style> withdrawn.` |
| Make dossier / send sign-off / sign | `Dossier ready.` / `Sign-off page sent to <contact>.` / `Signed off by <name>.` |
| Downloads | `Dossier downloaded.` / `Results file downloaded.` / `Evidence downloaded.` |
| Try one garment | the figure, for example `1.01 kg CO₂e` |

**Refusals and rare states.** The API's `error.message` carries the same copy.

| Situation | Copy |
|---|---|
| GTIN wrong check digit | `That GTIN's check digit should be <d>.` |
| GTIN not 13 digits | `A GTIN has 13 digits.` |
| Empty required field | `Give a value here.` |
| Style code taken | `That style code is already in this label.` |
| Catalogue header wrong | `The first row must be styleCode,name,season,gtin.` |
| Catalogue row reasons | the GTIN copies above, `A name is needed.`, `A season is needed.`, `This style code is already on row <n>.` |
| Fibres off | `The fibres add up to <x>%. They must add up to 100.0%.` with `<x>` to one decimal |
| Fibre share form | `Give each fibre share with one decimal.` |
| Mass form | `Give a fabric weight and area, or a plain mass.` |
| Style changed, by an answer | `This style was changed at <time> Lisbon time by <supplier>'s answer. Your changes are still here.` |
| Style changed, otherwise | `This style was changed at <time> Lisbon time elsewhere. Your changes are still here.` |
| Archived style / closed label | `This style is archived.` / `This label is closed. Bring it back first.` |
| Archive with a live passport | `Withdraw the passport before archiving.` |
| Line already at the end | `That line is already at the end.` |
| Too many requests | `Too many requests for now. You can send another at <time> Lisbon time.` |
| Too many downloads | `Too many downloads for now. You can download another at <time> Lisbon time.` |
| Date form | `Give the date as YYYY-MM-DD.` |
| Time form | `Give the time as HH:MM.` |
| Due date past | `The due date must be today or later in <town>.` |
| Request already answered | `This request has been answered.` |
| Skipped visit time | `That time doesn't exist in <town> on <date> because the clocks change.` for example `That time doesn't exist in Porto on Sun 28 Mar 2027 because the clocks change.` |
| Offline, waiting line | `Offline — <n> readings waiting on this device.` (`Offline — 1 reading waiting on this device.` for one) |
| Online, still sending | `Sending — <n> readings waiting on this device.` (`Sending — 1 reading waiting on this device.` for one) |
| Online, none waiting | `All readings sent.` |
| Sign out with readings waiting | `<n> readings are still waiting. Go back online to send them first.` (`1 reading is still waiting. Go back online to send it first.` for one) |
| Lower reading, dialog name and text | `Meter <n> reads lower than <lastValue> <unit> recorded at <time> <town> time. Keep which?` with `<lastValue>` in full with comma grouping, for example `Meter 2 reads lower than 14,320 kWh recorded at 14:32 Izmir time. Keep which?` |
| Meter unit differs | `Meter <n> reads in <unit>.` |
| No lines / no tier 1 country | `Add a material line first.` / `Tier 1 country is missing for <material>.` |
| Library unreachable | `The factor library is unavailable right now. The last result stays.` |
| Newer edition in effect | `Newer factors available (<edition>).` |
| Stale baseline | `The baseline was worked out again at <time> Lisbon time. Your scenario is still here.` |
| Score shown | `Score <score> points (<per100g> per 100 g)` with comma grouping, for example `Score 1,240 points (412 per 100 g)` |
| Missing origin | `Fibre origin is missing for <material>.` |
| Worst-case facts | `Worst-case value used for repair service.` and `Worst-case value used for range size.` |
| Score busy | `The score service is busy. You can try again at <time> Lisbon time.` |
| Score unavailable | `The score service is unavailable right now. Nothing changed.` |
| Score stale | `Outdated` |
| Publish without current score | `Ask for a current score before publishing.` |
| GTIN taken | `A passport with this GTIN already exists.` |
| Dossier without result | `Work out the footprint first.` |
| Dossier service down | `The dossier service is unavailable right now. Nothing was saved.` |
| File store down | `The file store is unavailable right now. Nothing was saved.` |
| Newer dossier | `A newer dossier was made at <time> Lisbon time. Read it first.` |
| Already signed | `This dossier is already signed off.` |
| Sign-off name empty | `Type your name to sign off.` |
| Session ended | `Your session ended. Sign in again to keep going — what you typed is still here.` |
| Wrong sign-in | `That email and password don't match.` |
| A refresh failed | `Couldn't refresh. Trying again.` |

Dossier states read `Making`, `Ready`, `Signed off by <name> on <date>` and `Replaced`. Label states read `Open`, `Closed` and `Erased`. Request states read `Sent`, `Reminded`, `Answered` and `Ended`. Passport edition states read `Published` and `Withdrawn`. Style states read `Draft`, `Worked`, `Published` and `Archived`.

**Answer page copy table.** All of it renders character for character, and the sign-off page is English only. `<dueDate>` is `YYYY-MM-DD`, and `<town>` is the English town name in every language.

| Key | English | French | Turkish | Arabic |
|---|---|---|---|---|
| Heading | `Your answers` | `Vos réponses` | `Yanıtlarınız` | `إجاباتك` |
| Intro | `<labelName> asks about <styleName>.` | `<labelName> pose des questions sur <styleName>.` | `<labelName>, <styleName> hakkında soruyor.` | `تسأل <labelName> عن <styleName>.` |
| Due line | `Please answer by <dueDate> 23:59:59 <town> time.` | `Merci de répondre avant le <dueDate> 23:59:59, heure de <town>.` | `Lütfen <dueDate> 23:59:59 (<town> saati) tarihine kadar yanıtlayın.` | `يرجى الإجابة قبل <dueDate> 23:59:59 بتوقيت <town>.` |
| Steps group | `Steps` | `Étapes` | `Adımlar` | `الخطوات` |
| Step energy | `Energy` | `Énergie` | `Enerji` | `الطاقة` |
| Step water | `Water` | `Eau` | `Su` | `الماء` |
| Step fibre origin | `Fibre origin` | `Origine de la fibre` | `Elyaf kökeni` | `منشأ الألياف` |
| Step evidence | `Evidence` | `Justificatif` | `Kanıt belgesi` | `مستند داعم` |
| Step send | `Send` | `Envoi` | `Gönderim` | `الإرسال` |
| Energy field | `Energy per kg of finished goods` | `Énergie par kg de produit fini` | `Bitmiş ürünün kg'si başına enerji` | `الطاقة لكل كيلوغرام من المنتج النهائي` |
| Water field | `Water in litres per kg of finished goods` | `Eau en litres par kg de produit fini` | `Bitmiş ürünün kg'si başına litre su` | `الماء باللتر لكل كيلوغرام من المنتج النهائي` |
| Origin field | `Country of fibre origin` | `Pays d'origine de la fibre` | `Elyafın menşe ülkesi` | `بلد منشأ الألياف` |
| Unit button and sheet | `Unit` | `Unité` | `Birim` | `الوحدة` |
| Unit kWh | `kWh` | `kWh` | `kWh` | `kWh` |
| Unit MJ | `MJ` | `MJ` | `MJ` | `MJ` |
| Unit gas | `m³ of natural gas` | `m³ de gaz naturel` | `m³ doğal gaz` | `م³ من الغاز الطبيعي` |
| Close | `Close` | `Fermer` | `Kapat` | `إغلاق` |
| Next | `Next` | `Suivant` | `İleri` | `التالي` |
| Back | `Back` | `Retour` | `Geri` | `السابق` |
| Evidence field | `Evidence file (PDF, JPEG or PNG)` | `Justificatif (PDF, JPEG ou PNG)` | `Kanıt dosyası (PDF, JPEG veya PNG)` | `ملف المستند (PDF أو JPEG أو PNG)` |
| Send answers | `Send answers` | `Envoyer les réponses` | `Yanıtları gönder` | `إرسال الإجابات` |
| Working | `Working…` | `En cours…` | `İşleniyor…` | `جارٍ العمل…` |
| Sent | `Sent` | `Envoyé` | `Gönderildi` | `تم الإرسال` |
| Ended | `This page has ended.` | `Cette page est terminée.` | `Bu sayfanın süresi doldu.` | `انتهت هذه الصفحة.` |
| Number refused | `That number isn't in the form this page uses, for example 1,250.5.` | `Ce nombre n'est pas écrit comme il faut, par exemple 1 250,5.` | `Bu sayı doğru biçimde değil, örneğin 1.250,5.` | `هذا الرقم ليس بالصيغة الصحيحة، مثل ١٬٢٥٠٫٥.` |
| File type refused | `That file isn't a PDF, JPEG or PNG.` | `Ce fichier n'est ni un PDF, ni un JPEG, ni un PNG.` | `Bu dosya PDF, JPEG veya PNG değil.` | `هذا الملف ليس PDF أو JPEG أو PNG.` |
| File too big | `That file is over 5,000,000 bytes.` | `Ce fichier dépasse 5 000 000 octets.` | `Bu dosya 5.000.000 baytı aşıyor.` | `يتجاوز هذا الملف ٥٬٠٠٠٬٠٠٠ بايت.` |
| File store down | the file-store copy above | `Le stockage des fichiers est indisponible pour le moment. Rien n'a été enregistré.` | `Dosya deposu şu anda kullanılamıyor. Hiçbir şey kaydedilmedi.` | `مخزن الملفات غير متاح حاليًا. لم يُحفظ أي شيء.` |
| Problems | `Problems` | `Problèmes` | `Sorunlar` | `المشكلات` |
| Refresh failed | `Couldn't refresh. Trying again.` | `Actualisation impossible. Nouvel essai en cours.` | `Yenilenemedi. Yeniden deneniyor.` | `تعذر التحديث. جارٍ المحاولة مجددًا.` |
| Empty answer | `Give an answer here.` | `Répondez ici.` | `Buraya bir yanıt girin.` | `أدخل إجابة هنا.` |
| Country names (PT, TR, VN, EG, IN, BD) | `Portugal`, `Turkey`, `Vietnam`, `Egypt`, `India`, `Bangladesh` | `Portugal`, `Turquie`, `Viêt Nam`, `Égypte`, `Inde`, `Bangladesh` | `Portekiz`, `Türkiye`, `Vietnam`, `Mısır`, `Hindistan`, `Bangladeş` | `البرتغال`, `تركيا`, `فيتنام`, `مصر`, `الهند`, `بنغلاديش` |

The live region stays named `Announcements` in every language, and its text is in the page's language.

**Passport copy table.** Figures, units, the GTIN and `<date>` stay in their English form in every language.

| Key | English | French | Turkish | Arabic |
|---|---|---|---|---|
| Label | `Label` | `Marque` | `Marka` | `العلامة` |
| Garment | `Garment` | `Vêtement` | `Giysi` | `الملبس` |
| T-shirt, Shirt, Jeans, Coat | `T-shirt`, `Shirt`, `Jeans`, `Coat` | `T-shirt`, `Chemise`, `Jean`, `Manteau` | `Tişört`, `Gömlek`, `Kot pantolon`, `Kaban` | `قميص قصير`, `قميص`, `جينز`, `معطف` |
| Footprint | `Footprint` | `Empreinte` | `Ayak izi` | `البصمة` |
| Climate | `Climate` | `Climat` | `İklim` | `المناخ` |
| Water | `Water` | `Eau` | `Su` | `الماء` |
| Fossil energy | `Fossil energy` | `Énergie fossile` | `Fosil enerji` | `الطاقة الأحفورية` |
| Land use | `Land use` | `Usage des sols` | `Arazi kullanımı` | `استخدام الأراضي` |
| Freshwater toxicity | `Freshwater toxicity` | `Toxicité en eau douce` | `Tatlı su toksisitesi` | `سمية المياه العذبة` |
| Microfibres | `Microfibres` | `Microfibres` | `Mikrolifler` | `الألياف الدقيقة` |
| Score | `Score <score> points (<per100g> per 100 g)` | `Score <score> points (<per100g> pour 100 g)` | `Puan <score> (100 g başına <per100g>)` | `الدرجة <score> نقطة (<per100g> لكل 100 غ)` |
| Edition | `Edition <n>` | `Édition <n>` | `<n>. sürüm` | `الإصدار <n>` |
| Factor edition | `Factor edition <edition>` | `Édition des facteurs <edition>` | `Faktör sürümü <edition>` | `إصدار العوامل <edition>` |
| Data quality | `Data quality <grade> (<percent>%)` | `Qualité des données <grade> (<percent>%)` | `Veri kalitesi <grade> (%<percent>)` | `جودة البيانات <grade> (<percent>%)` |
| Corrected | `Corrected <date>` | `Corrigé le <date>` | `Düzeltildi: <date>` | `صُحِّح في <date>` |
| Withdrawn | `This passport has been withdrawn.` | `Ce passeport a été retiré.` | `Bu pasaport geri çekildi.` | `تم سحب هذا الجواز.` |
| Claim note | `These figures are published sums. They are not a legal claim.` | `Ces chiffres sont des sommes publiées. Ils ne constituent pas une affirmation légale.` | `Bu rakamlar yayımlanmış toplamlardır. Yasal bir iddia değildir.` | `هذه الأرقام مجاميع منشورة وليست ادعاءً قانونيًا.` |

## Backend

### API (DP-01, DP-02, DP-11, DP-12, DP-13, DP-14, DP-16, DP-17, DP-18, DP-19, DP-21, DP-22, DP-23, DP-27, DP-28, DP-29, DP-31, DP-32, DP-33, DP-35, DP-36, DP-39, DP-41, DP-43, DP-45, DP-46, DP-48, DP-49, DP-50, DP-51, DP-57)

**Conventions.**
- One key convention: camelCase in every JSON body and response, nested keys and every enum value included. Published provider ids, country codes and unit symbols stay as printed.
- Every decimal travels as a string.
- Every instant is UTC in whole seconds with a Z, for example `2027-03-29T04:20:00Z`, never milliseconds.
- Every error body is `{"error":{"code":"...","message":"...","fields":{"name":"..."}}}`, with `fields` only for field errors and always inside `error`.
- Each `error.fields` key is the request's own key. A nested key is a dot path, and an array index counts from 0. `error.message` on a field error is the first field's copy.
- Answer keys are `energy.value`, `energy.unit`, `water.value`, `fibreOrigin` and `evidenceIds`.
- Line keys are `materialId`, `fabricWeightGsm`, `areaM2`, `massGrams` (the mass-form copy), `fibres` (the fibres-off copy), `fibres.0.name`, `fibres.0.sharePercent`, and `tier1.factory`, `tier1.town` and `tier1.country`, with the same keys for tiers 2 and 3.
- Reading keys are `meter`, `value`, `unit` and `secondsAgo`. Request and visit dates use `dueDate` and `localDate`, and the visit time uses `localTime`.
- A catalogue header refusal carries no `fields`.
- Only the published endpoints exist.
- Ids are opaque strings. A malformed id behaves like an unknown one.
- Endpoints taking JSON require `application/json`, and an action with no fields also accepts an empty body.

**Precedence ladder, for the whole API.** Checks run in this order:
1. Unknown route or wrong method (404, 405 with Allow).
2. A body or file over its published size limit (413, decided before the body is parsed and before authentication, always answered as JSON, never a dropped connection).
3. Rate limit (429 with Retry-After in whole seconds). A request with no live session has no desk to count and goes on.
4. Authentication (401: `invalid_credentials`, `not_signed_in`, or `session_ended` for an ended session's cookie).
5. Unknown resource (404), or 410 for an ended private page or a withdrawn passport. A stored `Request-Key` response is replayed right after this step.
6. Content type (415).
7. Malformed JSON (400).
8. Field validation (422).
9. State (409).
10. A stale edit (412).

**Size limits.**
- Any JSON or text body: at most 1,000,000 bytes, with that size allowed.
- An evidence request: the file part at most 5,000,000 bytes (5,000,000 allowed, 5,000,001 refused), counted on the file alone and never on the multipart body, and the whole request at most 10,000,000 bytes (allowed at that size).

**Error codes.** `not_found`, `method_not_allowed`, `too_large`, `rate_limited`, `invalid_credentials`, `not_signed_in`, `session_ended`, `page_ended`, `withdrawn`, `unsupported_media_type`, `malformed_json`, `validation_failed` (with `fields`), `conflict`, `email_taken`, `key_reused`, `lower_reading` (with `lastValue` and `lastAt` beside `code`), `gtin_taken`, `newer_dossier`, `stale_edit`, `factor_library_unavailable`, `score_service_unavailable`, `score_service_busy` (with `busyUntil` beside `code`), `file_store_unavailable`, `dossier_service_unavailable`. A provider failure on one action answers 503, never 500. A label, style, line or other id of another desk, including an id inside a request body, answers 404 in the same shape as an unknown id, never 422.

**Desk access.**

| Method and path | Request | Success | Own errors |
|---|---|---|---|
| `GET /api/health` | | 200 `{"status":"ok"}` | |
| `POST /api/sign-up` | `{"name":"Ana Reis","email":"ana@example.test","password":"thread-count-2027"}` | 201 `{"assessor":{"id","name","email"}}`, signs in | 422, 409 `email_taken` |
| `POST /api/sign-in` | `{"email":"marta@fio-contado.example","password":"desk-pass-2027"}` | 200 `{"assessor":{...}}` | 401 |
| `POST /api/sign-out` | | 204 | 401 |
| `GET /api/session` | | 200 `{"assessor":{...},"endsAt":"..."}` | 401 |
| `POST /api/password` | `{"currentPassword":"desk-pass-2027","newPassword":"new-thread-2027"}` | 204, this session stays and every other ends | 401, 422 |

A password has at least 10 characters. The session cookie is named `fioSession`.

**Labels.**

| Method and path | Request | Success | Own errors |
|---|---|---|---|
| `GET /api/labels` | | 200 `{"labels":[Label]}` | |
| `POST /api/labels` | `{"name":"Porto Knit","contactName":"Rita Lopes","contactEmail":"rita@porto-knit.example"}` | 201 Label | 422 |
| `GET /api/labels/<id>` | | 200 Label with `suppliers:[{"id","name","town","townName","language","contactName","contactEmail"}]` | 404 |
| `PATCH /api/labels/<id>` | `{"name":"Porto Knit Studio"}` | 200 Label | 422, 409 |
| `DELETE /api/labels/<id>` | | 204 | 404 |
| `POST /api/labels/<id>/close` | | 200 Label | 409 unless open |
| `POST /api/labels/<id>/bring-back` | | 200 Label | 409 unless closed within the wait |
| `POST /api/labels/<id>/catalogue/preview` | `text/csv` body | 200 `{"rows":[{"row":2,"styleCode":"HT-02","name":"...","outcome":"new","reason":null}],"newCount":1,"matchedCount":0,"refusedCount":0}` | 415, 422 for the header |
| `POST /api/labels/<id>/catalogue/save` | same `text/csv` body | 200 `{"newCount":1,"matchedCount":0,"refusedCount":0}` | 415, 422 for the header, 409 closed |

Label is `{"id","name","contactName","contactEmail","state","closedAt","eraseAt"}`, with `state` one of `open`, `closed`, `erased`. Row `outcome` is `new`, `matched` or `refused`.

**Styles and lines.**

| Method and path | Request | Success | Own errors |
|---|---|---|---|
| `GET /api/styles?label=&season=&state=&sort=&q=&cursor=` | | 200 `{"styles":[StyleRow],"nextCursor":"..."}` or `null` | |
| `POST /api/styles` | `{"labelId":"<id>","styleCode":"HT-02","name":"Harbour Tee Two","season":"AW27","gtin":"4006381333931","garment":"tshirt","washes":30,"repairService":true,"rangeSize":5000,"notes":"Ask about dye house."}` (only `labelId`, `name`, `season`, `gtin` required) | 201 Style | 404, 422, 409 |
| `GET /api/styles/<id>` | | 200 Style | 404 |
| `PATCH /api/styles/<id>` | any of the fields above except `labelId`, plus `"baseVersion":3` | 200 Style | 422, 409, 412 |
| `POST /api/styles/<id>/duplicate` | | 201 Style | 409 |
| `POST /api/styles/<id>/archive` | | 200 Style | 409 `conflict` |
| `GET /api/materials?q=` | | 200 `{"materials":[{"id":"organic-cotton","name":"Organic cotton"}]}` | |
| `GET /api/styles/<id>/lines` | | 200 `{"lines":[Line],"version":3}` | 404 |
| `POST /api/styles/<id>/lines` | `{"materialId":"organic-cotton","fabricWeightGsm":"215","areaM2":"1.15","fibres":[{"name":"Organic cotton","sharePercent":"100.0"}],"tier1":{"factory":"Yıldız İplik","town":"Izmir","country":"TR"},"tier2":{"factory":"Ege Dokuma","town":"Izmir","country":"TR"},"tier3":{"factory":"Surat Fibre Co-op","town":"Surat","country":"IN"},"baseVersion":3}` or with `"massGrams":"250"` in place of weight and area | 201 Line | 404, 422, 409, 412 |
| `PATCH /api/styles/<id>/lines/<lineId>` | any of those fields | 200 Line | 404, 422, 409, 412 |
| `DELETE /api/styles/<id>/lines/<lineId>?baseVersion=3` | | 204 | 404, 409, 412 |
| `POST /api/styles/<id>/lines/<lineId>/move` | `{"direction":"up","baseVersion":3}` | 200 `{"lines":[Line],"position":2,"total":4,"version":4}` | 404, 422, 409 `conflict` at the end, 412 |
| `POST /api/styles/<id>/legs` | `{"mode":"road","km":"3200","baseVersion":3}` | 201 `{"id","mode","km","version"}` | 404, 422, 409, 412 |
| `DELETE /api/styles/<id>/legs/<legId>?baseVersion=3` | | 204 | 404, 409, 412 |

- `baseVersion` is optional. When present and not the style's current `version` the save answers 412 `stale_edit`.
- A tier is optional at creation and may be `null`.
- `StyleRow` is `{"id","labelId","labelName","styleCode","name","season","gtin","garment","state","suppliers":["Yıldız İplik"],"climateShown":"2.20 kg CO₂e"}`, where `climateShown` is `null` with no result.
- `Style` adds `{"washes","repairService","rangeSize","notes","legs":[...],"version","changedAt","changedBy","latestResult":Result,"newerFactors":"2027.2","score":Score}`. `newerFactors` is `null` when none, and `changedBy` is a supplier name or `null`.
- `Line` is `{"id","position","materialId","materialName","fabricWeightGsm","areaM2","massGrams":"247.25","massShown":"247.3 g","fibres","tier1","tier2","tier3","answeredFacts":{"energyMjPerKg":"15.66","waterLitresPerKg":"12.5","fibreOrigin":"TR"}}`.
- Garments are `tshirt`, `shirt`, `jeans`, `coat`. Style states are `draft`, `worked`, `published`, `archived`.

**Requests and answers.**

| Method and path | Request | Success | Own errors |
|---|---|---|---|
| `GET /api/requests?state=` | | 200 `{"requests":[Request]}` | |
| `POST /api/requests` | `{"styleId":"<id>","lineId":"<id>","supplierName":"Yıldız İplik","contactName":"Ayşe Demir","contactEmail":"ayse@yildiz-iplik.example","town":"izmir","language":"tr","questions":["energy","water","fibreOrigin"],"dueDate":"2027-03-29"}` | 201 Request | 429, 404, 422, 409 |
| `GET /api/requests/<id>` | | 200 Request | 404 |
| `POST /api/requests/<id>/new-address` | | 201 Request | 429, 404, 409 when answered |
| `POST /api/requests/<id>/end` | | 200 Request | 404, 409 when answered |
| `GET /api/a/<token>` | | 200 `{"language","supplierName","labelName","styleName","town","townName","questions","dueDate","endsAt","state","answeredAt"}` | 404, 410 |
| `POST /api/a/<token>/evidence` | multipart with field `file` | 201 `{"evidenceId","fileName","sizeBytes","contentType"}` | 413, 404, 410, 415, 503 |
| `POST /api/a/<token>/answers` | `{"energy":{"value":"4,35","unit":"kWh"},"water":{"value":"12,5"},"fibreOrigin":"TR","evidenceIds":["<id>"]}` | 201 `{"energyValue":"4.35","energyUnit":"kWh","energyMjPerKg":"15.66","waterLitresPerKg":"12.5","fibreOrigin":"TR","evidenceIds":[...],"answeredAt":"...","state":"answered"}` | 404, 410, 422 |
| `GET /api/evidence/<id>/file` | | 200 the file's bytes as an attachment | 429, 404, 503 |

- `Request` is `{"id","styleId","lineId","styleName","supplierName","contactName","contactEmail","town","townName","language","questions","dueDate","state","sentAt","endsAt","remindedAt","answeredAt","answer","answerAddress"}`, where `answer` is the answers response below with `null` for any fact not answered and `[]` for `evidenceIds` when no file was sent, and is itself `null` until answered.
- States are `sent`, `reminded`, `answered`, `ended`.
- Towns are `porto`, `izmir`, `hoChiMinhCity`, `cairo`. Languages are `en`, `fr`, `tr`, `ar`. Questions are `energy`, `water`, `fibreOrigin`. Units are `kWh`, `MJ`, `m3`.
- Before `endsAt`, reading an answered page answers 200 with `state` `answered`, and sending answers again answers 200 with the first response and changes nothing. At or after `endsAt` both answer 410 as for any ended page.
- A number refused gives 422 with that field holding the language's number copy. Other `error.message` values on `/api/a/` follow the page's language, except 413, which is decided before the page is known.

**Visits.**

| Method and path | Request | Success | Own errors |
|---|---|---|---|
| `GET /api/visits` | | 200 `{"visits":[Visit]}` | |
| `POST /api/visits` | `{"labelId":"<id>","factoryName":"Yıldız İplik","town":"izmir","localDate":"2027-03-29","localTime":"07:20"}` | 201 Visit | 404, 422 |
| `GET /api/visits/<id>` | | 200 Visit with `readings` | 404 |
| `GET /api/calendar/<date>` | | 200 `{"date":"2027-03-28","shown":"Sun 28 Mar 2027","hours":23,"visits":[Visit]}` | 422 |
| `POST /api/visits/<id>/readings` | header `Request-Key`, `{"meter":2,"value":"14350","unit":"kWh","secondsAgo":42}`, with optional `"keepMine":true` | 201 `{"id","meter","value","unit","takenAt":"..."}` | 404, 422, 409 `lower_reading`, 409 `key_reused` |

`Visit` is `{"id","labelId","factoryName","town","townName","localDate","localTime","at":"2027-03-29T04:20:00Z","lisbonDate":"2027-03-29","lisbonDayHours":24,"shown":"Mon 29 Mar 2027, 07:20 Izmir time · 05:20 Lisbon time"}`. Reading `value` is a plain decimal string, and the visit page accepts the English typing form. A skipped local time answers 422 with `fields.localTime`.

**Footprint, scenarios and score.**

| Method and path | Request | Success | Own errors |
|---|---|---|---|
| `POST /api/styles/<id>/results` | | 201 Result | 404, 422, 409, 503 |
| `GET /api/styles/<id>/results` | | 200 `{"results":[Result]}`, newest first | 404 |
| `GET /api/results/<id>` | | 200 Result | 404 |
| `GET /api/results/<id>/factors?measure=climate&stage=making` | | 200 `{"edition":"2027.1","rows":[{"id":"TR","kind":"grid","value":"0.124","unit":"kg CO₂e per MJ"}]}` | 404, 422 |
| `POST /api/factors/check` | | 200 `{"editions":[...],"newestInEffect":"2027.1","checkedAt":"..."}` | 503 |
| `POST /api/styles/<id>/scenarios/preview` | `{"resultId":"<id>","recycled":[{"lineId":"<id>","percent":50}],"materialSwaps":[{"lineId":"<id>","materialId":"cotton"}],"factorySwaps":[{"lineId":"<id>","country":"PT"}],"legModes":[{"legIndex":0,"mode":"sea"}]}` (each list optional) | 200 `{"measures":[Measure],"differences":[{"measure":"climate","shown":"..."}]}` | 404, 422 |
| `GET /api/styles/<id>/scenarios` | | 200 `{"scenarios":[Scenario]}` | 404 |
| `POST /api/styles/<id>/scenarios` | the preview body plus `"name":"Half recycled"` | 201 Scenario | 404, 422, 412 |
| `POST /api/styles/<id>/score` | | 200 Score | 404, 422 missing origin, 503 |

- `Result` is `{"id","styleId","edition","workedOutAt","dataQualityPercent":0,"dataQualityGrade":"C","measures":[Measure],"current":true}`.
- `Measure` is `{"measure":"climate","unit":"kg CO₂e","total":"2.1996","totalShown":"2.20 kg CO₂e","hotspot":"materials","stages":[{"stage":"materials","value":"1.005","shown":"1.01","share":"45.7"}]}`.
- Measures are `climate`, `water`, `fossilEnergy`, `landUse`, `freshwaterToxicity`, `microfibres`.
- `Score` is `{"state":"current","score":1240,"per100g":412,"runId":"...","shown":"...","worstCaseFacts":["repairService"],"busyUntil":null}`, with `state` one of `none`, `current`, `outdated`, `busy` and `worstCaseFacts` from `repairService`, `rangeSize`.
- `Scenario` is `{"id","name","resultId","savedAt", the changes, "measures","differences"}`.
- A 412 here carries code `stale_edit`.

**Passports.**

| Method and path | Request | Success | Own errors |
|---|---|---|---|
| `POST /api/styles/<id>/passport` | | 201 `{"gtin","edition":1,"state":"published","publishedAt","address":"/p/<gtin>"}`; a later call makes the next edition | 404, 409 `conflict` no current score, 409 `gtin_taken`, 409 `conflict` withdrawn |
| `POST /api/styles/<id>/passport/withdraw` | | 200 `{"gtin","state":"withdrawn"}` | 404, 409 |
| `GET /api/passports` | | 200 `{"passports":[{"styleId","styleName","gtin","edition","state","publishedAt","address"}]}` | |
| `GET /api/passports/<gtin>?lang=` | | 200 PublicPassport | 404, 410 |
| `GET /api/passports/<gtin>/editions/<n>?lang=` | | 200 PublicPassport | 404, 410 |

`PublicPassport` has exactly these keys: `gtin`, `edition`, `lang`, `styleName`, `labelName`, `garment`, `publishedAt`, `correctedOn` (`null` on edition 1), `factorEdition`, `dataQualityPercent`, `dataQualityGrade`, `scoreShown`, `measures` (each exactly `measure` and `totalShown`). These public reads need no session. Edition states are `published` and `withdrawn`.

**Try one garment.** `GET /api/estimate?garment=tshirt&fibre=organic-cotton&country=PT` is public and answers 200 `{"garment":"tshirt","fibre":"organic-cotton","country":"PT","climate":"1.005","shown":"1.01 kg CO₂e","answeredAt":"..."}`, or 422 for a value outside the table. Fibres are `organic-cotton`, `cotton`, `polyester`, `wool`. Countries are `PT`, `TR`, `VN`, `EG`.

**Dossiers, sign-off and results file.**

| Method and path | Request | Success | Own errors |
|---|---|---|---|
| `POST /api/styles/<id>/dossiers` | | 201 Dossier with `state` `ready` | 404, 409 `conflict` no result, 503 |
| `GET /api/styles/<id>/dossiers` | | 200 `{"dossiers":[Dossier]}` | 404 |
| `GET /api/dossiers/<id>` | | 200 Dossier | 404 |
| `GET /api/dossiers/<id>/file` | | 200 `application/pdf` | 429, 404, 503 |
| `POST /api/dossiers/<id>/sign-off-page` | | 201 `{"signOffAddress","endsAt"}` | 404, 409 replaced |
| `GET /api/s/<token>` | | 200 `{"dossier":{"id","state","styleName","edition","dataQualityPercent","dataQualityGrade","measures","madeAt","signedOffBy","signedOffAt"},"endsAt"}` | 404, 410 |
| `GET /api/s/<token>/file` | | 200 `application/pdf` | 404, 410, 503 |
| `POST /api/s/<token>/sign` | `{"name":"Inês Barros"}` | 200 Dossier fields | 404, 410, 422, 409 `newer_dossier`, 409 `conflict` already signed |
| `GET /api/styles/<id>/results-file` | | 200 `text/csv; charset=utf-8` | 429, 404 |

`Dossier` is `{"id","styleId","resultId","edition","state","madeAt","signedOffBy","signedOffAt"}`, with states `making`, `ready`, `signedOff`, `replaced`.

### Business rules (DP-11, DP-12, DP-14, DP-16, DP-18, DP-19, DP-22, DP-23, DP-27, DP-29, DP-31, DP-32, DP-33, DP-35, DP-36, DP-39, DP-41, DP-43, DP-46, DP-48, DP-49, DP-50, DP-51, DP-56)

**Time.**
- Business time is Europe/Lisbon, which changes its clocks.
- Local wall times are Europe/Lisbon for Porto, Europe/Istanbul for Izmir, Asia/Ho_Chi_Minh for Ho Chi Minh City and Africa/Cairo for Cairo.
- A date on screen is the local date of the town named, never the UTC date.
- The server alone decides every time-dependent state (`Newer factors`, `Outdated`, session end, busy-until, a page's end), and the device clock may be wrong by hours.

**Labels.**
- Deleting a label makes it and everything under it answer 404 at once and leave every list, search and file. Its passports answer 410, and its files are removed from MinIO, retried until confirmed.
- Closing moves `open` to `closed` with `eraseAt` = now + CLOSURE_WAIT_SECONDS (default 2592000).
- While closed: its styles stay listed and readable, writes under it answer 409, its private pages answer 410 with the ended copy, and no mail goes for it. A reminder falling due while closed goes after it comes back.
- Bringing it back within the wait returns everything exactly as it was. Private pages whose own instant has not passed work again.
- Bringing back at or after `eraseAt` answers 409.
- Within 5 seconds of `eraseAt`, the label's contact, supplier contacts, evidence files and dossier PDFs are erased and queued mail for it is dropped. Its passports are withdrawn at that moment and answer 410 with the withdrawn copy.
- The label moves to `erased` only after MinIO has confirmed each deletion. If MinIO is down it stays `closed` and tries again.
- An erased label keeps only its id, name and state on `/labels` and `/labels/<id>`. Every other address under it answers 404, including its styles and private pages.

**Styles.**
- The GTIN's last digit is the mod-10 check digit: 4006381333931 is valid, and 4006381333932 is refused naming digit 1.
- State moves from `draft` to `worked` on the first result, to `published` on the first passport, and back to `worked` on withdrawal. Any state but `published` can move to `archived`, and archived accepts no write. Archiving a `published` style answers 409 `conflict` with the `Archive with a live passport` copy from Feedback states; under a closed label the closed-label copy wins.
- An omitted `garment` is `tshirt`, omitted `washes` is 30, and an omitted `styleCode`, `repairService`, `rangeSize` or `notes` is `null`.
- A style code is unique within its label, and `null` never collides. A taken code answers 422 `validation_failed` with `fields.styleCode` holding the published copy. On `POST /api/styles`, `PATCH /api/styles/<id>` and `POST /api/styles/<id>/duplicate`, 409 `conflict` means only an archived style or a closed label.
- Duplicate makes `<name> (copy)` in `draft` and opens it. It carries the label, season, GTIN, garment, washes, `repairService`, `rangeSize` and notes, and the material lines with their fibres and tiers, and the legs. It carries no style code, supplier-given facts, requests, result, scenario, score, dossier or passport.
- A row in the list hides when `archived`, unless the state filter asks for `archived`.
- Sort `name` (the default) is ascending by folded name then id. Sort `climate` is ascending by the exact latest climate total with no-result styles last.
- A page is 25 styles, and the cursor continues after the last row's sort position so new styles never repeat or skip one.
- Text fields count characters with an emoji as 1: names at most 120, notes at most 2,000.

**Folding table for search.** Match after lower-casing with each pair: `ı`→`i`, `İ`→`i`, `ş`→`s`, `ğ`→`g`, `ç`→`c`, `ö`→`o`, `ü`→`u`, `é`/`è`/`ê`/`ë`→`e`, `à`/`â`/`ã`/`á`→`a`, `î`/`í`→`i`, `ô`/`õ`/`ó`→`o`, `ù`/`û`/`ú`→`u`, `ñ`→`n`. For example `yildiz iplik` finds `Yıldız İplik`, and `coton bio` finds `Coton Bio Éthique`. A search matches a style's name and the names in its `suppliers`, which is every factory name on its lines' tiers plus every supplier a request of the style went to. That list runs by line position and then tier 1 to 3, followed by request suppliers in the order first sent, and keeps only the first occurrence of an exactly equal name. Material search uses the same table.

**Catalogue file.**
- UTF-8 with or without a byte order mark, LF or CRLF, comma separated with standard double-quote quoting, and header row `styleCode,name,season,gtin`.
- Row numbers count the file's lines with the header as row 1.
- A row is `new` when the label has no style with that `styleCode`, `matched` when it has one, and `refused` with a reason from Feedback states when a name, season or GTIN is wrong or the code repeats an earlier row.
- Preview saves nothing. Save creates only new rows, with the default garment and washes, leaves matched rows as they are, and saves no refused row, so saving the same file twice changes nothing.

**Mass and fibres.**
- `massGrams` is kept exact and shown half up to 0.1 g: 215 g/m² × 1.15 m² is 247.25 g, shown `247.3 g`, where floating point gives 247.2; 165 g/m² × 1.47 m² is 242.55 g, shown `242.6 g`.
- Fibre shares have one decimal and add up to exactly 100.0.

**Stale edits.** Every change to a style, its lines or legs, and every applied answer raises `version` and sets `changedAt` and `changedBy`. An edit with an old `baseVersion` answers 412 with the published copy. The moves of two reorderings follow the same rule: the first wins and the second answers 412. Moving the first line up or the last line down answers 409 `conflict` with the `Line already at the end` copy from Feedback states. A move with an old `baseVersion` answers 412 even when its line is now at the end, the one exception to the ladder's order.

**Requests.**
- A supplier is found or created on the style's label by exact name, and its contact and town update to the latest request.
- A page's end is the earlier of 23:59:59 supplier local wall time on the due date and sending + ANSWER_PAGE_SECONDS (default 1209600), held in whole seconds as `endsAt`. A request to the page at or after that instant finds it ended (410 `page_ended`, with the ended copy). An unanswered request's `state` reads `ended` from then, and an answered request's `state` stays `answered` for good.
- The due date must be today or later in the supplier's town.
- `new-address` ends the old address at once (old token 410), makes a new one with a new `endsAt`, sends the mail again and sets `state` to `sent`.
- `end` ends it, and ended moves back only through `new-address`.
- An answered request has no further legal move.
- One reminder per address goes within 5 seconds after REMINDER_AFTER_SECONDS (default 604800) from sending, only if still unanswered and not ended, moving `sent` to `reminded`.
- A desk sends at most 20 requests per REQUEST_RATE_WINDOW_SECONDS (default 3600), first mails and new addresses counted and reminders not. The 21st answers 429, and the time in its copy is now + Retry-After.
- The limit is keyed on the desk, whichever session or network address sends.

**Numbers on the answer page.**
- English uses digits, optional `,` every three digits, `.` for decimals.
- French uses digits, an optional plain, no-break or narrow no-break space every three digits, `,` for decimals.
- Turkish uses digits, optional `.` every three digits, `,` for decimals.
- Arabic uses Arabic-Indic digits, optional `٬` every three digits, `٫` for decimals, or else plain digits with `.` and no grouping.
- `1,250.5`, `1 250,5`, `1.250,5`, `١٬٢٥٠٫٥` and `1250.5` are each 1250.5 in their language. `1.250` is 1.25 in English and 1250 in Turkish.
- Refused with that language's number copy: `1.250,5` in English; `1,250.5` in French, Turkish and Arabic; `12,50.5` in English.

**Energy.** A supplier's energy answer is per kg of finished goods and is kept in MJ in exact decimals: 1 kWh is 3.6 MJ and 1 m³ of natural gas is 37.8 MJ. 4.35 kWh is 15.66 MJ, where floating point gives 15.659999999999998.

**Applying an answer.**
- The first answer on a page is stored once, however many times it is sent.
- It applies to the request's line: energy becomes the line's supplier-given MJ per kg, water the line's litres per kg, fibre origin the line's tier 3 country. A later answer on the same fact wins.
- It raises the style's `version`, marks the score `outdated`, and if the style has a result, makes a new result at once from the rows kept with the latest result, with no library call. Earlier results and passport editions stay as they were.

**Evidence.** Judged by content only: a file is accepted when its first bytes are the PDF, JPEG or PNG signature, whatever its name or declared type, otherwise 415. It is stored byte for byte. Sent shows only when every chosen file has answered 201 and the answers have answered. A failed file leaves the answer unsaved and the draft on the device. Files are served only as attachments.

**Visits.**
- A visit is booked in the factory's local wall time and keeps it across clock changes, so the Lisbon diary moves. A 07:20 Izmir visit on Fri 26 Mar 2027 is 04:20:00Z and 04:20 Lisbon time, and on Mon 29 Mar 2027 it is 04:20:00Z and 05:20 Lisbon time.
- A Lisbon day has 23 hours on 28 Mar 2027 and 25 hours on 31 Oct 2027. These 2027 dates are worked examples; the rule holds for every clock change.
- A local time the change skips is refused. A local time that happens twice takes the first: 01:30 Porto on Sun 31 Oct 2027 is 00:30:00Z.
- The diary's group heading on a day that does not have 24 hours reads `<date>, <hours> hours`.

**Readings.**
- The server stamps `takenAt` as its own receipt time minus `secondsAgo`, in whole seconds, never from a date the device sends.
- A repeated `Request-Key` answers the first response, status and body, and changes nothing. The same key with a different body, leaving `secondsAgo` out of the comparison, answers 409 `key_reused`, so a retry that recomputes `secondsAgo` replays the first response.
- A value lower than the last recorded for that meter on that visit answers 409 with `lastValue` and `lastAt`. Keep mine sends it again with a new key and `"keepMine":true`. Keep recorded drops it. The other waiting readings keep going meanwhile.
- A meter keeps the unit of its first reading, and another unit answers 422.
- Waiting readings live on the device and survive a reload once the network is back.

**When the library is read.** Pressing `Work out footprint` reads `GET /v2/editions` and every page of the newest edition in effect, every time, and keeps those rows with the new result. Pressing `Check for newer factors` reads only `GET /v2/editions`. Nothing else calls the library; a scenario and a supplier's answer use the rows kept with the result. The app waits at most 5 seconds for either provider, and a later answer counts as unreachable. On any failure the published copy shows and nothing changes.

**Editions.** An edition takes effect on its `validFrom` date in Lisbon. When a read of the edition list by this copy has shown an edition newer by `validFrom` than the one a style's latest result used, with `validFrom` on or before today's Lisbon date, the style's `newerFactors` holds the newest such edition, decided by the server whenever the style is read. A later `validFrom` shows nothing yet. Each copy remembers only what it read itself.

**The footprint sum**, for each measure m in exact decimals (massKg = a line's exact mass in kg):
- Materials = sum over lines of massKg × that material's m.
- Making = sum over lines of massKg × makingMj × the grid row of that line's tier 1 country's m, where makingMj is the supplier-given MJ per kg when answered, otherwise the material's `makingMjPerKg`.
- Transport = sum over legs of (total massKg ÷ 1000 × km) × that mode's m.
- Use = washes × the wash row's m.
- End of life = total massKg × the disposal row's m.
- A supplier's water answer in litres per kg replaces only Making's Water figure with massKg × that answer.
- The total is the sum of the five.

Units are Climate `kg CO₂e`, Water `L`, Fossil energy `MJ`, Land use `points`, Freshwater toxicity `CTUe`, Microfibres `mg`. A style with no lines, or a line with no tier 1 country, is refused before any call with 422 `validation_failed`, `error.message` holding its copy and no `fields`. On `POST /api/styles/<id>/results`, 409 `conflict` means only an archived style or a closed label.

**Display.**
- Every figure is an exact decimal shown to 3 significant figures, half up on the exact value, with comma grouping: 12.35 shows `12.4`, 0.1235 shows `0.124`, 1235 shows `1,240`.
- Trailing zeros stay (`2.20`, `0.0840`), and exactly 0 shows `0`.
- An exact value under 0.001 shows as `3.15 × 10⁻⁴` (0.0003145) with superscript digits.

**Shares, hotspot and quality.**
- A stage's share is its part of the exact total in percent, half up to one decimal, so shares may add to 100.1. A zero total gives every share 0.0.
- The hotspot is the stage with the largest share, the earlier stage on a tie.
- Data quality is the share of mass on lines with supplier-given facts, half up to a whole percent, graded A from 80, B from 50, otherwise C.

**Worked example, seeded as Harbour Tee.** One line of 250 g organic-cotton, tier 1 country TR, one road leg of 3,200 km, 30 washes.
- Climate: Materials 1.005 shows `1.01` (floating point gives 1.00); Making 3.7 MJ × 0.124 = 0.4588 shows `0.459`; Transport 0.8 tonne-km × 0.105 = 0.084 shows `0.0840`; Use 30 × 0.0213 = 0.639 shows `0.639`; End of life 0.0128 shows `0.0128`; total 2.1996 shows `2.20 kg CO₂e`; shares 45.7, 20.9, 3.8, 29.1, 0.6; hotspot Materials.
- Water total 1137.0359 shows `1,140 L`.
- Fossil energy total 25.6505 shows `25.7 MJ`, hotspot Use (9.30 against Materials 9.13).
- Land use Making 0.0003145 shows `3.15 × 10⁻⁴`, total 0.011151 shows `0.0112 points`.
- A supplier answer of 4.35 kWh per kg is 15.66 MJ, so Climate Making becomes 0.48546, shown `0.485`, and the total 2.22626 shows `2.23 kg CO₂e`.

**Scenarios.** They use only the rows kept with the result and never touch it.
- A recycled share of r percent multiplies that line's Materials figures by (1 − 0.006 × r).
- A material swap uses the new material's row and its `makingMjPerKg`, dropping that line's supplier-given making facts.
- A factory swap uses the new country's grid row and the material's `makingMjPerKg`.
- A mode change uses the new mode's row.
- Harbour Tee at r = 50: Materials climate 0.7035 shows `0.704`, total 1.8981 shows `1.90`, difference −0.3015 shows `−0.302 kg CO₂e (−14%)`.
- Differences print a true minus sign or an explicit plus, 3 significant figures half up on the size of the difference, and a whole percent of the baseline half up on its size, for example `+0.0800 kg CO₂e (+4%)` for a rise of 0.08 on 2.1996.
- `no change` shows when the exact difference is 0. A zero baseline prints no percent.
- Saving when the style's latest result is no longer the scenario's `resultId` answers 412.

**Try one garment.** Climate = garment kg × (fibre value + country value), with no library call. Garments: T-shirt 0.25, Shirt 0.30, Jeans 0.80, Coat 1.20. Fibres: Organic cotton 3.10, Cotton 4.15, Polyester 3.24, Wool 14.6. Countries: Portugal 0.92, Turkey 1.35, Vietnam 2.10, Egypt 1.74. T-shirt, Organic cotton, Portugal is 1.005, shown `1.01 kg CO₂e`, by the display rule.

**Score.**
- Every line's tier 1, 2 and 3 country is mandatory. Without them the desk refuses before any call with 422 `validation_failed` and no `fields`, naming the first such line's material.
- A missing optional fact goes as its worst-case value with its copy (`repairService` false, `rangeSize` 100000).
- Same inputs means the same body, compared after sorting its keys: a stored score for that body is shown with no call and becomes `current` again.
- Any change to the style's lines, legs, washes, optional facts or an applied answer moves the score to `outdated`, decided by the server, until asked again.
- A service 429 with Retry-After in seconds moves it to `busy` with a server-held `busyUntil`. No call goes before that instant, and asking answers 503 with the busy copy.
- A connection failure, a timeout or any other non-200 answer gives 503 with the unavailable copy, and the old score and state stay.

**Passports.**
- Publishing needs a latest result and a `current` score, and freezes a snapshot as the next edition. Published editions never change.
- A later publish is a correction: the new edition carries `Corrected <date>` with the Lisbon date, and earlier ones stay readable at `/p/<gtin>/e/<n>`.
- `/p/<gtin>` shows the newest edition.
- Withdrawing moves every edition to `withdrawn`, and every passport address answers 410 with the withdrawn copy. Publishing a withdrawn GTIN answers 409 with `conflict`.
- A GTIN is unique across every desk once published, and a second style or desk publishing it answers 409 `gtin_taken`. This is decided only on publish, so creating or duplicating a style with a GTIN that is already published is allowed.

**Dossiers.**
- `making` lasts only while the request is open. The dossier moves to `ready` only after Gotenberg has answered and MinIO has confirmed, and only then does the previous dossier of the style move to `replaced`. On either failure nothing is saved, and the previous dossier is untouched.
- A signed-off dossier stays `signedOff` until a newer one replaces it.
- Signing moves `ready` to `signedOff`. Signing `replaced` answers 409 with the time the newer one was made.
- The sign-off page lasts until sending + SIGN_OFF_PAGE_SECONDS (default 1209600), ends exactly at that instant, and a new address ends the old one.

**Results file.** A header row holding the column names comes first, then one row per result of the style, newest first as in `GET /api/styles/<id>/results`. The file is UTF-8 with no byte order mark, every field in double quotes, CRLF after every row including the last, with the columns `style,gtin,label,suppliers,notes,edition,workedOutAt,climate,water,fossilEnergy,landUse,freshwaterToxicity,microfibres,dataQualityPercent,dataQualityGrade`. `suppliers` joins the style's current `suppliers` list, in its published order, with `; `, and measure columns hold `totalShown`. Any cell starting with =, +, -, @, a tab or a carriage return is prefixed with an apostrophe, because supplier names and notes are typed by people.

**Downloads.** Dossier, results and evidence downloads by the assessor are limited to 5 per desk per FILE_RATE_WINDOW_SECONDS (default 3600). The sixth answers 429, keyed on the desk. The label contact's reading on a private page does not count.

**Sessions.**
- The session cookie is HttpOnly, SameSite=Lax, never Secure (the app is served over plain http) and a browser-session cookie with no Max-Age or Expires.
- A session lasts SESSION_SECONDS (default 28800).
- The server alone decides it has ended, and answers 401 session_ended for that session's cookie after it runs out, after signing out, or after a password change elsewhere.
- Sign-up is open to anyone, and a new desk starts with no labels, styles or suppliers.

### Services (DP-21, DP-22, DP-28, DP-29, DP-35, DP-39, DP-43, DP-48, DP-49, DP-60)

**Postgres.** Holds every desk's labels, styles, material lines, requests, answers, visits, readings, results, scenarios, scores, passports and dossiers in exact decimals, separated per desk. Every copy of the app has its own database.

**MinIO.** Evidence objects go to `evidence/<desk id>/<request id>/<evidence id>`, byte for byte as received. Dossier objects go to `dossiers/<desk id>/<dossier id>.pdf`. Sent, Ready and Erased show only after MinIO has confirmed. While MinIO is down, files are refused with the file-store copy and 503, and nothing is half-written.

**Mailpit.** Every mail is sent over SMTP from `Fio Contado Desk <desk@fio-contado.example>`, read from `MAIL_FROM`. `<address>` is the public address of the page under `APP_PUBLIC_URL`, and tokens cannot be guessed. A request mail carries no footprint figure and no other label's or supplier's name. A dossier PDF and a sign-off mail carry no supplier contact details.

| Mail | To | Subject |
|---|---|---|
| Request | the contact | `Facts needed for <labelName>` / `Informations demandées pour <labelName>` / `<labelName> için bilgi talebi` / `معلومات مطلوبة من أجل <labelName>` |
| Reminder | the contact | `Reminder: facts needed for <labelName>` / `Rappel : informations demandées pour <labelName>` / `Hatırlatma: <labelName> için bilgi talebi` / `تذكير: معلومات مطلوبة من أجل <labelName>` |
| Sign-off | the label contact | `Dossier to sign off: <styleName>` |

Request and reminder bodies hold, in order:
1. The greeting: `Hello <contactName>,` / `Bonjour <contactName>,` / `Merhaba <contactName>,` / `مرحبًا <contactName>،`
2. The ask: `<labelName> asks you for facts about <styleName>. Please answer on this private page:` / `<labelName> vous demande des informations sur <styleName>. Merci de répondre sur cette page privée :` / `<labelName>, <styleName> hakkında bilgi istiyor. Lütfen bu özel sayfadan yanıtlayın:` / `تطلب منك <labelName> معلومات عن <styleName>. يرجى الإجابة في هذه الصفحة الخاصة:`
3. The address on its own line.
4. The answer page's due line in that language.

The sign-off body holds `Hello <contactName>,`, then `Please read and sign off the dossier for <styleName> on this private page:`, then the address, then `This page ends on <date>, <time> Lisbon time.` Every copy delivers its own pending mail, and a mail not yet accepted is tried again.

**WireMock, the factor library (invented, its data printed in full).** `GET $WIREMOCK_URL/v2/editions` answers `{"editions":[{"edition":"2026.2","validFrom":"2026-01-01"},{"edition":"2027.1","validFrom":"2026-07-01"}]}`. `GET $WIREMOCK_URL/v2/factors?edition=2027.1` and then, while an answer has a `nextCursor`, `GET $WIREMOCK_URL/v2/factors?edition=2027.1&cursor=<nextCursor>`, each answer `{"edition":"2027.1","rows":[Row],"nextCursor":"p2"}`, 10 rows per page. Page 1 is the first 10 rows with `nextCursor` `p2`, page 2 the next 10 with `p3`, page 3 the last 4 with `nextCursor` null, and the first request sends no cursor. Each Row is `{"id","kind","makingMjPerKg" (material rows only),"climate","water","fossil","land","toxicity","microfibres"}`, every value a decimal string (`"4.02"`) that the app reads exactly. Edition 2027.1 has exactly these 24 rows in this order:

| id | kind | name | makingMjPerKg | climate | water | fossil | land | toxicity | microfibres |
|---|---|---|---|---|---|---|---|---|---|
| organic-cotton | material | Organic cotton | 14.8 | 4.02 | 2840 | 36.5 | 0.0412 | 318 | 52 |
| cotton | material | Cotton | 14.8 | 5.91 | 6120 | 48.2 | 0.0386 | 742 | 52 |
| recycled-cotton | material | Recycled cotton | 11.2 | 1.87 | 410 | 21.4 | 0.0041 | 96 | 61 |
| linen | material | Linen | 13.5 | 2.64 | 1180 | 29.7 | 0.0295 | 204 | 38 |
| wool | material | Wool | 17.6 | 18.4 | 3120 | 44.9 | 0.214 | 512 | 44 |
| recycled-wool | material | Recycled wool | 12.3 | 3.12 | 640 | 24.1 | 0.0063 | 118 | 47 |
| polyester | material | Polyester | 21.4 | 3.24 | 58 | 71.6 | 0.0009 | 86 | 410 |
| recycled-polyester | material | Recycled polyester | 19.8 | 1.95 | 41 | 39.3 | 0.0005 | 64 | 430 |
| viscose | material | Viscose | 24.3 | 4.77 | 1420 | 58.8 | 0.0172 | 377 | 29 |
| lyocell | material | Lyocell | 19.1 | 2.83 | 890 | 41.2 | 0.0154 | 142 | 24 |
| nylon | material | Nylon | 26.7 | 7.31 | 96 | 96.4 | 0.0011 | 131 | 385 |
| elastane | material | Elastane | 31.2 | 12.6 | 210 | 142 | 0.0018 | 268 | 96 |
| PT | grid (per MJ) | | | 0.0412 | 0.118 | 0.74 | 0.000041 | 0.021 | 0 |
| TR | grid | | | 0.124 | 0.215 | 1.62 | 0.000085 | 0.043 | 0 |
| VN | grid | | | 0.158 | 0.264 | 1.93 | 0.000102 | 0.057 | 0 |
| EG | grid | | | 0.131 | 0.302 | 1.81 | 0.000076 | 0.049 | 0 |
| IN | grid | | | 0.196 | 0.341 | 2.24 | 0.000118 | 0.072 | 0 |
| BD | grid | | | 0.172 | 0.288 | 2.07 | 0.000109 | 0.064 | 0 |
| sea | mode (per tonne-km) | | | 0.0107 | 0.0042 | 0.148 | 0.000012 | 0.0088 | 0 |
| road | mode | | | 0.105 | 0.038 | 1.48 | 0.00021 | 0.092 | 0 |
| rail | mode | | | 0.0281 | 0.0113 | 0.392 | 0.000064 | 0.021 | 0 |
| air | mode | | | 0.602 | 0.176 | 8.41 | 0.00097 | 0.33 | 0 |
| wash | use (per wash) | | | 0.0213 | 14.2 | 0.31 | 0.000012 | 0.0064 | 3.8 |
| disposal | endOfLife (per kg) | | | 0.0512 | 0.84 | 0.19 | 0.000034 | 1.27 | 1.6 |

The `kind` values in JSON are `material`, `grid`, `mode`, `use` and `endOfLife`. Material names are not in the library's JSON: the app holds this table's twelve ids and names for the `Add material` search, which needs no library call. Seed results on edition 2026.2 hold their kept rows, so the library is never asked for 2026.2.

**WireMock, the score service (invented).** `POST $WIREMOCK_URL/v1/textile/score` takes, for example, `{"gtin":"4006381333931","garment":"tshirt","massGrams":"250","washes":30,"materials":[{"id":"organic-cotton","sharePercent":"100.0","tier1":"TR","tier2":"TR","tier3":"IN"}],"repairService":false,"rangeSize":100000}` and its baseline answer is `{"score":1240,"per100g":412,"runId":"run-baseline"}`. `massGrams` is the exact total mass as a plain decimal string. `materials` has one entry per line in order, with `sharePercent` the line's share of total mass, half up to one decimal.

**Gotenberg.** The app sends the dossier's HTML as `index.html` to `POST $GOTENBERG_URL/forms/chromium/convert/html` with its styles and fonts inline, and never asks Gotenberg to fetch an address. The reply body is the PDF. The PDF's text holds the style's name, every measure's total and stage figures exactly as on screen, the factor edition (`Factor edition <edition>`) and the data quality (`Data quality <grade> (<percent>%)`).

**What each outage shows.** The copy and statuses are in Feedback states and API: the factor library's copy with 503, the score service's copies with 503, the dossier service's copy with 503, the file store's copy with 503.

### Seed data (DP-52)

Every seeded person, business and label is invented. On an empty database the app creates exactly this and nothing else.

**Desks.** Marta Quintela `marta@fio-contado.example` and Iris Vandeputte `iris@fio-contado.example`, both with password `desk-pass-2027`.

**Marta's labels.**

| Label | Contact | Mail | State |
|---|---|---|---|
| Maré Alta | Inês Barros | ines@mare-alta.example | open |
| Linho & Sal | Tomás Leite | tomas@linho-sal.example | open |
| Atelier Noroeste | Clara Pinto | clara@atelier-noroeste.example | open |

**Suppliers.**

| Supplier | Label | Town | Language | Contact | Mail |
|---|---|---|---|---|---|
| Yıldız İplik | Maré Alta | Izmir | tr | Ayşe Demir | ayse@yildiz-iplik.example |
| Coton Bio Éthique | Maré Alta | Ho Chi Minh City | fr | Camille Nguyen | camille@coton-bio.example |
| Fiação do Ave | Atelier Noroeste | Porto | en | Rui Matos | rui@fiacao-ave.example |
| Nile Delta Weaving | Linho & Sal | Cairo | ar | Salma Hassan | salma@nile-delta.example |

**Styles.** Every style has 30 washes and one fibre row at `100.0`. Optional facts are unset unless stated.

| Style | Code | Label | Season | GTIN | Garment | Line | Tier 1 | Tier 2 | Tier 3 | Leg | State |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Harbour Tee | HT-01 | Maré Alta | AW27 | 4006381333931 | tshirt | 250 g organic-cotton | Yıldız İplik, Izmir, TR | Ege Dokuma, Izmir, TR | Surat Fibre Co-op, Surat, IN | road 3,200 km | published |
| Quay Shirt | QS-01 | Maré Alta | AW27 | 5600000000014 | shirt | 300 g linen | Coton Bio Éthique, Ho Chi Minh City, VN | Saigon Looms, Ho Chi Minh City, VN | Mekong Flax, Can Tho, VN | sea 10,000 km | worked |
| Estuary Coat | EC-01 | Atelier Noroeste | AW27 | 5600000000021 | coat | 1200 g wool | Fiação do Ave, Porto, PT | none | none | road 450 km | worked |
| Delta Jeans | DJ-01 | Linho & Sal | SS27 | 5600000000038 | jeans | 800 g cotton | Nile Delta Weaving, Cairo, EG | none | none | none | draft |
| Ribeira Polo | RP-01 | Linho & Sal | SS27 | 5600000000045 | tshirt | 220 g cotton | none | none | none | none | archived |

Harbour Tee also has repair service false, range size 100000 and the notes `Check dye house meter in spring.`

**Results.** Edition 2026.2's kept rows equal edition 2027.1's table except organic-cotton climate `3.96` and TR climate `0.131`.

| Style | Edition | Worked out | Climate shown | Data quality |
|---|---|---|---|---|
| Harbour Tee | 2026.2 | 2026-03-10T09:00:00Z | `2.21 kg CO₂e` (2.2105) | C (0%) |
| Harbour Tee | 2027.1 (latest) | 2026-09-15T09:00:00Z | the worked example | C (0%) |
| Quay Shirt | 2026.2 | 2026-03-12T09:00:00Z | `2.12 kg CO₂e` (2.11836) | A (100%) |
| Estuary Coat | 2027.1 | 2026-09-16T09:00:00Z | `23.7 kg CO₂e` (23.707284) | C (0%) |

**Requests (no mail is sent for them).** Harbour Tee to Yıldız İplik, state `ended`, unanswered. Quay Shirt to Coton Bio Éthique, state `answered`, fibre origin VN only.

**Score.** Harbour Tee `current` with the published example body, score 1240, per100g 412, runId `run-seed`.

**Passport.** Harbour Tee edition 1 `published` at 2026-09-20T10:00:00Z from the 2027.1 result.

**Dossier.** One for Harbour Tee on the 2027.1 result, `signedOff` by Inês Barros at 2026-09-22T15:00:00Z, its PDF made by the app when Gotenberg and MinIO are first reachable and until then read as unavailable.

**Visits.** Two visits to Yıldız İplik, Maré Alta, at 07:20 Izmir time: one on the Friday before and one on the Monday after the next Lisbon clock change, counted from the real date at first start. No readings.

**Iris's desk.** Label Kade Studio (contact Jef Maes, jef@kade-studio.example), style Kade Overshirt, season AW27, GTIN 5600000000069, garment shirt, 30 washes, in `draft` with no lines.

**Label-name strip.** `Maré Alta`, `Linho & Sal`, `Atelier Noroeste`, `Kade Studio`, `Fio Norte`, `Serra Knit`, `Douro Denim`, `Cais Workwear`, all fictional.

Every create endpoint has its literal example under API, and tests set up only through this seed data, sign-in and those endpoints.

## Technical requirements

### Deployment (DP-57, DP-60)

Node.js with npm is available, and the app is TypeScript. `/app/run.json` holds string `install`, `build` and `serve` and `"_schema":"run-manifest-v1"`, for example:

```json
{"_schema":"run-manifest-v1","install":"npm ci","build":"npm run build","serve":"npm start"}
```

Serve binds `0.0.0.0` on port 4173, honouring `APP_PUBLIC_PORT`, and `/api/health` answers HTTP 200 JSON `{"status":"ok"}`. The app applies its schema and seed idempotently on every serve, and several copies starting together are safe. Each copy has its own database and bucket and delivers its own pending mail.

**Extra copies run during checks, each its own serve with these settings.** The harness creates every copy's database and bucket, empty, before that copy's serve starts. The app never creates a database or bucket, and it applies its schema and seed to the one it is given.

| Copy | Settings | Address env |
|---|---|---|
| MinIO down | `S3_ENDPOINT` unreachable, `${DATABASE_URL}_storage`, `${S3_BUCKET}-storage` | `APP_MINIO_DOWN_URL` |
| Gotenberg down | `GOTENBERG_URL` unreachable, `${DATABASE_URL}_render`, `${S3_BUCKET}-render` | `APP_GOTENBERG_DOWN_URL` |
| Short timers | `ANSWER_PAGE_SECONDS=20`, `SIGN_OFF_PAGE_SECONDS=20`, `REMINDER_AFTER_SECONDS=10`, `REQUEST_RATE_WINDOW_SECONDS=30`, `FILE_RATE_WINDOW_SECONDS=30`, `CLOSURE_WAIT_SECONDS=20`, `${DATABASE_URL}_short`, `${S3_BUCKET}-short` | `APP_SHORT_URL` |
| Short session | `SESSION_SECONDS=20`, `${DATABASE_URL}_session`, `${S3_BUCKET}-session` | `APP_SESSION_URL` |
| Spare | `${DATABASE_URL}_spare`, `${S3_BUCKET}-spare`, where `Check for newer factors` is pressed so no edition reaches the figures other copies read | `APP_SPARE_URL` |

### Configuration and secrets (DP-60)

Read at start, never hard-coded and never sent to the browser: `DATABASE_URL`, `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_FORCE_PATH_STYLE`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `SMTP_HOST`, `SMTP_PORT`, `MAIL_FROM`, `WIREMOCK_URL`, `GOTENBERG_URL`, `APP_PUBLIC_URL`, `APP_PUBLIC_PORT`, and the time settings `SESSION_SECONDS`, `ANSWER_PAGE_SECONDS`, `SIGN_OFF_PAGE_SECONDS`, `REMINDER_AFTER_SECONDS`, `REQUEST_RATE_WINDOW_SECONDS`, `FILE_RATE_WINDOW_SECONDS`, `CLOSURE_WAIT_SECONDS`, each with the default printed in Business rules.

### Server boundary (DP-28, DP-45, DP-57, DP-60)

- The app is same-origin only and sends no cross-origin headers.
- The browser never calls MinIO, WireMock or Gotenberg, and files reach the browser only through the app's own addresses.
- The server never serves source files, credentials or environment values.
- Public passport responses hold only the published fields, and the private pages' responses hold only the fields printed under API.
- Size limits are enforced as published under API, counting streamed bytes, and an over-limit request gets a complete JSON answer, never a dropped connection.
- When a provider is unreachable at boot the app still starts and answers `/api/health`, and only the actions that need that provider answer their 503.

### Browser support and performance (DP-53)

Current Chromium, Firefox and WebKit at 375x812 with touch, 768x1024 and 1280x800, and at 320x568 and 812x375 as SR15 and SR17 say. Each screen is usable within three seconds on the local network. Refreshes hold the last figures in place until new ones arrive.

## Working rules

- **IF-01** `/app/run.json` holds string `install`, `build` and `serve` and `"_schema":"run-manifest-v1"`.
- **IF-02** `THIRD_PARTY_NOTICES.md` at the repository root lists every shipped package and bundled font with its licence; shipped packages means the production dependency tree (`npm ls --omit=dev --all --json`).
- **IF-03** Shipped packages and bundled fonts use only MIT, Apache-2.0, BSD, ISC or OFL licences.
- **IF-04** The app uses no datastore other than Postgres and MinIO, and no external service beyond those this brief names.
- **IF-05** The app loads no font, script, style or image from another origin at runtime.
- **IF-06** The seeded service configuration is left untouched: the app never calls WireMock's admin API or changes its stubs, and all brand, copy and imagery are this brief's own or generated.

## Engineering standards

- The code is idiomatic strict TypeScript with no use of the `any` type outside third-party boundaries.
- Names match the domain terms in this brief: desk, label, style, material line, request, answer, visit, reading, result, edition, scenario, score, passport, dossier.
- Each domain rule, such as a state transition, the display rule, the local number rule, a page's end or a derived figure, is decided in exactly one place in the source.
- Published sums use exact decimals everywhere, and no figure passes through a floating-point number.
- No abstraction has a single implementation unless a provider boundary requires it for its outage behaviour.
- There is no dead, commented-out or unreachable code, and no defensive checks for impossible states.
- One error shape and one precedence ladder serve every endpoint from one place.
- The source holds no features beyond this brief.
