# TRUTH — Nightform (Mothlight Works)

The golden's ground truth: the brief made concrete, never reinterpreted. Every value says where it came from: `brief: <section>` (copied from
`instruction.md`) or `decided: <why>` (the brief is silent; the reason ties it to the brief's intent). Copy strings M01 to M86 are the brief's
Messages table and live in one file, `app/src/shared/messages.ts`.

## Ideal end-to-end flows

### 1. Build and check a branching form by keyboard (DP-02..DP-06, DP-10, DP-53)

- Start: the owner (seeded user, `nf_session` cookie) opens `/forms/<id>/edit` of a draft with three titled pages (brief: Journeys 1). `main` is `aria-busy="true"` with the dim page map until the first data arrives.
- Keyboard only: the `Select question`/page buttons are reached with Tab; `Add question` (Enter) opens `dialog "Add question"` with focus on `Question type`; typing key and label and pressing Enter in either presses `Add`: the question is appended to the selected page, the dialog closes, focus returns to `Add question`, `#announcer` reads `Question added: <label>.` (M35).
  A repeated key keeps the dialog open and `#alert` reads `That key is already used.` (M37). Escape closes and returns focus to `Add question`.
- `Alt+ArrowUp` / `Alt+ArrowDown` anywhere in a question row moves the question one place within its page; focus stays on that row's `Select question <key>` button; `#announcer` reads `<key> moved to position <n> of <m>.` (M38).
- Selecting page 2 and filling `Rule name` and `Show when` then `Save rule` stores `show_rule {name, when}` on the page (server order number = the draft's new revision, Valkey `nf:form:<id>:seq` incremented once).
- A mistyped formula (`1 +`) in `Formula` + `Save formula`: `#formula-error` and `#alert` read `Column 4: the formula ends too early.`, the box has `aria-invalid="true"` and keeps focus; nothing is stored.
- Trial answers (`Trial: <label>`) commit on blur/Enter/change, each sends `POST /api/forms/<id>/trial` with a rising `seq`; the page map (`data-state` lit/skipped, `Skipped by: <rule>`), `#lit-marker[data-page]`, `#trial-values` and `#announcer` (`Path: <lit> of <all> pages shown`) always equal the newest reply.
- `Publish` (Enter): `#announcer` reads `Edition 1 is live.` (M42) and `#form-state` reads `Open`; with problems it refuses with `Fix 1 problem before publishing.` (M43) in `#alert` and nothing changes for live respondents.
- A second browser opens the live form: with answers that skip page 2 the walk shows `Page 2 of 2`.

### 2. Change your mind going back (DP-07..DP-10, DP-13)

- A respondent fills the Supper club form to Travel, goes Back twice, lowers guests from 3 to 1: the commit reply has `hidden_now: 1`, `#path-notice` and `#announcer` read M06, `#page-count` reads `Page 1 of 3`. Raising it to 3 brings Travel and the stored parking answer back (M08). Choosing `No` for attending hides meal, diet, parking (M07, n=3) and the page count reads `Page 1 of 2`; Next jumps to the last page; Submit stores only `attending` and `guests`; the owner's response view lists only answers that count.
- Every page move: the new page replaces the old at once, focus on `#page-title`, `#announcer` reads `Page <n> of <m>: <title>` (M05), `document.title` is `<page title> - <form title>`, a CSS animation `page-fade` (500 ms) runs on `#page` unless reduced motion.

### 3. Price a pre-order (DP-14..DP-17)

- Bakery pre-order: each committed answer returns every shown calculated value (exact decimals, `places` 2, prefix `£`); `#calc-<key>` outputs update, `#announcer` reads the changed values `<label>: <text>` joined by one space in form order; the large-order question appears when the total reaches 20; the hidden `margin` field is absent from the page, the evaluation and the email copy; `Each` shows `Cannot calculate: division by zero.` when people is blank.

### 4. Fix errors from the summary (DP-20..DP-22)

- `Next`/`Submit` with errors: `#error-summary` (`region "There is a problem with your answers"`, tabindex -1) appears above `#page-title` and takes focus; one link per error in page order with the exact message; `#alert` reads `There is a problem with your answers. <n> to fix.`; title prefix `Error: `; each field has `aria-invalid="true"`, `aria-describedby` with `error-<key>` and its inline message; activating a link focuses the field (per the brief's table) and leaves the summary. Budget 33.3 + 33.3 + 33.3 reports "The percentages must total 100. They total 99.9."; 70.1 + 29.8 + 0.1 passes (exact decimals).

### 5. Fill by keyboard or by touch (DP-23..DP-32)

- Wide: grid is one tab stop, arrows move, Space/Enter selects; ranking Space picks up (M39), arrows move (M38, no commit), Space drops (M40) and commits, Escape cancels (M41); scale is one radio group (arrows, Home/End, digits, no wrapping); `Choose a date` dialog opens on the selected date, today (server's date) or the nearest allowed day, Monday-first, keys as in the brief, days outside min/max are `aria-disabled`.
- Phone (<= 767px): grid becomes one radiogroup card per row, date picker a full-width sheet, ranking `Move <option> up/down` buttons, every target >= 44x44; a file shows `Uploading <name>` (`aria-busy`) then `Attached: <name> (<size>)` only after MinIO confirmed the object; the owner downloads the same bytes from the response view.

### 6. Save on one device, finish on another (DP-33..DP-37)

- `Save and finish later` commits the page and `POST .../save`: the outbox row is written in the same transaction as the save; the dialog shows `We sent a link to <email>. It works until <expiry>.` (M13) once Mailpit accepted it, or `Your answers are saved; the email will follow.` (M14) while it waits in the outbox (Mailpit down).
- Opening `/r/<token>` on a second browser takes the response over (`devices` history, `device_id` moves, `moved` pushed over `/ws`): `#notice` reads `Welcome back. Your answers were saved on <saved>.` (M15); the first browser's next commit/Next/Back/Save/Submit gets 409 `DRAFT_MOVED`, every control is `disabled` and `#alert` reads M21. After the second device submits, the link shows `This response has already been sent.` (M20). The link works until exactly `RESUME_TTL_HOURS` after the last save, one second later `This link has expired.` (M19).
- A newer edition goes live meanwhile: the link moves the answers onto it, keeps only still-valid answers and `#notice` lists the dropped ones (M16/M17/M18); the page opened is the first page with an empty required question or a dropped answer.

### 7. Watch responses arrive and close on time (DP-40..DP-46)

- The summary (`/forms/<id>/summary`) joins `/ws` (`view: summary`): each submit/delete on any instance publishes the new summary over Valkey `nf:summary:<id>`; `#response-count`, tables, chart bars and `#announcer` update within 2 s without reload. `Export CSV` stores `exports/<form>/<export>.csv` in MinIO, only then announces `Export ready: <n> responses.` and shows `Download CSV`; text cells starting `=`, `+`, `-`, `@`, tab or CR get a leading `'`.
- Closing: the server clock (grading clock) decides; a submit at/after `closes_at` is refused (409 `FORM_CLOSED`); the last place is settled one at a time against the form's `form_limits` row in one transaction (exactly one 200, the rest 409); open respondent pages receive `form_state` over `/ws` within 2 s and show `#closed-panel` (`This form is closed`, the closed text, `Your answers were not sent.`) with focus on its `h1`.

### 8. Edit together (DP-48..DP-50)

- Owner and co-editor see each other in `#presence` (`Also editing: <names>`). Each change gets the next number of `nf:form:<id>:seq` (its server order and the draft revision), is applied under the form row lock and broadcast as `applied` on `nf:form:<id>` to every builder on every instance. Different fields both land; the same field: the later change in server order wins, the replaced editor's reply has `conflict_with` and their builder shows `<name> changed <field> on <key> at the same time. Their version is kept.` (M52) with focus unmoved. A typing editor keeps their text until they commit.

## Palette (DP-60)

| Role | Hex | Source |
|---|---|---|
| ground | #14091b | decided: near-black plum (brief: Visual design, Ground) |
| surface | #241230 | decided: lifted deep plum, used only for the one item being worked on (brief: Surface) |
| ink | #ffffff | brief: Visual design (pure white, for the lit item only) |
| muted | #a995b5 | decided: soft grey-mauve, 7.06:1 on ground (brief: Muted) |
| help | #d9c8e3 | decided: pale mauve, 12.3:1 on ground, at least 7:1 (brief: Muted) |
| accent | #ff3d9a | decided: hot pink, only on the primary action, chart bars, the Lit path marker, error markers (brief: Accent) |
| on-accent | #14091b | brief: Visual design (near-black plum on pink) |
| well | #2f1b3d | decided: a tone for input fields because the brief forbids borders |
| dim | #5d4e68 | decided: about a third of full brightness for skipped Lit path titles (brief: Visual design) |

## Type, space and layout per viewport

| Item | Value | Source |
|---|---|---|
| Family | Work Sans (variable, latin subset), served from `/assets/fonts/work-sans-latin-wght-normal.woff2` | brief: Visual design |
| Heading scale | h5 1rem, h4 1.25rem, h3 1.563rem, h2 1.953rem, h1 2.441rem (each 1.25 times the one below); at 767px and under each level takes the next smaller size | brief: Visual design; decided: phone steps |
| Body | marketing 1rem regular; working screens 1.125rem; tabular figures for numbers | brief: Visual design |
| Phone 375x812 | one column; builder one pane with the `Pane` switcher (Canvas first); responses as stacked blocks; summary table above chart; grid cards; date sheet full width; targets >= 44px | brief: Screens and layout |
| Tablet 768x1024 | wide layout (threshold is 768): three builder panes, respondent column 40-60% wide starting about a sixth across, centred date dialog | brief: Screens and layout |
| Desktop 1280x800 | wide layout; marketing band on seven columns | brief: Screens and layout |
| Layout switch | exactly one, between 767 and 768 px | brief: Screens and layout |
| No sideways scroll | every width from 320 to 1440 | brief: Screens and layout |

## Motion table

| Element | Trigger | Duration | Easing | Reduced-motion substitute | Source |
|---|---|---|---|---|---|
| `#page` (`page-fade`) | page change | 500 ms (420 to 600) | cubic-bezier(.2,.7,.2,1) | none runs; content, focus, announcements unchanged | brief: Motion and effects |
| page-map items (`lit-fade`) | trial reply changes an item's state | 420 ms, 40 ms stagger in path order, capped at 12 items | same | states switch at once | brief: Motion and effects |
| `#lit-marker` (`lit-marker`) | trial reply | 600 ms down the lit chain | same | sits at its final page | brief: Motion and effects |
| `.lit-count` in `#trial-values` | trial reply | 320 ms count from old to new number, `data-final` holds the final text from the first frame | same | final number at once | brief: Motion and effects |
| muted text and controls | hover, keyboard focus | 200 ms to ink | ease-out | instant | brief: Motion and effects |
| pressed button | press | 80 ms darken while held | ease-out | instant | brief: Motion and effects |
| dialogs and date sheet | open | 250 ms crossfade | same | instant | brief: Motion and effects |
| dim page map | first load, `main[aria-busy]` | 600 ms crossfade in | ease-out | none | brief: Motion and effects |

## States per async action

| Action | Pending | Success | Failure |
|---|---|---|---|
| Next / Back / Submit | `Submit` has `aria-busy="true"` while pending, further activations send nothing (one idempotency key reused) | new page (focus `#page-title`, M05) or confirmation `h1` M27 + M28 (+ M14 when the copy is still in the outbox) | error summary + M02, or `#closed-panel` + M26 (409 FORM_CLOSED), or all controls disabled + M21 (409 DRAFT_MOVED) |
| Commit | none shown; replies with an older number are discarded | evaluation applied in place (labels, calculated values, path notice) | refusal in `#alert` |
| File upload | `#upload-<key>` `Uploading <name>` with `aria-busy="true"` | `Attached: <name> (<size>)` + `Remove <name>` | M32/M33/M34 in `#upload-<key>` and `#alert`; nothing attached |
| Save and finish later | dialog open | `#save-status` + `#announcer` M13 or M14 | field message (M75) beside the field and M68 |
| Publish | none | M42 | M43/M44 in `#alert` |
| Export CSV | none | M60/M61 after the object is stored, then `Download CSV` | M62 in `#alert` (503 EXPORT_FAILED) |
| Delete response | dialog | M63, row removed, summary pushed | refusal in `#alert` |
| Builder change | local edit applied at once | acknowledged by the server order number | refusal restores the draft, formula refusals in `#formula-error` |
| Valkey down | builder `#live-status` M53 + `Save changes`; summary `#live-status` M59 | `Changes saved.` (M54) | n/a |
| Mailpit down | save/submit succeed | M14 shown | n/a |
| MinIO down | upload 503 M34, export 503 M62; a required file blocks Next | n/a | n/a |

## Breakpoints

| Width | What changes | Source |
|---|---|---|
| <= 767 | phone layout (single pane builder, stacked grid, date sheet, stacked response rows, table above chart, marketing stacked in one column with thumbnails two per row) | brief: Screens and layout |
| >= 768 | wide layout (three panes, grid, centred date dialog, seven-column marketing band) | brief: Screens and layout |

## Services and recorded side effects

| Service | What the golden records | Source |
|---|---|---|
| Postgres | accounts, sessions, forms, drafts, form_changes log, editions (json, byte for byte), responses (answers pinned to their edition), files, idempotency, invitations, exports, outbox, app_clock, the `form_limits` lock row | brief: Services |
| Valkey | `nf:form:<id>:seq`, channels `nf:form:<id>` and `nf:summary:<id>`, hash `nf:presence:<id>` (30 s expiry), `nf:rl:submit:<ip>:<YYYYMMDDHHMM>` (60 s), `nf:rl:resume:<ip>:<YYYYMMDDHH>` (3600 s) | brief: Services |
| MinIO | `files/<form>/<response>/<question>/<file id>`, `exports/<form>/<export>.csv`; nothing else | brief: Services |
| Mailpit | resume mail, email copy, invitation; each written to the outbox first, delivered once, retried at least every 30 s | brief: Services |

## Media and licences

| Asset | Licence | Source |
|---|---|---|
| Work Sans variable woff2 (latin) | OFL-1.1, licence text committed in `app/public/fonts/OFL.txt` | npm `@fontsource-variable/work-sans` 5.3.0 (listed in `app/assets.json`) |
| Page-map thumbnails, dim page map, icons | original, drawn as inline SVG in code | decided: no imagery beyond procedural page maps (brief: Visual design) |
| npm packages shipped | pg, ioredis, ws and their dependencies: MIT, ISC, Apache-2.0 | `app/THIRD_PARTY_NOTICES.md` |
