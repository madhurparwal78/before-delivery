# TRUTH — Ashlar golden

Every value says where it came from: `brief: <section>` (copied verbatim) or `decided: <why>` (the brief is silent; the
reason ties it to the brief's intent). Copy strings live in the brief's `Feedback states` table and are used verbatim.

## 1. Journeys: start state, actions, visible end state, provider-recorded end state

1. **First pen** (brief: Journeys 1). Start: verified account, no pens. `/dashboard` shows the empty-dashboard panel
   (`You have no pens yet. Start one, and every save becomes a version you can go back to.`). Start a pen creates a private pen
   (`POST /api/pens`, Postgres row `pens`, head 0) and the address becomes `/pen/<id>`; the label reads `Not saved yet`. Typing
   in HTML, CSS and JS re-renders exactly `preview_delay_ms` after the last edit. Ctrl+S sends `base_version 0`; the server locks
   the pen row, checks the head, writes `pens/<id>/versions/1.json` to MinIO, reads it back, compares the sha256, inserts the
   version row, answers 201. Save status `Saved as version 1`, label `Version 1`. Reload: the dashboard row shows `Version 1`
   and the editor holds the saved code.
2. **Debugging** (brief: Journeys 2). The frame's runtime posts `<kind> <text>` entries: `log hi 2 true null undefined [1,"a"] {"a":1}`,
   `loop Stopped a loop on line <n> after <limit> iterations.`, `uncaught RangeError: boom (line 7)`. The loop guard exits the loop and
   the script continues. Pen settings, Add library: arrows and Enter add `lodash@4.17.21`; the preview re-renders after the delay and
   `typeof _` is `function`. A `<script src>` outside `/shelf/` is blocked by the content policy and reported as
   `blocked Script <url> is not on the shelf.`; `fetch`, XHR, WebSocket, EventSource and `sendBeacon` give `blocked Request to <url> was blocked. Pens cannot use the network.`
3. **Joining** (brief: Journeys 3). Sign-up creates an unverified account, signs in, sends one message through SMTP to Mailpit
   (subject `Verify your Ashlar account`), lands on `/dashboard` with the `Verify your email` banner. Save answers 403 `unverified`
   and the Save status shows `Verify your email to do this. We sent a link to <email>.` The link opened in another window calls
   `POST /api/verify`; the server publishes an `account` event and every open page shows `Email verified. You can now save versions.`
   and drops the banner without a reload. Expired link: `This link has expired. Sign in and use Resend link to get a new one.`
4. **Finding the version that worked** (brief: Journeys 4). `/pen/<id>/history` draws one band per version, oldest at the bottom,
   height `6 + 4 * log2(1 + changed characters)` px. Up/Down/Home/End move the Core sample marker; the selected band lifts 12 px over
   180 ms; after the 320 ms rest the preview and the Compare region follow and the address keeps `?a=v<A>&b=v<B>`. Enter pins A.
   Restore posts `{version, base_version: head}`, a new top band grows over 320 ms, the app moves to `/pen/<id>` and the Save status
   reads `Restored version <n> as version <m>`. The new version has the same bytes and sha256 and `restored_from <n>`.
5. **Forking** (brief: Journeys 5). A verified viewer presses Fork; the button disables, one `Idempotency-Key` per page load is sent,
   the server copies the head snapshot to a new pen (version 1 identical bytes, lineage recorded) in one transaction and queues
   exactly one notice in the Postgres outbox when the source is public and owned by someone else; the outbox drain sends it by SMTP
   once. The address becomes `/pen/<fork id>` and the credit reads `Forked from <title> by <handle>`. Open pages of the source show
   `1 fork` within the live-update limit (SSE `counts` event).
6. **Two tabs, one pen** (brief: Journeys 6). A stale save answers 409 `version_conflict` with `head`; the conflict alert shows
   `Version <head> of this pen was saved somewhere else. Your edits are still here.`, focus moves to `Keep mine as next version`,
   the code is untouched; Keep mine saves with `base_version` = head, Load latest replaces the panes and says `Loaded version <n>`.
7. **Sharing** (brief: Journeys 7). Share opens the dialog on the checked starting tab; arrows change the tab and update
   `<APP_PUBLIC_URL>/embed/<id>?tab=<tab>` (brief: Business rules, Embed) and the iframe snippet at once. `/embed/<id>?tab=js` opens on that tab, arrows move focus, Enter or
   Space selects, Rerun increments `data-render-seq`. Private pen: the embed shows `Nothing here`.
8. **Bad weather** (brief: Journeys 8). With MinIO unreachable save answers 503 `storage_unavailable`; the Save status shows
   `Storage is unreachable, so this version was not saved. Your edits are still here.`, no version row or number appears and the edits
   stay. Export shows `Storage is unreachable, so the export was not made. Your pen is unchanged.` When MinIO answers again the next
   save works with no restart, and the recovery loop mirrors the shelf and writes the starter versions.

## 2. Palette (hex used by the build)

| Role | Hex | Source |
|---|---|---|
| ground (limestone grey, hsl 210 14% 91%) | `#E6E9EC` | brief: Visual design, Palette (pale, cool limestone grey) |
| surface (code panes) | `#D2D7DC` | brief: Palette (slightly deeper stone grey) |
| ink | `#2B2622` | brief: Palette (warm near-black charcoal) |
| muted | `#574B41` | brief: Palette (warm mid grey-brown) |
| accent (lichen) | `#4C6A3C`, strong `#3F5A31` | brief: Palette (muted lichen green, white text) |
| sandstone panels / console toolbar | `#D8C6A5` | brief: Palette (deeper sandstone tan) |
| console body | `#D2BE99` | brief: Palette (console band is sandstone) |
| hero field | `#22201E`, text `#EDEAE4`, muted `#B7B0A6`, ring `#BFD4AE` | brief: Landing hero (ink charcoal field); decided: ring colour readable on ink |
| strata tones | `#B9C0C7`, `#A3ABB3` | brief: Motion, Core sample strata (two stone tones) |
| danger text | `#8A2F25` | decided: error emphasis text only, words always carry the state |

## 3. Type, space and layout

- Work Sans 300/400/500 for display and body, Fragment Mono 400 for code panes, console and diffs only; woff2 served from `/fonts/`
  (brief: Visual design, Type). Heading steps 1, 1.25, 1.5625, 1.953, 2.441 rem (brief: each step 1.25×); pane headings 1.953 rem light
  (brief: about twice body size). Tabular figures on versions, counts, sizes, dates (brief: Type).
- Controls at least 44 px in both directions (brief: Density). Stage inset 16 px, radius 12 px (brief: Corners). Reading column prose
  at most 46ch; code panes fill the column (decided: a pane is not prose).
- **Wide, 1024+** (brief: Screens and layout): stage `47%` of the width (after the inset), sticky while the column scrolls, console a
  full-width docked band (decided: fixed bottom so it is always visible), layouts Side by side / Stacked / Preview first with
  separators 15–85 step 5 (brief: Interactions, Separators).
- **Medium, 768 up to 1023**: stage full width at the top, `40vh`, sticky; panes stacked; console in flow below the panes.
- **Narrow, under 768**: `tablist "Panes"` (HTML, CSS, JS, Result, Console), one panel at a time; list screens carry a `33vh` sticky
  stage; the header shows Menu and Start a pen.
- Landing (brief: Landing hero): hero ink field; inset left, `47vw − 24px` wide and `88vh` tall; wordmark `clamp(120px, 12.5vw, 200px)`
  light, `-0.06em`, `mix-blend-mode: difference`, crossing the inset's lower-right corner; lede 24 px; phone inset ends at 58% of the
  screen with a 20vw wordmark straddling its bottom edge.

## 4. Motion

| Element | Trigger | Duration | Easing | Reduced-motion substitute | Source |
|---|---|---|---|---|---|
| stage layers (dashboard, explore, collection rows; landing inset; history preview) | row hover/focus, scroll section, rest | 600 ms opacity | `cubic-bezier(.2,.7,.2,1)` | instant cut | brief: Motion and effects |
| selected Core sample band | marker move | 180 ms `translateX(12px)` | same | 2 px accent outline, no lift | brief: Motion and effects |
| marker rest delay | after the last marker move | 320 ms (page timer), preview and compare follow | n/a | same delay | brief: Motion and effects |
| new top band after restore | restore success | 320 ms `height` from 0, then navigate | same | full height at once, navigate immediately | brief: Motion and effects |
| count tick | compare update | 600 ms, 12 steps | ease-out cubic | final values at once | brief: Motion and effects |
| dialogs | open | 180 ms opacity | same | none | decided: only the lift duration is reused |

## 5. States per async action

| Action | Pending | Success | Failure |
|---|---|---|---|
| Save | `Saving…` | `Saved as version <n>` | 409 alert; 503 outage copy; 422 pane-size copy; 403 unverified copy |
| Restore | button busy | band settles, editor says `Restored version <n> as version <m>` | History status: `Storage is unreachable, so version <n> was not restored.` or the unverified copy |
| Like / Fork | Fork disabled | counts from the response and the live event | status line shows the server message |
| Export | none | `Exported version <n>` | `Save a version before exporting.` / outage copy, focus stays on Export |
| Delete | alertdialog | dashboard `Deleted "<title>"` | Settings status `Storage is unreachable, so the pen was not deleted.` |
| Search | previous results stay | `<n> pens found` / `No pens match` | latest query always wins |
| Sign up / in | button busy | lands on `/dashboard` | alert with the server's field copy |

## 6. Breakpoints

1024 and 768 only change the editor's arrangement (brief: Screens and layout); nothing scrolls sideways at 320, 375, 768, 1280.

## 7. Media and licences

No photographs. Icons and the stone-course drawing are inline SVG drawn for Ashlar (original). Fonts: Work Sans and Fragment Mono,
OFL-1.1, via Fontsource. Shelf: dayjs 1.11.13 MIT, lodash 4.17.21 MIT, matter-js 0.20.0 MIT, tinycolor2 1.6.0 MIT,
canvas-confetti 1.9.3 ISC. Packages and licences: `app/THIRD_PARTY_NOTICES.md`; binary assets: `app/assets.json`.

## 8. Decisions where the brief is silent (each ties to the brief's intent)

- `GET /api/me` also returns `verification: "sent" | "pending"` while the account is unverified. decided: the banner must show the
  not-sent copy after a reload, and the brief's `User` shape has no field for it.
- Version rows hold hash and change counts, never content; content is read from the bucket and checked against the row's sha256.
  decided: the brief puts byte-exact snapshots in MinIO, and history must list versions while storage is down.
- Starter pens are read from their bundled copies by renders only (brief: Seed data), so the landing inset works during an outage.
- Wide band: the site header is sticky and the stage sticks directly under it; the console is a fixed full-width band at the bottom.
  decided: a stage that never moves needs a fixed top edge, and an always-visible console serves the brief's "console is open by default".
- Medium band: the panes share the remaining viewport height and the console sits below them. decided: the brief's medium arrangement
  must fit one 768x1024 screen without hiding the console.
- A superseded search request is aborted and its answer ignored; a superseded render request is left to finish and its answer ignored
  (the page keeps the latest render's ticket). decided: "latest render / latest query wins", and an in-flight render ticket is cheap and harmless.
- Fork notices go through a Postgres outbox drained every 5 s by the instance that wins the row lock. decided: the brief asks for a retry
  at least every 30 s and exactly one message.
- Layout choice and the three separator values are one global localStorage record. decided: "remembered for every pen".
