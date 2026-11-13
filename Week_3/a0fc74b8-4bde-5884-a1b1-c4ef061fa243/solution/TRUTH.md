# TRUTH — Wickmoor Paper Co. Undersign

The golden's ground truth. Every value carries its source: `brief: <section>` (copied from `instruction.md`) or `decided: <why>` (the brief is silent; the reason ties it to the brief's intent).

## 1. Journeys

### J1 Prepare a document (brief: Journeys 1; DP-01 to DP-09)
1. Start: a member is signed in on `/documents` (brief: Journeys 1).
2. Choose `Upload PDF`, pick a three-page PDF. The button is disabled and `aria-busy`; the `Document updates` region says `Uploading <file name>...` (brief: Pending, success and error). On success the browser opens `/documents/<id>`; the draft's `originalSha256` equals the file's SHA-256 and the bytes sit at `documents/<id>/original.pdf` in MinIO (brief: DP-01, Services/MinIO).
3. The page shows `Page 1 of 3` to `Page 3 of 3` groups (ids `page-1`..`page-3`) and a `Pages` filmstrip with `Page 1`..`Page 3`; ArrowUp/ArrowDown move focus, Enter scrolls to the page and focuses its group (brief: Interactions/Pages).
4. Add a signer (Name, Email, Enter or Add signer; focus returns to Name). Place a signature field and a date field with the mouse (drag a toolbar button onto a page), with touch (tap the button, `aria-pressed="true"`, tap the page; decided: arming deselects the selected field so its phone sheet does not cover the page being tapped) or from the keyboard (Enter or Space on the toolbar button: default size, centred on the current page, selected, focused, announced in `Field position`) (brief: Interactions/Field editing).
5. Nudge with arrows (0.005, Shift 0.05), resize with Alt+arrows, move pages with PageDown/PageUp, delete with Delete; each change is saved at once and announced `Signature 1: page 2, x 0.350, y 0.470, width 0.300, height 0.060` (brief: Feedback states/Announcements).
6. Assign to a signer in `Field properties`, toggle `Required`, edit `Label`; the field's name follows (`<label> for <name>`) (brief: DP-06).
7. End: a reload shows every field at the stored page fractions (brief: Journeys 1; DP-07).

### J2 Route and send (brief: Journeys 2; DP-11 to DP-15)
1. A draft has three signers; `Move <name> up` on the third keeps focus on the moved row's pressed button (or moves to its other move button when it disables) and announces `<name> is now signer 2 of 3` (brief: Interactions/Field editing table).
2. `Send for signing` opens a dialog listing `<order>. <name> (<email>)`; Send with a signer lacking a required signature field shows `Every signer needs a signature field. Missing: <names in signing order joined with ", ">` inside the dialog and sends nothing (brief: Feedback states).
3. After fixing, `Send`: the dialog closes, focus moves to the document heading, `Signing order updates` says `Sent for signing. <name> has the first turn.`; only signer 1 has an invitation email (`Please sign: <title>`, `Open the document: <APP_PUBLIC_URL>/sign/<token>`); the rows read `Invited`, `Waiting`, `Waiting` (brief: Journeys 2).
4. A repeat send with the same `Idempotency-Key` returns the first response; simultaneous sends or finishes let exactly one through (brief: DP-15).

### J3 Guided signing (brief: Journeys 3; DP-16 to DP-24)
1. Signer 1 opens `/sign/<token>`. The page scrolls so the first incomplete required field's top is between 30% and 40% of the viewport; the `#aperture` frame sits on that field's box, everything else dims, focus enters the field, `Signing progress` says `Field 1 of <n>: <label>, page <p>`, and the header shows `<n> left` (brief: Interactions/Signer view).
2. Activating an empty signature or initials field opens `Adopt your signature` / `Adopt your initials` (Type or Draw tabs switched with ArrowLeft/ArrowRight, `Full name` prefilled with the signer's name, `Initials` with the first letters in capitals, `Adopt and sign` disabled until there is text or a stroke). Type stores `typed:<text>`, Draw stores `drawn`; later empty fields of the same kind fill with one activation.
3. Next, Enter in a completed field or Tab out of a completed field move the aperture over about 0.38 s and scroll to the next incomplete required field (date fields are not walked); `<n> left` rolls down; the announcement repeats. With nothing left, Next moves the aperture and focus to `Finish and sign` and the count reads `0 left`.
4. `Finish and sign` with fields left shows `Complete <n> required fields first.` and returns the aperture and focus to the first incomplete field; with all complete it signs. The page now reads `You signed <title>` with `Waiting for <name> (signer <k> of <n>).` Within 3 s the sender's page shows signer 1 `Signed` and signer 2 `Invited` (brief: Journeys 3; DP-13).

### J4 Completion (brief: Journeys 4; DP-32 to DP-36)
1. The last signer finishes. The document is `Sealing` with Next step `Sealing the completed PDF` until the sealed PDF is confirmed stored at `documents/<id>/completed.pdf`; then `Completed`. Audit events from the last signature are exactly `recipient.signed`, `document.sealed`, `document.completed` (brief: Business rules/Completion).
2. Every party gets one `Completed: <title>` email with `SHA-256 of the completed PDF: <hash>` and `Download: <link>`; the downloaded file's SHA-256 equals `completedSha256`, it has the original pages with field values drawn plus one certificate page (`Certificate of completion` and the published lines in Helvetica) (brief: Business rules/Completed PDF).
3. While storage is down the document stays `Sealing`; the main instance seals it no sooner than `SEAL_RETRY_SECONDS` and no later than that plus 3 s after the failed attempt (brief: DP-33).

### J5 Decline or void (brief: Journeys 5; DP-25 to DP-28)
1. The current signer chooses `Decline`, enters a reason (1 to 500 characters, live counter `<n> of 500 characters`, empty error `Enter a reason for declining.`) or the owner/team owner voids with `Void document` (`Enter a reason for voiding.`).
2. Every outstanding link shows the published declined or voided page; earlier signatures read `Not binding`; the sender's page shows `<name> declined: <reason>` or `Voided by <voider name>: <reason>`. Only the sender and earlier signers (plus, on a void, the person whose turn it was) get `Declined: <title>` / `Voided: <title>` with `Reason: <reason>`. Links cannot read the PDF, fill, sign or decline (`409 link_closed`).

### J6 Outages and expiry (brief: Journeys 6; DP-30, DP-31, DP-37, DP-38)
1. Email down: invitations are held (`delivery: held`, row `Not delivered yet`, Next step `Invitation not delivered yet to <name>`, event `invite.held`) and `Email is unavailable. Invitations are held and sent when email recovers.` shows in `Service notice`. The main instance delivers each exactly once no sooner than `MAIL_RETRY_SECONDS` after it was held and no later than that plus 3 s, writes `invite.sent`.
2. A link expires `LINK_TTL_SECONDS` after its turn began; the server checks at least every 2 s and pushes; the sender sees `Link expired` and Next step `Link expired for <name>`; `Send reminder` is absent; `Send a new link` mails a fresh link (`New link: <title>`), announces `New link issued for <name>.`; the old link stays expired.
3. Reminders: once per `REMINDER_COOLDOWN_SECONDS`; the button reads `Next reminder after <YYYY-MM-DD HH:MM> <time zone>` and returns to `Send reminder` within 3 s of `reminderAvailableAt`; email down answers 503 and does not start the cooldown.

### J7 Team and templates (brief: Journeys 7; DP-40 to DP-43)
1. An owner saves a draft as a template (`Save as template`), shares it (`Share <name>`); a member opens `/templates`, `Use template`, fills `Name for Signer <k>` / `Email for Signer <k>`, `Create draft` opens a draft with the same fields at the same fractions and a byte-identical original.
2. The owner changes the member's role in `Role for <name>`; the member's open pages show `Your role is now Viewer.` and lose upload and edit controls within 3 s. A team needs one owner (`A team needs at least one owner.`). Another team's document answers 404 and the page shows `Document not found` with `Check the link, or ask your team owner.`
3. A signed-out visit to a team page goes `302 /sign-in?next=<path>`; after sign-in the app returns there only for a same-origin path starting with exactly one `/`, else `/documents` (brief: Server boundary).

## 2. Palette roles (brief: Visual design; hex values decided to satisfy the brief's roles and WCAG AA)

| Role | Hex | Source |
|---|---|---|
| ground | #F6EFE0 | brief: Visual design, a warm off-white like ledger paper (hsl 40°, 56%, 92%) |
| ink | #16202E | brief: Visual design, a deep blue-black ink (hsl 214°, 35%, 14%) |
| muted ink | #4F5B6B | decided: secondary text, 5.9:1 on ground |
| hairline | #D6CBB4 | brief: hairlines of a soft greyish tan, one pixel |
| control edge | #6B7482 | decided: control boundaries need 3:1 against ground |
| parchment wash | #EFE3C6 | brief: Fields, a pale parchment wash with a thin ink frame |
| paper (page well, inputs) | #FFFDF7 | decided: the sheet a PDF page sits on |
| seal red | #C2371A | brief: one vermilion (hsl 10°, 76%, 43%), 4.7:1 on ground both ways |
Seal red is used only for `Send for signing`, `Send`, `Adopt and sign`, `Finish and sign`, the active field's frame, the aperture, the signed number circle and the rule beside errors. No card, panel or dialog has a shadow (brief: Density and depth).

## 3. Type (brief: Visual design/Type)
Fraunces 600 for headings (h1 31.25px, h2 25px, h3 20px, each a quarter larger than the one below from 16px body); Public Sans 400/600 16px/1.55 for body and controls; IBM Plex Mono 400/500 14px for hashes, timestamps, position read-outs and counters. All three are self-hosted woff2 files served from `/fonts/`.

## 4. Space, size and layout per viewport (brief: Screens and layout)
- Spacing unit 8px; groups roughly a line (24px) apart; every control at least 44px tall and wide at 375 (decided from brief: Composition).
- 1280: three panes on the document page (filmstrip 148px, centre pages, routing column 340px); `Field properties` slides in over the routing column. Signer pages in a centred column (max 760px) with a full-width sticky header.
- 768: the filmstrip becomes the `Page` combobox (`Page <n> of <count>`); routing column 280px on the right.
- 375: pages fill the width; the routing column is the bottom sheet `Signing order` opened by the `Signing order` button; `Field properties` rises as a bottom sheet; documents show as a card list; the signer header controls wrap onto two rows of 44px buttons; the Adopt dialog is at most `100vw - 24px` wide with a pad at least 140px tall.
- Pages keep the PDF aspect ratio (CSS `aspect-ratio` from the stored page size) and are exactly as wide as the centre column; fields are placed with percentages of the page.
- No sideways scroll at 375, 768 or 1280 (brief: Screens and layout).

## 5. Motion (brief: Motion and effects)

| Element | Trigger | Duration | Easing | Reduced-motion substitute |
|---|---|---|---|---|
| Aperture (`#aperture`) left/top/width/height | Next, Previous, Enter, Tab, focus of another field | 380ms (brief: 0.3 to 0.45 s) | cubic-bezier(0.2, 0.7, 0.2, 1) | jumps to the next box; scroll instant |
| Page scroll (native smooth) | same moves | native smooth, about the same span | browser | instant |
| `<n> left` numeral | count drops | 200ms | cubic-bezier(0.2, 0.7, 0.2, 1) | swaps without rolling |
| Dimming layer opacity | signing view opens | 330ms | ease-out | appears at once |
| `Field properties` panel (translateX from the right) / phone sheets (translateY from the bottom) | field selected or deselected, `Signing order` button | 300ms | cubic-bezier(0.2, 0.7, 0.2, 1) | appears and disappears at once |
| Button background | pressed | 90ms | ease-out | none |
The aperture and sheets are Web Animations whose time is advanced from `requestAnimationFrame`, so the page clock the verifier pauses and advances moves them. Closing mid-slide reverses the same animation from where it is; it ends unmounted. No loops anywhere.

## 6. States of each async action (brief: Feedback states)

| Action | Pending (region) | Success | Errors |
|---|---|---|---|
| Upload PDF | `Uploading <file name>...` (Document updates), button disabled + `aria-busy` | opens the draft | refusal copy per error code as an `alert`, focus back on `Upload PDF` |
| Send | `Sending...` (Signing order updates) | `Sent for signing. <name> has the first turn.`, focus to heading | `Every signer needs a signature field. Missing: ...` in the dialog |
| Send reminder | `Sending reminder...` | `Reminder sent to <name>.` | cooldown copy / `Email is unavailable. Try the reminder again later.` |
| Send a new link | `Issuing a new link...` | `New link issued for <name>.` | `Something went wrong. Try again.` |
| Void | `Voiding...` | outcome banner | `Enter a reason for voiding.` under the box |
| Finish and sign | `Signing...` (Signing progress) | signed state page | `Complete <n> required fields first.` |
| Decline | `Declining...` | decliner's declined page | `Enter a reason for declining.` under the box |
| Sign in | none | goes to the return page | `Email or password is incorrect.` |
| Role change | none | combobox shows the new role | `A team needs at least one owner.` (decided: the refused choice stays in the combobox, `aria-invalid` and described by the alert, like any invalid entry, until the next change or visit) |

## 7. Backend facts (brief: API, Business rules, Services)
- One error shape `{"error": "<code>"}`; precedence 413, 401, 404, idempotent replay, 403, 409 then 429, 422, 503.
- Field geometry is stored once as page fractions rounded to 4 decimals, inside the page and at least 0.02 by 0.02.
- Links are 256-bit random secrets stored as SHA-256 hashes; a reminder or a completed-copy download link is an additional link for the same recipient (decided: only hashes are stored, so a reminder cannot repeat an earlier token); a new link marks the earlier ones replaced.
- Held mail lives in a PostgreSQL outbox claimed with an atomic update so each is delivered once; only an instance whose latest email and storage checks passed retries mail or seals.
- Editor and signer pages drop a read that overlapped one of their own writes and read again once the writes settle (decided: a read that predates a save must never undo it on screen; brief: Saved changes are visible within 2 seconds).
- The signature pad keeps its own touches (non-passive `touchstart`/`touchmove` cancelled) so drawing never starts a page gesture (brief: Drawing never scrolls or zooms the page).
- Audit hash: `sha256(<prevHash>|<seq>|<type>|<recipientId or ->|<at>)`, first `prevHash` 64 zeros.

## 8. Media and licences
No raster images. The empty-state ledger sheet and the icons are inline SVG (own drawing; Lucide, ISC). Fonts: Fraunces, Public Sans and IBM Plex Mono, SIL OFL 1.1, in `app/public/fonts/` and `app/assets.json`. pdf.js (Apache-2.0) renders PDF pages in the browser from the app's own origin, worker included.
