# Gigfreight Dispatch Desk

Build and deploy a working web application from this brief. There is no starting codebase. Gigfreight is a trucking crew that moves the stages, lights and sound for touring shows. This app is its dispatch desk. A tour manager asks for trucks for a run of dates with four stops in order. A dispatcher puts real trucks from the company's one shared fleet on the request, then confirms it or declines it with a note. Admins also take trucks in and out of maintenance and manage member roles. Every step is written to the request as dated activity. The app is an Express server on Node.js that renders Nunjucks templates, and htmx swaps server-rendered fragments into the page. PostgreSQL is the only backing service, and every count, state and permission is decided on the server from its rows. That holds when two people write at the same moment and when a page in someone's browser has gone stale. Sign-up, quotes and pricing, billing, recruiting, map search, file upload and password reset are out of scope. There is no second datastore.

## Problem and users

Gigfreight is one entertainment trucking company with two depots, North and South. Today tour managers email their trucking requests, with dates and venues spread across threads. Dispatchers track which truck is on which run in a spreadsheet. So the same truck gets promised to two tours, a run is confirmed with too few trucks, and a manager who was moved off a desk can still act on it from an open browser tab.

The desk holds a fleet of ten trucks, `TR-101` to `TR-110`. Each truck is based at a depot and is either available, assigned or in maintenance. A request has these parts:

- a tour name;
- a type of transportation: `Tour`, `Show` or `Show freight`;
- how many trucks it needs;
- exactly four stops in order: Pickup, Delivery, First Show and Last Show, each with an optional date and a full address.

A request starts `Submitted`. Dispatchers assign available trucks to it one at a time, and it ends `Confirmed` or `Declined`. Declining it hands its trucks back to the fleet.

| Role | Goal and powers |
|---|---|
| `tour_manager` | Get trucks booked for a tour. Submits requests and reads only their own requests, stops and activity. |
| `dispatcher` | Keep the fleet honest. Reads every request, works the Dispatch board and the fleet, assigns and releases trucks, and confirms or declines requests. |
| `admin` | Everything a dispatcher does, plus truck maintenance and member roles. |

The server enforces authorization on every endpoint, page and fragment. Hiding a button does not count as authorization. Membership is closed. Every seeded person, tour, venue and business is invented.

## Journeys

1. **A tour manager submits a request.** Maya Manager is signed out. She signs in and chooses `New request`.
   - Step 1: `Midnight Static spring tour`, `Tour`, `2` trucks.
   - Step 2: Pickup `2026-04-10`, `12 Quarry Lane`, `Ottawa`, `ON`, `K1A 0B1`, `Canada`. Delivery `2026-04-11`, `40 Arena Way`, `Toronto`, `ON`, `M5V 2T6`, `Canada`. First Show `2026-04-12` at the same Toronto address. Last Show `2026-04-30`, `9 Riverside Drive`, `Chicago`, `IL`, `60601`, `USA`.
   - Step 3: she reviews it and chooses `Submit request`. A double click still stores one request.

   She lands on `/requests/<id>/submitted`, which reads `Request submitted` and shows the new id and a `View request` link. The request reads `Submitted`, and its activity starts with its requested-trucks entry.
2. **A step is corrected.** On step 2 Maya dates Delivery before Pickup. She presses `Next`, and the reason appears under the Delivery date while everything she typed stays. She goes `Back` to step 1, then forward again, and nothing is lost.
3. **A tour manager searches and pages.** Maya types part of a tour name in `Search requests`, narrows by `Status`, and presses `Show more requests` until the button is gone. She sees only her own requests, each exactly once, even while other managers submit new ones.
4. **A dispatcher fills and confirms a request.** Dex Dispatcher opens `Dispatch` and reads the board summary. He opens Maya's new request, assigns `TR-101` and then `TR-105` from `Assign truck`, writes `Two trucks confirmed for the spring run.` in `Note` and chooses `Confirm`. He lands on `Decision recorded`. The request reads `Confirmed` with both trucks and the decision in its activity, and the fleet and board counts have moved by exactly those two trucks.
5. **A dispatcher works a stale page.** Dex has a request page open. Meanwhile another dispatcher assigns the truck Dex is about to pick, or releases a truck so the request is short, or decides the request. Dex's next action shows the server's reason in the status region. The panel redraws from what is stored, so it never shows a truck as free or as assigned against the database.
6. **A dispatcher declines.** Dex declines a request with a note. Its trucks leave the request on every surface, read available on the fleet straight away, and can go on another request at once.
7. **The admin runs the fleet and the crew.** Ada Admin takes `TR-108` into maintenance on `/fleet` and brings it back. On `/admin/users` she makes Milo Manager a dispatcher, and his open session gains Dispatch on his next page load. Later she demotes him, and his very next action is refused.
8. **A tour manager is kept out.** Maya opens `/dispatch`, `/fleet` or another manager's request. She reads the access refusal or the not-found page, and the same calls at the API are refused. After five mistyped passwords for one address, further sign-ins for that address are held back for a while.

## Mandatory requirements

This is the complete list of mandatory requirements; every check traces to one of these lines and the detailed sections below.

- **DP-01 — Seeded sign-in** Each seeded member exchanges their email and password at `POST /api/auth/login` for a bearer token and their user, `GET /api/auth/me` describes them, and `POST /api/auth/logout` revokes the token.
- **DP-02 — Refused sign-in and missing sessions** A wrong password and an unknown email both answer `401` with the same copy until the DP-39 throttle applies, and repeated failures for one address are throttled with `429`, while every JSON route except health and login answers `401` without a valid token, as stated in API.
- **DP-03 — Sign-in in the browser** A signed-out page request lands on the sign-in page with its `next` path and returns there after sign-in, the session survives a reload, `Sign out` ends it, and a throttled sign-in shows its message and keeps the email.
- **DP-04 — Seeded fleet** The ten seeded trucks are listed in id order with their depot, state and open request, the list narrows by state, and `/fleet` shows the fleet summary line.
- **DP-05 — Seeded requests and stops** The four seeded requests are stored once each with the statuses, trucks, decisions, four ordered stops and activity given in Seed data.
- **DP-06 — Dispatch board** The board lists submitted requests oldest first with a summary of the count waiting, the trucks still needed and the trucks available, computed from stored rows.
- **DP-07 — Request validation** A request with a bad tour name, type, truck count, stop, note, draft id or out-of-order stop dates is refused with `422` and nothing is stored.
- **DP-08 — Stored submission** A valid request is stored `submitted` with the next consecutive `LR-` id, its four stops and one `submitted` activity entry reading its requested truck count, and fields such as status or requester sent in the body are ignored.
- **DP-09 — New request in the browser** A tour manager walks the three New request steps, lands on the `Request submitted` page and follows `View request` to the stored request.
- **DP-10 — Step rules in the browser** `Back` keeps what was typed, a refused step keeps its input and shows the reason, a later step opened early returns to the earliest unfinished step, and `Cancel` on a typed step asks to discard.
- **DP-11 — Request list API** `GET /api/requests` lists requests newest first in pages of at most 100 with an `X-Next-Cursor` header while more follow, narrows by `status` and `q`, and refuses a bad `status`, `limit` or `cursor` with `400`.
- **DP-12 — Search, filter and paging in the page** The `Search requests` field and the `Status` select narrow the list in place and are reflected in the address, an empty search offers `Clear search`, and `Show more requests` appends the next page under the same filters.
- **DP-13 — Request visibility** A tour manager lists and reads only their own requests, with `404` for anyone else's by id, while dispatchers and admins read every request.
- **DP-14 — Not-found pages** A hidden or missing request and any unknown address show their not-found copy with a real not-found status and a way back to requests.
- **DP-15 — Request page** A request page shows its four numbered stop cards, its trucks with the count line and its activity timeline, and a timeline that fails to load offers `Try again`.
- **DP-16 — Truck assignment** A dispatcher assigns one available truck at a time to a submitted request, which marks the truck assigned in storage and writes `truck_assigned` activity.
- **DP-17 — Assignment conflicts** A busy or parked truck and a truck beyond the requested count are refused with `409` and their copy, an unknown truck with `422`, and nothing changes.
- **DP-18 — Truck release** Releasing a truck from a submitted request makes it available again with `truck_released` activity, and releasing an existing truck not on a submitted request answers `404`, as qualified in Business rules.
- **DP-19 — Confirmation** Confirming a fully assigned request with a note records the decider, the time and the note, while confirming with too few trucks answers `409`.
- **DP-20 — Decline and decided once** Declining releases every truck and records the note, a bad decision is refused with `422`, and any assignment, release or decision on a decided request answers `409`.
- **DP-21 — One winner** Two simultaneous assignments of one truck, or two simultaneous decisions on one request, produce exactly one success and one `409`.
- **DP-22 — Dispatch in the browser** A dispatcher reads the board summary, opens a request, assigns two trucks from `Assign truck`, writes a note, confirms and lands on `Decision recorded`.
- **DP-23 — Dispatch panel feedback** Assigning or releasing shows its notice and updates the trucks, count line and timeline in place, while an early confirm or a decline without a note shows its reason and leaves the request submitted.
- **DP-24 — Tour managers kept out of dispatch** A tour manager is refused the board, the fleet, every assignment and every decision with `403` at the API, a role sent in a body grants nothing, and the pages show no dispatch controls.
- **DP-25 — Fleet maintenance** Only an admin moves an available truck into maintenance and back, and a truck on a request is refused with `409`.
- **DP-26 — Maintenance in the browser** An admin chooses `Start maintenance` on `TR-108` on the fleet page and sees `Truck updated` with the truck in maintenance and the fleet summary line updated.
- **DP-27 — Closed membership** Members are listed and changed by admins only, there is no sign-up endpoint or page, and no quote, upload or password reset surface exists.
- **DP-28 — Role changes** An admin's role change is stored, only the role is read from the body, and demoting the only admin is refused with `409`.
- **DP-29 — Role change in the browser** An admin makes Milo Manager a dispatcher on the members page and sees `Role saved`.
- **DP-30 — Accessibility** The sign-in page and the signed-in pages meet WCAG 2.2 AA with no serious or critical violation, keyboard focus reaches the navigation with a visible ring, and the current navigation item is marked.
- **DP-31 — Phone width** At a 360 pixel viewport no page scrolls sideways and the sidebar folds behind a `Menu` button.
- **DP-32 — Motion** Button labels roll on hover, page headline lines rise one after another, the slogan rail drifts on its named loop and a ring spinner turns while the timeline loads, as described in Motion and effects.
- **DP-33 — Reduced motion** Under the system reduced-motion preference, or with the remembered `Reduce motion` switch on, no motion runs and every final state shows at once.
- **DP-34 — No outside hosts** The pages contact no host other than the app's own origin.
- **DP-35 — Health and production serving** `GET /api/health` answers `{"status": "ok"}` without a session from a production server once the database is ready, and the sign-in page arrives server-rendered.
- **DP-36 — Stage-dark look** The desk follows the near-black canvas, condensed display type, status chips, line icons, violet-blue actions and closing band described in Visual design.
- **DP-37 — Desk layouts** The request page, the three steps, the submission confirmation and the phone cards follow the arrangement described in Screens and layout.
- **DP-38 — Source integrity** The database address comes from the environment, roles are read from stored members, every multi-row write lands whole or not at all, and every record lives in PostgreSQL.
- **DP-39 — Sign-in throttle** After five failed sign-ins for one address within the lockout window, every further sign-in for that address answers `429` with `Retry-After`, counted in PostgreSQL the same way for known and unknown emails, as qualified in Business rules.
- **DP-40 — One count of the fleet** Each request's trucks and count, the board's trucks needed and available, each truck's request and the fleet summary agree with the stored assignment rows after any sequence of writes.
- **DP-41 — Stable request pages** Paging the request list with its cursor never repeats or skips a request while new requests arrive, and filters and ownership apply to every page.
- **DP-42 — Honest panel after a stale page** A refused panel action shows the server's message in the status region and redraws the trucks, count line, `Assign truck` options and status chip from stored rows.
- **DP-43 — Declined requests hold no trucks** After a decline its trucks are gone from the request on every surface and free at once, and a racing assignment or release never leaves a truck on a declined request or a request confirmed short.
- **DP-44 — One request per draft** A repeated `draft_id` from the same member returns the stored request with `200`, two simultaneous posts of one draft store exactly one request, and simultaneous distinct posts get consecutive ids without errors.
- **DP-45 — Ownership on every derived surface** A tour manager's search, paging, activity, confirmation pages and fragment addresses never reveal another manager's request and answer exactly as a missing id does.
- **DP-46 — Maintenance against assignment** Starting or ending maintenance on a truck while it is being assigned yields exactly one winner and a consistent fleet row.
- **DP-47 — Role changes apply at once and keep one admin** A role change applies on the member's very next request, including tokens and pages issued before it, and two admins demoting each other at once leave exactly one admin.

## Frontend

The front end owns:

- the three New request steps and the draft they keep between steps;
- the forms and their messages;
- the filters and the `Show more requests` control;
- the confirmation pages;
- the `Reduce motion` switch;
- the design system below.

The page never decides a status, a count or a truck's state. Hiding a control only changes what is drawn; the server refuses a write regardless of what the page shows. Where this section gives a value, that value is the design. Where it is silent, the choice is yours as long as it keeps these rules.

### Screens and layout (DP-03, DP-04, DP-06, DP-09, DP-12, DP-14, DP-15, DP-22, DP-26, DP-31, DP-37)

| Route | Purpose | Who |
|---|---|---|
| `/` | redirects to `/requests` or `/login` | any |
| `/login` | sign in | public |
| `/requests` | list, search, status filter, paging | member |
| `/requests/new` | step 1, tour details | member |
| `/requests/new/stops` | step 2, the four stops | member |
| `/requests/new/review` | step 3, notes, review and submit | member |
| `/requests/{id}/submitted` | the submission confirmation | owner, dispatcher, admin |
| `/requests/{id}` | one request with stops, trucks, activity and the dispatch panel | owner, dispatcher, admin |
| `/requests/{id}/decided` | the decision confirmation | dispatcher, admin |
| `/dispatch` | the Dispatch board | dispatcher, admin |
| `/fleet` | the trucks, with maintenance controls for admins | dispatcher, admin |
| `/admin/users` | member roles | admin |

**Shell.** On desktop a fixed left sidebar, about a fifth of the width, sits beside a wide work area. The sidebar holds, from top to bottom:

- the three-line lockup;
- `Requests`, then `Dispatch` and `Fleet` for dispatchers and admins, then `Members` for admins;
- at the foot, the member's name, a role badge, the `Reduce motion` switch and `Sign out`.

The navigation reflects the member's stored role when the page is rendered, so it changes on the first page load after a role change.

**Sign in.** The three-line lockup sits at top left and the tipped logo at top centre. The display headline `Let's move your next show.` fills the left half in three lines. On the right are:

- the heading `Sign in to Gigfreight`;
- the line `Fill in your details, we will take it from there.`;
- an `Email` field and a `Password` field;
- a full-width violet-blue `Sign in` button with its arrow;
- under the button, a muted line: `Demo accounts: admin, dispatcher, manager and milo at example.com, password deku-demo-pw-2026`.

**Requests.** `/requests` has a `Search requests` field and a `Status` select with `All statuses`, `Submitted`, `Confirmed` and `Declined`. Below them is a table of rows separated by thin rules. Each row shows:

- the id;
- the tour name, linking to `/requests/{id}`;
- the requester, for dispatchers and admins only;
- the type as `Tour`, `Show` or `Show freight`;
- the trucks as `<assigned> of <requested>`, where `<assigned>` is the request's assigned count and `<requested>` its requested count;
- the first show date, or `No date`;
- the status chip;
- the submitted date.

The first page holds up to 50 rows. While more rows follow, a `Show more requests` button sits under the table. Tour managers also see a `New request` button.

**New request.** There are three steps, each at its own address and headed by its number in brackets beside its name: `( 1 ) Tour details`, `( 2 ) Stops`, `( 3 ) Review`. The current step is marked.

- **Step 1** has `Tour name`, then `Type of transportation` as three outlined radio buttons in one row (`Tour`, `Show`, `Show freight`) with a check on the chosen one, then `Number of trucks`, then `Next` and `Cancel`.
- **Step 2** has four fieldsets with the legends `Pickup`, `Delivery`, `First Show` and `Last Show`. Each fieldset has `Date (optional)`, `Address`, `City`, `State or Province`, `Postal Code` and `Country` as bare fields over a thin underline. Then come `Back`, `Next` and `Cancel`.
- **Step 3** reads back the tour details and the four stops. It has an optional `Notes` field, then `Back`, `Submit request` and `Cancel`.

**Submission confirmation.** It shows `Request submitted` as a display headline, the id and a `View request` link.

**Request page.** `/requests/{id}` has these parts:

- **Header:** the tour name as headline, then the id, type, requester, notes and status chip. Once decided, it also shows who decided, when, and the note.
- **Stops:** four numbered cards, `( 1 ) Pickup`, `( 2 ) Delivery`, `( 3 ) First Show` and `( 4 ) Last Show`. Each shows its date or `No date`, then address, city, region, postal code and country.
- **`Trucks` region:** the count line `<assigned> of <requested> trucks assigned` (the same wording when the count is one), then one row per assigned truck with the truck outline icon, its id and its depot.
- **`Activity` timeline:** entries oldest first, each with its time and text. A `submitted`, `truck_assigned` or `truck_released` entry shows its stored note, for example `Requested 3 trucks` or `TR-103 assigned`. A `confirmed` or `declined` entry shows the decision line from Business rule 10 with the stored decision note beneath it. The timeline is fetched after the page arrives from an address under the request that ends in `/activity`, and the ring spinner shows while it loads.
- **Dispatch panel:** shown only to dispatchers and admins on a `Submitted` request. It has an `Assign truck` select that lists only the trucks available when the panel was drawn, each as `<truck id> (<depot>)`, for example `TR-101 (North)`. Beside it is an `Assign` button. Each assigned truck row gets a `Release` button. Then come a `Note` field, `Confirm` and `Decline`.
  - `Assign` and `Confirm` are primary violet-blue buttons with the right arrow.
  - `Release` is an outlined secondary button.
  - `Decline` is an outlined secondary button in signal red.

Confirming or declining lands on `/requests/{id}/decided`. That page shows `Decision recorded` as a display headline, the new status and a `View request` link.

On desktop the stop cards sit in a two-column grid on the left half, with `Trucks` above `Activity` on the right half. Below 1,000 pixels wide, everything stacks: header, stops, trucks, panel, activity.

**Dispatch board.** `/dispatch` shows the board summary line above a table with the columns `ID`, `Tour`, `Requester`, `Type`, `Trucks`, `First show` and `Submitted`, oldest first. Each tour links to its request. The summary line reads `<waiting> waiting, <needed> trucks needed, <available> trucks available`:

- `<waiting>` is the number of submitted requests;
- `<needed>` is the sum of each submitted request's requested count less its assigned count;
- `<available>` is the number of available trucks.

Use `1 truck needed` and `1 truck available` when the count is one.

**Fleet.** `/fleet` shows the fleet summary line `<available> available, <assigned> assigned, <maintenance> in maintenance`, giving the count of trucks in each state. Under it is a table with `Truck`, `Depot`, `Status` (`Available`, `Assigned` or `Maintenance`) and `Request`, where the request id links to the request. Admins see `Start maintenance` on an available truck and `End maintenance` on one in maintenance.

**Members.** `/admin/users` is a table of `Name`, `Email` and `Role`. Each row has a role select with `Admin`, `Dispatcher` and `Tour manager`, and a `Save` button.

**When screen values update.** The board summary, the fleet summary line, the count line, the `Assign truck` options and the status chip are drawn from stored rows at these moments:

- when the page is rendered;
- again after every in-place write on that page, whether the write succeeded or was refused.

They do not change on their own between those moments.

**Closing band.** Every page ends with the closing band, electric violet-blue with rounded bottom corners. It holds:

- a rail of repeated `It's a Gigfreight Tour` lockups in fog, tilted a degree and a half and drifting sideways;
- two depot cards, `North depot` and `South depot`, each with the line `555-555-5555`;
- the line `Move. Get your gear moving. Safe and on point.`

**Viewports.**

- **1280 by 800 (desktop, 1,000 pixels wide and up):** the sidebar is beside the work area, tables are full width and the request page has two columns.
- **768 by 1024 (tablet, 700 to 999 pixels wide):** the sidebar becomes a top bar about 64 pixels tall with the lockup and a `Menu` button that drops the navigation down, the request page stacks into one column, and tables stay tables.
- **375 by 812 and down to 360 wide (phone, under 700 pixels):**
  - tables become stacked cards with the same fields;
  - the three transportation radio buttons stay in one row;
  - page titles step down to the phone size;
  - the closing band's depot cards stack.

No page scrolls sideways at any of these sizes.

**What the reference pages became.** The public pages of the trucking company this desk is modelled on are not rebuilt; they only told us what the product does:

- Its request form, with the type of transportation, the number of trucks and the four stops, became New request.
- Its contact details became the signed-in member, so name, email, company and phone are not asked for again.
- Its promises of careful, safety-first, well-planned runs became the shared fleet and the dispatch rules.
- Its not-found page lives on as `404. Wrong venue.`

Its culture page, policy pages, second locale, contact modal, recruiting host, map search, quote follow-up, itinerary upload, bot check and analytics are out of scope.

### Public screens and controls (DP-03, DP-09, DP-10, DP-12, DP-15, DP-22, DP-23, DP-26, DP-29, DP-30, DP-31, DP-33, DP-42)

| Role and accessible name | Visible copy and place |
|---|---|
| link `Skip to content` | first in the tab order on every page |
| navigation, with links `Requests`, `Dispatch`, `Fleet`, `Members` | sidebar; the current link carries `aria-current="page"` |
| button `Menu` | top bar below 1,000 pixels; carries `aria-expanded` |
| button `Reduce motion` | sidebar foot; carries `aria-pressed="true"` while on and `aria-pressed="false"` while off |
| button `Sign out` | sidebar foot |
| `status` region named `Desk notices` | one per signed-in page; polite; carries every notice and every refused in-place action |
| heading level 1 `Let's move your next show.`, heading `Sign in to Gigfreight` | sign-in page |
| textbox `Email`, textbox `Password`, button `Sign in` | sign-in page |
| `alert` region named `Sign-in error` | above `Sign in`, present only while an error shows |
| searchbox or textbox `Search requests`, combobox `Status` | `/requests` |
| button `Show more requests` | under the list while more rows follow |
| link `New request` | `/requests`, for tour managers |
| textbox `Tour name`; radio group `Type of transportation` with radios `Tour`, `Show`, `Show freight`; spinbutton or textbox `Number of trucks` | step 1 |
| groups `Pickup`, `Delivery`, `First Show`, `Last Show`, each with textboxes `Date (optional)`, `Address`, `City`, `State or Province`, `Postal Code`, `Country` | step 2 |
| textbox `Notes`, button `Submit request` | step 3 |
| buttons `Next`, `Back`, `Cancel` | the steps |
| dialog `Discard this request?` with buttons `Discard` and `Keep editing` | `Cancel` on a typed step |
| link `View request` | both confirmation pages |
| region `Trucks`, region `Activity` | request page |
| combobox `Assign truck`, button `Assign`, button `Release` (its name may add the truck id), textbox `Note`, buttons `Confirm` and `Decline` | dispatch panel |
| column headers `ID`, `Tour`, `Requester`, `Type`, `Trucks`, `First show`, `Submitted` | `/dispatch` |
| button `Start maintenance` or `End maintenance` | each fleet row, for admins |
| one combobox and one button `Save` | each member row |
| button `Try again` | a timeline that failed to load |
| button `Clear search` | an empty search |

Data hooks:

- Every request row and the request page root carry `data-request-id` and `data-status` (the API value).
- The count line carries `data-trucks-assigned` and `data-trucks-requested`.
- Every stop card carries `data-stop-kind`.
- Every assigned truck row and every fleet row carries `data-truck-id` and `data-truck-status`, and fleet rows also carry `data-request-id` (empty when the truck has no request).
- Every activity entry carries `data-activity-kind`.
- The board summary carries `data-waiting`, `data-trucks-needed` and `data-trucks-available`.
- The fleet summary line carries `data-available`, `data-assigned` and `data-maintenance`.

### Interactions (DP-03, DP-10, DP-12, DP-22, DP-23, DP-30, DP-42, DP-47)

**Entry and redirects.** A signed-out page request lands on `/login?next=<path>`. After sign-in the member returns to `<path>` when it is a same-site path beginning with a single `/`; otherwise they go to `/requests`. Sign-in survives a reload, and `Sign out` ends the session and lands on `/login`. A failed or throttled sign-in shows its message in `Sign-in error` and keeps the typed email.

**Requests.** Typing in `Search requests` narrows the list in place, about a third of a second after the last keystroke, and the text is reflected in `?q=`. The `Status` select narrows at once and is reflected in `?status=`. Opening such an address directly shows the same list. `Show more requests` appends the next page under the rows already shown, using the same search and status, and moves focus to the first appended row. The button disappears when the last page arrives. `Clear search` empties the field and restores the list.

**New request.**

- **The draft.** It lives in the browser until it is submitted or discarded. The first successful `Next` on step 1 creates the draft's `draft_id`, a random UUID. The draft keeps that id across steps and reloads and sends it with `Submit request`.
- **Opening a step early.** A later step opened before an earlier one is valid returns to the earliest unfinished step: step 1 while the tour details are invalid, otherwise step 2 while any stop is invalid.
- **Back.** `Back` keeps everything typed.
- **Next.** `Next` checks the step on the server and moves on only when it passes. A refused step stays put with its reasons under the fields.
- **Submit request.** `Submit request` is disabled while its post is pending. A double click, a second tab or a retry after a dropped answer sends the same `draft_id`, so it lands on the same `Request submitted` page.
- **Cancel.** `Cancel` on a typed step opens the `Discard this request?` dialog with focus on `Keep editing`. `Keep editing` or Escape closes it, returns focus to `Cancel` and keeps the input. `Discard` clears the draft and lands on `/requests`.

**Dispatch panel.**

- **A write is pending.** `Assign`, `Release`, `Confirm` and `Decline` each disable the pressed button and mark it `aria-busy="true"`.
- **A write succeeds.** After `Assign` or `Release`, the `Trucks` rows, the count line, the `Assign truck` options, the status chip and the timeline are redrawn in place from stored rows, and the notice appears in `Desk notices`. After `Confirm` or `Decline`, the page lands on the decision confirmation.
- **A write is refused (`409`, `422` or `403`).** The page stays on the request, and `Desk notices` shows the server's message from the response body. In the same update the panel is redrawn from the rows stored at that moment:
  - the `Trucks` rows and the count line show the trucks actually on the request;
  - `Assign truck` lists only trucks available now;
  - the chip shows the stored status.

  A request that was decided by someone else loses its panel and shows its decision, decider and note. A member who is no longer a dispatcher or admin loses the panel and reads the access refusal. The page never keeps showing a truck as assigned, or offers a truck, when the stored rows disagree.
- **Field reasons.** A field reason from a `422` also appears under its field: `Note` for a missing note, `Assign truck` for an unknown truck.

**Fleet and members.**

- `Start maintenance` and `End maintenance` redraw the fleet row and the fleet summary line in place, with `Truck updated` on success or the server's message on refusal.
- `Save` on a member row shows `Role saved`, or the server's message, and redraws the row from storage.
- A demoted admin's next action on `/admin/users` reads the access refusal.

**Menu.** Below 1,000 pixels, `Menu` drops the navigation down and moves focus to its first link. Escape or a second press folds it and returns focus to `Menu`.

**Keyboard.** Every control is reachable with Tab in visual order, with a visible focus ring, and `Skip to content` comes first. Enter submits the form it is in. Escape closes the open dialog or menu and returns focus to the control that opened it. Every action works the same by touch, with no gesture beyond a tap.

### Visual design (DP-36)

The north star is a stage before the lights come up. The canvas is near-black. Enormous condensed white capitals crowd the screen, with thin white rules between sections and one electric violet-blue kept for the actions that move trucks and for the band that closes every page. The desk should feel like a road crew's board, loud and sure of itself, not a corporate freight portal. Big headlines and plain tables carry the composition; there is no ornament beyond the rules, the chips and the line icons.

**Colour roles**

- **Ink.** A near-black neutral for the canvas. Photo wells and overlays use a slightly lifted near-black.
- **Paper.** A near-white neutral for text on ink.
- **Rules and underlines.** A light neutral on ink, and a pale grey on light panels.
- **Action.** An electric violet-blue, deep and vivid enough that near-white text on it holds well over 4.5:1. It turns a fifth of the way darker toward ink on hover. It is used for the primary buttons and the closing band.
- **Fog.** A warm near-white for type on the band, which also holds 4.5:1 on the blue.
- **Signal red.** A light, vivid red for field errors, the sign-in error, `Decline` and the `Declined` chip.
- **Secondary copy.** Paper softened to roughly six tenths strength, still at 4.5:1 or better. Only a disabled step is fainter.

**Meaning never rests on colour alone.** Each status chip carries its word beside a dot:

- `Submitted`: near-white on an outlined chip;
- `Confirmed`: near-black on a near-white chip;
- `Declined`: signal red on an outlined chip.

**Type.**

- **Display headlines** use a heavy condensed grotesque in capitals, such as the system's narrow sans, set so tight that stacked lines almost touch.
- **Everything else** uses one bold neo-grotesque system sans. No font files are loaded.
- **Scale.** Page titles are about ten times the body size on desktop and about five times on a phone, and the sign-in headline matches the desktop page titles. Section headings are about twice the body size, list and card text a little larger than body, and labels and captions a little smaller. Statistic numerals in the summaries are about four times the body size.

**Shape and density.**

- **Buttons** are at least 44 pixels tall, with gently rounded corners and generous side padding. Outlined secondary buttons are a little rounder, and icon-only buttons are fully round.
- **Stop cards and photo frames** have small corners except one much rounder bottom-right corner, like a road sign.
- **Chips** are fully round.
- **Spacing** follows a steady four-pixel rhythm with a sixteen-pixel page gutter. Rows are compact enough that a desktop board shows at least ten requests without scrolling.

**Iconography.** Icons are thin-line, on a small square grid, drawn in the current text colour:

- an arrow right on primary buttons;
- a slanted external arrow;
- a close cross;
- a check on the chosen transportation type;
- a plus and a minus;
- a three-line menu;
- a truck outline of a box trailer, a cab and two wheels.

Decorative icons are hidden from assistive technology, and an icon-only button carries an accessible name. The logo is the two-line wordmark `Gig` over `freight` in the display face, tipped twelve degrees inside a filled slanted box.

**Sidebar.** Full height on ink. The three-line lockup reads `Gigfreight` over `Entertainment` over `Logistic.` in large bold type, followed by the tipped logo. Below them is the navigation in large bold labels over a thin rule. The current item carries a thick paper bar under its label. The role badge reads `Admin`, `Dispatcher` or `Tour manager`.

**No binary media.** The logo and the truck outline are drawn as lines. The reference site's truck, crew and stage photographs are replaced by photo frames on a near-black well that hold the drawn truck, with two glowing near-white headlights over a violet-blue horizon band.

**Accessibility.**

- WCAG 2.2 AA: 4.5:1 for text and 3:1 for control edges and the focus ring.
- Visible labels on every field, with errors announced.
- One level-one heading per page, plus navigation and main landmarks.
- A split headline is read as one sentence.
- Stop fieldsets are named by their legends, and the transportation type is a real radio group with a legend.
- The focus ring is a paper outline set slightly off the control on ink, an ink outline on paper, and is never removed.
- Every control can be tapped comfortably, at 44 pixels or more.

### Motion and effects (DP-32, DP-33)

Motion is fast and punchy with a long, soft settle. Every motion either confirms an action or shows that something is arriving. Nothing loops without a name below.

| Moment | What it means | What you see |
|---|---|---|
| Button label roll | "this will act" | On hover or keyboard focus, the label slides up and out while a copy slides in from below. It takes about a quarter of a second and settles softly. |
| Staggered headline reveal (signature) | "you have arrived" | When a page arrives, each line of its title starts about one line height below its place and faded out, then rises and fades in. Each line starts about a tenth of a second after the one above, and the whole title is at rest within about seven tenths of a second. It plays once per page load and does not replay or reverse on scroll; the desk has no scroll-linked motion and scrolls natively. |
| Fade and rise | "new content" | Stop cards, an appended page of requests and the confirmation headline fade in from a little below over under half a second, then settle. |
| Panel redraw | "this changed" | After an in-place write, the redrawn truck rows and count line fade in over about a fifth of a second. A truck that left fades out first. |
| Footer rail drift | named brand loop | The tilted slogan rail in the closing band slides sideways at a slow, even pace, completing one full repeat every twenty to forty seconds, for as long as the page is open. |
| Ring spinner | "loading" | While the activity timeline loads, a thin ring turns at an even pace, about one turn per second, and fades in beside `Loading activity`. |
| Logo hover | playful | On hover the logo grows a touch and tips two more degrees, over about a quarter of a second. |
| Colour change | "this is live" | Hover and focus colour shifts take under a fifth of a second. |

**Reduced motion.** Motion stops when the visitor's system asks to reduce motion, or when they turn `Reduce motion` on. The switch is remembered in the browser across visits and applies from the first paint.

| Moment | Under reduced motion |
|---|---|
| Label roll | The label stays put and only the colour changes. |
| Headline reveal, fade and rise, panel redraw | The final state shows at once. |
| Footer rail | Stands still. |
| Spinner | A still ring beside `Loading activity`. |
| Logo hover | No growth or tilt. |

No motion carries information that is not also written as text.

### Feedback states (DP-03, DP-10, DP-12, DP-14, DP-15, DP-22, DP-23, DP-24, DP-26, DP-29, DP-42, DP-45, DP-47)

All in-place notices and refusals go to the `Desk notices` status region. Field reasons sit under their fields, linked to them so a screen reader reads them out.

| Action | Pending | Success | Refused | Outage |
|---|---|---|---|---|
| Sign in | `Sign in` disabled, `Desk notices` absent; button marked busy | lands on `next` or `/requests` | the API message in `Sign-in error` (`401` or `429`), email kept | the 503 message in `Sign-in error` |
| Step `Next` | `Next` disabled and busy | next step | reasons under fields, input kept | the 503 message in `Desk notices` |
| `Submit request` | disabled and busy | `Request submitted` page | reasons under fields on step 3, input kept | the 503 message, draft kept |
| Search, status filter | the list region marked busy | rows replaced | the 400 message in `Desk notices` | the 503 message |
| `Show more requests` | button disabled, reads `Loading more requests` | rows appended | the 400 message | the 503 message, rows kept |
| Timeline | ring spinner beside `Loading activity` | entries shown | `Could not load activity. Try again.` with `Try again` | the same copy with `Try again` |
| `Assign` | `Saving...` | `Truck assigned` | the server's message, panel redrawn | the 503 message, panel kept |
| `Release` | `Saving...` | `Truck released` | the server's message, panel redrawn | the 503 message |
| `Confirm`, `Decline` | `Saving...` | decision confirmation page | the server's message, panel redrawn; a missing note also shows under `Note` | the 503 message |
| `Start maintenance`, `End maintenance` | `Saving...` | `Truck updated` | the server's message, row and summary redrawn | the 503 message |
| Role `Save` | `Saving...` | `Role saved` | the server's message, row redrawn | the 503 message |

Field reasons, shown under the field with the input kept:

- `Tour name is required.`
- `Tour name must be 80 characters or fewer.`
- `Choose a type of transportation.`
- `Enter a number of trucks from 1 to 8.`
- `Address is required.`
- `City is required.`
- `State or province is required.`
- `Postal code is required.`
- `Country is required.`
- `Enter a valid date.`
- `Delivery cannot be before pickup.`
- `Last show cannot be before the first show.`
- `Notes must be 500 characters or fewer.`
- `Add a note to explain your decision.`
- `Note must be 500 characters or fewer.`
- `Choose a truck from the fleet.`
- `Choose a role.`

The step and page forms show the same strings the API returns in `fields`.

Pages and other states:

- An empty search shows `No requests match "<q>".` with `Clear search`, where `<q>` is the typed text.
- **Access refusal copy:** `You do not have access to this page.` A page or fragment refused by role shows it with status `403`: a tour manager on `/dispatch`, `/fleet` or any `/requests/{id}/decided`, or a non-admin on `/admin/users`.
- **Request not-found copy:** `This request does not exist or you cannot see it.` Every request page, confirmation page and fragment address for a request the member may not see, or that does not exist, shows this copy with status `404`. The body is identical in both cases.
- Any other unknown address shows the headline `404. Wrong venue.`, the line `This address is not on the run sheet.` and a link `Back to requests` to `/requests`, with status `404`.
- A full page that cannot reach the database shows the 503 message with status `503`.

## Backend

The backend owns every write to the tables, one table per entity, and all of the following:

- applying the schema and the seed on each serve, idempotently;
- sign-in, password hashing, sessions and the sign-in throttle;
- the role and ownership checks on every endpoint, page and fragment;
- request id assignment and draft deduplication;
- the stop and date rules;
- the fleet state, every assignment and release, the board and fleet summaries and every decision;
- the JSON API under `/api`;
- the server-rendered templates and fragments.

### API (DP-01, DP-02, DP-04, DP-06, DP-11, DP-13, DP-35, DP-39, DP-41, DP-44)

**Sign-in and sessions.**

- `POST /api/auth/login` takes `{email, password}`. The email is trimmed and matched without regard to case. Success answers `200` with `{token, user: {id, name, email, role}}`.
- The token is sent as `Authorization: Bearer <token>` and stays valid until sign-out.
- A wrong password, an unknown email, or a missing email or password answers `401` with `{"error": "invalid_credentials", "message": "Invalid email or password."}`.
- A throttled address answers `429` with `{"error": "rate_limited", "message": "Too many sign-in attempts. Try again later."}` and a `Retry-After` header, as set by Business rule 15.
- The JSON API authenticates by the bearer header only. The browser's pages and fragments authenticate by a session cookie that holds a token of the same kind.

| Endpoint | Body or query | Success | Who |
|---|---|---|---|
| `GET /api/health` | none | `200 {"status": "ok"}` | public |
| `POST /api/auth/login` | `{email, password}` | `200 {token, user}` | public |
| `POST /api/auth/logout` | none | `204`; the token is revoked | member |
| `GET /api/auth/me` | none | `200 {user}` | member |
| `GET /api/requests` | `status`, `q`, `limit`, `cursor` | `200`, a top-level array; `X-Next-Cursor` while more follow | member |
| `POST /api/requests` | `{tour_name, transport_type, trucks_requested, notes, stops, draft_id}` | `201` the stored request; `200` the stored request on replay | member |
| `GET /api/requests/{id}` | none | `200` one request | owner, dispatcher, admin |
| `GET /api/requests/{id}/activity` | none | `200`, a top-level array | owner, dispatcher, admin |
| `POST /api/requests/{id}/assignments` | `{truck_id}` | `201` the request | dispatcher, admin |
| `DELETE /api/requests/{id}/assignments/{truck_id}` | none | `204` | dispatcher, admin |
| `POST /api/requests/{id}/decision` | `{decision, note}` | `200` the decided request | dispatcher, admin |
| `GET /api/dispatch` | none | `200 {requests, summary: {waiting, trucks_needed, trucks_available}}` | dispatcher, admin |
| `GET /api/trucks` | `status` | `200`, a top-level array | dispatcher, admin |
| `PATCH /api/trucks/{id}` | `{status}` | `200` the truck | admin |
| `GET /api/users` | none | `200`, a top-level array | admin |
| `PATCH /api/users/{id}` | `{role}` | `200` the member | admin |

**Shapes.**

- **List item** (`GET /api/requests`, `GET /api/dispatch` `requests`): `id`, `tour_name`, `transport_type`, `trucks_requested`, `trucks_assigned`, `status` (`submitted`, `confirmed` or `declined`), `requester` (`{id, name}`), `first_show_date` (`YYYY-MM-DD` or null) and `created_at` (ISO 8601 UTC).
- **One request** (`GET /api/requests/{id}` and every write that returns a request) adds:
  - `notes`;
  - `stops`, an array in the order Pickup, Delivery, First Show, Last Show, each `{kind, date, address, city, region, postal_code, country}`;
  - `trucks`, an array of `{id, depot}` in id order;
  - `decided_by` (`{id, name}` or null), `decided_at` and `decision_note`.
- **Activity:** an array oldest first (ties broken by id) of `{id, kind, actor: {id, name}, note, created_at}`, where `kind` is `submitted`, `truck_assigned`, `truck_released`, `confirmed` or `declined`.
- **Truck:** `{id, depot, status, request_id}`. `depot` is `north` or `south`. `status` is `available`, `assigned` or `maintenance`. `request_id` is the open request the truck is on, or null.
- **Member:** `{id, name, email, role}`.

**Endpoint details.**

- `POST /api/requests`: `stops` is an object keyed `pickup`, `delivery`, `first_show` and `last_show`, each `{date, address, city, region, postal_code, country}`, where `date` is `YYYY-MM-DD` or null. `notes` is optional. `draft_id` is an optional UUID in its canonical hyphenated form.
- `GET /api/requests` pagination:
  - `limit` is a whole number from 1 to 100, both ends allowed, defaulting to 50.
  - When more rows follow the page, the response carries an opaque `X-Next-Cursor` header. Passing that value as `cursor` returns the next page. The last page carries no `X-Next-Cursor`.
  - `status` and `q` apply to every page, and the client sends them again with each cursor.
- `GET /api/trucks`: narrowed by `?status=` with one of the three truck states, ordered by id.
- `PATCH /api/trucks/{id}`: takes `status` of `available` or `maintenance`.
- `PATCH /api/users/{id}`: takes `role` of `admin`, `dispatcher` or `tour_manager`.
- There is no `POST /api/auth/signup`. Any address under `/api` that this table does not list answers `404 {"error": "not_found"}`.

**Error bodies.** Every error answer is JSON in one of these shapes:

| Status | Body |
|---|---|
| `400` | `{"error": "bad_request", "message": "<reason>"}`. The reasons are `Request body is not valid JSON.`, `status must be submitted, confirmed or declined.`, `status must be available, assigned or maintenance.`, `limit must be a whole number from 1 to 100.` and `cursor is not valid.` |
| `401` | `{"error": "unauthenticated"}` for a missing, unknown or revoked token; login uses its own body above |
| `403` | `{"error": "forbidden", "message": "<the access refusal copy from Feedback states>"}` |
| `404` | `{"error": "not_found"}` |
| `409` | `{"error": "conflict", "message": "<the conflict copy from Business rules>"}` |
| `413` | `{"error": "too_large", "message": "Request body is too large."}` |
| `415` | `{"error": "unsupported_media_type", "message": "Send the body as application/json."}` |
| `422` | `{"error": "validation", "fields": {"<field>": "<field reason from Feedback states>"}}` |
| `429` | login only, as above |
| `503` | `{"error": "unavailable", "message": "The desk cannot reach its records right now. Try again shortly."}` |

In `fields`, a top-level body field is keyed by its body name (`tour_name`, `transport_type`, `trucks_requested`, `notes`, `draft_id`, `truck_id`, `decision`, `note`, `status`, `role`). A stop field is keyed by a dotted path such as `stops.pickup.address`, `stops.delivery.date` or `stops.last_show.postal_code`, and `stops.<kind>` alone means a missing stop. A refused call leaves the store exactly as it was. A collection is always a top-level JSON array, except `GET /api/dispatch`, which is the only envelope.

**Error precedence, for the whole API.** The first rule that applies decides the answer:

1. `413`, `415` or a malformed-JSON `400`, as set by the Server boundary.
2. `401` for a missing or revoked session. Health and login are exempt.
3. On login only, `429` for a throttled address, before the credentials are checked.
4. `403` for an endpoint the member's stored role may not use.
5. `404` for a request, truck or member id in the path that names no record, or a request the member may not see. A truck that exists but is not on the request is not decided here; Business rule 9 decides it.
6. `400` for a malformed query value.
7. On `POST /api/requests` only: a malformed `draft_id` answers `422`, then a replayed `draft_id` answers `200` with the stored request before any other check.
8. `422` for body validation.
9. `409` for a state conflict.

### Business rules (DP-06, DP-07, DP-08, DP-13, DP-16, DP-17, DP-18, DP-19, DP-20, DP-21, DP-24, DP-25, DP-27, DP-28, DP-39, DP-40, DP-41, DP-43, DP-44, DP-45, DP-46, DP-47)

1. **Request fields.**
   - A tour name of 1 to 80 characters after trimming.
   - A `transport_type` of `tour`, `show` or `show_freight`.
   - A whole `trucks_requested` from 1 to 8, both ends allowed.
   - All four stops, each with a non-empty address, city, region, postal code and country.
   - Notes are optional, up to 500 characters with 500 allowed.

   Any other value is refused with `422`, using the field reasons from Feedback states.
2. **Stop dates.** Dates are optional calendar dates in `YYYY-MM-DD`. When both are given, Delivery is not before Pickup, and the Last Show is not before the First Show. Equal dates are allowed. Otherwise the request is refused with `422`, keyed `stops.delivery.date` or `stops.last_show.date`.
3. **New requests.** A new request is stored `submitted`, and its requester is the signed-in member. It gets one `submitted` activity entry whose note reads `Requested <n> trucks`, or `Requested 1 truck` when there is one, where `<n>` is the requested count. The body cannot set `id`, `status`, `requester_id`, `trucks_assigned`, decision fields or a role. Those keys, and any other unknown keys, are ignored.
4. **Request ids.** Ids run `LR-0001`, `LR-0002` and up, four digits, each one higher than the highest stored id. A refused post uses up no id. Any number of simultaneous valid posts each get a distinct id, the ids are consecutive with no gaps, and none answers `5xx`.
5. **Ownership.** A tour manager sees only requests they made, and this filter applies to every surface that comes from requests:
   - the list, its search, its status filter and every cursor page;
   - one request and its activity;
   - the submission confirmation;
   - every fragment address behind the list, the timeline and the request page.

   On each of those, another manager's request answers exactly like an id that does not exist: `404` with the same body. The decision confirmation is dispatcher and admin only, so a tour manager gets `403` there for any id, existing or not. Dispatchers and admins see every request.
6. **List order and filters.** The list orders by `created_at` newest first, then by id descending. `?status=` keeps one status, and an unknown value is refused with `400`. `?q=` keeps tour names containing the text, ignoring case. Paging is by position in that order, not by count: each page continues strictly after the last row of the previous page. A request created while someone is paging appears only before rows already seen, so later pages never repeat or skip a row.
7. **One count of the fleet.** A truck reads `assigned` if and only if exactly one assignment row ties it to a `submitted` or `confirmed` request, and that request is its `request_id`. A truck in maintenance has no such row. These values all come from those same stored rows after any sequence of writes:
   - each request's `trucks` and `trucks_assigned`;
   - the board's `waiting`;
   - `trucks_needed`, the sum over submitted requests of requested minus assigned, which is never negative;
   - `trucks_available`, the number of available trucks;
   - each truck's `status` and `request_id`;
   - the fleet summary line.

   The board summary line and the fleet summary line display these values.
8. **Assignment.** A dispatcher or admin assigns one truck at a time to a `submitted` request. The truck becomes `assigned` to that request, and `truck_assigned` activity reads `<truck id> assigned`, for example `TR-101 assigned`. A `truck_id` that names no truck is refused with `422` (`fields.truck_id`). The conflicts are checked in this order:
   1. a decided request answers `409` with `This request has already been decided.`;
   2. a truck that is assigned anywhere or in maintenance answers `409` with `This truck is not available.`;
   3. a request that already holds every truck it asked for answers `409` with `This request already has every truck it asked for.`
9. **Release.** Releasing a truck from a `submitted` request removes its assignment, makes it `available` and writes `truck_released` activity reading `<truck id> released`. On a decided request (`confirmed` or `declined`), a release of any existing truck answers `409` with the decided copy from rule 8, whether or not that truck is on the request; this conflict is checked before the not-on-request check. On a `submitted` request, an existing truck that is not on it answers `404`.
10. **Decisions.**
    - A decision is `confirm` or `decline` with a note of 1 to 500 characters after trimming. It sets the status, records the decider and the time, stores the trimmed note as `decision_note`, and writes a `confirmed` or `declined` activity entry whose `actor` is the decider and whose `note` is exactly that trimmed decision note.
    - The decision line `Confirmed by <decider name>` or `Declined by <decider name>` is not stored. Pages draw it from the entry's kind and its `actor.name`, or from `decided_by.name` on the request header.
    - Any other `decision` value, or a missing or overlong note, is refused with `422`.
    - Confirming with fewer trucks than requested answers `409` with `Assign every requested truck before confirming.` A confirmed request keeps its trucks `assigned` for good.
    - Declining releases every truck on the request in the same write, each with its `truck_released` activity before the `declined` entry. Afterwards:
      - the request's `trucks` is `[]` and `trucks_assigned` is 0;
      - its count line reads 0 of its requested count;
      - each truck it held reads `available` with `request_id` null and can be assigned to another request at once.

      The release and decline activity stays in the history.
    - A request is decided once. Assigning to it, releasing from it or deciding it again answers `409` with the decided copy from rule 8.
11. **Maintenance.** An admin moves an `available` truck to `maintenance` and back to `available`. Setting the status a truck already has answers `200` with it unchanged. A truck on a request answers `409` with `This truck is on a request.`, whichever status was asked for.
12. **Roles.**
    - An admin changes any member's role. Only `role` is read from the body, and an unknown role is refused with `422`.
    - Every request, page and fragment reads the member's role from the stored member at that moment. So a change applies on the member's very next request, including tokens and cookies issued before it and pages already open in their browser.
    - An admin may demote themselves while another admin exists. Their next admin-only call answers `403`.
    - Demoting the last admin, self or other, answers `409` with `At least one admin is required.`
13. **One winner.** When writes on the same truck or the same request arrive together, the outcome is always one the rules above allow if the writes had run one after the other. Each loser answers with that rule's copy.
    - Two assignments of one available truck to two requests: one `201` and one `409` with the not-available copy. The truck ends on exactly one request, with one `truck_assigned` row.
    - Two decisions on one request: one `200` and one `409` with the decided copy.
    - A decline and an assignment on one `submitted` request, in one of two orders:
      - the assignment lands first, and the decline then releases that truck too;
      - the decline lands first, and the assignment answers `409` with the decided copy.

      A truck never ends `assigned` to a declined request.
    - A release and a confirm on one fully assigned request, in one of two orders:
      - the release lands first, and the confirm answers `409` with the early-confirm copy;
      - the confirm lands first, and the release answers `409` with the decided copy.

      A request is never confirmed while short of trucks.
    - A decline and a release of one of its trucks on one `submitted` request, in one of two orders:
      - the release lands first with `204`, and the decline then releases the remaining trucks and answers `200`;
      - the decline lands first with `200`, and the release answers `409` with the decided copy.

      Either way the truck ends `available` with `request_id` null and exactly one `truck_released` row for it on that request.
    - Starting maintenance and assigning the same available truck, in one of two orders:
      - the truck ends `maintenance` with no assignment row, and the assignment answers `409` with the not-available copy;
      - the truck ends `assigned` with one assignment row and one `truck_assigned` entry, and the maintenance call answers `409` with the on-a-request copy.
    - Ending maintenance while an assignment of that truck arrives: the assignment either fails with the not-available copy or lands after the truck is available. A truck in maintenance is never assigned.
    - Two posts of one `draft_id` by one member: one `201` and one `200`, both with the same id. One request, four stops and one `submitted` activity entry are stored.
    - Two admins demoting each other: one `200` and one `409` with the last-admin copy, and exactly one admin remains.
14. **Roles come from storage.** A role is never taken from a request body, query or header. A tour manager who sends `role`, `requester_id` or `status` anywhere gains nothing and changes nothing they could not already change.
15. **Sign-in throttle.**
    - Every sign-in attempt that is not throttled is recorded in PostgreSQL with the email (trimmed and lower-cased), whether it succeeded, and the time. Unknown addresses and known addresses are recorded the same way.
    - An address's counted failures are its failures within the lockout window that are newer than its latest success.
    - While an address has five or more counted failures, every `POST /api/auth/login` for it answers `429`, even with the right password, and the throttled attempt is not recorded.
    - `Retry-After` is the whole number of seconds, rounded up and at least 1, until fewer than five counted failures remain in the window. It is never more than the window.
    - A success before the fifth failure resets the count. Other addresses are not affected. Restarting the app does not reset the count.
    - The lockout window is `SIGN_IN_LOCKOUT_SECONDS` seconds, a whole number, defaulting to `900`.
16. **Draft replay.**
    - The first successful post of a `draft_id` stores it on the request.
    - A later post with the same member and `draft_id` answers `200` with that stored request as it reads now. It writes no second request, stops or activity, whatever the rest of the body holds.
    - The same `draft_id` from a different member is unrelated and creates that member's own request.
    - A post without `draft_id` is never deduplicated.

### Services (DP-05, DP-08, DP-16, DP-38, DP-39, DP-40)

PostgreSQL is the only backing service. A second datastore, a cache, a queue, an identity provider, or a maps or tracking vendor is out of bounds. PostgreSQL is already running, and `DATABASE_URL` addresses it as a non-superuser owner of its database. The database may start empty, so apply the schema and the seed idempotently on every serve, not only at build.

**No mocks.** The database holds the truth. Each of these breaks the contract, however good the interface looks:

- an in-memory map standing in for a table;
- an in-memory throttle counter;
- a JSON file on the app container's filesystem;
- a stubbed client that answers its own calls.

Everything below lives in PostgreSQL and survives a restart of the app: a request, its stops, an assignment, a truck's state, a decision, a session, a sign-in attempt and a role change.

**Database down.** When PostgreSQL cannot be reached while the app is running:

- API calls answer `503` with the body from API;
- in-place actions show its message;
- full pages render it with status `503`;
- `GET /api/health` answers `503 {"status": "unavailable"}` until the database answers again.

All timestamps are UTC, and stop dates are calendar dates.

**Tables.**

- **`members`**: `id`, `name`, `email` (unique, lower-cased), `password_hash`, `role` (`admin`, `dispatcher` or `tour_manager`), `created_at`.
- **`sessions`**: `token_hash`, `member_id`, `created_at`, `revoked_at`.
- **`sign_in_attempts`**: `email`, `succeeded`, `created_at`.
- **`trucks`**: `id` (`TR-` plus three digits), `depot` (`north` or `south`), `status`, `updated_at`.
- **`logistics_requests`**: `id` (`LR-` plus four digits), `tour_name`, `transport_type`, `trucks_requested`, `notes`, `requester_id`, `status`, `decided_by`, `decided_at`, `decision_note`, `draft_id`, `created_at`. `draft_id` is unique per requester when present.
- **`stops`**: `id`, `request_id`, `kind` (`pickup`, `delivery`, `first_show` or `last_show`), `date`, `address`, `city`, `region`, `postal_code`, `country`. There are exactly four per request.
- **`assignments`**: `request_id`, `truck_id`, `assigned_by`, `assigned_at`. Rows exist only for trucks currently on a `submitted` or `confirmed` request, and a truck has at most one row.
- **`activity`**: `id`, `request_id`, `kind`, `actor_id`, `note`, `created_at`.

### Seed data (DP-01, DP-04, DP-05, DP-06, DP-40)

Every seeded person, tour, venue and business is invented. **Every seeded account uses the password `deku-demo-pw-2026`.** It is benchmark fixture data, not a secret. Hash it as normal; the exact literal must work at login.

**Members.**

| id | name | email | role |
|---|---|---|---|
| `1` | Ada Admin | `admin@example.com` | `admin` |
| `2` | Dex Dispatcher | `dispatcher@example.com` | `dispatcher` |
| `3` | Maya Manager | `manager@example.com` | `tour_manager` |
| `4` | Milo Manager | `milo@example.com` | `tour_manager` |

**Trucks.**

| id | depot | status |
|---|---|---|
| `TR-101` | north | available |
| `TR-102` | north | available |
| `TR-103` | north | assigned to `LR-0001` |
| `TR-104` | north | maintenance |
| `TR-105` | south | available |
| `TR-106` | south | assigned to `LR-0003` |
| `TR-107` | south | assigned to `LR-0003` |
| `TR-108` | south | available |
| `TR-109` | south | available |
| `TR-110` | north | available |

**Requests.**

| id | tour name | requester | type | trucks | status | created |
|---|---|---|---|---|---|---|
| `LR-0001` | Velvet Fuzz winter run | Maya Manager | tour | `3` | `submitted` | `2026-03-02T09:00:00Z` |
| `LR-0002` | Harbour Lights festival stage | Milo Manager | show | `2` | `submitted` | `2026-03-03T14:30:00Z` |
| `LR-0003` | Northern Echo arena run | Maya Manager | tour | `2` | `confirmed` | `2026-02-26T10:15:00Z` |
| `LR-0004` | Film set lighting rig | Milo Manager | show_freight | `1` | `declined` | `2026-02-24T08:45:00Z` |

**Stops** (city, country and date):

| id | Pickup | Delivery | First Show | Last Show |
|---|---|---|---|---|
| `LR-0001` | Quebec City, Canada, `2026-03-20` | Boston, USA, `2026-03-21` | Boston, USA, `2026-03-22` | Cleveland, USA, `2026-04-05` |
| `LR-0002` | Moncton, Canada, `2026-06-10` | Halifax, Canada, `2026-06-11` | Halifax, Canada, `2026-06-12` | Halifax, Canada, `2026-06-14` |
| `LR-0003` | Calgary, Canada, `2026-03-01` | Vancouver, Canada, `2026-03-02` | Vancouver, Canada, `2026-03-03` | Seattle, USA, `2026-03-15` |
| `LR-0004` | Atlanta, USA, no date | Savannah, USA, no date | Savannah, USA, no date | Savannah, USA, no date |

Each seeded stop also carries a street address, a region and a postal code; any non-empty values will do. The seeded requests carry no notes and no `draft_id`.

**Activity and assignments.**

- Each seeded request has `submitted` activity at its created time by its requester.
- `LR-0001` holds `TR-103`, assigned by Dex Dispatcher at `2026-03-02T11:00:00Z`.
- `LR-0003` holds `TR-106` and `TR-107`, assigned by Dex Dispatcher at `2026-02-27T15:30:00Z`. Dex confirmed it at `2026-02-27T16:00:00Z` with the note `Confirmed with two southern trucks.`
- `LR-0004` was declined by Dex Dispatcher at `2026-02-24T13:00:00Z` with the note `No trucks free on those dates.` It holds no trucks.
- Each assignment and decision has its activity entry. Each decision entry's `note` is that decision's note quoted above.

For example, with the seed data at start:

- the board lists `LR-0001` and `LR-0002` with summary `2 waiting, 4 trucks needed, 6 trucks available`;
- the fleet line reads `6 available, 3 assigned, 1 in maintenance`;
- the available trucks are `TR-101`, `TR-102`, `TR-105`, `TR-108`, `TR-109` and `TR-110`;
- the next new request is `LR-0005`.

Seeding is idempotent: restarting the app never duplicates or overwrites rows.

## Technical requirements

### Deployment (DP-35)

Node.js is available. Ship `/app/run.json` with string `install`, `build` and `serve` commands and `"_schema": "run-manifest-v1"`, for example:

```json
{"_schema": "run-manifest-v1", "install": "npm ci", "build": "npm run build", "serve": "node server.js"}
```

- Bind `0.0.0.0` on port `4173`, or on `APP_PUBLIC_PORT` when it is set. Never bind `127.0.0.1` or `localhost`. The public address comes from `APP_PUBLIC_URL`.
- The HTTP API is served on the same origin under `/api`.
- `GET /api/health` returns `200 {"status": "ok"}` without a session once the schema and seed are applied.
- Serve a production build, never a dev server. No page loads a live-reload or development client, and the browser receives a complete server-rendered document on first paint.
- Write the sign-in credentials to `/app/USER_README.md`.

### Configuration and secrets (DP-38, DP-39)

`DATABASE_URL` addresses PostgreSQL. `APP_PUBLIC_URL` and `APP_PUBLIC_PORT` give the app's address and port. `SIGN_IN_LOCKOUT_SECONDS` sets the lockout window from Business rule 15. All four are read from the environment at start. None is written into the source or sent to the browser, and no credential appears in any page, fragment or log line served to a client.

### Server boundary (DP-24, DP-34, DP-45)

- **Body limits.** JSON and form bodies are accepted up to 100,000 bytes, with 100,000 allowed; anything larger answers `413`.
- **Content type.** An API call with a body that is not `application/json` answers `415`, and malformed JSON answers `400`. The bodies are given in API.
- **Same origin.** The app is same-origin only and sends no cross-origin permission headers.
- **Session cookie.** The browser session cookie is HTTP-only and same-site strict. A page or fragment write whose `Origin` header names another origin is refused with `403`.
- **What is never served.** The server never serves source files, templates, `run.json`, `package.json`, environment files or credentials. Such paths answer the `404. Wrong venue.` page.
- **Fragments.** Every fragment address is checked exactly as its page is: sign-in, role, then ownership.
- **No outside hosts.** No third-party analytics, map, font or tracking host is contacted. Besides PostgreSQL, the app makes no network call at runtime.
- **Browser storage.** Nothing is written to the visitor's machine except the session cookie, the New request draft and the `Reduce motion` choice.
- **Database down at boot.** If PostgreSQL is unreachable at boot, the server still starts and listens, and health answers `503 {"status": "unavailable"}`. The server retries the connection every few seconds, applies the schema and seed once the database answers, and only then reports `ok`. It never exits because the database is late.

### Browser support and performance (DP-31, DP-41)

The desk works in current Chromium at 1280 by 800, 768 by 1024 and 375 by 812, and down to 360 pixels wide. With 5,000 requests stored:

- every API call answers in under one second;
- every page is usable within three seconds;
- `Show more requests` appends its page within one second.

## Working rules

- IF-01: `/app/run.json` exists with `"_schema": "run-manifest-v1"` and string `install`, `build` and `serve` commands, and nothing else is needed to start the app.
- IF-02: `/app/USER_README.md` lists every seeded account email beside the password `deku-demo-pw-2026`.
- IF-03: Shipped packages, meaning the production dependency tree reported by `npm ls --omit=dev --all --json`, include no second datastore, cache, queue or embedded database package, and no database file sits in the app tree.
- IF-04: `/app/THIRD_PARTY_NOTICES.md` names every shipped package (the production dependency tree from `npm ls --omit=dev --all --json`) with its version and licence.
- IF-05: Every shipped package (the production dependency tree from `npm ls --omit=dev --all --json`) is under MIT, ISC, 0BSD, BSD-2-Clause, BSD-3-Clause or Apache-2.0.
- IF-06: The provided service configuration is left as given, and the app reaches PostgreSQL only through `DATABASE_URL`.

## Engineering standards

- The code is idiomatic modern Node.js, and its names match this brief's domain terms: request, stop, truck, assignment, activity, decision, member, draft, fleet summary.
- Each domain rule is decided in exactly one place in the source: truck availability and every count derived from it, request validation, the request id sequence, the ownership filter, the role check, the sign-in throttle, and the status and type labels.
- Every multi-row write (assignment, release, decision, maintenance, role change, submission) runs as one database transaction that serializes against the rows it depends on.
- Every API error body comes from one shared error shape, and every page refusal renders through one template per kind.
- No abstraction has a single implementation, and there are no defensive checks for states the rules make impossible.
- There is no dead, commented-out or unreachable code.
- There is no route, screen, endpoint or feature that this brief does not list.
