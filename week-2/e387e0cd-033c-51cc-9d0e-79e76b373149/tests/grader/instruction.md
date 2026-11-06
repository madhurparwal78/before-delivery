# Lanternline Handshake Desk

Lanternline Handshake Desk is a shared desk for the compliance teams of licensed crypto exchanges. It handles the Travel Rule data that has to go with every customer withdrawal and the data that arrives with every deposit. Two exchanges use it, each in its own business time: Neris Digital, licensed in Lithuania and working in Vilnius time, and Kallang Exchange, licensed in Singapore and working in Singapore time. For each withdrawal the desk finds the exchange that owns the destination address and works out the fiat value at the rate in force. It decides whether the originator and beneficiary data must travel, sends that data and holds the funds until the receiving exchange answers. It also takes in signed messages from other exchanges and keeps them exactly as received, bills message usage each business month and produces the regulator's monthly file. The server keeps its records in PostgreSQL. Original messages and licence certificates go to MinIO, monthly invoices to Kill Bill, and outgoing mail through Mailpit. The following are out of scope: customer self-service, real blockchain networks or real addresses, real fiat rates fetched from anywhere, sign-up, password reset, single sign-on and any datastore other than these four services.

## Problem and users

Before every customer withdrawal leaves, a licensed exchange's compliance team has to do the same work. They find which exchange owns the destination address and work out whether its fiat value, at the rate in force, reaches the jurisdiction's threshold. They send the originator and beneficiary data to that exchange and hold the funds until it answers. For deposits they take in the signed data other exchanges send, keep it exactly as received and check the named beneficiary against their own customer. Today this is spread over several tools. A vendor messaging network can't reach exchanges in jurisdictions that have no rule yet (the "sunrise" problem). The counterparty list was copied over from a spreadsheet. Data requests to exchanges off the network are chased by hand through mail, and the regulator's monthly file is put together by hand. This costs in four places. Withdrawals sit frozen for hours. Penalties follow when a threshold change takes effect on a date nobody tracked. Examiners raise findings when a case shows a rule or a counterparty name it was not decided under. Message fees are disputed every month because nobody can show that the invoice matches the messages.

Users:

- **Compliance officer** (daily): runs the workspace and its members, announces threshold changes that take effect on a chosen date, records the reason to release a case after No response, archives closed cases, manages partner keys and the public listing, and hands the regulator's monthly file to the examiner.
- **Compliance analyst** (daily): opens withdrawal cases, takes review cases and decides Accept or Reject with a reason, records customers' wallet-ownership confirmations, and keeps counterparty due diligence current.
- **Operations lead** (daily): releases a held withdrawal only when the server says it may, or returns it.
- **Finance lead** (occasional): closes a business month so that its fee lines, its invoice and its mail land together.
- **Support agent** (daily): answers customer questions about a held withdrawal and sees personal data masked everywhere.
- **Counterparty exchange** (daily, machine): posts signed Travel Rule messages and answers to the workspace's message endpoint.
- **Counterparty compliance contact** (occasional): answers a data request from an exchange that is not on the message network. They use a private data request page sent by mail, often on a phone, and attach their exchange's licence certificate.
- **Exchange backend** (daily, machine): creates outgoing withdrawal cases with a partner key and gets exactly one case per repeated request.
- **Public visitor** (weekly): looks up a jurisdiction's rule in force and any announced change, and finds listed exchanges.

## Journeys

1. **A withdrawal to an exchange on the network.** Start: Neris Digital's analyst is signed in on Withdrawals. The analyst opens Create case and enters ETH 0.3 to Harbourgate Digital Assets Ltd's registered address for a seeded customer. The address bar shows the new case. The Handshake track shows Screened, Counterparty found and Data sent done, and Answered waiting, with an amber marker and a countdown. Harbourgate posts a signed Accepted answer. On the next poll the token glides to Answered and its ring fills. The operations lead presses Release. End: Closed reads Released, each station shows its stamp in Vilnius time, and the status region reads the release copy. Later, after the retention time, the compliance officer sees the case's personal data erased, archives the case and brings it back unchanged.
2. **A withdrawal to an exchange off the network.** Start: a Neris case to Tallinn Star Exchange OÜ. The desk mails Tallinn Star's compliance contact a private data request page. On a phone, the contact opens the page, chooses Accepted, attaches the licence certificate and taps Send answer. End: the page reads the answered copy and the case's Answered station reads Accepted. If nobody answers in time, the case shows No response. The officer then records a reason, and the operations lead may release.
3. **A review case.** Start: a case to the Restricted counterparty Baltic Rail Crypto UAB sits in the review queue. Two analysts press Claim at the same moment. One gets the claim. The other sees and hears who claimed it and when. The winner chooses Accept, types a reason and saves. End: the case moves on along the counterparty path. A late second decision is refused, naming who decided and when, and the typed reason stays in the dialog.
4. **Counterparties brought over.** Start: an analyst on Counterparties. The analyst uploads the previous tool's spreadsheet and reads a preview that marks each row matched, new or refused, with its row number and reason. The analyst saves, then saves the same file again. End: the second save reports nothing created and nothing updated. The analyst renames a counterparty. The new name shows across the desk, while cases already sent keep the old name and the counterparty page lists it under Previous names.
5. **A threshold change and the examiner's file.** Start: Kallang's compliance officer on Rules. The officer announces a change to Singapore's threshold that takes effect today. A case created before the change keeps the old rule and a case created after it uses the new one, on the case page, the daily report and the regulator's monthly file. End: the officer downloads the month's file, and its rows show the rule each case was decided under.
6. **An incoming deposit.** Start: Harbourgate posts a signed transfer message for a Neris customer's deposit address. The desk stores the exact bytes and checks the beneficiary name. End: the analyst opens the message, sees the name check result and downloads the original, which is byte for byte what was sent.
7. **A month close.** Start: Neris's finance lead on Months, where last month reads Ready to close. The finance lead opens Close month and confirms. End: the month reads Invoiced, its fee lines show one line per tier, Kill Bill holds one invoice with one item per tier, and the finance lead receives one mail.
8. **A public visitor.** Start: the public home page. The visitor filters the directory to Europe and In force, searches for an exchange and goes Back and Forward through those choices. They open a jurisdiction to read its rule and any announced change, then open a listed exchange. End: the address bar reflects every committed choice. On a phone, the filters live in a bottom sheet.

## Mandatory requirements

This is the complete list of mandatory requirements; every check traces to one of these lines and the detailed sections below.

- **DP-01 — Staff sign-in without account hints.** Staff sign in with email and password and sign out through the API, and a wrong password and an unknown email get the identical refusal status and body.
- **DP-02 — Members managed by the compliance officer.** The compliance officer lists members, adds a member with a starting password and a role who can then sign in, changes that member's role and removes them, after which they can no longer sign in, as qualified in API.
- **DP-03 — Member records fenced by workspace and role.** A member id of the other workspace answers not found exactly like an unknown id and leaves that member unchanged, and every role other than compliance officer is refused on the member endpoints.
- **DP-04 — Jurisdiction directory and pages.** The public jurisdiction directory and each jurisdiction page show the rule status, the threshold in the jurisdiction's own currency, the date the rule took or takes effect and any announced change.
- **DP-05 — Exchange search held in the address.** Region, status and search live in the address with one history entry per committed change, and the exchange list always shows the results of the latest input even when an earlier request answers later.
- **DP-06 — Withdrawn listings answer gone.** A compliance officer withdraws their workspace's listing, which then answers 410 with the published gone copy and leaves the directory, search and the sitemap until it is listed again.
- **DP-07 — Public layout, menus and motion.** The public directory is two columns from 1120 px wide and one column with a bottom filter sheet below, header menus are keyboard menus, and the network band and stats band follow the motion rules including reduced motion.
- **DP-08 — Public directory journey.** A public visitor filters, searches and moves Back and Forward through the directory, opens a jurisdiction and an exchange, and uses the filter sheet at 375x812 by keyboard and touch; its screen meets the journey checks.
- **DP-09 — Threshold changes on a chosen business date.** The compliance officer announces a threshold change that takes effect at 00:00 business time on a chosen date, today or later, as qualified in Business rules, and an earlier date or a second change for the same jurisdiction and date is refused.
- **DP-10 — Cases keep the rule they were decided under.** A case keeps the threshold rule, rate and counterparty name it was decided under on its page, its track, the daily report and the regulator's monthly file after any later change.
- **DP-11 — Daily report per business day.** The daily report covers one business day from local midnight to the next and shows its start and end instants and its length in hours, 23 and 25 on the Vilnius changeover days.
- **DP-12 — Announce change journey.** The compliance officer announces a change through the Announce change dialog by keyboard alone, sees a refusal in the dialog's Problems summary with everything kept, and lands on the jurisdiction's rules route; its screen meets the journey checks.
- **DP-13 — Counterparty records with checked LEI and notes limit.** Adding a counterparty checks the LEI's check digits and stores it upper case, editing never changes the LEI, and adding or editing holds notes to 2,000 Unicode code points, with 2,000 accepted and 2,001 refused.
- **DP-14 — Renames show everywhere and keep history.** A renamed counterparty shows its new name wherever the counterparty itself is shown at once, every record of data already sent keeps the name as sent, and its page lists previous names with their business dates.
- **DP-15 — Spreadsheet import with preview and matching.** A spreadsheet import previews each row as matched by LEI, matched by normalised legal name, new or refused with its row number and reason before saving, and saving the same file twice changes nothing.
- **DP-16 — Counterparty sheet journey.** An analyst adds a counterparty in the sheet and lands on its route, the sheet stays open when reopened during its exit, and the saved message survives the next repaint; its screen meets the journey checks.
- **DP-17 — Withdrawal case creation.** A compliance analyst creates a withdrawal case through the Create case dialog, the destination address finds its counterparty through the address registry or marks the wallet self-hosted, and the address bar shows the case's route.
- **DP-18 — Exact amounts and fiat value.** Amounts are kept exactly in each asset's precision and the fiat value is the exact product with the rate in force, rounded half up to the cent.
- **DP-19 — Case path decided at creation.** Each case follows exactly one published path, decided from the counterparty's due diligence, the thresholds and limits in force and the counterparty's jurisdiction rule, and a Blocked counterparty refuses the case.
- **DP-20 — Answer window edge and No response.** An answer arriving at or after the end of the answer period is too late and the case reads No response from that instant on.
- **DP-21 — Release and return guarded by the server.** The operations lead releases a case only in the published releasable states, including No response with the compliance officer's recorded reason, and may return any open case.
- **DP-22 — Self-hosted ownership confirmation.** A self-hosted case worth more than the confirmation limit waits at Ownership until an analyst records the customer's confirmation with its business date, and one at or under the limit needs none.
- **DP-23 — Handshake track states.** The Handshake track shows five stations whose label, data-state, data-at and visible text follow the published table for every case path, taken from the server's record.
- **DP-24 — Handshake track keyboard and detail sheet.** The track is one keyboard composite with a single Tab stop moved by arrows, Home and End, and Enter opens the station's detail sheet that keeps Tab inside, closes on Escape and returns focus to the station.
- **DP-25 — Handshake track motion, touch and pointer.** On each server step the token glides, the reached ring fills and the stamp fades in at the same moment with the published durations, all shown at once under reduced motion, and a mouse shows the tooltip while a tap opens the sheet.
- **DP-26 — Withdrawal follow-through journey.** The operations lead follows a case to release with every state and countdown from the server even with the device clock hours off, and the No response copy stays on the page and in the live region after the next poll; its screen meets the journey checks.
- **DP-27 — Signed messages from counterparty exchanges.** The message endpoint takes in a counterparty exchange's message only when its signature over the timestamp, a dot and the exact raw bytes matches within 300 seconds either way.
- **DP-28 — Originals kept byte for byte.** Each accepted message is stored byte for byte before the desk answers, and Download original gives exactly the received bytes while the desk works from a separate working copy.
- **DP-29 — Repeated message ids.** The same message id with the same bytes answers the first result and stores nothing new, and with different bytes is refused.
- **DP-30 — Beneficiary name check.** An incoming transfer's beneficiary name is compared with the receiving customer's name by the published normalisation and shows Match, Partial or No match.
- **DP-31 — Incoming message journey.** An analyst opens the incoming list and a message page by keyboard alone and downloads the original, and at 1024x768 and below the page is one column with its facts in a sheet that is hidden and inert when closed; its screen meets the journey checks.
- **DP-32 — One winner per review claim.** Of two analysts claiming one review case at the same moment exactly one wins, the other is refused naming who claimed and when, and the claim lapses at its published end.
- **DP-33 — Review decisions and stale decisions.** An analyst holding the claim decides Accept or Reject with a reason, and a decision on a case already decided is refused naming who decided and when.
- **DP-34 — Personal data masked for support agents.** A support agent gets name initials, the last four characters of the identity number and no date of birth in every API response and on every screen.
- **DP-35 — Review queue journey.** An analyst claims and decides from the review queue by keyboard alone, and losing a claim or deciding stale shows the published copy on the page and in the live region with the typed reason kept, still shown after the next poll; its screen meets the journey checks.
- **DP-36 — Private data request pages by mail.** A case to an off-network counterparty mails its compliance contact a private data request page address, and the page shows only the case reference, asset, amount, masked addresses and the requesting exchange's name.
- **DP-37 — Data request page endings.** A data request page ends at its end time, when a new one is sent for the case or when staff end it, and then answers 410 with the published ended copy.
- **DP-38 — Licence certificate checks.** A licence certificate is accepted only as PNG, JPEG or WebP judged by content, at most 5,000,000 bytes, stored with location data removed and orientation kept, and refused with nothing stored while storage is unreachable.
- **DP-39 — Data request answer journey.** A compliance contact answers by touch at 375x812 with a sticky Send answer bar that never covers the focused control, sees live or ended as the server says with the clock hours off, and the case's Answered station follows; its screen meets the journey checks.
- **DP-40 — Fee lines per business month.** Each business month's fee lines count its messages sent and received per published tier and price each tier in integer cents rounded half up per line.
- **DP-41 — Month close all together or not at all.** Closing an ended month records its fee lines, one invoice with one item per tier and one mail to the finance lead together, closes once when pressed twice, and records nothing while invoicing is unreachable.
- **DP-42 — Month close journey.** The finance lead closes a month through the Close month dialog by keyboard, sees Invoiced only after the invoice returns, lands on the month's route, and keeps the outage copy on screen after every repaint; its screen meets the journey checks.
- **DP-43 — Regulator's monthly file format.** The regulator's monthly file is UTF-8 CSV with every field quoted, CRLF lines and a header row, neutralises cells beginning with the published characters, and carries the rule and counterparty name each case was decided under.
- **DP-44 — Regulator's file masking and download limit.** A support agent's file carries masked values only, and a member's sixth download within the window answers 429 with Retry-After in whole seconds.
- **DP-45 — Regulator's files journey.** The files screen shows the published copy for each state and at 1024x768 and below is one column with its month picker in a sheet that is hidden and inert when closed; its screen meets the journey checks.
- **DP-46 — Erasure after the retention time.** A closed case's personal data is erased from the database, the stored certificates and the stored messages after the retention time, only SHA-256 digests remain, and when the case reads Erased none of its stored objects remains in storage.
- **DP-47 — Archive and bring back exactly.** The compliance officer archives a closed case and brings it back exactly as it was, with the same Handshake track history.
- **DP-48 — Retention journey.** The compliance officer sees scheduled, erased and archived states with their published copy as the server reports them, even with the device clock hours off; its screen meets the journey checks.
- **DP-49 — Partner case creation with request keys.** The exchange backend creates cases with a partner key, a repeated request key answers the first response and creates nothing, the same key with a different body is refused, and amounts come back exactly.
- **DP-50 — Partner rate limit.** A partner key's 31st case request within the rate window answers 429 with Retry-After in whole seconds.
- **DP-51 — Partner keys journey.** The compliance officer creates a key shown once, sees each key's last use in business time and revokes a key through a confirmation dialog, after which it answers 401 at once; its screen meets the journey checks.
- **DP-52 — Role landing routes and reloadable addresses.** Sign-in lands each role on its published home route and every published route shows the same screen when reloaded or opened directly.
- **DP-53 — One API contract.** Every API path follows the one error-precedence ladder, the published conventions for keys, enums, amounts, money and instants, 405 with Allow, 415, 404 for unpublished paths, and 404 for another workspace's records.
- **DP-54 — Exact starting data.** A fresh copy on its own empty database and bucket starts with exactly the published seed records and nothing else.
- **DP-55 — Sessions ending mid-work.** A session ends after the session time and the next request answers the published session-ended body while the screen keeps what was typed and puts it back after signing in again, and a removed member's next action is refused with the published copy.
- **DP-56 — Published layouts at every viewport.** Every screen shows its published layout at 375x812, 768x1024, 1024x768 and 1280x800 with no sideways overflow, no covered control and controls at least 44 px in both directions.
- **DP-57 — Accessible and keyboard-complete screens.** Every staff journey works by keyboard, dialogs and sheets manage focus as published, closed ones are hidden and inert, and an automated WCAG 2.2 AA check passes on every screen, and with each of its dialogs, menus and sheets open at the viewports where that one exists.
- **DP-58 — One motion system.** Every motion uses exactly 160, 320 or 640 ms as browser-run transitions or animations, stops or ends at once under reduced motion, and follows each event's pointer type.
- **DP-59 — Nocturnal, exact visual design.** Every screen sits on the near-black blue ground with amber only on cases waiting for an answer and every amount, LEI and instant in tabular mono numerals.
- **DP-60 — Real services wired from configuration.** The source reads every service credential and URL from the environment and records cases, objects, invoices and mail in the real services rather than in app-side stand-ins.

## Frontend

### Screens and layout (DP-07, DP-08, DP-12, DP-16, DP-26, DP-31, DP-35, DP-39, DP-42, DP-45, DP-48, DP-51, DP-52, DP-56)

One breakpoint governs every two-column or one-line layout: **1120 px wide**. At 1280x800 a screen shows its wide layout. At 1024x768, 768x1024 and 375x812 it shows its narrow layout. No other breakpoint between those sizes changes which layout a published viewport gets. Nothing scrolls sideways at any size.

**Staff frame.** Every staff screen has a narrow left rail (`navigation "Workspace"`) listing the sections the member's role may open. The rail's header shows the workspace name and the city whose time the screen uses (`Vilnius time` or `Singapore time`). Next to the rail is the work column. From 1120 px an evidence column sits on the right. Below 1120 px the rail becomes a top bar with a `button "Sections"` that opens the bottom sheet `dialog "Sections"`, and the evidence column moves under the work column.

| Route | Level-1 heading | Roles | Wide (from 1120 px) | Narrow (below 1120 px) |
|---|---|---|---|---|
| `/sign-in` | `Sign in to Lanternline` | anyone | centred form | same, full width |
| `/w/<slug>/cases` | `Withdrawals` | all staff | case table in the work column, filter select beside it | table becomes a stacked card list |
| `/w/<slug>/cases/<case id>` | `Case <reference>` | all staff | Handshake track on one line across the top of the work column, evidence column on the right, action bar under the track | track stacked top to bottom, evidence under the work column, action bar sticky at the bottom of the viewport |
| `/w/<slug>/review` | `Review queue` | officer, analyst, support (read only) | queue table plus a claim panel on the right | one column, claim panel under the table |
| `/w/<slug>/messages` | `Incoming messages` | officer, analyst, operations, support | table | stacked cards |
| `/w/<slug>/messages/<message id>` | `Message <messageId>` | officer, analyst, operations, support | working copy in the work column, `region "Message facts"` on the right | one column. The facts move into the bottom sheet `dialog "Message facts"`, opened by `button "Show facts"` |
| `/w/<slug>/counterparties` | `Counterparties` | all staff | table | stacked cards |
| `/w/<slug>/counterparties/<counterparty id>` | the current legal name | all staff | details, then `list "Previous names"` and `table "Cases sent"` in the evidence column | one column |
| `/w/<slug>/counterparties/import` | `Import counterparties` | officer, analyst | file picker over the preview table | one column |
| `/w/<slug>/rules` | `Rules` | all staff | rules table plus a summary of the workspace's own rule on the right | one column |
| `/w/<slug>/rules/<jurisdiction code>` | `<Jurisdiction name> rules` | all staff | rule history table | one column |
| `/w/<slug>/reports/daily` | `Daily report` | officer, analyst | date picker and day facts above the transfers table | one column |
| `/w/<slug>/months` | `Months` | officer, finance | months table | stacked cards |
| `/w/<slug>/months/<YYYY-MM>` | `<Month YYYY>` (for example `September 2026`) | officer, finance | fee lines table plus invoice facts on the right | one column |
| `/w/<slug>/files` | `Regulator's monthly files` | officer, analyst, support | month picker rail on the left of the download panel | one column. The month picker moves into the bottom sheet `dialog "Choose month"`, opened by `button "Choose month"` |
| `/w/<slug>/partner-keys` | `Partner keys` | officer | keys table | one column, stacked cards |
| `/w/<slug>/members` | `Members` | officer | members table | stacked cards |
| `/w/<slug>/listing` | `Directory listing` | officer | listing panel | one column |

Home routes after sign-in: the compliance officer, compliance analyst, operations lead and support agent land on `/w/<slug>/cases`. The finance lead lands on `/w/<slug>/months`. Reloading or opening any route in the table directly shows the same screen. A signed-out visit to a staff route shows `/sign-in`, then returns to that route after sign-in.

**Public pages.** These have a header with the wordmark and two menu buttons. Under the header, a full-width network band holds a procedural illustration of exchanges as nodes joined by connectors, with small packets travelling along the connectors. Under the band are the stats band and then the directory.

| Route | Level-1 heading | Wide (from 1120 px) | Narrow (below 1120 px) |
|---|---|---|---|
| `/` | `Every withdrawal, answered before it leaves` | filter rail on the left. Directory results in two columns side by side: `list "Jurisdictions"` and `list "Listed exchanges"` | one column: jurisdictions above exchanges. The filters live in the bottom sheet `dialog "Filters"`, opened by `button "Filters"` |
| `/jurisdictions/<code>` | the jurisdiction's name | rule panel next to the jurisdiction's listed exchanges | one column |
| `/exchanges/<listing slug>` | the exchange's name, or `Listing withdrawn` when withdrawn | details panel | one column |
| `/r/<token>` | `Travel Rule data request` | single centred column | single column with a sticky bottom bar holding `button "Send answer"` |
| any unknown page | `Page not found` | centred | centred |

On every screen, a bottom sheet or sticky action bar never covers the tapped or focused control. When focus moves into a field behind the bar, the page scrolls so the field sits fully above the bar.

### Public screens and controls (DP-04, DP-05, DP-06, DP-08, DP-12, DP-16, DP-17, DP-23, DP-24, DP-31, DP-35, DP-39, DP-42, DP-45, DP-51, DP-57)

Only the roles, names and attributes below are public. Everything else is free. Every list, table and track below renders even when it is empty, with its accessible name. "First" marks the control that gets focus when a dialog or sheet opens.

**Shared**

| Role and name | Where | Visible copy and default |
|---|---|---|
| `status "Desk status"` | every staff screen, including sign-in | the live region for staff feedback copy |
| `status "Directory status"` | public pages | announces `<n> exchanges match` (`1 exchange matches`) after each search or filter change |
| `status "Request status"` | data request page | the live region for the contact |
| `region "Problems"` | every form, in a page or a dialog | heading `Problems`, then one link per field error, each with the field's error text. A link moves focus to its field |
| `navigation "Workspace"` | staff rail | links for the role's sections, in this order: `Withdrawals`, `Review queue`, `Incoming messages`, `Counterparties`, `Rules`, `Daily report`, `Months`, `Regulator's files`, `Partner keys`, `Members`, `Directory listing`, then `button "Sign out"` |
| `button "Sections"` and `dialog "Sections"` | staff, below 1120 px | the sheet holds the same links. First: the first link |

**Sign-in.** `textbox "Email"` (first), `textbox "Password"`, `button "Sign in"`.

**Withdrawals.** `button "Create case"`. `combobox "Show"` with options `Open` (default), `Closed` and `Archived`. `table "Withdrawal cases"` with columns Reference, Created, Amount, Fiat value, Counterparty, Status and Answer due. Each Reference is a link to the case. The Counterparty column shows the counterparty's current name, or `Self-hosted wallet`.

**Create case dialog.** `dialog "Create case"` contains:
- `combobox "Asset"` (first) with options BTC (default), ETH, USDC and SOL;
- `textbox "Amount"`;
- `textbox "Destination address"`;
- `combobox "Customer"` (default `Choose a customer`, then the workspace's customers by name);
- `textbox "Beneficiary name"`;
- `button "Create case"` and `button "Cancel"`.

**Case page.**
- `toolbar "Handshake track"` holds five station `button`s. Each carries `data-station` with the value `screened`, `counterparty`, `data_sent`, `answered` or `closed`. Each also carries `data-state` and, once reached, `data-at` (see the track table below). A station's accessible name is its visible label, text and stamp in reading order.
- `tooltip` shows the station's label and stamp when a mouse points at the station.
- `dialog "<station label>"` is the station detail sheet, for example `dialog "Answered"`. First: `button "Close"`. It lists the label, the stamp and the step's facts: `Name as sent`, `Rule`, `Rate`, `Fiat value` and `Answer`.
- `region "Evidence"` shows the counterparty's current name as a link, the name as sent, the rule, rate, fiat value and threshold the case was decided under, the originator, the beneficiary name, the data request page state and the retention state.
- `timer "Answer countdown"` reads `Answer due in <H:MM:SS>` while the case waits for an answer.
- `region "Case actions"` holds whichever of these the role and state allow: `button "Release"`, `button "Return withdrawal"`, `button "Record ownership"`, `button "Record reason"`, `button "Send new request page"`, `button "End request page"`, `button "Archive case"` and `button "Bring back"`. A button the server does not allow shows as disabled. The case's `releaseAllowed` value alone enables `Release`.
- `dialog "Return withdrawal"` contains `textbox "Reason"` (first), `button "Return withdrawal"` and `button "Cancel"`.
- `dialog "Record ownership"` contains `textbox "Confirmed on"` (first, a business date in the YYYY-MM-DD form, default today's business date), `button "Record"` and `button "Cancel"`.
- `dialog "Record release reason"` contains `textbox "Reason"` (first), `button "Save reason"` and `button "Cancel"`.

**Handshake track table.** Station labels are `Screened`, `Counterparty found`, `Data sent`, `Answered` and `Closed`. `data-state` is one of `pending`, `current`, `done`, `late`, `refused` or `not_required`. `data-at` is the step's whole-second UTC instant (for example `2027-04-06T08:00:00Z`). It is present only on `done`, `late` and `refused` stations. Each cell gives `data-state: visible text`. While a case is open, exactly one station is `current`. The stamp under a reached station is its instant in the screen date-time format.

| Path | Screened | Counterparty found | Data sent | Answered |
|---|---|---|---|---|
| On-network, waiting | done: `Address checked` | done: `<name as sent>` | done: `Message sent` | current: `Waiting for answer` |
| Answered Accepted | done: `Address checked` | done: `<name as sent>` | done: `Message sent` or `Request page sent` | done: `Accepted` |
| Answered Rejected | done: `Address checked` | done: `<name as sent>` | done: `Message sent` or `Request page sent` | refused: `Rejected` |
| No response | done: `Address checked` | done: `<name as sent>` | done: `Message sent` or `Request page sent` | late: `No response` (`data-at` is the answer due instant) |
| Off-network, waiting | done: `Address checked` | done: `<name as sent>` | done: `Request page sent` | current: `Waiting for answer` |
| Sunrise | done: `Address checked` | done: `<name as sent>` | done: `Message sent` or `Request page sent` | not_required: `No rule in force` |
| Below threshold | done: `Address checked` | done: `<name as sent>` | not_required: `Below threshold` | not_required: `Not required` |
| Self-hosted, over the limit, waiting | done: `Address checked` | done: `Self-hosted wallet` | done: `Ownership` | current: `Ownership pending` |
| Self-hosted, confirmed | done: `Address checked` | done: `Self-hosted wallet` | done: `Ownership` | done: `Confirmed` |
| Self-hosted, at or under the limit | done: `Address checked` | done: `Self-hosted wallet` | not_required: `Not required` | not_required: `Not required` |
| Restricted, in review | done: `Address checked` | current: `In review` | pending: `Not reached` | pending: `Not reached` |
| Restricted, rejected in review | done: `Address checked` | refused: `Rejected in review` | pending: `Not reached` | pending: `Not reached` |

A Restricted case accepted in review then follows whichever row its path takes, with Counterparty found done at the decision instant. A Blocked counterparty produces no case and no track (see Business rules).

The **Closed** station:
- `pending: Open` while the case waits on an earlier station;
- `current: Ready to release` when release is allowed;
- `current: Return only` after Answered Rejected;
- `current: Reason needed` after No response until the officer's reason is recorded;
- `done: Released` or `done: Returned` once closed (a rejection in review closes the case as `done: Returned`).

When an open case is returned early, every station not yet reached shows `pending: Not reached`.

**Review queue.**
- `table "Cases in review"` has columns Reference, Counterparty, Fiat value, Created and Claim. Each row has `button "Claim"` or, for the holder, `button "Decide"`.
- `dialog "Claim case"` contains `button "Claim"` (first) and `button "Cancel"`.
- `timer "Claim countdown"` reads `Claim ends in <H:MM:SS>`.
- `dialog "Decide case"` contains `radiogroup "Decision"` (first) with `Accept` and `Reject` (default `Reject`), `textbox "Reason"`, `button "Save decision"` and `button "Cancel"`.

**Incoming messages.**
- `table "Incoming messages"` has columns Received, Sender, Message id, Type and Outcome.
- The message page has `button "Download original"`, `region "Message facts"` (narrow: `button "Show facts"` opens `dialog "Message facts"`, first `button "Close"`) and the name check text from Feedback states.

**Counterparties.**
- `button "Add counterparty"`, `link "Import spreadsheet"` and `table "Counterparties"` with columns Legal name, LEI, Jurisdiction, Due diligence and Network.
- `dialog "Add counterparty"` is a sheet that rises from the bottom below 1120 px and slides in from the right from 1120 px. It contains:
  - `textbox "Legal name"` (first);
  - `textbox "LEI"`;
  - `combobox "Jurisdiction"` (default `Choose a jurisdiction`);
  - `textbox "Licence number"`;
  - `radiogroup "Due diligence"` with Trusted, Pending, Restricted and Blocked (default `Pending`);
  - `textbox "Contact email"`;
  - `textbox "Notes"` with the counter `<n> of 2,000`, where `<n>` is the code-point count;
  - `textbox "Wallet addresses"` (one per line);
  - `button "Save counterparty"` and `button "Cancel"`.
- `dialog "Edit counterparty"` has the same fields without LEI, Jurisdiction and Wallet addresses, plus `button "Save changes"`. It opens from `button "Edit counterparty"` on the counterparty page.
- Import page: `button "Choose file"` opens the file chooser of the file input named `Spreadsheet file`, `button "Preview"`, `table "Preview rows"` (columns Row, Legal name, Outcome and Reason) and `button "Save import"`.

**Rules.**
- `button "Announce change"` and `table "Jurisdiction rules"` (columns Jurisdiction, Rule in force, Since and Announced change).
- `dialog "Announce change"` contains `combobox "Jurisdiction"` (first, default the workspace's own jurisdiction), `textbox "Threshold"` (an amount in the jurisdiction's currency, for example `1000.00`), `textbox "Takes effect on"` (a business date in the YYYY-MM-DD form, default today's business date), `button "Announce"` and `button "Cancel"`.
- The jurisdiction rules page has `table "Rule history"`.

**Daily report.** `textbox "Business date"` (default today's business date), `button "Show report"`, the facts `Starts`, `Ends` and `Length` (`<n> hours`) and `table "Transfers"`.

**Months.**
- `table "Business months"` has columns Month, Messages, Total and Status. Each row has `link "<Month YYYY>"` and, when allowed, `button "Close month"`. The month page also shows `button "Close month"`.
- `dialog "Close month"` shows the month's fee lines and total, `button "Cancel"` (first) and `button "Close month"`.
- The month page has `table "Fee lines"` (columns Tier, Messages, Unit price and Amount) and the invoice id.

**Regulator's files.** `combobox "Month"` (default the latest ended business month), `button "Download file"` and the state text. Below 1120 px, `dialog "Choose month"` holds `combobox "Month"` (first) and `button "Done"`.

**Partner keys.**
- `button "Create key"` and `table "Partner keys"` (columns Label, Key starts, Created, Last used and Status).
- `dialog "Create key"` contains `textbox "Label"` (first), `button "Create"` and `button "Cancel"`.
- `dialog "New partner key"` shows the key once and contains `button "Copy key"` (first) and `button "Done"`.
- Each active key's row has `button "Revoke"`. It opens `dialog "Revoke key"`, which contains `button "Cancel"` (first) and `button "Revoke key"`.

**Members.**
- `button "Add member"` and `table "Members"`.
- `dialog "Add member"` contains `textbox "Name"` (first), `textbox "Email"`, `combobox "Role"` (default `Compliance analyst`), `textbox "Starting password"`, `button "Add member"` and `button "Cancel"`.

**Directory listing.** `button "Withdraw listing"` while listed, `button "List again"` while withdrawn.

**Public.**
- `button "Directory"` opens `menu "Directory"` with `menuitem "Jurisdictions"` and `menuitem "Listed exchanges"`, which scroll to the two lists.
- `button "Desk"` opens `menu "Desk"` with `menuitem "How it works"` (scrolls to the network band) and `menuitem "Sign in"`.
- `img "Lanternline network"` is the network band illustration.
- `region "Network figures"` holds three figures: `<n> jurisdictions tracked`, `<n> rules in force` and `<n> listed exchanges`.
- `radiogroup "Region"` has All regions (default), Europe, Asia Pacific, Middle East, Americas and Africa.
- `radiogroup "Status"` has Any status (default), In force, Announced and No rule.
- `searchbox "Search exchanges"` is empty by default.
- `button "Filters"` and `dialog "Filters"` appear below 1120 px. The sheet holds the region, status and search controls, with Region first, and ends with `button "Show results"`.
- Each card in `list "Jurisdictions"` shows name, status text, threshold and date. Each card in `list "Listed exchanges"` shows name, jurisdiction and network text.

**Data request page.**
- Facts: `Case reference`, `Asset and amount`, `From address`, `To address` and `Requesting exchange`.
- `timer "Page countdown"`.
- `radiogroup "Answer"` (first in order) with Accepted (default) and Rejected.
- `button "Choose certificate"` opens the file chooser of the page's file input, whose accessible name is `Licence certificate`.
- `textbox "Note"`.
- `button "Send answer"` in the sticky bar.

### Interactions (DP-05, DP-07, DP-08, DP-12, DP-16, DP-24, DP-25, DP-26, DP-35, DP-39, DP-42, DP-51, DP-55, DP-57)

**Forms.** Each field error appears inline under its field and again in the form's Problems summary. Selecting a summary link moves focus to its field. The browser's own required or length blocking is never used: the server's 422 decides. When the server refuses a dialog, the dialog stays open with everything typed, and focus moves to the Problems summary or the dialog's error text.

**Dialogs and sheets.**
- Opening one moves focus to its first control. Tab and Shift+Tab wrap inside it (a bare native dialog element is not enough, because Tab can leave the page). Escape closes it, and closing returns focus to the control that opened it.
- A closed menu, sheet, drawer or dialog is hidden and inert at every viewport. Nothing inside it is visible, focusable or in the accessibility tree, and moving it off-screen does not count as closing it.
- Reopening one during its closing motion keeps it open: a pending close never hides a reopened panel.

After a screen change, focus moves to the new screen's level-1 heading.

**Header menus.** Enter, Space or ArrowDown on a menu button opens its menu below the button and focuses the first item. ArrowDown and ArrowUp move with wrapping, Home and End jump to the first and last item, Enter activates, and Escape closes the menu and returns focus to its button. Clicking outside closes the menu.

**Directory.**
- Choosing a region or status updates both lists in place and adds one history entry with the choice in the address: `?region=<region>&status=<status>&q=<text>`. Region values are `europe`, `asia_pacific`, `middle_east`, `americas` and `africa`. Status values are `in_force`, `announced` and `no_rule`. A default choice drops its key.
- While the visitor types in Search exchanges, the list updates in place on each change, and the address's `q` follows the text without adding entries. Pressing Enter or leaving the field commits it as one history entry.
- Back and Forward restore the controls and the lists for each entry. The list always shows the results of the latest input: an older request that answers later is ignored.
- Opening the address directly restores the same filters.

**Handshake track keyboard.** The five stations form one composite with a single Tab stop, and the stop is the station last focused (initially the current station, or Closed on a closed case). ArrowRight and ArrowDown move to the next station and ArrowLeft and ArrowUp to the previous one, at every width and without wrapping. Home and End jump to Screened and Closed. Enter or Space opens that station's detail sheet, and closing it returns focus to the station.

**Pointer and touch.** Behaviour follows each event's pointer type, never the device's hover capability. A mouse pointing at a station shows its tooltip, and leaving hides it. A touch tap on a station opens its detail sheet and never shows the tooltip. Pen behaves like mouse.

**Polling and server time.** Open case pages, the review queue, the data request page and the case list poll the server at most 5 seconds apart. Whether a case is waiting, answered, late, released or returned, whether a claim is held or lapsed, whether a request page is live or ended, and every retention state come only from the server's published status and remaining seconds. Each countdown shows the latest server value and refreshes with each poll. No screen decides a status, a countdown's end or a disabled button from the device clock, which may be wrong by hours.

**Messages survive repaints.** A status, error or outage message that a user's action showed stays on the page and in its live region until that user's next action on the same screen. A later poll, repaint or refresh of data never replaces it.

**Session ends mid-form.** When an action answers the session-ended body, the screen keeps everything typed (stored in the browser for that tab), shows the session-ended copy and offers `link "Sign in again"`. After sign-in the member returns to the same route with the same dialog open and the fields filled. When an action answers the access-removed body, the screen shows the access-removed copy and offers only `link "Sign in"`.

**Downloads.** `Download original` and `Download file` save the server's file with its published file name.

### Visual design (DP-59)

- **Ground.** Every screen, including the sign-in page and the data request page, sits on a near-black blue ground. Raised panels and sheets are a shade lighter blue-black, separated by hairline borders rather than shadows.
- **Ink.** Main text is a pale cool white, and secondary text and labels are a muted blue-grey. Both pass WCAG 2.2 AA contrast on every ground they sit on.
- **Amber.** A warm amber is the one accent. It marks only cases still waiting for a counterparty's answer: the waiting ring and token on the track, and a small marker on waiting rows. It is never used for text.
- **Refusal.** A soft coral red marks refusals, late answers and errors. Where coral text is used, it passes AA on the ground.
- **Type.** The display face is Space Grotesk, for headings and the wordmark. The body face is IBM Plex Sans. Every amount, LEI, address, countdown and instant is set in IBM Plex Mono with tabular figures, so digits line up in columns. Each heading level is a quarter larger than the level below it, and body text is the base size.
- **Density.** Compact: tables use tight rows. Control size rule: every visible button, link, text field, select, combobox, menu item and toolbar button, and the clickable label of every radio option and checkbox, is still at least 44 px tall and at least 44 px wide on screen, so it is easy to tap; a link inside a sentence of running text is the only exception.
- **Composition.** Staff screens are the narrow rail, the work column topped by the Handshake track and the evidence column. Public pages are the full-width network band, the stats band and the two-column directory with its filter rail.
- **Track.** Stations are rings joined by thin connectors, and a small token sits at the latest reached station. Rings fill in pale ink when done, show amber while waiting for a counterparty's answer, and show coral when late or refused. A not-required ring is drawn as a dashed outline.

### Motion and effects (DP-07, DP-25, DP-58)

All motion runs as browser-run transitions or animations, never stepped frame by frame from script. All motion shares one easing that starts quickly and settles softly, and it uses exactly three durations. This covers every transition and animation any element declares in any state (hover, focus, pressed, open), so no other duration appears in a declared style:
- **160 ms, feedback:** hover and press on controls, a menu chevron turning, a station stamp or tooltip fading in.
- **320 ms, state changes:** a station ring filling from empty to its full circumference, a stats digit rolling, and sheets, menus and dialogs opening and closing.
- **640 ms, travel and entrances:** the track token gliding along a connector, one pass of a network packet along its connector, and directory cards rising once on first entry.

**The signature step.** When a server response moves a case on, three things start at the same moment: the token glides along the connector from its old station to the newly reached one over 640 ms, that station's ring fills over 320 ms, and its business-time stamp fades in over 160 ms. Several stations reached in one response fill together, and the token glides once to the last of them. A late answer turns the Answered ring coral, and the No response text appears with the same fill and fade. Moving back is never needed, because a case never moves backwards.

**Public band.** The network illustration shows twelve to sixteen nodes and their connectors. Packets loop along the connectors, one 640 ms pass per loop, and these are the only loops in the product. The stats figures roll their digits once, over 320 ms, into their final values. A figure's accessible name is always its final value, never an intermediate digit.

No other decorative loop, parallax, scroll-linked effect or autoplaying motion exists.

**Reduced motion.** When the visitor asks for reduced motion, the same code places every element at its end state at once. The token sits at the reached station, the ring is full, the stamp is shown, sheets and dialogs appear and disappear at once, the stats show their final values, and the network packets stop, resting at the end of their connectors. `data-state`, `data-at` and the live-region copy are identical with and without motion.

### Feedback states (DP-12, DP-16, DP-26, DP-35, DP-39, DP-42, DP-45, DP-48, DP-51, DP-55)

Every async action shows its copy on the page next to the control and announces exactly the same characters in its named live region: `Desk status` for staff, `Request status` on the data request page, `Directory status` on public pages. The placeholders are:
- `<date-time>` is an instant in the workspace's business time in the screen date-time format, for example `Tue 6 Apr 2027, 11:00 Vilnius time`;
- `<date>` is a business date such as `6 Apr 2027`;
- `<Month YYYY>` is a business month such as `September 2026`;
- `<member name>` is a member's name;
- `<n>` is a whole number. A count of 1 takes the singular.

When the server answers with an error body, the page copy is that body's `message`, which equals the copy here.

| Action | Pending | Success | Refusals and rare states |
|---|---|---|---|
| Sign in | `Signing in…` | (lands on home) | `Email or password is incorrect.` |
| Create case | `Creating case…` | `Case <reference> created.` | `This counterparty is Blocked. The withdrawal was not created.`; field errors from API |
| Release | `Releasing…` | `Released. The withdrawal can leave.` | `This withdrawal can't be released yet.` |
| Return withdrawal | `Returning…` | `Returned to the customer's balance.` | `This case is already closed.` |
| Record reason | `Saving reason…` | `Reason recorded. The operations lead can now release this withdrawal.` | `A reason is needed only after No response.` |
| Record ownership | `Saving…` | `Ownership confirmed.` | `Ownership is not pending on this case.` |
| Late answer (case reads No response) | | `No response. The answer period ended at <date-time>.` (announced when the open page first sees it) | |
| Send new request page | `Sending…` | `New request page sent to <contact email>.` | `This case has no open data request.` |
| End request page | `Ending…` | `Request page ended.` | `This case has no open data request.` |
| Claim | `Claiming…` | `Claimed. Your claim lasts until <date-time>.` | lost: `Claimed by <member name> at <date-time>.`; lapsed (shown when a poll reports it): `Your claim lapsed at <date-time>.` |
| Save decision | `Saving decision…` | `Decision saved: Accepted.` or `Decision saved: Rejected.` | stale: `Already decided by <member name> at <date-time>.` (the typed reason stays in the dialog); not held: `Claim this case before deciding.` |
| Add counterparty | `Saving…` | `Counterparty added.` | `A counterparty with this LEI already exists.`; `A counterparty with this legal name already exists.`; `An address is already in the address registry.` |
| Save changes (counterparty) | `Saving…` | `Changes saved.` | `A counterparty with this legal name already exists.` |
| Preview import | `Reading file…` | `<n> rows read: <n> matched, <n> new, <n> refused.` | |
| Save import | `Saving import…` | `Import saved: <n> created, <n> updated, <n> unchanged.` | |
| Announce change | `Announcing…` | `Change announced for <jurisdiction name> from <date>.` | `A change for <jurisdiction name> on <date> is already announced.`; date field: `Choose today or a later date.` |
| Close month | `Closing month…` | `<Month YYYY> closed. Invoice received.` | `<Month YYYY> is already closed.`; `<Month YYYY> has not ended yet.`; `<Month YYYY> has no messages to bill.`; outage: `Invoicing is unreachable. The month was not closed and nothing was sent. Try again in a few minutes.` |
| Download file | `Preparing file…` | `File downloaded: <file name>.` | `Too many requests. Try again in <n> seconds.` |
| Download original | `Preparing file…` | `File downloaded: <file name>.` | `This original was erased under the retention rule.`; storage outage copy |
| Archive case / Bring back | `Saving…` | `Case archived.` / `Case brought back.` | `Only a closed case can be archived.` |
| Create key | `Creating…` | `Key created. Copy it now: it won't be shown again.` | |
| Revoke key | `Revoking…` | `Key revoked.` | |
| Withdraw listing / List again | `Saving…` | `Listing withdrawn.` / `Listed again.` | |
| Add member | `Saving…` | `Member added.` | `This email already belongs to a member.` |
| Send answer (request page) | `Sending answer…` | `Answer sent. Thank you.` | `The certificate is larger than 5,000,000 bytes.`; `Attach a PNG, JPEG or WebP image.`; `This page has already been answered.`; `This case is not waiting for your answer.`; storage outage: `Storage is unreachable. Nothing was saved. Try again in a few minutes.` |
| Any action, session over | | | `Your session ended. Sign in again to continue. What you typed is kept.` |
| Any action, member removed | | | `Your access to this workspace was removed.` |
| Any action, role refused | | | `Your role can't do this.` |

Case status text, shown in the Withdrawals table's Status column and on the case page, follows the case's API `status` exactly:

| API `status` | Visible status text |
|---|---|
| `awaiting_ownership` | `Ownership pending` |
| `in_review` | `In review` |
| `awaiting_answer` | `Waiting for answer` |
| `accepted` | `Accepted` |
| `rejected` | `Rejected` |
| `no_response` | `No response` |
| `cleared` | `Ready to release` |
| `released` | `Released` |
| `returned` | `Returned` |

Other status texts shown in tables and on the pages:

- **Retention:** `Personal data is kept until <date-time>.` (scheduled), `Erasing personal data. Waiting for storage to confirm.` (pending), `Personal data erased on <date-time>.` (erased), `Archived on <date-time>.` (archived).
- **Data request page, live:** `This page ends in <H:MM:SS>.`
- **Data request page, answered:** `Answer received. Thank you.`
- **Data request page, ended:** `This data request page has ended. Ask the requesting exchange for a new one.`
- **Data request page on the case page:** `Request page live until <date-time>.` or `Request page ended at <date-time>.`
- **Name check:** `Name check: Match`, `Name check: Partial`, `Name check: No match`.
- **Months:** `Open`, `Ready to close`, `Invoiced`.
- **Regulator's files:** idle `Choose a month and download its file.`; empty month `No transfers in <Month YYYY>. The file has a header row only.`
- **Daily report, empty:** `No transfers on <date>.`
- **Directory listing:** `Listed in the public directory.` or `Not listed.`
- **Withdrawn exchange page:** `This exchange has withdrawn its listing.`
- **Unknown page:** `We couldn't find that page.`
- **Empty tables:** `Nothing here yet.`

### Journey checks (DP-08, DP-12, DP-16, DP-26, DP-31, DP-35, DP-39, DP-42, DP-45, DP-48, DP-51)

Besides its own steps, each journey requirement holds these six checks on its own screen and main endpoint, as listed in the table below:
1. **Precedence.** A request to the main endpoint that breaks two published rules at once answers the earlier rung of the one error-precedence ladder in API.
2. **Instants.** Every instant in that journey's API responses is UTC in whole seconds with a `Z`.
3. **Accessibility.** The automated WCAG 2.2 AA check passes on the screen at 375x812 and at 1280x800 with its dialog or sheet closed. The check with the dialog or sheet open runs only at the viewports where that dialog or sheet exists. `dialog "Filters"`, `dialog "Message facts"` and `dialog "Choose month"` exist only below 1120 px, so for these three the open check runs at 375x812 only, and at 1280x800 only the screen itself is checked, with its wide panel in place. Every other listed dialog or sheet exists at both widths and is checked open at 375x812 and at 1280x800.
4. **Motion.** Every transition and animation that an element of the screen declares, in any of its states, lasts exactly 160, 320 or 640 ms, and under reduced motion the screen's motion ends at once.
5. **Size.** At 375x812 every visible control on the screen meets the control size rule in Visual design, and nothing scrolls sideways.
6. **Arrival.** On a staff screen reached by a link in `navigation "Workspace"` or `dialog "Sections"`, focus is on the screen's level-1 heading.

| Journey | Screen | Main endpoint | Dialog or sheet |
|---|---|---|---|
| DP-08 public directory | `/` | `GET /api/public/exchanges` | `dialog "Filters"` (below 1120 px only) |
| DP-12 announce change | `/w/<slug>/rules` | `POST /api/w/<slug>/rules/changes` | `dialog "Announce change"` |
| DP-16 counterparties | `/w/<slug>/counterparties` | `POST /api/w/<slug>/counterparties` | `dialog "Add counterparty"` |
| DP-26 withdrawal follow-through | `/w/<slug>/cases/<case id>` | `POST /api/w/<slug>/cases` | the station detail sheet |
| DP-31 incoming messages | `/w/<slug>/messages/<message id>` | `POST /api/network/<slug>/messages` | `dialog "Message facts"` (below 1120 px only) |
| DP-35 review queue | `/w/<slug>/review` | `POST /api/w/<slug>/review/<case id>/claim` | `dialog "Decide case"` |
| DP-39 data request page | `/r/<token>` | `POST /api/request-pages/<token>/answer` | none (the sticky bar) |
| DP-42 month close | `/w/<slug>/months/<YYYY-MM>` | `POST /api/w/<slug>/months/<YYYY-MM>/close` | `dialog "Close month"` |
| DP-45 regulator's files | `/w/<slug>/files` | `GET /api/w/<slug>/files/regulator` | `dialog "Choose month"` (below 1120 px only) |
| DP-48 retention | `/w/<slug>/cases/<case id>` of a closed case | `POST /api/w/<slug>/cases/<case id>/archive` | the station detail sheet |
| DP-51 partner keys | `/w/<slug>/partner-keys` | `POST /api/w/<slug>/partner-keys` | `dialog "Create key"` |

## Backend

### API (DP-01, DP-02, DP-03, DP-04, DP-05, DP-06, DP-09, DP-11, DP-13, DP-14, DP-15, DP-17, DP-21, DP-22, DP-27, DP-28, DP-29, DP-32, DP-33, DP-36, DP-37, DP-38, DP-40, DP-41, DP-43, DP-44, DP-46, DP-47, DP-49, DP-50, DP-51, DP-53)

**Conventions (stated once).**
- JSON keys are lowerCamelCase everywhere, nested keys included. Enum values are lower snake_case.
- Crypto amounts are decimal strings, never JSON numbers. They are always returned with exactly the asset's decimals: BTC 8, ETH 18, USDC 6, SOL 9. For example, `"1.000000000000000001"` comes back as `"1.000000000000000001"` and `"0.3"` comes back as `"0.300000000000000000"`.
- Fiat money is integer cents in fields ending in `Cents`, beside an ISO currency code. Rates are integer cents per whole unit of the asset.
- Instants are ISO 8601 UTC in whole seconds with a `Z` (for example `2027-04-06T08:00:00Z`), never with milliseconds. Business dates are `YYYY-MM-DD` and business months are `YYYY-MM`.
- Request bodies are `application/json` unless a row says otherwise. JSON bodies may be at most 64,000 bytes. The message endpoint allows 256,000 bytes, the import 1,000,000 bytes, and the request page answer 6,000,000 bytes, with the certificate file itself at most 5,000,000 bytes.
- Staff endpoints sit under `/api/w/<slug>`, where the slug is `neris` or `kallang`. They need the session cookie set by sign-in, and the session must belong to that workspace.

**Error body (one shape).** `{"error":{"code":"<code>","message":"<copy>","fields":{"<field>":"<message>"}}}`, with `fields` set to `{}` when no field is involved.

**Error precedence (one ladder for the whole API).** When a request breaks several rules, the first matching rung answers:
1. `404 not_found` for an unknown path, and `405 method_not_allowed` with an `Allow` header for a wrong method on a known path.
2. `429 rate_limited` with `Retry-After`.
3. `401` for unauthenticated, session ended, access removed, a bad partner key or a bad signature.
4. `404 not_found` for an unknown record or another workspace's record (`410` for a withdrawn listing, an ended data request page or an erased original).
5. `403 forbidden` for a role that may not act.
6. `413` for a body or file that is too large.
7. `415` for the wrong content type or file type.
8. `400 bad_json` for a body that can't be parsed.
9. `409` for state refusals.
10. `422 invalid` for field validation, listing every failing field at once.
11. `503` for a provider outage.

A repeated request with a known partner request key answers its stored response right after rung 3, before any record, state or field check. Endpoint rows name only their own extra errors.

Standard bodies:

| Code | Message |
|---|---|
| `401 unauthenticated` | `Sign in to continue.` |
| `401 session_ended` | `Your session ended. Sign in again to continue. What you typed is kept.` |
| `401 access_removed` | `Your access to this workspace was removed.` |
| `401 bad_partner_key` | `This partner key is not valid.` |
| `401 bad_signature` | `The message signature could not be verified.` |
| `403 forbidden` | `Your role can't do this.` |
| `404 not_found` | `Not found.` |
| `405 method_not_allowed` | `Method not allowed.` |
| `413 too_large` | `The request is too large.` |
| `415 unsupported_media_type` | `This content type isn't accepted here.` |
| `400 bad_json` | `The request body isn't valid JSON.` |
| `422 invalid` | `Check the highlighted fields.` |
| `429 rate_limited` | `Too many requests. Try again in <n> seconds.` |
| `503 storage_unreachable` | `Storage is unreachable. Nothing was saved. Try again in a few minutes.` |
| `503 invoicing_unreachable` | `Invoicing is unreachable. The month was not closed and nothing was sent. Try again in a few minutes.` |

**Health.** `GET /api/health` → `200 {"status":"ok"}`, even while Kill Bill or MinIO is unreachable.

**Session.**

| Method and path | Body | Success | Extra errors |
|---|---|---|---|
| `POST /api/session` | `{"email":"analyst@neris.example","password":"Lantern-Desk-2027!"}` | `200 {"member":{"id","name","email","role"},"workspace":{"slug","name"},"home":"/w/neris/cases"}`, and sets an HttpOnly, SameSite=Lax session cookie that is never marked Secure | `401 {"error":{"code":"sign_in_failed","message":"Email or password is incorrect.","fields":{}}}`, the identical status and body for an unknown email and a wrong password |
| `GET /api/session` | | `200` with the same body | `401` |
| `DELETE /api/session` | | `204`. The session ends, and the old cookie then answers `401 unauthenticated` | |

**Workspace.** `GET /api/w/<slug>` → `200 {"workspace":{"slug","name","legalName","lei","jurisdictionCode","timeZone","city","currency","confirmationLimitCents","today","now"}}`. `today` is the business date and `now` the server instant.

**Members (compliance officer only; other roles `403`).**

| Method and path | Body | Success | Extra errors |
|---|---|---|---|
| `GET /api/w/<slug>/members` | | `200 {"members":[{"id","name","email","role","createdAt"}]}` | |
| `GET /api/w/<slug>/members/<member id>` | | `200 {"member":{…}}` | |
| `POST /api/w/<slug>/members` | `{"name":"Rasa Example","email":"rasa@neris.example","role":"compliance_analyst","password":"Starting-Pass-2027"}` | `201 {"member":{…}}` | `409 email_taken` `This email already belongs to a member.`; `422` for name (1 to 120 code points), email, role and password (at least 12 characters) |
| `PATCH /api/w/<slug>/members/<member id>` | `{"role":"operations_lead"}` | `200 {"member":{…}}` | `409 own_membership` `You can't change or remove your own membership.`; `422` role |
| `DELETE /api/w/<slug>/members/<member id>` | | `204`. The member's sessions end with `access_removed` | `409 own_membership` |

Roles are `compliance_officer`, `compliance_analyst`, `operations_lead`, `finance_lead` and `support_agent`. A member id of another workspace answers `404` exactly like an unknown id and changes nothing. Emails are unique across all workspaces.

**Public directory (no session).**

| Method and path | Success | Extra errors |
|---|---|---|
| `GET /api/public/stats` | `200 {"jurisdictions":13,"rulesInForce":9,"listedExchanges":15}` (counts at start; listedExchanges follows withdrawals) | |
| `GET /api/public/jurisdictions?region=&status=` | `200 {"jurisdictions":[{"code","name","region","currency","status","thresholdCents","inForceSince","announcedChange":{"thresholdCents","takesEffectOn"}}]}`, with `thresholdCents` and `inForceSince` null under `no_rule` or `announced`, and `announcedChange` null when none | `422` for an unknown region or status |
| `GET /api/public/jurisdictions/<code>` | `200 {"jurisdiction":{…},"exchanges":[…]}` | |
| `GET /api/public/exchanges?q=&region=&status=` | `200 {"exchanges":[{"slug","name","jurisdictionCode","region","status","onNetwork"}]}`, only listed exchanges. `status` is the exchange's jurisdiction status | |
| `GET /api/public/exchanges/<listing slug>` | `200 {"exchange":{…}}` | `410 {"error":{"code":"listing_withdrawn","message":"This exchange has withdrawn its listing.","fields":{}}}` |
| `GET /sitemap.xml` | `200` XML with one `<loc>` each for `/`, every `/jurisdictions/<code>` and every listed `/exchanges/<listing slug>`, built on the public URL | |

Status values are `in_force`, `announced` (no rule in force today, a rule announced) and `no_rule`. The page route `/exchanges/<listing slug>` of a withdrawn listing also answers HTTP 410.

**Listing (compliance officer only).** `GET /api/w/<slug>/listing` → `200 {"listing":{"slug","listed":true}}`. `PUT /api/w/<slug>/listing` with `{"listed":false}` or `{"listed":true}` → `200 {"listing":{…}}`.

**Rules.**

| Method and path | Roles | Body | Success | Extra errors |
|---|---|---|---|---|
| `GET /api/w/<slug>/rules` | all staff | | `200 {"jurisdictions":[{"code","name","currency","ruleInForce":{"thresholdCents","since"},"changes":[{"id","thresholdCents","takesEffectOn","takesEffectAt","announcedBy","announcedAt","state"}]}]}`, with `ruleInForce` null when none. `state` is `scheduled` or `in_force` | |
| `GET /api/w/<slug>/rules/<code>` | all staff | | `200 {"jurisdiction":{…}}` | |
| `POST /api/w/<slug>/rules/changes` | officer | `{"jurisdictionCode":"SG","thresholdCents":100000,"takesEffectOn":"2027-04-06"}` | `201 {"change":{…}}` | `409 change_exists` (copy in Feedback states); `422` for jurisdictionCode, thresholdCents (integer, 0 or more) and takesEffectOn (`Choose today or a later date.`) |
| `GET /api/w/<slug>/reports/daily?date=YYYY-MM-DD` | officer, analyst | | `200 {"date","timeZone","startsAt","endsAt","hours","transfers":<n>,"cases":[{"reference","createdAt","asset","amount","fiatValueCents","currency","thresholdCents","counterpartyName","path","status"}]}` | `422` date |
| `GET /api/w/<slug>/rates` | all staff | | `200 {"rates":[{"asset","currency","rateCents","inForceSince"}]}` | |

**Counterparties, customers and the address registry.**

| Method and path | Roles | Body | Success | Extra errors |
|---|---|---|---|---|
| `GET /api/w/<slug>/counterparties` | all staff | | `200 {"counterparties":[{"id","legalName","lei","jurisdictionCode","licenceNumber","dueDiligence","network","contactEmail","notes","updatedAt"}]}` | |
| `GET /api/w/<slug>/counterparties/<id>` | all staff | | `200 {"counterparty":{…,"previousNames":[{"name","from","until"}],"addresses":[…]}}` | |
| `POST /api/w/<slug>/counterparties` | officer, analyst | `{"legalName":"Vilnelė Ledger UAB","lei":"5493001kjtiigc8y1r12","jurisdictionCode":"LT","licenceNumber":"LT-FNTT-VASP-0901","dueDiligence":"trusted","contactEmail":"compliance@vilnele.example","notes":"Onboarded after site visit.","addresses":["lnl1vilneledger0000000000000000001"]}` | `201 {"counterparty":{…}}`. The LEI is stored upper case and `network` is `off_network` | `409 lei_taken`, `409 name_taken`, `409 address_taken` (copy in Feedback states); `422` for legalName (1 to 200 code points, `Enter the legal name.`), lei (`Enter a 20-character LEI whose check digits are valid.`), jurisdictionCode (`Choose a jurisdiction.`), licenceNumber (1 to 60), dueDiligence, contactEmail (`Enter the compliance contact's email.`), notes (`Notes can be at most 2,000 characters.`) and addresses (`Each address must be lnl1 followed by 30 lower-case letters or digits.`) |
| `PATCH /api/w/<slug>/counterparties/<id>` | officer, analyst | any of `legalName`, `licenceNumber`, `dueDiligence`, `contactEmail`, `notes` | `200 {"counterparty":{…}}` | `409 name_taken`; `422` as above, and `422` field `lei` `The LEI can't be changed.` when the body has an `lei` key (nothing changes). Other keys not listed are ignored |
| `POST /api/w/<slug>/counterparties/import/preview` | officer, analyst | `text/csv` body | `200 {"rows":[{"row","legalName","outcome","matchedBy","counterpartyId","changedFields","reason"}],"summary":{"matched","new","refused"}}`, with nothing saved | |
| `POST /api/w/<slug>/counterparties/import` | officer, analyst | the same `text/csv` body | `200 {"created","updated","unchanged","refused","rows":[…]}` | |
| `GET /api/w/<slug>/customers` | all staff | | `200 {"customers":[{"id","name","identityNumber","dateOfBirth","depositAddress"}]}` | |
| `GET /api/w/<slug>/address-registry` | all staff | | `200 {"addresses":[{"address","counterpartyId","counterpartyName"}]}` | |

Import `outcome` is `matched`, `new` or `refused`. `matchedBy` is `lei` or `legal_name`. The signing value of an on-network counterparty is never returned.

**Cases.** The case body (`"case"`) has these fields:
- `id`, `reference`, `createdAt`, `createdBy` (`{"kind":"member","name"}` or `{"kind":"partner_key","label"}`).
- `asset`, `amount`, `destinationAddress`, `sendingAddress`, `wallet` (`hosted` or `self_hosted`).
- `counterparty` (`{"id","name","lei","jurisdictionCode","network"}` with the current name, or null).
- `originator` (`{"customerId","name","identityNumber","dateOfBirth"}`) and `beneficiaryName`.
- `fiatValueCents` and `currency`.
- `decidedUnder` (`{"jurisdictionCode","thresholdCents","thresholdCurrency","ruleInForceSince","rateCents","confirmationLimitCents","counterpartyName","counterpartyRule"}`, where `counterpartyRule` is `in_force` or `no_rule`).
- `path` (`counterparty`, `sunrise`, `below_threshold`, `self_hosted` or `review`) and `status` (`awaiting_ownership`, `in_review`, `awaiting_answer`, `accepted`, `rejected`, `no_response`, `cleared`, `released` or `returned`).
- `dataSent` (`{"channel":"network"|"request_page","at","counterpartyNameAsSent"}` or null).
- `answer` (`{"decision":"accepted"|"rejected","at","late","via":"network"|"request_page"}` or null).
- `answerDueAt` and `answerRemainingSeconds`.
- `ownership` (`{"required","confirmedOn","recordedAt","recordedBy"}`).
- `review` (`{"claim":{"memberId","memberName","claimedAt","endsAt","remainingSeconds"}|null,"decision":{"decision","reason","decidedBy","decidedAt"}|null}` or null).
- `requestPage` (`{"status":"live"|"ended"|"answered","sentAt","endsAt","remainingSeconds","contactEmail"}` or null).
- `releaseReason` (`{"text","recordedBy","recordedAt"}` or null) and `releaseAllowed`.
- `outcome` (`released`, `returned` or null) and `closedAt`.
- `erasure` (`{"status":"not_due"|"scheduled"|"pending"|"erased","dueAt","erasedAt","digests":[{"kind":"message"|"certificate","objectKey","sha256"}]}`).
- `archived` (false).
- `track` (five `{"station","label","state","text","at"}` entries in station order, with `at` null when not reached).
- `now`.

| Method and path | Roles | Body | Success | Extra errors |
|---|---|---|---|---|
| `GET /api/w/<slug>/cases?show=open\|closed\|archived` | all staff | | `200 {"cases":[…]}` | |
| `GET /api/w/<slug>/cases/<case id>` | all staff | | `200 {"case":{…}}` | |
| `POST /api/w/<slug>/cases` | officer, analyst | `{"asset":"ETH","amount":"0.3","destinationAddress":"lnl1harbourgate0000000000000000001","customerId":"cust-neris-01","beneficiaryName":"Aoife Byrne"}` | `201 {"case":{…}}` | `409 counterparty_blocked` (copy in Feedback states); `422` for asset, amount (`Enter an amount greater than zero with at most <decimals> decimals.`, or `Send the amount as a string.` for a JSON number), destinationAddress (address copy above), customerId (`Choose a customer.`) and beneficiaryName (1 to 140 code points, `Enter the beneficiary's name.`) |
| `POST /api/w/<slug>/cases/<case id>/release` | operations | `{}` | `200 {"case":{…}}` | `409 release_not_allowed`, `409 case_closed` |
| `POST /api/w/<slug>/cases/<case id>/return` | operations | `{"reason":"Customer asked to cancel."}` | `200 {"case":{…}}` | `409 case_closed`; `422` reason (1 to 1,000 code points) |
| `POST /api/w/<slug>/cases/<case id>/release-reason` | officer | `{"reason":"Counterparty confirmed by phone; regulator notified."}` | `200 {"case":{…}}` | `409 reason_not_needed`; `422` reason |
| `POST /api/w/<slug>/cases/<case id>/ownership` | officer, analyst | `{"confirmedOn":"2027-04-06"}` | `200 {"case":{…}}` | `409 ownership_not_pending`; `422` confirmedOn (not after today and not before the case's business date) |
| `POST /api/w/<slug>/cases/<case id>/request-page` | officer, analyst | `{}` | `201 {"case":{…}}`. The previous page ends and a new mail goes out. `answerDueAt` and the Data sent instant stay as they were | `409 request_page_not_open` |
| `DELETE /api/w/<slug>/cases/<case id>/request-page` | officer, analyst | | `200 {"case":{…}}` | `409 request_page_not_open` |
| `POST /api/w/<slug>/cases/<case id>/archive` | officer | `{}` | `200 {"case":{"id","reference","archived":true,"archivedAt","closedAt"}}` | `409 case_not_closed` `Only a closed case can be archived.` |
| `POST /api/w/<slug>/cases/<case id>/restore` | officer | `{}` | `200 {"case":{…}}` | `409 case_not_archived` |

While a case is archived, `GET` returns the archived summary shape.

**Review.**

| Method and path | Roles | Body | Success | Extra errors |
|---|---|---|---|---|
| `GET /api/w/<slug>/review` | officer, analyst, support | | `200 {"cases":[{"id","reference","counterparty":{"id","name"},"fiatValueCents","currency","createdAt","claim":{…}\|null}],"now"}` | |
| `POST /api/w/<slug>/review/<case id>/claim` | analyst | `{}` | `200 {"claim":{…}}` | `409 already_claimed` (lost-claim copy); `409 already_decided` (stale copy) |
| `POST /api/w/<slug>/review/<case id>/decision` | analyst | `{"decision":"accept","reason":"Enhanced due diligence file reviewed."}` | `200 {"case":{…}}` | `409 already_decided`, `409 claim_not_held`; `422` decision and reason (1 to 1,000 code points, `Enter a reason.`) |

**Incoming messages.**

| Method and path | Auth | Body | Success | Extra errors |
|---|---|---|---|---|
| `POST /api/network/<slug>/messages` | headers `Lanternline-Sender: <counterparty LEI>` and `Lanternline-Signature: t=<Unix seconds>,v1=<lowercase hex>` | `application/json`, a transfer or an answer (below) | `201 {"message":{"id","messageId","type","receivedAt","sha256","sizeBytes","counterparty":{"id","name"},"outcome"}}` | `401 bad_signature`; `409 message_id_reused` `This message id was already received with different content.`; `409 answer_not_expected` `This case is not waiting for your answer.`; `422` fields; `503 storage_unreachable` |
| `GET /api/w/<slug>/messages` | officer, analyst, operations, support | | `200 {"messages":[…]}` | |
| `GET /api/w/<slug>/messages/<id>` | same | | `200 {"message":{…,"working":{…},"nameCheck":{"result","customerId","customerName"}}}` | |
| `GET /api/w/<slug>/messages/<id>/original` | officer, analyst | | `200` with the exact stored bytes, `Content-Type: application/json`, `Content-Disposition: attachment; filename="<messageId>.json"` | `410 original_erased` `This original was erased under the retention rule.`; `503 storage_unreachable` |

Transfer body example:
`{"messageId":"hg-2027-000917","type":"transfer","transferReference":"HG-TX-917","asset":"ETH","amount":"1.250000000000000000","destinationAddress":"lnl1nerisclient0000000000000000001","originator":{"name":"Aoife Byrne","accountNumber":"HG-ACC-55102"},"beneficiary":{"name":"Lukasz Orsted Aekvist"}}`.

Answer body example:
`{"messageId":"hg-2027-000918","type":"answer","caseReference":"NRS-000001","decision":"accepted","note":"Beneficiary confirmed."}`.

`outcome` is `match`, `partial` or `no_match` for a transfer, and `accepted`, `rejected` or `late` for an answer. Field errors (`422`):
- `messageId` must be 1 to 100 characters;
- `type` must be a known type;
- `asset` and `amount` must be valid;
- `destinationAddress` must be a deposit address of this workspace, otherwise `No customer holds this deposit address.`;
- `caseReference` must be a case of this workspace sent to this sender, otherwise `No case with this reference was sent to you.`;
- `decision` must be `accepted` or `rejected`.

**Data request pages (no session; the token in the path is the capability).**

| Method and path | Body | Success | Extra errors |
|---|---|---|---|
| `GET /api/request-pages/<token>` | | `200 {"page":{"caseReference","asset","amount","fromAddressMasked","toAddressMasked","requestingExchange","status":"live"\|"answered","endsAt","remainingSeconds","now"}}` | `410 {"error":{"code":"request_page_ended","message":"This data request page has ended. Ask the requesting exchange for a new one.","fields":{}}}` |
| `POST /api/request-pages/<token>/answer` | `multipart/form-data` with parts `answer` (`accepted` or `rejected`), `note` (optional, up to 1,000 code points) and `certificate` (file) | `201 {"answer":{"decision","receivedAt","certificate":{"id","contentType","sizeBytes","sha256"}}}` | `410 request_page_ended`; `413 file_too_large` `The certificate is larger than 5,000,000 bytes.`; `415 unsupported_file` `Attach a PNG, JPEG or WebP image.`; `400 bad_form` for unparseable multipart; `409 already_answered` `This page has already been answered.`; `409 answer_not_expected` `This case is not waiting for your answer.` (see Accepting answers in Business rules); `422` answer and certificate (`Attach the licence certificate.`); `503 storage_unreachable` |

The page route `/r/<token>` of an ended page also answers HTTP 410.

**Months and fees.**

| Method and path | Roles | Body | Success | Extra errors |
|---|---|---|---|---|
| `GET /api/w/<slug>/months` | officer, finance | | `200 {"months":[{"month","status","messageCount","totalCents","currency","invoiceId","closedAt"}]}` | |
| `GET /api/w/<slug>/months/<YYYY-MM>` | officer, finance | | `200 {"month":{…,"lines":[{"tier","label","count","unitPrice","amountCents"}]}}` | |
| `POST /api/w/<slug>/months/<YYYY-MM>/close` | finance | `{}` | `201 {"month":{…,"status":"invoiced","invoiceId"}}` | `409 month_closed`, `409 month_not_ended`, `409 month_empty` (copy in Feedback states); `503 invoicing_unreachable` |

Month `status` is `open`, `ready` or `invoiced`. `unitPrice` is a decimal string with 4 decimals. Lines are shown as computed figures until the month is invoiced, then as recorded.

**Regulator's monthly files.**

| Method and path | Roles | Success | Extra errors |
|---|---|---|---|
| `GET /api/w/<slug>/files` | officer, analyst, support | `200 {"months":[{"month","cases"}]}` for every month from the first seeded month to the current one | |
| `GET /api/w/<slug>/files/regulator?month=YYYY-MM` | officer, analyst, support | `200 text/csv; charset=utf-8` with the rows and columns of the regulator's monthly file in Business rules, `Content-Disposition: attachment; filename="<slug>-regulator-<YYYY-MM>.csv"` | `422` month (`Choose a month that has started.`) |

**Partner access.**

| Method and path | Auth | Body | Success | Extra errors |
|---|---|---|---|---|
| `POST /api/partner/v1/cases` | `Authorization: Bearer <partner key>` and header `Request-Key: <1 to 100 characters>` | the case-creation body above | `201 {"case":{…}}` | `401 bad_partner_key`; `409 request_key_reused` `This request key was already used with a different body.`; `422` `requestKey` `Send a Request-Key header.` plus the case fields |
| `GET /api/w/<slug>/partner-keys` | officer session | | `200 {"keys":[{"id","label","startsWith","createdAt","lastUsedAt","revokedAt"}]}` | |
| `POST /api/w/<slug>/partner-keys` | officer session | `{"label":"Treasury ledger"}` | `201 {"key":{…},"secret":"lnlk_<32 lowercase hex>"}`, the only time the secret appears | `422` label (1 to 80 code points) |
| `DELETE /api/w/<slug>/partner-keys/<id>` | officer session | | `200 {"key":{…,"revokedAt"}}` | `409 key_revoked` |

`startsWith` is the first 9 characters of the key.

### Business rules (DP-01, DP-09, DP-10, DP-11, DP-13, DP-14, DP-15, DP-18, DP-19, DP-20, DP-21, DP-22, DP-27, DP-29, DP-30, DP-32, DP-33, DP-34, DP-37, DP-40, DP-41, DP-43, DP-44, DP-46, DP-47, DP-49, DP-50, DP-53, DP-55)

**Business time.** Neris uses Europe/Vilnius and Kallang uses Asia/Singapore. Business dates, the daily report, months, case references and every stamp and copy use the workspace's business time, whatever the browser's zone.

**Screen formats (stated once).**
- Date-time: `Tue 6 Apr 2027, 11:00 Vilnius time` or `Tue 6 Apr 2027, 16:00 Singapore time` (24-hour clock and the workspace's city).
- Date: `6 Apr 2027`.
- Month: `September 2026`.
- Fiat money: the currency code, a space and the amount with comma thousands and two decimals (`EUR 1,000.01`).
- Crypto: the asset code, a space and the exact amount with no trailing zeros and no thousands separators (`ETH 1.000000000000000001`, `BTC 0.5`).
- Countdowns: `H:MM:SS`.
- Masked address: the first 6 and last 4 characters joined by the ellipsis character (`lnl1ha…0001`).

Every published string uses straight apostrophes and exactly the dashes printed.

**Addresses.** A valid address is `lnl1` followed by exactly 30 lower-case letters or digits. These addresses are made up and valid on no real network.

**Fiat value.** `fiatValueCents` = amount × `rateCents` for the case's asset in the workspace currency in force at the case's instant. It is computed exactly in decimal and rounded half up to a whole cent, never through binary floating point. For example, with the seed data at start, 0.3 ETH at EUR 3,333.35 is exactly EUR 1,000.005, which rounds to EUR 1,000.01, and 1.000000000000000001 ETH is EUR 3,333.35. Every threshold and limit comparison uses the rounded `fiatValueCents`.

**Path decision (at creation, in this order; the case records what it was decided under in `decidedUnder`).**
1. Destination not in the address registry: the `self_hosted` path. If the value is more than the workspace's confirmation limit, the status is `awaiting_ownership`. At or under the limit, the status is `cleared`.
2. Counterparty Blocked: refused with `409 counterparty_blocked`, and no case is created.
3. Counterparty Restricted: the `review` path with status `in_review`. Accept continues with steps 4 to 6 at the decision instant, using the rules recorded at creation. Reject sets `returned`.
4. Value under the workspace jurisdiction's threshold in force: the `below_threshold` path, status `cleared`. The data travels when the value is at or above the threshold. Lithuania is EUR 0.00 at start, so every Neris case travels. Singapore is SGD 1,500.00, so a Kallang case worth exactly SGD 1,500.00 travels.
5. Counterparty's jurisdiction has no rule in force at the case's instant: the `sunrise` path. Data is sent (a message, or a data request page for an off-network counterparty), no answer is awaited, and the status is `cleared`.
6. Otherwise: the `counterparty` path. Data is sent at once: a signed network message to an on-network counterparty, or a data request page by mail to an off-network one. The status is `awaiting_answer`.

Trusted and Pending counterparties both take steps 4 to 6.

**Case state machine.** Legal transitions:

| From | Event | To |
|---|---|---|
| `awaiting_ownership` | analyst records ownership | `cleared` |
| `in_review` | Accept | per steps 4 to 6 |
| `in_review` | Reject | `returned` |
| `awaiting_answer` | answer Accepted before the due instant | `accepted` |
| `awaiting_answer` | answer Rejected before the due instant | `rejected` |
| `awaiting_answer` | due instant reached, or an answer at or after it | `no_response` |
| `accepted` or `cleared` | release | `released` |
| `no_response` with the officer's reason | release | `released` |
| any open status | return | `returned` |

Released and Returned are Closed.

Refusals:
- release in any other state: `409 release_not_allowed`;
- release or return on a closed case: `409 case_closed`;
- ownership when not `awaiting_ownership`: `409 ownership_not_pending`;
- a reason when not `no_response`: `409 reason_not_needed`;
- a new request page unless the case is open, its data went as a data request page and no answer is recorded (status `awaiting_answer` or `no_response`, or a sunrise case still `cleared`), and ending a request page unless the case's current page is `live`: `409 request_page_not_open`.

`releaseAllowed` is true exactly in the releasable states.

**Answer window.** The answer is due `ANSWER_WINDOW_SECONDS` after Data sent (default 3600 seconds). An answer that arrives at the due instant or later is late: it is stored, counted and shown on the detail sheet with `late: true`, and it does not change the decision. From the due instant on, every response reports `no_response` and `answerRemainingSeconds` 0. The server's timed work also marks the case within 10 seconds of the due instant. For sunrise cases the Answered station stays `not_required`, and any answer is only shown in its detail sheet.

**Accepting answers.** One rule covers a network `answer` message and a data request page answer for a case whose data went to that counterparty. An answer is accepted (`201`) only while the case is open and no answer is recorded for it:

| Case state when the answer arrives | Result | `outcome` (network) | Case afterwards |
|---|---|---|---|
| `awaiting_answer`, before the due instant | stored with `late: false` | `accepted` or `rejected`, as sent | `accepted` or `rejected` |
| `awaiting_answer` at or after the due instant, or `no_response` | stored with `late: true`, decision not applied | `late` | `no_response` |
| sunrise path, still `cleared` | stored with `late: false`, shown only in the Answered detail sheet | `accepted` or `rejected`, as sent | stays `cleared` |

Every other such case answers `409 answer_not_expected`: a case that already has an answer recorded, and a `released` or `returned` case. A data request page that already holds its own answer answers `409 already_answered` instead.

**Review claims.**
- A claim lasts `REVIEW_CLAIM_SECONDS` (default 900 seconds). At its end instant the claim has lapsed, and any analyst may claim.
- Simultaneous claims have exactly one winner, chosen by the database. Every other caller gets `409 already_claimed` naming the holder and the claim instant.
- A holder claiming again gets `200` with their unchanged claim.
- Only the current holder may decide (`409 claim_not_held`).
- Once a case is decided, any later claim or decision answers `409 already_decided`, naming who decided and when, before any claim check.

**Data request pages.**
- A page is issued when Data sent happens for an off-network counterparty, or when staff send a new one.
- It ends `DATA_REQUEST_PAGE_SECONDS` after it is sent (default 86400 seconds), when a new page is sent for the same case, or when staff end it. The ending instant itself already counts as ended. The server judges this on every request, and an ended page answers 410.
- An answer from the page follows the same Accepting answers rule as a network answer.
- A page answers at most once.
- A new page never moves `answerDueAt` or the Data sent instant: the answer period always runs from the first Data sent, so an answer through a page sent after No response is late.
- The page shows the sending and destination addresses masked and the workspace's legal name as the requesting exchange.

**Licence certificates.**
- The type is judged by the file's leading bytes: PNG, JPEG or WebP. The extension and the declared type are ignored.
- The file may be at most 5,000,000 bytes, counted on the file alone, and exactly 5,000,000 bytes is allowed.
- Before storage, all location (GPS) data is removed from the image's embedded metadata, while the orientation tag and the pixels are kept.
- The certificate is stored in MinIO before the answer is recorded. If storage fails, nothing is recorded or stored.

**Threshold changes.**
- A change sets a jurisdiction's threshold, or brings a rule into force where there was none, from 00:00 business time on its chosen date.
- A date before today's business date is refused (`422`).
- A change for today takes effect at the moment it is announced, so cases created earlier that day keep the old rule.
- Two changes for one jurisdiction and date are refused (`409 change_exists`).
- Each workspace keeps its own rule book, seeded from the reference table in Seed data. The public directory always shows the reference table.
- A case uses the rules in force at its own creation instant. It keeps its threshold, rate, confirmation limit, counterparty rule and counterparty name in `decidedUnder`, its track, the daily report and the regulator's monthly file, whatever changes later.

**Daily report.** A business date covers local midnight to the next local midnight. It reports `startsAt`, `endsAt`, `hours` and the cases created inside it. For Neris, 28 Mar 2027 runs from `2027-03-27T22:00:00Z` to `2027-03-28T21:00:00Z` (23 hours), and 31 Oct 2027 runs from `2027-10-30T21:00:00Z` to `2027-10-31T22:00:00Z` (25 hours). A Kallang day is always 24 hours.

**Name normalisation (one rule for customer names and counterparty legal names).**
1. Apply Unicode NFKD and drop combining marks.
2. Map Æ to AE, Ø to O, Ł to L, Đ to D, ß to SS, Œ to OE and Þ to TH (both cases).
3. Convert to upper case.
4. Turn every run of characters that are not letters or digits into one space, and trim.
5. Split into tokens and compare them in any order.

**Match** when both names have the same tokens. **Partial** when every token of the shorter name is in the longer one and the longer has exactly one more. Otherwise **No match**. For example, `Łukasz Ørsted-Ækvist` matches `LUKASZ ORSTED AEKVIST`. An incoming transfer compares `beneficiary.name` with the customer who holds `destinationAddress`. Two counterparties in a workspace may not share a normalised legal name (`409 name_taken`). The public exchange search keeps an exchange when the normalised query is contained in its normalised name, so `mahe` finds Mahé Coin Ltd.

**LEI.** 20 characters, ISO 17442, whose check digits pass ISO 7064 MOD 97-10: letters A to Z count as 10 to 35, and the whole number modulo 97 must equal 1. Lower case is accepted and stored upper case. For example, `5493001KJTIIGC8Y1R12` is valid and `5493001KJTIIGC8Y1R13` is not. LEIs are unique within a workspace (`409 lei_taken`).

**Notes and text lengths.** Every length limit counts Unicode code points, so an emoji counts as 1. Notes may be at most 2,000 code points, and 2,000 is allowed.

**Renames.** A changed legal name shows at once wherever the counterparty itself appears: the counterparty list and page, the case's `counterparty.name`, the review queue, the incoming message sender and the create-case lookup. Every record of a decision or of data already sent keeps the name as decided or sent: the track, `decidedUnder.counterpartyName`, `dataSent.counterpartyNameAsSent`, the daily report and the regulator's monthly file. The counterparty page lists each previous name with `from` (the business date it came into use, or the copy's first business date for seeded names) and `until` (the business date of the rename).

**Spreadsheet import.**
- The file is UTF-8, with or without a byte order mark, with LF or CRLF line endings and RFC 4180 quoting.
- The header row is exactly `Legal name,LEI,Jurisdiction,Licence number,Due diligence,Contact email,Notes`. Row numbers follow the spreadsheet: the header is row 1 and the first data row is row 2.
- Matching: first by a valid LEI equal to an existing counterparty's LEI, then, with the LEI cell empty, by normalised legal name. Otherwise the row is new.
- A matched row updates licence number, due diligence, contact email and notes when they differ, and lists them in `changedFields`. It never renames. A matched row with nothing to change counts as unchanged.
- A new row needs a valid LEI, a licence number and a contact email, and joins off the network.
- Blank cells: in a matched row, a blank Licence number, Due diligence, Contact email or Notes cell keeps the stored value and is never listed in `changedFields`, and the Jurisdiction cell never changes the stored jurisdiction. In a new row, a blank Due diligence cell means Pending and a blank Notes cell means empty notes.
- A refused row gives exactly one reason: the first that applies in this order, checked top to bottom:
  1. `Legal name is required` (blank Legal name cell);
  2. `LEI check digits do not match` (a non-blank LEI cell that fails the LEI check);
  3. `Unknown jurisdiction` (a non-blank cell that is not a code from the rules table, or a blank cell in a new row);
  4. `Unknown due diligence status` (a non-blank cell other than the four statuses);
  5. `Notes are longer than 2,000 characters`;
  6. `Same counterparty as row <n>` (the row matches the same existing counterparty as an earlier row that is not refused, or would create a counterparty with the same LEI or normalised legal name as such a row; `<n>` is that earlier row's number);
  7. `Legal name matches another counterparty with a different LEI` (a valid LEI that matches no counterparty, while the normalised legal name matches one);
  8. `LEI is required for a new counterparty`;
  9. `Licence number is required for a new counterparty`;
  10. `Contact email is required` (a new row).
- Due diligence cells are `Trusted`, `Pending`, `Restricted` or `Blocked`. The jurisdiction is a code from the rules table. Every cell is trimmed of surrounding spaces, and due diligence and jurisdiction cells are matched ignoring case, so `trusted` and `lt` are accepted.
- Preview saves nothing. Saving applies exactly what the preview shows, so saving the same file twice creates and updates nothing the second time.

**Signed messages.**
- `v1` is the HMAC-SHA256, keyed with the sender's seeded signing value (its UTF-8 bytes), of the timestamp digits, a dot and the request body bytes exactly as received.
- The endpoint checks the signature against those raw bytes before any JSON parsing.
- `401 bad_signature` answers when the header is missing, the sender LEI is unknown or off the network, the timestamp is more than 300 seconds from server time either way (exactly 300 is accepted), or the value does not match.
- An accepted message is stored byte for byte in MinIO before the endpoint answers. The desk then works from a separate parsed working copy.
- The same `messageId` from the same sender with the same body bytes answers the first status and body, and stores, counts and changes nothing new. With different bytes it answers `409 message_id_reused`.

**Partner request keys.**
- The server stores the first response for a request key per partner key, success or refusal, except `401`, `429` and `503`, for 24 hours.
- A repeat with the same body bytes answers that stored status and body and creates nothing.
- The same key with different body bytes answers `409 request_key_reused`.

**Rate limits.**
- A partner key may make at most 30 case requests within `PARTNER_RATE_WINDOW_SECONDS` (default 60 seconds), repeats included.
- A member may download at most 5 regulator's monthly files within `REGULATOR_FILE_RATE_WINDOW_SECONDS` (default 600 seconds).
- The next request answers `429` with `Retry-After` in whole seconds, rounded up, until the oldest counted request leaves the window.
- Limits are keyed on the partner key or the member, never on the network address.

**Fees.**
- A metered message is each signed network message the desk sends as Data sent, and each first-accepted incoming network message. Repeats and data request pages are not counted.
- A message's business month comes from its instant in business time.
- Within a month, messages are counted in order into the tiers (prices in the workspace currency per message):
  - Tier 1, first 100 messages: Neris EUR 0.4250, Kallang SGD 0.6250;
  - Tier 2, messages 101 to 1,000: EUR 0.2125, SGD 0.3125;
  - Tier 3, messages over 1,000: EUR 0.1375, SGD 0.2050.
- Each tier with at least one message gives one fee line: count × unit price, computed exactly and rounded half up to whole cents. For example, 2 Tier 3 messages at EUR 0.1375 cost EUR 0.28.
- Tier labels are `Tier 1: first 100 messages`, `Tier 2: messages 101 to 1,000` and `Tier 3: messages over 1,000`.

**Month close.**
- A business month can be closed once it has ended (00:00 business time on the first of the next month). It bills every metered message dated in it.
- The close creates one Kill Bill invoice with one item per fee line. Only after Kill Bill returns that invoice does the server record the fee lines, the invoice id and the month's `invoiced` status in one transaction, and queue the finance mail, which is sent after commit.
- If Kill Bill is unreachable or refuses, nothing is recorded or mailed (`503 invoicing_unreachable`).
- Two presses or two simultaneous requests close the month once. The other answers `409 month_closed`, with no second invoice and no second mail.

**Retention and archive.**
- `RETENTION_SECONDS` after a case closes (default 157680000 seconds, five years), the server erases its personal data within 10 seconds of that instant. It sets `originator` and `beneficiaryName` to null, nulls the names in its sent data and in its answer messages' working copies, and deletes from MinIO every stored message and certificate linked to the case.
- Each object's SHA-256 digest, taken when it was stored, remains in `erasure.digests`.
- `erasure.status` is `pending` until MinIO confirms every deletion, and only then `erased`; a case with no stored objects goes straight to `erased`. `scheduled` means closed with `dueAt` in the future. `not_due` means open.
- The originals of erased messages answer `410 original_erased`.
- The officer may archive a closed case and bring it back. Bringing it back returns a body identical to the one before archiving, apart from `now` and the `erasure` object (which keeps advancing while archived), including the same `track` instants and history. Erasure continues for archived cases.

**Regulator's monthly file.**
- A case is a row in the file of the business month whose business-time range holds its `createdAt`, whatever its later status. Archived and erased cases stay in. Incoming messages are not rows.
- Rows are ordered by `createdAt`, then by reference. The file is UTF-8 without a byte order mark. Every field, header included, is in double quotes, and a double quote inside a value is doubled. Every line, the last one included, ends with CRLF.
- Neutralisation: a cell whose value begins with `=`, `+`, `-`, `@`, a tab or a carriage return gets an apostrophe in front of the value, inside the quotes, in every column. For example, a beneficiary name `=SUM(A1)` is written `"'=SUM(A1)"`.
- A null value is an empty cell (`""`).
- The header row is exactly: `"Reference","Created at","Asset","Amount","Fiat value","Currency","Threshold","Rule in force since","Rate","Counterparty name","Counterparty LEI","Counterparty jurisdiction","Counterparty rule","Path","Status","Data sent via","Data sent at","Answer","Answer late","Answered at","Originator name","Originator identity number","Originator date of birth","Beneficiary name","Closed at","Outcome"`.
- Columns, in that order, and their sources:

| Column | Source | Format |
|---|---|---|
| Reference | `reference` | as in the API |
| Created at | `createdAt` | ISO 8601 UTC, whole seconds, `Z` |
| Asset | `asset` | asset code |
| Amount | `amount` | the API decimal string with the asset's exact decimals |
| Fiat value | `fiatValueCents` | decimal with exactly two decimals and no thousands separator (`1000.01`) |
| Currency | `currency` | ISO code |
| Threshold | `decidedUnder.thresholdCents` | as Fiat value |
| Rule in force since | `decidedUnder.ruleInForceSince` | `YYYY-MM-DD` |
| Rate | `decidedUnder.rateCents` | as Fiat value |
| Counterparty name | `decidedUnder.counterpartyName` | the name as decided; empty for a self-hosted wallet |
| Counterparty LEI | `counterparty.lei` | upper case; empty for a self-hosted wallet |
| Counterparty jurisdiction | `counterparty.jurisdictionCode` | code; empty for a self-hosted wallet |
| Counterparty rule | `decidedUnder.counterpartyRule` | `in_force` or `no_rule`; empty for a self-hosted wallet |
| Path | `path` | API enum |
| Status | `status` | API enum |
| Data sent via | `dataSent.channel` | `network` or `request_page` |
| Data sent at | `dataSent.at` | as Created at |
| Answer | `answer.decision` | `accepted` or `rejected` |
| Answer late | `answer.late` | `true` or `false` |
| Answered at | `answer.at` | as Created at |
| Originator name | `originator.name` | as stored |
| Originator identity number | `originator.identityNumber` | as stored |
| Originator date of birth | `originator.dateOfBirth` | `YYYY-MM-DD` |
| Beneficiary name | `beneficiaryName` | as stored |
| Closed at | `closedAt` | as Created at |
| Outcome | `outcome` | `released` or `returned` |

- A support agent's file masks Originator name, Originator identity number and Beneficiary name as in Masking for support agents, and its Originator date of birth cells are empty. For an erased case, the four personal columns are empty in every member's file.

**Masking for support agents.** In every response, screen and file that a support agent receives:
- `originator.name` and `beneficiaryName` become initials: the first letter of each name part split at spaces and hyphens, each followed by a dot and joined by spaces, so `Łukasz Ørsted-Ækvist` becomes `Ł. Ø. Æ.`;
- `identityNumber` becomes the ellipsis character and the last four characters (`…0001`);
- the `dateOfBirth` key is absent;
- incoming message names and customer names are masked the same way, and support may not download originals (`403`).

Mail never carries personal data.

**Sessions.**
- A session ends `SESSION_SECONDS` after sign-in (default 28800 seconds), judged by the server. The next request answers `401 session_ended`.
- Removing a member ends their sessions, and their next request answers `401 access_removed`.
- A changed role applies from the member's next request.

**Isolation.** Every workspace is isolated. Another workspace's case, message, certificate, counterparty, member, key or month answers `404`, as does another workspace's slug in the path.

**Role table.** Who may act is stated in the API rows. Read access is listed there. Every other role is refused with `403`.

### Services (DP-36, DP-38, DP-41, DP-46, DP-60)

**PostgreSQL** holds:
- members and sessions;
- cases with their `decidedUnder` record and track instants;
- threshold changes;
- counterparties with previous names;
- the address registry, customers and rates;
- metered messages and closed months with their fee lines;
- message and certificate records with digests;
- request keys, partner keys and listings;
- each workspace's exact starting data.

The schema and seed apply idempotently every time the server starts, so an empty database comes up fully seeded.

**MinIO** (`S3_BUCKET`) holds:
- each accepted incoming message, byte for byte, at `<workspace slug>/messages/<message id from the API>`;
- each licence certificate, with location data removed, at `<workspace slug>/certificates/<certificate id>`.

The server creates the bucket at start if it is missing. While MinIO is unreachable:
- a message or certificate is refused with `503 storage_unreachable`, its copy on screen, and nothing stored or recorded;
- Download original answers the same `503`;
- erasure stays `pending`.

**Kill Bill.**
- Each workspace has one account with external key `lanternline-<workspace slug>`, its legal name and its currency. The account is created on first use and reused after that.
- A month close posts the month's fee lines as external charges in one call that commits one invoice. The item description is `<tier label>, <count> messages, <Month YYYY>` (`1 message` when the count is 1), with the line amount and the workspace currency.
- The month records the returned invoice id, and `GET /invoices/<invoice id>` in Kill Bill shows exactly one item per fee line.
- While Kill Bill is unreachable, the close answers `503 invoicing_unreachable` with the copy from Feedback states, kept on screen through every later repaint, and records or mails nothing.

**Mailpit (SMTP).** Every mail comes from `MAIL_FROM` (`Lanternline Desk <desk@lanternline.example>`) and carries no personal data.
- **Data request page.** To the counterparty's contact email. Subject `Travel Rule data request <case reference> from <workspace name>`. The text body holds the page address `<public URL>/r/<token>`, the case reference, the asset and amount, the masked from and to addresses, and `This page ends at <date-time>.`. A mail goes out each time a page is issued.
- **Month closed.** To every finance lead of the workspace. Subject `Lanternline: <Month YYYY> closed`. The body lists each fee line, the total and the Kill Bill invoice id. It goes out only after the fee lines and invoice are recorded.

### Seed data (DP-54)

Every seeded person, business, address, identity number and signing value is invented. A fresh copy on its own empty database and bucket starts with exactly these records and nothing else: no cases, no messages, no certificates, no objects in the bucket, and no members or keys beyond those listed.

**Workspaces**

| Slug | Name | Legal name | LEI | Jurisdiction | Business time | Currency | Confirmation limit | Case prefix | Sending address |
|---|---|---|---|---|---|---|---|---|---|
| `neris` | Neris Digital | Neris Digital UAB | `984500NERISDIGIT0172` | LT | Europe/Vilnius | EUR | EUR 1,000.00 | `NRS-` | `lnl1neriswallet0000000000000000001` |
| `kallang` | Kallang Exchange | Kallang Exchange Pte. Ltd. | `984500KALLANGEX00166` | SG | Asia/Singapore | SGD | SGD 1,500.00 | `KLG-` | `lnl1kallangsend0000000000000000001` |

Case references are the prefix and six digits, counting from `000001` per workspace.

**Members.** Every member's password is `Lantern-Desk-2027!`.

| Workspace | Name | Email | Role |
|---|---|---|---|
| neris | Ieva Morkūnė | `officer@neris.example` | compliance_officer |
| neris | Tomas Vaitkus | `analyst@neris.example` | compliance_analyst |
| neris | Dalia Petraitytė | `ops@neris.example` | operations_lead |
| neris | Marius Jankus | `finance@neris.example` | finance_lead |
| neris | Greta Lukoševičiūtė | `support@neris.example` | support_agent |
| kallang | Mei Ling Tan | `officer@kallang.example` | compliance_officer |
| kallang | Arjun Pillai | `analyst@kallang.example` | compliance_analyst |
| kallang | Siti Rahmah | `ops@kallang.example` | operations_lead |
| kallang | Daniel Koh | `finance@kallang.example` | finance_lead |
| kallang | Nur Aisyah | `support@kallang.example` | support_agent |

**Customers**

| Id | Name | Identity number | Date of birth | Deposit address |
|---|---|---|---|---|
| `cust-neris-01` | Łukasz Ørsted-Ækvist | TEST-ID-0001 | 1986-04-12 | `lnl1nerisclient0000000000000000001` |
| `cust-neris-02` | Đurđica Weiß | TEST-ID-0002 | 1979-11-03 | `lnl1nerisclient0000000000000000002` |
| `cust-neris-03` | Œnone Bérubé | TEST-ID-0003 | 1992-02-29 | `lnl1nerisclient0000000000000000003` |
| `cust-neris-04` | Þóra Jónsdóttir | TEST-ID-0004 | 1990-07-21 | `lnl1nerisclient0000000000000000004` |
| `cust-neris-05` | Rūta Kairienė | TEST-ID-0005 | 1984-09-30 | `lnl1nerisclient0000000000000000005` |
| `cust-neris-06` | Jonas Petraitis | TEST-ID-0006 | 2001-01-15 | `lnl1nerisclient0000000000000000006` |
| `cust-kallang-01` | Tan Wei Ming | TEST-ID-0011 | 1988-05-06 | `lnl1kallangcust0000000000000000001` |
| `cust-kallang-02` | Siobhán Ó Briain | TEST-ID-0012 | 1975-12-24 | `lnl1kallangcust0000000000000000002` |
| `cust-kallang-03` | Ægir Løkke | TEST-ID-0013 | 1983-03-17 | `lnl1kallangcust0000000000000000003` |
| `cust-kallang-04` | Nguyễn Thị Lan | TEST-ID-0014 | 1996-08-08 | `lnl1kallangcust0000000000000000004` |
| `cust-kallang-05` | Paweł Strauß | TEST-ID-0015 | 1991-10-10 | `lnl1kallangcust0000000000000000005` |
| `cust-kallang-06` | Priya Raman | TEST-ID-0016 | 1999-06-01 | `lnl1kallangcust0000000000000000006` |

**Counterparties.** Each workspace has its own copy of these eight, with the same values except the signing values. Each registry address maps to its counterparty in both workspaces' address registries.

| Legal name | LEI | Jurisdiction | Licence number | Due diligence | Network | Contact email | Registry address |
|---|---|---|---|---|---|---|---|
| Harbourgate Digital Assets Ltd | `5299004HARBOURGATE75` | IE | IE-CBI-VASP-0417 | trusted | on_network | | `lnl1harbourgate0000000000000000001` |
| Tallinn Star Exchange OÜ | `3912006TALLINNSTAR86` | EE | EE-FIU-FVT000311 | trusted | off_network | `compliance@tallinnstar.example` | `lnl1tallinnstar0000000000000000001` |
| Keystone Vault AG | `2549001KEYSTONEVA089` | CH | CH-FINMA-SRO-2291 | pending | on_network | | `lnl1keystonevlt0000000000000000001` |
| Sakura Vault HK Limited | `635400SAKURAVAULT155` | HK | HK-SFC-BSV-118 | trusted | on_network | | `lnl1sakuravault0000000000000000001` |
| Meridian Coin S.A. | `213800MERIDIANCOIN70` | PA | PA-SBP-0093 | trusted | off_network | `compliance@meridiancoin.example` | `lnl1meridiancsa0000000000000000001` |
| Baltic Rail Crypto UAB | `5493007BALTICRAIL035` | LT | LT-FNTT-VASP-0552 | restricted | on_network | | `lnl1balticrails0000000000000000001` |
| Nordlys Exchange Ltd | `9695009NORDLYSXC0095` | SC | SC-FSA-VA-0071 | blocked | off_network | `compliance@nordlys.example` | `lnl1nordlysexch0000000000000000001` |
| Atlas Peak Digital FZE | `254900ATLASPEAK00012` | AE | AE-VARA-0336 | trusted | on_network | | `lnl1atlaspeakfz0000000000000000001` |

Seeded notes are empty. `lnl1selfcustody0000000000000000001` is a well-formed address that is in no registry. For example, with the seed data at start, it is a self-hosted wallet.

**Signing values** (HMAC keys, used as their UTF-8 bytes):

| Counterparty | Neris | Kallang |
|---|---|---|
| Harbourgate Digital Assets Ltd | `lnls_neris_harbourgate_3f9a1c7e` | `lnls_kallang_harbourgate_a4c8e216` |
| Keystone Vault AG | `lnls_neris_keystone_8b2d4f60` | `lnls_kallang_keystone_17f3b9d0` |
| Sakura Vault HK Limited | `lnls_neris_sakura_c71e05a9` | `lnls_kallang_sakura_92e5c04b` |
| Baltic Rail Crypto UAB | `lnls_neris_balticrail_5d93b2e4` | `lnls_kallang_balticrail_6ab1d7f3` |
| Atlas Peak Digital FZE | `lnls_neris_atlaspeak_e0a6f318` | `lnls_kallang_atlaspeak_d38f0e65` |

**Rates** (in force since 2026-01-01, per whole unit):

| Asset | EUR | SGD |
|---|---|---|
| BTC | 61,250.00 | 90,125.50 |
| ETH | 3,333.35 | 5,000.00 |
| USDC | 0.92 | 1.35 |
| SOL | 142.17 | 209.40 |

For example, with the seed data at start: 0.3 ETH from Kallang is exactly SGD 1,500.00, and 0.2 ETH from Kallang is SGD 1,000.00, below Singapore's threshold.

**Jurisdiction reference table.** This table is seeded in the public directory, and each workspace's rule book starts with a copy of it. Its rule data is illustrative.

| Code | Name | Region | Currency | Status | Threshold in force | In force since | Announced change |
|---|---|---|---|---|---|---|---|
| LT | Lithuania | europe | EUR | in_force | 0.00 | 2024-12-30 | |
| EE | Estonia | europe | EUR | in_force | 0.00 | 2024-12-30 | |
| IE | Ireland | europe | EUR | in_force | 0.00 | 2024-12-30 | |
| DE | Germany | europe | EUR | in_force | 0.00 | 2024-12-30 | |
| MT | Malta | europe | EUR | in_force | 0.00 | 2024-12-30 | |
| CH | Switzerland | europe | CHF | in_force | 1,000.00 | 2021-01-01 | CHF 0.00 from 2028-01-01 |
| GB | United Kingdom | europe | GBP | in_force | 840.00 | 2023-09-01 | |
| SG | Singapore | asia_pacific | SGD | in_force | 1,500.00 | 2020-01-28 | |
| HK | Hong Kong | asia_pacific | HKD | in_force | 8,000.00 | 2023-06-01 | |
| AE | United Arab Emirates | middle_east | AED | announced | | | AED 3,500.00 from 2028-03-01 |
| TH | Thailand | asia_pacific | THB | announced | | | THB 50,000.00 from 2028-07-01 |
| PA | Panama | americas | USD | no_rule | | | |
| SC | Seychelles | africa | USD | no_rule | | | |

**Listed exchanges** (all listed at start):

| Listing slug | Name | Jurisdiction | On network |
|---|---|---|---|
| `neris-digital` | Neris Digital UAB | LT | yes |
| `kallang-exchange` | Kallang Exchange Pte. Ltd. | SG | yes |
| `harbourgate-digital-assets` | Harbourgate Digital Assets Ltd | IE | yes |
| `tallinn-star-exchange` | Tallinn Star Exchange OÜ | EE | no |
| `keystone-vault` | Keystone Vault AG | CH | yes |
| `sakura-vault-hk` | Sakura Vault HK Limited | HK | yes |
| `meridian-coin` | Meridian Coin S.A. | PA | no |
| `baltic-rail-crypto` | Baltic Rail Crypto UAB | LT | yes |
| `nordlys-exchange` | Nordlys Exchange Ltd | SC | no |
| `atlas-peak-digital` | Atlas Peak Digital FZE | AE | yes |
| `rheinmark-krypto` | Rheinmark Krypto GmbH | DE | yes |
| `valletta-blockworks` | Valletta Blockworks Ltd | MT | no |
| `thamesgate-digital` | Thamesgate Digital Ltd | GB | yes |
| `chao-phraya-digital` | Chao Phraya Digital Co., Ltd. | TH | no |
| `mahe-coin` | Mahé Coin Ltd | SC | no |

**Partner keys** (one per workspace, never used at start):

| Workspace | Label | Key |
|---|---|---|
| neris | Neris core banking | `lnlk_5e1f0a7c3b9d48e2a6f1c0d9b8e7a6f5` |
| kallang | Kallang ledger | `lnlk_9a2c4e6f8b0d1e3f5a7c9e1b3d5f7a90` |

**Metered messages.** At first start, the server takes the business month that contains the start instant (month 0) and seeds metered message records, not stored messages, for the three months before it. All are dated the 15th of their month at 12:00 business time.

| Month | Messages | Neris fee lines (EUR) | Kallang fee lines (SGD) |
|---|---|---|---|
| month −1 | 1,002 | 42.50, 191.25, 0.28; total 234.03 | 62.50, 281.25, 0.41; total 344.16 |
| month −2 | 1,003 | 42.50, 191.25, 0.41; total 234.16 | 62.50, 281.25, 0.62; total 344.37 |
| month −3 | 1,215 | 42.50, 191.25, 29.56; total 263.31 | 62.50, 281.25, 44.08; total 387.83 |

At start, these three months read `ready` and month 0 reads `open`.

## Technical requirements

### Deployment (DP-52, DP-60)

- Node.js 22 LTS with npm is available. Write the app in TypeScript.
- At the root of `/app`, ship `/app/run.json` with string fields `install`, `build` and `serve` and `"_schema":"run-manifest-v1"`. For example: `{"_schema":"run-manifest-v1","install":"npm ci","build":"npm run build","serve":"node dist/server.js"}`.
- The server binds `0.0.0.0` on port 4173, or on `APP_PUBLIC_PORT` when that is set, and serves the API and every page from that one origin.
- `GET /api/health` answers HTTP 200 with JSON `{"status":"ok"}`.
- The grader may run several copies at once, each with its own empty database and bucket, broken dependency or short timers. Each copy migrates and seeds itself at start and serves every screen that does not need an unreachable service.
- Timed work (answer windows, claim ends, data request page ends, erasure) runs on the server at least every ten seconds.

### Configuration and secrets (DP-60)

The server reads all of the following at start and never hard-codes them or sends them to the browser:
- `DATABASE_URL`;
- `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_FORCE_PATH_STYLE`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`;
- `KILLBILL_URL`, `KILLBILL_USERNAME`, `KILLBILL_PASSWORD`, `KILLBILL_API_KEY`, `KILLBILL_API_SECRET`;
- `SMTP_HOST`, `SMTP_PORT`, `MAIL_FROM`;
- `APP_PUBLIC_URL`, the public base for mail links and the sitemap. When it is unset, use `http://localhost:<port>`.

Timers, also read at start:
- `ANSWER_WINDOW_SECONDS` (default 3600);
- `REVIEW_CLAIM_SECONDS` (default 900);
- `DATA_REQUEST_PAGE_SECONDS` (default 86400);
- `RETENTION_SECONDS` (default 157680000);
- `PARTNER_RATE_WINDOW_SECONDS` (default 60);
- `REGULATOR_FILE_RATE_WINDOW_SECONDS` (default 600);
- `SESSION_SECONDS` (default 28800).

Passwords are stored only as salted slow hashes. Partner keys are stored only as hashes.

### Server boundary (DP-53, DP-55)

- Same-origin only: no cross-origin headers. The session cookie is HttpOnly and SameSite=Lax and never marked Secure, because the desk is served over plain HTTP, and mutating staff requests require their published content type.
- Body limits are those in API, answered with `413` before the body is parsed.
- The server never serves source files, the run manifest, environment values, credentials, signing values, stored partner keys or password hashes.
- An unknown path under `/api/` answers the JSON `404`. Any other unknown path answers the HTML not-found page with status 404.
- When MinIO or Kill Bill is unreachable at boot, the server still starts, keeps retrying in the background and answers their actions with the published `503`.
- PostgreSQL is required. The server waits for it at boot before reporting healthy.

### Browser support and performance (DP-56)

- The latest Chromium, Firefox and WebKit, at 375x812, 768x1024, 1024x768 and 1280x800, with mouse, keyboard and touch.
- Every screen is usable within three seconds of navigation on the published hardware.
- A server-reported change appears on an open screen within 5 seconds, which is the poll interval.
- Fonts and every other asset are served by the app itself.

## Working rules

- IF-01: `/app/run.json` exists with exactly the string keys `install`, `build` and `serve` plus `"_schema":"run-manifest-v1"`.
- IF-02: `/app/THIRD_PARTY_NOTICES.md` names every shipped package and every bundled font with its licence. Shipped packages are the production dependency tree (`npm ls --omit=dev --all --json`, or the lockfile's non-dev packages).
- IF-03: Every shipped package and font uses one of MIT, ISC, BSD-2-Clause, BSD-3-Clause, Apache-2.0, 0BSD or OFL-1.1.
- IF-04: The app stores data only in PostgreSQL, MinIO, Kill Bill and Mailpit. There is no SQLite, Redis, in-memory store standing in for a service, or file written under `/app` at runtime.
- IF-05: `/app` contains a committed npm lockfile and no `.env` file or credential values.
- IF-06: No page loads scripts, styles or fonts from another origin.

## Engineering standards

- The TypeScript compiles in strict mode, without suppressed type errors or `any` on domain values.
- Names in the source match the domain terms of this brief: case, counterparty, handshake track, station, request page, threshold change, fee line, business month, partner key.
- Each domain rule is decided in exactly one place in the source, including the path decision, the case state transitions, the fiat value rounding, the name normalisation, the LEI check, the signature check and the tier pricing. Screens render the server's result and never recompute it.
- Every error leaves the server in the one published error shape, built by one shared mechanism.
- Every abstraction has more than one implementation or caller.
- There is no dead, commented-out or unreachable code, and no defensive check for a state the types already rule out.
- Money and crypto amounts never pass through binary floating point anywhere in the source.
- The source contains no feature, endpoint or screen beyond this brief.
