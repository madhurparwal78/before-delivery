# TRUTH — Northcoil Works Rimewire (golden)

The brief made concrete. Each value is tagged `brief: <section>` (copied) or `decided: <why>`.

## Journeys

### 1. Basement send (DP-11, DP-12, DP-13, DP-21)
- Start: Rui (field_technician) signed in at `/c/<site-store-114>`. brief: Journeys 1
- Rui types a reading, presses Send (or Enter). The article appears at the bottom with the `Pending` chip (hourglass) and a fresh client message id (UUID v4 from `crypto.getRandomValues`). decided: works on any origin
- No answer in 15 s → `Failed` chip (brick triangle), the line "Message failed to send. Use Retry send.", buttons Retry send and Discard; Delivery updates says "Message failed to send. Use Retry send.". brief: Feedback states
- The event stream drops; after 5 s disconnected the Notices strip reads "Live updates paused. Reconnecting.". brief: Feedback states
- Retry send repeats the POST with the same client message id and content. The late first attempt and the retry race: the server stores one message (per-author advisory lock + `send_ids`), one answers `201`, the other `201` with `Rimewire-Replay: true`. brief: Business rules, Repeated sends
- On `online` the client reconnects at once naming `Last-Event-ID`; Notices: "Live updates resumed."; replayed `message.created` / `message.updated` events are applied once by id. decided: reconnect immediately on the online event, retry every 1 s otherwise (within the 5 s rule)
- End: chip `Sent` → `Delivered` → `Read · 1` as receipts arrive; Delivery updates announces "Message sent.", "Message delivered.", "Message read by 1."; PostgreSQL holds one `messages` row, one `deliveries` row per recipient. brief: Journeys 1

### 2. Gauge photos (DP-14, DP-15, DP-18, DP-19)
- Choosing files checks only signature (JPEG `FF D8 FF`, PNG `89 50 4E 47 0D 0A 1A 0A`, WebP `RIFF....WEBP`), size ≤ 10,000,000 bytes, tray ≤ 4. `gauges.jpg` (an EXE) never joins the tray; the line "gauges.jpg is not a JPEG, PNG or WebP photo." shows under the tray and in Upload progress. brief: Interactions, Choosing photos
- Send uploads by XHR; the progress bar (`progressbar "Upload progress"`) follows bytes; Upload progress says "Uploading 2 photos: 25%." … "100%." then "2 photos sent.". brief: Feedback states
- decided: the result line follows the upload's own answer even when the live `message.created` event placed the message first, and steps reached in one tick are rendered one per task, so the region never skips a quarter or the result (DP-18).
- Server order per part: type → size → declared pixels (≤ 40,000,000, read from the header before decoding) → full decode; > 4 parts → "That is more photos than one message can carry.". brief: Photos (rules)
- Stored: original re-encoded in its detected format with EXIF orientation applied, sRGB, all metadata stripped, at `attachments/<ws>/<msg>/<att>/original`; JPEG thumbnail ≤ 320 px at `…/thumb.jpg`; objects written before the message row. brief: Services, MinIO
- The 20,000 × 20,000 file fails with "huge-….png is over the 40-megapixel limit."; the article turns `Failed` with that line; Discard removes it. brief: Journeys 2
- End: Priya opens Photos; `list "Photos"` shows both, newest first, each `link "Photo <file> by Rui Takeda"`.

### 3. Correct a reading, find who must re-acknowledge (DP-31–DP-37)
- Rui quotes Dana's target (Message actions → Quote → `button "Remove quote"` preview) and sends. brief: Interactions, Quoting
- Dana edits (PATCH with `expected_version`); Rui's quote block now shows the corrected text, an `Edited` chip and the chart address as `<a target="_blank" rel="noopener noreferrer">`. brief: Business rules, Message text display
- Receipts panel: track from `sent_at` to now, `v<k>` ticks at edits, reader dots at first reads, amber 48 × 48 handle (`slider "Receipts time"`), version region, `Read` / `Not yet` lanes, `<n> of <m> read` numeral, event listbox. Handle at the right end = live record; elsewhere it keeps its instant while the track grows (re-rendered every second). brief: Interactions, Receipts scrubber
- End: a reader whose latest read by the instant is older than the version then current carries `read v<k>`; after a re-read the chip leaves at the right end.

### 4. Pinned lockout under two editors (DP-25–DP-29)
- Simultaneous saves: one `200`, the other `412 stale_version` with `current`; the dialog keeps the draft, adds `region "Newer version"` ("Saved by <name> at <time>"), Use newer text, Save over it; Notices "Someone saved a newer version. Your draft is still here.". brief: Interactions, Edit conflict
- Simultaneous pins past 3: channel row lock; exactly the ones that fit answer `201`, the rest `pin_limit`. brief: Business rules, Pins
- Late save: `409 edit_window_closed`; the field error "This message can no longer be edited." sits under Message text; only Cancel remains. Edit leaves the menu by the server-time estimate (latest `Date` header + elapsed `performance.now()`), re-checked every second while the menu is open. brief: Interactions, Edit in the menu

### 5. Start-of-shift schedule (DP-38–DP-41)
- Dana opens Schedule post, types Monday's date and 06:30, ticks Repeat weekly; the dialog says "Times are in America/Chicago". The server reads the time in the workspace zone (gap → moved forward by the jump; overlap → first occurrence). Notices "Scheduled for Mon 2 Nov, 06:30 CST." (format example). brief: Business rules, Scheduled posts
- Scheduled posts panel: text, next fire `<when>`, state chip, `list "Upcoming"` with three occurrences each at 06:30 local, refreshed on open, after schedule/cancel and every 5 s. decided: 5 s poll keeps the 10 s rule
- Each due occurrence fires once (row lock + `scheduled_fires` primary key on occurrence).

### 6. Remove a mis-posted photo and search a site (DP-42–DP-46, DP-65)
- Two simultaneous deletes: one `204`, one `404`; one transaction removes the row, versions, receipts, mentions, pin, attachments (state `removal_queued`) and queues each object key in `removal_queue`. Storage down → `204` without waiting; the queue retries every 30 s and survives restarts. brief: Business rules, Deletion
- Search box submits only server-accepted queries; the address becomes `/c/<current>?q=<query>`; results are buttons (snippets never links); opening a top-level hit focuses its article; Back and reload restore the panel and results. brief: Shell addresses
- A Halvard channel address shows "That was not found." in the message column and Notices.

### 7. Offboard and onboard a subcontractor (DP-01–DP-07, DP-47–DP-49, DP-66)
- Members dialog: names, `@handle`, role chips; emails only for operations managers. brief: API, Email projection
- Remove → `channel.revoked` within 2 s; Sam's column shows "You no longer have access to #weekend-emergency." and the rail drops it; re-adding sends `channel.added`. brief: Membership changes
- The event stream opens with the shell (no start-up delay) and refetches what is shown; a channel that was on the rail and is missing from any refetch (a revocation between streams) shows the lost-access copy, not `not_found`. decided: "a channel lost while it is open shows the lost-access copy" holds even when the revoke event fell between streams; a reload still shows `not_found`
- Invite: name trimmed, control characters refused, ≤ 80 chars; one email with the RFC 2047 encoded display name; queued with `invite_email: "queued"` when mail is down and retried every 30 s. brief: Services, Mailpit
- Join `/join/<token>`: New password (12–128) → signed in, Notices "Password set. Welcome to Kestrel Refrigeration Co.".

### 8. Morning catch-up (DP-50–DP-53)
- At 07:00 business time (per workspace, app clock) each active person with eligible mentions gets one digest: subject `Rimewire: <n> unanswered mentions for <Wed 28 Oct>`, lines `#<channel> · <author> · <local time>` + up to 140 chars quoted, private channels without text, link to `<APP_PUBLIC_URL>/`; Date header = app clock at hand-off. Answered is derived at run time from surviving later replies in the same thread. brief: Mentions and digest

## Palette (DESIGN.md)

| Role | Hex | Source |
|---|---|---|
| page | #E8E2D6 | brief: Visual design |
| panel | #F4F1EA | decided: lighter slab for panels and dialogs |
| well | #DCD4C5 | decided: hover / selected fill |
| ink | #172033 | brief: Visual design |
| muted text | #4A5263 | decided: placeholders reach 4.5:1 |
| amber (fill only) | #F2A900 | brief: Visual design |
| brick | #A3321F | brief: Visual design |
| rule (hairlines only) | #8A929D | brief: Visual design |
| field edge | #6F7783 | decided: 3:1 field boundary |

## Type, space, layout

- Barlow Condensed 800 headings (channel title 31.25 px = 16 × 1.25³, h2 25 px, h3 20 px), IBM Plex Sans 16/24 body, IBM Plex Mono 14/24 times, counts, versions. brief: Type
- 8 px grid; 48 px hit areas; 1 px rule hairlines between columns and rows; square corners. brief: Density and grid, Hit areas
- ≥ 1100 px: rail 240 | message column (content centred, max 880 px, text ≤ 68ch) | detail 400 when open. 600–1099: rail | messages, detail absolute over the right 2/3. ≤ 599: one column, rail slide-over from the left (`button "Channels"`), detail fixed full width under the top bar. brief: Screens and layout; decided: breakpoints

## Motion

| Element | Trigger | Duration | Easing | Reduced motion |
|---|---|---|---|---|
| Detail column | open / close | 300 ms in / 160 ms out | cubic-bezier(0.16,1,0.3,1) / (0.4,0,1,1) | appears without travel |
| Rail slide-over (375) | Channels | 300 / 160 ms | same | no travel |
| New message | inserted | 160 ms fade | ease-out | none |
| Chip / badge | state change | 160 ms stamp (scale 1.12 → 0.94 → 1) | ease-out | none |
| Hover fill | pointer | 100 ms | linear | none |
| Progress bar | bytes sent | 100 ms | linear | jumps between quarters |
| Scrubber version text | instant crosses an edit | 300 ms crossfade (WAAPI) | ease-in-out | snaps |
| Scrubber readers | lane change | 220–300 ms FLIP, 16 ms stagger in read order | cubic-bezier(0.16,1,0.3,1) | snaps |
| Scrubber numeral | count change | 160 ms count (rAF) | linear | changes at once |
| Event list | — | — | — | shown by default |

No loops, spinners or animated backgrounds. brief: Motion and effects

## States per async action

As in brief: Feedback states — pending labels ("Signing in…", "Saving…", "Deleting…", "Scheduling…", "Cancelling…", "Sending…", "Deactivating…", "Joining…", "Searching…", "Loading older messages…"), success copy in Notices / Delivery updates / Upload progress, API `message` copy for errors, outage copy for storage and mail.

## Media

Fonts: self-hosted WOFF2 (OFL-1.1) listed in `app/assets.json`. Icons: Lucide (ISC) inline SVG. Service-tag drawing: inline SVG, original. No photographs ship.

## Disputes

None open. The two recorded against the earlier test copy (DP-39 ambiguous fall-back time, and the `Photos` / `Attach photos` substring locator) are resolved in the refrozen verifier (`fold=0`, `exact=True`); the app was unchanged for both.

## Receipt reports (DP-22, DP-11)

- decided: a delivery or read report that gets no answer or a server error is sent again after 2 s (a read only while the same version is still shown), so a dropped request never leaves the sender's chip short of the reader's real state. A `404` (message deleted meanwhile) is not retried.

## Event-log ordering (DP-21, DP-23)

- decided: every event payload that carries a derived count (`channel.updated` unread, `message.updated` / `receipts.updated` counts) is built after the event-log advisory lock is taken, so a later event id never carries an older count than an earlier one. Without this, a concurrent receipts transaction could log `unread_count 1` after the read had logged `0`, and the badge stuck.
