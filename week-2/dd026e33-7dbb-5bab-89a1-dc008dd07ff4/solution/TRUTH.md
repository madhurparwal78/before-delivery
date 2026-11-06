# TRUTH — Marrow & Lark Motor House Lacquer (golden)

The brief made concrete. Every value says where it came from: `brief: <section>` (verbatim) or
`decided: <why>` (the brief is silent; the reason ties it to the brief's intent). Design tokens are
in `DESIGN.md`; this file records what the built app does.

## Stack and deployment

- Node.js 22, TypeScript strict on both sides; server on `node:http`, browser React 18 built by Vite. decided: a stateful SPA keeps open dialogs mounted across re-reads (brief: Interactions › Re-reads).
- `run.json`: `npm ci` / `npm run build` / `npm run start`; binds `0.0.0.0:${APP_PUBLIC_PORT:-4173}`. brief: Deployment.
- Schema and seed applied on every start under a Postgres advisory lock; seed only into an empty database. brief: Services › Postgres.
- `GET /api/health` → `200 {"status":"ok"}` once the server listens (the schema is applied first; providers are never awaited). brief: Deployment.
- Uploads are received whole (≤ 10,000,000 bytes) and written with one S3 `PUT`; no multipart upload is ever started. decided: makes "a refused or cut-off upload writes no object and leaves no incomplete multipart upload" true by construction (brief: Abandoned uploads).

## Journeys (start state → actions → visible and provider-recorded end state)

1. **Intake** (brief: Journeys 1). Start: c-fulvia `awaiting_intake`. Bays search `fulv` → after 300 ms the Cars table narrows, `Bay updates` says `1 car found.`, address becomes `/bays?q=fulv` via `replaceState`. Car page → `Choose bay` → arrow keys over the floor plan (ineligible bays keep focus and their reason in the name) → Enter on A4 → focus on `Assign bay A4` → Enter → `1971 Lancia Fulvia Coupé assigned to bay A4.`; Postgres: car `stored`, `intake_at`, billing `pending`, effect `subscription_create` queued. Queue: Kill Bill account `owner-u-kenji` (CHF, Europe/Zurich, AUTO_PAY_OFF), subscription `car-c-fulvia` on `bay-standard-monthly`; once Kill Bill shows `chargedThroughDate` the car is `active` and the page's `Bay billing` reads `Billed monthly, paid through <date>` on its next 10 s re-read, in place, with any open dialog untouched. Add item → `Key sets: 2 checked in.` Report upload (stay claimed before the body, object `cars/<car>/condition-reports/<id>.pdf`, SHA-256 under the link); a cut-off upload leaves no object, claim or record. Intake photo → `Photo attached to 1971 Lancia Fulvia Coupé.` only after storage confirms.
2. **Care round on a phone** (brief: Journeys 2). Round lists stored cars, overdue first, each group by bay code; E-Type overdue (last start-up 31 days before first start, period 30 days). Save entry with the signal gone → `No answer from the server. Press Save entry again; it won't be logged twice.`, dialog keeps values and key. A 401 `session_expired` opens `Sign in again` over the dialog; after sign-in the entry is resent once with the same key and byte-identical body. End: one entry; `Start-up logged for 1967 Jaguar E-Type. Next start-up due <date>.`; row leaves the overdue group. A car released elsewhere keeps its open dialog; Save entry → `This car is no longer in a bay.`, focus to `heading "Care round"`.
3. **Estimate and approval** (brief: Journeys 3). Lines priced exactly (half-up per line, VAT 8.1 % per line, total to 0.05). Every stored change bumps `version`; `ETag: "<version>"`; PATCH/send need `If-Match`; a stale version → `412 estimate_changed`, Estimate dialog stays open with values and focus on `Save estimate`. Send queues `Estimate <n> for your <car> is ready` (link `/portal/jobs/<id>`). Owner follows the link signed out → `/sign-in?next=/portal/jobs/<id>` → lands there; Decline dialog → Keep estimate → Approve → `Estimate approved. Work on your <car> can begin.` The lead's open job page re-reads every 10 s while `sent`, shows `Approved`, announces `Kenji Arlow approved estimate <n>.` once and shows `Log stage`.
4. **Paint stages and the coat stack** (brief: Journeys 4). Log stage under a job row lock; a concurrent log of the same stage → `stage_already_logged`. Scrubber steps wipe panel fills front→rear (500 ms each, 30 ms stagger), then the cross-section (from 200 ms) and the numeral count (200→900 ms). `?stage=&panel=` written with `replaceState`; the owner's portal job opens at the same stage and panel; readings credited to `Marrow & Lark Motor House`.
5. **Invoice and partial payment** (brief: Journeys 5). Issue holds the job row through the Kill Bill call: one external charge `Workshop job <n>`, then `INV-<year>-<4 digits>` from a counter row (gapless; a 503 takes none), one `Invoice <n> for your <car>` email. Transfers hold the invoice row through the Kill Bill call; each records one Kill Bill external payment of exactly `amount` against that Kill Bill invoice (external key `<prefix>transfer-<id>`, custom field `bank_reference`), and the house appends the reference and recorder to its transfer record. brief: Bank transfers. `balance` is Kill Bill's balance for that invoice, read from Kill Bill on every invoice read, list, board total and hold check; the app never computes a balance or sets paid itself. brief: Invoice balance and status, Bank transfers. After the bookkeeper's refund in Kill Bill, the next read that reaches Kill Bill shows `awaiting_payment` with `paid_at` null, the job returns to `invoiced` (version +1), and the board total and the release hold return. brief: Invoice balance and status (Paid is never final).
6. **Release held for an unpaid invoice** (brief: Journeys 6). Slots on the half hour 08:00–17:30 Zurich, Monday–Saturday, ≥ 48 h ahead (exactly 48 h allowed); one open release per slot and per car (partial unique indexes). Book queues `Release booked: <car>, <slot label>` with the bay code. Completion locks car then release and checks `invalid_transition`, `invoice_unpaid` (live Kill Bill or last confirmed), `belongings_checked_in`; then records the release, frees the bay, marks `cancel_requested`, queues the subscription cancellation and sends `Your <car> has been released` synchronously; if mail refuses, everything rolls back (503 `mail_unavailable`). Cancellation: `DELETE subscription?entitlementPolicy=IMMEDIATE&billingPolicy=END_OF_TERM` only after the charged-through date exists; `billing_end_date` = Kill Bill's `billingEndDate` = the charged-through date; My cars shows `Released` and announces `Bay billing for <car> ends <date>.` once.
7. **Weekly review and a leaver** (brief: Journeys 7). Board: occupancy line, overdue list, unpaid invoices with `Outstanding:` lines and `Unpaid: CHF <total>` with an icon. Revoke: alertdialog opens on `Keep access`; confirm → member inactive, `revoked_at`, every session ended (`end_reason = revoked`, answers `access_revoked` forever); focus to `Restore access for <name>`. Restore revives no session.
8. **Outages without false success** (brief: Journeys 8). Each process probes storage (HEAD bucket), billing (`/1.0/healthcheck`) and mail (SMTP greeting) with 2 s timeouts, reused ≤ 5 s; staff screens poll `/api/status` every 5 s and show the published notice. Queue workers only claim effects whose service their own probe reports up; failures release the claim and retry after 3 s (≤ 10 s), so another process applies them within 30 s.

## Late decisions

- App pages embed the signed-in user and units (`<script id="lacquer-session" type="application/json">`) so the shell renders on first paint; without a live session it is `null` and the page reads `/api/me` (any 401 then follows Session end). decided: brief: Browser support ("usable within three seconds").
- The session cookie has no `Max-Age`: it outlives the session so an ended session answers `session_expired` or `access_revoked`, never `unauthenticated`. decided: brief: Sessions and staff access.
- Release completion tries the SMTP send a second time before answering 503 `mail_unavailable`; an outage still fails both at once and nothing is recorded. decided: a cut-off connection is not an outage (brief: Release completion).
- Job and release transitions live in one table, `src/shared/transitions.ts`, used by the server checks and the screens' buttons. brief: Engineering standards.
- From 768 px the car plan, scrubber and Reading history form one instrument pinned under the pane heading while the readings and ledger scroll; the plan is drawn at exactly 300 × 552 px (scale 1, every panel ≥ 46 px). decided: the instrument stays readable while stepping stages.

- The cross-section draws every panel and stage of a job on one µm scale (0 to the job's thickest stack, rounded up to 50 µm, minimum 100) with a Plex Mono scale on its left edge; each layer is labelled at its midpoint with a 1 px leader. decided: brief: Visual design › Coat stack craft ("shows where a car is original, refinished or suspected of filler").
- Car-plan band labels sit on a dialog-paper plate at each panel's open area; a band key (tint, pattern, label, code, range in the chosen unit) sits under the scrubber; scrubber ticks carry short stage names. decided: brief: Reading bands (tint, pattern and label at once).
- Band ranges are one shared table (`BAND_LIMIT_UM`) that the server's band decision and the key both read. brief: Engineering standards (one place per rule).
- The seed stores only the scrypt digest of the brief's seed password; no working credential literal is in source. brief: Configuration and secrets.

## Palette (hex used by the build)

| Role | Hex | Source |
|---|---|---|
| ground (putty) | `#E3DDD2` | brief: Visual design › Character; decided: HSL 39° 23 % 86 % |
| dialog paper | `#F1EDE6` | decided: a sheet on the bench, no shadow |
| ink | `#15181C` (13.2:1 on ground) | brief: Character |
| muted ink | `#57514A` (5.8:1) | decided: small secondary text |
| control outline | `#736B5F` (3.9:1) | brief: Contrast (deepened hairline) |
| field fill | transparent (the ground or dialog paper shows through) | decided: no off-palette fill |
| hairline (decorative) | `#BDB4A5` | brief: Contrast (exempt) |
| lacquer fill | `#B23A16` (white text 6.0:1) | brief: Colour roles, deepened |
| lacquer text | `#A3330F` (5.1:1) | brief: Contrast |
| lacquer hover | `#8F2C0D` | brief: Motion (buttons darken) |
| masking tape | `#F4CB3C` | brief: Colour roles |
| bands | thin `#B7C3CB` dots; factory `#C6D2B5` horizontal; refinished `#D6AA5E` diagonal; filler `#F0A386` cross-hatch | brief: Reading bands |

Tape yellow appears only on the current stage tick, the open round-entry row, the staged release row and the 500 ms saved-row edge. brief: Colour roles.

## Type, space and layout

- Archivo variable at `font-stretch: 125%` for car identity, screen titles and numeral labels; IBM Plex Sans body 16/1.55; IBM Plex Mono with tabular figures for every reading, amount, code and fingerprint. Scale 1 / 1.333 / 1.777 / 2.369 / 3.157 rem. brief: Type.
- Spacing 4-px scale; 12-column grid, 24 px gutters; radius 2 px; no shadows; every control, bay and panel ≥ 44 × 44 px. brief: Character, Density.
- Breakpoints exactly 768 and 1200 (brief: Screens and layout):

| Screen | < 768 | 768–1199 | ≥ 1200 |
|---|---|---|---|
| Board | Occupancy, Overdue care, Unpaid invoices stacked | first two side by side, Unpaid full width below | three side by side |
| Job page (staff and portal) | Car plan, Cross-section, Job ledger stacked | Car plan + Cross-section, Job ledger full width | three side by side |
| My cars | 1 card per row | 2 per row | 3 per row |
| Bays | floor plan, then Cars table | same | plan 8 columns, table 4 |
| Care round | `list "Care round"` of cards | `table "Care round"` | table |
| Navigation | behind `Menu` (links not rendered while closed) | in the top bar | in the top bar |

## Motion

| Element | Trigger | Duration | Easing | Reduced motion |
|---|---|---|---|---|
| Panel fills (12) | scrubber step or jump | 500 ms each, 30 ms stagger front→rear | `cubic-bezier(0.16,1,0.3,1)` on `clip-path: inset()` (WAAPI) | end state at once, no animation created |
| Cross-section layers | same step | from 200 ms; per layer min(200, 800/n) ms, bottom-up forward, top-down back | same, `transform: scaleY` | at once |
| Total film build numeral | same step | 200 → 900 ms count | ease-out cubic, tabular figures, rAF | at once |
| Dialogs | open / close | 200 ms in (opacity, 6 px rise), 100 ms out | ease-out-long | instant |
| Buttons | hover / press | 100 ms | linear `background-color`, `border-color` | instant |
| Saved row | after a save | 500 ms | `opacity` of a 3 px tape strip | strip shown, no fade |

A new step finishes every running coat-stack animation and the count before it starts. Re-read swaps never animate. brief: Motion and effects.

## States per async action

Pending copy appears at once in the named status region; success or error replaces it only after the server answers; errors stay until the user's next press; re-reads never touch a region (brief: Feedback states). The exact copy for every action, the no-answer copy of the four idempotent forms, `idempotency_conflict`, Sign in again, service notices, live re-read announcements and status labels is used verbatim from the brief's Feedback states tables.

## Server contract details decided where the brief is silent

- Error for an unknown `/api` route without a session: `401 unauthenticated` (decided: the session check precedes the not-found check in the published precedence).
- Validation messages not printed by the brief: `owner_id` "Choose an owner.", `bay_id` "Choose a bay from the floor plan.", `kind` "Choose an item kind from the list.", `direction` "Choose in or out.", `lines[n].kind` "Choose a line kind from the list.", `car_id` "Choose a car from the list." / "Choose a car.", `startup_schedule`, `active`, photo `kind`/`job_id` (decided: same plain imperative style as the brief's table).
- `paid_at` is the date (`YYYY-MM-DD`, the Zurich calendar date) of the Kill Bill payment that brought the balance to zero. brief: Invoice balance and status; Formats.
- Release `bay_code` is the car's current bay while open and the bay it left when released or cancelled (decided).
- Owners see actors who are staff as `{"id":"house","name":"Marrow & Lark Motor House"}`; their own actions as themselves. brief: Owner projection.

## Media and licences

| Asset | Licence | Source |
|---|---|---|
| Archivo variable (wght, wdth), latin | OFL-1.1 | Fontsource `@fontsource-variable/archivo` 5.3.0 |
| IBM Plex Sans 400/500/600, latin | OFL-1.1 | Fontsource `@fontsource/ibm-plex-sans` 5.3.0 |
| IBM Plex Mono 400/500, latin | OFL-1.1 | Fontsource `@fontsource/ibm-plex-mono` 5.3.0 |
| Icons (menu, close, triangle alert, log out, ruler, image, file check) | ISC | Lucide path data, inlined |
| Car plan, floor plan, band hatches, cross-section, empty-state marks | original | drawn in code |

Listed with SHA-256 in `app/assets.json`; licences and the OFL text in `app/THIRD_PARTY_NOTICES.md`.
