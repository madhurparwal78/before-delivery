# TRUTH — Kettlehole Audio Earshot

The brief made concrete. `brief: <section>` values are copied verbatim; `decided: <why>` values
fill silence in the brief's intent.

## Journeys (ideal end-to-end flow)

### 1. A director listens and sends a brief (brief: Journeys 1)
- Start: `/` loads with the modal `dialog "Sound gate"` open, focus on "Enter with sound", page inert and unscrollable, no AudioContext.
- "Enter with sound" creates the single AudioContext inside the click, the gate fades out (320 ms) and focus moves to the intro heading. `button "Sound on"` reads aria-pressed true.
- Scrolling: a station is current while `scrollY - chapterTop` is 0–1600; intensity = floor(offset/16 + 0.5). The readout `meter "Intensity"` and the station's `data-intensity` follow on every scroll event. `data-camera` reads `moving` then `close` after 880 ms.
- Rung changes update `data-active-layers` (`bed,pulse,…`), replace the URL query `?station=<slug>&i=<n>` (no history entry), write "Bed in at intensity 0." etc. to `status "Layer changes"`, and cross the four looping layers over on equal-power curves (400 ms).
- At the end the brief form checks a chosen reference in the browser before sending (size > 10,000,000 → "That file is too large…"; a WAV's `fmt ` format, channels, sample rate, then a full `decodeAudioData` on an `OfflineAudioContext` at the file's own rate and channels), stopping at the first failure with focus on "Reference file (optional)" and no request sent (brief: Interactions › Reference check in the browser).
- It posts multipart to `POST /api/enquiries` (XHR, so `progressbar "Reference upload"` shows floor(sent/total×100) while a file uploads) with `project_slug` = the last station heard and an `Idempotency-Key` held for that brief; a request with no response or 409 request_in_progress shows "Connection lost. Retrying your brief…" and is resent with the same key and body every 3 s, up to 5 times (brief: Business rules › Brief idempotency). The server stores 201/413/415/422 answers under the key with a fingerprint of every field and the attachment's name and SHA-256 (decided: one `idempotency_requests` table, scoped `brief` or `deposit:<enquiry id>`, shared by every instance).
- The "Preferred production month" options reload on load, on focus and every 2 s; a chosen month that fills falls back to "No preference" with the month-full copy. Success: `status "Brief status"` = "Brief ENQ-000002 received. A receipt will follow by email." and the form clears.
- Provider end state: one `enquiries` row (version 1, status new); one MinIO object `briefs/<enquiry id>/<attachment id>.wav`; two `outbound_mail` rows (receipt, alert) marked sent; Mailpit holds one receipt To `"Hale, Imogen \"Imo\"" <email>` and one alert To `operator@kettlehole.example` with Reply-To the director under the exact name, subject `New brief ENQ-000002 from Ålborg Lydværk` (RFC 2047 encoded).

### 2. Keyboard-only with reduced motion (brief: Journeys 2)
- Enter on "Enter muted" (no AudioContext). Each station shows `slider "Intensity for <title>"` before its four rung buttons; the station holding focus (else the one most in view) is current. Arrow keys step 1, Page Up/Down 10, Home/End 0/100. Announcements and URL behave as in journey 1. `data-camera` switches instantly; it never reads `moving`.
- Enter in any single-line brief field submits; the same received-brief copy appears.

### 3. The operator publishes a project (brief: Journeys 3)
- `/console` sign-in (`operator@kettlehole.example` / `ladder-console-2026`) sets `earshot_session` (HttpOnly, SameSite=Lax).
- "New project" → `form "Project details"` → "Save project" (`POST /api/console/projects`, draft) → "Project saved.".
- Four stem file inputs upload immediately (`POST …/stems`): "Uploading Bed stem…" → "Bed stem stored."; objects at `projects/<project id>/stems/<stem id>.wav`.
- "Send for review" → "Publish" → "<title> is live in the journey." The station appears in `/api/journey` and search on the next request.

### 4. NDA work shared privately and taken back (brief: Journeys 4)
- `POST /api/console/projects/<id>/links` with an expiry (strictly after now, ≤ 31,536,000 s ahead) returns a 192-bit token link `/listen/<token>`.
- The open private page re-checks `GET /api/listen/<token>` every 5 s, at its own clock's `expires_at` and every 1 s after, and at once when a stem answers 404/410. On 410: "This listening link has expired. Ask Kettlehole Audio for a new one."; on 404: "This listening link is not available." Every layer fades to silence over 350 ms, the station region is removed, the brief form stays usable and carries `listen_token`.
- Revoke/regenerate/withdraw make the page data and every stem answer 404 from the next request; expiry makes them answer 410 from the instant (millisecond compare). All listen responses carry `Cache-Control: no-store`; the page carries `Referrer-Policy: no-referrer`.

### 5. Triage and propose (brief: Journeys 5)
- The Enquiries list opens on the newest 25 (`GET /api/console/enquiries`, by reference highest first, status filtered at read time). `next_cursor` is an HMAC-signed `<last reference number>.<status filter>` (key in PostgreSQL table `server_keys`, so every instance accepts it; decided: the brief asks for an opaque cursor that works on every instance and refuses altered ones). "Show more enquiries" appends the next page; each 15 s reload re-reads page after page down to the oldest row shown, so a new brief appears on top and no row repeats or drops.
- Every console enquiry write sends `If-Match: "<version>"`; the row is locked, the version compared and raised by one in one transaction. A stale tab gets 412 with `current`; the pane loads it, keeps typed notes and shows the stale-save copy.
- Qualify → Build proposal: the preview (`POST /api/console/milestones/preview`, ≤ 300 ms after typing) shows 30/20/20/30 with milestone 4 taking the remainder (499,999 → 149,999 / 99,999 / 99,999 / 150,002). Send proposal → `proposal_sent`, one proposal email with `<APP_PUBLIC_URL>/p/<token>`, the four amounts and the expiry in the operator's zone.
- Export CSV: header `reference,received_at,status,name,email,studio,brief,preferred_month,project_slug,fit_score,receipt`, newest first, cells starting `= + - @ \t \r` prefixed with `'`, withdrawn slugs blank.

- Live console (brief: Interactions › Console): the Enquiries list re-reads every 2 s (decided: the brief offers no change feed, and 2 s meets "within three seconds" for new or re-versioned rows), page after page down to the oldest row shown, keeping rows in view in place by adjusting the pane's scroll offset. A stale "Save triage" merges the three fields against last-loaded / theirs / mine and opens `region "Changed in another window"` only for true conflicts. "Build proposal" re-reads `GET /api/console/months` every 2 s and marks full months `<Month YYYY> (full)` (aria-disabled), disabling "Send proposal" while the chosen month is full.

### 6. Producer accepts and pays (brief: Journeys 6)
- The account is created with `timeZone` = the settings zone at acceptance; every external charge carries `startDate` and `requestedDate` = the operator's local calendar date at the request (`shared/dates.ts businessDate`); `invoice_date` is the item's `startDate` as Kill Bill holds it.
- Accept locks the enquiry, then the month row; claims only while `claimed < capacity` (the `production_month_state` view is the single source); finds/creates Kill Bill account `earshot-<reference>` (USD, company = studio, `AUTO_PAY_OFF` tag, `__EXTERNAL_PAYMENT__` default method); voids orphans; creates one external charge `Milestone 1 of 4: Deposit (<reference>)`; moves to accepted; queues the month-held email. A failure rolls back and voids the created invoice.
- The second tab gets 409 illegal_transition, reloads and shows the same invoice with "This proposal has already been accepted. The deposit invoice is below."
- An untouched third tab re-reads `GET /api/proposals/<token>` every 2 s while proposal_sent and switches to the same deposit area and copy; if its focused accept button goes, focus moves to `heading "Proposal <reference>"` (tabindex -1). The console Months table and both month pickers re-read every 2 s.
- Pay deposit uses one Idempotency-Key per payer name; a lost answer shows "Connection lost. Retrying with the same payment…" and retries every 3 s, up to 5 times. Kill Bill records one PURCHASE with transaction external key `earshot-<reference>-deposit` for exactly the invoice balance; the invoice balance reads 0; one deposit-received email.

### 7. Production and retirement (brief: Journeys 7)
- Start production (deposit_paid → booked). `list "Milestone invoices"` shows 2, 3, 4 with `data-state`; pressing "Invoice milestone <n>" marks it `invoicing` and removes the button at once (focus to the list), then confirms on 201 or rolls back to a server re-read; another tab re-reads every 2 s and shows the invoice without changing its version. Invoice milestones 2, 3, 4 in order; each holds the enquiry row for the whole step, adopts an existing non-VOID invoice with the same description and amount, refuses a different amount (409 milestone_mismatch), else creates one external charge. Four non-VOID invoices summing to the fee.
- Withdraw deletes every stem object first (503 and no change if storage is down), revokes links, then marks the project withdrawn.

### 8. Mail outage (brief: Journeys 8)
- A row queued while mail is down is tried at once; that first failed attempt sets `held_until = now + MAIL_RETRY_SECONDS` of the queuing instance (stored per row as `hold_seconds`), and no instance tries it before then; later failures never extend it.
- A pending proposal email is cancelled by a decline in the same step, reads `cancelled` from its accept link's expiry instant on, and each delivery attempt (holding the row `FOR UPDATE`) re-checks decline/expiry before sending; a decline waits for an attempt in flight.
- Every email is rendered once (headers + base64 UTF-8 body, dates in the zone at queue time) into `outbound_mail` keyed (kind, enquiry). Delivery is tried straight away, then by every instance every `MAIL_RETRY_SECONDS` with `FOR UPDATE SKIP LOCKED` claims; a row is marked sent only after the SMTP server accepts it.
- Settings shows `region "Mail queue"` from `GET /api/console/mail-queue` (pending rows ordered by queued_at, reference, kind; `retry_at` = the hold end the first failed attempt set, null before), re-read every 2 s, each countdown redrawn every second from the server-corrected clock: "Sending" / "Next try in <s>s" / "Retrying"; "No emails are waiting." when empty.
- The open Enquiries list reloads every 2 s (at least every 15 s by the brief), updates rows in place and announces "Receipt for <reference> sent." etc. in one `status "Console status"` update, never moving focus or touching the detail pane.

## Palette (decided values, roles from brief: Visual design › Colour roles)

| Role | Hex |
|---|---|
| ground (near-black olive) | `#121409` |
| ground-raised | `#1a1d10` |
| panel (dark olive grey, never text) | `#2c3022` |
| panel-line | `#5d6248` |
| ink (warm parchment) | `#efe4c8` |
| ink-soft | `#c9bc98` |
| signal (actions, focus, needle) | `#ff6a1a` / hover `#ff8340` / press `#d9530c` |
| oxide (filled rungs, success, Receipt sent) | `#58a88c` / deep `#2f5e4f` |
| clay (field errors, decided) | `#ef9f94` |

## Type, space and layout

- brief: Type — Bricolage Grotesque (display), Inter (body), JetBrains Mono (numerals, 0.12em tracking, uppercase labels). Heading steps ×1.25: 1rem body, 1.25 / 1.5625 / 1.953 / 2.441rem; station titles 1.953rem (three steps, ≈2× body: "station titles are about twice the body size") at every viewport; 2.441rem only for the intro heading.
- decided: 8px spacing scale; page margin clamp(20px, 5vw, 72px); 2px control radius; 44px minimum tap targets (brief: Controls); 3px signal focus ring, 3px offset.
- Journey 1280: text block lower-left, width min(40vw, 36rem), bottom 12vh; readout and ladder in a 168px right column (readout top 96px, ladder top 268px), rungs 12px apart; "Layer changes" at the column foot, one unbroken sentence per line, at least 34ch wide and 3 lines tall, extending left of the column. The readout column dims to 55% while no station is current (decided: the brief form and intro own the screen then). Solid ground top bar with a 24px scrim below it; scroll-padding-top 88px. 768: text block 50vw, 132px right column. 375: readout strip under the top bar, ladder as a row of four rungs below it, text block in the lower half, search collapses to a "Search" button.
- Proposal page: one centred 760px column; milestones table stacks at 375.
- Console: two panes (list 1/3 at 1280, 2/5 at 768, one pane at a time at 375 with "Back to list"). Empty detail pane: Lucide `inbox` (24px, ink-soft) above "Choose a record from the list.", centred, 28vh down (decided). "Console status" while empty is a 1px panel rule under the nav.

## Motion

| Element | Trigger | Duration | Easing | Reduced motion |
|---|---|---|---|---|
| camera dolly (WebGL camera + WAAPI `transform: scale` on the corridor canvas; `data-camera` moving → close/wide) | station becomes / stops being current | 880 ms | cubic-bezier(0.16, 1, 0.3, 1) | instant, data-camera close/wide |
| intensity counting (readout, data-intensity) | scroll event | none (synchronous) | none | slider/rungs set it |
| rung fill `transform: scaleX` | rung change | 400 ms | ease-out | instant |
| panel glow (`.corridor-glow` opacity + WebGL uniform) | rung change | 400 ms | ease-out / settle | instant |
| layer gain | rung change | 400 ms | equal-power sine/cosine curve | unchanged (sound is not motion) |
| link-end fade | link expired/revoked/withdrawn | 350 ms | equal-power cosine | unchanged |
| gate fade-out | gate choice | 320 ms | ease-out | instant |
| console dialogs | open / close | 240 ms opacity + translateY(8px) | cubic-bezier(0.2, 0.8, 0.2, 1) | instant |
| button press / hover | pointer | immediate | none | unchanged |

## States per async action

| Action | Pending | Success | Errors |
|---|---|---|---|
| brief | "Sending your brief…", button "Sending…" disabled | "Brief <ref> received. A receipt will follow by email." | 422 field messages + "Check the highlighted fields." (focus first invalid); 429 wait copy; 413; 415; 503; other (brief: Feedback states) |
| search | "Searching…" | "<count> projects found." | "No projects match “<q>”." |
| accept | "Holding <Month YYYY>…", button disabled | "<Month YYYY> is held. Pay the deposit to confirm it." | already accepted; month taken; expired; closed; billing down |
| pay | "Recording payment…", button disabled | "Deposit received. <Month YYYY> is confirmed. A confirmation email will follow." | connection lost (auto retry); could not confirm; billing down; refused |
| console writes | "Signing in…", "Uploading <Layer> stem…" | brief copy per action | stale save, storage/billing down, stems incomplete, illegal transition |

## Breakpoints

- ≤640 (375): compact strip layouts; ≤1023 (768): reduced right column; ≥1024 (1280): full layout (brief: Screens › By viewport).

## Media and licences

- No image or audio files ship (brief: IF-06). Seed stems: mono 16-bit 22,050 Hz 8 s WAV synthesized in `server/synth.ts` (bed drone, pulse figure, lead line, stinger hits; 0.5 s fade-in; peak 0.24 of full scale) — licence original.
- Corridor: generated per station slug in `client/journey/corridor.ts` (WebGL; 2D-canvas still without WebGL) — original.
- Pacing: each enquiry records its instance's policy `<per sender>/<per IP>/<window>`; limits count only enquiries saved under the same policy (brief: Enquiry pacing; per-IP default 200).
- Fonts: Bricolage Grotesque, Inter, JetBrains Mono latin and latin-ext woff2 from Fontsource 5.3.0, OFL-1.1, self-hosted in `app/client/fonts/` and declared in `client/styles/fonts.css` (`app/assets.json`).
- Icons: Lucide 0.577.0, ISC, inlined SVG.
