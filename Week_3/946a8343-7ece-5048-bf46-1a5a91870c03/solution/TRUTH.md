# TRUTH — Spurline golden

Ground truth of the reference application. Every value says where it came from: `brief: <section>` (copied verbatim from
`instruction.md`) or `decided: <why>` (the brief is silent; the reason ties the value to the brief's intent).

## 1. Journeys (ideal end-to-end flows)

### J1 Founder sets up the guard rails
- Start (brief: Journeys 1): the founder-owner (`asha`, demo password `spurline-demo-1`, brief: Seed data) is signed in and owns group `coldbrook`.
- Actions: create subgroup and project (`POST /api/groups`, `POST /api/projects`), protect the default branch (`PUT …/protected_branches/main`), add push rules (`PUT …/push_rules`), add approval rule `Backend` (`POST …/approval_rules`), commit `.spurline/OWNERS` (editor / commit API), switch on merge trains and `pipelines_must_succeed` (`PATCH …/settings`), protect `production` with one required approval (`PUT …/protected_environments/production`).
- Visible end state: `/projects/<id>/-/settings` shows the settings rule cards on the light band (`region "Protected branches"`, `"Protected tags"`, `"Push rules"`, `"Approval rules"`, `"Merge settings"`, `"Protected environments"`, `"Project variables"`, `"Members"`, `"Webhooks"`). A contract developer's direct commit to the default branch answers 403 `protected_branch` with `You can't push to protected branch main.` (brief: Protection).
- Provider-recorded: Postgres rows in `protected_branches`, `push_rules`, `approval_rules`, `protected_environments`; audit events `protected_branch.set`, `push_rules.update`, `approval_rule.create`, `project.settings`, `protected_environment.set` (brief: Audit table).

### J2 Contract developer ships a stacked change
- Start: developer role inherited from the parent group. Two files edited in the web editor, committed to a new branch in ONE commit (`POST /api/projects/:id/commits`), request A opened, request B opened with A's branch as target (check 3 `Waiting for !<iid> to merge.`).
- Review threads arrive; a new push outdates a thread (`Outdated`) and resets approvals (`Approvals reset: new commits were pushed.`); a three-way conflict is resolved in the browser (`Edit inline`, `Commit resolution`, merge commit `Resolve conflicts with <target>`); A is added to the train.
- End: A merges; B is retargeted to the default branch with `Retargeted from <old> to <new> because !<iid> merged.` (brief: Stacked requests).

### J3 Code-owner reviewer reviews by keyboard
- Keys (brief: Interactions): `j`/`k`, `n`/`p`, `]`/`[`, `c`, `Shift+ArrowDown/Up`, `Ctrl+Enter`, `Escape`, `e`. Focus after each step per the brief's tables (comment box → row; resolve → next unresolved thread or the thread's line row; submit review → the row that was current).
- End: the author's open page shows the new threads in place without a reload; the merge check reads `2 unresolved threads must be resolved.` (brief: Journey 3); announcements `Review submitted: <n> comments`, `Thread resolved. …`.

### J4 Founder watches the train
- Three cars on `/projects/<id>/-/train?target=<branch>`; each block shows the stored speculative commit as a resolving 7-character kicker. The middle car's pipeline fails → `Removed from merge train: pipeline <id> failed.` (author `spurline-train`), the middle block leaves (`train-leave`, 160 ms), the car behind rises (`train-step`, 300 ms) and its kicker re-resolves to a new commit id; announcement `!<iid> is now position 2, testing <short>`; the first car merges its exact stored commit (`!<iid> merged into <target>`).

### J5 Founder approves a production deploy and rolls back
- Deploy job to protected `production`: job `manual`, deployment `awaiting_approval`, copy `Waiting for approval: 0 of 1`. The deployer is refused (403 `self_approval`, `You can't approve your own deployment.`); the founder approves (`Deployment approval recorded: 1 of 1.`), the deploy runs; a later deploy fails; `Roll back to deployment 1` makes deployment 3 from deployment 1's stored artifact (`artifacts/<job id>/<path>` in MinIO); metrics show `Change failure rate <x>%`.

### J6 Client stakeholder follows their issue
- Reporter opens `/projects/<id>/-/boards/<board id>?label=priority::high`; the URL reopens the same view; cards move live (`board` message); merging a request whose description says `Closes #<iid>` into the default branch closes the issue with the system note `Closed by !<iid>.`.

### J7 Reviewer on a phone (390×844 touch)
- Swipe (finger moves > 80 px sideways and < 40 px vertically) changes file (`File <i> of <n>: <path>`); long press 500 ms on page timers with < 8 px movement opens `dialog "Comment on line <n>"`; `button "Open panel"` → `dialog "Panel"` bottom sheet with tabs `Checks`, `Threads`, `Files`; Approve from the sheet; a held card (200 ms) drags to another board list. The desktop author sees approval and card move live.

### J8 Export through a storage outage
- Storage down: export progress 0, 20, 40, 60, 80, then failure `Export failed: file storage is unavailable.` with `button "Retry export"`; storage back: Retry export runs to 100, `link "Download export"` appears only after MinIO confirmed `exports/<project id>/<export id>.spurpack`; announcement `Export ready.` No restart.

## 2. Services and provider-recorded effects
- Postgres (`DATABASE_URL`): system of record (brief: Services). Schema applied idempotently at every start under an advisory lock.
- MinIO (`S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_FORCE_PATH_STYLE`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`): `blobs/<blob id>` (contents > `SPUR_INLINE_MAX_BYTES`), `artifacts/<job id>/<path>`, `caches/<project id>/<key>`, `logs/<job id>.log`, `reports/<job id>/<kind>.json`, `exports/<project id>/<export id>.spurpack` (brief: Services). A row never references an object before storage confirmed it.
- Outage (brief: When file storage is unavailable): strip copy `File storage is unavailable. Uploads, artifacts and exports are paused.`; large commit 503 `storage_unavailable` `File storage is unavailable. Nothing was committed. Try again in a moment.`; artifact upload failure fails the job with `system_failure`; cache steps log `Cache skipped: file storage is unavailable.`; sealing waits; exports fail; downloads and rollback 503. Recovery needs no restart.
- Health: `GET /api/health` → 200 `{"status":"ok"|"unavailable"|"starting"}` (brief: Deployment).

## 3. Palette roles (hex used by the build; see DESIGN.md)
| Role | Hex | Source |
|---|---|---|
| ground | #0A1A1C | decided: blue-green near-black (brief: Colour roles) |
| surface | #122A2D | decided: one step lighter (brief) |
| raised | #1B3A3E | decided: a further step lighter (brief) |
| ink | #FFFFFF | brief: "White ink" |
| off-white | #F4F8F6 | decided: soft off-white (brief) |
| muted | #9DB5B1 | decided: grey-teal, AA on the three dark steps |
| tertiary | #6F8B87 | decided: large or non-essential text only |
| band | #E5EBE7 | decided: pale sage-grey (brief) |
| card / card-border | #FFFFFF / #CBD8D1 | brief: white cards, pale grey-green 1 px border |
| teal / gold / rust | #2EC4B0 / #E8B84A / #E2643D | decided: success+live / versions+waiting / failure (brief) |
| gradient | teal → gold → rust | brief: only things moving towards production |

## 4. Type
Inter Tight 700 (display, −0.04em, line height 1.05, sentence case); Inter 300/400/600 (body); JetBrains Mono 300/400/500 (literal code only). Bundled woff2 under `public/fonts/` (OFL-1.1, listed in `assets.json` and `THIRD_PARTY_NOTICES.md`). Project name 6× body on desk, 3× on phone; each heading step about a third larger (brief: Type).

## 5. Space and layout per viewport (brief: Screens and layout)
- Phone < 768 (375×812, 390×844): one column, even side margins, panel in `dialog "Panel"`, train as a plain list, stat cards a sideways-scrolling row with the next card peeking, stage cards 1 per row, board lists full width scrolling one at a time.
- Tablet 768–1279 (768×1024): two panes (centre + right panel), file list in a drawer (`button "Show files"`), train rows of 2, stage cards 2 per row, board lists scroll inside the region.
- Desk ≥ 1280 (1280×800): three panes, content 1110 px on three 370 px columns, train rows of 3 (each car exactly 24 px lower than the car before it in the same row, each new row back at the top step), stage cards 3 per row, ≤ 4 board lists all visible.
- No page scrolls sideways at any published viewport; wide content scrolls inside its panel.

## 6. Motion table (brief: Named animations; Web Animations, `getAnimations()` ids)
| id | Element | Trigger | Duration | Easing | Reduced motion |
|---|---|---|---|---|---|
| train-step | train car | joins or moves (±24 px translateY; 80 ms stagger front to back) | 300 ms | cubic-bezier(0.2,0.8,0.2,1) (decided) | not played; final state at once |
| train-leave | train car | removed or merged | 160 ms | cubic-bezier(0.4,0,1,1) (decided) | not played; disappears at once |
| card-settle | board card | dropped (scale 1.04 → 1) | 200 ms | cubic-bezier(0.2,0.8,0.2,1) | not played |
| job-status | graph job / job row | status changed (opacity 0.4 → 1) | 240 ms | ease-out | not played |
| check-flip | merge check listitem | state changed (opacity 0.4 → 1) | 180 ms | ease-out | not played |
| sheet-rise | `dialog "Panel"` | opens (translateY(96px) → 0 from below the screen edge) | 220 ms | cubic-bezier(0.2,0.8,0.2,1) | not played; in place at once |
Kicker (Train Ref Resolve): 100 ms after the car starts the 7 hex characters cycle every 40 ms on page timers; they lock left to right, first at 150 ms, seventh at 450 ms (one every 50 ms), showing the short form of the stored speculative id; brackets and width never move; `data-sha` is the full id from the first frame; accessible label always `Testing <short>`; a car whose id did not change never re-runs it (brief: Train Ref Resolve). Nothing loops, pulses or animates while idle.
Small feedback: hover fills ~200 ms (named properties, never `transition: all`), arrows nudge 4 px, header colour ~320 ms, carousel slide fade 160 ms (opacity 0.75 → 1; decided: the gold tag keeps AA contrast on every frame) + shift settling in 300 ms (brief: Small feedback).

## 7. States per async action (brief: Feedback states)
- Pending: button disabled with `aria-busy="true"`, label kept, `<main data-pending>` counts in-flight writes.
- Success: change in place, sentence to `status "Announcements"` (polite, one per page) and a toast in `region "Notifications"` for `SPUR_TOAST_MS` on page timers.
- Field errors: under the field (`aria-describedby`) plus an `alert` summary `Fix these problems:` with links to the fields.
- Other errors: the API message in the status-strip pattern at the top of the panel, announced.
- Outage: the Services copy in the strip pattern of the affected panel.
- Empty lists: `// EYEBROW` + headline + dark 48 px square button (table in the brief).
- Live pages expose `data-seq` (applied sequence) and `data-pending` on `<main>`; `since` replay after reconnect; `resync` → reload.

## 8. Breakpoints
320 (no horizontal scroll), 375/390 phones, 768 tablet, 1280 desk (brief: breakpoints; decided: 320 as the narrowest reflow check).

## 9. Server contract highlights (brief: API, Server boundary)
- Error body `{"error","message","details?"}`; precedence 413, 400, 401, 429, 404, 403, 409, 422, 503.
- Body limit 1,000,000 bytes (commit APIs 10,000,000; imports `SPUR_EXPORT_MAX_BYTES`); writes `SPUR_WRITE_RATE`/min per user; sign-ins `SPUR_LOGIN_RATE`/min per username, checked before the password.
- `spur_session` cookie `HttpOnly; SameSite=Lax`, no `Secure`; unauthenticated page requests redirect to `/sign-in`.
- Only built assets, fonts and API responses are served; no CORS; no external origin; no service worker.
- Grading routes exist only with `SPUR_GRADING=1` (404 otherwise). In grading mode the server clock starts at `2026-01-01T00:00:00Z` and moves only through `POST /api/grading/clock`; scheduler rounds run only through the runner routes.

## 10. Decisions where the brief is silent
- Normal copy of the instance status strip: `All systems are running.` (decided: the brief names only the outage sentence; the strip always holds one sentence).
- Group labels, group boards and epics live at group level; `GET /api/me/groups` and `GET /api/me/projects` feed the group switcher and the dashboard (decided: the brief lists the screens, not these reads).
- Timers: production background loops (deadlines every 100 ms, scheduler rounds every 1 s) are off in grading mode (brief: "moves only through the clock route").
- Cache default key `default` when `cache.key` is absent (decided).

## 11. Media and licences
No raster media. Drawn in code: halftone dot field (CSS radial gradients), inline SVG icons (original), the staircase glyph (original). Fonts: Inter Tight, Inter, JetBrains Mono, SIL OFL 1.1 via Fontsource, self-hosted. Packages: MIT / ISC / BSD / Apache-2.0 only (`THIRD_PARTY_NOTICES.md`).
