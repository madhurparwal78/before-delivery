# TRUTH — Saltprint Desk golden

The brief made concrete. `brief: <section>` values are copied verbatim; `decided: <why>` fills a silence.

## Journeys (ideal end-to-end flow)

1. **Submit an essay** (brief: Journeys 1). Start: Ada signed out at any address → Sign-in, first Tab lands on
   Email. Sign in → back at that address if Studio/Contact sheet/Royalties, else `/sheet`. Studio → "New essay"
   → form "Essay details" with credit row 1 = Ada. Fill title, caption, lift `2026-11-01T01:30` (blur shows
   "Lifts Sun 1 Nov 2026 · 01:30 CDT" and "That time happens twice on Sun 1 Nov 2026; Saltprint uses the first."),
   days, prices `450.00`/`120.00`, share 1 `60`, "Add co-contributor" (focus moves to "Co-contributor 2"),
   Noor `40` → "Shares total 100.00% of 100.00%" turns fixer green. "Save draft" → POST (version 1) →
   "Draft saved.". "Upload frames" (several files, sent one at a time) → "levee-2.jpg uploaded." each answer's
   `essay_version` remembered. "Submit for review" → "Submitted. In review."; list shows "In review" and
   "Sun 1 Nov 2026 · 01:30 CDT". Stale save (Noor saved meanwhile) → 412 → alert "This essay was changed
   elsewhere. Reload it before saving; your edits are still in the form." and every field keeps its text.
   Provider end state: Postgres essay `in_review`, version bumped per change; MinIO `originals/<essay>/<frame>`
   byte-identical plus `derivatives/<essay>/<frame>/{grid,story,preview}.jpg` with no GPS.
2. **Review and publish** (brief: Journeys 2). Ines → Review queue (oldest submission first). "Publish <title>"
   → "Published." (lift ahead → `embargoed`). "Hold <title>" → dialog "Hold essay", focus in "Desk note",
   "Hold essay" → "Held and returned to the contributor." (`draft`, desk note stored). Queue empty; contact sheet
   tile reads "EMBARGOED · lifts <co-op time>".
3. **Follow, browse, shortlist** (brief: Journeys 3, Interactions). Priya searches (q replaced in place),
   opens a tile (one history entry, `essay=<id>&frame=1`), arrows step (frame replaced), "Add frame n to
   shortlist" → "Frame n added to shortlist." and the button reads "On shortlist" (disabled). "Follow essay"
   → "Following essay" (aria-pressed) and "Following <title>.". Reload lands on the same search and frame with
   focus on "Next frame" ("Previous frame" on the last, "Close story" on a one-frame essay); Back closes the
   viewer and focuses the tile. At the lift (within 2 s of the server clock) the essay goes live once and each
   follower gets one "Embargo lifted: <title>" email.
4. **Claim an exclusive** (brief: Journeys 4, Grease-pencil claim). Press and hold "Claim exclusive window":
   ring draws clockwise from twelve, 50 at 450 ms, commit at 900 ms → exactly one POST with an Idempotency-Key.
   The request locks the essay row, confirms and makes the first activation attempt (charge + grant record +
   receipt) in the same commit, so a simultaneous rival waits and then gets `window_held` with
   `held_by:"another_newsroom"` and the holder's effective end. Winner: "EXCLUSIVE · yours until <co-op time>",
   ring fixer green. Rival: "Held by another newsroom until <same time>". Kill Bill: one external charge
   `Saltprint licence <id> · exclusive` on account `newsroom-harbor-light`.
5. **Outage and expiry** (brief: Journeys 5). Billing down → 202 `pending_invoice`, hold deadline
   min(confirmation + 30 min, window end), stamp "PENDING INVOICE · licence held until <co-op time>. Billing is
   unreachable; the invoice is raised automatically when it returns." Any instance retries every 5 s (claimed in
   the database) until the deadline; on success the licence activates, the receipt is queued and sent. Download
   from Licences → "Originals: <title>" → "Download frame n" → presigned GET named `<essay id>-frame-<n>.<ext>`,
   valid min(300 s, time to licence end). At the end instant (server clock) the row reads "Expired", the
   download button is gone and grants answer 410 `licence_ended`.
6. **Review usage** (brief: Journeys 6). June → Usage: totals band, "Licence expiries" (active, end > now,
   earliest end, then confirmation, then id), "Export CSV" → `saltprint-usage-harbor-light-<YYYY-MM-DD>.csv`,
   only her newsroom, times `YYYY-MM-DD HH:mm CST|CDT`, formula cells prefixed with `'`.
7. **Rates, statement, payouts** (brief: Journeys 7). Bram schedules `YYYY-MM-DD` + `25.00` → "Rate of 25.00%
   scheduled from <co-op date>.", row marked "Scheduled", current unchanged. After the month closes (co-op
   midnight), "Run statement" → "Statement for <Month YYYY> ready."; each line splits exactly; "Record payouts"
   → one CREDIT payment `payout-<YYYY-MM>-<handle>` per contributor with a non-zero total → "Payouts recorded."
   or "<n> payouts queued — billing is unreachable; they are recorded automatically when it returns.".
   Contributors see only their own lines under Royalties.
8. **Legal takedown** (brief: Journeys 8). Ines → All essays → "Legal takedown for <title>" → dialog,
   reference, checkbox enables "Take down essay" → "Essay taken down. Licensees have been notified.". The
   takedown locks the essay, waits for activations (licence row locks), revokes every pending/active/expired
   licence, deletes shortlist rows, cancels unsent mail about the essay, queues one notice per recipient, then
   deletes derivatives and grant records and moves originals under `legal-hold/`. Licensees see "Removed essay
   (legal takedown)" / "Revoked" with no imagery.

## Palette (decided values in the brief's roles; DESIGN.md)

| Role | Hex | Source |
|---|---|---|
| paper ground | `#F4EFE4` | brief: Visual design (warm newsprint); decided hex |
| paper-deep (bands) | `#EAE3D3` | decided: second paper tone instead of shadows |
| ink | `#141B24` | brief: near-black ink, faint blue cast; decided hex (16.0:1) |
| graphite | `#5B5A56` | brief: mid graphite for secondary text and hairlines; decided hex (6.1:1) |
| graphite-weak | `#8E8B84` | brief: disabled / greyed bands |
| safelight red | `#A3261E` | brief: embargo stamps, claim ring, held/refused claim states only (6.4:1) |
| fixer green | `#2B6649` | brief: won claim, active licence, recorded payout (6.3:1); LIVE essays and the Current rate are ink badges, not green (decided: they are not granted states) |
| matte | `#171C22` | decided: darkroom matte behind the frame in the viewer |

## Type, space, layout

- Newsreader (display, 500/600), IBM Plex Sans (body 16px on `body`, 400/500/600), IBM Plex Mono with
  tabular figures for every time, amount, rate, count, id and stamp (brief: Type). Scale ratio 1.2;
  viewer title 27.65px = three steps above body (brief: Type).
- Spacing 4px unit; 24px between groups; tap targets ≥ 44×44 with ≥ 8px gaps (brief: Density, Tap targets).
- 375×812: nav wraps on two lines, tables become stacked cards, ledger is a bottom sheet (collapsed: stamp,
  claim area, buy). 768×1024: same sheet. 1280×800: ledger a right rail one third wide (`complementary`),
  contact sheet max 960px centred, Studio two columns (brief: Screens and layout).

## Motion

| Element | Trigger | Duration | Easing | Reduced-motion substitute |
|---|---|---|---|---|
| tile outline | hover | 150 ms | ease-out | instant |
| viewer | open / close | 320 ms in / 240 ms out (opacity) | settle / ease-in | instant |
| frame | step | 240 ms cross-fade; segment fill 240 ms | ease-out | instant swap |
| ledger sheet | expand / collapse | 250 ms translateY | cubic-bezier(0.22,1,0.36,1) | instant |
| claim ring | hold (pointer, touch, Space/Enter) | 900 ms to commit, proportional, rAF + performance.now | linear | two-step pair "Confirm claim" / "Cancel claim", "Step 2 of 2" |
| claim ring | early release | 250 ms retract | linear | — |
| result stamp | server answer | 320 ms fade + settle | settle | instant with check / lock / clock icon |

No loops, spinners or placeholders; pending states are text (brief: Motion and effects).

## States per async action

| Action | In flight | Success | Failure |
|---|---|---|---|
| claim | "Claiming…", button disabled | EXCLUSIVE / PENDING INVOICE stamps | held-by, standard-running, already-licensed, not-licensable copy; no answer → keeps key, "Couldn't reach Saltprint Desk. Hold Claim again…" |
| buy | "Licensing…" | STANDARD / PENDING INVOICE | exclusive-held copy; no answer → "Couldn't reach … Buy again …" |
| save draft | "Saving…" | "Draft saved." | field errors from the server under fields; 412 stale alert |
| upload | "Uploading <f>…" | "<f> uploaded." | "<f>: <server message>"; storage down copy |
| download | "Preparing download…" | "Download ready." | ended / revoked / pending / storage copies |
| everything else | — | brief copy | 503 → database copy; network → "Couldn't reach Saltprint Desk. Nothing was changed; try again." |

## Breakpoints

1280 (rail vs sheet; `decided:` brief says "Below 1280 wide" for the sheet), 900 (tables reflow to cards
below; decided: Statement lines' eight columns need it), 768 (single-column forms).

## Media and licences

- Seeded frames: halftone JPEGs drawn by `src/server/halftone.ts` at first serve — original. Covers of essays on the
  sheet are drawn first, in parallel, and a `/media` request for a seeded frame not yet drawn draws it at once
  (decided: brief Browser support, "the contact sheet is usable within 3 seconds of navigation" with the seed data).
- Fonts: Newsreader, IBM Plex Sans, IBM Plex Mono woff2 from Fontsource 5.1.1 — OFL-1.1 (`app/assets.json`).
- Icons: Lucide 0.468.0 icon nodes bundled — ISC.

## Decided where the brief is silent

- The first activation attempt runs inside the licence request's commit under the essay lock, so rivals see
  the settled licence and a billing refusal leaves no licence (brief: Losing requests, Billing refusal).
- `GET /api/usage` also returns `expiries` (the licences eligible for `next_expiry`, in order) so the totals
  band and the expiries table come from the same read (brief: Usage screen).
- `GET /api/studio/essays` also returns `contributors` (handle, name) to fill the "Co-contributor" combobox.
- Licence ids use an alphabet without `0`/`1` (`lic-…`).
- An instance that finds billing, storage or mail unreachable waits 5 s before its own next attempt, and the
  waiting row stays free in the database, so any instance that can reach the provider takes it on its next poll
  (decided: brief Shared database, "the work completes as soon as any instance can reach the provider").
