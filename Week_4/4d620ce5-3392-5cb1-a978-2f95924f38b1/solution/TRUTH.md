# TRUTH — Saltmarsh Aero Software Tailboard (golden)

The brief made concrete. Each value is `brief: <section>` (verbatim) or `decided: <why>`.

## Journeys: the ideal flow

### 1. A new directive reaches the board
- Start: Avery Lund (`avery.lund` / `saltmarsh-planner-1`) is on the board. The rail shows four directives under EASA,
  UK CAA, ATR and Embraer, with "No directives" under De Havilland. Fleet counts read Open 20, Due soon 6, Overdue 5,
  Deferred 1 and Complied 4 (brief: Seed data).
- Avery presses "New directive". The dialog fades and rises (250 ms) and focus goes to Authority. They fill Authority,
  Directive number, Title, Effective date (prefilled with today in Europe/London, decided: the most common value),
  Calendar limit in days, Flight-hours limit, Method of compliance, one Applicability range (Model, First serial,
  Last serial) and the Directive document, then press Ingest.
- The browser POSTs the PDF to `/api/documents` (201, key `directives/<sha256>.pdf` stored in MinIO), then POSTs
  `/api/directives`. Status reads "Ingesting R1…" and then "<directive> R1 ingested.". The dialog closes, a new
  column appears under its authority in the rail and the matrix, and every affected tail shows an Open cell with two
  rails and "CAL governs" or "FH governs". The Revision changes banner reads "<directive> R1 added: <n> added", and
  the fleet Open count rises by n.
- An invalid number keeps the dialog open, shows the message under Directive number and focuses that field.
- Avery opens an Open UK CAA cell, types a Deferral reason and presses Defer. Status reads
  "Deferred. New due YYYY-MM-DD.", the cell turns Deferred, and the Deferred count goes up by one.
- Provider end state: one `revisions` row, one thread per tail in effectivity, `WC-nnnnn` work cards, audit entries
  `thread.added` and `directive.ingested`, one `revision` event on `/api/events`.

### 2. A revision lands mid-week
- Noor Haddad ingests R2 of EASA 2026-0142 from another browser. Server: one transaction stores the R1 snapshot,
  R2, the history entries (R1 with its own limits, wording and outcome), the thread changes (retargeted →
  `superseded_retargeted` with a new baseline, kept stays `certified` pinned to R1, added → `open`, removed →
  `not_applicable`), the notice rewrites and the audit entries, then NOTIFY.
- Every open board: `aria-busy="true"`; the header splits on a lavender hairline; R1 slides down into the ribbon
  while R2 drops into place (200 ms); rows re-thread top to bottom 26 ms apart (first 24 rows, 140 ms each; later
  rows snap when row 24 starts); rails redraw old→new, pinned cells gain "signed under R1", added cells drop in,
  removed cells collapse into the hatched stub; the counts roll (320 ms); `aria-busy="false"` within 1.4 s.
- Banner: "R2 supersedes R1: <n> retargeted, <n> added, <n> removed, <n> kept under R1". Each phrase is a filter
  link ("Showing <n> <category> cells from R2", with "Clear filter").
- Avery opens a Superseded cell, reviews the R2 limits, types an Effectivity reason and presses Confirm
  effectivity. Status reads "Effectivity confirmed.", and the cell turns Open (or keeps its claim if a holder is kept).

### 3. Night shift on one card
- Dara Okafor and Sol Brennan both press "Claim work card" on G-FNAF. The server row lock decides: one gets
  "Work card WC-nnnnn is yours.", the other gets the alert "Already held by <winner>.". A third press by the holder
  answers 200 and records nothing.
- The holder attaches a photo ("Uploading evidence…", then "Evidence attached."; stored as
  `evidence/<sha256>.jpg`), enters Method reference and Findings, and presses Sign inspection. Status reads
  "Inspection signed under R1, on time.". The sign-off chain lists the signature and ends with the assigned certifier
  and "awaiting countersignature". If the network drops, the copy is "Connection lost. Retrying with the same
  request." and up to three retries with the same key follow (1 s, 3 s, 5 s). The replay returns the stored response
  and creates no second signature and no second notice.

### 4. Countersignature and succession
- Robin Achterberg removes ATR 72 from Ines Varga's scope ("Scope saved. 1 threads passed on."). Ines's
  Countersign is refused with "Your certification scope does not cover ATR 72." (403 `out_of_scope`). Sol's
  inspection stays valid. The chain shows Tomasz Wilk awaiting countersignature, and a "Countersignature passed to
  you: G-FNAC EASA 2026-0142 R1" notice is queued and then mailed after NOTICE_HOLD_SECONDS. Tomasz presses Countersign
  ("Countersigned under R1. Thread closed."). The cell turns Complied and its rails freeze.

### 5. Spreadsheet history comes in
- Robin presses "Import history", chooses the CSV and presses Import. Status reads "Import finished: <n> merged,
  <n> duplicates, <n> orphans, <n> rejected.". The Import result region shows the counts, the Orphan rows table (row,
  tail, directive, revision, reason) and the Rejected rows table (row, field, message). Merged rows appear as legacy
  records in the drawer's revision history. Importing the same bytes again gives "This file was already imported.
  Nothing changed." (200, `replayed_file: true`) and changes no record and no count.

### 6. Correction, erasure and the pack
- Reopen: "Thread reopened. Prior signatures kept as void.". The work card id, the holder (the last inspector) and
  the evidence objects stay the same, and every signature is listed as `void` with the reason.
- Erase Mika Hollis: "SIGNER-XXXXXXXX now replaces this contractor everywhere.". Sessions end, the signatures,
  evidence and audit entries show the token, held cards are released, queued notices to Mika are withdrawn, queued
  notices naming Mika are rewritten, and stored packs are re-rendered under new keys (old objects deleted when
  unreferenced). Mail already sent is untouched.
- With mail down, "Send compliance pack" gives "Pack queued: mail is unavailable. It will go out automatically." The
  Packs table shows Queued, and the background retry (every 10 s) stores the PDF and CSV, sends exactly one email
  with the link, both SHA-256 lines and `<pack id>-manifest.csv`, and marks it Transmitted. The Packs screen reads
  `GET /api/packs` again every 5 seconds while it is shown, so the row updates within 5 seconds, with no reload.

### 7. The auditor's view
- Casey Moreau sees no New directive, Import history, claim, sign, defer, reopen or erase controls. They press R1 in
  the ribbon behind the EASA 2026-0142 header ("View under R1"). The column shows the snapshot, and the status reads
  "Viewing EASA 2026-0142 as it stood under R1. Read-only." with Back to current. On the Audit screen they filter by
  directive, read the entries newest first, and download the transmitted pack PDF from the Packs table. Every write
  from this role answers 403 `forbidden`.

## Palette (brief: Visual design; hex decided in DESIGN.md)

| Role | Hex | Use |
|---|---|---|
| ground | #0B0F15 | page and panes |
| ink | #E4E9F0 | text, Open glyph, icons (15.7:1) |
| ink-muted | #9AA4B4 | secondary text, Deferred glyph, rail fill (7.6:1) |
| ink-dim | #8792A3 | Complied glyph and label, frozen rails, stub labels (6.1:1) |
| rule | #5B6579 | hatching, Not applicable / Withdrawn glyphs (3.3:1) |
| hairline | color-mix(rule 45%, ground) | all separating rules |
| amber | #F0A73A | Overdue glyph only (one per cell) |
| lavender | #B7AAF7 | links, focus ring, selected outline, Due soon, Superseded dashed outline, ribbon, pinned tab |

## Type (brief: Type)
IBM Plex Sans Condensed 500/600 for headings, column headers and tags; IBM Plex Sans 400/500/600 for body at 13px;
IBM Plex Mono with tabular figures, right-aligned, for every number. The scale is 13 → 15.6 → 18.7 → 22.5 (×1.2,
brief: one fifth per step). All fonts are self-hosted woff2 under OFL-1.1.

## Space and layout per viewport (brief: Viewports)
- 1280×800: top bar 48 px, rail 208 px, board bar 36, strip 28, header 64, rows 28 (20+ tails, brief: Density),
  cells 184 px. The drawer takes 33.3 vw (matrix narrows) and does not trap focus. The readout strip (28 px, fixed)
  holds the Action status, Action error and Live updates regions (decided: a fixed slot never shifts the layout).
- 768×1024: the rail opens as an overlay behind "Directives", the drawer overlays 66 vw from the right, and rows and
  tap targets are 44 px.
- 375×812: section links sit behind "Menu", the "Directive" picker shows one column, and the drawer and dialogs are
  full screen.
- The page never scrolls sideways. The matrix scrolls both ways with a sticky header row and tail column, and its
  scroll-padding matches them.

## Motion (brief: Motion and effects)
| Element | Trigger | Duration | Easing | Reduced motion |
|---|---|---|---|---|
| hover/press tint | pointer | 100 ms | ease-out | none |
| drawer | open (slide 32 px from the right + fade, decided: controls stay under the pointer) / close | 250 / 100 ms | cubic-bezier(.2,.8,.2,1) / ease-in | none |
| dialog | open | 250 ms fade + rise 8 px | same | none |
| cell cross-fade | live update outside a splice | 100 ms | ease-out | none |
| splice header | revision event, once the recount is fetched | 200 ms | cubic-bezier(.2,.8,.2,1) | one-frame swap |
| splice rows | after header | 26 ms stagger, 140 ms each, first 24 rows | same | one-frame swap |
| count roll | after last row | 320 ms | same | one frame |
There are no loops or spinners; pending states are text.

## States per async action (brief: Copy by action)
Pending, success and error copy is used verbatim from the brief for: sign in, session ended, forbidden, ingest,
revision banner, claim, release, attach evidence, sign inspection, countersign, defer, confirm effectivity, log
hours, import, reopen, save scope, erase, send pack, withdraw, keyed offline retry and live feed. Decided where the
brief is silent: "Attach a JPEG, PNG or PDF file." for 415 on evidence, and "Connection lost. Nothing was
confirmed." for a dropped non-keyed request.

## Decided where the brief is silent
- Who holds a work card. The seed names a holder only where it says "claimed by" (brief: Seed data, G-FNAD, G-FNAE,
  G-FNBC). For G-FNAC and G-FNCB it gives the inspector, the time and the assigned certifier, and no claim, so those
  two cards start with no holder. Inspector and holder are separate fields, so Sol Brennan stays the inspector of
  G-FNAC on every surface. When an inspector claims and signs live, they keep the card (brief: Stages and
  transitions, Sign inspection from `claimed` or `reopened` with holder to `inspected`, with no holder change). Supersession never changes
  a holder (brief: Supersession, "The inspector stays as card holder"), and a held, inspected card gets its
  `card_revision` notice. A countersignature closes the thread and clears the holder (brief: Reopen, the card
  "returns to the holder who signed the last voided inspection"; Erasure clears holders only on claimed, reopened,
  inspected and superseded threads, never on certified ones).
- History entries record the limits in force when the thread left that revision, so a deferred thread's entry shows `deferred: true` with the extended deadline and threshold (brief: Limits is one shape; Deferral grace moves the deadline 7 days and the threshold 25.0; Supersession, a deferral "remains visible in history").
- Every keyed response that passes the key checks is stored for replay, refusals included (brief: API,
  Idempotency and Precedence step 4, "returns the original response and records nothing new"). A refusal's work
  is rolled back, and only the response is kept, so a replayed 409 `card_held` answers 409 even after the holder
  releases.
- A pack takes the directive's current revision at each attempt (brief: renders from the state at that moment).
- Pack status is not carried on the event stream. The Packs table polls `GET /api/packs` every 5 seconds and replaces only the table when the answer changes.
- A legacy signature's time is 00:00 Europe/London on its spreadsheet date.
- Erasure while MinIO is down still succeeds: the pack rows are anonymised at once and the objects are re-stored
  under new keys when storage returns (brief: every other action keeps working).
- Countersigning withdraws the thread's still-queued countersignature request.
- A live refresh of an open drawer replaces only the sections whose content changed, so an unchanged control
  stays the same element in the same place under the pointer (decided: brief, Drawer, controls never move during a
  colleague's update; Night shift journey, both inspectors press at once).
- "Claim work card" shows only while no one holds the card; once anyone holds it, the Work card section names the
  holder instead (brief: Interactions, DP-62). When a live refresh removes the focused control, focus goes to the
  drawer heading "Thread <registration> <directive>" (`tabindex="-1"`); a control that survives keeps focus and
  caret (brief: Interactions, DP-61 and DP-62).
- Every drawer action refetches the drawer in place after its answer, a refusal included, and shows the published
  refusal copy: "You no longer hold this work card." for `not_holder` and "<directive> is withdrawn." for
  `directive_withdrawn` (brief: Copy by action).
- An evidence row reads content type, the exact size as "<n> bytes" and the sha256 (brief: Screens, work card).
- Typed titles and methods, and every imported field, are stored exactly as they arrive (brief: Regulator CSV,
  Neutralisation). A blank title or method is still refused. Import rows are judged as written: status in any case,
  revision with spaces removed, dates in the two published forms, and a rejection names the first failing field
  in the order status, revision, inspected_on, certified_on, notes (brief: Legacy import).

## Media and licences
Fonts: IBM Plex Sans, Sans Condensed and Mono from Fontsource 5.3.0 (OFL-1.1). Glyphs, icons, hatching and the
favicon are original SVG. No raster images, audio or video.

## Disputes
- DP-60 pending-copy case (brief lines 188, 261, 323): the verifier's `page.unroute()` before `route.fulfill()`
  releases the held ingest to the server a second time under Playwright 1.49.1/Chromium, and the brief's answer to
  a repeated ingest is 409 `directive_exists`. Ingest is not a keyed endpoint, so the app keeps the brief's behaviour.


## Settled on 4 Nov 2026 (path-id tests)

- The DP-60 `refresh_keeps_work[pending-copy]` dispute is settled in the test: it now fulfils the held request before it removes the route.
- A control byte in a path id answers 404 `not_found` (brief line 316, precedence step 5). `dispatch` checks it after the idempotency-key checks, so it never reaches Postgres.
- Audit counts follow the brief: a kept thread earns no entry, and a background pack transmission carries the system actor "Tailboard" (`audit.actor_id` NULL), with `requested_by` left as the clerk.
- An erasure writes one entry for the erasure plus one per thread whose card the person held (brief, Audit: How many entries).
