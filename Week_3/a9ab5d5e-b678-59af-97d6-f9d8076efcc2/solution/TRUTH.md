# TRUTH — Halfway Hollow Twohouse (golden ground truth)

Every value says where it came from: `brief: <section>` (copied from `instruction.md`) or `decided: <why>`
(the brief is silent; the reason ties it to the brief's intent). Section names are the brief's.

## Journeys

### 1. Set up a household (DP-01 to DP-06, DP-61)

1. Signed out on `/start`, the planning parent fills Household name, Currency, Your name, Your email, Password, Other parent's name, Other parent's email and presses "Create household". Same email in another case: `The other parent needs their own email.` beside the field, URL stays `/start`. (brief: Field rules)
2. The household is created, the parent is signed in as `planning`, lands on `/plan` with focus in `textbox "Rule name"` and `Household created. Enter your plan.` in `status "Activity"`. Reload shows the same screen. (brief: Interactions — Routes)
3. They press "Save draft" (`Draft saved.`), then "Adopt plan" (`Plan adopted. The calendar now uses it.`). The first draft is Effective from today, 17:00, the household zone, pattern `PO`, anchor today, 50/50, no limit, no rules. (brief: Previews and quotes)
4. The invite is sent twice; each send makes a new token and kills every earlier one. A join screen already holding the old link shows `This link no longer works.` on submit. Two browsers racing the newest link give one join. (brief: Sessions and invites)
5. Five failed sign-ins for one email, split over two processes, lock it: `Too many tries. Try again in <n> seconds.` (brief: Sign-in limit)
6. The other parent joins from the newest email and lands on `/calendar` signed in. Later a request email opens `/requests` signed out: the page goes to `/?next=%2Frequests`, sign-in returns to `/requests`; a hostile `next` lands on `/calendar`. (brief: Routes)
7. End state: both Calendars show `Year digest <digest>` with the same digest, from the one RFC 8785 year document. (brief: DP-11)
8. Provider record: Mailpit holds an invite only for a send that reached SMTP (a queued invite killed by a newer one is `superseded` and never reaches SMTP), one `Replaced` row in Notices; the log holds `household.created`, `invite.sent` ×2, `plan.draft_saved`, `plan.adopted`, `household.joined`.

### 2. Enter the plan and check a night (DP-07 to DP-15, DP-75, DP-76)

1. Keyboard only on `/plan`: add a holiday inside a school break through "Rule editor" (Kind Holiday, Date type, Month, Day of month, Start offset, Nights, Odd years, Even years), "Add rule". A fixed 29 February is refused beside the field: `Enter a date that exists every year.`
2. Reorder holidays with Alt+Up/Alt+Down on `listbox "Rule order"` (one Tab stop). A rule stays in its kind (`A rule moves only within its own kind.`). Two moves within 50 ms are two PUTs, the second with the first reply's ETag.
3. A move refused because another screen changed the draft restores the server's order, writes `This changed while you were looking. It now shows the latest version.`, focus stays on that rule.
4. `status "Plan preview"` follows the latest edit within 300 ms of input and one second of reply: `<planning name>: <n> nights, <other name>: <n> nights in <year>`; an earlier reply arriving late is discarded.
5. "Adopt plan". On `/calendar` the grid (APG grid, roving tabindex, Home/End/PageUp/PageDown, Enter opens the swap dialog on that day) answers `<Ddd D Mon YYYY>: <parent> — <rule> (<kind>), beats <beaten>` for the holiday on both parents' screens.

### 3. Check tonight in a car park (DP-16 to DP-21, DP-74)

1. On a 375×812 touch phone with a wrong clock the other parent reads `Tonight: <name>` and `Next handover: <HH:MM> on <Ddd D Mon YYYY> (<zone>), <from> to <to>` from the server.
2. Scrolling 0 to 1200 px sweeps the year: focused index = min(N−1, floor(s·N/1200)); `data-field` is `split` at s = 0 and the focused night's parent above; counters count to the exact prefix within 250 ms; a sticker drops at the first day of each override run and rests at a 2 to 6° tilt, alternating.
3. A tap on the slider focuses it, makes the day under the point the focused day, and the page jumps to the smallest whole scroll position for it. `Choose a day in <year>.` for a day outside the year; `Enter a real date as DD/MM/YYYY.` for a bad date.
4. Reload, Back or a one-frame jump shows the exact state before any scroll event; a live swap accepted elsewhere recolours the strip within three seconds without moving the scroll. Reduced motion: `split`, full-year counts, resting stickers, arrow-key stepping gives the same answer.

### 4. Ask for a swap, with make-up nights (DP-22 to DP-28, DP-71 to DP-73)

1. `S` anywhere in the Calendar region or the stage opens `dialog "Request a swap"` (focus on First night, Tab trapped, Escape closes and returns focus). Inclusive nights are typed; the API reports half-open intervals.
2. Refusals in the dialog `alert` and beside the field: nights already the sender's, make-up length mismatch, run limit. Send: `Request sent. An email notice is on its way.`
3. The other parent's `list "Waiting for you"` gains the request live (slides in once); Accept by keyboard: `Swap accepted. The calendar now shows it.` Both years change; the PDF carries both lines.
4. Overlapping sends race across processes: exactly one is sent, the loser reads `Those nights are already in another request.`

### 5. A request lapses (DP-31 to DP-34)

1. A sent request stores `answerBy` from the creating process's window; one reminder at `answerBy − REMINDER_LEAD_SECONDS` if later than `sentAt`.
2. On the server clock the sweep lapses it once (log `*.lapsed`, one `lapsed` email per parent). Any answer then: `409 request_lapsed`, screen `This request lapsed at <when>.` Both screens show `Lapsed`.

### 6. Share a cost (DP-35 to DP-40, DP-70, DP-86 to DP-88, DP-90)

1. "Log a cost": Amount takes `1 234,56` style, quote in `status "Cost split"` within 300 ms of input (`<planning name> pays <money>, <other name> pays <money>`); too many decimals shows `Enter the amount using a decimal comma, with at most <n> decimal places.`
2. "Attach receipt" (≤ 5 MiB; the bytes are stored, read back and compared); "Send request". Either parent edits the split under conditional writes (one winner, the loser sees the latest). The answerer accepts, the payer settles (`Marked as settled.`). Ledger, Balance and the rebuilt statement agree exactly; the receipt downloads byte for byte under its non-ASCII name.

### 7. Amend the plan (DP-43, DP-44, DP-66, DP-67)

Draft starts as the newest adopted version with Effective from empty. Adopting needs a date after today and no sent cost on or after it; drafts from that custody day take the new split and a new ETag in the same transaction; a pending swap whose nights moved answers `409 swap_nights_changed`.

### 8. Produce and share the year (DP-45 to DP-50, DP-62, DP-79)

A year record is `Queued` → `Being made` → `Ready`, three idempotent steps (render, write, read back and compare), resumable on any process; outages show `The PDF service is down...` / `Storage is down...`; three failed attempts make it `Failed`. A share link (`Expires` typed `DD/MM/YYYY HH:MM` in the plan zone) opens `/share/<token>`; its address gains `?year=` with `replaceState`; Previous year / Next year are links; a revoked or expired link shows `This link no longer works.` on its next view.

## Palette roles

| Role | Hex | Source |
|---|---|---|
| ground | `#fcfbfa` | brief: Visual design (near-white ground) |
| surface | `#f1efec` | brief: Visual design (light grey secondary surface) |
| ink | `#15110f` | brief: Visual design (near-black ink) |
| muted | `#6b645f` | brief: Visual design (mid-grey muted) |
| mint (planning parent) | `#c9ecd8` | brief: Visual design (soft mint) |
| pink (other parent) | `#f8d4e2` | brief: Visual design (soft pink) |
| accent (the one main pill) | `#15603c` | brief: Visual design (deep green) |
| card | `#ffffff` | brief: Visual design (white cards) |

## Type, space and layout

| Item | Value | Source |
|---|---|---|
| Headlines | Dela Gothic One 400 | brief: Type |
| Body | DM Sans 400/500/700, 16 px | brief: Type |
| Heading steps | 1.25 / 1.5625 / 1.953 / 3.052 rem | brief: each step a quarter larger |
| Card radius | 28 px | brief: Composition |
| Target | 44 px minimum | brief: Targets |
| Bar | 64 px; top at 768 and 1280, bottom with five equal links at 375 | brief: Screens and layout |

Layout per screen and viewport is the brief's Screens and layout table, built in `app.css` with `grid-template-areas` (Costs) and explicit grid cells (Calendar, Plan, Records).

## Motion

| Element | Trigger | Duration | Easing | Reduced-motion substitute |
|---|---|---|---|---|
| Counters | focused day changes | 200 ms | ease-out (quadratic) | exact full-year value at once (brief: Counters) |
| Sticker | sweep reaches a run's first day | 420 ms (transform), 200 ms (opacity) | `cubic-bezier(0.22, 0.61, 0.36, 1)` | resting at once, no transition (brief: Stickers) |
| Field colour | handover day | 0 | none | `split` and still |
| Dialog | open | 200 ms | same | none |
| New request | arrives live | 420 ms once | same | none |
| Button press | held | 200 ms, 2 px lower | same | none |

## States per async action

| Action | Pending | Success | Failure |
|---|---|---|---|
| Sign in | `Signing in...`, `aria-disabled` | route per Interactions | field copy beside Password; `Too many tries...` |
| Draft save, adopt | `Saving...`, `Adopting...` | `Draft saved.`, `Plan adopted. The calendar now uses it.` / `Amendment recorded. It applies from <date>.` | field copy; stale: `This changed while you were looking. It now shows the latest version.` |
| Send, Accept, Decline, Withdraw, Settle, Delete | `Sending...` etc. | brief: Feedback states | lapsed: `This request lapsed at <when>.`; stale copy |
| Receipt | `Uploading receipt...` | `Receipt stored.` | storage down: `Couldn't reach storage – nothing was saved. Try again.` with a "Try again" button that reuses the key |
| Year record | `Requesting...` | `Year record requested.`, `Rendering the year record...`, `Year record stored. Download is ready.` | `The year record couldn't be made. Try again.` |
| Any page load while the database is cut | — | — | `Couldn't reach the household data – try again` on a white card with "Try again" |
| Stream drop | — | banner clears on reconnect | `Live updates paused. Reconnecting...` (own status, never in Activity) |

## Breakpoints

375, 768 and 1280 wide (brief: Browser support). No page scrolls sideways at any of them (brief: Screens and layout).

## Media and licences

No photographs, icons or video. Four self-hosted Latin woff2 files (Dela Gothic One 400; DM Sans 400, 500, 700), SIL OFL 1.1, from Fontsource; each listed in `app/assets.json` with its hash. The empty-state sticker and rule stickers are drawn in code (`original`). (decided: the brief asks for stickers "drawn in code")
