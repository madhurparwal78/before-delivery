# TRUTH — Vellichor Holdings Tracewell

The golden's ground truth. Each value says where it came from: `brief: <section>` (copied from `instruction.md`) or `decided: <why>` (the brief is silent; the reason ties it to the brief's intent). Nothing here narrows or widens a brief rule; where a rule is long, the brief section is named and its wording is the rule.

## Journeys

### 1. Reading the board (brief: Journeys 1)

| Step | Start state → action → visible end state | Source |
|---|---|---|
| Open `/` on a weekday afternoon | The board shows the three-clock rail: equity session open, ETH price live, and the holdings week ending on the latest published Sunday. Beside it are four figure tiles. Each tile has a large numeral, a clock badge, an as-of time and a filing citation. | brief: Journeys 1 |
| First paint | `status "Board updates"` reads `Loading figures...` until the first successful `GET /api/board`. | brief: Feedback states "Board loading" |
| Phone | The rail is a compact strip; `Equity session details` (and the other two details buttons) toggle `aria-expanded` and show or hide the full status line; the state survives refreshes and failed refreshes. | brief: Journeys 1, Interactions "Mobile clock details" |
| Refresh | The board asks for its state on load and on the board cadence; values update in place; a failed refresh shows `Figures could not be refreshed. Showing the last loaded figures.` and keeps everything; the next success clears it. | brief: Interactions "Board refresh" |
| Past the close | When two successive successful responses go from open to closed, `status "Board updates"` reads `Equity session closed. Share price is now the <date> official close.` once; the mNAV tile's share-price input reads `Official close <date>`. | brief: Feedback states |
| New week published while a history link is focused | The new week appears at the top of the history; rows already there stay put; focus stays on the link. | brief: Journeys 1, Interactions "Weekly history in place" |

### 2. Unspooling a figure (brief: Journeys 2, Motion and effects)

| Step | Action → end state | Source |
|---|---|---|
| Activate `Unspool ETH per 1,000 diluted shares` | The numeral splits into operand chips (ending ETH balance ÷ assumed diluted shares × 1,000), spread beneath the tile; the input that sets the as-of gets a burnt-orange outline; a thread draws from each filed input's chip to that input's own row in the panel's exhibit table; the panel shows the accession number and SHA-256. | brief: Journeys 2 |
| Board refreshes underneath | The open trace does not move or change; the traced tile keeps its numeral until the trace closes. | brief: Interactions "An open trace through refreshes" |
| Scroll, resize | Threads re-anchor within 300 ms without replaying the draw; below 768 px the threads are removed and the panel becomes a bottom sheet, still open on the same input. | brief: Interactions "An open trace through a resize or a scroll" |
| `Open exhibit <accession>` | Fetches inside the page; on 200 saves exactly the bytes as `<accession>.pdf`; the trace stays open with focus on the link. | brief: Interactions "Opening an exhibit" |
| Close | The sequence reverses within 600 ms; no `dialog "Trace: …"`, chip or thread remains; focus returns to the tile; the tile shows the newest figure within 5 s. | brief: Interactions "Closing a trace" |
| Reduced motion | The inputs appear at once as an ordered list; no threads; the panel opens in place; focus on the first input button. | brief: Motion and effects "Reduced motion" |

### 3. Drafting a week (brief: Journeys 3)

| Step | Action → end state | Source |
|---|---|---|
| Sign in | Tamsin Okafor signs in at `/staff`. | brief: Journeys 3 |
| Draft | Tamsin starts the draft for the week after the latest published week: with the seed data, the week ending 2026-11-01. | brief: Journeys 3 |
| Fill | Six exhibit rows and one share-count event, accession `0002093117-26-000052`, page 1 (the brief's example week). | brief: Journeys 3 |
| Session ended mid-edit | `Save draft` answered 401 opens `dialog "Sign in to continue"` with every typed value in place; the same user signing in resends the interrupted request once with the identical body; a different user sends nothing. | brief: Journeys 3, Interactions "An ended staff session" |
| Hyperlinked PDF | Refused at once with `This PDF contains active content, links, embedded files or encryption. Print it to a new PDF and try again.`; nothing reaches the vault. | brief: Journeys 3, Feedback states |
| Double drop | Both uploads accepted, each adds its own pair of versions and its own two audit lines; the published key is written once; `Exhibit verified — SHA-256 <sha256> matches the vault copy.` | brief: Journeys 3; decided: while any upload is still in flight the live region keeps the progress copy and announces the outcome of the last one answered, so a double drop is announced once and never as verified while a file is still being checked |

### 4. Review, release and withdrawal (brief: Journeys 4)

| Step | Action → end state | Source |
|---|---|---|
| Stale tab clear | `Clear for release` sent with an old version is refused with `This restatement changed since you opened it. Reload to see the current version.`; ticks stay; the restatement stays in review. | brief: Journeys 4, Feedback states |
| Release during the session | The dialog's `Release timing` line (read from `GET /api/board`) says `Releasing now queues it to the <time> ET session close on <date>.`; confirming queues the release to that day's session close (13:00 on an early-close day); the board keeps the prior week. | brief: Journeys 4, Release timing |
| Network drop on Release | `The release could not be confirmed. Press Release to try again; it will not be released twice.`; `Release` stays enabled; pressing again resends the same `Idempotency-Key` and shows the stored outcome. | brief: Interactions "Release dialog" |
| Withdraw | `Release withdrawn — the restatement is cleared again.`; nothing reached the public; it can be released again without a new review. | brief: Journeys 4 |
| After the close instant | The withdraw is refused (409 `invalid_transition`); the week publishes at its release time exactly once. | brief: Withdrawing a queued release |
| Cancel before the answer | The late answer appears in `status "Staff updates"`; the reopened dialog stays open and clean. | brief: Interactions "A response belongs to the dialog session that sent it" |
| Cross-site post | Refused 403 `cross_origin`; nothing changes. | brief: Server boundary |

### 5. Correction, a correction of the correction, and the audit trail (brief: Journeys 5)

| Step | Action → end state | Source |
|---|---|---|
| Simultaneous `Start correction` | Exactly one correction draft is created; the other analyst sees `Something went wrong. Nothing was changed.` and the list stays open. | brief: Journeys 5, Interactions "Starting a draft" |
| Publish | An officer who neither prepared nor cleared it releases it; the board shows the corrected figures; the superseded week stays in the history marked Restated with its date and reason, linked to the superseding row; its exhibit still downloads byte for byte. | brief: Journeys 5 |
| Chain | The history shows the newest row, then the first correction, then the original, each superseded row naming its own superseder and reason. | brief: Journeys 5 |
| Audit trail | One line per version: who (or Tracewell), when, why. | brief: Journeys 5 |

### 6. Citing a date (brief: Journeys 6)

| Step | Action → end state | Source |
|---|---|---|
| `/cite/eth-per-1000-diluted/2026-10-20?step=diluted-shares` | The figure as it stood at the end of that New York day, marked Restated, with the trace open on the assumed-diluted-shares input; a week later the same URL shows the same digits, inputs and exhibit. | brief: Journeys 6 |
| Today's mNAV citation | Shows `Provisional — <date> has not ended; this figure may still change.`; numeral, as-of line and clock badge follow each new tick in place while the analyst reads; once the server's New York date moves on the marker drops by itself and the page never changes again. | brief: Journeys 6, Interactions "Provisional citations follow the server" |

### 7. Vault outage (brief: Journeys 7)

| Step | Action → end state | Source |
|---|---|---|
| Board | Every figure still shows, with `Filing vault unavailable — exhibits are temporarily unavailable. Figures shown are unchanged.` in `region "Notices"`. | brief: Journeys 7, Feedback states |
| Open exhibit in a trace | The page stays on the open trace, focus stays on the link, and `status "Exhibit download"` reads `Filing vault unavailable — this exhibit cannot be downloaded right now. Figures shown are unchanged.` until the link is pressed again. | brief: Journeys 7, Interactions "Opening an exhibit" |
| Upload | The editor shows `Exhibit pending verification` and Send unavailable, then returns to its exact prior state; `Filing vault unavailable — the exhibit was not stored. Try again when the vault is back.` stays until a file is chosen again. | brief: Journeys 7, Interactions "Uploading an exhibit" |
| Recovery | Within 10 seconds of the vault becoming reachable `vault` returns to `available`; downloads and uploads work without a restart. | brief: Services "Vault outage" |

### 8. Stale tape and rehearsal (brief: Journeys 8)

| Step | Action → end state | Source |
|---|---|---|
| `/operator` | `Tape playing at position <n>` or `Tape paused at position <n>` and `Market clock <date> <time> ET`, both refreshed every few seconds. | brief: Journeys 8, Feedback states |
| Pause, wait past the stale threshold | The ETH clock shows `Stale — no ETH tick since <time> ET`; the mNAV tile's ETH price chip shows its last tick time. | brief: Journeys 8 |
| Redelivery race | One tick and one mNAV computation are stored; every other delivery gets the stored tick back. | brief: Journeys 8, API "Internal ticks" |
| Rehearsal clock past a queued close | The server stores that close's mNAV and publishes the queued restatement at the close instant, exactly once. | brief: Journeys 8 |
| Mistyped time | `Enter a time as YYYY-MM-DD HH:MM:SS in New York time.` stays through every refresh. | brief: Journeys 8, Feedback states |

## Palette roles (hex values the build uses)

| Role | Hex | Source |
|---|---|---|
| ground | #F3ECD9 | brief: Visual design "The page is a warm, slightly yellowed paper ground"; decided: the hex (lightness above 85%, hue 44°, saturation 52%) |
| ink | #15171F | brief: Visual design "Text and numerals are a near-black ink with a faint blue cast"; decided: the hex |
| rule | #BFB5A0 | brief: "Hairline rules are a warm stone grey"; decided: the hex (lightness 69%, saturation 19%) |
| accent | #1D3FD1 | brief: "One saturated ultramarine blue is the trace accent, used only while a trace is in progress"; decided: the hex (hue 229°, saturation 76%) |
| stale | #A8420A | brief: "A burnt orange marks staleness"; decided: the hex (hue 21°, saturation 89%, 5.16 to 1 on the paper) |
| focus | #15171F | brief: "Focus is shown by a thick ink outline, never the accent blue" |

All text and numerals are the ink; hierarchy comes from size, weight and the mono face. The trace panel, bottom sheet and dialogs sit on the same paper ground and are set apart by a one pixel ink edge, because the brief colours nothing else.

## Type

| Role | Value | Source |
|---|---|---|
| Headings and wordmark | Archivo | brief: Visual design Type "Headings and the wordmark use Archivo"; decided: weight 700 |
| Body | IBM Plex Sans | brief: "Body text uses IBM Plex Sans"; decided: weights 400 and 600 |
| Numerals | IBM Plex Mono with tabular figures, right-aligned | brief: "Every numeral on the board, in the history table, in the audit trail and in the trace uses IBM Plex Mono with tabular figures. Numerals are right-aligned so the decimal points line up down a column."; decided: weights 400 and 500 |
| Scale | each heading level about a third larger than the level below (ratio 1.333 from 1rem) | brief: "Each heading level is about a third larger than the level below it, so a tile numeral is roughly two and a third times the body size." |
| Tile numeral | 2.333rem (two and a third times a 1rem body), capped by the tile width so the longest numeral never wraps | brief: same sentence; decided: the cap |
| Fonts | five self-hosted woff2 files, SIL OFL 1.1 | brief: "The app serves all fonts itself." |

## Space, layout per viewport and breakpoints

| Viewport | Layout | Source |
|---|---|---|
| 1280 and wider | Fixed clock rail on the left (192 px wide, decided) that stays in view while the page scrolls; four-column grid; history table below; trace panel on the right edge at one third of the viewport, full height; the page behind it stays scrollable | brief: Screens and layout "1280x800 and wider" |
| 768 up to 1279 | Horizontal strip of three clock items with full status lines; two-column grid in reading order; trace panel on the right at about half the viewport | brief: Screens and layout "768x1024 up to 1279 px" |
| 375 up to 767 | Strip of three compact items (clock name, short status word, details button); full line below the strip only while expanded; while an item is collapsed its full status line is either not rendered or hidden, so that it is not visible, not focusable and not in the accessibility tree (this build does not render it); single-column grid; history rows are stacked cards of label/value pairs; trace is a bottom sheet up to about 85% of the screen height that scrolls on its own and locks the page behind it | brief: Screens and layout "375x812 up to 767 px" |
| Breakpoints | exactly 768 px and 1280 px | brief: Common rules |
| Touch size | every interactive control at least 44 by 44 px | brief: Targets and contrast |

## Motion

| Element | Trigger | Duration | Easing | Reduced-motion substitute | Source |
|---|---|---|---|---|---|
| Chips (split and spread) | activation | about a quarter of a second (250 ms) | starts quickly, settles softly: cubic-bezier(0.2, 0.8, 0.2, 1) | ordered list appears at once | brief: Motion step 1 |
| Panel / sheet | activation, starting about a sixth of a second in (167 ms) | about a quarter of a second (250 ms) | same | appears in place | brief: Motion step 3 |
| Threads | same moment, 768 px and wider | about four-tenths of a second (400 ms), progressive draw | same | none drawn | brief: Motion step 3 |
| Closing | Escape, `Close trace`, outside click on desktop | in about the same times, all within 600 ms | same | removed at once | brief: Motion "Closing runs the steps in reverse" |
| Tile rule | hover or press | within a tenth of a second (90 ms) | ease-out | no transition | brief: Small effects |
| Dialogs | open and close | about a sixth of a second (167 ms) fade | same | none | brief: Small effects |

## States per async action

| Action | Pending | Success | Failure | Source |
|---|---|---|---|---|
| Board refresh | `Loading figures...` (first load); decided: ruled placeholder tiles, rail items and history rows of the real size so nothing shifts | values update in place | `Figures could not be refreshed. Showing the last loaded figures.` | brief: Feedback states |
| Open exhibit | status empty | file saved | vault: `Filing vault unavailable — this exhibit cannot be downloaded right now. Figures shown are unchanged.`; other status: `Something went wrong. Nothing was changed.` | brief: Feedback states |
| Save draft | none | `Draft saved.` | version conflict copy; `There is a problem with this draft` alert; 401 opens the sign-in dialog | brief: Feedback states, Interactions |
| Upload exhibit | `Uploading exhibit and checking SHA-256...`, `Exhibit pending verification`, Send disabled | `Exhibit verified — SHA-256 <sha256> matches the vault copy.` | mismatch, not a PDF, not filing-safe, too large, no saved accession, vault down copies | brief: Feedback states |
| Release | Release disabled until the box is ticked | queued or released copy | unconfirmed, two-person, state-changed or unexpected copy | brief: Feedback states |
| Withdraw | Withdraw disabled until the note is 10 to 500 characters | `Release withdrawn — the restatement is cleared again.` | `This restatement has already published or changed. Refresh to see its current state.` | brief: Feedback states |
| Operator actions | none | `Tape paused.`, `Tape playing.`, `Clock set to <date> <time> ET.`, `Clock follows real time.` | `Enter a time as YYYY-MM-DD HH:MM:SS in New York time.` | brief: Feedback states |

## Media and licences

| Asset | Licence | Source |
|---|---|---|
| Archivo 700, IBM Plex Sans 400/600, IBM Plex Mono 400/500 (woff2) | OFL-1.1 | npm `@fontsource/*` 5.3.0, files copied to `web/fonts` |
| Four seeded exhibit PDFs | original | generated by `scripts/make-seed-exhibits.ts` |
| Icons, threads, rules | original (inline SVG and CSS) | decided: no icon pack needed |
