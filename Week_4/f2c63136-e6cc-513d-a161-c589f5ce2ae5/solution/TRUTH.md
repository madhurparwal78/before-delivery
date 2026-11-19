# TRUTH — Ridgestack golden

Every value says where it came from: `brief: <section>` (verbatim) or `decided: <why>`.

## Platform
- Node 22 TypeScript server and TypeScript browser app; listens on `0.0.0.0`, port `APP_PUBLIC_PORT` falling back to 4173 (brief: Deployment).
- `GET /api/health` → 200 `{"status":"ok"}` when Postgres and MinIO answer, 200 `{"status":"unavailable"}` when storage is down (brief: Services); `decided:` 503 `{"status":"unavailable"}` while Postgres is unreachable (the app cannot serve).
- Services only Postgres, MinIO, Mailpit. Credentials come from the environment, read in `src/server/config.ts` only (brief: Configuration and secrets).
- Server clock = real time + one stored offset; times stored and shown to the second (brief: The server clock); `decided:` the clock route answers `now` rounded up to the next whole second.

## Journeys (ideal end-to-end flow)
1. **Open a workspace and push a first stack** (brief: Journeys 1). Visitor opens `/`, follows "Open a workspace" to `/signup`, creates an account (action status "Your account is created. The confirmation email is on its way."), Mailpit holds `Confirm your Ridgestack account` with `<APP_PUBLIC_URL>/confirm/<token>`; `/confirm/<token>` → "Your email is confirmed."; login lands on `/inbox` (empty-state sentences). On `/repos` they create an organisation and a repository ("Created." then the page opens), create a write token on settings (`rgs_` + 40 hex, shown once), push branch `a` then `b` from `a` with `POST /api/repos/<org>/<repo>/push`, open two changes; the change page shows the stack rail with two rows bottom to top and the merge box listing unmet rules.
2. **Review by keyboard, with suggestions** (brief: Journeys 2). `j`/`ArrowDown` move the cursor row (focus on it), `c` opens `Comment on <path> line <n>`, "Add a suggestion" + suggested lines + Through line, Ctrl+Enter submits (focus returns to the cursor row), `r` opens Submit review, Request changes with a summary. The author's page shows `Changes requested by <name>` in the merge box and the sentence `#<n>: <name> requested changes` in Review updates; "Add to batch" then "Apply batch" makes one revision `Apply 1 suggestion` / `Apply <n> suggestions`; the runner's success report removes the checks rule live.
3. **Approval carry-over** (brief: Stacks and Approval carry-over). A push to the bottom change restacks every change above it with the file-level rule into `Restack onto #<lower>`; each keeps its approvals only when its combined diff is identical. The rail walks up row by row (`data-anim="walking"`, one at a time) and settles with `Approvals kept`, `Approvals dismissed (<count>)`, `Conflicts in <count> files` or `Not restacked`; results persist after reload.
4. **Owners and merge rules** (brief: Code owners). `.review/OWNERS` is read from the base revision; the merge box lists `Needs code owner approval for <paths>` in byte order and shrinks live as owners approve until `All merge rules are met` and the Merge button is enabled.
5. **Queue, failure and timeout** (brief: The merge queue). Each entry has a queue revision `Queue #<n> v<k>`; a failed required check removes the entry with `Removed: check <name> failed`, entries behind get new queue revisions with checks reset, positions renumber live, the head merges at the next step (`QUEUE_STEP_SECONDS` of server clock); a head entry whose check never reports is removed with `Removed: check <name> timed out` when the clock passes `CHECK_TIMEOUT_SECONDS`.
6. **Two authors save the same file** (brief: Concurrency). Exactly one push with the same `expected_head` wins; the other sees `This file changed on <branch> since you opened it. Your edit was not saved.` with `Load latest`, keeps typed text.
7. **Phone review and storage outage** (brief: Journeys 7). At 375px the diff is unified only, files are in the Files drawer, rows are tapped, controls ≥44px. With storage down push/edit/export show `Storage is unavailable. Nothing was saved. Try again in a moment.` / `Storage is unavailable. The archive was not exported. Try again in a moment.` and save nothing.

## API (brief: API)
Error order 401 → 404 → 403 → 413 → 409 → 422 → 503 on every route. Push/checks bodies up to `PUSH_SIZE_LIMIT_BYTES` inclusive, others 262,144. Revision id = first 12 hex of SHA-256 of the canonical text (brief: Revisions). Objects stored under `objects/<sha256>`; archives under `archives/<repo id>/<revision id>.zip` (stored zip, `REVISION.txt` included).
`decided:` extra read endpoints for the screens (`/overview`, `/changes/<n>/view`, `/queue/view`, `/revisions/<id>/contents`, `/roles`, `/tokens`, `/inbox`, `/orgs`, `/live/<org>/<repo>` stream) answer sessions only.

## Palette roles (hex used by the build; brief: Visual design, `decided` where silent)
ground #0A0A0A; surface #171717; border #262626; raised #222222 / #2A2A2A; ink #F5F5F5; muted #9A9A9A; dimmed titles #858585 (decided: ≥4.5:1); link orange #F0802A; glow amber #FFB931; glow blue #1061FF; green #22C55E; added fill #1F3A26; thread tint #1C2740; near-white fill #EDEDED with #0A0A0A text.

## Type, space, layout
Inter Tight 500 −0.02em (display), Inter (body 16–20px, 1.45), Martian Mono (code, ids). Scale 12/14/16/20/24/36/60. Column 1,100px, stage ~640px, rail ~420px; one column below 1024px with the rail first. Radii 16/12/8, pill only on "Start a stack". Diff rows ~1.5× mono size, wrapping on phones. Viewports 1280×800, 768×1024, 375×812, no sideways scroll; controls ≥44px below 1024px (brief: Screens and layout, Visual design).

## Motion table
| Element | Trigger | Duration, easing | Reduced-motion substitute |
|---|---|---|---|
| hover/press | pointer | 250ms, cubic-bezier(.4,0,.2,1) | none |
| nav pill | scroll | ~300ms | none |
| home entrances | scroll into view | ≤450ms, 16px rise, once | final state |
| revision player | first view; Play; tab | 2s per step once; quick cross-fade | no auto-step |
| toast | new event | 500ms drop-in | in place |
| new comment | live | ~300ms, `data-anim` entering→none | none, `data-anim="none"` |
| queue move | position change | ~500ms slide, `data-anim` moving→none | in place |
| approval carry-over | restack event | 500ms per row expand + bar fill; `data-anim` walking→none, one row at a time | all rows show results at once |
Nothing loops forever; the walk advances on `animationend`, never on page timers (brief: Motion and effects).

## States per async action (brief: Feedback states)
Each action disables its button with `aria-busy="true"` (label unchanged) and writes pending (`Working...`, `Saving...`, `Submitting...`, `Exporting...`) then the success sentence to `status "Action status"`; field errors appear inline as `alert`; refusals and outages use `alert "Announcement"` with the verbatim copy; typed text is kept.

## Breakpoints
1024px (two panes / tap-target rule), `DIFF_BREAKPOINT_PX` (default 768, served on the root element) for unified-only layout.

## Media and licences
No image/audio/video files. Fonts Inter, Inter Tight, Martian Mono (OFL-1.1, bundled woff2). Icons and artwork drawn in code (`original`). Packages MIT/ISC/Apache-2.0 (see THIRD_PARTY_NOTICES.md).
