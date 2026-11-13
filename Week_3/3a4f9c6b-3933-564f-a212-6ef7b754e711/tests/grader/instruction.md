# Tideline Works Keelson

Keelson is a promotion control plane for GitOps continuous delivery on Kubernetes. Platform teams at mid-size regulated companies use it to move declarative release bundles through environment stages, from dev to staging to several regional prod clusters, under sync windows, freeze policies, release-manager approvals and exact rollback. Build it as one web workspace and one JSON API served together. Postgres is the system of record for projects, stages, clusters, release bundles, promotions, approvals, sync windows, freeze policy versions, per-resource health and the append-only promotion history. MinIO object storage holds the rendered release bundles and the redacted evidence snapshots that auditors download. Mailpit receives every notification message. Each regulated cluster already runs its own sync agent. Keelson does not talk to Kubernetes. It decides what may be applied and when, and the agent reports back what happened. Out of scope: self-service sign-up, password reset, editing projects, clusters or stages beyond what this brief names, Git hosting, any real cluster connection, and any datastore other than the three services above.

## Problem and users

Platform teams at payments processors, insurers and health-data vendors run 20 to 200 services on 5 to 30 clusters. They already sync manifests from Git with an open-source agent, but everything around that sync is still manual. A release moves from dev to staging and on to three regional prod clusters through a chain of pull requests, chat threads and wiki pages. Change-freeze calendars live in spreadsheets, and nobody checks them against the time zone of the cluster being changed. Prod approvals arrive in chat and never expire. When auditors ask who promoted which commit, inside which window and on what evidence, engineers spend days rebuilding the answer from logs. Two engineers can promote different commits into the same stage at the same time. A freeze added last Tuesday still gets applied to requests filed before it. At 02:00, rollback brings back something close to the last good state instead of the exact state.

- **Platform engineer**, daily: defines stage pipelines, cluster time zones, sync windows, freeze policies and stage defaults once, and trusts every team to follow them.
- **Service developer**, daily: promotes a tested release bundle to the next stage and watches it reach Healthy without asking anyone what happened.
- **Release manager**, weekly: approves or rejects prod promotions with the full evidence in view before the approval lapses, and exports an audit-ready record.
- **On-call SRE**, occasionally: rolls a stage back to its exact last healthy revision, or breaks a freeze for an incident, with the reason recorded.

## Journeys

1. **Ship a bundle to staging.** The build pipeline ingests a new bundle for Payments Core. Tomás Reyes signs in, selects the dev stage, opens Promote, picks the bundle and confirms. The flaky VPN makes the browser send the request twice. The rail shows one capsule leaving the Bundles node. The cluster agent's reports move it through Applying and Health wait while the dev node's in-sync counter counts up. The dev node flashes amber and shows the new short digest as current. Tomás then promotes the same bundle from dev to staging and watches it reach Healthy.
2. **Race for prod-eu.** Tomás and Mei Lindqvist both promote a staging-verified bundle into prod-eu within the same second, each choosing a different bundle. One promotion is accepted and waits for approval. The other developer's Promote dialog says which bundle holds prod-eu, and the prod-eu node shows Out-of-sync with the winner's digest.
3. **Approve with evidence.** Hana Sato receives an approval-requested message, follows its link and reads a summary with the diff, where secret values show as redacted. Hana signs in and reads the health rows of the revision now live in prod-eu in the evidence column. Hana sees that the window will be checked when the promotion starts, and approves. The approval shows its expiry in the cluster's time, and the requester receives an approved notice.
4. **A stale tab.** Mei left the approved prod-us promotion open in a tab after its approval lapsed. Pressing Start promotion shows the expiry copy, the promotion shows as expired, and the requester has received exactly one expiry notice.
5. **Plan windows and a Black-Friday freeze.** Ines Okafor opens Windows and freezes, adds a weekday window to the Singapore cluster, and reads its next openings in Singapore time. Ines checks an instant, then schedules a freeze policy version that takes effect at a future instant. Promotions requested before that instant keep the old version. Promotions requested after it get the new one and are blocked.
6. **Break a freeze from a phone.** During an incident Kofi Brandt opens Keelson on a phone. The stage graph stacks vertically. Kofi taps the blocked prod-apac node, presses Break freeze, types the incident reason and confirms. The promotion starts applying, and every release manager of the project receives one freeze-broken message.
7. **Roll prod-us back at night.** A prod-us promotion ends Degraded. Kofi selects prod-us, presses Roll back, confirms the target version and short digest, and watches the rollback reach Healthy. It carries exactly the digest, parameters and replica counts of the last healthy prod-us promotion, even though Ines changed the prod-us defaults that afternoon.
8. **Audit and recovery.** While object storage and mail are unreachable, the ledger strip counts queued evidence uploads and queued notices. When both services return, the counts fall to zero without anyone restarting Keelson. Hana downloads the evidence of a finished prod promotion and finds the digest, requester, policy version, window decision, approval and health timeline.

## Mandatory requirements

This is the complete list of mandatory requirements; every check traces to one of these lines and the detailed sections below.

- **DP-01 — Run manifest and health.** Ship `/app/run.json` and serve the workspace and API on one port with a health endpoint, as specified in Deployment.
- **DP-02 — Seeded sign-in.** Seeded people sign in with email and password and receive a session that every other API call and screen requires, as specified in API.
- **DP-03 — Project isolation.** A person can list, promote and read evidence only in projects they belong to, and other projects' stages, bundles and promotions answer as unknown.
- **DP-04 — Role checks on the server.** Every action in the authority table in Business rules is refused by the server for a project role that may not perform it, whatever the screen shows.
- **DP-05 — One error shape and precedence.** Every error response except the health endpoint's starting answer uses the single error body and the single precedence order stated in API.
- **DP-06 — Same-origin boundary.** The server accepts state-changing browser calls only from its own origin, enforces the content type and body limits, and never serves source, configuration or credentials, as specified in Server boundary.
- **DP-07 — Credentials from the environment.** Every service URL and credential is read from the environment variables in Configuration and secrets and never reaches the browser or the source tree.
- **DP-08 — Boot with dependencies down.** The server starts and reports healthy while object storage or mail is unreachable, and every feature that does not need the missing service keeps working, as qualified in Services.
- **DP-09 — Status by glyph and label.** Every stage and resource status shows a glyph and a visible word as well as a colour, at the contrast levels in Visual design.
- **DP-10 — Three viewports.** The workspace fits 375x812, 768x1024 and 1280x800 without horizontal scrolling, and the stage graph stacks vertically when the viewport is narrower than 768 pixels.
- **DP-11 — Keyboard and touch operation.** Every public control works by keyboard with a visible focus ring and the Tab, Enter and Escape behaviour in Interactions, and by touch at the target size in Visual design.
- **DP-12 — Nocturnal instrument look.** The workspace uses the graphite ground, amber accent, typefaces and tabular numerals described in Visual design.
- **DP-13 — Rail, graph and evidence composition.** The workspace is composed as a left rail, a stage graph with a ledger strip pinned beneath it, and a right evidence column, as described in Screens and layout.
- **DP-14 — Reduced-motion rail.** With reduced motion requested, the rail shows five labelled segments that fill at once, counters change without counting, and the progress live region announces every phase.
- **DP-15 — Motion only on state change.** Nothing on screen moves unless server state changed or the user acted, and no decorative loop runs while the workspace is idle.
- **DP-16 — Announced feedback.** Every async action shows its pending, success, error and outage copy from Feedback states in the named live regions.
- **DP-17 — Server-driven rail.** The rail's phase, progress and counter come from server-reported promotion state, never from a client timer or a client-side estimate.
- **DP-18 — Ingest release bundles.** A bundle ingest stores the rendered manifests in object storage under the SHA-256 digest of the stored bytes before it answers, and returns that digest.
- **DP-19 — Bundle validation.** Malformed manifests, duplicate resources, duplicate versions and oversized bodies are rejected with the statuses in API and leave no record and no object behind.
- **DP-20 — Bundle ready to promote.** A bundle ingested by the build pipeline appears in the dev stage's Promote dialog within the refresh delay in Interactions, with its version and short digest.
- **DP-21 — Request a promotion.** A promotion request records the bundle, the stage defaults merged with request overrides, the requester, the request instant and the freeze policy version in force, and non-prod requests run the window check at once.
- **DP-22 — Promote only verified bundles.** A bundle may enter a stage only after it has reached Healthy in that stage's upstream stage.
- **DP-23 — Retries return the original result.** A repeated promote, approve, reject, start, re-check, freeze-break or rollback call with the same request key and body returns the original response, and the same key with a different body is refused.
- **DP-24 — Promote to staging from the graph.** A service developer promotes a dev-healthy bundle to staging from the evidence column, and a double press on the confirm button still creates exactly one promotion.
- **DP-25 — Cluster agent reports.** The cluster sync agent's per-resource reports move a running promotion from applying to health wait to Healthy or Degraded by the rules in Business rules.
- **DP-26 — In-sync counter equals health rows.** Every "in sync n/N" value on screen and in the API equals the Synced-and-Healthy rows and the total rows for the stage's current revision.
- **DP-27 — Rail phase and progress attributes.** Each rail edge exposes data-phase and data-progress equal to the server's phase and progress for that edge within the refresh delay in Interactions.
- **DP-28 — Promotion rail motion.** A capsule with the short digest advances along the edge whenever the server-reported progress rises and never moves backward, the counter counts up to each new value, the target border flashes once on Healthy, and on failure the drawn segment turns red from the capsule back to the source.
- **DP-29 — Watch a promotion reach Healthy.** A service developer watches a promotion move from Queued to Healthy on the rail as agent reports arrive, without reloading the page.
- **DP-30 — One active promotion per stage.** Of simultaneous promotion requests to one stage exactly one wins, and every other request is refused with the name of the bundle that holds the stage.
- **DP-31 — Told who holds the stage.** A developer who loses the race for prod-eu sees which bundle holds the stage, and the graph shows prod-eu as Out-of-sync with the winner's digest.
- **DP-32 — Approval requested mail.** A prod promotion request sends one approval-requested message to every release manager of the project, carrying a link that works while the request is pending, until it is decided or expires.
- **DP-33 — Approve or reject a prod promotion.** Only a release manager may approve or reject a promotion that awaits approval, and approval is refused until the request's evidence snapshot is stored.
- **DP-34 — Approval is all or nothing.** An approval records the decision, stores a new evidence snapshot and records the requester's notice together, and when storage fails none of them exists.
- **DP-35 — Approve with the evidence in view.** A release manager follows the approval link, signs in, reviews the redacted diff and the stage's live health rows in the evidence column and approves, and the requester receives the approved notice.
- **DP-36 — Server-side approval lifetime.** A prod promotion may start only before its approval's expiry instant, which is excluded, and a start at or after it is refused and marks the promotion expired.
- **DP-37 — One expiry notice.** A request or approval that lapses is marked expired by the server within the sweep delay in Business rules and sends exactly one expiry notice to the requester.
- **DP-38 — A stale tab cannot start.** A service developer who presses Start promotion after the approval lapsed sees the expiry copy and the promotion shown as expired.
- **DP-39 — Sync windows in cluster time.** Sync windows are weekly local-time ranges judged in the cluster's time zone, never the browser's or the server's.
- **DP-40 — Windows keep their wall-clock time.** Windows open at the same local time in the weeks either side of a clock change and follow the gap and overlap rule in Business rules, as listed by the openings endpoint.
- **DP-41 — Start only inside an open window.** A promotion enters applying only when the window check passes at that instant, and one that entered applying still finishes after its window closes.
- **DP-42 — Plan windows across time zones.** A platform engineer adds a window to a cluster, sees its next openings in cluster time and checks an instant, and a developer in another zone is then blocked or allowed by that cluster's clock.
- **DP-43 — Freeze policy versions.** Each promotion is judged by the freeze policy version in force at its request instant, so a new version affects only promotions requested from its effective instant on.
- **DP-44 — No lost freeze edits.** A new freeze policy version names the version it was based on, and one based on a version that is no longer the latest is refused.
- **DP-45 — Schedule a Black-Friday freeze.** A platform engineer schedules a freeze version for a future instant, and promotions requested either side of that instant show different policy versions and outcomes.
- **DP-46 — Break a freeze for an incident.** Only an on-call SRE with a recorded reason may move a window-blocked promotion on, and every release manager of the project receives one freeze-broken message.
- **DP-47 — Break a freeze from a phone.** An on-call SRE on a phone opens a blocked prod promotion from the vertical stage stack, breaks the freeze with a reason by touch, and sees it start applying.
- **DP-48 — Exact rollback.** A rollback starts a new promotion with the exact bundle digest and override set of the stage's last healthy promotion, read back from object storage, whatever the stage defaults are now.
- **DP-49 — Roll prod-us back at night.** An on-call SRE rolls a Degraded prod-us back to its last healthy revision from the evidence column and watches it reach Healthy.
- **DP-50 — Evidence snapshots.** Every promotion writes numbered evidence snapshots to object storage at the events listed in Services, and the download returns the latest stored snapshot byte for byte.
- **DP-51 — Secrets redacted in every copy.** Secret and sealed-value fields never appear in plain text in diffs, the evidence column, evidence snapshots, approval-link pages or any message.
- **DP-52 — Append-only promotion history.** Every promotion state change appends one history entry with from-state, to-state, instant and actor, and no entry is ever changed or removed.
- **DP-53 — Export an audit record.** A release manager downloads a finished prod promotion's evidence and finds who promoted which digest, under which policy version and window decision, with which approval.
- **DP-54 — Queued deliveries drain.** Evidence snapshots and messages that could not be delivered wait in the database and are delivered once each after their service returns, within the delay in Services and without a restart.
- **DP-55 — Delivery queue on screen.** The ledger strip shows storage and mail reachability and the queued upload and notice counts from the status endpoint.
- **DP-56 — Recover after storage and mail outages.** An on-call SRE sees queued uploads and notices counted while storage and mail are down and watches both counts fall to zero once they return.

## Frontend

### Screens and layout (DP-10, DP-13, DP-20, DP-31, DP-47)

All times on screen that belong to a stage, cluster, window, approval or promotion use **cluster time format**: `YYYY-MM-DD HH:mm` followed by a space and the cluster's IANA zone name, for example `2026-10-27 09:00 Europe/London`. Freeze policy instants use the same format with the zone `UTC`. The browser's own time zone is never used to show or judge any of these times.

**Sign-in screen** (`/sign-in`). A single centred panel holds the product name, the heading, the email and password fields and the Sign in button. Signed-out visitors to any other client route land here and return to that route after signing in.

**Workspace** (`/projects/<project slug>`). It has three parts:
- **Left rail.** The projects the person belongs to, with the selected project's stages listed beneath it in pipeline order, a link to Windows and freezes, the person's name and role, and Sign out.
- **Main field: the stage graph.** A Bundles intake node comes first, then one square node per stage, joined by amber-stroked edges. For the seed this reads Bundles → dev → staging, then staging fans out to prod-eu, prod-us and prod-apac. Each stage node shows:
  - the stage name
  - the cluster name and zone
  - a status glyph and label
  - the current tag, `current <short digest>`
  - the mono counter `in sync <n>/<N>`
- **Ledger strip.** Pinned directly beneath the graph. One aligned row per stage shows stage, version, short digest, when it last reached Healthy (cluster time format) and in-sync count, all in tabular mono. The delivery-queue cells sit at the end: `Evidence uploads queued: <n>`, `Notices queued: <n>` and the reachability notices from Feedback states.
- **Evidence column.** Selecting a stage node opens a right-hand column for that stage. It shows the stage's active promotion if there is one, otherwise its current revision. Its sections, in order:
  - a header with the version, short digest, state label and requester
  - the actions the person's role allows
  - **Diff**: one row per change, with secret values shown as `[redacted]`
  - **Approvals**: decision, by whom, when, and the expiry in cluster time format
  - **Window decision**: open or closed, the reason, the local time at the check and the policy version. Before the promotion's first check, it shows `Not checked yet. The window is checked when the promotion starts.` with the pinned policy version.
  - **Health**: a table of per-resource rows with a glyph and a word for each sync and health value. Once the promotion has entered applying, these are the promotion's own rows. Before that, they are the rows of the stage's current revision, captioned `Live revision <short digest>` with that revision's short digest. When the stage has no current revision, the section shows `Nothing deployed yet.`
  - **History**: one row per state change, in order

The promotion history list of the stage sits under the evidence column sections. It shows the newest 50 promotions, each opening in the column.

**Windows and freezes** (`/projects/<project slug>/windows`). Readable by every member, editable only by platform engineers. It has one panel per cluster with:
- the zone and `Cluster time <cluster time format>`
- a table of sync windows (days, opens, closes, label)
- the next five openings in cluster time format
- an Add window button

Below the cluster panels are the Check an instant form and the freeze policy panel. The freeze policy panel lists every version (number, effective-from instant in UTC, author, freezes) and marks the version in force now.

**Approval link page** (`/approvals/<token>`). It works without signing in. It shows the project, stage, version, short digest, requester, the redacted diff and the request expiry in cluster time format, plus an Open in Keelson link to the promotion in the workspace. Once the link has lapsed, the page shows only the expired heading.

**Viewports.** No viewport scrolls horizontally, and no text overlaps another element.

| Viewport | Layout |
|---|---|
| 1280x800 | The left rail, the horizontal graph with the ledger strip under it, and the evidence column (about a third of the width) are all visible together. |
| 768x1024 | The left rail collapses behind a Menu button at the top. The graph stays horizontal and scales to the full width. The evidence column opens as a panel over the right side of the graph. The ledger strip stays under the graph. |
| 375x812 (any width under 768 pixels) | The graph turns 90 degrees into a vertical stack. Bundles is at the top and each stage sits below its upstream stage, with fan-out stages stacked in seed order and edges running vertically. The ledger strip becomes one stacked card per stage. The evidence column opens as a full-screen sheet with a Close button at the top. Dialogs fill the screen width. |

### Public screens and controls (DP-02, DP-09, DP-11, DP-14, DP-16, DP-20, DP-24, DP-27, DP-28, DP-31, DP-35, DP-38, DP-42, DP-45, DP-47, DP-49, DP-53, DP-55)

Only the controls and regions in this table are public. Everything else is free. `<stage>` is a stage name, `<version>` a bundle version and `<cluster>` a cluster name.

| Role and accessible name | Where | Visible copy and notes |
|---|---|---|
| heading "Sign in to Keelson" | Sign-in | heading level 1 |
| textbox "Email", textbox "Password", button "Sign in" | Sign-in | |
| navigation "Projects" | Left rail | one link per project, named by the project name |
| navigation "Stages" | Left rail | one link per stage, named by the stage name; activating one selects that node |
| link "Windows and freezes", button "Sign out", button "Menu" | Left rail / narrow header | "Menu" exists only below 1280 pixels wide |
| region "Stage graph" | Main field | contains the nodes and edges |
| button "Stage <stage>" | Graph node | carries `data-status` equal to the API stage status; shows the label and glyph, `current <short digest>` and `in sync <n>/<N>` |
| img "Promotion rail <from> to <to>" | Graph edge | `<from>` is `Bundles` for the edge into dev; carries `data-phase` and `data-progress` exactly as Business rules define |
| img "Bundle <short digest>" | Capsule on an edge | present only while that edge's phase is queued, window_check, applying, health_wait or degraded |
| region "Ledger" | Under the graph | rows per stage and the delivery-queue cells |
| complementary "Evidence for <stage>" | Evidence column | headings "Diff", "Approvals", "Window decision", "Health", "History" |
| table "Resource health" | Evidence column | columns Resource, Sync, Health |
| button "Promote", "Approve", "Reject", "Start promotion", "Re-check window", "Break freeze", "Roll back", "Download evidence", "Close" | Evidence column | each shown only to roles allowed by the authority table and only in states where it applies |
| dialog "Promote to <stage>" | Modal | combobox "Release bundle" (options `<version> · <short digest>`, only bundles verified in the upstream stage, or every bundle for dev); read-only summary "Overrides frozen into this promotion"; buttons "Request promotion" and "Cancel" |
| dialog "Approve <version> to <stage>" | Modal | textbox "Comment" (optional); buttons "Approve promotion" and "Cancel" |
| dialog "Reject <version> to <stage>" | Modal | textbox "Reason"; buttons "Reject promotion" and "Cancel" |
| dialog "Break freeze on <stage>" | Modal | textbox "Incident reason"; buttons "Break freeze and start" and "Cancel" |
| dialog "Roll back <stage>" | Modal | text `Restores <version> (<short digest>)`; textbox "Incident reason"; buttons "Roll back to <version>" and "Cancel" |
| heading "Windows and freezes" | Windows screen | heading level 1 |
| region "Cluster <cluster>" | Windows screen | contains table "Sync windows <cluster>", list "Next openings <cluster>", button "Add window", and button "Delete window <label>" per window |
| dialog "Add window to <cluster>" | Modal | checkboxes "Mon" to "Sun", textboxes "Opens", "Closes", "Label"; buttons "Save window" and "Cancel" |
| form "Check an instant" | Windows screen | combobox "Stage", textbox "Cluster local time" (`YYYY-MM-DD HH:mm` in the chosen stage's cluster zone), button "Check", status "Window decision" |
| region "Freeze policy" | Windows screen | list of versions; button "New freeze version" |
| dialog "New freeze policy version" | Modal | textbox "Effective from (UTC)"; per freeze row: textboxes "Freeze name", "Starts (UTC)", "Ends (UTC)" and one checkbox per stage name; buttons "Add freeze", "Schedule version", "Cancel" |
| heading "Approval requested", link "Open in Keelson" | Approval link page | |
| heading "This approval link has expired." | Approval link page | |
| status "Activity" | Every screen | polite live region for pending and success copy |
| alert "Problem" | Every screen | assertive region for error copy |
| status "Promotion progress" | Workspace | polite live region for rail phase announcements |
| status "Delivery queue" | Ledger strip | polite live region for reachability notices |

### Interactions (DP-11, DP-20, DP-24, DP-27, DP-29, DP-31, DP-38, DP-42, DP-47)

- **Refresh delay.** While the workspace is open, it reads the project graph and the status endpoint every 2 seconds. Any server change shows on screen within 3 seconds, including stage status, edge phase and progress, counters, delivery-queue counts and bundle lists. Opening a dialog does not pause this. The Windows screen's cluster times advance every 30 seconds.
- **Selecting a stage.** Clicking or tapping a stage node, or pressing Enter or Space on it, opens the evidence column for that stage. Focus moves to the column's heading. The node shows a selected state that does not rely on colour alone (a thicker amber outline plus a small "Selected" tag).
- **Keyboard order.** Tab moves through the left rail, then the stage nodes in pipeline order (dev, staging, prod-eu, prod-us, prod-apac), then the ledger strip, then the evidence column's actions in reading order. Arrow keys also move between stage nodes along the pipeline.
- **Escape and focus.** Escape closes the top-most dialog and returns focus to the button that opened it. With no dialog open, Escape closes the evidence column and returns focus to its stage node. The Close button does the same. Dialogs keep focus inside themselves while open.
- **Confirm buttons.** When a dialog's confirm button is pressed, the browser creates one request key for that submission. It reuses the same key and body if the press repeats or the network retries, until a final response arrives. The confirm button is disabled while its request is pending. The dialog closes on success, and stays open showing the error on failure.
- **Field errors.** Field errors appear under their field, are linked to it so assistive technology reads them with the field, and do not clear what the person typed.
- **Touch.** Tapping replaces every hover. No information appears only on hover. The evidence sheet on narrow screens scrolls vertically inside itself. Scrolling the vertical graph never triggers an action, and only a tap selects a node.
- **Download evidence** saves the latest stored snapshot under the file name the API gives.
- **Check an instant** converts the entered cluster-local time to an instant in that cluster's zone, using the gap and overlap rule in Business rules. It then asks the window-decision endpoint and writes the result into status "Window decision".
- **Losing the stage race.** When a promotion request is refused because the stage is held, the Promote dialog stays open. It shows the holder copy from Feedback states, and the graph shows the holder on that stage at the next refresh.

### Visual design (DP-09, DP-11, DP-12, DP-13)

- **Ground and surfaces.** The ground is a deep graphite, nearly black but never pure black, with no gradients anywhere. Panels, nodes and dialogs sit on a slightly lifted slate-graphite surface with a hairline border one step lighter.
- **Ink and accent.** Text is a cool off-white. A warm amber is the accent. It strokes the graph edges, fills primary buttons, draws the focus ring and marks the selected node.
- **Alert.** A coral red is reserved for failure: Degraded status, failed rail segments, the Problem region and destructive confirms.
- **Status colours.** Healthy uses a muted mint green, Progressing uses the amber accent, Out-of-sync uses a pale steel blue, Degraded uses the coral red, and Not deployed uses a dim grey.
- **Status glyphs and labels.** Every status always has its own outline glyph and its word, so the status reads in greyscale. Use these glyph shapes from one consistent outline icon set:

  | Status | Glyph | Word |
  |---|---|---|
  | Healthy | circle with a check | `Healthy` |
  | Progressing | two opposing arrows, drawn still | `Progressing` |
  | Degraded | warning triangle | `Degraded` |
  | Out-of-sync | two offset branches | `Out-of-sync` |
  | Not deployed | circle with a slash | `Not deployed` |

  Resource rows use the same rule for Synced, OutOfSync, Healthy, Progressing, Degraded and Missing.
- **Contrast** meets WCAG 2.2 AA on both the ground and the surface. Body text and labels are at least 4.5 to 1. Large headings, glyphs, edges, borders that convey state, and the focus ring are at least 3 to 1.
- **Type.** Space Grotesk, a geometric grotesque with squared terminals, sets headings and stage names. IBM Plex Sans sets body text and controls. IBM Plex Mono with tabular figures sets every number: digests, counts, versions, times and queue counts, so columns of digits line up. Each heading step is about one fifth larger than the step below it. The page title is about twice the body size. All fonts are served by the app itself.
- **Density and rhythm.** Density is compact. Rows are tight and spacing and line heights move in steps of four pixels, so the ledger strip's numerals sit on a shared baseline grid.
- **Composition.** The view reads like an instrument panel. A narrow left rail sits beside a wide graph field of square nodes joined by thin amber lines. Under it, a mono ledger reads like a log printout. On the right, a dense evidence column holds the paperwork.
- **Touch targets.** Every button, node, link, checkbox and textbox is at least 44 by 44 pixels on every viewport.

### Motion and effects (DP-14, DP-15, DP-17, DP-28)

Motion happens only when server state changes or the person acts. Nothing pulses, spins, shimmers or breathes while idle. That includes the Progressing glyph and any loading indicator, which use text instead of spinning. There are no decorative loops of any kind.

**Timing and feel.** Every movement starts quickly and settles with a long, soft stop. There are three lengths:
- **Short**, about a sixth of a second: press and hover feedback, and dialogs fading in while rising slightly.
- **Medium**, a little under half a second: edge drawing, counter counting, the evidence column sliding in from the right (or the sheet rising from the bottom on narrow screens), and the healthy flash.
- **Long**, just under one second: the failure colour running back to the source.

**Promotion rail.** This is the signature interaction. It runs on each edge into the stage that holds a promotion:
1. When a promotion is accepted, a small rounded capsule labelled with the bundle's 7-character short digest leaves the source node. The source is the Bundles node for dev and the upstream stage otherwise.
2. The edge's drawn stroke grows from the source toward the target in five fixed segments that match the server phases. Queued fills the first tenth, Window check the next tenth, Applying runs to six tenths, Health wait runs to just under the full length, and Healthy completes it.
3. The capsule sits at the tip of the drawn stroke. It moves whenever a refresh brings a higher server progress value, travelling there over the medium length. This covers both a phase change and a rise in the in-sync count within Applying or Health wait. A refresh with the same or a lower value never moves it, and it never moves backward, even on failure.
4. While the phase is Applying or Health wait, the target node's `in sync <n>/<N>` counter counts up digit by digit to each new server value over the medium length.
5. On Healthy, the target node's border flashes amber once over the medium length. The capsule merges into the target's current tag, which now shows the new short digest.
6. On Degraded, the capsule stays where it is, at the last progress value before failure. Coral red runs back along the drawn stroke from the capsule to the source over the long length, until the whole drawn part is red. The stroke's length does not change. The Degraded glyph and word appear on the target node.

Once the motion settles, the drawn part of each edge equals the edge's `data-progress` fraction of its length, within two hundredths. Rejected and expired promotions remove the capsule and return the edge to rest with no further motion.

**Reduced motion.** When the operating system asks for reduced motion:
- The capsule does not travel. Each active edge shows five labelled segments, "Queued", "Window check", "Applying", "Health wait" and "Healthy". Each segment fills at once when its phase is reached and carries `data-reached="true"` from then on. Degraded fills the reached segments in coral red at once.
- Counters swap to the new value without counting.
- The healthy flash becomes a steady amber border for two seconds.
- The evidence column, sheet and dialogs appear without sliding or rising.
- Press feedback changes colour only.

In every motion mode, status "Promotion progress" announces each phase change and the final result. Feedback states gives the copy.

### Feedback states (DP-14, DP-16, DP-24, DP-31, DP-35, DP-38, DP-42, DP-45, DP-47, DP-49, DP-53, DP-55, DP-56)

These placeholders are used in the copy below:
- `<version>` is the bundle version and `<stage>` the stage name.
- `<short digest>` is the first 7 hexadecimal characters of the digest after `sha256:`.
- `<cluster>` and `<time zone>` are the stage's cluster name and IANA zone.
- `<freeze name>` is the blocking freeze's name.
- `<expiry>` is the relevant expiry instant in cluster time format.
- `<holder version>` and `<holder short digest>` come from the stage-busy error's holder.
- `<upstream>` is the upstream stage name.
- `<label>` is a window label.
- `<local opens>` is the first opening in cluster time format.
- `<n>` and `<current>` are freeze policy version numbers.
- `<effective>` is an instant in cluster time format with zone `UTC`.

Pending and success copy goes to status "Activity". Error copy goes to alert "Problem". A field error goes under its field, using the field message from API. The `<block reason>` is `outside the sync window for <cluster> (<time zone>)` or `freeze "<freeze name>" is in force`.

| Action | Pending | Success | Errors and outage |
|---|---|---|---|
| Sign in | `Signing in…` | (goes to the workspace) | invalid credentials: `Email or password is wrong.` |
| Request promotion | `Requesting promotion…` | non-prod applying: `Promotion of <version> to <stage> started.`; prod: `Promotion of <version> to <stage> is waiting for approval.`; blocked: `Promotion of <version> to <stage> is blocked: <block reason>.` | stage busy: `<stage> is held by <holder version> (<holder short digest>). Try again when it finishes.`; not verified: `<version> has not reached Healthy in <upstream> yet.` |
| Approve | `Recording approval…` | `Approved until <expiry>. The requester will be notified.` | evidence pending: `The evidence bundle is still being stored. You can approve once it is saved.`; storage down: `Evidence storage is unreachable, so the approval was not recorded. Try again when it returns.`; request lapsed: `This approval request expired at <expiry>.` |
| Reject | `Recording rejection…` | `Rejected. The requester will be notified.` | request lapsed: same as Approve |
| Start promotion | `Starting…` | applying: `Started. Applying <version> to <stage>.`; blocked: the blocked copy from Request promotion | approval lapsed: `This approval expired at <expiry>. Request a new promotion.` |
| Re-check window | `Checking the window…` | open: the started copy; still blocked: the blocked copy | approval lapsed: as Start promotion |
| Break freeze | `Breaking the freeze…` | `Freeze broken. Applying <version> to <stage>. Release managers will be notified.` | approval lapsed: as Start promotion |
| Roll back | `Starting rollback…` | applying: `Rolling <stage> back to <version> (<short digest>).`; blocked: the blocked copy | no healthy revision: `<stage> has no earlier healthy revision to roll back to.`; stage busy: as Request promotion; storage down: `Evidence storage is unreachable, so the rollback could not read the last healthy bundle. Nothing was changed.` |
| Download evidence | `Preparing evidence…` | `Evidence downloaded.` | none stored yet: `No evidence snapshot is stored yet. It will be saved when storage returns.`; storage down: `Evidence storage is unreachable. Try the download again when it returns.` |
| Save window | `Saving window…` | `Window added. Next opening <local opens>.` (or `Window added. No openings scheduled.` when none are listed) | field errors |
| Delete window | `Removing window…` | `Window removed.` | |
| Check an instant | `Checking…` | written to status "Window decision": `Open: <label>`, or `Closed: outside every sync window`, or `Closed: freeze "<freeze name>" (policy version <n>)` | field errors |
| Schedule version | `Scheduling…` | `Freeze policy version <n> takes effect at <effective>.` | stale base: `Someone scheduled version <current> first. Reload to see it, then try again.`; field errors |

These apply to every action:
- A refused role shows `Your role in this project cannot do that.`
- A network failure or any other server error shows `Keelson could not reach the server. Your last action was not confirmed.`
- An ended session returns the person to the sign-in screen, which shows `Your session ended. Sign in again.`

**Promotion progress announcements.** Status "Promotion progress" announces `<version> to <stage>: <phase label>` once each time an edge's phase changes. The phase labels are `Queued`, `Blocked by window`, `Applying`, `Health wait`, `Healthy`, `Degraded` and `Stopped`. The final announcement for a finished promotion is the Healthy or Degraded line.

**Delivery queue.** Status "Delivery queue" shows these notices while the status endpoint reports a service down, and clears each one within the refresh delay once it is up again:
- storage down: `Evidence storage is unreachable. Snapshots are queued and will be stored when it returns.`
- mail down: `Mail is unreachable. Notices are queued and will be sent when it returns.`

## Backend

### API (DP-02, DP-03, DP-05, DP-18, DP-19, DP-21, DP-23, DP-25, DP-30, DP-32, DP-33, DP-36, DP-39, DP-40, DP-43, DP-44, DP-46, DP-48, DP-50, DP-55)

**General conventions**
- **Bodies and instants.** Requests and responses use `application/json; charset=utf-8`, except the evidence download. Instants in responses are UTC in ISO 8601 with milliseconds and `Z`, for example `2026-10-27T09:00:00.000Z`. Instants in requests may carry any offset.
- **Project and stage addressing.** Projects are addressed by slug and stages by name within their project.
- **Request key.** Every call marked *keyed* must carry the header `Request-Key`: 1 to 200 visible ASCII characters.

**Errors.** Every error answers with one body shape, `{"error":"<code>","message":"<sentence>"}`. The one exception is `GET /api/health`: its bodies are stated in Deployment and Server boundary, and the precedence order below does not apply to it. Some codes add fields:
- `validation` adds `"fields":{"<field>":"<message>"}`.
- `stage_busy` adds `"holder":{"promotion_id":"<id>","bundle_version":"<version>","bundle_digest":"sha256:<hex>","state":"<state>"}`.
- `invalid_transition` adds `"state":"<current state>"`.
- `stale_version` adds `"current_version":<n>`.

| Code | Status |
|---|---|
| `payload_too_large` | 413 |
| `unsupported_media_type` | 415 |
| `cross_origin` | 403 |
| `unauthenticated` | 401 |
| `invalid_credentials` | 401 |
| `not_found` | 404 |
| `forbidden` | 403 |
| `request_key_required` | 400 (missing or malformed key) |
| `request_key_reused` | 409 |
| `validation` | 422 |
| `invalid_transition`, `stage_busy`, `not_verified_upstream`, `version_exists`, `evidence_pending`, `approval_expired`, `no_healthy_revision`, `phase_regression`, `promotion_not_running` | 409 |
| `link_expired` | 410 |
| `stale_version` | 412 |
| `storage_unavailable` | 503 |

**Error precedence.** One order covers the whole API. The first failing check answers:
1. body size and content type (413, 415)
2. foreign origin (403 `cross_origin`)
3. missing or invalid session or agent token (401)
4. unknown resource, or a resource in a project the caller does not belong to (404)
5. role not allowed (403 `forbidden`)
6. missing or malformed request key (400)
7. a stored response for the same key: the replay answers with it; a different body answers 409 `request_key_reused`
8. validation (422)
9. state conflicts (409, 410, 412)
10. dependency unavailable (503)

The rows below list only their own extra errors.

**Promotion object** (returned wherever "promotion" appears):
```json
{"id":"<uuid>","project":"payments-core","stage":"prod-eu","cluster":"lon1-prod","time_zone":"Europe/London",
 "kind":"promotion","state":"awaiting_approval","phase":"queued","progress":0.1,
 "bundle":{"version":"1.5.0","digest":"sha256:<64 hex>","short_digest":"<7 hex>","source_commit":"<40 hex>"},
 "overrides":{"parameters":{"LOG_LEVEL":"warn"},"replicas":{"Deployment/payments/payments-api":4}},
 "requested_by":{"email":"tomas.reyes@keelson.test","name":"Tomás Reyes"},"requested_at":"<instant>","policy_version":1,
 "approval":{"state":"pending","request_expires_at":"<instant>","decided_by":null,"decided_at":null,"expires_at":null,"comment":null},
 "window_decision":null,"freeze_break":null,"restores":null,"counter":null,
 "evidence":{"stored_snapshots":1,"queued_snapshots":0},
 "diff":[{"resource":"Secret/payments/payments-db","path":"stringData.password","change":"modified","before":"[redacted]","after":"[redacted]"}],
 "history":[{"from":null,"to":"requested","at":"<instant>","by":"tomas.reyes@keelson.test"},{"from":"requested","to":"awaiting_approval","at":"<instant>","by":"system"}]}
```
Field notes:
- `kind` is `promotion` or `rollback`. `approval` is `null` for stages that do not require approval. The approval `state` is `pending`, `approved`, `rejected` or `expired`.
- `window_decision` is the latest decision object. `freeze_break` is `{"by":"<email>","at":"<instant>","reason":"<text>"}`. `restores` is the restored promotion's id for rollbacks. `counter` is `{"in_sync":<n>,"total":<N>}` once the promotion has entered applying.
- A history `by` value is a person's email, `system`, or `agent:<cluster>`.
- A **decision object** is `{"evaluated_at":"<instant>","local_time":"YYYY-MM-DD HH:mm","open":true|false,"reason":"open"|"outside_window"|"freeze","window":{"id":"<id>","label":"<label>"}|null,"freeze":{"name":"<name>"}|null,"policy_version":<n>}`.

**Sessions**
- `POST /api/session` with `{"email":"...","password":"..."}` answers 200 `{"user":{"email","name"},"memberships":[{"project":"<slug>","role":"<role>"}]}`. It sets the session cookie `keelson_session`, which is HttpOnly, SameSite=Lax and Path=/. Wrong email or password answers 401 `invalid_credentials`.
- `GET /api/session` answers 200 with the same body, or 401 `unauthenticated`.
- `DELETE /api/session` answers 204 and ends the session.
- Sessions last `KEELSON_SESSION_TTL_SECONDS` (default 43,200 seconds) from sign-in. Every other `/api` route except health, agent reports and approval links answers 401 `unauthenticated` without a live session.

**Projects, graph and status**
- `GET /api/projects` answers 200 `{"projects":[{"slug","name","role"}]}`, listing only the caller's projects.
- `GET /api/projects/<p>/graph` answers 200 with:
  - `project`: `{"slug","name"}`
  - `role`
  - `nodes`: `[{"stage","cluster","time_zone","upstream":"<stage>"|null,"requires_approval":bool,"status","current":{"promotion_id","version","short_digest"}|null,"counter":{"in_sync","total"}|null,"active_promotion":<promotion>|null}]`
  - `edges`: `[{"from":"bundles"|"<stage>","to":"<stage>","phase","progress","promotion_id":"<id>"|null}]`

  `status` is one of `healthy`, `progressing`, `degraded`, `out_of_sync`, `not_deployed`.
- `GET /api/status` answers 200 `{"storage":"up"|"down","mail":"up"|"down","queued_uploads":<n>,"queued_notices":<n>}` for the whole installation.

**Bundles**
- `POST /api/projects/<p>/bundles` takes `{"version":"<1-64 chars of letters, digits, . + ->","source_commit":"<40 lowercase hex>","manifests":[<1 to 200 objects>]}` and answers 201 `{"id","version","digest","short_digest","source_commit","resources":[{"ref","kind","namespace","name"}],"ingested_at","ingested_by","verified_in":[]}`.
  - Each manifest needs a string `apiVersion`, a string `kind` and a `metadata.name` of 1 to 253 lowercase letters, digits, `-` or `.`. `metadata.namespace` is optional and defaults to `default`.
  - `ref` is `<kind>/<namespace>/<name>`. Refs must be unique within the bundle.
  - Validation messages: `fields.manifests` `"Each manifest needs apiVersion, kind and metadata.name."` or `"Duplicate resource <ref>."`; `fields.version` `"Use 1 to 64 letters, digits, dots, plus or minus signs."`; `fields.source_commit` `"Use the full 40-character commit."`
  - Extra errors: 409 `version_exists`, 503 `storage_unavailable`.
- `GET /api/projects/<p>/bundles` answers 200 `{"bundles":[<bundle>]}`, newest first. `verified_in` lists the stages where the bundle has reached Healthy. No bundle endpoint ever returns manifest contents.

**Stages and promotions**
- `PATCH /api/projects/<p>/stages/<s>` takes `{"defaults":{"parameters":{...},"replicas":{...}}}`, replaces the stage defaults, and answers 200 `{"stage","defaults"}`.
  - Parameter keys match an upper-case letter followed by up to 63 upper-case letters, digits or underscores. Values are strings of at most 1,000 characters.
  - Replica keys are refs and values are whole numbers from 0 to 100 inclusive.
  - Validation messages: `fields.parameters` `"Use upper-case keys and text values up to 1,000 characters."`; `fields.replicas` `"Use whole numbers from 0 to 100."`
- `POST /api/projects/<p>/stages/<s>/promotions` is *keyed*. It takes `{"bundle_version":"1.5.0","overrides":{"parameters":{},"replicas":{}}}`, where `overrides` is optional, and answers 201 with the promotion.
  - Validation messages: `fields.bundle_version` `"Unknown bundle version."`; `fields.replicas` `"Only Deployments and StatefulSets in this bundle can take replica counts."` or the PATCH replica message; `fields.parameters` as in PATCH.
  - Extra errors: 409 `stage_busy`, 409 `not_verified_upstream`.
- `GET /api/projects/<p>/promotions?stage=<s>&limit=<n>` answers 200 `{"promotions":[<promotion>]}`, newest `requested_at` first. `limit` runs from 1 to 100 and defaults to 50. An out-of-range limit answers 422 `fields.limit`.
- `GET /api/promotions/<id>` answers 200 with the promotion.
- `POST /api/promotions/<id>/approve` is *keyed*. It takes `{"comment":"<0 to 500 chars>"}`, where the comment is optional, and answers 200 with the promotion.
  - Extra errors: 409 `invalid_transition`, 409 `approval_expired`, 409 `evidence_pending`, 503 `storage_unavailable`.
- `POST /api/promotions/<id>/reject` is *keyed*. It takes `{"reason":"<10 to 500 chars>"}` and answers 200 with the promotion.
  - Extra errors: 409 `invalid_transition`, 409 `approval_expired`.
- `POST /api/promotions/<id>/start` is *keyed*. It takes `{}` and answers 200 with the promotion in `applying` or `window_blocked`.
  - Extra errors: 409 `invalid_transition`, 409 `approval_expired`.
- `POST /api/promotions/<id>/retry-window` is *keyed*. It takes `{}` and answers 200 with the promotion.
  - Extra errors: 409 `invalid_transition`, 409 `approval_expired`.
- `POST /api/promotions/<id>/break-freeze` is *keyed*. It takes `{"reason":"<10 to 500 chars>"}` and answers 200 with the promotion in `applying`.
  - Extra errors: 409 `invalid_transition`, 409 `approval_expired`.
- `POST /api/projects/<p>/stages/<s>/rollback` is *keyed*. It takes `{"reason":"<10 to 500 chars>"}` and answers 201 with the new rollback promotion.
  - Extra errors: 409 `stage_busy`, 409 `no_healthy_revision`, 503 `storage_unavailable`.
- The `reason` validation message, used everywhere: `"Give a reason of 10 to 500 characters."` The comment message: `"Keep the comment to 500 characters."`
- `GET /api/projects/<p>/stages/<s>/health` answers 200 `{"revision":"<promotion id>"|null,"in_sync":<n>,"total":<N>,"resources":[{"ref","kind","namespace","name","sync","health","updated_at"}]}`.
- `GET /api/promotions/<id>/evidence` answers 200 with the exact bytes of the latest stored snapshot. Headers: `Content-Type: application/json` and `Content-Disposition: attachment; filename="keelson-evidence-<promotion id>-<snapshot number>.json"`.
  - Extra errors: 409 `evidence_pending` (no snapshot stored yet), 503 `storage_unavailable`.

**Windows and freezes**
- `GET /api/projects/<p>/clusters` answers 200 `{"clusters":[{"name","time_zone","stages":[...],"windows":[<window>]}]}`.
- `POST /api/projects/<p>/clusters/<c>/windows` takes `{"label":"<1-80 chars>","days":["mon".."sun"],"start":"HH:MM","end":"HH:MM"}` and answers 201 `{"id","label","days","start","end"}`.
  - `start` runs from `00:00` to `23:59`. `end` runs from `00:01` to `24:00` and must be later than `start`.
  - Validation messages: `fields.days` `"Pick at least one day."`; `fields.start` or `fields.end` `"Use 24-hour time like 09:00."`; `fields.end` `"Closes must be after opens."`; `fields.label` `"Use 1 to 80 characters."`
- `DELETE /api/projects/<p>/clusters/<c>/windows/<id>` answers 204.
- `GET /api/projects/<p>/clusters/<c>/window-openings?from=<instant>&count=<n>` answers 200 `{"time_zone","openings":[{"window_id","label","opens_at","closes_at","local_opens":"YYYY-MM-DD HH:mm","local_closes":"YYYY-MM-DD HH:mm"}]}`.
  - The list is chronological and holds the next `count` openings whose `opens_at` is at or after `from`. It is empty when the cluster has no windows.
  - `count` runs from 1 to 20 and defaults to 5. A bad `from` or `count` answers 422 with `fields.from` `"Use an ISO 8601 instant with an offset."` or `fields.count` `"Use a whole number from 1 to 20."`
- `GET /api/projects/<p>/stages/<s>/window-decision?at=<instant>` answers 200 with a decision object for a promotion requested and checked at `at`, which defaults to now.
- `GET /api/projects/<p>/freeze-policy` answers 200 `{"in_force_version":<n>,"versions":[{"version","effective_from","created_by","created_at","freezes":[{"name","stages":[...],"starts_at","ends_at"}]}]}`.
- `POST /api/projects/<p>/freeze-policy/versions` takes `{"based_on_version":<n>,"effective_from":"<instant>","freezes":[{"name":"<1-80 chars>","stages":["prod-eu"],"starts_at":"<instant>","ends_at":"<instant>"}]}` and answers 201 with the new version.
  - Validation messages: `fields.effective_from` `"Effective time cannot be in the past."` or `"Must be later than when version <n> takes effect."`; `fields.freezes` `"Ends must be after starts."` or `"Unknown stage <name>."`
  - Extra error: 412 `stale_version`.

**Cluster agent and approval links**
- `POST /api/agent/reports` uses `Authorization: Bearer <cluster agent token>`. It takes `{"promotion_id":"<id>","phase":"applying"|"health_wait","resources":[{"ref":"<ref>","sync":"Synced"|"OutOfSync","health":"Healthy"|"Progressing"|"Degraded"|"Missing"}]}`, with 1 to 200 resources, and answers 200 `{"promotion_id","state","counter":{"in_sync","total"}}`.
  - A missing or unknown token answers 401 `unauthenticated`. A promotion on another cluster answers 404 `not_found`.
  - Validation message: `fields.resources` `"Unknown resource <ref>."`
  - Extra errors: 409 `phase_regression`, 409 `promotion_not_running`.
- `GET /api/approval-links/<token>` needs no session. It answers 200 `{"project","stage","bundle":{"version","short_digest"},"requested_by","request_expires_at","time_zone","diff":[...],"promotion_id"}`, or 410 `link_expired` once the request has been decided or has expired. An unknown token answers 404.

**Health**
- `GET /api/health` answers 200 `{"status":"ok"}`. It is the one route outside the common error shape. Its answer while starting is stated in Server boundary.

### Business rules (DP-04, DP-21, DP-22, DP-23, DP-25, DP-26, DP-27, DP-30, DP-33, DP-34, DP-36, DP-37, DP-39, DP-40, DP-41, DP-43, DP-44, DP-46, DP-48, DP-51, DP-52)

**Authority.** Each person holds one role per project: `platform_engineer`, `service_developer`, `release_manager` or `oncall_sre`. Every member may read the project's graph, bundles, promotions, health, clusters, windows, freeze policy and evidence. A role outside its row answers 403 `forbidden`.

| Action | Allowed roles |
|---|---|
| Ingest bundle, request promotion, start, re-check window | service_developer, platform_engineer |
| Approve, reject | release_manager |
| Break freeze, roll back | oncall_sre |
| Edit stage defaults, add or delete windows, schedule freeze versions | platform_engineer |

**Promotion states and transitions.** A promotion's state is one of `requested`, `awaiting_approval`, `approved`, `rejected`, `expired`, `queued`, `window_blocked`, `applying`, `health_wait`, `healthy`, `degraded` or `rolled_back`. Every change appends one history entry, and history entries are never changed or removed. The legal transitions are:

| From | To | Trigger and guard |
|---|---|---|
| requested | awaiting_approval | automatic, within the request, for stages that require approval |
| requested | queued | automatic, within the request, for other stages |
| awaiting_approval | approved | approve; the request's first evidence snapshot is stored and the request has not expired |
| awaiting_approval | rejected | reject; the request has not expired |
| awaiting_approval | expired | the request lapses |
| approved | queued | start; the approval is still valid |
| approved, window_blocked | expired | the approval lapses (prod promotions of kind `promotion` only; rollbacks never expire) |
| queued | applying or window_blocked | the window check, run immediately, within the same request |
| window_blocked | queued | re-check window, or break freeze; for a prod promotion of kind `promotion`, its approval is still valid; rollbacks carry no approval and have no such guard |
| applying | health_wait | an agent report with phase `health_wait` |
| applying, health_wait | healthy or degraded | agent reports, by the rules below |
| healthy, degraded | rolled_back | a rollback on the stage while this promotion is the stage's current revision |

Every other attempted transition answers 409 `invalid_transition` with the current state. A re-check that stays closed records a new decision without a state change. Break freeze moves window_blocked to queued and then straight to applying, skipping the window check for that one promotion, whether it was blocked by a freeze or by a closed window.

**Active promotions and the stage lock.** A promotion is active while its state is `requested`, `awaiting_approval`, `approved`, `queued`, `window_blocked`, `applying` or `health_wait`. A stage has at most one active promotion. Of any number of simultaneous promotion or rollback requests to one stage, exactly one succeeds. Every other request answers 409 `stage_busy` with the holder, and creates no record, no object and no message. Postgres decides the winner, so the rule holds across several running instances.

**Request keys.** Keyed calls store their response under the caller, the method, the path and the key, for `KEELSON_REQUEST_KEY_TTL_SECONDS` (default 86,400 seconds).
- A repeat with an equal JSON body answers the stored status and body, with the header `Request-Replayed: true`, and changes nothing. Key order and whitespace do not affect body equality.
- A repeat with a different body answers 409 `request_key_reused`.
- If the original call is still running, the repeat waits for it and returns its result.
- A 503 response is never stored, so a retry with the same key runs afresh.

**Verified upstream.** A promotion into a stage with an upstream stage requires that the bundle has at some point reached `healthy` in that upstream stage. Otherwise it answers 409 `not_verified_upstream`. Any ingested bundle may go to dev.

**Frozen overrides.** At request time the server merges the stage defaults with the request's overrides, and the request wins on equal keys. Default replica refs that are not in the bundle are dropped. The result is stored on the promotion and never recomputed. Rollbacks copy the restored promotion's stored overrides unchanged.

**Window check.** The check runs when a promotion leaves `queued` and judges that instant:
1. **Freeze.** The server takes the freeze policy version pinned on the promotion at request time. If any of its freezes lists the stage and has `starts_at` ≤ instant < `ends_at`, the result is closed with reason `freeze`.
2. **Window.** If the stage's cluster has no windows, the result is open. Otherwise it is open only when the instant, converted to the cluster's IANA zone, falls on a listed day at or after `start` and before `end`. The start is inclusive, the end is exclusive, and `24:00` means the following midnight. A promotion that cannot pass is closed with reason `outside_window`.

Freeze takes precedence when both apply. The browser's and the server's zones play no part. A promotion that entered `applying` keeps accepting agent reports and may finish after its window closes or its window is deleted. No promotion enters `applying` through a closed check except by break freeze.

**Clock changes.** Windows keep their local wall-clock times in every week.
- A local time that does not exist because the clocks went forward moves forward by the length of the gap.
- A local time that occurs twice because the clocks went back uses the earlier occurrence.

For example, with the seed data at start, the lon1-prod Tuesday 09:00 window opened at 08:00 UTC on 2026-10-20 and opens at 09:00 UTC on 2026-10-27, after London's clocks went back on 2026-10-25. A Sunday 01:30 Europe/London window opens at 01:30 UTC on 2027-03-28, which is 02:30 local, because 01:30 does not exist that night. A Sunday 01:30 window on 2026-10-25 opens at 00:30 UTC, the first occurrence.

**Freeze policy versions.**
- Each project's freeze policy is a series of numbered versions, and each new version replaces the whole set of freezes. The version in force at an instant is the highest-numbered version whose `effective_from` is at or before that instant.
- Each promotion pins the version in force at its `requested_at` and is judged by it on every check, every screen and in its evidence, even after newer versions take effect.
- A new version's `based_on_version` must equal the latest version number. Otherwise it answers 412 `stale_version` with the latest number.
- Its `effective_from` must not be earlier than the server's current instant, and must be later than the latest version's `effective_from`.

**Approval lifetime.** The lifetime is `KEELSON_APPROVAL_TTL_SECONDS` (default 14,400 seconds, which is 4 hours).
- An approval request's `request_expires_at` is `requested_at` plus the lifetime. A granted approval's `expires_at` is `decided_at` plus the lifetime.
- A prod promotion of kind `promotion` may enter `queued` from `approved` or `window_blocked` only while the current instant is before `expires_at`. Rollbacks have no approval, so neither this guard nor approval expiry applies to them. At or after that instant the call answers 409 `approval_expired` and the promotion becomes `expired`.
- Approve and reject at or after `request_expires_at` answer 409 `approval_expired` and the promotion becomes `expired`.
- A server sweep runs at least every 5 seconds and expires every lapsed request and approval within 5 seconds of its instant.
- Each expired promotion sends exactly one expiry notice, however many calls hit it.

**Approval decisions.** Approving does three things, all or nothing:
1. It stores the decision snapshot in object storage first.
2. It records the approval.
3. It queues the approved notice.

If the upload fails, the call answers 503 `storage_unavailable` and no approval, no snapshot and no notice exists. Approving while the request's first snapshot is still queued answers 409 `evidence_pending`. Rejection records the decision and queues its snapshot and notice. It does not need storage to be up.

**Agent reports, counters and phases.**
- When a promotion enters `applying`, the server creates one health row per bundle resource with sync `OutOfSync` and health `Progressing`. That promotion becomes the stage's **current revision**: the latest promotion of the stage to have entered `applying`.
- Each report updates the listed rows and appends `{"at","phase","in_sync","total"}` to the promotion's health timeline. Then:
  - if any row is `Degraded`, the promotion becomes `degraded`;
  - otherwise, if the phase is `health_wait` and every row is `Synced` and `Healthy`, it becomes `healthy`;
  - otherwise it moves to the reported phase.
- A report with phase `applying` for a promotion in `health_wait` answers 409 `phase_regression`. A report for a promotion not in `applying` or `health_wait` answers 409 `promotion_not_running`.
- `in_sync` is the number of the current revision's rows that are both `Synced` and `Healthy`. `total` is the number of its rows. The API and the screen never show any other count.

**Stage status.**
- `progressing` when the active promotion is in `applying` or `health_wait`.
- Else `out_of_sync` when an active promotion exists (the desired bundle differs from what is live).
- Else `healthy` or `degraded` from the current revision's state; a current revision in `rolled_back` counts as `degraded`.
- Else `not_deployed`.

**Rail phase and progress.** Each edge shows the latest promotion into its target stage. Its `phase` and `progress` (a number from 0 to 1, rounded to three decimals) are:

| Promotion state | phase | progress |
|---|---|---|
| awaiting_approval, approved, queued | `queued` | 0.1 |
| window_blocked | `window_check` | 0.2 |
| applying | `applying` | 0.2 + 0.4 × in_sync ÷ total |
| health_wait | `health_wait` | 0.6 + 0.35 × in_sync ÷ total |
| healthy | `healthy` | 1 |
| degraded | `degraded` | the last value before failure |
| rejected, expired | `stopped` | 0 |

An edge with no promotion has `idle` and 0. The DOM attributes `data-phase` and `data-progress` carry exactly these values.

**Rollback.**
- The target is the stage's last healthy promotion: the most recent promotion of that stage whose state is `healthy`, excluding the current revision. If none exists, the call answers 409 `no_healthy_revision`.
- Rollback needs no active promotion on the stage; otherwise it answers 409 `stage_busy`.
- The server reads the target bundle's stored object back from object storage and checks that its SHA-256 matches the digest. If storage is unreachable, the call answers 503 `storage_unavailable` and nothing changes.
- On success, the current revision becomes `rolled_back`. A new promotion of kind `rollback` is created with the target's bundle digest and stored overrides, byte for byte, and `restores` set to the target's id. The rollback skips approval, so the approval-lifetime guard never applies to it. It still passes through the window check like any promotion. When it is blocked, it moves on by re-check window or break freeze.

**Diff and redaction.**
- The diff compares the new bundle and frozen overrides against the stage's current revision. A stage with no current revision shows every resource as added.
- Added and removed resources give one entry each, with `path` `""` and `before`/`after` `null`. Modified resources give one entry per changed leaf, using dot paths with `[i]` indexes. Override changes use resource `overrides` and paths like `parameters.LOG_LEVEL`.
- Every value under `data` or `stringData` of a `Secret`, and under `spec.encryptedData` or `spec.template.data` of a `SealedSecret`, is replaced with the literal `[redacted]` wherever it would be shown. That covers the API diff, the evidence column, the approval-link page, evidence snapshots and every message. Key names stay visible.

### Services (DP-08, DP-18, DP-32, DP-34, DP-46, DP-50, DP-54, DP-55)

**Postgres** holds every record in this brief: sessions, request keys, the stage lock, the health rows, the append-only history, and the queues of pending uploads and messages. The queues live in the database, so any running instance delivers them. Each item is delivered once even when several instances run, and each instance claims an item before sending it. Apply the schema and the seed idempotently every time the server starts.

**MinIO** uses the bucket named by `S3_BUCKET`. Every stored object stays, and nothing is overwritten.
- **Bundle objects** use the key `bundles/<project slug>/<64-hex digest>.json`. The object is the bundle's `{"version","source_commit","manifests"}` as JSON bytes. The digest is `sha256:` plus the lowercase hex SHA-256 of exactly those bytes. Ingest uploads the object before recording the bundle. If storage is unreachable, ingest answers 503 `storage_unavailable` and records nothing.
- **Evidence snapshots** use the key `evidence/<project slug>/<promotion id>/<snapshot number, three digits from 001>.json`. A new numbered snapshot is written when:
  1. a promotion or rollback is accepted
  2. it is approved or rejected
  3. it expires
  4. a freeze is broken for it
  5. it reaches `healthy` or `degraded`
  6. it becomes `rolled_back`
- Each snapshot is a JSON object with these keys:
  - `snapshot`, `promotion_id`, `project`, `stage`, `cluster`, `time_zone`, `kind`
  - `bundle` (`version`, `digest`, `source_commit`)
  - `overrides`, `requested_by`, `requested_at`, `policy_version`, `state`, `diff`
  - `approvals` (`decision`, `by`, `at`, `expires_at`, `comment`)
  - `window_decisions`, `freeze_breaks`, `health_timeline`, `history`
  - `restores`
- **When storage is unreachable:**
  - snapshots other than the approval snapshot wait in the queue, and their action still succeeds;
  - approval answers 503 `storage_unavailable`, as stated in Business rules;
  - rollback, ingest and evidence download answer 503 `storage_unavailable`;
  - seeded bundle objects and seeded snapshots wait in the queue at start.

**Mailpit** receives SMTP at `SMTP_HOST`:`SMTP_PORT`, from `Keelson <keelson@tideline.test>`. Each event sends exactly one message per recipient, as plain text, and never carries a secret value.

| Event | To | Subject |
|---|---|---|
| prod promotion accepted | every release manager of the project | `Approval requested: <version> to <stage> (<project name>)` |
| approved | requester | `Approved: <version> to <stage>` |
| rejected | requester | `Rejected: <version> to <stage>` |
| request or approval expired | requester | `Approval expired: <version> to <stage>` |
| freeze broken | every release manager of the project | `Freeze broken: <stage> by <SRE name>` |

Message bodies:
- Each body names the project, stage, version, short digest and requester, and links to the promotion.
- The approval-requested body also carries the redacted diff summary, `request_expires_at` in cluster time format, and the link `<APP_PUBLIC_URL>/approvals/<token>`. The token is random with at least 128 bits and works until the request is decided or expires.
- The freeze-broken body carries the SRE's reason.

When mail is unreachable, messages wait in the queue and the action that caused them succeeds.

**Reachability and drain.** The server checks storage and mail reachability at least every 5 seconds and reports it through the status endpoint. Queued items are retried at least every 5 seconds, in order per promotion. Every queued item is delivered within 30 seconds of its service becoming reachable, with no restart.

### Seed data (DP-02, DP-20, DP-22, DP-31, DP-49)

Every person, company and credential below is invented. All seeded people use the password `keelson-demo-2026`.

| Person | Email | Payments Core role | Claims Hub role |
|---|---|---|---|
| Ines Okafor | ines.okafor@keelson.test | platform_engineer | none |
| Tomás Reyes | tomas.reyes@keelson.test | service_developer | none |
| Mei Lindqvist | mei.lindqvist@keelson.test | service_developer | none |
| Hana Sato | hana.sato@keelson.test | release_manager | none |
| Olu Adeyemi | olu.adeyemi@keelson.test | release_manager | none |
| Kofi Brandt | kofi.brandt@keelson.test | oncall_sre | none |
| Ravi Castell | ravi.castell@keelson.test | none | service_developer |
| June Park | june.park@keelson.test | none | release_manager |

**Projects.** `payments-core` "Payments Core" and `claims-hub` "Claims Hub".

**Clusters** (project, name, zone, agent token):

| Project | Cluster | Zone | Agent token |
|---|---|---|---|
| payments-core | lon1-nonprod | Europe/London | `agt-pc-lon1-nonprod-5e1f` |
| payments-core | lon1-prod | Europe/London | `agt-pc-lon1-prod-8a2c` |
| payments-core | use1-prod | America/New_York | `agt-pc-use1-prod-3d7b` |
| payments-core | sin1-prod | Asia/Singapore | `agt-pc-sin1-prod-9c4e` |
| claims-hub | fra1-nonprod | Europe/Berlin | `agt-ch-fra1-nonprod-2b6a` |
| claims-hub | use2-prod | America/Chicago | `agt-ch-use2-prod-7f3d` |

**Stages** (project, name, cluster, upstream, requires approval, defaults):

| Project | Stage | Cluster | Upstream | Approval | Defaults |
|---|---|---|---|---|---|
| payments-core | dev | lon1-nonprod | none | no | `LOG_LEVEL=debug`, payments-api replicas 1 |
| payments-core | staging | lon1-nonprod | dev | no | `LOG_LEVEL=info`, replicas 2 |
| payments-core | prod-eu | lon1-prod | staging | yes | `LOG_LEVEL=warn`, replicas 4 |
| payments-core | prod-us | use1-prod | staging | yes | `LOG_LEVEL=warn`, replicas 4 |
| payments-core | prod-apac | sin1-prod | staging | yes | `LOG_LEVEL=warn`, replicas 4 |
| claims-hub | dev | fra1-nonprod | none | no | none |
| claims-hub | staging | fra1-nonprod | dev | no | none |
| claims-hub | prod-us | use2-prod | staging | yes | none |

The payments-api replica ref is `Deployment/payments/payments-api`.

**Sync windows.**
- lon1-prod: "EU change window", `tue`, 09:00 to 12:00.
- sin1-prod: "APAC business hours", `mon` to `fri`, 10:00 to 16:00.
- No other cluster has windows.

**Freeze policy.**
- Payments Core version 1 is effective from 2026-01-01T00:00:00Z, with one freeze, "Year-end freeze", on prod-eu, prod-us and prod-apac from 2026-12-23T00:00:00Z to 2027-01-04T00:00:00Z.
- Claims Hub version 1 is effective from 2026-01-01T00:00:00Z, with no freezes.

**Bundles.** Payments Core 1.5.0 has source commit `9e3b5d7f1a2c4e6b8d0f1a3c5e7b9d2f4a6c8e01` and these manifests:
```json
[{"apiVersion":"v1","kind":"ConfigMap","metadata":{"name":"payments-api-config","namespace":"payments"},"data":{"FEATURE_PAYOUTS":"on"}},
 {"apiVersion":"v1","kind":"Secret","metadata":{"name":"payments-db","namespace":"payments"},"type":"Opaque","stringData":{"password":"pc-db-pass-1.5-ZETA"}},
 {"apiVersion":"bitnami.com/v1alpha1","kind":"SealedSecret","metadata":{"name":"payments-psp-key","namespace":"payments"},"spec":{"encryptedData":{"apiKey":"AgB7sealedPSPkey15"}}},
 {"apiVersion":"apps/v1","kind":"Deployment","metadata":{"name":"payments-api","namespace":"payments"},"spec":{"replicas":2,"template":{"spec":{"containers":[{"name":"api","image":"registry.keelson.test/payments-api:1.5.0"}]}}}},
 {"apiVersion":"v1","kind":"Service","metadata":{"name":"payments-api","namespace":"payments"},"spec":{"ports":[{"port":443}]}}]
```
- Payments Core 1.4.0 has source commit `4a1c9e0b7d2f63a85e19c04b7f3d2a6e8c5b1f90` and the same five resources, with these differences: `FEATURE_PAYOUTS` `off`, password `pc-db-pass-1.4-THETA`, apiKey `AgB4sealedPSPkey14`, and image tag `1.4.0`.
- Claims Hub 2.0.0 has source commit `c0ffee1234567890abcdef1234567890abcdef12`. It has a Deployment `claims/claims-api` (replicas 2, image `registry.keelson.test/claims-api:2.0.0`) and a Secret `claims/claims-db` with `stringData.password` `ch-db-pass-2.0-KAPPA`.
- Digests are computed by the server at seed time and are read through the API.

**Promotion history.** All seeded promotions are `healthy`, with every health row `Synced` and `Healthy`. Each carries the stage defaults as overrides, policy version 1, and one evidence snapshot.

| Project | Bundle | Stages | Requested by | Requested at | Approval |
|---|---|---|---|---|---|
| Payments Core | 1.4.0 | dev | Tomás Reyes | 2026-10-19T08:00:00Z | none |
| Payments Core | 1.4.0 | staging | Tomás Reyes | 2026-10-19T10:00:00Z | none |
| Payments Core | 1.4.0 | prod-eu, prod-us, prod-apac | Tomás Reyes | 2026-10-20T08:00:00Z | approved by Hana Sato at 2026-10-20T08:30:00Z |
| Payments Core | 1.5.0 | dev | Mei Lindqvist | 2026-10-22T08:00:00Z | none |
| Payments Core | 1.5.0 | staging | Mei Lindqvist | 2026-10-22T10:00:00Z | none |
| Claims Hub | 2.0.0 | dev | Ravi Castell | 2026-10-21T09:00:00Z | none |

## Technical requirements

### Deployment (DP-01)

The runtime is Node.js 22 with npm, and the code is TypeScript. Place `/app/run.json` at the app root, with string commands and the schema marker:
```json
{"_schema":"run-manifest-v1","install":"npm ci","build":"npm run build","serve":"npm run start"}
```
- The serve command binds `0.0.0.0` on the port in `APP_PUBLIC_PORT` when it is set, and on 4173 otherwise. It serves the workspace, the client routes and the API from that one port.
- `GET /api/health` answers HTTP 200 with JSON `{"status":"ok"}` once the server accepts requests.
- Build produces everything serve needs. Serve applies the schema and seed idempotently, so it works on an empty database.

### Configuration and secrets (DP-07)

The server reads these variables at start:
- `DATABASE_URL`
- `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_FORCE_PATH_STYLE`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`
- `SMTP_HOST`, `SMTP_PORT`
- `APP_PUBLIC_PORT`
- `APP_PUBLIC_URL` (the link base in messages; defaults to `http://localhost:<port>`)
- `KEELSON_APPROVAL_TTL_SECONDS`, `KEELSON_SESSION_TTL_SECONDS`, `KEELSON_REQUEST_KEY_TTL_SECONDS`

No credential, endpoint or bucket name is hard-coded in source, written to the client bundle, or returned in any response. Seeded passwords are stored only as hashes. Seeded agent tokens are seed data, not service credentials.

### Server boundary (DP-06, DP-08)

- **Same origin.** The browser talks only to its own origin. Any non-GET request whose `Origin` header names another origin answers 403 `cross_origin`, and the server sends no cross-origin permission headers.
- **Body limits and content type.**
  - Bundle ingest bodies may be up to 1,000,000 bytes. Every other body may be up to 64,000 bytes. Both limits are inclusive, and a larger body answers 413 `payload_too_large`.
  - A request body that is not `application/json` answers 415 `unsupported_media_type`.
- **What the server serves.** It serves only the built client assets, the client routes `/sign-in`, `/projects/<slug>`, `/projects/<slug>/windows` and `/approvals/<token>`, and the API. Every other path answers 404, including `/run.json`, `/package.json`, `/.env`, source files and source maps. Responses never include stack traces.
- **Postgres at boot.** Postgres must be reachable to serve. Until it is, the server retries every 2 seconds and `/api/health` answers 503 `{"status":"starting"}`.
- **Object storage or mail at boot.** If either is unreachable at boot, or at any later time, the server still starts and answers health 200, and it behaves as stated in Services until the service returns.

### Browser support and performance (DP-10, DP-27)

- The workspace works in current Chromium, Firefox and WebKit at 375x812, 768x1024 and 1280x800, with touch or pointer input.
- With the seed data, the workspace is usable within three seconds of opening.
- Every API call answers within one second, except an approval or rollback waiting on storage.
- Rail and counter updates follow the refresh delay in Interactions.

## Working rules

- **IF-01** `/app/run.json` exists with string `install`, `build` and `serve` fields and `"_schema":"run-manifest-v1"`, and the app starts from it alone.
- **IF-02** `THIRD_PARTY_NOTICES.md` at `/app` names every shipped package with its version and licence. Shipped packages are the production dependency tree reported by `npm ls --omit=dev --all --json`. The file also lists the self-hosted fonts and icon set.
- **IF-03** Every shipped package, font and icon set uses one of these licences: MIT, ISC, BSD-2-Clause, BSD-3-Clause, Apache-2.0, 0BSD, or SIL OFL 1.1 for fonts.
- **IF-04** The app uses no datastore other than the provided Postgres, MinIO and Mailpit. That rules out SQLite, Redis, local files or in-memory stores as the record of any state that must survive a restart.
- **IF-05** The provided service configuration and its environment variable names stay as given.
- **IF-06** `package-lock.json` is committed and `npm ci` installs from it.
- **IF-07** Fonts, icons and scripts are served from the app's own origin, with no external network requests from the browser.

## Engineering standards

- Code is idiomatic, strictly typed TypeScript with no `any` on domain data. Names match this brief's domain terms: stage, cluster, bundle, promotion, window, freeze policy version, approval, evidence snapshot, health row and request key.
- Each domain rule is decided in exactly one place in the source:
  - the promotion transitions
  - the stage lock
  - the window check, including the clock-change rule
  - the policy version in force
  - approval expiry
  - the in-sync counter
  - the rail phase and progress mapping
  - redaction
- The client renders the phase, progress and counters from server values and never derives them.
- Every error response is built from one error shape, with the codes listed in API.
- There are no abstractions with a single implementation, and no wrappers that only forward calls.
- There is no dead, commented-out or unreachable code, and no defensive checks for states the transitions make impossible.
- Calls to storage and mail are made only where Services says they happen, and their failure handling follows Services exactly.
- There are no features, endpoints, screens or settings beyond this brief.
