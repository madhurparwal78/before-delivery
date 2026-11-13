# TRUTH — what the golden app does

Every value says where it comes from: `brief: <section>` (copied from `instruction.md`) or `decided: <why>` (the brief is silent;
the reason ties it to the brief's intent). The golden is a Go 1.27 server (Postgres, RabbitMQ, Valkey, SMTP, webhooks) with a
Preact frontend served from the same origin; one process runs intake, workers and timers.

## Journeys

Seed state at first start (brief: Seed data): eight people (password `yard-lamp-2026`), four schedules with five layers (Transport Primary: Primary days; Carrier Data: Base week and
Weekend cover; Tracking Nights: Nights; Legacy Yard Rota: Yard week, at `record_format` 1), four policies, four services with integrations and routing keys, resolved
incidents 1–4 on Shipment Tracking (4 merged into 3), the private note `NOTE-ONLY: rollback key is in vault slot 7.` on incident 1, the
published update `Tracking delays cleared`, the unpublished draft `Carrier feed slowdown`, two subscribers, the webhook endpoint
`Carrier desk receiver` (secret `whsec_seed_carrier_desk_7f3a`), the read key `Dock board reader` (`slk_seed_read_4c1d`).

1. **Event intake and the log** (brief: Journeys 1). Start: a service with nothing open, its integration page open. A monitor
   posts a `critical` trigger to `POST /api/events`; the app validates, counts the event in Valkey, publishes it to
   `switchlamp.<instance>.events` and answers 202 `{"status":"accepted","event_id","dedup_key"}` only after the broker confirm. The worker applies it:
   one incident opens, holders come from the policy's level 1, the in-app step is written, email steps are scheduled at the holder's delays.
   Repeats of the key add 1 to the alert's `event_count` and one `repeat_event` timeline entry (not announced). After `resolve`
   the same key opens a NEW alert (the old one never reopens; the list shows `Show 1 new incidents`). Dropped events appear in
   the integration's `Event log` with the exact reasons (brief: Integration event log). End state: the lead watching saw each row land in place.
2. **A noisy integration** (brief: Journeys 2, Rate window). The counter reads `<count> / 120`; the 120th event is allowed; from then
   `available` is false and `Retry-After` counts whole seconds to the window's end on the server clock; the 121st answers 429 with
   header `Retry-After`; at the end second the count is 0 and the page reads `Accepting events`. Out-of-order or repeated queue
   messages apply once in `key_seq` order; unappliable ones are tried 3 times (waits 1 s, 2 s) then sit in the dead-letter queue and in `Dead letters` with the
   exact reason; Replay (with or without a corrected message) applies once, logs `Replayed` and removes it.
3. **Grouping and urgency** (brief: Business rules → Grouping, Urgency). `none`, `window` (an alert at T+4:59 joins, at T+5:00
   opens a new incident; a resolve ends the window early) and `until_resolved`; a joining critical alert on a low-urgency triggered
   incident raises it once (`urgency_raised`), cancels the low-urgency notice, starts escalation at level 1 with its full timeout, and
   notifies the holders from delay zero; on an acknowledged or snoozed incident it writes the entry and notifies no one.
4. **The escalation walk** (brief: Escalation). Level timeouts and repeats on the server clock; a level with nobody on call is skipped in the
   same second; after the last pass `Escalation finished`. Two tabs and a reload show the same `data-level`, `data-cycle`, `data-holder`
   and `data-remaining-seconds` because every value comes from the server.
5. **Editing a policy** (brief: Journeys 5, Policy editor). A lead drags `Move level 1` over another row; another uses Space/Arrow/Space
   with the same saved record; `Save policy` (PUT with `If-Match`) answers the new version; `Policy notice` reads
   `<count> running incidents keep version <old>. Version <new> applies to later incidents.`; running incidents keep the opened-with copy.
6. **Reading the final schedule** (brief: Final schedule). Lowest layer first, higher layers replace it, overrides above all, flagged gaps; blocks to
   one scale (`data-minutes`), day bands that measure 1380/1440/1500; a layer edit changes only the future.
7. **A clock-change week** (brief: DST, Handoff Cut). 08:00 stays 08:00 across the change; the cut by pointer snaps to 15 minutes
   (anchor and free edge, `Cut here` tab, `Ends HH:MM, h h m min`, live split pieces with `data-preview="true"`, `Cut preview` text from the
   server's `summary`), by keyboard (Left/Right/Enter/Escape) and by form; the server's result replaces the preview on every open screen
   within a second, or a refused cut settles back and announces `Cut refused: ...`.
8. **Who is on call** (brief: Who is on call). `GET /api/oncall` is cached in Valkey (≤ 5 min, never past `until`), ETag/304; at the
   handoff second every screen shows the new name; an override clears the cache before returning; Valkey down → computed from
   Postgres, `X-Switchlamp-Cache: bypass`, bar `Figures are coming straight from the record, so this page may load more slowly.`; the
   calendar feed follows the person until the token is regenerated, revoked (404) or expired (410, 365 days).
9. **Being paged** (brief: Notification steps, Quiet hours, Acknowledge links). In-app step at once; email at each delay once;
   low urgency `held` through quiet hours and sent at their end in the holder's zone; `Queued` while mail is down, sent after it returns with no
   restart; the signed link acknowledges once (valid / done / used / out of date / invalid pages word for word).
10. **Triage from the keyboard** (brief: Interactions → Incident list keyboard). J/K/X/A/R/Home/End as published; focus rules after a row leaves
    the filter; `Bulk results` lines per row (`Already acknowledged by <name>.` for a lost row); each decided event announced once, in order.
11. **Working an incident** (brief: Note field, Extra responders). Drafts live on the server per person and survive reload and a second tab;
    a double submit makes one note; the first of two simultaneous decisions wins and the other receives `already_decided` naming who decided.
12. **Timers and reassignment** (brief: Snooze, Acknowledge timeout, Auto-resolve, Reassign, edge rule). Every timer fires at its exact
    second on the server clock (`Escalates in`, `Snooze ends in`, `Back to triggered in`, `Auto-resolves in`); reassign to a service keeps
    the old service in `impacted_services`.
13. **Merge and split** (brief: Merge and split). Alerts move with their keys; later events land where the alert lives; the combined
    timeline stays in time order with `from_number`; a split opens a new incident at level 1 on the alert's service.
14. **Maintenance** (brief: Maintenance windows). Banners start and clear at the exact second on two screens; trigger events inside are logged
    `Suppressed` (`The service is in a maintenance window.`); open incidents stay as they were; drills answer `in_maintenance`.
15. **Telling customers** (brief: Publishing, Private data). A lead publishes a draft once; the status cache clears before the response; the
    plate crossfades (~900 ms, instant under reduced motion); each subscriber gets one mail; no note, draft, name, address, dedup key or incident number reaches the page, its cache or the mail.
16. **The phone journey** (brief: Phone action bars). At 375 px every control is ≥ 44 px, nothing overflows, `Incident actions` and
    `List actions` are fixed to the bottom and a focused field is always scrolled above them.
17. **Analytics** (brief: Analytics). A job measures one service per real second, advancing `done` over the socket; a reload or second tab follows the same job; results are cached in Valkey until an incident in range changes; the CSV equals the screen.
18. **Firm housekeeping** (brief: Webhook backoff, API keys, Immediate access change). Signed webhook posts with the retry schedule T+10 s, T+40 s, T+160 s, T+760 s, T+4360 s; Replay under the same event id; key rotation with a server-clock grace; a role change closes sockets with 4403 and every open screen switches; the record survives a restart.

## Palette (brief: Visual design → Colour; hex values decided, see DESIGN.md)
ground `#FFFFFF`; surface `#F4F1EA`; ink (deep navy) `#0E1B3D`; muted slate `#566176` (white only); tangerine `#FF8A1F` (once per screen, navy text); incident field `#0B0E14` (white type); stone `#D9D3C7` (footer and shift blocks); status markers danger `#A62B1F`, ok `#1B6B47`, warn `#8A5A00` (always beside a word).

## Type, space, layout per viewport
Darker Grotesque 800 display, Lexend body, Chivo Mono only for literal keys (brief: Type); scale ×1.333 from 1 rem (brief). 375: stacked rows, fixed bottom action bars, giant name `Switch`/`lamp` at 20vw; 768 and 1280: tables and grids, giant name on one line fitted to the band (brief: Entry screens). Corners square, no shadows, no hairlines (brief: Working screens).

## Motion (brief: Motion and effects)
| Element | Trigger | Duration | Easing | Reduced motion |
|---|---|---|---|---|
| status plate | a published update changes the view | 900 ms | linear opacity crossfade | swap at once |
| cut edge / split pieces | pointer or keyboard moves one 15-minute step | 100 ms | quick start, soft settle | jump, no easing |
| final-row blocks | server result or refused return | 250 ms | soft settle | jump, no easing |
Nothing else moves.

## States per async action (brief: Feedback states)
Pending: the control is disabled with `aria-busy="true"`, one request per click burst, `Live updates` reads `Working on it.` after one second. Success: the exact copy from the Action results table in `Live updates`. Refusal: the exact sentence in `Live updates` and, for forms, in `alert "Problems to fix"` with a link to each field. Outage: the full-width bars of the Outage table.

## Breakpoints and media
375, 768, 1280 (brief: Screens and layout). Media: three plates (`dusk.jpg`, `night.jpg`, `signin.jpg`) drawn by `cmd/plates` (seeded, deterministic, run during `build`), licence `original`; fonts Darker Grotesque, Lexend, Chivo Mono (OFL-1.1, `@fontsource` packages, copied during build); no other image, icon or audio.
