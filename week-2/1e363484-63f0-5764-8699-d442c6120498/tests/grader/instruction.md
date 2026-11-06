# Sedgemoor Instrument Works Fluxseal

Fluxseal is a web workspace for teams that restore peatland and wetland or manage forest, and for the companies and regulators who rely on their figures. It turns half-hourly eddy-covariance tower readings and gridded satellite flux cells into tonnes of CO2e. Every figure states how much of the project boundary its readings cover. A share of every net removal is held back as a non-permanence buffer. Each published figure is sealed with a fingerprint of the exact readings behind it, and the readings file is kept exactly as it was sealed, so anyone can re-check the figure later. Each role uses it differently:

- Flux scientists explore a project's readings on a timeline and seal figures.
- Data stewards ingest and re-ingest readings through an API.
- Project leads watch a sealed-tonnes balance and buffer that update in place, and issue read-only links.
- Workspace admins grant per-project roles.
- Regulators open one sealed figure from a link without an account.

The server does all the work and uses three services. Postgres is the system of record. An S3-compatible object store (MinIO) holds the evidence bundles. An SMTP sink (Mailpit) receives notice and alert emails.

Out of scope: self-registration, password reset, editing boundaries, buffer percentages or sensor footprints in the UI, gap-filling or flux processing, credit trading or retirement, and any datastore beyond those three services.

## Problem and users

Restoration teams pay for eddy-covariance towers that record CO2 and methane exchange every half hour. Their published tonnes still come from modelled estimates, because the steps from instrument units to tonnes live in one-off scripts:

- half-hour integration
- per-gas warming factors
- sign conventions
- how much of the project area the towers actually see
- how much of a removal is held back against later loss

Verifiers re-run the scripts by hand. A figure can change without anyone noticing when flux processing is re-run, and nobody can say which readings moved. Footprint coverage of the project boundary is rarely stated, so a tower that sees a third of a site gets reported as if it saw all of it. Buyers pay premiums for "measured" removals and carry the reputational risk. Developers pay a verifier for every re-check, and regulators are left with PDFs they cannot reproduce.

Fluxseal does the whole chain once, on the server:

- It states coverage against the boundary.
- It withholds the buffer.
- It seals each figure with a fingerprint of its readings.
- It keeps the readings file exactly as sealed.
- It lets a regulator re-check that figure from a link.

The users and their goals:

- **Flux scientist** (daily): narrows a project's readings by date range and sensor, and reads the carbon-flux timeline. Brushes an interval and checks the server-derived figure, its coverage and its buffer. Shares the interval by URL, then seals it.
- **Data steward** (daily): ingests half-hourly tower readings and satellite flux cells through the ingestion API. Re-ingests reprocessed readings when the flux pipeline is re-run, sometimes as several batches in parallel.
- **Project lead** (weekly): watches the project's credited sealed-tonnes balance, buffer and figure statuses update in place. Issues read-only regulator links for sealed figures, and acts when a seal breaks.
- **Workspace admin** (occasional): gives people the viewer, analyst or sealer role on each project, so that only the right people can see a project or seal its figures. Changes take effect in sessions that are already open.
- **Regulator** (occasional, no account): opens a sealed figure from a link and sees its fingerprint, coverage, buffer and unit breakdown. Downloads the readings file exactly as sealed, and asks the server to re-derive the figure.

## Journeys

1. **Explore, preview and share.**
   - *Start:* A flux scientist signs in and opens a project. The timeline shows daily net CO2e bars, and the brush spans the whole record.
   - *Actions:* The scientist narrows the date window, unticks a sensor, and drags and resizes the brush, then does the same by keyboard. With each change, the boundary map redraws the contributing footprints. Covered ground changes from hatching to the covered tint. The coverage and net-tonnes numerals count to the server's new values. The scientist opens the unit breakdown, then copies the address bar to a colleague.
   - *End:* The figure panel shows the server-derived figure, buffer and credited tonnes for the chosen interval. Seal figure is armed, or disabled with its reason in text. The polite live region has announced the settled values. The colleague who opens the copied address sees the same window, brush, sensors and figure.
2. **Seal a figure.**
   - *Start:* An armed preview of a net removal.
   - *Actions:* The scientist presses Seal figure, reviews net, buffer and credited tonnes in the confirmation dialog, and confirms.
   - *End:* The figure appears once as Sealed in the Figures table. The balance has moved by its credited tonnes, and the buffer total by its buffer. One issuance entry and one buffer entry are in the ledger. One evidence bundle is in the object store, and one notice email has reached the project lead.
3. **Seal during an outage.**
   - *Start:* Evidence storage, or the mail sink, is unreachable.
   - *Actions:* The scientist confirms a seal.
   - *End:* While the seal is pending and after it is refused, the Figures table, ledger and balance strip look exactly as they did before. The dialog and the live region show the published outage copy. There is no new figure, ledger entry, object or email.
4. **Re-ingest breaks a seal.**
   - *Start:* A sealed figure exists.
   - *Actions:* A data steward's pipeline sends several reprocessed batches at once. Each batch revises readings inside the sealed figure.
   - *End:* That figure reads Broken. Exactly one reversal sits in the ledger for each of its entries, and the balance and buffer have dropped back. Exactly one alert email has reached the project lead and the sealing scientist. The audit trail lists every moved reading with its old and new values, with no revision lost.
5. **Re-seal after a break.**
   - *Start:* A broken figure's page.
   - *Actions:* The scientist opens the figure's interval in the workspace and seals it on the new readings.
   - *End:* The live region names the figure it supersedes. The old row reads Superseded without a reload, the new figure reads Sealed, and the balance equals the ledger.
6. **Project lead on a phone.**
   - *Start:* On a 375-pixel-wide phone, the project lead opens the project list and then a project.
   - *Actions:* The lead reads the balance, buffer and figure counts, drags the brush by touch and taps footprints. The lead expands the figure sheet, then leaves the page open while a data steward's re-ingest breaks a figure.
   - *End:* Within one refresh, the figure turns Broken and the balance and buffer drop, in place, with one announcement. The brush, the expanded sheet and focus stay where they were. The lead then issues a regulator link for another sealed figure and copies it.
7. **Regulator re-checks a figure.**
   - *Start:* A regulator opens the link without signing in, whatever their device clock says.
   - *Actions:* The regulator reads the status, fingerprint, coverage, buffer and unit breakdown. The regulator presses Re-derive by keyboard, opens the readings audit trail and downloads the readings file.
   - *End:* The page shows the server's fresh verdict and check time. The file's bytes hash to the sealed fingerprint even after the readings moved.
8. **Links end; access changes.**
   - *Links:* The project lead revokes one link, and another link passes its expiry while a regulator has it open. On Re-derive, the open page switches to the expired page. Revoking the expired link is refused.
   - *Access:* A workspace admin removes one person's grant and lowers another's from sealer to analyst on the Access screen. The first person's open workspace moves to the project list with the published copy. The second person's open Seal figure dialog refuses Confirm seal with the role copy, and nothing is sealed.

## Mandatory requirements

This is the complete list of mandatory requirements; every check traces to one of these lines and the detailed sections below.

- **DP-01 — Run manifest, health and start-up** The app installs, builds and serves from /app/run.json on port 4173, answers the health check, and applies its schema and seed data idempotently on every start, including when two instances start at once.
- **DP-02 — Configuration from environment** Every service URL, credential and duration setting is read from the environment variables listed in Configuration and secrets, and none is hard-coded or sent to the browser.
- **DP-03 — Server boundary** The server serves only same-origin app routes and assets, refuses cross-site state changes, enforces the body limits, never serves source or credentials, starts even when a dependency is unreachable, and stays correct across several instances sharing one database, as qualified in Server boundary.
- **DP-04 — One error shape and precedence** Every API error uses the error shapes and the single precedence order stated in API, with the cross-origin refusal after transport errors and before authentication.
- **DP-05 — Sign-in and sessions** Seeded people sign in with email and password to get an HttpOnly session cookie that is valid on every instance, and wrong credentials are refused with the published copy.
- **DP-06 — Project visibility from role grants** Which projects a person sees, and whether they may preview, seal, ingest or manage access, comes only from server-side org roles and per-project grants read on every request, with an admin holding the higher of viewer and their grant.
- **DP-07 — Role grant management** A workspace admin sets or removes a person's viewer, analyst or sealer grant on a project through the access API, and the change applies to that person's next request without revoking links already issued.
- **DP-08 — Access screen journey** A workspace admin changes a grant on the Access screen, the change is confirmed in its live region, and the affected person's open workspace loses the project or the right to seal on its next request, with the published copy.
- **DP-09 — Project workspace data** The project API returns the boundary, coverage floor, buffer percentage, sensors with footprints, record bounds, the caller's role and the project summary.
- **DP-10 — Daily flux timeline** The timeline shows one net CO2e bar per UTC day from the server, uptake below the zero rule and emission above it, within the chosen date window.
- **DP-11 — Server-side unit chain** Net, CO2 and CH4 tonnes are derived on the server by the published unit chain with exact decimal arithmetic and half-even rounding, per-sensor contributions are allocated by largest remainder so each column sums exactly to the figure's totals, and the page only displays these values.
- **DP-12 — Coverage against the boundary** Coverage is the boundary area covered by contributing footprints and cells, with towers taking precedence over cells, and is stated on every preview and figure.
- **DP-13 — Contributing sensors** A sensor contributes area and tonnes to an interval only when its qualifying readings fill at least 80 percent of the interval's half-hours.
- **DP-14 — Timeline brush** The brush can be dragged, resized and stepped by pointer, touch and keyboard in half-hour and one-day steps, and is clamped to the record.
- **DP-15 — Date window and sensor filters** The From and To dates narrow the timeline and reset the brush to that window, and the sensor checkboxes and map footprints choose which sensors a preview uses, as qualified in Interactions.
- **DP-16 — Coverage tide** As the brush changes, the map redraws contributing footprints, covered ground changes from hatching to the covered tint, and the coverage and tonnes numerals count to the server's values, as timed in Motion and effects.
- **DP-17 — Newest brush position wins** A slower preview response for an older brush position never replaces the figure shown for a newer one.
- **DP-18 — Seal armed state** Seal figure is enabled in the accent colour only when the server says the preview is sealable, and is otherwise disabled with its reason in text.
- **DP-19 — Brush settle announcement** After the brush settles, the workspace status region announces the new coverage, tonnes and seal state once, in the published wording.
- **DP-20 — Unit breakdown dialog** The Unit breakdown dialog lists each contributing sensor's area, qualifying half-hours and allocated tonnes, keeps Tab inside, closes on Escape and returns focus to its opener.
- **DP-21 — Explore and preview journey** A flux scientist narrows a project, brushes an interval by pointer and keyboard, shares the workspace URL, and a colleague opening it sees the server's coverage, tonnes, buffer and armed state for exactly that interval.
- **DP-22 — Seal a figure** Sealing an interval creates one Sealed figure that stores the derived values, allocated contributions, coverage, buffer, credited tonnes, fingerprint, sensors and interval, as qualified in Business rules.
- **DP-23 — Canonical readings fingerprint** A figure's fingerprint is the SHA-256 of the published canonical readings file for its interval and sensors.
- **DP-24 — Confirmed evidence bundle** A figure reads Sealed only after the object store confirms the readings file and derivation record under the published keys, and those objects are never rewritten afterwards.
- **DP-25 — Seal notice email** Each seal sends exactly one notice email to the project lead with the published subject and body lines, including the buffer and credited tonnes.
- **DP-26 — Issuance and buffer ledger entries** Each seal writes exactly one issuance entry for the figure's net tonnes and, for a net removal, exactly one buffer entry for the withheld tonnes.
- **DP-27 — Seal refusals** A seal below the coverage floor, overlapping an intact sealed figure, matching an already-sealed interval, made by a non-sealer, or based on changed readings is refused with its published status and copy, in the order stated in Business rules.
- **DP-28 — Seal dialog** The Seal figure dialog shows what will be sealed including buffer and credited tonnes, keeps Tab inside, closes on Escape, shows a pending state while sealing, changes nothing else on the page until the server answers, and moves focus to the new figure on success.
- **DP-29 — Seal journey** A flux scientist seals an armed preview and sees one new Sealed figure, the balance moved by its credited tonnes and its issuance and buffer entries, while the lead receives one notice.
- **DP-30 — Storage outage refusal** When evidence storage is unreachable, a seal is refused with 503 and the published outage copy, and previews keep working.
- **DP-31 — All-or-nothing seal** A seal either records its figure, ledger entries, evidence objects and notice email together, or leaves none of them behind, deleting any objects already written when the mail sink refuses the notice.
- **DP-32 — Outage journey** A flux scientist confirming a seal while evidence storage or the mail sink is unreachable sees the Figures table, ledger and balance unchanged while pending and after the refusal, the matching outage copy, and no new figure, object or email.
- **DP-33 — Seal idempotency keys** A seal retried with the same Idempotency-Key by the same person replays the original stored response on any instance, even after the figure has broken or been superseded, and a reused key with a different request is refused, as qualified in Business rules.
- **DP-34 — Simultaneous seals** Of several simultaneous seals over overlapping intervals of one project, on one or several instances, exactly one succeeds and the rest are refused with the published conflict.
- **DP-35 — Double-click and retry in the browser** Double-clicking Confirm seal, or retrying after a slow response, leaves exactly one figure, one evidence bundle, one set of ledger entries and one notice.
- **DP-36 — Readings ingestion** A data steward ingests half-hourly readings in batches, and each reading is inserted, revised or left unchanged as reported in the response.
- **DP-37 — Ingestion validation and limits** An ingestion batch with any invalid, duplicate or out-of-range reading, or over the size limits, is refused as a whole with field-keyed errors.
- **DP-38 — Reading revision history** Every change to a stored reading keeps its old and new values, its batch and the time it was revised, and successive revisions of one reading chain with no lost update.
- **DP-39 — Seal break and paired reversals** A reading change inside a sealed figure turns that figure Broken and writes, once, one reversal that exactly cancels each of its ledger entries.
- **DP-40 — Broken-seal alert** Each break sends exactly one alert email to the project lead and the sealing scientist, naming how many readings moved, the reversed tonnes and the audit trail, delivered once across instances within the time stated in Services.
- **DP-41 — Broken-seal banner and audit trail** A broken figure shows the published banner, and its audit trail lists each moved reading with old and new values.
- **DP-42 — Re-ingest journey** A data steward re-ingests reprocessed readings, and the flux scientist and project lead then see the figure Broken, its reversals in the ledger, the lower balance and buffer, one alert and the moved readings.
- **DP-43 — Figure state machine** Figures move only from sealed to broken and from broken to superseded, a superseding figure names the figure it replaces, and every other transition is refused with its published status.
- **DP-44 — Re-seal journey** A flux scientist re-seals exactly a broken figure's interval on the new readings, hears the announcement naming the superseded figure, sees its row turn Superseded in place, and the balance still equals the ledger.
- **DP-45 — Balance, buffer and counts agree** The sealed-tonnes balance, the buffer total and the intact, broken and superseded counts in every API response equal the sums of the ledger and the figure list, including straight after a seal or a break.
- **DP-46 — Project lead dashboard** The project list and the project balance strip show the same balance, buffer and counts as the Figures table and the ledger.
- **DP-47 — Phone dashboard journey** At 375 pixels wide, a project lead reads the balance, operates the brush and map by touch, expands the figure sheet, and issues a regulator link from a sealed figure.
- **DP-48 — Issue regulator links** A sealer issues a read-only regulator link for an intact sealed figure, and the link expires at the server-set time stated in Business rules.
- **DP-49 — Server-decided public figure** Every public read of a link has the server decide, at that request, whether the link is live, expired or revoked, re-derive the figure, and return the verdict with its check time.
- **DP-50 — Regulator page** The regulator page shows the server's status, check time, expiry, fingerprint, coverage, buffer and unit breakdown, and offers Re-derive, the audit trail and the readings file download by keyboard.
- **DP-51 — Regulator journey** A regulator with a wrong device clock opens a link, re-derives the figure, reads its audit trail and downloads the readings file, and sees only what the server returned.
- **DP-52 — Link expiry** A link becomes expired at exactly its server-set expiry second on every link surface and then refuses access with 410.
- **DP-53 — Link revocation** A sealer revokes a live link, after which it refuses access with 410, and revoking at or after expiry, or revoking twice, is refused as stated in Business rules.
- **DP-54 — Expired, revoked and unknown link pages** Expired, revoked and unknown links each show their published page copy.
- **DP-55 — Link lifecycle journey** A project lead revokes one link and lets another expire, and a regulator opening either, including a page left open past expiry, sees the matching published page.
- **DP-56 — Responsive layouts** The workspace shows two panes at 1200 pixels and wider, stacked panes from 700 to 1199 pixels and the bottom sheet below 700 pixels, and every screen follows its stated layout at 375x812, 768x1024 and 1280x800 with no horizontal overflow.
- **DP-57 — Reduced motion** With reduced motion, the hatch-to-tint change, the gauge and the counting numerals jump to their final values, and the announcement and armed state stay the same.
- **DP-58 — Keyboard reach and visible focus** Every control in the public controls table can be reached and operated by keyboard in the stated Tab order with a visible focus ring, and the collapsed figure sheet's hidden content is neither focusable nor in the accessibility tree.
- **DP-59 — Field-instrument look** Screens use the paper ground, ink, covered, accent and broken colour roles, hairline rules and survey hatching with no shadows or gradients, and the accent only on actionable state.
- **DP-60 — Instrument numerals and map drawing** Every number is set in the mono face with fixed-width digits, and the boundary map reads as a survey drawing on a metre grid.
- **DP-61 — Buffer withholding** Each sealed net removal withholds a non-permanence buffer computed half-even from the rounded net at the project's buffer percentage, and every preview and figure states its buffer and credited tonnes, as qualified in Business rules.
- **DP-62 — Concurrent ingestion** Ingestion batches and seals of one project are serialised across instances, so simultaneous batches yield exactly one break, one set of reversals and one alert, and no figure stays sealed with a stale fingerprint.
- **DP-63 — Evidence as sealed** The public readings download streams the stored readings file byte for byte, matching the sealed fingerprint even after readings moved, and refuses a stored file that no longer hashes to the fingerprint.
- **DP-64 — Workspace URL state** The workspace URL carries the date window, brush interval and sensors, opening it restores exactly that state and its preview, and invalid values fall back to their defaults in the canonical form.
- **DP-65 — Live project state** The Projects screen, workspace and Figure page refresh from the server on the schedule in Interactions, show breaks and supersessions in place with one announcement, and never disturb the brush, dialogs, sheet or focus.

## Frontend

### Screens and layout (DP-05, DP-08, DP-09, DP-10, DP-41, DP-46, DP-50, DP-54, DP-56)

No screen overflows horizontally at any of the three viewports.

**Sign in** (`/signin`)
- The Fluxseal wordmark, the email and password fields and the Sign in button sit in one narrow column.
- Opening any signed-in screen without a session redirects here.

**Projects** (`/projects`)
- The Projects table has the columns Project, Kind, Sealed net tCO2e, Buffer tCO2e, Intact, Broken and Superseded.
- Below 700 pixels, each row becomes a stacked card with the same labels.

**Project workspace** (`/projects/<slug>`)
- A header shows the project name, kind, coverage floor and buffer percentage.
- Below the header, the layout depends only on the viewport width:
  - **1200 pixels and wider (so 1280x800):** two panes that stay in place while the page scrolls.
    - The left pane is a full-height flux timeline. It holds the date window, the day bars around a horizontal zero rule, the brush and the step buttons.
    - The right pane holds the boundary map on top, then the sensor checkboxes, then the figure panel.
    - Below the panes, the page scrolls through the Project balance strip, the Figures table and the Sealed-tonnes ledger.
  - **700 to 1199 pixels (so 768x1024):** the panes stack in this order: map, timeline, sensors, figure panel. The balance strip and the tables follow.
  - **Below 700 pixels (so 375x812):** the page stacks the map, timeline and sensors. The figure panel becomes a bottom sheet fixed to the bottom of the screen.
    - Collapsed, the sheet shows only the coverage gauge, the net tonnes, Seal figure and Figure details. It is no taller than a third of the viewport height.
    - The rest of the figure panel is hidden and inert while the sheet is collapsed: the Interval, CO2, CH4, Buffer, Credited and Readings values and Unit breakdown. Hidden and inert means it is not visible, cannot be focused, and is absent from the accessibility tree.
    - Figure details expands the sheet to show the whole panel.
    - The tables become stacked cards.

**Figure** (`/projects/<slug>/figures/<figure id>`)
- Shows the figure heading, status, checked-at time, interval, sensors, coverage, the net, CO2, CH4, buffer and credited tonnes, the full fingerprint, the unit breakdown table and Open interval in workspace.
- A broken figure shows the broken banner at the top.
- A superseded figure shows a link to the figure that superseded it next to its status.
- Sealers also see a Regulator links section.

**Audit trail** (`/projects/<slug>/figures/<figure id>/audit`)
- The heading and the Moved readings table.
- An empty trail shows the empty copy from Feedback states.

**Access** (`/admin/access`, admins only)
- A grid with one row per person and one column per project. Each cell is a role picker.

**Regulator figure** (`/r/<token>`) and **regulator audit trail** (`/r/<token>/audit`)
- Public pages, with no navigation and no sign-in.
- The figure page shows the same facts as the Figure screen, read-only, plus the link expiry.
- When a link has ended or is unknown, its page shows only the published heading and line.

On every screen at 700 pixels and wider, the figure and regulator pages keep their content in one column of comfortable reading width. Below 700 pixels, tables become stacked label-and-value cards.

### Public screens and controls (DP-05, DP-08, DP-10, DP-14, DP-15, DP-16, DP-18, DP-20, DP-28, DP-41, DP-46, DP-48, DP-50, DP-53, DP-64)

Only the controls and regions below are public. Placeholders in angle brackets are defined in Business rules and Feedback states.

| Role and accessible name | Screen | Visible copy and notes |
|---|---|---|
| `textbox "Email"`, password field labelled `Password` | Sign in | labels `Email`, `Password` |
| `button "Sign in"` | Sign in | `Sign in` |
| `alert` | every signed-in screen and Sign in | error copy from Feedback states |
| `navigation "Main"` with `link "Projects"`, `link "Access"` (admins only), `button "Sign out"` | signed-in screens | same as names |
| `table "Projects"`, rows with `link "<project name>"` | Projects | columns listed in Screens and layout |
| `heading` level 1 `"<project name>"` | Project workspace | |
| `group "Flux timeline"` | Project workspace | day bars and brush |
| `list "Daily net CO2e"` inside `group "Flux timeline"`, with one `listitem "<YYYY-MM-DD> <signed tonnes> tCO2e"` per UTC day | Project workspace | Each item is that day's bar, for every day in the date window that the timeline API returns, in ascending date order. Its name carries the day's `net_tco2e` in the signed form. A day below zero is drawn wholly below the zero rule, a day above zero wholly above it, and a day of exactly `0.000` as a flat mark on the rule. Bar height grows with the size of the value. |
| `separator "Zero rule"` inside `group "Flux timeline"` | Project workspace | the horizontal zero line the bars hang from |
| date inputs labelled `From` and `To`, `button "Apply dates"` | Project workspace | UTC dates |
| `slider "Interval start"`, `slider "Interval end"` | Project workspace | value text `<start display>` and `<end display>` |
| `slider "Interval position"` | Project workspace | the brush body; value text `<start display> to <end display>` |
| `button "Previous interval"`, `button "Next interval"` | Project workspace | |
| `group "Coverage map"` with `button "<sensor id> footprint"` for each sensor | Project workspace | pressed state mirrors the checkbox |
| `group "Sensors"` with `checkbox "<sensor id>"` for each sensor | Project workspace | label also shows `Tower` or `Satellite cell` |
| `region "Figure"` | Project workspace | a description list of label (term) and value (definition) pairs: `Interval`, `Coverage`, `Net tCO2e`, `CO2 tCO2e`, `CH4 tCO2e`, `Buffer tCO2e`, `Credited tCO2e`, `Readings` |
| Coverage and Net tCO2e values | inside `region "Figure"` | Each of these two definitions holds two parts. The first is the visible counting numeral, hidden from assistive technology with `aria-hidden="true"`; it is the only `aria-hidden` element in that definition. The second is a visually hidden copy that always holds the final server value, `<coverage>%` or `<signed tonnes>`, and is what assistive tech reads. Every other value in the panel shows only its final value. |
| `meter "Coverage"` | inside `region "Figure"` | value is coverage 0 to 100; value text `<coverage>%`; floor tick labelled `Floor <floor>%` |
| `button "Unit breakdown"` | inside `region "Figure"` | opens the dialog below |
| `button "Seal figure"` | inside `region "Figure"` | `Seal figure`; reason text sits directly below it when disabled |
| `button "Figure details"` | below 700 pixels only, inside `region "Figure"` | its expanded state (`aria-expanded`) is `true` only while the sheet is expanded |
| `dialog "Unit breakdown"` with `table "Unit breakdown"`, `button "Close"` | Project workspace | factors from Business rules printed above the table; columns Sensor, Kind, Area m², Qualifying half-hours, CO2 tCO2e, CH4 tCO2e, Net tCO2e; last row `Total` |
| `dialog "Seal figure"` with `button "Confirm seal"`, `button "Cancel"` | Project workspace | interval, sensors, coverage, net, buffer, credited, first 12 fingerprint characters |
| `status "Workspace status"` | Project workspace | polite live region |
| `region "Project balance"` | Project workspace | `Sealed net tCO2e`, `Buffer tCO2e`, `Intact figures`, `Broken figures`, `Superseded figures` |
| `table "Figures"`, rows with `link "<figure id>"` | Project workspace | columns Figure, Interval, Net tCO2e, Buffer tCO2e, Credited tCO2e, Coverage, Status, Checked at |
| `table "Sealed-tonnes ledger"` | Project workspace | columns Entry, Figure, Kind (`Issuance`, `Buffer` or `Reversal`), tCO2e, Recorded at; last row `Balance` |
| `heading` level 1 `"Figure <figure id>"` | Figure | status text `Sealed`, `Broken` or `Superseded` |
| `link "<new figure id>"` | Figure, superseded only | next to the status; opens the superseding figure |
| `link "Open interval in workspace"` | Figure | opens the workspace URL for this figure's interval and sensors |
| `link "Readings audit trail"` | Figure, Regulator figure | |
| `button "Issue regulator link"` | Figure (sealers) | |
| `textbox "Regulator link"` (read-only), `button "Copy link"` | Figure (sealers) | shown after issuing |
| `table "Regulator links"` with `button "Revoke link ending <last six token characters>"` | Figure (sealers) | columns Link, Status (`Live`, `Expired`, `Revoked`), Issued, Expires; Revoke appears only on live links |
| `status "Figure status"` | Figure | polite live region |
| `heading` level 1 `"Readings audit trail for <figure id>"`, `table "Moved readings"` | both audit screens | columns Sensor, Interval start, Old FC, New FC, Old FCH4, New FCH4, Old QC, New QC, Revised at |
| `heading` level 1 `"Sealed figure <figure id>"` | Regulator figure | |
| `button "Re-derive"`, `button "Download readings file"` | Regulator figure | |
| `status "Re-derivation status"` | Regulator figure | polite live region |
| `heading` level 1 `"Access"`, `table "Access"`, `combobox "<person name> on <project name>"` | Access | options `No access`, `Viewer`, `Analyst`, `Sealer` |
| `status "Access status"` | Access | polite live region |

### Interactions (DP-14, DP-15, DP-17, DP-19, DP-20, DP-28, DP-35, DP-47, DP-50, DP-58, DP-64, DP-65)

**Brush**
- The brush covers whole half-hours.
- Mouse and one-finger drag:
  - Dragging a handle resizes that end.
  - Dragging the body moves both ends and keeps the span.
- On `slider "Interval start"` and `slider "Interval end"`:
  - Left or Down moves that end one half-hour earlier; Right or Up moves it one half-hour later.
  - Page Down and Page Up move it one day.
  - Home and End go to the window's start or end.
- On `slider "Interval position"`, the same keys move the whole brush.
- Previous interval and Next interval shift the whole brush by its own span.
- Every change is clamped to the date window and to the record. The span always stays between one half-hour and the whole record, and start always stays before end.

**Previews**
- While the brush is changing, the workspace asks the server for a preview at most a few times per second, and once more when the change stops.
- A response is shown only if it belongs to the newest brush position requested. An older response that arrives late is discarded.
- The brush counts as settled when it has not changed for half a second.
- Once the settled position's preview arrives, `status "Workspace status"` announces it once, with the brush announcement from Feedback states.

**Workspace URL**
- The workspace address always has the canonical form `/projects/<slug>?from=<YYYY-MM-DD>&to=<YYYY-MM-DD>&start=<YYYYMMDDHHMM>&end=<YYYYMMDDHHMM>&sensors=<id>,<id>`:
  - The parameters appear in exactly that order.
  - `start` and `end` are UTC half-hour bounds.
  - Sensor ids are in ascending byte order, joined by literal commas.
  - A project with no readings has no query parameters.
- Opening an address restores exactly that window, brush and sensor set, and the first preview request uses those values.
- When an address is opened, the parameters are checked in three steps:
  1. **Window.** If `from` or `to` is missing or malformed, lies outside the record's first and last UTC days, or `from` is after `to`, the window falls back to the whole record.
  2. **Brush.** If `start` or `end` is missing or malformed, is not on a half-hour, lies outside the window or the record, or `start` is not before `end`, the brush falls back to the whole window.
  3. **Sensors.** If `sensors` is missing, empty, repeats an id or names an unknown id, all sensors are selected.
- After the three steps, the address is replaced with the canonical form, without adding a history entry.
- When the brush settles or a sensor is ticked or unticked, the address is replaced with no new history entry.
- Apply dates adds a new history entry.
- Back and Forward restore the window, brush and sensors from the address and request their preview.

**Date window**
- Apply dates sets the timeline to the chosen UTC days, From through To inclusive, and resets the brush to that whole window. The day bars in `list "Daily net CO2e"` then hold only that window's days.
- If To is before From, the dates are not applied and the window error from Feedback states shows.

**Sensors**
- Each of these includes or excludes that sensor and requests a new preview:
  - ticking or unticking `checkbox "<sensor id>"`
  - tapping or clicking `button "<sensor id> footprint"`
  - pressing Enter or Space on `button "<sensor id> footprint"`
- The checkbox and the footprint button always agree.
- The last selected sensor's controls are disabled, so at least one sensor stays selected.

**Unit breakdown**
- The button opens the dialog with focus on Close.
- Tab and Shift+Tab wrap inside the dialog.
- Escape or Close shuts it and returns focus to Unit breakdown.

**Seal**
- **Opening.** Pressing the enabled Seal figure button opens `dialog "Seal figure"` with focus on Confirm seal. Tab and Shift+Tab wrap inside the dialog. Escape or Cancel closes it and returns focus to Seal figure.
- **Sending.** Confirm seal sends the seal with the shown preview's fingerprint and with a new Idempotency-Key made when the dialog opened.
- **While pending:**
  - A second click does nothing, because the button is disabled and shows the pending copy.
  - The Figures table, the Sealed-tonnes ledger and the Project balance strip keep exactly their pre-seal content. No row, count or numeral changes.
- **No answer.** If the request fails with no answer, or times out after 15 seconds, the dialog offers Confirm seal again and retries with the same key.
- **On success:**
  - The dialog closes.
  - The balance strip, Figures table and ledger refetch. They change only from the refetched server data.
  - Focus moves to the new figure's link in the Figures table.
- **On a refusal:**
  - The dialog stays open and shows the refusal copy in its `alert`. `status "Workspace status"` announces the same copy once.
  - Nothing else on the page changes.
  - Focus stays on Confirm seal, or moves to Cancel if Confirm seal is disabled.
  - On a 403, the workspace refetches the project. The dialog then shows the role copy that matches the role the server now reports.

**Lost access**
- When any request for the open project returns 404, the browser moves to `/projects`.
- The Projects screen shows the lost-access copy from Feedback states in its `alert`, and no longer lists the project.

**Refresh**
- The Projects screen, the project workspace and the Figure page refetch their summary, figures and ledger every 15 seconds while the tab is visible, and once more when it becomes visible.
- No refetch starts while a seal request is pending.
- A refetch updates rows, numerals and statuses in place. It never moves the brush, never closes or resets an open dialog, never collapses an expanded sheet and never moves focus.
- When a refetch shows that a figure in the workspace turned Broken since the previous fetch, `status "Workspace status"` announces it once with the break announcement. Several such figures are announced in one message, in ascending figure id order, separated by a space.
- On the Figure page, a refetch that finds the figure newly superseded announces once in `status "Figure status"`. A refetch that finds it newly broken shows the broken banner.

**Bottom sheet** (below 700 pixels)
- Figure details toggles the sheet between collapsed and expanded.
- While the sheet is expanded, Unit breakdown follows Seal figure in the Tab order, and Figure details comes after Unit breakdown.

**Regulator page**
- Tab order is: Re-derive, Readings audit trail, Download readings file.
- **Re-derive** asks the server again. Every shown value is replaced with the response. If the response says the link has ended, the page switches to that link's ended page. Pending, success and failure are announced in `status "Re-derivation status"`.
- **Download readings file** asks the server for the file:
  - On success, the browser saves it under the server's file name.
  - On a refusal, the page shows the matching copy from Feedback states in its `alert`.
  - On 410, the page switches to the ended page.

**Issuing and revoking links**
- Issue regulator link creates a link and shows it in the read-only textbox, with focus on Copy link.
- Copy link puts the URL on the clipboard.
- A revoke button revokes that link and refreshes the table.

**Access screen**
- Changing a combobox saves at once and announces the result in `status "Access status"`.

**Tab order on the workspace**, by layout:
- **1200 pixels and wider:** main navigation, From, To, Apply dates, Interval start, Interval position, Interval end, Previous interval, Next interval, the map footprint buttons, the sensor checkboxes, Unit breakdown, Seal figure, then the figure links in the tables.
- **700 to 1199 pixels:** main navigation, the map footprint buttons, From, To, Apply dates, Interval start, Interval position, Interval end, Previous interval, Next interval, the sensor checkboxes, Unit breakdown, Seal figure, then the figure links.
- **Below 700 pixels:** the 700 to 1199 order up to the sensor checkboxes, then the sheet's controls, then the figure links. With the sheet collapsed, the sheet's controls are Seal figure, then Figure details.

The day bars and the zero rule are not in the Tab order.

**Touch**
- Below 700 pixels, the brush handles, the body and every footprint respond to one-finger drag or tap.
- Every touch target is at least 44 by 44 pixels.
- Dragging the brush never scrolls the page sideways.

### Visual design (DP-59, DP-60)

- **Colour.**
  - The page ground is a warm, paper-like off-white.
  - Text, rules and outlines are a very dark green-black ink.
  - Covered ground and uptake bars use a muted moss green.
  - A single ochre accent marks only actionable state: the armed Seal figure button, Confirm seal and the focus ring.
  - Oxblood red is used for broken status and the broken banner, and for nothing else.
  - Uncovered parts of the boundary carry fine diagonal ink hatching. Emission bars are ink with the same hatching.
  - The withheld buffer appears in the figure panel as a short bar of sparse hatching beside the net tonnes.
- **Surfaces.** There are no shadows and no gradients anywhere. Panels are separated by hairline ink rules, as on a survey sheet.
- **Type.**
  - Headings use Instrument Serif, which reads as a calm book face with strong contrast between thick and thin strokes.
  - Body text and labels use Instrument Sans.
  - Every number uses IBM Plex Mono with fixed-width digits, so numerals never shift sideways while they count.
  - Each heading level is about one fifth larger than the level below it, starting from body size, so the sizes step up gently.
- **Density.** Spacing is compact, with tight table rows and small gaps between labels and values. Every interactive target is still at least 44 pixels in both directions.
- **Map.**
  - The map is drawn on a local metre grid, with faint grid lines every 100 metres and labelled axes.
  - The boundary has a solid ink outline.
  - Tower footprints have solid outlines and satellite cells have dashed outlines.
  - Sensors that are selected but not contributing show as faint outlines only.
- **Icons.** Icons come from Lucide and are used sparingly.
- **Contrast.** All text and controls meet WCAG 2.2 AA contrast against their ground.

### Motion and effects (DP-16, DP-57)

**Coverage tide (the signature interaction).** Each time a preview response for the newest brush position arrives:

1. The map redraws the footprints of the contributing sensors.
2. Ground that becomes covered fills from hatching to the covered tint, and ground that becomes uncovered returns to hatching. The change takes just under half a second.
3. Over the same time, the coverage gauge's fill slides to the new value against the fixed floor tick.
4. The visible counting numerals for Coverage (one decimal, with %) and Net tCO2e (three decimals, with sign), as defined in Public screens and controls, count from their previous values to the new server values. They show intermediate values for at least the first tenth of a second. They reach the exact final values no more than half a second after the response. Because they are what is drawn on screen, the count can also be seen as a change between screenshots of the figure panel taken during that time.
5. Seal figure switches between armed and disabled as soon as the response arrives.

Every movement starts quickly and settles softly. The accessible values take the final server values at once: the meter value, and the visually hidden copies in the figure panel that assistive tech reads. The tide plays the same way forward and backward. Moving the brush back to an earlier position counts the numerals back and returns covered ground to hatching.

**Other motion:**
- **Dialogs and the bottom sheet.** Dialogs fade and rise in over about a quarter of a second, and leave faster. The bottom sheet slides up over about a quarter of a second when expanded.
- **Refresh updates.** A refetch that changes a status or numeral swaps it in place, with no movement.
- **Hover and press.** Buttons and links gain a hairline underline or outline on hover. On press they darken slightly, in under a tenth of a second.
- **Pending.** The pending copy is static. Nothing spins, pulses or loops.
- **No decoration.** There is no decorative or looping animation anywhere.

**Reduced motion.** When the system asks for reduced motion, the hatch-to-tint change, the gauge fill and the visible counting numerals are replaced by instant changes to the final values, so the visible numeral equals its hidden copy as soon as the response arrives. Dialogs and the sheet appear without movement. The brush announcement, the armed or disabled state and all values stay the same.

### Feedback states (DP-05, DP-08, DP-17, DP-18, DP-19, DP-27, DP-28, DP-30, DP-31, DP-41, DP-44, DP-48, DP-50, DP-53, DP-54, DP-63, DP-65)

This section owns all visible copy. Every apostrophe below is a straight apostrophe.

Display formats:
- `<start display>` and `<end display>` are interval bounds shown as `YYYY-MM-DD HH:MM UTC`.
- `<checked display>` is a server timestamp shown as `YYYY-MM-DD HH:MM:SS UTC`.
- `<expires display>` is the server's `expires_at` shown as `YYYY-MM-DD HH:MM UTC`.

Other placeholders are defined in Business rules.

| Situation | Where | Exact copy |
|---|---|---|
| Wrong email or password | `alert` on Sign in | `That email and password do not match.` |
| Project has no readings | timeline area | `No readings have been ingested for this project yet.` |
| To before From | `alert` | `The To date must be on or after the From date.` |
| Preview failed (network or 5xx) | `alert` | `Could not load the figure for this interval. Move the brush to try again.` |
| Brush settled, sealable | `status "Workspace status"` | `Coverage <coverage>%, net <signed tonnes> tCO2e. Seal available.` |
| Brush settled, below floor | `status "Workspace status"` | `Coverage <coverage>%, net <signed tonnes> tCO2e. Below the <floor>% floor.` |
| Brush settled, other block | `status "Workspace status"` | `Coverage <coverage>%, net <signed tonnes> tCO2e. Seal unavailable.` |
| Below-floor reason, and the matching refusal | text under Seal figure, and the dialog `alert` | `Coverage <coverage>% is below this project's <floor>% floor, so this figure cannot be sealed.` |
| Analyst role, and a seal refused because the role is now analyst | text under Seal figure, and the dialog `alert` | `Your role on this project can preview figures but not seal them.` |
| Viewer role, and a seal refused because the role is now viewer | timeline area, and the dialog `alert` | `Your role on this project can view sealed figures but not preview new ones.` |
| Lost access to the open project | `alert` on Projects | `You no longer have access to this project.` |
| Overlaps an intact sealed figure | text under Seal figure, and the dialog `alert` | `This interval overlaps sealed figure <figure id>. Choose an interval that does not overlap it.` |
| Same interval already sealed | text under Seal figure, and the dialog `alert` | `This interval is already sealed as <figure id>.` |
| Readings changed since preview | dialog `alert` | `Readings in this interval changed since the preview. Check the new figure before sealing.` |
| Seal pending | Confirm seal label, and `status "Workspace status"` | `Sealing...` and `Sealing figure. Waiting for evidence storage to confirm.` |
| Seal succeeded | `status "Workspace status"` | `Sealed <figure id>: <signed tonnes> tCO2e at <coverage>% coverage.` |
| Seal succeeded and supersedes a figure | `status "Workspace status"` | `Sealed <figure id>: <signed tonnes> tCO2e at <coverage>% coverage. Supersedes <old figure id>.` |
| Storage unreachable on seal | dialog `alert` | `Evidence storage is unreachable, so nothing was sealed. Try again in a few minutes.` |
| Mail sink refused the notice | dialog `alert` | `The seal notice could not be sent, so nothing was sealed. Try again in a few minutes.` |
| No answer to a seal | dialog `alert` | `No answer from the server yet. Confirm seal again to retry safely.` |
| A refetch finds a figure newly broken | `status "Workspace status"` | `Seal broken on <figure id>. Its tonnes have been reversed in the ledger.` |
| Broken banner | `alert` at the top of Figure | `Seal broken. Readings moved since sealing: <moved>. Its tonnes have been reversed in the ledger.` |
| A refetch finds the open figure newly superseded | `status "Figure status"` | `Superseded by <new figure id>.` |
| Audit trail empty | both audit screens | `No readings have moved since this figure was sealed.` |
| Link issued | `status "Figure status"` | `Regulator link issued. It expires <expires display>.` |
| Link revoked | `status "Figure status"` | `Link revoked.` |
| Link not issuable | `status "Figure status"` | `Only an intact sealed figure can have a regulator link.` |
| Revoke refused because the link has expired | `status "Figure status"` | `This link has already expired.` |
| Regulator status line | Regulator figure | `Status: Intact`, `Status: Broken` or `Status: Superseded by <figure id>`, then `Checked at <checked display>` |
| Regulator expiry line | Regulator figure | `Link expires <expires display>` |
| Re-derive pending | `status "Re-derivation status"` | `Re-deriving from the stored readings.` |
| Re-derive done | `status "Re-derivation status"` | `Re-derived at <checked display>: Intact.`, `Re-derived at <checked display>: Broken.` or `Re-derived at <checked display>: Superseded.` |
| Re-derive failed | `status "Re-derivation status"` | `Could not re-derive right now. Try again in a few minutes.` |
| Readings file during storage outage | Regulator figure `alert` | `The readings file is unavailable while evidence storage is unreachable. Try again in a few minutes.` |
| Stored readings file does not match | Regulator figure `alert` | `The stored readings file does not match this figure's fingerprint.` |
| Expired link | Regulator page | heading `This link has expired`, line `Ask the project team for a new link.` |
| Revoked link | Regulator page | heading `This link was revoked`, line `The project team withdrew this link.` |
| Unknown link | Regulator page | heading `No sealed figure is published at this link`, line `Check the address you were given.` |
| Grant saved | `status "Access status"` | `Saved access for <person name> on <project name>: <role label>.` |
| Grant failed | `alert` on Access | `Access was not changed. Try again.` |

More placeholders:
- `<role label>` is the chosen option label.
- `<old figure id>` is the new figure's `supersedes`.
- `<new figure id>` is the old figure's `superseded_by`.

Ingestion has no screen; its outcomes are the API responses alone.

## Backend

### API (DP-03, DP-04, DP-05, DP-07, DP-09, DP-10, DP-22, DP-27, DP-30, DP-33, DP-36, DP-37, DP-45, DP-48, DP-49, DP-52, DP-53, DP-63)

**Format**
- Response bodies are JSON (`application/json`) unless an endpoint says otherwise.
- The media type is decided by the request's `Content-Type` header alone, before the body is read.
  - A request with a non-empty body whose `Content-Type` media type is not `application/json` gets `415 {"error":"unsupported_media_type"}`, even if the body happens to be valid JSON.
  - Parameters such as `charset=utf-8` are ignored.
  - A request whose `Content-Type` is `application/json` but whose body does not parse as JSON gets `400 {"error":"invalid_json"}`.
  - An empty body is treated as `{}` and skips the media type check.

**Body limits**
- Request bodies may be at most 65,536 bytes; a body of exactly 65,536 bytes is allowed.
- Ingestion is the exception: it allows at most 2,000,000 bytes, and exactly 2,000,000 is allowed.
- Anything larger gets `413 {"error":"payload_too_large"}`.

**Sessions**
- Signed-in endpoints use the session cookie set at sign-in.

**Timestamps**
- Every timestamp in API bodies and in emails is UTC in the exact form `YYYY-MM-DDTHH:MM:SSZ`, with seconds always present and no fractional seconds, for example `2026-06-03T00:00:00Z`.
- Server-recorded times are truncated to whole seconds.
- A request timestamp in any other form gets the 422 for its field.
- Dates in query strings are `YYYY-MM-DD`.

**Values**
- Tonnes and percentages are strings, in the formats from Business rules.

**Error shapes**
- Every error is either `{"error":"<code>"}`, optionally with the extra fields named per endpoint, or, for validation, `422 {"errors":{"<field>":"<message>"}}`.
- Field keys are exact. Messages are free text.

**Error precedence**, for the whole API:

1. transport errors (415, 400, 413)
2. `403 {"error":"cross_origin"}`, for a non-GET request refused by the cross-site rule in Server boundary
3. `401 {"error":"unauthenticated"}`
4. `404 {"error":"not_found"}`, for an unknown resource or a project the caller cannot see
5. `403 {"error":"forbidden"}`, for a visible project where the caller's role is insufficient
6. idempotent replay or key conflict
7. 422 validation
8. 409 state conflicts, and 410 for ended links, in the order the endpoint's rule in Business rules gives
9. 503 dependency unavailable

Endpoint rows below name only their own extra errors.

**Shared objects**

The project **summary**:

```
{"sealed_net_tco2e":"<tonnes>","buffer_tco2e":"<tonnes>","intact_count":n,"broken_count":n,"superseded_count":n}
```

A **figure**:

```
{"id","project","start","end","sensor_ids":[...],"status":"sealed|broken|superseded",
 "supersedes":null|"<figure id>","superseded_by":null|"<figure id>",
 "coverage_pct","floor_pct","net_tco2e","co2_tco2e","ch4_tco2e",
 "buffer_pct","buffer_tco2e","credited_tco2e",
 "readings_count":n,"fingerprint":"<64 lowercase hex>","sealed_at","sealed_by":"<person id>",
 "checked_at","contributions":[{"sensor_id","kind":"tower|satellite","area_m2":n,
 "qualifying_half_hours":n,"half_hours":n,"co2_tco2e","ch4_tco2e","net_tco2e"}],
 "evidence":{"readings_key","derivation_key"}}
```

`contributions` lists contributing sensors only, in ascending byte order of sensor id.

A **preview** has the same derived fields as a figure: `start`, `end`, `sensor_ids`, `coverage_pct`, `floor_pct`, `net_tco2e`, `co2_tco2e`, `ch4_tco2e`, `buffer_pct`, `buffer_tco2e`, `credited_tco2e`, `readings_count`, `fingerprint` and `contributions`. It also has:

```
"sealable":bool,
"blocked_reason":null|"below_coverage_floor"|"overlaps_sealed"|"already_sealed"|"role",
"blocking_figure_id":null|"<figure id>"
```

`blocked_reason` is checked in that order: below floor, overlap, already sealed, then role.

**Endpoints**

| Method and path | Request | Success | Extra errors |
|---|---|---|---|
| `GET /api/health` | – | `200 {"status":"ok"}` | – |
| `POST /api/session` | `{"email","password"}` | `200 {"person":{"id","name","email","org_role":"admin|steward|member"}}` plus an HttpOnly, SameSite=Lax, Path=/ session cookie that lasts `SESSION_TTL_SECONDS` | `401 {"error":"invalid_credentials"}` |
| `DELETE /api/session` | – | `204` | – |
| `GET /api/me` | – | `200 {"person":{...}}` | – |
| `GET /api/projects` | – | `200 {"projects":[{"slug","name","kind","floor_pct","buffer_pct","role","summary"}]}`, visible projects only | – |
| `GET /api/projects/<slug>` | – | `200 {"slug","name","kind","code","floor_pct","buffer_pct","lead_person_id","boundary":[[x,y],...],"boundary_area_m2":n,"sensors":[{"id","kind","polygon":[[x,y],...]}],"record_start":null|ts,"record_end":null|ts,"role","summary"}` | – |
| `GET /api/projects/<slug>/timeline?from=YYYY-MM-DD&to=YYYY-MM-DD` | both optional | `200 {"days":[{"date","net_tco2e","coverage_pct"}]}`, days with readings only, ascending | `422` keys `from`, `to` |
| `POST /api/projects/<slug>/preview` | `{"start","end","sensor_ids":[...]}` | `200 <preview>` | 403 for viewers; `422` keys `start`, `end`, `sensor_ids` |
| `POST /api/projects/<slug>/figures` with header `Idempotency-Key` | `{"start","end","sensor_ids":[...],"preview_fingerprint"}` | `201 <figure>`; a replay returns the stored status and body byte for byte, with header `Idempotent-Replay: true` | 403 for non-sealers; `409 {"error":"idempotency_key_conflict"}`; `422` keys `Idempotency-Key`, `start`, `end`, `sensor_ids`, `preview_fingerprint`; `409 {"error":"readings_changed","fingerprint"}`; `409 {"error":"below_coverage_floor","coverage_pct","floor_pct"}`; `409 {"error":"interval_overlaps_sealed","figure_id"}`; `409 {"error":"already_sealed","figure_id"}`; `503 {"error":"storage_unavailable"}`; `503 {"error":"mail_unavailable"}` |
| `GET /api/projects/<slug>/figures` | – | `200 {"figures":[<figure>...],"summary"}`, newest first | – |
| `GET /api/projects/<slug>/ledger` | – | `200 {"entries":[{"id","figure_id","kind":"issuance|buffer|reversal","tco2e","reverses":null|"<entry id>","recorded_at"}],"balance_tco2e","buffer_tco2e"}`, oldest first | – |
| `GET /api/figures/<figure id>` | – | `200 <figure>`, re-derived at this read, with `"rederived":{"fingerprint","coverage_pct","net_tco2e","matches":bool}` | – |
| `GET /api/figures/<figure id>/audit` | – | `200 {"figure_id","moved":[{"sensor_id","interval_start","old":null|{"fc","fch4","qc"},"new":{"fc","fch4","qc"},"revised_at","batch_id"}]}`, ordered by revised_at, then sensor id, then interval | – |
| `POST /api/figures/<figure id>/links` | `{}` | `201 {"id","token","url","status":"live","issued_at","expires_at"}` | 403 for non-sealers; `409 {"error":"figure_not_sealed"}` |
| `GET /api/figures/<figure id>/links` | – | `200 {"links":[{"id","token","url","status","issued_at","expires_at","revoked_at"}]}`, with status decided at this request | 403 for non-sealers |
| `POST /api/figures/<figure id>/links/<link id>/revoke` | `{}` | `200 {"id","status":"revoked","revoked_at"}` | 403 for non-sealers; `409 {"error":"link_expired"}`; `409 {"error":"link_revoked"}` |
| `GET /api/public/links/<token>` | none, no session | `200 {"link":{"status":"live","expires_at"},"project":{"name","kind"},"figure":<figure, re-derived as above>}` | `410 {"error":"link_expired","expires_at"}`; `410 {"error":"link_revoked","revoked_at"}`; 404 |
| `POST /api/public/links/<token>/rederive` | `{}` | same as the GET, with a fresh `checked_at` | same as the GET |
| `GET /api/public/links/<token>/audit` | – | same body as the figure audit | same as the GET |
| `GET /api/public/links/<token>/evidence` | – | `200` with the stored readings file bytes and the headers `Content-Type: text/csv`, `Content-Disposition: attachment; filename="<figure id>-readings.csv"` and `X-Fluxseal-Fingerprint: <figure fingerprint>` | same as the GET; `503 {"error":"storage_unavailable"}`; `409 {"error":"evidence_mismatch"}` (decided only after the stored bytes are read, so it comes after the 503) |
| `POST /api/projects/<slug>/readings` | `{"readings":[{"sensor_id","interval_start","fc","fch4","qc"}]}` | `200 {"batch_id","inserted":n,"revised":n,"unchanged":n,"broken_figures":["<figure id>"...]}` | 403 unless the caller's org role is steward; `422` keys `readings` or `readings[<i>].<field>` |
| `GET /api/access` | – | `200 {"people":[{"id","name","email","org_role"}],"projects":[{"slug","name"}],"grants":[{"person_id","project","role"}]}` | 403 for non-admins |
| `PUT /api/projects/<slug>/grants/<person id>` | `{"role":"viewer|analyst|sealer"}` | `200 {"person_id","project","role"}` | 403 for non-admins; 404 for an unknown person; `422` key `role` |
| `DELETE /api/projects/<slug>/grants/<person id>` | – | `204`, also when no grant existed | 403 for non-admins; 404 for an unknown person |

**Validation for previews and seals**
- `start` and `end` must be in the API timestamp form, on an exact `:00` or `:30` UTC minute with zero seconds.
- `start` must be earlier than `end`.
- `start` must be no earlier than `record_start`, and `end` no later than `record_end`.
- `sensor_ids` must be a non-empty list of distinct ids of this project's sensors.
- `Idempotency-Key` must be 1 to 100 visible ASCII characters. When it is missing, the 422 uses key `Idempotency-Key`.

**Validation for ingestion**
- `readings` must hold 1 to 5,000 entries; 5,000 is allowed.
- `sensor_id` must be one of this project's sensors.
- `interval_start` must be an exact half-hour, as above.
- `fc` must be a number from -100 to 100 inclusive, with at most four decimals.
- `fch4` must be a number from -1000 to 5000 inclusive, with at most four decimals.
- `qc` must be the integer 0, 1, 2 or 3.
- The same sensor and interval may appear only once in a batch. A repeat gets key `readings[<i>]`.
- Any error refuses the whole batch.

### Business rules (DP-06, DP-07, DP-11, DP-12, DP-13, DP-22, DP-23, DP-26, DP-27, DP-31, DP-33, DP-34, DP-38, DP-39, DP-43, DP-45, DP-48, DP-49, DP-52, DP-53, DP-61, DP-62)

**Number formats.** These placeholders are used across the brief:
- `<tonnes>` is tonnes CO2e to three decimals, with a leading `-` when negative and no sign otherwise. API bodies and emails use it.
- `<signed tonnes>` is the same value with a leading `+` when positive, a leading `-` when negative, and no sign for `0.000`. Screens and announcements use it.
- `<coverage>`, `<floor>` and `buffer_pct` are percentages to one decimal, without the % sign in the API.

Negative tonnes mean net removal. All rounding is half to even, applied only where this section says, to exact decimal values. Binary floating point is never used.

**Roles**
- Org roles:
  - `admin` alone manages grants. An admin's effective role on each project is the higher of viewer and their grant, so an admin with a sealer grant can seal.
  - `steward` may ingest into every project of the organisation. For ingestion, every project counts as visible to a steward.
  - `member` has no extra rights.
- Project grants:
  - `viewer` sees the project, timeline, figures, ledger and audit trails.
  - `analyst` can also preview.
  - `sealer` can also seal, and issue and revoke regulator links.
- A project with no grant, for someone who is not an admin, is invisible and gives 404.
- Grants are read from the database on every request. A change applies to that person's next request on every instance, including in sessions that are already open.
- Removing or lowering a grant never revokes links already issued.
- The project lead is a project attribute. It decides who receives emails and grants no rights by itself.

**Qualifying and contributing**
- A reading qualifies when its `qc` is 0 (measured) or 1 (good-quality gap-fill).
- An interval of `n` half-hours runs from `start` inclusive to `end` exclusive.
- A selected sensor contributes when it has qualifying readings for at least 80 percent of those `n` half-hours. Exactly 80 percent contributes.
- Sensors that do not contribute add neither area nor tonnes.

**Coverage geometry**
- Boundaries, tower footprints and satellite cells are simple polygons in metres on the project's local grid.
- Area is allocated to contributing sensors in this order: towers first, in ascending byte order of sensor id, then satellite cells in the same order.
- Each sensor gets the area of its polygon that lies inside the boundary, minus area already allocated. Towers therefore take precedence over cells, and no ground is counted twice.
- Each allocated area is rounded to whole square metres.
- `coverage_pct` is the sum of the allocated areas divided by the boundary area, times 100, rounded to one decimal.
- A preview is at the floor when its rounded coverage is at or above `floor_pct`. The rounded value is the one compared.

**Unit chain.** For each contributing sensor with allocated area `A` square metres, summed exactly over its qualifying readings in the interval:
- CO2 tonnes = sum of FC (µmol CO2 per m² per s) × 1800 s × 0.00004401 g/µmol × A ÷ 1,000,000.
- CH4 tonnes CO2e = sum of FCH4 (nmol CH4 per m² per s) × 1800 s × 0.00000001604 g/nmol × 27.0 (GWP100) × A ÷ 1,000,000.
- A sensor's exact net is its exact CO2 plus its exact CH4.

The figure's totals are rounded from the exact sums:
- `co2_tco2e` and `ch4_tco2e` are the rounded totals.
- `net_tco2e` is the rounded exact sum, so it may differ by 0.001 from the sum of the rounded parts.
- Timeline day values are previews over all project sensors for each UTC day. Their `coverage_pct` is that day's coverage.

**Contribution allocation.** Contributions are not rounded one by one. Each of the three columns `co2_tco2e`, `ch4_tco2e` and `net_tco2e` is allocated separately, so that it sums exactly to the figure's rounded total for that column:
1. Floor each sensor's exact value toward negative infinity at 0.001. For example, -2.8797 floors to -2.880.
2. Compute the remainder count `R` = (rounded total − sum of floors) ÷ 0.001. It is always between 0 and the number of contributing sensors.
3. Add 0.001 to the `R` sensors whose exact value minus floor is largest. Ties go to ascending byte order of sensor id.

The Unit breakdown dialog, the Figure page and the regulator page all show these allocated values.

**Buffer.** Let `N` be the figure's rounded `net_tco2e`.
- If `N` is below zero (a net removal):
  - `buffer_tco2e` = round_half_even(|N| × `buffer_pct` ÷ 100, 3), computed from the rounded `N`, never the exact net;
  - `credited_tco2e` = N + buffer.
- If `N` is zero or above:
  - `buffer_tco2e` is `0.000`;
  - `credited_tco2e` equals N.

Previews and figures both carry these values.

**Canonical readings file and fingerprint**
- The file is UTF-8 text with Unix newlines and a final newline.
- The first line is `sensor_id,interval_start,fc,fch4,qc`.
- After it comes one line per stored reading of the selected sensors in the interval, qualifying or not. Lines are ordered by sensor id in ascending byte order, then by interval start.
- Each line is `<sensor id>,<YYYYMMDDHHMM UTC interval start>,<fc>,<fch4>,<qc>`.
  - `fc` and `fch4` have exactly four decimals and a leading `-` only when negative, so zero is `0.0000`.
  - `qc` is a single digit.
- `readings_count` is the number of reading lines.
- The fingerprint is the lowercase hex SHA-256 of the file bytes.

**Figure states**
- **Sealing an interval.** A seal creates a figure directly in `sealed`. Previews are never stored. The server re-derives at seal time, and the stored figure holds those values.
- **Sealing preconditions.** After the checks earlier in the error precedence, a seal's state checks run in this order. The first that applies is returned, with its 409 body from API:
  1. `readings_changed`: the request's `preview_fingerprint` differs from the fingerprint re-derived now.
  2. `below_coverage_floor`: the coverage re-derived now is below the floor.
  3. `interval_overlaps_sealed`: an intact sealed figure of the project overlaps the interval without having exactly the same start and end.
  4. `already_sealed`: an intact sealed figure of the project has exactly the same start and end.

  Checks 3 and 4 cannot both apply. Intervals that only touch, end to start, do not overlap. A seal touches storage or mail only after all four checks pass, so a 409 never yields a 503.
- **Legal transitions:**
  - `sealed` → `broken`, when a reading change alters a sealed figure's fingerprint. This posts its reversals.
  - `broken` → `superseded`, when a new seal has exactly the broken figure's start and end. The old figure's `superseded_by` names the new figure, and the new figure's `supersedes` names the old one. No ledger entry is written for the old figure.
- **Illegal transitions.** No other transition exists:
  - A broken or superseded figure never returns to sealed.
  - A superseded figure never changes again.
  - A seal over an intact figure's exact interval is `already_sealed`.
  - Issuing a link for a broken or superseded figure is `409 figure_not_sealed`.
- Broken and superseded figures do not block new seals.
- If several broken figures share the new seal's exact interval, only the most recently sealed one that is not yet superseded is superseded.

**Ledger**
- Every successful seal writes one `issuance` entry whose `tco2e` equals the figure's `net_tco2e`.
- When the figure is a net removal, the seal also writes one `buffer` entry whose `tco2e` equals `buffer_tco2e`. That value is positive, so it reduces the credited removal.
- Every break writes one `reversal` per entry of that figure. Each reversal's `tco2e` is the exact negation of its entry, and its `reverses` names that entry.
- Entries are never edited or deleted.
- `balance_tco2e` and `summary.sealed_net_tco2e` always equal the sum of all entries, which also equals the sum of `credited_tco2e` over figures with status `sealed`.
- The ledger's `buffer_tco2e` and `summary.buffer_tco2e` always equal the sum of buffer entries and their reversals, which also equals the sum of `buffer_tco2e` over figures with status `sealed`.
- `intact_count`, `broken_count` and `superseded_count` count figures by status.
- Every response that carries these values computes them from the same committed state, so they agree straight after a seal or a break.

**Seal atomicity.** A seal has one outcome, made of the figure row, its ledger entries, both evidence objects confirmed as in Services, and the notice email accepted by the mail sink.
- If storage is unreachable or does not confirm the objects, the seal returns `503 storage_unavailable` within 10 seconds.
- If the mail sink refuses the notice after the objects were stored and confirmed, the server deletes both objects and returns `503 mail_unavailable`.
- In either case, no figure row, ledger entry, email or object under that attempt's `figures/<figure id>/` remains. The figure id that attempt took is never reused.

**Seal idempotency**
- `Idempotency-Key` is scoped to the signed-in person and kept for `IDEMPOTENCY_TTL_SECONDS`. The same key used by two people means two independent keys.
- A repeat by the same person with the same key and the same request (same start, end, set of sensor ids and preview fingerprint) returns the stored 201 status and body byte for byte, and changes nothing. This holds:
  - after that figure has been broken or superseded, so the replayed body still says `"status":"sealed"`;
  - after a later seal has made the same request a 409;
  - on any instance sharing the database, including one whose storage or mail sink is unreachable, because a replay never touches storage or mail.
- The same key with a different request gets `409 idempotency_key_conflict`.
- Only successful seals are stored against a key. A key whose attempt was refused (any 409 or 503) is not stored, and a later request with it is evaluated afresh.
- Requests with the same person and key are handled one at a time across instances. Once one succeeds, every request with that key answered afterwards receives its replay.
- Of simultaneous seals with different keys whose intervals overlap in one project, on any instances, exactly one returns 201. Each other one gets `already_sealed` when its interval matches the winner exactly, and `interval_overlaps_sealed` otherwise.

**Serialisation per project**
- Ingestion batches and seals of the same project run one at a time, in the order the database grants them, across all instances. Different projects do not wait for each other.
- When a seal and a batch that revises readings in its interval run at the same moment, exactly one of two outcomes happens:
  - the seal runs second and is refused with `readings_changed`; or
  - the seal runs first and succeeds, and the batch then breaks it.
- No figure with status `sealed` ever has a stored fingerprint that differs from the fingerprint re-derived from current readings.

**Ingestion and revisions**
- A reading is identified by its sensor and interval start.
- A new reading is `inserted`.
- An existing reading whose canonical `fc`, `fch4` or `qc` differs is `revised`. The stored values change, and a revision row keeps the old values, new values, batch id and time.
- Successive revisions of one reading chain: each revision's old values equal the previous revision's new values, so no update is lost.
- An identical reading is `unchanged`.
- A batch is all or nothing.

**Breaking**
- In the same commit as a batch, every `sealed` figure whose interval and sensors include an inserted or revised reading is re-derived. If its fingerprint differs:
  - it becomes `broken`;
  - its reversals are written;
  - it is listed in that batch's `broken_figures`;
  - its alert is queued.
- `<moved>` is the number of distinct readings in that figure's scope that changed in the breaking batch only.
- Of several simultaneous batches that change readings inside one sealed figure, exactly one breaks it. Exactly one response lists it in `broken_figures`, so there is one set of reversals and one alert.
- A figure that is already broken is not broken again. It gets no new reversal and no new alert, but its audit trail keeps growing.
- Every read of a single figure, internal or public, re-derives its fingerprint from current readings and sets `checked_at` to the read time. A sealed figure always matches, because of the serialisation rule.
- Lists show stored statuses, with `checked_at` from the last re-derivation.
- The audit trail lists every revision or insertion in the figure's scope after `sealed_at`. An inserted reading has `old` set to null.

**Regulator links**
- Tokens are random, with at least 32 URL-safe characters.
- `url` is `<APP_PUBLIC_URL>/r/<token>`.
- `expires_at` is exactly `issued_at` plus `LINK_TTL_SECONDS`, at whole seconds.
- On every request to every link surface, the server decides the status from one read of its own clock. The surfaces are the public GET, rederive, audit and evidence endpoints, the sealer links list, and revoke. The status is:
  - `revoked` if the link was revoked;
  - otherwise `expired` once the server time is at or after `expires_at`;
  - otherwise `live`.
- Every response from these surfaces carries an HTTP `Date` header taken from that same clock read. A response describing a link as live always has a `Date` earlier than `expires_at`. A response describing it as expired always has a `Date` at or after `expires_at`.
- Revoking at or after `expires_at` is `409 link_expired`, even when the link was revoked earlier. Revoking a revoked link before `expires_at` is `409 link_revoked`. Revoking a live link sets `revoked_at`.
- A link opens exactly one figure, read-only.
- Links stay live when their figure breaks or is superseded, and show that status.
- The pages never compute link or figure status from the browser clock or from a cached answer.

### Services (DP-24, DP-25, DP-30, DP-31, DP-40, DP-63)

**Postgres** stores:
- the organisation, people, org roles and grants;
- projects, boundaries, buffer percentages, sensors and footprints;
- readings and their revisions;
- figures and their contributions;
- ledger entries, idempotency records, links and sessions;
- the outgoing alert queue.

The database named in `DATABASE_URL` always exists when the server starts, though it may be empty. The server never creates or drops databases. It applies the schema and seed data idempotently on every start.

**Object store** (bucket from `S3_BUCKET`, created at start if missing)
- Each seal writes two objects:
  - `figures/<figure id>/readings.csv` holds the canonical readings file, with content type `text/csv` and user metadata `sha256` equal to the fingerprint.
  - `figures/<figure id>/derivation.json` holds the figure body, JSON-equal to the seal's 201 body.
- The figure counts as stored only after the server reads back each object's metadata and confirms that the readings object's size and `sha256` match.
- The objects are never rewritten after the seal.
- The public evidence download streams the stored `readings.csv` object, never a file regenerated from current readings. It hashes the bytes it fetched. If they do not hash to the figure's `fingerprint`, it returns the `evidence_mismatch` 409 from API. The object's metadata alone never counts as proof.
- When storage is unreachable:
  - seals return `storage_unavailable` with the storage copy from Feedback states;
  - the public evidence download returns its 503;
  - previews, timelines, figure reads, re-derivation, links, ingestion and idempotent replays keep working, because they need only Postgres.

**Mail** (SMTP at `SMTP_HOST`:`SMTP_PORT`)
- The From header is `MAIL_FROM`, which the environment sets to `Fluxseal <seals@sedgemoor.example>`. Use that same value when `MAIL_FROM` is unset.
- There is one email per event.

*Seal notice.* One per seal, to the project lead only. The seal succeeds only once the mail sink has accepted it.

Subject: `Sealed <figure id>: <tonnes> tCO2e at <coverage>% coverage`

Body lines, exactly:

```
Figure: <figure id>
Project: <project name>
Interval: <start> to <end>
Net: <tonnes> tCO2e
Buffer: <buffer tonnes> tCO2e
Credited: <credited tonnes> tCO2e
Coverage: <coverage>%
Fingerprint: <first 12 fingerprint characters>
```

`<start>` and `<end>` are the figure's interval bounds in the API timestamp form. The subject's `<tonnes>` and the `Net:` line both carry `net_tco2e`.

*Broken-seal alert.* One per break, as a single message addressed to the project lead and the person who sealed the figure. An address that is both appears once.

Subject: `Seal broken on <figure id> (readings moved: <moved>)`

Body lines, exactly:

```
Figure: <figure id>
Readings moved: <moved>
Reversed: <tonnes> tCO2e
Audit trail: <APP_PUBLIC_URL>/projects/<slug>/figures/<figure id>/audit
```

- `Reversed:` carries the sum of that break's reversal entries. That sum is the negation of the figure's `credited_tco2e`.
- Alerts are queued in the same commit as the break.
- Every instance tries to send queued alerts straight after a break it committed, and every 30 seconds after that, until the sink accepts them.
- Each queued alert is claimed by exactly one instance at a time and sent once.
- While at least one instance with a reachable mail sink is running, every alert is delivered within 60 seconds of its break.

### Seed data (DP-01, DP-05, DP-06, DP-10, DP-11, DP-12, DP-13, DP-61)

Every seeded person, organisation and project is invented. The organisation is Levelmoor Restoration Trust. Every seeded password is `moss-and-tower-26`.

| Id | Name | Email | Org role | Grants |
|---|---|---|---|---|
| `p-ines` | Ines Okafor | `ines@levelmoor.example` | admin | – |
| `p-priya` | Priya Nand | `priya@levelmoor.example` | steward | viewer on all three projects |
| `p-tomas` | Tomas Reyes | `tomas@levelmoor.example` | member | sealer on blackmere-moss, analyst on saltings-reach |
| `p-hal` | Hal Brennan | `hal@levelmoor.example` | member | sealer on all three; lead of all three |
| `p-odile` | Odile Marsh | `odile@levelmoor.example` | member | analyst on blackmere-moss |
| `p-wren` | Wren Adeyemi | `wren@levelmoor.example` | member | viewer on blackmere-moss |

Polygons below are rectangles, given as the corners (x1,y1)–(x2,y2) in metres.

**blackmere-moss**, "Blackmere Moss" (kind `peatland rewetting`, code `BM`, floor 60.0, buffer 15.0)

- Boundary: (0,0)–(1000,600).
- Towers:
  - `BM-T1`: (100,100)–(500,500)
  - `BM-T2`: (400,200)–(800,500)
- Satellite cells:
  - `BM-S1`: (0,0)–(500,300)
  - `BM-S2`: (500,0)–(1000,300)
  - `BM-S3`: (0,300)–(500,600)
  - `BM-S4`: (500,300)–(1000,600)
- Readings, every half-hour:
  - Each tower runs from interval start 2026-06-01T00:00:00Z to interval start 2026-06-14T23:30:00Z, all with qc 0:
    - `BM-T1`: fc -3.0 for intervals starting 06:00 to 17:30 UTC and 1.5 otherwise; fch4 15.0.
    - `BM-T2`: fc -2.0 for intervals starting 06:00 to 17:30 UTC and 1.0 otherwise; fch4 30.0.
  - Every satellite cell runs from interval start 2026-06-03T00:00:00Z to interval start 2026-06-14T23:30:00Z, with fc -1.0 and fch4 10.0. The qc is 0, except `BM-S4`, which has qc 3 from interval start 2026-06-08T00:00:00Z onward.

**saltings-reach**, "Saltings Reach" (kind `wetland restoration`, code `SR`, floor 50.0, buffer 10.0)

- Boundary: (0,0)–(800,500).
- Tower `SR-T1`: (200,100)–(600,400).
- Cells:
  - `SR-S1`: (0,0)–(400,500)
  - `SR-S2`: (400,0)–(800,500)
- Readings: every half-hour from interval start 2026-06-01T00:00:00Z to interval start 2026-06-14T23:30:00Z, all with qc 0:
  - `SR-T1`: fc -1.5, fch4 40.0
  - cells: fc -0.5, fch4 25.0

**hollin-wood**, "Hollin Wood" (kind `managed forest`, code `HW`, floor 70.0, buffer 20.0)

- Boundary: (0,0)–(400,400).
- Tower `HW-T1`: (0,0)–(400,300).
- Cell `HW-S1`: (0,0)–(400,400).
- No readings.

There are no seeded figures, ledger entries or links. With the seed data, blackmere-moss and saltings-reach have `record_start` `2026-06-01T00:00:00Z` and `record_end` `2026-06-15T00:00:00Z` (the end of the last half-hour). Hollin-wood has null bounds.

Figure ids are the project code, `-F` and a four-digit sequence per project starting at `0001`, for example `BM-F0001`. Ids are never reused, and there may be gaps.

**Worked examples, with the seed data at start and all of a project's sensors selected.**

*Blackmere Moss, whole record* (`2026-06-01T00:00:00Z` to `2026-06-15T00:00:00Z`)
- `BM-S4` does not contribute (240 of 672 half-hours qualify), so coverage is `85.0`.
- Net `-16.808`, CO2 `-20.647`, CH4 `3.839`, buffer `2.521`, credited `-14.287`, 3648 readings. Sealable.
- Allocated contributions:

  | Sensor | Area m² | Qualifying half-hours | CO2 tCO2e | CH4 tCO2e | Net tCO2e |
  |---|---|---|---|---|---|
  | `BM-S1` | 70000 | 576 | `-3.194` | `0.314` | `-2.880` |
  | `BM-S2` | 120000 | 576 | `-5.475` | `0.539` | `-4.936` |
  | `BM-S3` | 70000 | 576 | `-3.194` | `0.314` | `-2.880` |
  | `BM-T1` | 160000 | 672 | `-6.388` | `1.257` | `-5.131` |
  | `BM-T2` | 90000 | 672 | `-2.396` | `1.415` | `-0.981` |

  Rounded one by one, the columns would sum to `-20.648`, `3.838` and `-16.809`. The allocated values above sum exactly to the figure's totals.
- Sealing this figure writes an issuance entry of `-16.808` and a buffer entry of `2.521`, so the balance becomes `-14.287` and the buffer total `2.521`.
- Breaking it writes reversals of `16.808` and `-2.521`. The balance returns to `0.000`, and the alert reads `Reversed: 14.287 tCO2e`.

*Blackmere Moss, other intervals*

| Interval | Coverage | Net | CO2 | CH4 | Buffer | Credited | Readings | Notes |
|---|---|---|---|---|---|---|---|---|
| `2026-06-01T00:00:00Z` to `2026-06-03T00:00:00Z` | `41.7` | `-0.873` | `-1.255` | `0.382` | | | | towers only; blocked as `below_coverage_floor` |
| `2026-06-03T00:00:00Z` to `2026-06-08T00:00:00Z` | `100.0` | `-8.182` | `-9.791` | `1.609` | `1.227` | `-6.955` | 1440 | |
| `2026-06-08T00:00:00Z` to `2026-06-15T00:00:00Z` | `85.0` | `-9.295` | `-11.312` | `2.017` | | | | |
| `2026-06-04T00:00:00Z` to `2026-06-04T06:00:00Z` (a night emission) | `100.0` | `0.061` | `-0.019` | `0.080` | `0.000` | `0.061` | 72 | all six sensors contribute; sealing writes only an issuance entry of `0.061` |

Allocated areas in the 2026-06-03 to 2026-06-08 interval:

| Sensor | Area (m²) |
|---|---|
| `BM-T1` | 160000 |
| `BM-T2` | 90000 |
| `BM-S1` | 70000 |
| `BM-S2` | 120000 |
| `BM-S3` | 70000 |
| `BM-S4` | 90000 |

*Blackmere Moss, timeline day bars.* With the whole record as the window, `list "Daily net CO2e"` holds 14 items, all uptake, drawn below the zero rule:

| Days | Net | Coverage | Bar name, for example |
|---|---|---|---|
| 2026-06-01 and 2026-06-02 | `-0.437` | `41.7` | `2026-06-01 -0.437 tCO2e` |
| 2026-06-03 to 2026-06-07 | `-1.636` | `100.0` | `2026-06-03 -1.636 tCO2e` |
| 2026-06-08 to 2026-06-14 | `-1.328` | `85.0` | `2026-06-08 -1.328 tCO2e` |

*Blackmere Moss, an emission day after re-ingest.* Suppose a data steward ingests one batch that sets `fc` to `5.0` for all 96 readings of `BM-T1` and `BM-T2` on 2026-06-01 (interval starts 00:00 to 23:30 UTC), keeping fch4 and qc unchanged. The response reports `revised` 96. The timeline day 2026-06-01 then has net `4.944` at coverage `41.7`. Its bar, named `2026-06-01 +4.944 tCO2e`, is drawn wholly above the zero rule, while 2026-06-02 stays below it.

*Saltings Reach*
- Allocated areas: `SR-T1` 120000, `SR-S1` 140000, `SR-S2` 140000.
- Every day bar is net `-0.775` at coverage `100.0`.
- Whole record: coverage `100.0`, net `-10.854`, CO2 `-17.035`, CH4 `6.181`, buffer `1.085`, credited `-9.769`, 2016 readings.
- `2026-06-05T10:00:00Z` to `2026-06-05T12:00:00Z`:
  - Coverage `100.0`, net `-0.065`, CO2 `-0.101`, CH4 `0.037`, 12 readings.
  - The buffer is an exact tie: 0.065 × 10.0 ÷ 100 = 0.0065, which rounds half-even to `0.006` (half-up would give 0.007). Credited is `-0.059`.
  - Allocated contributions:

    | Sensor | CO2 | CH4 | Net |
    |---|---|---|---|
    | `SR-S1` | `-0.022` | `0.011` | `-0.011` |
    | `SR-S2` | `-0.022` | `0.011` | `-0.012` |
    | `SR-T1` | `-0.057` | `0.015` | `-0.042` |

    In the net column, `SR-S1` and `SR-S2` tie on remainder, and the tie goes to `SR-S1`.

## Technical requirements

### Deployment (DP-01)

- **Runtime.** Node.js 22 and npm are available. The app is written in TypeScript.
- **Run manifest.** `/app/run.json` holds the string fields `install`, `build` and `serve` and `"_schema":"run-manifest-v1"`, for example:

  ```json
  {"_schema":"run-manifest-v1","install":"npm ci","build":"npm run build","serve":"npm run start"}
  ```
- **Port.** The server binds `0.0.0.0` on port 4173, or on `APP_PUBLIC_PORT` when that is set.
- **Health.** `GET /api/health` answers `200 {"status":"ok"}` as soon as the server listens, whether or not the object store or mail sink is reachable.

### Configuration and secrets (DP-02)

The server reads these at start:

- `DATABASE_URL`
- `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_FORCE_PATH_STYLE`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`
- `SMTP_HOST`, `SMTP_PORT`, `MAIL_FROM`
- `APP_PUBLIC_URL`, `APP_PUBLIC_PORT`
- `LINK_TTL_SECONDS`: a whole number of seconds, default 2,592,000 (30 days).
- `IDEMPOTENCY_TTL_SECONDS`: a whole number of seconds, default 86,400 (24 hours).
- `SESSION_TTL_SECONDS`: a whole number of seconds, default 43,200 (12 hours).

No value is hard-coded beyond these stated defaults. None is sent to the browser or written to logs.

### Server boundary (DP-03)

**Origin**
- Everything is same-origin. The server sends no CORS allowances and never echoes a request's `Origin`. The browser loads fonts, icons and scripts only from the app's own origin.
- **Cross-site refusal.** A non-GET request to `/api/` is refused with the `cross_origin` 403 from API in either of these cases:
  - its `Origin` header is present and its host and port differ from the request's `Host` header;
  - its `Sec-Fetch-Site` header is `cross-site`.

  Requests with neither header, such as ingestion pipelines and command-line clients, are unaffected. The check behaves the same on every instance.

**What is served**
- The body limits and transport errors are those in API.
- The server never serves source files, the manifest, environment files, credentials, or presigned object-store URLs. Evidence reaches browsers only through the app's own evidence endpoint.
- Unknown `/api/` paths get 404 with the not-found shape. Other unknown paths get the app shell.

**Unreachable dependencies at boot**
- If the object store or mail sink is unreachable at boot, the server still starts and serves. Each later action that needs that dependency gets its 503.
- If Postgres is unreachable at boot, the server retries for up to 60 seconds before exiting.

**Several instances at once.** Several app processes may run at the same time against the same database, bucket and mail sink, each on its own port. Some run with a different environment, for example an unreachable object store or mail sink. Every rule in this brief holds across all of them together, because all shared state and every lock lives in Postgres:
- A session cookie issued by one instance is valid on every instance that shares its database.
- Figure ids are allocated in the database, so no two instances ever issue the same id.
- These rules apply across instances:
  - idempotency keys and replays;
  - the simultaneous-seal winner rule;
  - the coverage-floor and overlap checks;
  - per-project serialisation of seals and ingestion.
- Each queued broken-seal alert is sent by exactly one instance.
- Applying the schema and seed at start is safe when two instances start at once.

### Browser support and performance (DP-56)

- **Browsers and viewports.** Current Chromium, Firefox and WebKit, at 375x812, 768x1024 and 1280x800, and at any width between them by the breakpoints in Screens and layout.
- **Load time.** With the seed data, the workspace is usable within three seconds of navigation.
- **Previews.** A preview for the whole Blackmere Moss record answers within two seconds.

## Working rules

- IF-01: `/app/run.json` exists with exactly the string fields `_schema` (`run-manifest-v1`), `install`, `build` and `serve`.
- IF-02: `THIRD_PARTY_NOTICES.md` at `/app` lists every shipped package and every bundled font and icon set with its licence, where shipped packages means the production dependency tree as reported by `npm ls --omit=dev --all --json`.
- IF-03: Every shipped package (the same production dependency tree) and every bundled asset is licensed MIT, ISC, BSD-2-Clause, BSD-3-Clause, Apache-2.0, 0BSD or OFL-1.1.
- IF-04: The app uses no datastore other than the provided Postgres, object store and mail sink: no SQLite, Redis, embedded databases, or local files used as storage.
- IF-05: The provided service configuration and its credentials are left unchanged.
- IF-06: Application source is TypeScript; hand-written JavaScript appears only as build output or tool configuration.

## Engineering standards

- Code is idiomatic TypeScript with strict type checking on. Names match this brief's domain terms: figure, reading, revision, coverage floor, contribution, buffer, credited tonnes, ledger entry, issuance, reversal, regulator link.
- Each domain rule is decided in exactly one place in the source. These include the unit chain, coverage allocation, contribution allocation, the buffer, the contributing rule, the canonical serialisation, figure transitions, seal precondition order, link status, the cross-origin check and the ledger balance.
- Every API error is produced through one consistent error shape and the single precedence order in this brief.
- Per-project serialisation and alert claiming use database locks, not in-process locks or timers.
- There is no abstraction with only one implementation, and no dead, commented-out or unreachable code.
- There are no defensive checks for states that the database constraints or state rules already make impossible.
- Tonnes, buffer and coverage are computed with exact decimal arithmetic, never binary floating point.
- There are no features, screens, endpoints or settings beyond this brief.
