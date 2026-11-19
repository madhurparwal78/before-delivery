# TRUTH — Lowfield Console golden

The brief made concrete. `brief: <section>` values are copied verbatim; `decided: <why>` fills a
silence in the brief's intent.

## Journeys (ideal end-to-end flow)

1. **Buyer checks the rounding rules** (brief: Journeys 1). Signed out at `/`. Scrolling the first
   1,600 px steps `region "Signal path"` `data-stage` 1→5 (320 px each, back again on the way up).
   Typing `61` in Session length in seconds shows `Pilot: 2.00 billed minutes. Scale: 1.02 billed minutes.`;
   Stereo + `5` shows `Pilot: 2.00 billed minutes. Scale: 0.50 billed minutes.`. The trial form posts
   `POST /api/trial-requests` (row in `trial_requests`); on success the fields and button are removed
   and `Trial status` reads `Trial request received. We reply within two working days.`. A repeat from
   the same email (case-insensitive) answers 200 with the first `id` and `received_at`.
2. **Admin sets up a project and a teammate** (brief: Journeys 2). Ines at `/console/projects` →
   New project → `/console/projects/<id>/keys`, Keys status `Project created. Issue its first API key.`
   (row in `projects`). Members → Invite teammate (reviewer + project checkbox) → Members status
   `Invitation created. Share the link below with <name>.` and the `Invitation link` textbox holds
   `<origin>/join/<token>` (row in `invitations`, token stored as sha256). The invitee chooses a
   password (≥ 12 characters) at `/join/<token>` and lands on `/console/projects` seeing only the
   assigned project. A second accept gets `410 invitation_used`.
3. **Developer streams, watches, rotates a key** (brief: Journeys 3). Issue key shows the secret once
   (`lf_live_` + 32 hex; only sha256 stored; prefix = first 12 characters). A `/v1/listen` stream
   appears in Sessions; its detail shows Session status `Session live.` with frames advancing. Revoke
   → Keys status `Key revoked. Live sessions closed: 1.`; the socket gets state `revoked` and close
   4003 within 2 s; the field reads `data-session-state="quota_halted"`, `data-end-state="revoked"`
   and greys; a reload with any device clock shows `Session ended: API key revoked.`.
4. **Replay** (brief: Journeys 4). Start session → Upload recording (WAV + WebVTT) → 201 → detail route;
   replay runs at real time (1 s audio per s), segments appear as audio passes their end, the session
   closes `closed`/`end_of_audio`. `upload.wav` and `sidecar.vtt` are byte-identical in MinIO.
5. **Quota runs out mid-stream** (brief: Journeys 5). When `used_seconds ≥ limit × 60`, every open
   session on the project ends `quota_halted` (close 4002) within 1 s (250 ms ticker); new starts get
   `429 quota_exhausted` until the next UTC month or a quota above usage. Every project tab and the
   detail screen show the quota-halt banner in `Quota status`.
6. **Reviewer corrects, approver approves** (brief: Journeys 6). J/K move between flagged segments,
   E opens the inspector (focus in Corrected text), P plays the slice, Ctrl/Cmd+Enter creates the
   draft if needed and submits → Review status `Correction submitted for approval.`, focus to the next
   flagged segment. The approver follows `Open correction` (`?segment=<id>`) → Approve correction →
   `Correction approved. Reviewed transcript updated.`; tiles retint to high (1.00) on every open view
   via the SSE `correction` event; word error rate updates; `machine-transcript.json` is unchanged.
7. **Billing viewer reads usage; admin upgrades** (brief: Journeys 7). `/console/usage` lists Project,
   Sessions, Billable minutes, Cost, Status (`Confirmed`/`Pending`) and the Organisation total. Plan →
   Switch to Scale → Plan status `Waiting for billing to confirm the Scale plan.` → Kill Bill subscription
   changed (`PUT /subscriptions/<id>?billingPolicy=IMMEDIATE`) and read back → `Scale plan is active.`;
   later sessions carry `plan: "scale"`.
8. **Outages and recovery** (brief: Journeys 8). Billing down: Usage/Plan show the billing banner,
   plan changes get `503 billing_unavailable`, sessions close `pending`. Storage down: starts,
   `/v1/listen`, synthesis and audio reads get `503 storage_unavailable`; pressing play shows the
   storage banner and the draft stays. On return: pending usage confirms within 10 s (5 s retry),
   the banner clears, every call opens a fresh request to the configured address.

## Decided behaviour where the brief is silent

| Topic | Value | Source |
|---|---|---|
| Event stream end | Every stream ends after its final `state` event: a stream opened on an open session when the session ends, a stream opened on an ended session right after its first `state`. Each stream sets `retry: 500`, so EventSource reconnects within half a second. An ended session's `state` carries the session's approval count as its event id; a reconnect whose `Last-Event-ID` is missing or behind first gets one `correction` event per corrected segment, so every open view gets each approval within 2 seconds | brief: "The stream ends after the final `state` event"; "Every open view of the session receives the `correction` event within 2 seconds of the approval"; decided: the reconnect delay and the replay keyed by the approval count |
| Console synthesis playback | the `Rendered audio` player loads the job's `console_audio_url` (`/api/projects/<project_id>/synthesis/<job_id>/audio`, cookie); `/v1/speak/<job_id>/audio` takes only `Authorization: Token`; a failed player load re-asks the route so a `503` raises the storage banner | brief: Interactions, Rendering speech; API |
| Session list objects | carry `mean` (64 numbers) for the row thumbnail | decided: brief Screens "small spectrum thumbnail (the session's mean spectrum)" |
| Live sidecar invalid | `{"type":"error","error":"invalid_sidecar"}`, session continues without segments | decided: the stream is already open; only `sidecar_too_late` is published |
| Default labels | tone `Test tone (1 kHz)`, upload = file name, live `Live stream` | decided |
| Multi-instance | sessions are owned by one instance (`sessions.owner`); a 250 ms ticker per instance enforces revocation, quota, close requests, idle and cap; heartbeat older than 15 s closes orphans as `closed`/`disconnect` | decided: the deployment runs several instances on one database |
| Session `frame` | index of the newest computed row (0 before any row) | brief: Recognizer stand-in (frame counts rows from 0) |
| Member removal | soft delete (`removed_at`), cookies deleted → `401 unauthenticated`; `Remove <name>` acts at once and announces in Members status | decided: corrections keep their author; the controls table names no confirm dialog |
| Cross-origin writes | every state-changing `/api` write with a foreign `Origin` gets `403 cross_origin` at the 403 step of the error precedence: 413/415 first, then 401 (`unauthenticated`, or `invalid_credentials` on sign-in), then 404 (an unknown or invisible id, an unknown invitation token); it comes before 409/410/429/422/503, and no cookie or row is created | brief: Error precedence; Server boundary |
| Malformed bodies | a JSON body that does not parse, or a multipart part that is cut off, carries no field values; the route then answers by the error precedence, and any `422 validation_failed` lists only fields and messages from the brief's API field errors table (e.g. `{}`-like trial request → `name`, `email`, `company`, `team`); unknown routes or methods → `404 not_found` | brief: Feedback states, API field errors ("This table is the complete set of field messages"); Error precedence |
| WebSocket limits | a binary message over 64,000 bytes (including ones over ws's 1 MiB cut-off) → state `closed`/`client`, close 1009; a partial sample frame → 1007 | brief: Live WebSocket protocol |
| Usage recording | a row-level claim (`billing_claimed_at`) lets one instance at a time send a session's record; Kill Bill's "tracking ID already exists" counts as accepted | brief: Usage records (exactly once) |
| Stream connections | each live socket and `/events` stream opens one `pg.Client` with `application_name` `lowfield-stream:<session_id>`, runs its own quota reads on it, and ends it when the client leaves | brief: Stream lifecycle |
| Replay first row | a replay or tone session computes and stores its first spectrum row (1/30 s of audio) before it is announced `live`, so every live view has a front row to mirror | decided: the strip mirrors the spectrum endpoint's last row from the first live frame |
| Unknown `?state=` filter | matches no rows (`200` with an empty list) | decided: the brief's field-message table is complete and names no state message |
| Idempotency storage | the stored body is the exact JSON text sent, replayed byte for byte; a repeat while the first still runs gets `409 idempotency_in_progress` at once | brief: Idempotency |
| Text measure | `shared/text.ts`: NFC, trim Unicode White_Space, count code points; project names are unique on a stored `name_key` (that form, Unicode lower-cased) | brief: Text-limit rule; Unique names |
| Key pickers | each `API key` option is labelled with the key's name only | decided: the key name is how the brief's journeys pick a key |
| Billing probe | an authenticated `GET /1.0/kb/catalog/versions` every 2 s; any answer below 500 means reachable (Kill Bill's own `/healthcheck` can report unhealthy queues while serving) | decided: brief requires a probe at most 5 s old |

## Palette (hex values used)

| Role | Hex | Source |
|---|---|---|
| ground | #07080A | brief: Visual design (near-black) |
| surface | #111318, surface-2 #181B21, surface-3 #1F232A | brief: Visual design (charcoal) |
| hairline | #272B33 | brief: Visual design |
| ink | #E7EAEE; muted #9CA4AF | brief: Visual design (pale grey-white) |
| accent | #3DF2A8 (live chip, live bars and crest, high tiles, Confirmed, Active only) | brief: Colour |
| caution | #F5B547 (low tiles, Pending, quota and outage banners) | brief: Colour |
| frozen | #8A929C (halted field and bars) | brief: Motion (fades to grey) |
| closed | #A4A6AA (closed field crest and bars: ink at about 70 % over the ground) | brief: Motion ("pale grey when closed") |
| danger | #FF9C8F (field errors) | decided |
| focus | #F2F4F7, 2 px outline, 2 px offset | brief: Touch and accessibility |

## Type, space, layout

- Space Grotesk 500/600 headings; Inter 400/500/600 body at 14 px; JetBrains Mono tabular figures for every number (brief: Type). Heading scale ×1.25: 17.5, 21.9, 27.3, 34.2, 42.7 px (brief: Type).
- Compact: 36 px controls on desktop, 44 px under 1200 px or on coarse pointers (brief: Density; Touch).
- Public: hero field full bleed; overlay copy in the left four of 12 columns at ≥ 768; at < 768 the copy sits below the field; plan cards side by side ≥ 768, stacked < 768 (brief: Screens and layout).
- Console: 240 px rail ≥ 1200; top bar + `Menu` → `dialog "Navigation"` < 1200; Service status first in the workspace (brief: Console shell).
- Session detail: < 768 one column (ribbon, field, stats, Transcript; inspector = full-screen sheet); 768–1199 two panes (inspector = sheet over the right pane); ≥ 1200 three columns with a permanent inspector (brief: Screens and layout). Field 16:6 always.

## Motion

| Element | Trigger | Duration | Easing | Reduced motion |
|---|---|---|---|---|
| terrain rows | live frames | 30 rows/s | linear | holds one frame |
| strip bars | each frame | rise ~50 ms, fall ~250 ms | exponential smoothing | step once per second, no easing |
| halt grey | quota_halted / revoked | 250 ms | linear | instant |
| ribbon retint | approval | 330 ms | cubic-bezier(.2,.8,.2,1) | instant |
| Signal path text | stage change | 240 ms | same | all five panels static, data-stage 5 |
| list-to-detail morph | Sessions row link | 400 ms | ease-out cubic (rAF) | instant swap |
| dialogs | open | 180 ms fade + 8 px rise | ease-out cubic on animation frames (follows the page clock) | none |
| quota meter fill | value change | 240 ms | same | none |
| button press | :active | 90 ms | same | none |
| hero | page load | 12 s demo loop at 30 rows/s | linear | first frame held |

## States per async action

Every result is written once to its named polite status region (brief: Feedback states): Keys,
Upload, Session, Review, Synthesis, Settings, Members, Plan, Trial, Sign-in, Join, Search results,
Billed minutes, Quota, Service. Field errors render under their field with `aria-invalid` and
`aria-describedby`. Pending: `Uploading audio`, `Submitting`, `Rendering`, `Waiting for billing…`.
Generic failure: `Something went wrong. Try again.`.

## Media and licences

No image, audio or video files ship. Seeded recordings, the 1 kHz tone fixture and synthesis output
are generated by the app (`original`). Fonts: Space Grotesk, Inter, JetBrains Mono (OFL-1.1) via
Fontsource woff2 files vendored into `app/src/client/fonts/`, listed in `app/assets.json` and `app/THIRD_PARTY_NOTICES.md`. Icons are inline SVG
paths drawn for the app.
