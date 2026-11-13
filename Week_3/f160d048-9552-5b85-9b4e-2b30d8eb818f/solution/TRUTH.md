# TRUTH — Candour Bench golden

Every value says where it came from: `brief: <section>` (copied from the brief) or `decided: <why>` (the brief is silent; the reason ties it to the brief's intent). Where this file and the brief differ, the brief wins.

## Journeys

### 1. A locked member contributes and unlocks (brief: Journeys 1)
- Start (brief: Journeys 1): a signed-in member with no approved post opens a company page and sees cut review text, no pay figures and the "Contribute once to unlock" panel.
- The page cuts `pros`, `cons` and interview note `text` to their first 140 characters followed by `…`, with `truncated: true`, and every pay row has `band: null` (brief: Business rules, Contribute to unlock).
- They follow `Share something`, write a review through the four steps using only the keyboard (steps `Company`, `Ratings`, `Your review`, `Check and post`; each Next on a valid step moves focus to the next step's heading; an invalid Next keeps the step, shows the error under the field linked through `aria-describedby` and moves focus to the first invalid field) and post it (brief: Interactions, Review form steps).
- They land on `/me/contributions` with the review `Pending`; a toast and the announcement read `Thanks. Your review is waiting for a moderator.` (brief: Feedback states).
- A moderator claims the post: the author's item reads `Claimed` with no announcement. The moderator approves: the item reads `Approved` and the announcement reads `Your review for <company name> was approved.` (brief: Feedback states).
- The member is unlocked at the first approval, stored on the account, and the open company page shows full text and pay figures without a reload, with the announcement `Full pay and review detail is now unlocked.` It still does after a reload and on another device (brief: Business rules, Contribute to unlock).
- Provider record: the account row has `unlocked = true`; the company's search document is updated before the approval answers; one outcome email waits in the outbox and is sent once to Mailpit (brief: Services, Mailpit).

### 2. Moderators share the queue (brief: Journeys 2)
- Two queues open. A claim records the claimant and claim time in one transaction; the other queue shows `Claimed by <moderator display name>` live (brief: Feedback states).
- The claimant's choice in `Decision` or `Reason`, and typing in `Reason details`, call renew at most once every 5 seconds on the page clock; the first action renews at once and any action within 5 seconds after a renewal is dropped (brief: Business rules, Moderation state machine, Lease renewal).
- Submit records the decision; the row reads `Approved by you` or `Rejected by you`; focus moves to the next row's `Claim` button, or to `link "Back to job search"` when none is left (brief: Feedback states).
- A stale button answers the 409 message in the page's single `alert`; focus stays on the pressed button (brief: Feedback states).
- A claim left without a decision returns to pending when at least `CLAIM_LAPSE_SECONDS` have passed since it was made or last renewed (brief: Business rules, Timers and limits). The claimant's decision form closes and the alert reads `Your claim on this post expired. Claim it again to decide.`
- Each claim, renewal, lapse and decision appends one history event in the same transaction, shown in `list "History of <post label>"` live: `Claimed by <name>`, `Claim renewed by <name>`, `Claim expired`, `Approved by <name>`, `Rejected by <name>: <reason>` (brief: Business rules, History).

### 3. A pay band resolves (brief: Journeys 3)
- Under the threshold the row reads `<n> of <threshold> reports. The range opens at <threshold>.` and the tile shows the frosted hatching with only that sentence. No figure from those reports leaves the server (brief: Business rules, Derived values).
- When an approval brings the row to the threshold for an unlocked viewer: the row's count text changes at once to `<n> reports`; the announcement `Pay range now shown for <role name>` is made; if the row is in the tile the hatching withdraws (`band-unhatch` `running` → `done`), the low, median and high figures count up (`band-count` `running` → `done`) and end exactly on the server's values, and a median tick marked `data-part="median-tick"` drops onto the band at the median's position (brief: Motion and effects, Signature: Band resolve).
- Percentiles are 25th, 50th and 75th, interpolated linearly between closest ranks and rounded half up to whole rupees (brief: Business rules, Derived values).

### 4. A job seeker searches (brief: Journeys 4)
- The query and chips live in the URL as `/jobs?q=<text>&city=<city id>&role=<role family id>&remote=<work pattern id>&band=<pay band id>&page=<n>`, each pressed value its own repeated parameter; reload and the back button restore the field, chips and results (brief: Interactions, Job search URL).
- Typing, pressing chips and choosing filters run the search 300 milliseconds after the last change, measured on the page's own timers (brief: Interactions, Search debounce). Counts are announced as `Filter added: <label>. <count line>.` or `Filter removed: <label>. <count line>.`
- On a phone the filters live in `dialog "Filters"`, a bottom sheet; `button "Show <n> jobs"`, Escape, or a downward swipe of at least 80 pixels that starts on the sheet's top edge closes it and returns focus to `button "Filters"`. The job page keeps `region "Apply bar"` pinned at the bottom (brief: Interactions, Filter sheet; Screens and layout, Job page on a phone).
- `Save alert` stores the query text and chips; its label is the trimmed query text followed by each chip label in facet order and list order, joined by `, `; `All jobs` when empty. A match adds one to `new_count`, sends `alert.matched`, and once `ALERT_BATCH_SECONDS` have passed since the first match one email lists every job of that batch that is still listed, newest listed first (brief: Business rules, Job alerts).

### 5. A job seeker applies and follows the application (brief: Journeys 5)
- The apply form makes one `Idempotency-Key` when it opens and sends it on every submit, including `Try again` (brief: Business rules, Uploads and applications).
- A resume is a PDF only when its first five bytes are `%PDF-`; `Upload a PDF file.` appears under the field. An application is created only after storage confirms the object exists with the exact stored size; during a storage outage the answer is 503 `storage_unavailable`, the typed answers and chosen file stay, and `Try again` resends them.
- Success: `heading "Application sent"` takes focus. Each later stage move shows on My applications live with `Your application for <job title> is now at <Stage>.` and arrives as one email.

### 6. An employer team answers and hires (brief: Journeys 6)
- The employer admin asks for a code (`A code is on its way to <email>.`), reads it in the inbox (`Your code is <code>. It expires in <minutes> minutes.`), verifies (`Your team is verified.`). More than 3 requests per company within `EMAIL_CODE_TTL_SECONDS` answer 429.
- A team member replies once to a review of its own company; the reply is public at once and appears live under the review with `<company name> replied in <Month Year>`.
- Pipeline: pick up, move and drop cards by keyboard with the published announcements; a move is legal when it goes one step forward, one step back, or from any non-declined stage to `declined`; `declined` is final; any other move answers 409 `invalid_transition` (brief: Business rules, Pipeline).
- `button "Export applicants CSV"` downloads UTF-8 with no byte order mark and CRLF line ends, header `application_id,candidate_name,job_title,stage,applied_on,updated_on`, newest applied first with ties broken by id ascending (brief: Business rules, Applicants CSV).

### 7. Members talk shop (brief: Journeys 7)
- Enter sends the post and Shift+Enter adds a new line; the post appears for everyone as `Anonymous bench member` with the announcement `New post in <channel name>`; the sender hears `Posted in <channel name>.`
- A body with an email address or a phone number is refused with the published copy; both checks ignore any review path.
- A window that lost its live connection gets each missed post once, in order, on reconnect, with one announcement `<n> new posts in <channel name>` (brief: Feedback states).

### 8. The founder checks the site (brief: Journeys 8)
- Console tables: `Service health`, `Members`, `Companies`, `Pay thresholds` (no figure). Appoint a moderator (`<display name> is now a moderator.`), revoke verification (`Verification revoked for <company name>.`), add a company and an employer user (sends the set-password email).

## Palette roles (brief: Visual design, Colour roles; hex values decided)
| Role | Hex | Source |
|---|---|---|
| Ground | `#EDF2F0` | brief: "a very pale, cool grey-green paper"; hex decided |
| Surface | `#D2DDD8` | brief: "a slightly deeper sage-grey"; hex decided |
| Ink | `#0A4747` | brief: "a deep teal for all text"; hex decided |
| Muted | `#2E5E5C` | brief: "a lighter, softer teal"; hex decided so text stays at 4.5:1 or more on ground and surface |
| Accent | `#0A4747` | brief: "the same deep teal" |
| On accent | `#EDF2F0` | brief: "the paper colour" |
| Frost (locked band) | `#E3EBE8` | decided: the frosted tile of "Locked bands" |

## Type (brief: Visual design, Type)
- Literata for display and body, served from the site itself (`/fonts/*.woff2`, SIL OFL 1.1). Body 18px. Reading measure `46ch` in the reading column. Each heading level is a quarter larger than the level below. Figures use `font-variant-numeric: lining-nums tabular-nums`.
- Hero headline `clamp(1.75rem, 1.2rem + 1.1vw, 2.5rem)`, medium weight (brief: Hero, "about 28 to 40 pixels, growing with the window, medium weight").

## Space and layout per viewport (brief: Screens and layout)
- Phone: every width below 640. Tablet: 640 to 1023. Desktop: 1024 and up. No page scrolls sideways at 375, 768 or 1280.
- Company page desktop: two equal halves meet at the horizontal middle; the right field fills the window height, stays pinned and centres the square tile. Tablet: reading column 58% (brief range 55% to 62%). Phone: stacked, tile band 30% of the window height (brief range 25% to 40%), pinned to the top while the content scrolls, then heading, rating figure, `tablist "Company sections"` and one `tabpanel`.
- Landing: desktop and tablet use the same split; on a phone the headline block comes first and the tile follows in the page flow, not pinned.
- Job search facet list: about a quarter of the width on desktop, a third on tablet; phone: full-width results and the filter sheet.
- Every control is at least 44 by 44 pixels (brief: Touch targets).

## Motion (brief: Motion and effects)
| Name | ms | On | States | Reduced motion |
|---|---|---|---|---|
| `star-fill` | 160 | rating radiogroup | `running` → `done` | `data-motion-ms="0"`, `done` at once |
| `save-toggle` | 200 | `button "Save job"` | `running` → `done` | same |
| `filter-sheet` | 280 | `dialog "Filters"` | `opening` → `open`, `closing` → `closed` | same |
| `toast` | 200 | the toast | `opening` → `open`, `closing` → `closed`, leaves `TOAST_SECONDS` after opening | same |
| `card-drop` | 240 | moved card | `running` → `done` | same |
| `band-crossfade` | 420 | the specimen tile | `running` → `done` | same |
| `band-unhatch` | 320 | the tile's hatching | `covered`, `running` → `done` | same |
| `band-count` | 600 | the tile's figures | `running` → `done` | same |
- Easing `cubic-bezier(0.2, 0.8, 0.2, 1)` (decided: "starts quickly and settles gently"). Each motion is an `element.animate()` call whose end state is also set by a timer of the published duration on the page's own timers. `<html>` carries `data-motion-pref="reduced"` or `"full"`.

## States per async action (brief: Feedback states)
- While a request is in flight the button is disabled, the caption `Working` appears beside it and `status "Announcements"` reads `Working`; applying uses `Sending your application` instead.
- A field error appears under its field linked through `aria-describedby`; any other API error appears in the page's `alert` as a full-width teal band with paper text.

## Breakpoints
375 phone, 768 tablet, 1280 desktop (brief: Screens and layout); 390 gets the phone layout.

## Media and licences
- Glassware (pipette rack, flask, centrifuge rotor) and the pay band are drawn by the app as inline SVG from a hash of the company or role name: licence `original`.
- Literata variable WOFF2 (latin and latin-ext, normal and italic) from `@fontsource-variable/literata`: OFL-1.1. Icons: `lucide-react`, ISC. All listed in `app/assets.json` and `app/THIRD_PARTY_NOTICES.md`.

## Decided values the brief leaves open
- decided: ids are random UUID text, so a `company_id` that names no company answers 404 and not a cast error.
- decided: `GET /api/me/posts` items carry the editable `fields` and `GET /api/moderation/queue` posts carry their `history`, so the edit form and the queue need no extra routes.
- decided: the founder console builds its Companies table from the public company search, paging through every result.
- decided: the Alerts item's link carries the alert's stored search as `search`.
- decided: a session lasts 30 days on the server clock, including the grading offset, like every other server-side duration.
