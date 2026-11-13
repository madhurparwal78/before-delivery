# TRUTH — Spindrift Commission Stage (golden)

The brief made concrete. Every value says where it came from: `brief: <section>` (verbatim) or
`decided: <why>` (the brief is silent; the reason ties it to the brief's intent).

## Journeys

### 1. Brief a piece
- Start: signed-out visitor on `/`. (brief: Journeys 1)
- Presses `link "Start a commission"` → `/brief/new?step=1`. The stage fades up over 1.6 s, the intro `Hi. Six questions, then your room.` types, holds 0.8 s, fades 0.3 s; `What should stand in the room?` types (0.4 s + 0.04 s × i). (brief: Motion › Cue-line Brief signature)
- Picks a chip, names the piece, presses OK (or Enter). Signed out → the answer is kept in `sessionStorage` and the browser goes to `/auth/login?returnTo=/brief/new?step=1`. (brief: Interactions; decided: sessionStorage is the browser-side keep for one tab, never a datastore)
- After Keycloak: back on `/brief/new?step=1`, the browser creates the draft (`POST /api/briefs`), saves step 1 once (`PUT …/steps/1`) and moves to `/briefs/<id>?step=2`. (brief: Interactions)
- Each later OK: `PUT …/steps/n` → `Answer saved. Question n+1 of 6.` in `status "Brief progress"` → `?step=n+1`; the stage publishes the new `data-room-width/-depth`, `data-silhouette`, `data-dust` on the server's reply. (brief: Feedback states, Signature step 6)
- Step 6 → `POST …/complete` → `/c/<id>` whose heading types `Your room is ready.`; `link "Get a concept preview"`. End: one commission in state `briefed` with size `compact`, extras from step 6 and a first quote. (brief: Journeys 1; decided: a quote is issued at completion so the overview shows prices before the configurator)

### 2. See the piece in the venue
- `/c/<id>/files`: `Upload venue photo` / `Upload GLB model` → `Uploading <name>...` → `Stored <name> — <size> bytes, SHA-256 <sha>.`; MinIO key `commissions/<id>/files/<file id>`; the list shows `Stored`, size and hash. (brief: Feedback states, Services › MinIO)
- `/c/<id>/preview`: pick the photo, `Request preview` → `202` render job → `Preview queued.`; a `render_submit` job POSTs `/v1/renders` with `Idempotency-Key: <render id>`; callbacks move progress (`Preview rendering — 40% done.`); the completed callback's PNG is stored at `commissions/<id>/renders/<render id>.png` by a `render_store` job, then `Preview ready.` and `img "Concept preview"`. Commission → `previewed`. (brief: Render jobs)
- `/c/<id>/configure`: place each required piece (keyboard, drag, fling), choose size and extras (quote preview 250 ms after the last change, latest reply wins), `Save quote`. End: layout holds every required piece → `placed`, saved quote. (brief: Journeys 2)

### 3. Hold a day and pay the deposit
- `/c/<id>/day`: month grid of venue-local days; choose a `free` day → `Hold <date>` → `Held <date>. Finish checkout before the timer runs out.`; `timer "Hold time left"` counts the server's seconds down by page time. Commission → `held`; `slot.held` CRM event. (brief: Install day and checkout)
- `/c/<id>/checkout`: `Full name as signature`, agree, `Sign agreement` → `Agreement signed. Your contract PDF is being prepared.`; Kill Bill invoices the deposit (two external charges), contract v1 PDF job, invoice PDF job, `Deposit is due — <title>` email. (brief: Checkout and payments, Milestones)
- `Pay deposit <amount>` opens `dialog "Payment"`; `Pay <amount>` → `Confirming payment with the billing system...` → `Paid <amount>. Your receipt is on its way.`. End: Kill Bill PURCHASE with the Idempotency-Key as transaction key; commission `contracted`; hold → booked install day; receipt in Mailpit; contract PDF listed; `Slot confirmed — <venue> — <date>` on `spindrift-crew`; `contract.signed` and `milestone.paid` in Svix. (brief: Journeys 3)

### 4. Co-fund
- Producer saves funders on `/c/<id>` (`Save funders` → `Funders saved. Invites are on their way.`); each sponsor gets `You're invited to co-fund <title>` with `/i/<token>`. (brief: Feedback states, Services › Mailpit)
- Sponsor opens `/i/<token>` (own share only) → `Accept and sign in` → Keycloak → `/i/<token>?accept=1` → accepted (sponsor role, Kill Bill account, sponsor invoice, due email) → `/c/<id>/share`, `You're in. Here's your share.` → `Pay my share` → Paid. The producer's board announces `<payer> paid <amount> toward <title>.` within 2 s. (brief: Journeys 4)

### 5. Deliver and maintain
- Client `Approve concept` (invoices Concept approval) → pays; producer `Start fabrication` (refused with `That step isn't available yet.` until paid) → client pays Fabrication; the assigned crew lead `Confirm installation`; client `Sign acceptance` → pays; `/c/<id>/maintenance` `Start maintenance` (Essential) → `maintained`; `Change plan` → `Switched to the Priority plan. Kill Bill's proration is below.` with Kill Bill's items (credit −$240.00, new plan +$480.00 when switched on the start day). (brief: Journeys 5, Maintenance)

### 6. Run the studio
- `/studio` board (`table "Commissions"`), a commission's `/c/<id>/webhooks` log read from Svix, `/studio/jobs`: a crew-alert job waits `pending` with its last error while ntfy is down and becomes `done` once ntfy answers; one alert on the topic. (brief: Journeys 6)

### 7. Crew day on a phone
- 375 px: `Menu` → `dialog "Navigation"`; `/crew` lists only assigned days; tap a day → `/crew/days/<id>` sheet (venue, date, title, client, pieces with positions, load-in alert) → `Confirm installation` → `Installation confirmed.`; commission `installed`. (brief: Journeys 7)

## Palette (hex used by the build)

| Role | Hex | Source |
|---|---|---|
| ground | `#03060F` | brief: Ground and light ("near-black navy"); decided: seed inventory hex |
| surface (rows, chips, cards) | `#0A0E18` | brief: Ground and light; decided: opaque so contrast never depends on the stage |
| hairline | `rgba(255,255,255,0.16)`, hover `0.40` | brief: Ground and light |
| graphite (close chip, banners, errors, toasts) | `#23262F`, hover `#2E3240` | brief: Ground and light |
| ink | `#FFFFFF` | brief: Ground and light |
| muted | `#A0A4AE` | brief: "mid grey"; decided: keeps 4.5:1 over lit grid lines |
| accent | `#2271E3`, hover `#2B6CF6` | brief: Accent and corners; decided: hover keeps white ≥ 4.5:1 |
| light field core / hot corner | `#2F7BFF` / `#E8EEFF` | brief: Ground and light |
| trail violet / pink / cyan | `#C9A2F0` / `#FFB8EC` / `#A8E6FF` | brief: Ground and light (typing trail only) |

## Type, space, layout

- Inter Tight 400 (display), Inter 400 (body, tabular figures), Martian Mono 400 (key-chord hints only), self-hosted. (brief: Type)
- Body 16 px; h3 21, h2 28, h1 38 (≈ ⅓ per level); cue question clamp(34 px, 4.6 vw, 64 px); landing headline clamp(40 px, 6.2 vw, 84 px). (brief: Type; decided: sizes)
- Column 640 px, tables 1040 px, ≤ 768 px: 100 vw − 32 px. One radius: 2 px. Controls ≥ 44 × 44 px. (brief: Screens and layout, Accent and corners, Accessibility)
- Brief question centred at ≈ 44 % of the viewport height (≈ 27 % on phones); chips 4 per row (2 on phones); close chip fixed top-right 16 px / 40 px. (brief: Screens and layout; decided: margins from the seed)

## Breakpoints

| Width | What changes | Source |
|---|---|---|
| < 768 | nav in the right drawer behind `Menu`; chips 2 per row; cards 1 per row; payment sheet is a bottom sheet; configurator scene + bottom-sheet inspector (open sheet covers 60 %) | brief: Screens and layout |
| 768–1199 | links in the bar; cards 2 per row; payment sheet centred 480 px; configurator stacked (scene 55 vh) | brief |
| ≥ 1200 | configurator side by side, inspector 360 px | brief |
| 1280 | cards 3 per row | brief |

## Motion

| Element | Trigger | Duration | Easing | Reduced-motion substitute | Source |
|---|---|---|---|---|---|
| grid + light field fade-up | brief opens | 1.6 s | ease-out cubic | one still frame | brief: Signature 1 |
| letters | question opens | letter i at 0.4 + 0.04 i s; violet 0–0.2, cyan 0.2–0.4, white from 0.4, plain by 0.6 s | — | whole and white at once (`data-typed` = length) | brief: Signature 2–3 |
| guide cursor | newest letter | ≈ 0.5 s catch-up, parks past the line end | exponential | shown parked | brief: Signature 4 |
| controls rise | line settled | each 0.7 s, 60 ms stagger, all ≤ 1.4 s | `cubic-bezier(0.16,1,0.3,1)` | present at once | brief: Signature 5 |
| stage answer response | server reply | 0.6 s, the silhouette's springy settle included | spring | redrawn still | brief: Signature 6 |
| landing camera | scroll | proportional; keyframe k at k × viewport height | eased follow, snaps when within 1e-4 | still per keyframe | brief: Landing stage |
| pointer tilt | pointer | ≤ 2°, settles ≤ 0.5 s | exponential | none | brief: Landing stage |
| case-study sheet | open | 0.5 s grow from the card | ease-out | instant | brief: Other motion |
| quote digits | total changes | 0.52 s roll per changed digit | ease-out | instant swap | brief: Other motion |
| toasts / banners | appear | 0.25 s | ease | instant | brief: Other motion |
| piece fling / settle | release > 0.3 m/s | 8 % speed loss per 1/60 s until < 0.05 m/s or a wall, then 0.5 s critically damped snap | physics | snap at once | brief: Configurator |
| idle | — | nothing on the stage moves 2 s after the last input; the stage renders only while something settles | — | — | brief: No idle loops |

## States per async action

As published in brief › Feedback states (live region, pending, success, errors). Decided additions:
- 409 on a preview request outside briefed/previewed/placed: `Previews can be requested until the room is held.` (decided: a refusal must be stated in words)
- `placement_incomplete` on hold: `Place every piece in the configurator before holding a day.` (decided: same)
- `options_locked`: toast `Size and extras are locked at this stage of the commission.` (decided: same)
- Object-level 404 pages: typed question `That isn't here. Back to the start?` with a link to `/`. (decided: designed not-found)

## Decided behaviour the brief leaves open

- App user id = Keycloak subject; Kill Bill account external key and Svix uid `client-<id>` use it. (decided: stable across instances sharing the realm)
- Kill Bill accounts carry `AUTO_PAY_OFF`; invoices are paid only by the app's PURCHASE with the request's key. (decided: brief › Payments needs one payment per key)
- The Kill Bill catalog upload carries a unique effective date (two days back, millisecond precision) and is serialised by an advisory lock. (decided: concurrent first uploads from several instances otherwise corrupt the tenant catalog)
- `contract.signed` is created when the deposit is confirmed and sent once the contract PDF is issued (its data needs the deposit payment id and the PDF hash). (decided)
- Hold and invite instants are recorded to the whole second, so `expiresAt` printed to the second is the exact edge. (decided: brief › Holds "judged at that exact edge")
- The commission detail carries `latestRender` so the preview survives a reload. (decided: DP-16 "sees the preview image on their commission")
- When Kill Bill refuses or is unreachable, the attempt becomes failed and answers 502 or 503; a replay of that finished key with the same path and body returns the stored response, and a new key is a new attempt. (brief: Payments)
- An attempt whose outcome is unclear (still `payment_pending` after the 10-second in-flight wait, e.g. its instance stopped mid-request) is resumed by a same-key retry, which first asks Kill Bill for a payment with that key and records it if found. (brief: Payments "A retry with the same key after an unclear outcome")
- The deposit is charged only after its hold and quote are re-checked under the hold's row lock; the hold becomes the booked install day in the same transaction. (brief: Holds "judged on the server on every read and every write")
- Live events (`/api/events`) go to the producer and the commission's client only; sponsors see only their own share and get no commission events. (brief: Access "A sponsor sees only their own share")
- The day-before load-in alert's moment (09:00 venue time the day before) is recorded on the install day in the booking transaction; once that moment comes (at once when it has already passed) a sweep marks it queued and creates its crew-alert job in the same transaction, so the job table holds only work that is due. The day sheet lists it as scheduled until it is posted. (brief: Crew alerts, Jobs "created in the same transaction as the change that causes it")
- A worker claims only the job kinds whose services its own status probe reports up (renders: provider + MinIO; preview storage: MinIO; PDFs: Gotenberg + MinIO; email: Mailpit; crew alerts: ntfy; CRM events: Svix), so an instance that can't reach a service never holds back a job another instance can run. (brief: Jobs "takes effect within 30 seconds of its service answering again")
- Every state change goes through the one transition table (`server/rules/transitions.ts`), automatic moves included. (brief: Engineering standards)
- `GET /api/commissions` also returns `nextDueCents` for the client list's "next due amount". (brief: Screens › `/commissions`)
- The client may pay invoiced milestones from the overview (`Pay <label> <amount>` opens the payment sheet). (brief: Journeys 5 "pays that milestone")

## Media and licences

| Asset | Source | Licence |
|---|---|---|
| Inter Tight, Inter, Martian Mono (latin 400 woff2) | Fontsource 5.3.0 packages | OFL-1.1 |
| icon paths (x, arrow-right, menu, upload, check, chevrons, grip) | Lucide | ISC |
| stage, wall, silhouettes, case-study and empty-state drawings, favicon | drawn in code for this app | original |
