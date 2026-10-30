# TRUTH — Lanternwork Relay Bench (golden)

The brief made concrete. `brief: <section>` values are copied verbatim; `decided: <why>` values fill silences in the
brief's intent.

## Runtime

- Manifest `run.json`: `{"_schema":"run-manifest-v1","install":"npm ci --include=dev","build":"npm run build","serve":"node dist/server/main.js"}`. brief: Deployment
- Binds `0.0.0.0:${APP_PUBLIC_PORT:-4173}`; `GET /api/health` → `200 {"status":"ok"}` while the process runs. brief: API (Health)
- Schema applied on every start under a Postgres advisory lock (several instances may boot together). brief: Services; decided: lock avoids racing DDL
- Sign-in sessions: random 32-byte token in the HTTP-only, SameSite=Lax cookie `rb_session`; only its SHA-256 is stored in Postgres, so any instance sharing the database accepts it. brief: Deployment, Server boundary
- Socket presence (who is online, last cursor) and socket fan-out live in the process that holds the socket; everything else (driver, version, files) is in Postgres. decided: presence is ephemeral and per connection; the verifier's extra instances serve their own users
- Workspace keyboard: Tab order exactly as the brief lists it; past the last control focus cycles to "Skip to editor" (and Shift+Tab back), so the page never drops focus to the document. decided: brief DP-43 "every control is reachable by Tab in the order given"
- Panel and dialog fades are driven by animation frames on the page clock (200 ms in, 160 ms out); the Baton Pass flight and ledger row entrances use WAAPI. decided: both honour reduced motion
- Background loops per instance: checkpoint uploads every 3 s, mail outbox every 5 s, import sweep every 2 s, erasure storage deletions every 5 s; each item claimed with `FOR UPDATE SKIP LOCKED`. brief: Services (≤10 s, ≤30 s), Deployment (claimed once)

## Journeys (ideal end-to-end flow)

1. **A mentor's first morning.** `/sign-in` → types email → "Email me a sign-in link" → Sign-in status `Check your inbox. The link works once.`; Mailpit holds one message `Your Relay Bench sign-in link` from `MAIL_FROM` with `<APP_PUBLIC_URL>/auth/verify?token=<43-char token>`. Opening the link shows the card with "Finish signing in" (opening does not use the token). Pressing it → `POST /api/auth/verify` creates the mentor (name = local part) and, in the same transaction, the sample project; landing `/projects/<sample id>`. Workspace: h1 "Sample session" (serif), rail = mentor then Robin Vale (always-visible "demo" chip under the avatar, offline), tree = `README.md`, `index.html`, folder `src` with `tip.js`, `tip.test.js`; ledger rows "Minute 40" above "Starter" (both Saved once uploaded). Provider: 5 blobs + 2 manifests under `projects/<id>/`. brief: Journeys 1, Seed data
2. **Setting up a small group.** Projects → "New project" → title, "Group" → "Create project" → `/projects/<id>` with h1 "No session scheduled". Members → email + name → "Send invite" (Idempotency-Key per submit) → `Invite recorded for <email>.` + chip `Email sent`; one email `<mentor> invited you to <title>`. Ana (already a learner elsewhere) follows it → lands at `/projects/<new id>`. Import zip → "Check zip" → Review import opens with every changed path on "Keep student's" → "Apply import" → Import status `Import applied: <a> added, <r> replaced, <k> kept.`; tree shows the zip's files. brief: Journeys 2
3. **A live group session.** Mentor "Start session" (version +1, driver = mentor; Baton status `<mentor> is now driving`). Learner "Take the baton" → claim with the version they saw → glyph flies mentor→learner (320 ms arc), rings swap on landing, stripe wipes amber. Two simultaneous claims: one wins; the other reads `<winner> took the baton first.` Driver types → saved ≤0.5 s after the pause, others see it ≤1 s. Mentor saves "Minute 40" → top row "Saved". brief: Journeys 3
4. **Removing a learner.** Members → "Remove <name>" → alertdialog "Remove <name>?" (focus on Cancel) → "Remove" → Members status `<name> was removed. Their access has ended.`; membership deleted in one transaction, held baton returns to the mentor (version +1), their sockets get `access_revoked` then close 4403 "removed"; their screen shows `You were removed from this project.`, turns read-only and goes to `/` after 3 s; audit `member_removed` by the mentor. brief: Journeys 4, Removal
5. **Homework between sessions.** Learner "Restore Minute 40" (no confirmation) → `Restored "Minute 40".` + "Undo restore"; editor reloads open files; "Undo restore" → `Restore undone.` and the exact pre-restore files return. Mentor imports the updated zip, chooses keep/replace, applies; no duplicate path; Import status reports counts. brief: Journeys 5
6. **Renaming a folder mid-session.** Mentor renames `src`→`lib` before their typed line saves: every tree, tab, follow label (`Following <mentor> · lib/tip.js`) and open checkpoint dialog (`src/tip.js` + `now lib/tip.js`) update in place within 1 s; the mentor's unsaved buffer stays and saves into the same file id (revision +1, no stale notice). brief: Journeys 6
7. **A parent reviews a checkpoint.** Ledger "Share Minute 40" → hours 48 → email → "Create link" → `Reviewer link created. It expires <D Mon YYYY, HH:MM>.` + `Email sent`; email subject `A Relay Bench checkpoint to review: Minute 40`, body = link + `D Mon YYYY, HH:MM UTC`. `/review/<token>` (title `Checkpoint review — Relay Bench`) shows name, save time, `Link expires …` and read-only files; no project, mentor or learner details; headers `Cache-Control: no-store`, `Referrer-Policy: no-referrer`, `X-Robots-Tag: noindex`. Revoke → the guest's reload shows `This review link was revoked.`; the open Share dialog relabels rows every 30 s without touching typed values or focus. brief: Journeys 7, Server boundary
8. **A learner leaves for good.** Account → "Erase my account" → alertdialog → type ERASE → "Erase account" → `/sign-in` with `Your account and your work have been erased.`; their one-to-one projects, their checkpoints and blobs only those held are deleted (objects scheduled in the same transaction, deleted right away); audit and edit-log rows keep with actor "Erased learner" and no id; no row holds their name or email. brief: Journeys 8, Erasure

## Domain rules (single decision points in `app/server`)

| Rule | Where |
|---|---|
| session transitions | `shared/rules.ts TRANSITIONS` (server `rules.ts transition` enforces; the header shows only legal buttons) |
| baton version check (order: session_not_live, already_driving, baton_taken, then 422; brief: every 409 precedes 422. decided: `baton_taken` answers a whole-number version that is not current; a body with no whole-number version names no version, so it gets `validation` on `version`, as does a pass target outside the project on `to_user_id`) | `rules.ts checkBaton` |
| write rule | `shared/rules.ts writeRefusal` (server `rules.ts checkWrite` enforces under the project row lock; the editor turns read-only) |
| who may pass | `shared/rules.ts mayPass` |
| hand-back after removal or erasure | `rules.ts handBack` |
| revision check | `files.ts saveFile` (`FOR UPDATE` then compare) |
| idempotent replay | `idempotency.ts replayed` (transaction advisory lock on caller + key; the request's own email is attempted inside the same transaction, so a replay returns the final stored body) |
| path normalisation, path/content rules | `paths.ts` |
| zip limits | `zip.ts checkZip` (inflates with `maxOutputLength`) |
| plan, link and sign-in expiry | `rules.ts expired` |
| blob confirmation and damage check | `checkpoints.ts confirmBlob / readRecorded` |
| checkpoint state changes | `checkpoints.ts advanceCheckpoint` |
| sign-in landing path | `rules.ts landingFor` |

decided: undo is allowed while the project's `file_epoch` equals the epoch recorded after the restore; every file write, rename, restore, undo and an import that adds or replaces bumps it (checkpoint saves and keep-only imports do not). brief: Restore (Undo)

## Palette (brief: Visual design; hex decided in DESIGN.md)

| Role | Hex |
|---|---|
| ground (graphite, >90% of screen) | #0E1116 |
| surface steps | #141920, #1A2028, #222933 |
| ink (warm off-white, text, focus ring) | #EEE7DA |
| secondary text | #ABA79D |
| hairline rules | #3A4451 |
| viewer / idle rings | #6B7684 |
| amber (driver only: ring, baton, stripe, caret) | #F2A63A |
| red (destructive + errors) | #FF7B72 |
| identity tints in join order | slate blue #7F95C4, sage #8FB08C, dusty rose #CF959D, lavender #AB9DD6, steel #8CA3B3, moss #93A160, clay #C98F6C |

## Type (brief: Visual design)

Display: Instrument Serif 400, session title / review name / empty states only, 1.512rem (largest on screen). Body:
IBM Plex Sans 400/600, 0.875rem; h3 1.05rem, h2 1.26rem, h1 1.512rem (each step ×1.2). Mono: IBM Plex Mono 400/500 for code (13/20 px),
line numbers, times, counts and numerals. All fonts self-hosted woff2 under `/fonts/`.

## Layout per viewport (brief: Breakpoints)

| Band | Layout |
|---|---|
| ≥1280 | header; rail 64 px | editor (tree 220 px inside) | ledger 25% (min 300 px), open by default; "Ledger" (right end of the tab strip, after the code editor in Tab order) collapses it and the editor widens; tree tools are one row of 44 px icon buttons (hover hint = name) |
| 768–1279 | rail 64 px | editor; "Show files" opens the tree overlay; ledger is a right drawer over the editor, closed by default |
| <768 | header, rail as one horizontal row, editor full width; tree overlay from "Show files"; ledger bottom sheet (fixed, ≤78dvh), closed by default, drag handle or "Ledger" closes |

Closed panels carry `hidden`; while fading out they are already `inert` + `aria-hidden`. Controls ≥44×44 px. No page
level horizontal scroll; code scrolls inside the textarea (`wrap="off"`).

## Motion table

| Element | Trigger | Duration | Easing | Reduced motion |
|---|---|---|---|---|
| Baton glyph (4×14 amber-filled SVG capsule, between the driver's initials) | session frame with a new driver (start/claim/pass/hand-back) | 320 ms, translate along an upward arc (16 px lift at mid-flight) | cubic-bezier(0.2,0.8,0.2,1) | placed on the new avatar, no travel |
| Rings | landing | same frame | — | same frame |
| Write-stripe | landing | 180 ms, amber clip-path wipe top→bottom | steps(visible lines) | one frame |
| Dialogs, drawer, sheet, overlay in | open | 200 ms opacity + 8–24 px translate | cubic-bezier(0.2,0.8,0.2,1) | instant |
| …out | close | 160 ms | ease-in | instant |
| New ledger row | new checkpoint | 200 ms opacity + translateY(-6px) | ease-out | instant |
| State label | state change | 160 ms cross-fade | linear | instant |
| Hover / press | pointer | 90 ms filter brightness 1.12 / 0.88 | ease-out | instant |
| Spinner | request pending only | 0.8 s loop | linear | static |

Remote carets never blink; the driver's caret is solid amber, viewers' are a hollow outline in their tint. Under
reduced motion the native caret is hidden and a static caret is drawn instead.

## States per async action (copy verbatim from brief: Feedback states)

Sign-in, Session, Baton, Editor, Checkpoint, Restore, Import, Members, Share, Review and Account regions carry exactly
the brief's copy; every region is `role="status"` (polite) and replaces its text. Unexpected failures:
`Something went wrong. Try again.`. decided: every server failure, including unknown non-API paths (`not_found`) and uncaught faults, leaves in the catalogued error shape; outside a live session the empty baton bar reads "The baton is handed out once the session starts." (ink-2, outside the Baton status region); the no-session header shows the baton drawing at 48×20 left of the serif line. decided: the Members status joins both field errors when both fields are wrong;
"Link copied." confirms Copy link in Share status. decided: when a session ends the Baton status empties so no stale "is now driving" stays (no driver remains); a dialog whose
pending action disables the focused button puts focus back on it once it is enabled again (focus never falls out of a
modal). The write-stripe spans only the open file's rendered lines and is absent with no file open.

## Media and licences

| File | Licence | Source |
|---|---|---|
| client/public/fonts/IBMPlexSans-400/600.woff2 | OFL-1.1 | @fontsource/ibm-plex-sans 5.1.0 |
| client/public/fonts/IBMPlexMono-400/500.woff2 | OFL-1.1 | @fontsource/ibm-plex-mono 5.1.0 |
| client/public/fonts/InstrumentSerif-400.woff2 | OFL-1.1 | @fontsource/instrument-serif 5.1.0 |
| icons (inline SVG paths) | ISC | Lucide |
| empty-state baton drawing, baton glyph | original | drawn in code |
