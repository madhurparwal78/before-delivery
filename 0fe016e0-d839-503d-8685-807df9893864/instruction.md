# Rungmark Rollout Ladder

Rungmark Rollout Ladder moves firmware capability flags for an invented fleet of medical devices through five cohorts, one rung at a time, and keeps the evidence for every rung. Firmware operators use its rollout console to:
- promote, force-enable and roll back rungs, and promote a rung again later;
- record adverse events;
- change the live gate settings.

Readers use its read-only pages to check what has been published. Build the whole application, front end and back end, in Go, and serve it on port 4173. Its only backing service is a PostgreSQL database. Leave out accounts, logins, email, file uploads and any other datastore. The app never talks to real devices: a promotion records a decision. It does not push firmware.

## Problem and users

A firmware team ships capability flags to its fleet one cohort at a time: first a bench fleet, then a clinical pilot, a regional cohort, a national cohort and the full fleet. Before the next rung opens, three things must hold:
- the current rung has soaked for long enough;
- the current rung's adverse event rate is at or below the flag's maximum;
- the new rung has a signed bench attestation reference that has never covered another rung.

The console also has a force-enable control that skips the attestation step. It answers cleanly and the rung looks enabled, but that rung's evidence is missing, and the evidence pack has to say so.

The team works under pressure:
- Complaint reports often arrive twice.
- Clinic networks drop requests partway through.
- Two operators sometimes act on the same flag at the same moment.
- Spreadsheets act on whatever an operator typed into a reference field.
- A rung that was rolled back is later restored, and its old history must stay true.
- A tightened setting that demoted rungs is often relaxed again, and that must not quietly bring those rungs back.

The product has to stay exact through all of this.

- A **reader** is anonymous and sees only published records: the flags, cohorts, devices, promotions, adverse events and evidence packs, each on its own read-only page.
- An **operator** works from the rollout console. There they promote, force-enable, roll back and re-promote rungs, record adverse events, and change a flag's maximum adverse rate or a cohort's minimum soak. No reader route shows an operator control.

## Journeys

Each journey has an ID. The server keeps a trace of each journey, as described in Business rules.

1. **WF-01: a ladder climbs one rung at a time under the three gates.**
   - **Start:** the seed. The predictive occlusion alert flag has no active rung.
   - **Actions:**
     1. The operator tries to promote the alert flag straight to the regional cohort and sees the DP-01 refusal, which names rung 1.
     2. They paste a bench attestation reference longer than the limit shown beside the field. The field keeps the whole pasted text, the console sends it, and they get the attestation field error, which comes before any gate is considered.
     3. They fix the reference, accidentally pad it with spaces, and promote to the bench fleet. The reference is stored without the spaces.
     4. They try the clinical pilot at once and see the DP-02 refusal, which names the elapsed, minimum and remaining minutes from the server clock.
     5. In Settings, they set the bench fleet's minimum soak to exactly the elapsed minutes that refusal named and promote to the clinical pilot again. It passes, because the minimum itself is allowed.
     6. They read the evidence pack.
   - **End state:**
     - The jump was refused, and the over-long reference changed nothing.
     - Rung 1 reads `Active` and rung 2 reads `Soaking`, and both show `Attested` with their trimmed references.
     - The evidence pack lists no gap for the alert flag.
2. **WF-02: the force-enable control leaves an evidence gap, and the losing console shows the winner's state at once.**
   - **Start:** the seed. The adaptive flag is active only at rung 1.
   - **Actions:**
     1. The operator force-enables the adaptive flag at the regional cohort. It is refused with DP-01, which names rung 2.
     2. In Settings, they raise the adaptive flag's maximum adverse rate to 1000 basis points so that the bench fleet's rate passes.
     3. They and a colleague on a second console press `Force enable` for the adaptive flag at the clinical pilot at the same moment.
   - **End state:**
     - Exactly one force enable is recorded: one new promotion at rung 2 with no attestation reference and the next promotion code.
     - The losing console shows the already-active field error. Within 2 seconds, without waiting for its regular reload, it also shows rung 2 reading `Gap` and the evidence pack listing rung 2 as a gap. Focus stays on its `Force enable` button.
     - The evidence pack lists rung 2 as a gap exactly once.
3. **WF-03: a rollback returns one rung and keeps the record, and a re-promotion is a fresh row that keeps the rung's past rate.**
   - **Start:** the seed. The telemetry flag's highest active rung is 2.
   - **Actions:**
     1. The operator presses `Roll back` on the telemetry flag over a flaky clinic network. The request reaches the server but the answer is lost, so the console resends the same press.
     2. They restore the clinical pilot rung with the old reference and get the already-used field error.
     3. They restore it again with a fresh reference.
     4. They try the regional cohort at once and see the DP-02 refusal, because the restored rung's soak has restarted.
     5. They read the flag and its promotion history.
   - **End state:**
     - The resent press replayed the first rollback, so exactly one rung was demoted.
     - The demoted row is kept unchanged with its demotion instant.
     - The restore is a separate new row with the next code.
     - Rung 2 reads `Soaking` and `Attested`. Its event count still includes the seeded event from the earlier interval, so its rate is unchanged.
4. **WF-04: a rate breach at a low rung demotes everything above it, every surface agrees on the counts, and raising the maximum again restores nothing.**
   - **Start:** the seed.
   - **Actions:**
     1. The operator sets the regional cohort's minimum soak to 0 minutes and promotes the telemetry flag to rungs 3 and 4 with fresh references.
     2. They lower the telemetry maximum to 100 basis points. The clinical pilot sits at 83 basis points, so nothing is demoted.
     3. They record a new adverse event on a clinical pilot device.
     4. They submit the same complaint again, with the code in lower case and stray spaces. It is refused as already recorded.
     5. They read the flag and its promotion history.
     6. They raise the maximum back to 300 basis points.
     7. They promote rung 3 again with a fresh reference.
   - **End state:**
     - The clinical pilot counts the new event once, at 166 basis points.
     - The first rung 3 row and the rung 4 row are `Demoted`, rung 4 first, each with its own instant, and both instants survive the raise unchanged.
     - The rung card, the flag detail, the evidence pack, `adverse-rates.txt` and the reader adverse event total all agree.
     - Only the new promotion brought rung 3 back.

## Mandatory requirements

This is the complete list of mandatory requirements; every check traces to one of these lines and the detailed sections below.

- **DP-01 — Contiguous ladder** Promote a cohort for a flag only when every rung below it carries an active promotion for the same flag (rung 1 needs none), and of simultaneous promotions or force enables of one flag to one rung let exactly one succeed while the rest receive the published already-active field error, so a flag's active rungs never skip or repeat a rung.
- **DP-02 — Inclusive soak gate** Promote only when the rung below has soaked at least its minimum soak minutes, with exactly the minimum allowed, measured on the server clock from that rung's current active promotion, and name the elapsed, minimum and remaining minutes in every soak refusal.
- **DP-03 — Rate gate** Promote only when the adverse rate of the rung below, in whole basis points of events per device, sits at or below the flag's maximum adverse rate.
- **DP-04 — Attestation gate** Promote only with a signed bench attestation reference that is trimmed, within its published length and character limits and never used by any promotion row before, active or demoted, with limit and reuse failures answered before any gate refusal, as qualified in API and Business rules.
- **DP-05 — One-rung rollback and fresh restore** A rollback demotes only the flag's highest active rung and keeps that row with its demotion instant, a retry carrying the same idempotency key replays the first response instead of demoting again, and restoring a rolled-back rung is always a new promotion row with the next code, a fresh reference and a restarted soak, as qualified in Business rules.
- **DP-06 — Breach cascade** When a rung's adverse rate exceeds the flag maximum, demote every active rung above it, highest first, each exactly once with its own instant even when events arrive together, while the breaching rung itself stays active and no later reassessment moves a recorded instant.
- **DP-07 — Evidence gaps** The evidence pack lists as a gap, once each, every active rung without a complete soak, rate and attestation record below it, and a console whose promotion, force enable or rollback is refused shows the server's current ladder and evidence pack within 2 seconds without waiting for its regular reload.
- **DP-08 — Scoped adverse rate** A rung's adverse rate counts each normalised event code once, and only events of that flag on that cohort's devices that occurred inside any interval while the flag was active there, past intervals included, as qualified in Business rules.
- **DP-09 — Ladder state export** Produce `ladder-state.csv` on demand with one row per flag and rung pair, byte for byte in the columns, order, quoting, formula neutralisation and line endings given in Exports, neutralising in that file only.
- **DP-10 — Evidence pack export** Produce `evidence-pack.json` on demand, byte for byte in the shape, order and layout given in Exports, with every empty list written as an empty array.
- **DP-11 — Adverse rates export** Produce `adverse-rates.txt` on demand, byte for byte with one line per flag and cohort in the format and order given in Exports.
- **DP-12 — Live rate maximum** Every gate, figure and export re-reads a flag's maximum adverse rate from live state, so a saved whole number within its published range triggers the breach cascade at once, raising it never restores a demoted rung, and a refused change alters and triggers nothing.
- **DP-13 — Live soak minimum** Every gate, figure and export re-reads a cohort's minimum soak from live state, so a saved whole number within its published range governs the next promotion, lowering it never restores a demoted rung, and a refused change alters and triggers nothing.
- **DP-14 — Legible evidence** Every figure on a rung card sits beside the evidence it was derived from with its unit, every state word is printed beside any colour used for it, and every refusal reads beside the control that was used.
- **DP-15 — Keyboard and narrow windows** Every page works by keyboard alone at 375x812, 768x1024 and 1280x800 without horizontal scrolling, in the published tab order, and nothing depends on a hover a keyboard cannot reproduce.
- **DP-16 — Runtime contract** Serve the pages and the JSON API from one Go process on one origin, answer `GET /api/health` with 200 once ready, answer every list route with a top-level array, accept on every write route only the fields of its published request shape while listing every failing field at once, and load the seed exactly once so a restart neither re-seeds nor duplicates a row.
- **DP-17 — Read-time derivation and agreement** Compute every derived figure and state word at read time from the records it cites, store none as a column, make every surface that shows a count, rate or state agree, and let a refused request change no record and consume no promotion code.
- **DP-18 — Reader and operator separation** Reader pages show only published records rendered from live state, and no reader route ever exposes an operator control.

## Frontend

### Screens and layout (DP-14, DP-15, DP-18)

- **Reader home** at `/` shows the product name and links to the six reader pages and to the console.
- **Reader pages** are at `/capability_flag`, `/cohort`, `/device`, `/promotion`, `/adverse_event` and `/evidence_pack`.
  - Each page has one heading, the line `<total> records` and a table of that entity's records with the Data model fields as columns.
  - `<total>` is the number of records the matching list route returns at the moment the page is requested.
  - The server builds the table and the total into the HTML it sends, from live state on every request, so both are present without running scripts and are never cached from an earlier moment.
  - Reader pages have no operator controls.
- **Rollout console** at `/console` holds, in this order:
  1. one region per flag, in seed order, each with its five-rung ladder and its promotion controls;
  2. the adverse event form;
  3. the Settings region;
  4. the evidence pack;
  5. the promotion history.
- **Layout by viewport:**
  - At 1280x800 the three flag regions sit side by side above the form, Settings, evidence pack and history.
  - At 768x1024 the flag regions stack in one column.
  - At 375x812 every rung is a full-width stacked card, and the evidence pack and history tables scroll sideways inside their own frame.
  - No viewport scrolls the page sideways.

**Rung cards.** Each card shows the following, as plain text. An absent value reads `none`.
- `Rung <rung_index_count> · <cohort_label>`
- the state word, followed by `Attested` when the rung is attested
- `Promoted at minute <promoted_at_minutes>`, plus `demoted at minute <demoted_at_minutes>` when the latest promotion is demoted
- `Soak <soak_elapsed_minutes> minutes of <min_soak_minutes> minutes`
- `Rate <rate_bp> basis points from <event_count> events on <device_count> devices, maximum <max_adverse_rate_bp> basis points`
- `Attestation <attestation_reference>`

Every placeholder is the field of the same name in the rung detail from API.

**When console figures update.** The console never works out a figure itself. It shows what the flag detail, evidence pack and promotion list routes last returned, and it reloads them:
- after every response to one of its own actions, success or refusal, as described in Interactions;
- on a regular reload every 10 seconds, so changes made from a second console appear within 10 seconds.

### Public screens and controls (DP-14, DP-15, DP-18)

| Role and accessible name | Where | Visible copy and purpose |
|---|---|---|
| `link "Rollout console"` | reader home | opens `/console` |
| `region "<flag_label>"` | console | one per flag, for example `region "Extended telemetry upload"` |
| `list "Ladder"` | inside each flag region | five `listitem` rung cards, ordered by rung index |
| `combobox "Target cohort"` | inside each flag region | the five cohorts, by label |
| `textbox "Attestation reference"` | inside each flag region | the helper text `Up to 64 characters` sits directly beneath it and is its accessible description; the field itself holds everything typed or pasted, of any length, and never cuts it short |
| `button "Promote"` | inside each flag region | standard promotion to the target cohort |
| `button "Force enable"` | inside each flag region | force-enable control for the target cohort |
| `button "Roll back"` | inside each flag region | rolls the flag back one rung |
| `alert` | inside each flag region, next to its buttons | refusal, field error and outage copy for that flag's actions |
| `form "Record adverse event"` | console | holds the five fields below, its button and its own `alert` |
| `textbox "Event code"` | adverse event form | helper text `Up to 32 letters, digits or hyphens` beneath it |
| `combobox "Device"`, `combobox "Flag"`, `combobox "Severity band"`, `spinbutton "Occurred at (minutes)"` | adverse event form | the other event fields |
| `button "Record adverse event"` | adverse event form | records the event |
| `region "Settings"` | console | holds the editors below and its own `alert` |
| `group "<flag_label>"` holding `spinbutton "Maximum adverse rate (basis points)"` and `button "Save maximum"` | Settings, one per flag | announces a minimum of 0 and a maximum of 10000; helper text `0 to 10000 basis points` beside it |
| `group "<cohort_label>"` holding `spinbutton "Minimum soak (minutes)"` and `button "Save soak"` | Settings, one per cohort | announces a minimum of 0 and a maximum of 525600; helper text `0 to 525600 minutes` beside it |
| `region "Evidence pack"` holding `table "Evidence pack"` | console | columns `Flag`, `Highest rung`, `Gap rungs`, `Soak satisfied rungs`, `Rate satisfied rungs`, with one row per flag in seed order; each list cell holds its rung numbers ascending, separated by a comma and a space, or reads `none` when the list is empty |
| `table "Promotion history"` | console | every promotion row, demoted rows included, in the order of the unfiltered promotion list route |
| `status "Console status"` | console | announces each successful action |

**Rung state words.** Each rung has exactly one state word. It is the first of these, in this order, whose condition holds:

| Order | Word | Condition |
|---|---|---|
| 1 | `Not promoted` | the flag and cohort pair has no promotion row at all |
| 2 | `Demoted` | the pair's latest promotion carries a demotion instant |
| 3 | `Gap` | the latest promotion is active and its record below is incomplete (DP-07) |
| 4 | `Soaking` | the latest promotion is active and its own soak elapsed is below its cohort's minimum soak |
| 5 | `Active` | the latest promotion is active and none of the above holds |

`Attested` appears after the state word exactly when the rung detail's `attested` is `true`.

### Interactions (DP-01 to DP-07, DP-12, DP-13, DP-15)

- **The server decides every limit.** Helper text and announced ranges tell the operator the limits, but the console never trims, cuts short, blocks or rejects a value on its own. Every press sends exactly what is in its fields, and any limit failure comes back as the server's field error.
- **Promote.** The operator chooses a target cohort, types or pastes a reference and presses `Promote`.
- **Force enable.** The operator chooses a target cohort and presses `Force enable`.
- **Roll back.** The operator presses `Roll back`.
- **While a press is pending:**
  - Its button reads the pending copy and is disabled.
  - Every rung card keeps its previous state word and figures. The console never changes a rung, the evidence pack or the history before the server answers.
- **On a success response:**
  1. `Console status` announces the success copy.
  2. The console reloads that flag's detail, the evidence pack and the promotion history, and shows them.
- **On a `409` or `422` response:**
  1. The flag's `alert` shows the refusal or field error copy.
  2. The typed reference stays in its field.
  3. The console reloads that flag's detail, the evidence pack and the promotion history at once, without waiting for the regular 10-second reload. The rung cards, the evidence pack row and the history match the server within 2 seconds of the response.
  4. The alert keeps its copy while this happens.

  So a console that lost a simultaneous press shows the winner's rung, for example `Gap`, straight away.
- **Record adverse event.** The operator fills the form and presses `Record adverse event`. The console then reloads every flag's detail and the evidence pack, so rates, states and any breach cascade appear on the same page.
  - After a success, the event code field clears.
  - After a field error, it keeps its text.
- **Save maximum and Save soak.** Each sends only the one number in its field. After any response, every flag's detail and the evidence pack are reloaded.
- **Retries.**
  - Every press of `Promote`, `Force enable` or `Roll back` sends a fresh idempotency key.
  - If that request gets no response at all, the console resends it once with the same key and the same body.
  - A second press is a new request with a new key.
- **Keyboard and touch.**
  - Every control is a native, labelled control.
  - Tab follows reading order: the flag regions in seed order, each in the order target cohort, reference, `Promote`, `Force enable`, `Roll back`; then the adverse event form; then Settings; then the evidence pack; then the history.
  - Enter or Space activates the focused button. Enter in a text field submits that field's own action.
  - After any response, focus stays on the button that was pressed.
  - Nothing appears only on hover, and every control works the same by touch.

### Visual design (DP-14)

- **Mood.** A calm, dense operations console. The page is a light neutral grey-white and the text is near-black. All text and controls meet WCAG 2.2 AA contrast.
- **Colours and what they mean:**
  - One strong deep blue marks the primary action, `Promote`.
  - `Force enable` has a muted amber edge on a pale fill, so it never looks like the safe default.
  - A warning amber marks `Gap`, refusals and field errors.
  - A muted grey marks `Demoted`.
  - A quiet green marks `Active`.
  - A pale blue marks `Soaking`.

  Each colour always appears beside its state word or message and never replaces it.
- **Type.**
  - Figures use digits of equal width, so that columns of minutes and basis points line up.
  - Page headings are clearly heavier than body text and about one and a half times its size. Region headings are slightly larger than body text.
  - Helper text is a little smaller than body text and still meets AA contrast.
- **Density.**
  - Rows are compact.
  - At the widest viewport, each rung card fits its figures on three or four short lines.
  - The evidence pack and history use tight table rows with light dividers.
- **Controls.** Every button and field is at least 44 pixels tall and comfortable to tap.

### Motion and effects (DP-15)

The console uses no decorative motion and no repeating or looping effect of any kind.
- **Press feedback.** A held button darkens at once and returns to its colour on release.
- **State change.** A changed state word, a new history row and an alert all appear in place at once, with no animation.
- **Signature interaction.** After a confirmed promotion, the affected rung card changes its state word and figures in place, and the new row appears at its sorted position in `Promotion history`, both in the same moment that `Console status` announces the success. The page never moves the operator's place on the page.
- **Reduced motion.** With reduced motion requested, the experience is identical, because there is no motion to replace.

### Feedback states (DP-01 to DP-07, DP-12, DP-13, DP-14)

**Refusals.** Refusal copy is shown in the flag's `alert` and is returned as the API `error`.
- `<r>` is the target rung index, and `<below>` is `<r>` minus one.
- All figures come from one reading of live state inside the refusing request.

| Rule | Copy |
|---|---|
| DP-01 | `Refused: rung <r> needs an active promotion at rung <missing> first (DP-01).`, where `<missing>` is the lowest rung under `<r>` without an active promotion |
| DP-02 | `Refused: rung <below> has soaked <elapsed> minutes of <minimum> minutes; <remaining> minutes remain (DP-02).` |
| DP-03 | `Refused: rung <below> adverse rate is <rate> basis points, above the maximum of <maximum> basis points (DP-03).` |
| DP-04 | `Refused: an attestation reference is required for rung <r> (DP-04).` |
| DP-05 | `Refused: <flag_label> has no active rung to roll back (DP-05).` |

**Field errors.** A `422` response is shown in the `alert` of the flag region, the form or the Settings region where the action started. The alert reads `Not accepted:` followed by one line per entry in the response's `errors` object, sorted by field name. Each line reads `<field>: <message>`, with the message from API.

**Success copy** in `Console status`:
- `Promoted <flag_label> to rung <r>.`
- `Force enabled <flag_label> at rung <r>.`
- `Rolled back <flag_label> to rung <r>.`, where `<r>` is the flag's new highest active rung, which is 0 after rung 1 is rolled back
- `Recorded adverse event <event_code>.`, where `<event_code>` is the stored, normalised code
- `Saved.`

**Pending.** While a request is in flight, including its one automatic resend, its button is disabled and reads `Working…`.

**Outage.** If the server answers `503`, or the automatic resend also gets no response, the relevant `alert` reads `The rollout store did not answer. Check the promotion history before trying again.`

## Backend

### API (DP-04, DP-09 to DP-13, DP-16, DP-17)

**Content type and size.**
- All `/api/*` routes speak JSON.
- Write routes require `Content-Type: application/json` and otherwise answer `415 {"error": "..."}`.
- A write body may be up to and including 16384 bytes. A larger body answers `413 {"error": "..."}`.

**Error precedence.** One order applies to the whole API:
1. `415`, then `413`.
2. The idempotency key's format, then an idempotent replay or a key mismatch (Business rules). A replay returns its stored response before any later step.
3. An unknown code in the path: `404 {"error": "..."}`.
4. Field validation: `422 {"errors": {"<field>": "<message>", ...}}`, listing every failing field at once, with one message per field.
5. Rule refusals: `409 {"error": "<refusal copy>", "rule": "DP-0x", ...}`. The gates are checked in the order DP-01, DP-02, DP-03, DP-04, and only the first failing rule is reported.

A request answered with any error changes no record, consumes no promotion code and records no journey step.

**Request shapes.**
- Every write body must be a JSON object containing only the fields in its row below. Each other field is a `422` entry under its own name.
- Fields marked required must be present and not `null`.
- A whole number is a JSON number written with no fraction part and no exponent. These are not whole numbers: a string, a boolean, `null`, `50.5`, `50.0` and `5e1`.

| Method and path | Request | Success |
|---|---|---|
| `GET /api/health` | | `200 {"status": "ok"}` once the database is reachable, the schema exists and the seed is in place |
| `GET /api/capability_flag`, `/api/cohort`, `/api/device`, `/api/adverse_event` | | `200`, a top-level array of records with the Data model fields, sorted by code ascending |
| `GET /api/promotion` | | `200`, every promotion row, sorted by sequence number ascending |
| `GET /api/promotion?flag_code=<flag_code>` | | `200`, that flag's history with demoted rows included, sorted by `promoted_at_minutes` ascending, with ties broken by sequence number ascending |
| `GET /api/evidence_pack` | | `200`, one record per flag sorted by `flag_code`: `{"pack_code", "flag_code", "highest_rung_index_count", "gap_rung_index_counts", "soak_satisfied_rung_index_counts", "rate_satisfied_rung_index_counts"}` |
| `GET /api/<entity>/summary` for each of the six entities | | `200 {"total": <total>}`, where `<total>` is the length of that entity's list |
| `GET /api/capability_flag/<flag_code>` | | `200`, the flag detail described below |
| `PATCH /api/capability_flag/<flag_code>` | `{"max_adverse_rate_bp"}`, required, a whole number from 0 to 10000 inclusive | `200`, the updated flag record |
| `PATCH /api/cohort/<cohort_code>` | `{"min_soak_minutes"}`, required, a whole number from 0 to 525600 inclusive | `200`, the updated cohort record |
| `POST /api/promotion` | `{"flag_code", "cohort_code", "attestation_reference"}`; the first two are required, and the reference may be absent, `null` or a string | `201`, the new promotion row |
| `POST /api/promotion/force-enable` | `{"flag_code", "cohort_code"}`, both required | `201`, the new promotion row |
| `POST /api/promotion/rollback` | `{"flag_code"}`, required | `200`, the demoted promotion row |
| `POST /api/adverse_event` | `{"event_code", "device_code", "flag_code", "occurred_at_minutes", "severity_band_code"}`, all required | `201`, the new event as stored |
| `POST /api/DP-09/render`, `/api/DP-10/render`, `/api/DP-11/render` | `{"format"}`, optional text, ignored | `201 {"filename": "<deliverable>"}` after the file is written |
| `GET /api/DP-09/latest`, `/api/DP-10/latest`, `/api/DP-11/latest` | | `200 {"filename": "<deliverable>", "content": "<text of the file on disk>"}`; before the first render, `404 {"error": "not rendered yet"}` |
| `GET /api/WF-01/events` to `GET /api/WF-04/events` | | `200`, that journey's trace `[{"name": "WF-0n-k", "at_minutes": <int>}]` |

**Flag detail.** `GET /api/capability_flag/<flag_code>` returns:

`{"flag_code", "flag_label", "risk_class_code", "max_adverse_rate_bp", "highest_rung_index_count", "rungs": [ ... ]}`

`rungs` holds exactly five entries, ordered by `rung_index_count`. Each entry has the following fields, with `null` where a value is absent:

| Field | Value |
|---|---|
| `rung_index_count`, `cohort_code`, `cohort_label`, `min_soak_minutes`, `device_count` | from the cohort |
| `state` | the rung state word |
| `attested` | `true` exactly when `state` is `Active` or `Soaking` and the latest promotion carries a reference |
| `promotion_code`, `promoted_at_minutes`, `demoted_at_minutes`, `attestation_reference` | from the pair's latest promotion, or `null` when there is none |
| `soak_elapsed_minutes` | now minus that promotion's `promoted_at_minutes` when it is active, otherwise `null` |
| `event_count`, `rate_bp` | the pair's adverse figures, 0 when nothing counts |
| `max_adverse_rate_bp` | the flag's current maximum |

The pair's **latest promotion** is the one with the largest `promoted_at_minutes`, with ties broken by the larger sequence number.

**Field messages.** When one field fails several checks, report the first that fails, in the order listed here.

| Field | Messages, in check order |
|---|---|
| any field not in the route's request shape | `is not an accepted field` |
| `body` (the body is not a JSON object) | `must be a JSON object` |
| any required field that is missing or `null` | `is required` |
| `flag_code` | `is not a known flag` |
| `cohort_code` | `is not a known cohort`, then `rung <r> is already active` when the flag already has an active promotion at that cohort's rung index `<r>` (both promotion routes) |
| `device_code` | `is not a known device` |
| `attestation_reference` | `must be 1 to 64 printable characters`, then `has already been used` |
| `event_code` | `must be 1 to 32 letters, digits or hyphens`, then `has already been recorded` |
| `occurred_at_minutes` | `must be a whole number of minutes`, then `cannot be in the future` |
| `severity_band_code` | `must be BAND-LOW, BAND-MED or BAND-HIGH` |
| `max_adverse_rate_bp` | `must be a whole number from 0 to 10000` |
| `min_soak_minutes` | `must be a whole number from 0 to 525600` |
| `format` | `must be text` |
| `idempotency_key` | `must be 1 to 64 letters, digits, hyphens or underscores`, or `was used with a different request` |

**Refusal bodies** add the figures that their copy names, each as a whole number:
- DP-01: `missing_rung_index_count`.
- DP-02: `elapsed_minutes`, `minimum_minutes` and `remaining_minutes`.
- DP-03: `rate_bp` and `max_adverse_rate_bp`.

**Promotion rows** have the shape `{"promotion_code", "flag_code", "cohort_code", "promoted_at_minutes", "demoted_at_minutes", "attestation_reference"}`, with `null` where a value is absent.

### Business rules (DP-01 to DP-08, DP-12, DP-13, DP-17)

**Clock.** Every instant is a whole number of minutes since 1970-01-01 00:00 UTC on the server clock. "Now" is the current such minute. A promotion's `promoted_at_minutes` is the minute it was made.

**Active.** A promotion is active while its `demoted_at_minutes` is `null`. A flag's highest active rung is the largest `rung_index_count` among its active promotions, or 0 when it has none.

**Attestation reference (DP-04).**
- Before any check, the reference is trimmed of leading and trailing spaces, tabs, carriage returns and line feeds. It is stored trimmed.
- If it is absent, `null` or empty after trimming, that is the DP-04 refusal. It is a `409`, checked after DP-01 to DP-03.
- Otherwise the trimmed value must be 1 to 64 characters, counted as characters, with 64 itself allowed. Every character must be printable ASCII, from the space character to the tilde. An accented letter or an emoji fails.
- A trimmed value that equals, case-sensitively, the reference of any existing promotion row fails as already used. This covers every flag, and active and demoted rows alike. A signed bench attestation covers exactly one rung, once.
- Both failures are `422` field errors. A 65-character reference sent to a rung that also fails DP-01 therefore answers `422`.

**Gates (DP-01 to DP-04).** Promoting flag F to the cohort at rung r requires, in this order:
1. **DP-01:** an active promotion of F at every rung below r.
2. **DP-02, for r above 1:** now minus the `promoted_at_minutes` of the rung below's active promotion is at least the rung below's `min_soak_minutes`. Exactly the minimum passes.
   - An earlier demoted row of the rung below is never the starting point.
   - In a refusal, `remaining_minutes` is the minimum minus the elapsed minutes, so it is always at least 1.
3. **DP-03, for r above 1:** the rung below's `rate_bp` is at most F's `max_adverse_rate_bp`.
4. **DP-04:** a reference.

Promoting a rung that is already active is the `cohort_code` `422`.

**Force enable.**
- A force enable goes through the same gate with DP-04, and only DP-04, skipped. DP-01, DP-02 and DP-03 apply in the same order, and the first failure is refused with its `409`.
- When those three checks pass, the server records an active promotion with a `null` reference. That rung is then a gap (DP-07).
- For example, with the seed data at start, a force enable of the adaptive flag at the regional cohort is refused with DP-01 naming rung 2.

**Concurrency (DP-01, DP-06, DP-17).**
- **One serialised step per flag.** For each flag, one serialised step reads the clock, runs every state-dependent check (already active, already used, already recorded, the gates), assigns the promotion code and writes. Promotions, force enables, rollbacks, adverse events and the reassessment after a settings change all run inside it.
- **Promotions to one rung.** Of N simultaneous promotions or force enables of one flag to one rung, exactly one answers `201`. Every other request answers the already-active `422`, never a `5xx`.
- **Adverse events with one code.** Of N simultaneous adverse events with one normalised code, exactly one answers `201`. The rest answer the already-recorded `422`.
- **Speed under load.** No simultaneous mix of requests ever answers `5xx`, and each write answers within 2 seconds even under 12 simultaneous requests.

**Promotion codes.**
- Each new promotion gets the code `PRM-` followed by its sequence number, written with at least two digits. The seed holds `PRM-01` to `PRM-03`.
- Sequence numbers come from one counter shared by every flag. They are assigned in commit order, and they are unique and consecutive with no number ever skipped. This holds even when simultaneous requests across several flags mix successes with refusals and failures.
- A refused or failed request consumes no number.
- Orderings compare the number as a number.

**Idempotency (DP-05).** `POST /api/promotion`, `POST /api/promotion/force-enable` and `POST /api/promotion/rollback` accept an optional `Idempotency-Key` header.
- **Key format.** 1 to 64 characters, each a letter, a digit, a hyphen or an underscore. Any other value is the `idempotency_key` format `422`.
- **What is stored.** Only `200` and `201` responses are stored, each under its key with its route and its parsed request body. Keys never expire. Every other response is not stored, so a key whose request was refused may succeed later once state changes.
- **Replay.** A request with a stored key, the same route and an equal parsed body returns the stored status and body unchanged, plus the response header `Idempotent-Replayed: true`.
  - "Equal" means the same JSON value, ignoring key order and whitespace. A body that is not valid JSON never equals a stored one.
  - A replay writes nothing: no promotion, no demotion, no instant, no code and no journey step.
  - A first response never carries the replay header.
- **Mismatch.** A request with a stored key and a different route or a different parsed body answers the mismatch `422`.
- **Simultaneous requests with one key** cause exactly one write, and all of them receive the same status and body.

**Adverse events (DP-08).**
- `event_code` is trimmed, as for references, and upper-cased before every check, and is stored that way. It must then be 1 to 32 characters from `A` to `Z`, `0` to `9` and the hyphen.
- A code equal to one already recorded fails as already recorded. The rate, the cascade and the journey trace then stay unchanged.
- `occurred_at_minutes` must be from 0 up to and including now.
- A back-dated event that falls inside a past active interval counts, and it can trigger the cascade.

**Adverse rate (DP-03, DP-08).**
- For flag F at cohort C, `event_count` counts the adverse events of F on devices whose `cohort_code` is C and whose `occurred_at_minutes` falls inside any interval in which F was active at C.
- An interval runs from `promoted_at_minutes` inclusive to `demoted_at_minutes` exclusive, or to now when the promotion is still active. An event exactly at a promotion instant counts, and an event exactly at a demotion instant does not.
- Every past interval of the pair counts as well as the current one, and an event inside more than one interval counts once.
- `rate_bp` is `event_count` times 10000, divided by C's `device_count` and rounded down. `device_count` is the cohort's stated fleet size, not the number of device rows.

**Rollback (DP-05).**
- A rollback sets `demoted_at_minutes` to now on the promotion at the flag's highest active rung.
- It never deletes a row and never demotes a lower rung.
- When rung 1 is the only active rung, the rollback succeeds the same way and the highest active rung becomes 0.
- A flag with no active rung is the DP-05 refusal.

**Restore after a rollback (DP-04, DP-05, DP-08).** A rung returns only through a fresh promotion or force enable. The new promotion:
- is a new row with the next code, a new `promoted_at_minutes` and a fresh reference;
- restarts the rung's soak from that new row;
- leaves the demoted row, its instant and its reference exactly as they were;
- keeps counting events from the rung's earlier intervals in the rate.

**Breach cascade (DP-06).**
- **When it runs.** After every recorded adverse event and every successful settings change, the server reassesses each affected flag. A cohort change affects every flag.
- **What it demotes.** If any active rung's rate exceeds the flag maximum, every active rung above the lowest such rung is demoted, highest first. The breaching rung itself stays active.
- **Instants.** The highest demoted rung takes the current minute, and each lower one takes the next minute after the one above it, so instants strictly increase as the rung index falls.
- **Recorded facts.** A demotion is a recorded fact, and no reassessment ever moves, clears or overwrites an existing demotion instant. Because reassessment runs inside the flag's serialised step, simultaneous events that together cause one breach demote each rung exactly once.

**Settings (DP-12, DP-13).**
- **Effect of a successful PATCH.**
  - It changes only its one field and applies from now on.
  - Raising a maximum or lowering a minimum soak never clears `demoted_at_minutes`, never creates a promotion, consumes no code and records no journey step. Demoted rungs stay `Demoted` until a fresh promotion.
  - The states, satisfied lists and gates of the remaining rungs follow the new value at once.
- **Same value again.** A PATCH that sends the current value answers `200` and runs the reassessment, which demotes nothing that is not already above a breaching rung.
- **Refused PATCH.** A PATCH answered with an error changes nothing and triggers no reassessment.

**Evidence pack (DP-07).**
- There is one pack per flag, and `pack_code` is `PACK-` followed by the flag code.
- `highest_rung_index_count` is the flag's highest active rung.
- **Complete record below.** For an active rung r, the record below is complete when r carries a reference and, for r above 1, the rung below is active, has soaked at least its minimum by now, and has a rate at or below the maximum.
- **The lists:**
  - `gap_rung_index_counts` lists, once each, the active rungs whose record below is incomplete.
  - `soak_satisfied_rung_index_counts` lists the active rungs whose own soak elapsed is at least their own minimum.
  - `rate_satisfied_rung_index_counts` lists the active rungs whose own rate is at or below the maximum.
  - Every list is ascending, and an empty list is `[]`.

**Derived figures and agreement (DP-17).**
- Highest rung, state words, gaps, satisfied lists, rates, counts and soak figures are computed at read time from the records they cite. None is stored as a column.
- Every surface reports the same numbers at the same moment: the rung card, the flag detail, the evidence pack, `adverse-rates.txt`, the reader page `<total> records` and the summary totals.

**Journey trace.**
- For each journey, the server keeps the steps of its latest run.
- Step 1 starts a new run. A later step is appended only when the previous step is the last one recorded.
- A `422` answer and an idempotent replay record no step.

| Step | Recorded when the server |
|---|---|
| `WF-01-1` and `WF-01-2` | refuses a standard promotion with DP-01 because its target is two or more rungs above the flag's highest active rung; that single refusal starts a new run with `WF-01-1` and appends `WF-01-2` at once |
| `WF-01-3` | makes a standard promotion one rung above the highest active rung |
| `WF-01-4` | serves `GET /api/evidence_pack` |
| `WF-02-1` | answers `POST /api/promotion/force-enable` with `201` or `409` |
| `WF-02-2` | serves `GET /api/capability_flag/<flag_code>` |
| `WF-02-3` | serves `GET /api/evidence_pack` |
| `WF-03-1` | answers `POST /api/promotion/rollback` with a first, non-replayed `200` |
| `WF-03-2` | serves `GET /api/capability_flag/<flag_code>` |
| `WF-03-3` | serves `GET /api/promotion?flag_code=<flag_code>` |
| `WF-04-1` | records an adverse event that moves the rate of the event's own rung (the event's flag at the cohort of the event's device) from at or below the flag maximum to above it; an event on a rung already above the maximum does not record it |
| `WF-04-2` | serves `GET /api/capability_flag/<flag_code>` |
| `WF-04-3` | serves `GET /api/promotion?flag_code=<flag_code>` |

**Never-states.** The store must never reach any of the following states. Each line names the requirement it breaks:
- `DP-01`: two active promotions of one flag at one rung, or an active rung whose rung below is not active and that is not listed as a gap.
- `DP-04`: an active promotion without a reference that is not listed as a gap.
- `DP-05`: a deleted promotion row.
- `DP-06`: an active rung above a breaching rung.

A `ledger_entry` table, with at least a text column `red_line`, records any write that did reach one of these states, naming the requirement in `red_line`. Because such writes are refused, the table stays empty.

### Exports (DP-09 to DP-11)

**Rendering.**
- Each render recomputes the file from live state. It writes the file into the root of the application's working directory, replacing the previous one.
- `GET /api/DP-0x/latest` returns exactly the bytes of that file.
- The shipped app contains none of the three files.

**`ladder-state.csv` (DP-09)**
- **Header row:** `flag_code,rung_index_count,cohort_code,active_flag,promoted_at_minutes,demoted_at_minutes,attestation_reference`.
- **Rows.** There is one row for every flag and rung pair, including rungs that were never promoted.
  - Each row describes the pair's latest promotion, as defined in API.
  - Rows are sorted by `flag_code`, then `rung_index_count`, both ascending.
  - `active_flag` is `true` when that promotion is active and `false` otherwise, including for a pair that was never promoted.
  - A field is the empty string where its value is absent.
- **Field writing.** Each field is written in two steps, in this order:
  1. A field that begins with `=`, `+`, `-`, `@`, a tab or a carriage return gets one single quote character in front.
  2. A field that now contains a comma, a double quote, a carriage return or a line feed is wrapped in double quotes, with every inner double quote doubled.

  For example, `=SUM(A1),x` is written as `"'=SUM(A1),x"`, and `@ATT-3` as `'@ATT-3`.
- **The single quote exists only in this file.** The database, the API, the console, the reader pages and the other two exports keep the raw value.
- **Line endings.** Every line ends with one line feed, and nothing follows the last one.

**`evidence-pack.json` (DP-10)**
- One line of compact JSON with no spaces: an array of `{"flag_code", "highest_rung_index_count", "gap_rung_index_counts", "soak_satisfied_rung_index_counts", "rate_satisfied_rung_index_counts"}`, with keys in that order.
- Entries are sorted by `flag_code` ascending.
- Empty lists are written `[]`, never `null`.
- The line ends with one line feed.

**`adverse-rates.txt` (DP-11)**
- One line per flag and cohort: `flag_code SPACE cohort_code SPACE event_count SPACE device_count SPACE rate_bp SPACE max_adverse_rate_bp`.
- Lines are sorted by `flag_code`, then `cohort_code`, both ascending.
- Every line ends with one line feed, and there is no blank last line.

**Starting files.** On a freshly seeded store, before any write, the three renders produce exactly the files below. Each one ends with a single line feed after its last line.

`ladder-state.csv`, 16 lines:

```
flag_code,rung_index_count,cohort_code,active_flag,promoted_at_minutes,demoted_at_minutes,attestation_reference
FLG-ADAPTIVE,1,COH-1,true,104000,,ATT-ADP-1
FLG-ADAPTIVE,2,COH-2,false,,,
FLG-ADAPTIVE,3,COH-3,false,,,
FLG-ADAPTIVE,4,COH-4,false,,,
FLG-ADAPTIVE,5,COH-5,false,,,
FLG-ALERT,1,COH-1,false,,,
FLG-ALERT,2,COH-2,false,,,
FLG-ALERT,3,COH-3,false,,,
FLG-ALERT,4,COH-4,false,,,
FLG-ALERT,5,COH-5,false,,,
FLG-TELEM,1,COH-1,true,100000,,ATT-TEL-1
FLG-TELEM,2,COH-2,true,111000,,ATT-TEL-2
FLG-TELEM,3,COH-3,false,,,
FLG-TELEM,4,COH-4,false,,,
FLG-TELEM,5,COH-5,false,,,
```

`evidence-pack.json`, one line:

```
[{"flag_code":"FLG-ADAPTIVE","highest_rung_index_count":1,"gap_rung_index_counts":[],"soak_satisfied_rung_index_counts":[1],"rate_satisfied_rung_index_counts":[]},{"flag_code":"FLG-ALERT","highest_rung_index_count":0,"gap_rung_index_counts":[],"soak_satisfied_rung_index_counts":[],"rate_satisfied_rung_index_counts":[]},{"flag_code":"FLG-TELEM","highest_rung_index_count":2,"gap_rung_index_counts":[],"soak_satisfied_rung_index_counts":[1,2],"rate_satisfied_rung_index_counts":[1,2]}]
```

`adverse-rates.txt`, 15 lines:

```
FLG-ADAPTIVE COH-1 1 20 500 40
FLG-ADAPTIVE COH-2 0 120 0 40
FLG-ADAPTIVE COH-3 0 900 0 40
FLG-ADAPTIVE COH-4 0 6400 0 40
FLG-ADAPTIVE COH-5 0 21000 0 40
FLG-ALERT COH-1 0 20 0 120
FLG-ALERT COH-2 0 120 0 120
FLG-ALERT COH-3 0 900 0 120
FLG-ALERT COH-4 0 6400 0 120
FLG-ALERT COH-5 0 21000 0 120
FLG-TELEM COH-1 0 20 0 300
FLG-TELEM COH-2 1 120 83 300
FLG-TELEM COH-3 0 900 0 300
FLG-TELEM COH-4 0 6400 0 300
FLG-TELEM COH-5 0 21000 0 300
```

### Data model (DP-16, DP-17)

Store each entity in a PostgreSQL table named exactly as below, with these column names:

- **`capability_flag`:** `flag_code` string; `flag_label` string; `risk_class_code` enum (`CLASS-I`, `CLASS-IIA`, `CLASS-IIB`); `max_adverse_rate_bp` integer.
- **`cohort`:** `cohort_code` string; `rung_index_count` integer; `cohort_label` string; `device_count` integer; `min_soak_minutes` integer.
- **`device`:** `device_code` string; `cohort_code` foreign key; `serial_reference` string; `firmware_version_label` string.
- **`promotion`:** `promotion_code` string; `flag_code` foreign key; `cohort_code` foreign key; `promoted_at_minutes` integer; `demoted_at_minutes` integer or null; `attestation_reference` string or null.
- **`adverse_event`:** `event_code` string, stored normalised; `device_code` foreign key; `flag_code` foreign key; `occurred_at_minutes` integer; `severity_band_code` enum (`BAND-LOW`, `BAND-MED`, `BAND-HIGH`).
- **`evidence_pack`:** `pack_code` string; `flag_code` foreign key. Its derived fields are computed when read and never stored.
- **`ledger_entry`:** as described under Never-states.

Idempotency records and the journey trace live in the same database, in tables of your choosing.

### Services (DP-16)

PostgreSQL is the only service. The app:
- connects with the URL in `DATABASE_URL`;
- creates any missing tables at every start;
- loads the seed exactly once, in one transaction, the first time it meets an empty store.

A restart against a store that already holds data never re-seeds, duplicates or resets a row. `GET /api/health` does not answer 200 until the database is reachable and the seed is in place.

### Seed data

Every flag, cohort, device, serial, reference and event below is invented.

| flag_code | flag_label | risk_class_code | max_adverse_rate_bp |
|---|---|---|---|
| FLG-ADAPTIVE | Adaptive dose titration | CLASS-IIB | 40 |
| FLG-TELEM | Extended telemetry upload | CLASS-I | 300 |
| FLG-ALERT | Predictive occlusion alert | CLASS-IIA | 120 |

Seed order, used by the console, is FLG-ADAPTIVE, FLG-TELEM, FLG-ALERT.

| cohort_code | rung_index_count | cohort_label | device_count | min_soak_minutes |
|---|---|---|---|---|
| COH-1 | 1 | Bench fleet | 20 | 4320 |
| COH-2 | 2 | Clinical pilot | 120 | 10080 |
| COH-3 | 3 | Regional cohort | 900 | 20160 |
| COH-4 | 4 | National cohort | 6400 | 30240 |
| COH-5 | 5 | Full fleet | 21000 | 43200 |

| device_code | cohort_code | serial_reference | firmware_version_label |
|---|---|---|---|
| DEV-0001 | COH-1 | SN-40001 | 4.2.1 |
| DEV-0002 | COH-1 | SN-40002 | 4.2.1 |
| DEV-0101 | COH-2 | SN-41001 | 4.2.1 |
| DEV-0102 | COH-2 | SN-41002 | 4.2.0 |
| DEV-0301 | COH-3 | SN-43001 | 4.2.1 |
| DEV-0401 | COH-4 | SN-44001 | 4.2.1 |

| promotion_code | flag_code | cohort_code | promoted_at_minutes | demoted_at_minutes | attestation_reference |
|---|---|---|---|---|---|
| PRM-01 | FLG-TELEM | COH-1 | 100000 | null | ATT-TEL-1 |
| PRM-02 | FLG-TELEM | COH-2 | 111000 | null | ATT-TEL-2 |
| PRM-03 | FLG-ADAPTIVE | COH-1 | 104000 | null | ATT-ADP-1 |

| event_code | device_code | flag_code | occurred_at_minutes | severity_band_code |
|---|---|---|---|---|
| AEV-01 | DEV-0101 | FLG-TELEM | 115000 | BAND-LOW |
| AEV-02 | DEV-0002 | FLG-ADAPTIVE | 108000 | BAND-MED |

For example, with the seed data at start:
- The summary totals are 3 flags, 5 cohorts, 6 devices, 3 promotions, 2 adverse events and 3 evidence packs, and the next promotion code is `PRM-04`.
- The telemetry flag's rungs read `Active`, `Active`, `Not promoted`, `Not promoted`, `Not promoted`, and rungs 1 and 2 are attested.
- The telemetry clinical pilot has 1 event on 120 devices, a rate of 83 basis points.
- The adaptive bench fleet has a rate of 500 basis points, above its maximum, but it has no rung above it to demote.

## Technical requirements

### Deployment (DP-16)

Go is available. Put the source under `/app`, and add `/app/run.json` holding string `install`, `build` and `serve` commands and the schema marker, for example:

```json
{"_schema":"run-manifest-v1","install":"go mod download","build":"go build -o server .","serve":"./server"}
```

The server:
- binds `0.0.0.0` on port 4173, or on `APP_PUBLIC_PORT` when that is set;
- stays in the foreground;
- answers `GET /api/health` with HTTP 200 JSON `{"status":"ok"}` once it is ready.

### Configuration and secrets (DP-16)

Read the database URL from `DATABASE_URL` at start. Never hard-code credentials, never log them, and never send them to the browser.

### Server boundary (DP-16, DP-18)

- Pages and API share one origin, and the browser contacts nothing else.
- The server never serves source files, the run manifest, the module files or credentials.
- The body limit and content type from API apply to every write route.
- If the database is unreachable at boot, the server keeps retrying and answers `GET /api/health` with `503 {"status": "unavailable"}` until it connects.
- If the database becomes unreachable while a request is being handled, that request answers `503 {"error": "database unavailable"}`, and nothing is stored under its idempotency key.
- No response ever contains a stack trace or database error text.

### Browser support and performance (DP-15)

The app supports current Chromium at 375x812 with touch, 768x1024 and 1280x800. Every page is usable within two seconds of opening it locally.

## Working rules

- IF-01: Every duration on a page reads as whole minutes with the word minutes beside it, and every rate reads as basis points with the words basis points beside it.
- IF-02: No promotion row is ever deleted, and no table carries a stored highest-rung, gap, rate or state column.
- IF-03: Demotions caused by one breach are recorded from the highest rung downward, so their instants strictly increase as the rung index decreases.
- IF-04: The application writes exactly the three named deliverables into the working directory root, and no other file at run time.
- IF-05: `/app/run.json` is a JSON object with string `install`, `build` and `serve` fields and `"_schema":"run-manifest-v1"`.
- IF-06: `/app/THIRD_PARTY_NOTICES.md` names every shipped package with its licence. Shipped packages means the modules the production binary links, as listed by `go version -m` on the built server.
- IF-07: Every shipped package is under the MIT, BSD-2-Clause, BSD-3-Clause, Apache-2.0, ISC or MPL-2.0 licence.
- IF-08: The PostgreSQL database named by `DATABASE_URL` is the only datastore, so there is no embedded database, cache server or state file.

## Engineering standards

- Idiomatic Go, formatted with the standard formatter, with names that match this brief's domain terms: flag, cohort, rung, promotion, soak, adverse rate, attestation, evidence pack, idempotency key.
- The promotion gate (DP-01 to DP-04) is decided in exactly one place. The standard promotion, the force-enable control and the evidence pack all reach it there.
- Each other domain rule is decided in exactly one place: rung state word, adverse rate, rollback, breach cascade, gap, attestation normalisation, event code normalisation, promotion code assignment and CSV field writing.
- Request bodies are decoded strictly against each route's published shape, and every failing field is collected before the single `422` is written.
- Per-flag serialisation and gapless code assignment are enforced by the database transaction itself. A lost race maps to its published `422` and never to a `5xx`.
- A refused request returns before any write, or its writes are rolled back together. One consistent error shape is used across the API.
- There is no abstraction with a single implementation, no dead, commented-out or unreachable code, and no defensive check for an impossible state.
- There are no features beyond this brief.
