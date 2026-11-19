# TRUTH — Ferrocline Works Switchyard (golden)

Every value says where it came from: `brief: <section>` (copied) or `decided: <why>` (the brief is silent).

## Journeys (ideal end-to-end flows)

1. **Keyboard incident** (brief: Journeys 1; DP-15). Start: operator `oona` on `/desk` queue `Open incidents`. Keyboard only:
   Tab into the grid, ArrowDown to a row, Enter opens the form, Tab to Impact/Urgency, pick values, Ctrl+S announces
   `Saved <number>.` and the server recomputes priority (matrix, bumped one level for a business-critical item). `Move to
   In progress` announces `<number> moved to In progress.`; the requester's `/portal/incidents/<number>` page announces `Your request
   <number> is now In progress.` without reload. `Move to Resolved` without resolution code shows `Resolution code is
   required to move to Resolved.`; with code and note it resolves (`<number> moved to Resolved.`, focus on the record
   heading) and the portal incident page shows `Incident status` `<number>: Resolved` (with `Reopen` while the deadline allows). Provider record: Postgres `records` row state `resolved`.
2. **SLA through a week** (Journeys 2; DP-16..20). Incident SLA runs on `Office hours` (Europe/Berlin 08:00-17:00 Mon-Fri,
   holidays skipped). Technician puts it on hold (`SLA paused: on hold`, countdown freezes at `Paused at H:MM:SS left`), changes
   priority (old SLA cancelled, new SLA attached with the original start), resumes (`SLA resumed`). Server clock advances:
   50/75 percent inbox items once each (`SLA at 50 percent: <name>`), breach sets the flag (`SLA breached: <name>`) and notifies
   assignee, department managers and the operator. Resolve (`Met`/`Missed`), reopen across a holiday resumes from the elapsed time.
   Agent and requester countdowns come from the same server values plus the browser's monotonic delta.
3. **Two people, one incident** (Journeys 3; DP-21..23). Both see `<name> is viewing`; saves to different fields both succeed
   (each field carries its own version); same-field second save answers 409 and opens `Field conflict` (Keep mine / Use theirs per
   field, keyboard-operable, focus returns to the first conflicting field); work notes arrive live; audit lists every before/after.
4. **The 2am page** (Journeys 4; DP-24..28). P1 incident created outside office hours: assignment rule routes round-robin past
   an out-of-office member; group policy `Desk ladder` pages the week's on-call technician; the server clock passes the 15
   minute acknowledge timer and the page climbs to the operator (`page` inbox item); late acknowledge from the phone by long
   press writes `Late acknowledge from <name> at level 1; paging had reached level 2.` and the desk shows it live.
5. **Outage to major incident** (Journeys 5; DP-29..38). Operator marks `Main storage array` Down: impact spreads (seed: 15
   items in the published order, 77 people), stops at a degraded cluster and behind a maintenance window; a proposal appears
   (`Major incident proposed for <item>.`), the operator promotes it; the relay pins the failed item's name and scrolls one
   full-height panel per affected item (first 7 panels, then `and 8 more`) while the counter rises to the total; Resolve
   together resolves every open child in one transaction; one child reopens alone.
6. **A change and its vote** (Journeys 6; DP-39..48). Draft normal change -> risk score and band -> department sign-off then board
   (weighted 60 percent, 48 h). Freeze and dependency-overlap refusals show their exact messages. Approvals from two devices, one
   as delegate; swipe right >96 px approves with a 5 s Undo; editing a locked field returns the change to Assessed and voids votes.
7. **New starter** (Journeys 7; DP-49..52). Order guide `new-starter` -> items by answers; dependent choices and form policies on
   both sides; cart checkout creates one request (`ASK-`), items (`ITM-`) and workflow tasks (`JOB-`); approver signs off
   the studio laptop; tasks done -> items Delivered, request closed, tracked live in the portal.
8. **Configuration promotion** (Journeys 8; DP-53..55, 64..68). Test workspace: flow built by keyboard, business rule and access rule
   captured in an open set; export to `config-sets/<SET number>.json` in MinIO, preview against live, per-collision choice,
   commit (`Set <n> committed: <k> items applied.`), back out restores the snapshots exactly.

## Palette roles (brief: Visual design; hex decided to meet the brief's contrast pairs)

| Role | Hex | Source |
|---|---|---|
| field (hot orange) | #FF6A13 | brief: One hot orange field; decided: hex |
| surface (lighter orange) | #FF8A3D | brief: working surfaces slightly lighter; decided: hex |
| ink (blue-black, accent) | #0A1030 | brief: deep blue-black ink; decided: hex |
| muted (dark burnt brown, secondary text) | #4A1B05 | brief: secondary text on the orange; decided: hex (5.05:1 on the field) |
| brown (tier 2 panel) | #7A2B08 | brief: Outage relay tiers; decided: hex (white on brown 9.65:1) |
| white (rest sections) | #FFFFFF | brief: White rest sections |
| danger (field error text on white) | #8A1C00 | decided: errors are words, never colour alone |

## Type, space, layout

- Display Unbounded 900 uppercase appearance for pinned names; body Onest 16 px, tabular figures; steps x1.333 (brief: Visual design).
- Pinned names about 1/16 of the screen width on desktop and tablet, about 1/7 on phones (brief: Composition).
- Hero name between 90 and 160 px tall at every window width (brief: Hero): clamp(90px, 10.6vw, 160px) desktop, clamp(90px, 15.5vw, 160px)
  tablet, 90 px phone (decided: values inside the brief's range). On the phone the name spans the full width (brief: Screens and layout)
  and breaks across lines inside it, so the page never scrolls sideways (brief: Screens and layout).
- Breakpoints: 768 and 1024 only; three panes desktop, two tablet, one phone (brief: Screens and layout).
- Every control at least 44x44; square corners; 3 px ink borders; no hairlines (brief: Visual design, Accessibility).

## Motion (brief: Motion and effects)

| Element | Trigger | Duration | Easing | Reduced motion |
|---|---|---|---|---|
| SLA progressbar fill | server sends a new percent | 420 ms | cubic-bezier(0.2, 0.9, 0.25, 1) (decided: fast start, soft settle) | none created |
| Map node details | Enter on a node | 420 ms | same | none created |
| Designer tree item | Alt+arrow or drop | 180 ms | same | none created |
| Buttons and cards | press | 180 ms | same | none |
| Vote/page card | short swipe snap-back | 180 ms | same | follows finger, no animated return |
| Affected people group | relay panel passes | 420 ms per change | same | total shown at once, announced once |

## States per async action (brief: Feedback states)

Sign in `Signing in...`; save `Saving...` then `Saved <number>.`; transition `Moving...` then `<number> moved to <state label>.`;
checkout `Submitting...` then `Request <number> submitted with <n> items.`; import `Checking import...` / `Importing...`; export
progress `<done> of <total> rows` then `Export complete: <n> rows.` or `Export failed: file storage is unreachable.`; set export/commit/back-out
`Exporting...` / `Committing...` / `Backing out...`; publish `Publishing...` then `Version <n> published.`. All announced in the one
`Announcements` status region; empty, loading and error states are one pinned line plus one button.

## Services and errors

Postgres holds records, configuration, runs, SLAs, boards, rotations, inbox, sets, imports, exports and the clock offset. MinIO holds
attachments (`attachments/<record>/<id>/<name>`), imports, exports (`exports/<id>.csv`) and set files (`config-sets/<SET>.json`);
objects count as stored only after storage accepted the PUT. With storage down: record work continues, uploads answer 202 and queue in
Postgres, imports/exports/set files answer 503 `storage_unavailable`, health answers `{"status":"unavailable"}`, banners appear,
and everything recovers by itself on the next successful probe.

## Media and licences

- Fonts: Unbounded static 800 and 900 and Onest variable woff2 (latin), SIL OFL 1.1, committed under `public/fonts` with their licence texts (brief: Fonts ship with the app).
- Service portraits and relay portraits are generated in code from the item name (licence `original`); icons are inline SVG drawn for the app.
- npm packages: react, react-dom, pg, ws (MIT) at run time; esbuild, typescript and type packages at build time (see THIRD_PARTY_NOTICES.md).

## Decisions added when the brief was revised

- Inbox events `sla_threshold_50` and `sla_threshold_75` are separate keys (brief: Inbox). An inbox rule with `enabled` false stops delivery when it lists any one of the recipient's roles; rules never add recipients (brief: Inbox). A rule given no name is stored as `<event> (<roles>) on|off`, so rules for one event and role set that differ only in the switch both persist.
- The record object's `slas` keeps cancelled SLAs; the SLA region component hides them (brief: SLA engine, Priority change).
- Fixtures (brief: Fixture details): `workspace` is accepted on every kind; a CI's `status` is stored; `handover_time` defaults to `09:00`; board `window_hours` defaults to 48 and member `weight` to 1; a workflow's `kind` defaults to `flow`, `published` becomes versions 1, 2 and onward, and a null `draft` copies the last published steps; a record's `created_by` null is recorded as `oona`; a change fixture in peer_review or board_vote has its open step opened at its last history time (earlier steps of a board vote approved, no notices sent); knowledge fixtures take `state` (one of the four published states, else 422), stored `helpful_yes`/`helpful_no`, `author` and `published_at` (kept in any state); a record fixture with an empty `state_history` opens a change review at its `created_at`; two identical inbox rules both persist, the second named with `#2`; dashboard widgets honour `date_field`. A malformed fixture member answers 422 and creates nothing.
- Seed labels: `Seat type`, `Access level`, `New starter's role` (brief: Seed data).
- Report a fault shows `combobox "Service or item"` to everyone who opens it (brief: Public screens, Report a fault). Submitting sends the item with the new incident, so every role may name it when creating an incident (brief: Access, requesters `create incidents`); `403 field_denied` stays the answer for writing it on a visible record, and a requester still cannot read it back (brief: Access). Its options are the items `GET /api/cis` returns where the person may read them (brief: API, Service map), else the six business service names the landing page publishes (brief: Public screens, Landing; decided: no endpoint is added and nothing new is readable). It is the ARIA combobox pattern and keeps any typed text that matches no option, so any item name can still be typed. The server matches the name case-insensitively (brief: Configuration item classes) and refuses an unknown one with 422 `validation`, field `configuration_item`, `Service or item "<typed text>" does not exist.` (decided: same wording as every reference field), shown under the combobox.
- Portal incident page for an incident the person cannot see answers HTTP 404 on the document itself (brief: Interactions, Portal incident page).
- New record (brief: Interactions, Creating a record): `New incident`, `New problem`, `New task` (operator, technician) and `New change` (operator) sit in a toolbar above the list, before Filter, on every viewport and also over an empty queue. They go to `/desk/records/new/<table>` with no query string; the list the person came from (queue, filter, group, page) is kept in the browser behind the form, and opening a row while the form is open opens that record; the pager, Group by, Filter and Clear filter keep working on that list while the form is open (the address stays `/desk/records/new/<table>` and the typed values stay), and after a save the same remembered list keeps answering them, so a list that was on page 2 or grouped can return to page 1 and No grouping with the saved record open (brief: Interactions, Creating a record; decided: the brief keeps the list out of the new address, so the list state lives in the page). The form leaves out the fields only a move or promotion sets (`hold_reason`, `resolution_code`, `resolution_note`, `reopen_reason`, `cancel_reason`, `close_note`, `outcome`, `freeze_override_reason`, `is_major`). Published defaults: impact 2 and urgency 2 (incident, problem), change model `normal`, `backout_tested` false. Priority shows from the shared matrix as soon as impact and urgency are set; the server recomputes it on save. Save or Ctrl+S creates the record; on success the address becomes `/desk/records/<number>` (replacing the new address, no query string), focus moves to the record heading on every viewport, whichever table the list behind showed, and `Saved <number>.` is announced and not replaced by a new-records notice for the person's own record; a refused save keeps the form and its values, shows the Problems to fix group and uses no number. New-record pages answer 404 for approver and manager and for `request_item`.
- Order guide (brief: Public screens, Order guide): groups refresh 150 ms after an answer change; `Add all to cart` ignores a second activation while one runs, and checks every group in the browser first and sends nothing while a problem remains.
- Portal My requests: every role lists the incidents where the person is caller (`caller = me()`) and the requests where the person is requester or requested-for, newest first, across all pages. Requests are read through their items (brief: API, Records): the page lists `GET /api/tables/request_item/records` with the filter `(request.requester = me()) or (request.requested_for = me())`, following the `request` reference field (brief: Field values, Expression language; decided: `requester` and `requested_for` are the paths of a request, the two people the brief names on it), then reads each request's state from `GET /api/requests/<request number>`.
- Configuration endpoints (brief: API, Rules, workflows and inbox): `PUT /api/<kind>/<name>` exists only for business rules, access rules, schedules and SLA definitions, as published; assignment rules and form policies are saved by `GET or POST` alone, and the admin form updates an existing one by posting its name again (decided: the brief publishes no PUT for them, and POST answers 200 when the name exists).
