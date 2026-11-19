# TRUTH — Brightmoss Works Phosphene Yard

This file makes the brief (`instruction.md`) concrete without reinterpreting it. Every value gives its origin:

- `brief: <section>` means the value is copied verbatim from that section of the brief.
- `decided: <why>` means the brief is silent, and the reason given ties back to the brief's intent.

Where the build and the brief could disagree, the brief wins. Code references point at `app/src`.

---

## 1. Journeys: the ideal end-to-end flow

Shared start state for every journey: the seed state applied to an empty database (brief: Seed data).

- Ilse has 600 available credits, Tobi 40 and Odile 0. Nobody has a plan.
- Five receipted seed orders exist, PY-2026-000001 to 000005.
- The next invoice number is `PY-2026-000006` and the next credit note is `PY-CN-2026-000001` while the UTC year is 2026 (brief: Seed data).
- MinIO holds `renders/<render id>/export.mp4` for each of the four published pieces, uploaded from `app/seed/exports/*.mp4` (decided: Seed data needs "one ready 1080p, 16:9, 10-second MP4 export stored in MinIO at start"; the files are original ffmpeg renders, see §7).
- Seed invoice PDFs start `invoice_status` `pending` and are rendered by the 30-second retry (brief: Seed data).
- RabbitMQ has a durable `render.jobs` queue and a durable `render.jobs.dead` queue, both empty (brief: Services, RabbitMQ).
- Mailpit is empty. Seed orders send no email (brief: Seed data).

### J1. Describe to draft (DP-12, DP-13, DP-14, DP-15)
- **Start:** Ilse is signed in as a creator, on `/` (brief: Journeys 1).
- **Actions:**
  1. Ilse types a 3 to 500 character description into `textbox "Describe a piece"` and presses Enter or `button "Describe"` (brief: Interactions, Prompt bar).
  2. The `img "Assistant status: drafting"` panel flickers single cells. `status "Studio status"` reads `Drafting your piece...` (brief: Feedback states).
  3. The server calls `POST <WIREMOCK_URL>/v1/shader-graphs` with `{"prompt","engine":"GLSL"}`. There is a single attempt with a timeout of min(20 s, `PROVIDER_TIMEOUT_SECONDS`) (brief: Services, AI provider).
  4. The answer passes the shape check, and the server answers 201 with a version 1 draft (brief: API).
  5. The browser navigates to `/studio/pieces/<slug>`. The canvas runs the provider's fragment source, the validator prints the compile log, and the studio status reads `Draft ready. Tune it on the instrument panel.` (brief: Feedback states).
  6. Ilse drags or arrow-keys the faders (one hundredth of the range per arrow press, one tenth per Page key). The canvas changes in the same frame (brief: Interactions, Faders).
  7. Ilse presses `button "Save"`, which sends `PUT /api/pieces/<slug>` with `If-Match: "1"`.
- **Visible end:** `Saved version 2.` in the studio status. `/studio` lists the piece with state `draft` and version `2` (brief: Journeys 1, Feedback states).
- **Provider-recorded end:**
  - Postgres: one `pieces` row with `state` `draft`, `version` 2, `creator_id` Ilse, `fragment_source` from the provider, `uniforms` holding the saved fader values, and the `timeline` as saved. The slug is the kebab-case of `title_suggestion` plus `-` and 4 lowercase hex characters (brief: Services; `server/pieces.ts` `newSlug`). With the baseline answer the title is `Untitled tide` and the slug is `untitled-tide-xxxx`.
  - Kill Bill, MinIO, Mailpit and RabbitMQ: no change.
- **Failure branches:**
  - Provider down: 503 `provider_unavailable`. The copy is `The shader assistant is offline. Your prompt is kept; try again in a minute.`, the panel shows `error`, the prompt stays and no row is written.
  - Bad answer: 502 `provider_malformed` with `The shader assistant sent something we can't run. Try a different prompt.` (brief: Feedback states, DP-27).
  - A signed-out submit goes through `/auth/login?return_to=/` and the kept prompt is submitted on return (brief: Interactions).
  - A collector gets `Only creator accounts can start pieces.` (brief: Feedback states).

### J2. Keyframe and render (DP-17..DP-24)
- **Start:** Ilse opens `/studio/pieces/night-loom`. The draft is at version 1, with uniforms `uHue` 0.12, `uFilm` 0.7 and `uDrift` 0.5, a 10 s timeline, and one `Hue` track with keyframes at 0.0 s and 5.0 s, both `ease-in-out` (brief: Seed data).
- **Actions:**
  1. Using only the keyboard, Ilse selects the `Hue` layer (`button "Select Hue layer"`, `aria-pressed`) and moves the playhead.
  2. `K` adds a keyframe at the playhead. Studio status: `Hue keyframe added at <t> s.`
  3. Left/Right moves a keyframe by 0.1 s and Shift+Left/Right by 1 s. Studio status: `Hue keyframe moved to <t> s.`
  4. A blocked move announces `Hue already has a keyframe at <t> s.`. Delete removes a keyframe with `Hue keyframe removed.`. The easing radios announce `Hue keyframe easing set to <Ease in-out>.` (brief: Interactions, Timeline keyboard; Feedback states).
  5. `button "Save"` sends `If-Match: "1"`, and the studio status reads `Saved version 2.`
  6. Ilse picks `9:16`, `720p` and the duration 10. The format stays MP4 (decided: the editor defaults to `MP4`, and the journey names no format).
  7. The button reads `Render 9:16 · 10 credits` (brief: Business rules, cost = 10 × 1 at 720p). Ilse presses it, which sends `POST /api/pieces/night-loom/renders` with a fresh `Idempotency-Key`.
- **Visible end:** `status "Render status"` announces, in order:
  1. `Render queued. 10 credits reserved.`
  2. `Rendering 9:16 720p export.`
  3. `Export ready. 10 credits used.`

  The states `accepted` and `stored` are silent (brief: Feedback states, Render status). The editor re-reads the render every 2 s while it is unsettled. The pixel panel shows `rendering` and then `idle`. The balance shows 590 available and 0 reserved.
- **Provider-recorded end:**
  - Postgres, `renders` row: `state` `ready`, `cost_credits` 10, `attempts` 1, and `sha256` equal to the provider's value. `history` holds `accepted, queued, rendering, stored, ready` (brief: Business rules, Render jobs).
  - Postgres, ledger: a `reserve` entry (Ilse available −10 / Ilse held +10) and a `capture` entry (Ilse held −10 / `platform:consumed` +10) (brief: Business rules, Credit ledger).
  - Postgres, piece: `night-loom` at `version` 2.
  - Postgres, outbox: one `render_ready` row with `sent_at` set.
  - RabbitMQ: one persistent message on `render.jobs` (`message_id` = render id, body `{"render_id","piece_slug":"night-loom","attempt":1}`), acknowledged after the commit. `render.jobs.dead` stays empty (brief: Services, RabbitMQ).
  - Provider: `POST /v1/renders` with `X-Job-Id: <render id>`.
  - MinIO: `renders/<render id>/export.mp4`, whose bytes hash to the recorded `sha256` (brief: Services, MinIO).
  - Mailpit: one message to `ilse@studio-marrow.example` from `MAIL_FROM` with subject `Export ready: Night Loom` and no presigned link in the body (brief: Services, Mailpit).
  - Kill Bill: no change.

### J3. Publish a run (DP-28, DP-30)
- **Start:** J2's end state. `night-loom` is a draft with a ready render.
- **Actions:**
  1. `button "Publish"` opens `dialog "Publish edition run"`. Ilse enters `spinbutton "Editions"` 30 and `textbox "Price (USD)"` 15.00, and picks the ready export in `combobox "Export"`.
  2. `button "Publish run"` sends `POST /api/pieces/night-loom/publish` with `{"edition_count":30,"price_cents":1500,"export_render_id":"<id>"}`.
- **Visible end:** the studio status reads `Published as 30 numbered editions.`. On `/gallery`, "Night Loom" is the first card (newest first) in `region "Fresh runs"`, captioned `Ilse Marrow · 30 of 30 left` with the chip `GLSL` (brief: Journeys 3, Public screens and controls).
- **Provider-recorded end:**
  - Postgres: the `pieces` row has `state` `published`, `edition_count` 30, `price_cents` 1500, `export_render_id` = the J2 render, and `published_at` = now.
  - Kill Bill, MinIO, Mailpit and RabbitMQ: no change.
  - The featured run stays "Tidewire Bloom" while it is published (brief: Seed data).

### J4. Choose, hold and pay (DP-33..DP-46)
- **Start:** Pax is signed in as a collector and opens `/pieces/salt-halo` (12 editions at $9.99, none collected). The lens starts at edition 1 (decided: see §8).
- **Actions:**
  1. Pax focuses `slider "Edition"` and presses Right five times. N becomes 6, the URL becomes `?edition=6` via replaceState, and the numeral reads `6`. The caption moves from `of 12 · move to choose` to `of 12 · available` (brief: Public screens and controls).
  2. Enter sends `POST /api/pieces/salt-halo/editions/6/holds` with a fresh key, and the server answers 201.
  3. Checkout status: `Edition 6 of 12 is held for you. 10:00 left.`. The ring fills, the lens locks, and `dialog "Checkout"` slides in from the right with focus on `textbox "Billing name"`. The visible countdown reads `Held for <mm:ss>` and ticks every second. A resync from `GET /api/orders/<id>` runs every 30 s (brief: Business rules, Hold timing).
  4. Pax enters a billing name and email, and picks `Sweden` (`SE`). The sheet recomputes: VAT 25% = 250 cents (999 × 0.25 = 249.75, rounded half up), gross 1,249 (brief: Business rules, VAT).
  5. `button "Pay $12.49"` sends `POST /api/orders/<id>/buy` once and is disabled while in flight. The server answers 202 `paying`. Checkout status: `Payment sent. Waiting for Kill Bill to confirm.`
  6. The sheet re-reads the order every 2 s.
- **Visible end:**
  - Checkout status: `Payment confirmed. Edition 6 of 12 is yours.`, with `link "Open library"`.
  - `/library` shows "Salt Halo", `Edition 6 of 12`, `receipted` and invoice `PY-2026-000006`, with `button "Download export"` and `button "Download invoice"`. Each button fetches a fresh presigned link valid `PRESIGN_SECONDS` (300 s) (brief: Journeys 4, Downloads).
- **Provider-recorded end:**
  - Kill Bill: an account with external key = Pax's Keycloak user id, USD, UTC, bill cycle day 1, and the `__EXTERNAL_PAYMENT__` method as default.
  - Kill Bill: one external charge of $12.49 described `Salt Halo — edition 6 of 12`, giving one invoice and one successful purchase payment for the full amount (brief: Services, Kill Bill).
  - Postgres, `orders` row: `state` `receipted`, `edition` 6, `billing_country` `SE`, `net_cents` 999, `vat_rate_percent` 25, `vat_cents` 250, `gross_cents` 1249.
  - Postgres, same row: `invoice_number` `PY-2026-000006`, `invoice_status` `ready`, `receipt_status` `sent`, `paid_at` set, and `kb_invoice_id` and `kb_payment_id` recorded.
  - Postgres, `split_rows`: creator Ilse 899 and platform 100. This is the published rule: the floors are 899 and 99, and the leftover cent goes to the platform's 0.9 remainder (brief: Business rules, Sale split).
  - Postgres, `number_sequences`: `('invoice', 2026)` = 6.
  - Postgres: one `outbox` row of kind `receipt` with `sent_at` set.
  - MinIO: `invoices/2026/PY-2026-000006.pdf`, rendered by Gotenberg (brief: Services, Gotenberg).
  - Mailpit: one message to the entered email with subject `Your receipt for Salt Halo — edition 6 of 12` and the attachment `PY-2026-000006.pdf` (brief: Services, Mailpit).
  - RabbitMQ: no change.
  - The order's states run `held → paying → paid → invoiced → receipted`. The confirmation transaction writes `paid`, `paid_at`, the split rows and the invoice number together (brief: Business rules, Payment confirmation).

### J5. Remix and split (DP-51, DP-52, DP-53)
- **Start:** Tobi is signed in as a creator with 40 credits. "Tidewire Bloom" is Ilse's published piece.
- **Actions:**
  1. On `/pieces/tidewire-bloom`, Tobi presses `button "Remix"`, which sends `POST /api/pieces/tidewire-bloom/remix` and gets 201.
  2. The editor opens the new draft titled `Tidewire Bloom (remix)`, with `remix_of` set. Studio status: `Remix draft created from Tidewire Bloom.` (brief: Business rules, Remixes; Feedback states).
  3. Tobi renders the default export (16:9, 1080p, MP4, 10 s, 20 credits) and the render reaches ready as in J2.
  4. Tobi publishes the remix with an edition count and price of his choice (decided: the journey names neither).
  5. June holds and buys an edition as in J4.
- **Visible end:**
  - The remix card sits in `region "Remixes"` with the chip `Remix`.
  - The founder's `GET /api/admin/orders/<id>/splits` shows three `sale` rows that add up to `net_cents`: `creator` holder Ilse Marrow (the 15% royalty), `remixer` holder Tobi Ansel (net − royalty − fee) and `platform` holder Brightmoss Works (10%) (brief: Journeys 5, API).
  - Ilse's `GET /api/me/statements/<current YYYY-MM>` (status `open`) holds a `royalty` line with `date`, `piece_title`, `edition` and `amount_cents` only, with no buyer email, country or invoice number (brief: DP-53, API).
- **Provider-recorded end:**
  - Postgres: a new `pieces` row (`remix_of_id` = Tidewire Bloom, `creator_id` Tobi, published) and Tobi's ledger `reserve` + `capture` for 20 credits.
  - Postgres: June's order `receipted`, with three `split_rows`. The `creator` party's `holder_id` is the source creator (Ilse) and the `remixer` party's is Tobi (`server/orders.ts` `confirmPaid`).
  - Kill Bill: June's account, plus a charge and payment for the gross.
  - MinIO: the remix export and the invoice PDF.
  - Mailpit: `Export ready: Tidewire Bloom (remix)` to Tobi, and June's receipt.

### J6. Refund (DP-54, DP-55)
- **Start:** Wren is signed in as founder-operator on `/console`, tab "Orders". The order is a receipted order that Kill Bill charged, for example Pax's J4 order (decided: seed orders have "no Kill Bill records" (brief: Seed data), so Kill Bill cannot refund them. A seed-order refund answers 409 `invalid_transition` (`This order was not paid through Kill Bill, so it cannot be refunded here.`) before any Kill Bill call, with nothing recorded; `server/refunds.ts`).
- **Actions:**
  1. `button "Refund"` opens `dialog "Refund order"`. `textbox "Refund amount (USD)"` is prefilled with the remaining net (`9.99`).
  2. Wren enters a partial amount, for example `5.00`, and presses `button "Issue refund"`. This sends `POST /api/admin/orders/<id>/refunds` with `{"net_cents":500,"reason":""}` and a fresh key.
- **Visible end:** `Refund issued as PY-CN-2026-000001.`. The order row shows the remaining refundable amount, $4.99, and stays `receipted` (brief: Journeys 6, Feedback states).
- **Provider-recorded end:**
  - Kill Bill: a successful refund of $6.25 gross (net 500 + VAT 125 at 25%, rounded half up) on the original payment (brief: Business rules, Refunds).
  - Postgres, `refunds` row: `credit_note_number` `PY-CN-2026-000001`, `net_cents` 500, `vat_cents` 125, `gross_cents` 625.
  - Postgres, `split_rows`: two `refund` rows with negative amounts, split in proportion to the sale rows by floor and largest remainder (creator −450, platform −50).
  - Postgres, order: `refunded_net_cents` 500.
  - Postgres: `('credit_note', 2026)` = 1, and an `outbox` row `refund_notice`, sent.
  - MinIO: `credit-notes/2026/PY-CN-2026-000001.pdf`.
  - Mailpit: subject `Refund issued: PY-CN-2026-000001` to the order email, with the attachment `PY-CN-2026-000001.pdf`.
  - A refund up to the full net moves the order to `refunded` and frees edition 6 (brief: Business rules, Refunds).

### J7. Plans and ledgers (DP-56, DP-57, DP-58)
- **Start:** Odile is signed in as a creator with 0 credits and no plan, on `/studio/credits`.
- **Actions:**
  1. `button "Choose Studio"` sends `POST /api/me/plan` `{"plan":"studio-monthly"}`, and the server answers 202 `pending_payment`. Copy: `Waiting for Kill Bill to confirm your payment.`
  2. The 2-second poll (or a verified `INVOICE_PAYMENT_SUCCESS` callback) re-reads the subscription's invoices and their payments. The first paid subscription invoice makes the plan `active` and grants 300 credits. Copy: `Your Studio plan is active.` (brief: Business rules, Plans; Feedback states).
  3. `button "Cancel plan"` sends `POST /api/me/plan/cancel`. Kill Bill cancels at end of term, and the plan shows `cancelling` with `ends_on`. Copy: `Your plan ends on <date>.` The date is Kill Bill's billing end date, equal to the charged-through date: the 1st of the next month, because billing is monthly in advance on the 1st (brief: Business rules, Plans).
  4. Wren opens the console tab "Credit ledger".
- **Visible end:** Odile's balance is 300 available and the plan reads ends on `<date>`. In the console, every account's `balance` equals the sum of its rows in `entries` (brief: Journeys 7, DP-58).
- **Provider-recorded end:**
  - Kill Bill: Odile's account (external key = her user id) and a `studio-monthly` subscription in the uploaded catalog.
  - Kill Bill: a prorated first invoice paid by the external payment method, and the subscription's billing end date set by the end-of-term cancel.
  - Postgres: a `plans` row (`state` `cancelling`, `ends_on`, `kb_account_id`, `subscription_id`) and a `plan_grants` row keyed by the subscription invoice id.
  - Postgres: a ledger `grant` entry (`platform:issued` −300 / `creator:<odile>:available` +300).
  - MinIO, Mailpit and RabbitMQ: no change. Plans get no app VAT invoice (brief: intro, out of scope).

### J8. Through an outage (DP-47, DP-60)
- **Start:** The instance's `GOTENBERG_URL` is unreachable. June is signed in as a collector.
- **Actions:** June holds and pays for an edition as in J4. Wren opens `/console`.
- **Visible end:**
  - Checkout status: `Paid, invoice pending. Invoice PY-2026-<NNNNNN> will be ready shortly.`
  - The library row shows the same line, and `Download invoice` answers 409 `invoice_pending` with that copy.
  - `region "Service notices"` shows `Invoice rendering is down. Paid orders keep their invoice numbers and show "Paid, invoice pending" until their PDFs render.` within 20 s of the probe (brief: Feedback states, Services).
- **Provider-recorded end:**
  - Kill Bill: the charge and successful payment.
  - Postgres: the order is `paid` with `invoice_number` assigned, `invoice_status` `pending`, `receipt_status` `none`, and split rows written.
  - MinIO: no invoice key yet. Mailpit: no receipt yet. RabbitMQ: no change.
  - Every 30 s the retry re-renders with the same number. Once Gotenberg answers, the PDF is stored (`invoiced`), the receipt is queued and sent (`receipted`), and the banner clears within 20 s (brief: Business rules, Invoice rendering retry; DP-47).

---

## 2. Palette roles (as built: `app/src/web/styles.css` `:root`)

The hex values below are what the build uses. Roles come from brief: Visual design ("Palette, in words"). The values are decided in `DESIGN.md` § Palette, checked against WCAG 2.2 AA (brief: Accessibility of the look).

| Role (brief words) | Token | Value | Origin |
|---|---|---|---|
| ground, "near-black, edge to edge behind every live canvas" | `--ground` | `#0a0a0a` | brief: Visual design; value decided |
| surface, "slightly lifted charcoal" (cards, panels, inputs, pixel panel, banners) | `--surface` | `#121212` | brief: Visual design; value decided |
| raised surface (dialogs, menus, layer buttons) | `--raised` | `#181817` | decided: one tonal step so nested surfaces read without shadows |
| border, "dark-grey one-pixel borders" | `--border` | `#262626` | brief: Visual design; value decided |
| field border (inputs, ghost buttons, pills, badges) | `--field-border` | `color-mix(in srgb, #f4f3ef 40%, #121212)` (≈ `#6c6c6a`) | decided: `#262626` cannot identify a control (WCAG 1.4.11 needs 3:1) |
| ink, "warm off-white" | `--ink` | `#f4f3ef` | brief: Visual design; value decided |
| ink at rest for links and captions | `--ink-85` | `color-mix(in srgb, #f4f3ef 85%, transparent)` | decided: links "brighten on hover" (brief: Interactions) need a dimmer rest state |
| muted, "muted warm grey" | `--muted` | `#9a988f` | brief: Visual design; value decided at 6.48:1 on surface |
| inactive verb outline stroke | `--outline` | `#c5c4c1` (80% ink; about 3.6:1 even over the brightest allowed canvas) | brief: Visual design ("giant outlined words"); decided: AA over the live hero |
| accent, "single acid-yellow" | `--accent` | `#f1d82f` | brief: Visual design; value decided |
| accent hover | `--accent-hover` | `#f6e266` | brief: Interactions ("brighten on hover") |
| accent dim, the render button's "dimmed, half-strength yellow" | `--accent-dim` | `color-mix(in srgb, #f1d82f 40%, #121212)` | brief: Visual design |
| on-accent, "near-black labels on yellow" | `--on-accent` | `#0a0a0a` | brief: Visual design |
| olive top rows of the pixel panel | `--olive-1` / `--olive-2` (+ `#7a7025`) | `#6e6420` / `#857a2a` | brief: Visual design ("two olive top rows") |
| pixel body greys / lit shades | hard-coded | `#1a1a1a #222222 #2b2b2b #333333` / `#4a4a48 #5c5b57 #77756e` | brief: Visual design ("grey body cells") |
| header glass | `--glass` | `rgba(10, 10, 10, 0.72)` + `backdrop-filter` blur 14px | brief: Visual design ("dark translucent glass bar with a soft blur") |
| closing-band chevron | hard-coded | `#151515` | brief: Visual design ("faint dark chevron shape of original design") |
| piece colours (canvases only) | `web/gl/renderer.ts` `palette(slug)` | two hues hashed from the slug, re-mapped off 250–345° | brief: Visual design ("The featured piece's own colours light the hero"; "no violet or magenta glow anywhere") |

- Yellow marks only the next action, the active verb's dot, the focused or claimable edition, section numbers and the active edition (brief: Visual design).
- There is no red. Errors use the charcoal banner with a yellow left bar (brief: Visual design, Working screens).
- Signs are written `+` / `−` with a word label (brief: Visual design).

## 3. Type, space and layout per viewport

### Families (brief: Visual design, Type)

Fonts are self-hosted OFL copies in `public/fonts`, loaded via `web/fonts.css` with `font-display: swap`.

| Use | Family and stack | Weight / width |
|---|---|---|
| display headlines (sentence case, ending in a period) | `"Archivo", "Arial Black", system-ui, sans-serif` | 850, `font-stretch: 125%`, line-height 0.92, letter-spacing −0.01em, `text-wrap: balance` |
| edition numeral | `"Unbounded", "Archivo", system-ui, sans-serif` | 800, line-height 1, `tabular-nums` |
| body | `"Hanken Grotesk", system-ui, -apple-system, "Segoe UI", sans-serif` | 400 at 16px / 1.6; 500 for eyebrows, the strip and labels; `tabular-nums` (`.tabular`/`.num`) on every price, credit count and edition number |
| shader code, validator, seed hashes only | `"JetBrains Mono", ui-monospace, "SFMono-Regular", Menlo, monospace` | 13px |

Heading steps use ratio 1.2: `--step-0..3` = 16 / 19 / 23 / 28px (brief: "about 1.2 per level").

### Sizes per viewport (px)

| Element | 375 (phone) | 768 (tablet) | 1280 (desktop) | Origin |
|---|---|---|---|---|
| section headline `.display` | 46 | 70 | 70 (`clamp(70px, 5.4vw, 112px)`) | brief: "about five to seven times the body" on desktop, "about three times" on phone; decided: measured in Chromium, columns 1–7 are 703px at 1280 and the longest line (`Every number is`) is 691px at 70px, so 70 keeps every headline to two lines (`Pieces that` / `keep running.`, `Tune it by` / `hand.`, `Every number is` / `its own frame.`) |
| hero verbs | 40 | 56 | ≈ 84 (`clamp(56px, 6.6vw, 88px)`) | brief: Visual design ("giant outlined words") |
| closing band headline | 56 | ≈ 68 | ≈ 113 (`clamp(56px, 8.8vw, 132px)`) | brief: Visual design (three-line headline) |
| page h1 | 36 | 36 | ≈ 44 | decided: 1.2 scale |
| gallery section titles | 28 | 28 | ≈ 31 | decided |
| empty-state sentence | 40 | 40 | ≈ 56 (`clamp(40px, 4.4vw, 64px)`) | brief: "64 px-class display sentence" |
| card title / plan title / table caption / table title | 28 / 23 / 19 / 17 | same | same | brief: "display-face title in a small size" |
| edition numeral | 34 | 44 | 44 | brief: "Unbounded, heavy"; size decided |
| lens caption / eyebrow / strip / chip | 13 / 14 / 13 / 12 | same | same | brief: "small Hanken Grotesk medium text" |
| body | 16 | 16 | 16 | decided |

### Space and layout

All of this is brief: Screens and layout, with values decided where the brief gives none.

**Margins, grid and spacing**
- Side margin: 32px at tablet and desktop, 20px on phones (brief).
- Grid: 12 columns, gutter 16px (gutter decided).
- Section padding: 128px (80px phone). The split intro has 64px (40px phone) below it. Gallery sections have 96px below.
- Studio header: 64px at every size.
- Hero: `100vh`, minimum 620px (680px phone).

**Corners and touch targets** (brief: Visual design)
- Corners: 10px on cards and panels, 8px on buttons and inputs, 999px only on pills (brief).
- Touch targets: at least 44 × 44px for every control. Large next-action buttons are 56px tall.

**Desktop (≥ 1280)**
- Split intro: headline in columns 1/span 7, paragraph and arrow link in columns 10/span 3, `align-self: end`.
- Piece page: canvas + lens in columns 1–8, details in 9–12.
- Editor: canvas in 1–8, instrument panel in 9–12, timeline full width below.
- Gallery: 3 columns, 6 cards per section.
- Checkout sheet: from the right, `max(400px, 40vw)`, which is 512px.
- Tables everywhere.

**Tablet (768–1279)**
- Split intro stacked (headline, then paragraph and link).
- Gallery: 2 columns, 4 cards per section.
- Piece page and editor canvas: full width on top. Faders sit in a 2-column grid.
- Checkout sheet: from the right, 400px.
- Tables everywhere.

**Phone (< 768)**
- Menu button replaces the inline nav.
- Hero: verbs shrink, the prompt bar goes full width, the strip wraps to two lines.
- Every two-column split stacks.
- Gallery: snap carousels of 6 cards at 85% width. Each card has `scroll-snap-stop: always`, so one swipe advances exactly one card (brief: Interactions, "swipe sideways and snap card by card").
- Checkout sheet: rises from the bottom at full width (max-height 88vh).
- Studio, console and library: stacked rows or cards. The library becomes `list "Your editions"`.
- Editor: one fader column, and the timeline becomes a stacked track list.

**Lens and pixel panel**
- Lens: 240px at 768 and wider, 176px below (brief: Motion and effects).
- Pixel panel: 10×10 cells, square charcoal, bottom-right corner cut at 45° by `clip-path`. The editor mini panel is 96px.

## 4. Motion

Sources:
- The brief values come from brief: Motion and effects and Interactions.
- Easing tokens: `--ease-standard` = `cubic-bezier(0.4, 0, 0.2, 1)` and `--ease-out-expo` = `cubic-bezier(0.16, 1, 0.3, 1)` (decided: soft settle for entrances, standard for state changes).
- Reduced motion is `@media (prefers-reduced-motion: reduce)` in `styles.css` plus `useReducedMotion` in `web/session.tsx`.

| Element | Trigger | Duration | Easing | Reduced-motion substitute | Where |
|---|---|---|---|---|---|
| hero canvas fade-in | first mount | 1000ms (brief: "about one second") | `cubic-bezier(0, 0, 0.2, 1)` | appears in place (class not added) | `EditionStage.tsx`, `.canvas-fade` |
| hero verbs rise | mount | 1400ms each, stagger 100ms (brief: "about one and a half seconds") | expo | appear in place | `Landing.tsx`, `.verbs-enter` |
| verb cycle | `setInterval` 3000ms (brief: 2.5–3.5 s); a tick is skipped while the hero is off-screen, so the step is kept | 500ms fill/outline cross-fade; dot opacity + scale 0.4→1 | standard | all five shown, `Describe.` filled, no timer | `Landing.tsx` |
| prompt typewriter | load | 40ms per character (25 cps, brief) | linear steps | full placeholder at once; it also stops for good on focus or input | `Landing.tsx` |
| scroll entrance (`Reveal`) | first IntersectionObserver hit, once | 1400ms, translateY(40px) + opacity, siblings `i × 100ms`; headlines, cards and list rows only (the pixel panel and empty states stand still) | expo | no animation is started; the resting style is always visible (`element.animate` with `fill: backwards`) | `ui.tsx` `Reveal` |
| hover (links, buttons, tabs, nav) | hover | 160ms (brief: "about a sixth of a second") | standard | instant | `styles.css` |
| arrow nudge | hover on arrow links / next-action | translateX(3px), 160ms | standard | instant | `styles.css` |
| button press | `:active` | scale(0.98), 160ms | standard | instant | `styles.css` |
| focus ring | focus | instant, 2px `#f1d82f` (brief) | — | same | `styles.css` |
| card canvas zoom | card hover | 1400ms, scale(1.04) (brief: "about one and a half seconds") | expo | none | `styles.css` |
| header glass | scroll past the hero (landing) / > 8px (other pages) | 300ms on background, border, backdrop-filter | standard | instant | `Header.tsx`, `styles.css` |
| lens follow | pointer move | exponential lag τ = 110ms (settles in ≈ 0.5 s, brief) | `1 − e^(−dt/0.11)` per frame | jumps to the pointer; redraws on demand | `EditionStage.tsx` |
| numeral jump | N changes | 160ms, scale 1.15 → 1 (WAAPI) | `cubic-bezier(0.2, 0, 0, 1)` | number changes, no scale | `EditionStage.tsx` |
| lens ring | status change | 500ms border-colour cross-fade (brief: about half a second) | standard | instant | `styles.css .lens-*` |
| checkout sheet | hold granted / reopen | 450ms: slides in 48px from the right edge (phone: rises 48px from the bottom) while fading in, so its fields are inside the viewport and usable from the first frame | expo | appears in place | `ui.tsx` Dialog, `styles.css sheet-in` |
| centre dialogs (publish, refund) | open | 300ms opacity | expo | in place | `styles.css` |
| pixel panel flicker | drafting / rendering | one body cell changes shade every 150ms (brief: 100–200ms) | 90ms linear background | fixed `STILL_PATTERN` per state | `ui.tsx` `PixelPanel` |
| status badge / live status line | state change | 500ms colour change / 500ms opacity `status-in` | standard | instant | `styles.css` |
| live canvases | every frame while on-screen; paused by IntersectionObserver when fully off-screen | rAF | — | one still frame at time 0 (the editor: the still frame at the playhead, redrawn only when the playhead or a fader moves) | `LiveCanvas.tsx`, `gl/renderer.ts` |
| Play preview | press | real-time playback | — | steps the playhead +0.1 s each second | `Editor.tsx` |

Without WebGL, a Canvas 2D still of the slug palette is drawn, with the text `This piece plays live with WebGL. Showing a still frame.` (brief: Motion and effects).

## 5. States per async action

All copy is character for character, from brief: Feedback states, unless a row says `decided`. Live region names come from brief: Public screens and controls. The copy lives in `app/src/web/copy.ts`.

| Action | Idle / trigger | Pending | Success | Errors (status → copy) |
|---|---|---|---|---|
| describe | prompt bar; panel `idle` | `Drafting your piece...`; panel `drafting` (flickers) | navigates to the editor; `Draft ready. Tune it on the instrument panel.` | 422 field `Describe the piece in 3 to 500 characters.`; 503 `The shader assistant is offline. Your prompt is kept; try again in a minute.`; 502 `The shader assistant sent something we can't run. Try a different prompt.` (panel `error` until the next submit); 403 `Only creator accounts can start pieces.` |
| save | `button "Save"`; fader and keyframe edits never save on their own | button disabled while in flight (decided: prevents a self-inflicted 412) | `Saved version <v>.` | 412 `This piece changed in another tab. Reload to see version <v>.` (`current_version`); 409 `invalid_transition` on a non-draft (server message, decided) |
| keyframe edit (local) | timeline keys | — | `<label> keyframe added at <t> s.` / `<label> keyframe moved to <t> s.` / `<label> keyframe removed.` / `<label> keyframe easing set to <easing name>.` | `<label> already has a keyframe at <t> s.` |
| upload | `button "Upload audio stem"` / `"Upload font"` / `"Upload model"` | — | `<file name> uploaded.` | 413 `That file is over 20,000,000 bytes.`; 422 extension (server field message, decided); 503 `storage_unavailable` |
| render | `button "Render <aspect> · <cost> credits"` (dimmed and disabled when short or unsaved) | `Render queued. <cost> credits reserved.` then `Rendering <aspect> <resolution> export.`; panel `rendering`; re-read every 2 s | `Export ready. <cost> credits used.`; panel `idle` | 402 `This render needs <cost> credits; you have <available>.`; failed `Render failed. Your credits are being returned.` then `<cost> credits returned to your balance.`; timed out `Render timed out after 3 attempts.` then `<cost> credits returned to your balance.`; panel `error` |
| cancel render | `button "Cancel render"` while queued | — | `Render cancelled.` then `<cost> credits returned to your balance.`; panel `idle` | 409 `invalid_transition` |
| publish | `dialog "Publish edition run"` | `Publish run` disabled in flight | `Published as <M> numbered editions.` | 422 fields (`edition_count` 1..500, `price_cents` 100..500000, `export_render_id`) with the `Check <count> fields.` alert summary; 409 `invalid_transition` |
| withdraw | `button "Withdraw"` | — | `Withdrawn. Owners keep their downloads.` | 409 `invalid_transition` |
| remix | `button "Remix"` (piece page, creators, not own) | — | navigates to the editor; `Remix draft created from <source title>.` | 409 `own_piece` / `remix_of_remix` (server message, decided) |
| hold | lens Enter / click / tap | — | `Edition <N> of <M> is held for you. <mm:ss> left.`; countdown `<minutes> minutes left on edition <N>.` / `1 minute left on edition <N>.` / `30 seconds left on edition <N>.`; sheet `Held for <mm:ss>` | 409 `Edition <N> was just taken. Showing edition <K>.` / `Every edition of this run is taken.`; expiry `Your hold on edition <N> expired.`; 403 collector role: `Only collector accounts can hold editions.` (decided); own piece: `This is your own run; collectors choose its editions.` (decided) |
| buy | `button "Pay $<gross>"` | `Payment sent. Waiting for Kill Bill to confirm.`; button disabled | `Payment confirmed. Edition <N> of <M> is yours.` + `link "Open library"`; Gotenberg down: `Paid, invoice pending. Invoice <invoice number> will be ready shortly.` | fields: `We can't invoice that country yet.` / `Enter an email address.` / `Enter the name for the invoice.` with `Check <count> fields.`; Kill Bill failure `Payment failed. Edition <N> is released.`; 503 `Payments are offline right now. Your hold is kept until its timer runs out.`; 409 `hold_expired` → `Your hold on edition <N> expired.` |
| refund | `dialog "Refund order"`, amount prefilled with the remaining net | `Issue refund` disabled | `Refund issued as <credit note number>.` | 409 `Refunds close 30 days after payment.`; 422 `Refund between $0.01 and $<remaining>.`; 503 `Kill Bill is unreachable, so refunds are paused. Nothing was refunded.` (decided: the brief gives no refund-503 line; this reuses the Kill Bill banner's facts) |
| plan | `button "Choose Studio"` / `"Choose Pro"` | `Waiting for Kill Bill to confirm your payment.` | `Your <Plan> plan is active.` | 409 `plan_exists` (server message); 503 `payments_unavailable` |
| cancel plan | `button "Cancel plan"` | — | `Your plan ends on <date>.` | 409 `Your plan can be cancelled once Kill Bill confirms it.` |
| pack | `button "Buy 500 credits"` | `Waiting for Kill Bill to confirm your payment.` | `500 credits added.` | 503 `payments_unavailable` |
| statements close | `button "Close <Month YYYY>"` | — | `Statements for <Month YYYY> sent to <count> creators.` | 409 `<Month YYYY> is still open.`; 409 `period_closed` (server message `<Month YYYY> is already closed.`, decided) |
| downloads | `button "Download export"` / `"Download invoice"` | — | the browser follows the fresh presigned URL in the same tab | 503 `Downloads are paused while file storage is offline.`; 409 `Paid, invoice pending. Invoice <invoice number> will be ready shortly.`; another user's order gets the same 404 as a missing one |

Empty states (brief: Feedback states): `Nothing numbered yet.` + `link "Start a piece"`; `No remixes yet.` + `link "Browse the gallery"`; `No pieces yet.` + `link "Start a piece"`; `No editions collected yet.` + `link "Browse the gallery"`.

Outage banners (brief: Feedback states), one per unreachable service: Kill Bill, render provider, Gotenberg, Mail and MinIO, with the exact strings stored in `copy.banners`.

Without WebGL, every canvas shows `This piece plays live with WebGL. Showing a still frame.` (brief: Motion and effects).

## 6. Breakpoints

There are exactly two layout breakpoints (brief: Screens and layout).

| Viewport | Width range | CSS | JS (`web/session.tsx` `useViewport`) |
|---|---|---|---|
| phone (375 × 812) | < 768 | `@media (max-width: 767px)` | not `(min-width: 768px)` |
| tablet (768 × 1024) | 768–1279, 768 counts as tablet | `@media (max-width: 1279px)` | `(min-width: 768px)` and not `(min-width: 1280px)` |
| desktop (1280 × 800) | ≥ 1280, 1280 counts as desktop | base rules | `(min-width: 1280px)` |

- No other media query changes which layout a published viewport gets. The only other query is `prefers-reduced-motion: reduce`.
- No page scrolls horizontally. Wide tables scroll inside their own frame at tablet and become cards on phones.

## 7. Media and licences (`app/assets.json`)

| File | Source | Licence |
|---|---|---|
| `public/fonts/archivo-latin-wdth.woff2` | `@fontsource-variable/archivo` 5.3.0 npm tarball (`archivo-latin-wdth-normal.woff2`) | OFL-1.1 |
| `public/fonts/unbounded-latin-wght.woff2` | `@fontsource-variable/unbounded` 5.3.0 | OFL-1.1 |
| `public/fonts/hanken-grotesk-latin-wght.woff2` | `@fontsource-variable/hanken-grotesk` 5.3.0 | OFL-1.1 |
| `public/fonts/jetbrains-mono-latin-wght.woff2` | `@fontsource-variable/jetbrains-mono` 5.3.0 | OFL-1.1 |
| `seed/exports/tidewire-bloom.mp4` | generated for this app with ffmpeg (lavfi `gradients`, spiral, 1920×1080, 24 fps, 10 s, H.264) | original |
| `seed/exports/salt-halo.mp4` | generated with ffmpeg (lavfi `geq` concentric ripple) | original |
| `seed/exports/lantern-static.mp4` | generated with ffmpeg (lavfi `cellauto` rule 30) | original |
| `seed/exports/halo-undertow.mp4` | generated with ffmpeg (lavfi `life` B3/S23) | original |

- Each file's SHA-256 and the full ffmpeg command are recorded in `app/assets.json`. The fonts' OFL texts ship in `public/fonts/OFL-*.txt`.
- Icons are Lucide outline icons (ISC), with paths inlined in `src/web/components/ui.tsx`. No icon package is shipped.
- Every canvas image is computed in the browser by WebGL (or the Canvas 2D fallback), so there are no raster images. Brief: Visual design asks for an "original procedural thin-film field"; decided: no stock or third-party imagery.
- Licences for every shipped package: `app/THIRD_PARTY_NOTICES.md` (IF-02, IF-03).

## 8. Decisions recorded from the code

Each decision was checked against the source.

1. **Sessions** (`server/auth.ts`):
   - After the Keycloak code + PKCE exchange, the session is an HMAC-signed cookie `py_session`, `HttpOnly; SameSite=Lax; Path=/; Max-Age=28800` (8 h). It carries the person's id, names and realm roles. There is no server-side session store.
   - The signing key is derived from `AUTH_CLIENT_SECRET`. A short-lived signed login-attempt cookie scoped to `/auth` carries state, nonce, PKCE verifier and `return_to`.
   - Decided: brief Services asks for "HttpOnly and SameSite=Lax", and IF-04 forbids state that lives only in memory, so a signed cookie keeps sessions valid across instances without a store.
2. **Safe `return_to`:** only a path that starts with `/`, not `//`, and contains no `\` is accepted. Anything else becomes `/` (decided: this prevents an open redirect through the sign-in round trip).
3. **Public canvases use the house shader** (`web/gl/renderer.ts`):
   - The hero, gallery cards, gallery featured run, piece page and library thumbnails all run the platform's own procedural thin-film "house" fragment shader. It is coloured by a palette derived from a hash of the piece slug (two hues, re-mapped to skip the 250–345° violet/magenta arc), and uses the edition's `uSeed` (base 0, lens = edition N's seed).
   - The editor runs the piece's real `fragment_source`.
   - `tint()` maps each hue into [345°, 360°) ∪ [0°, 250°). The dial folds back at its ends instead of wrapping, and a piece's two hues sit 0.08–0.22 apart inside it (`palette` keeps the first hue in 0..0.78), so the RGB blend stays within one colour family and never passes through violet. The four seeded shaders use the same off-violet hue dial for their `uHue` uniform (decided: brief Visual design "no violet or magenta glow anywhere").
   - Decided: brief API exposes `fragment_source` only to the owner, and brief Visual design asks that the hero be "an original procedural thin-film field ... coloured by the piece itself" with "no violet or magenta glow anywhere".
4. **Two supporting read endpoints** the screens need but brief API omits (decided: the Studio list and the console Statements tab need data that no listed endpoint returns):
   - `GET /api/me/pieces` (creator; the studio list: title, state, version, editions sold);
   - `GET /api/admin/statements` (founder-operator; `{"periods":[{"period","status","creators","closed_at"}]}` from the first sale month to now, newest first).
5. **Lens start:** the landing lens starts at edition 14 (brief: Visual design, "reads `14` at load") or at `?edition=N`. The piece-page lens starts at edition 1, or at `?edition=N` (decided: the brief gives no piece-page start, and 1 is the slider's minimum).
6. **Render retries** (`server/renders.ts` `processJob`, `server/queue.ts`):
   - Retries run inside the consumer, which holds the unacknowledged message (prefetch 16).
   - The wait before attempt n+1 is `RENDER_BACKOFF_SECONDS × n`: 5 s before attempt 2 and 10 s before attempt 3 (brief: Business rules, Retries).
   - After attempt 3, the job goes to `<RENDER_QUEUE>.dead` with `failure_reason`, and its credits are released.
   - The message is acknowledged only after the state change commits, and is nacked and requeued after 2 s if settling throws.
   - A redelivered job whose render is no longer `queued`/`rendering` does nothing.
   - Every 10 s, queued renders whose publish never reached RabbitMQ are republished (decided: an accepted render must not be stranded when RabbitMQ blips at accept).
7. **Kill Bill confirmation** (`server/billing.ts`):
   - A verified callback (token compared in constant time, identity `eventType|objectId|paymentId` inserted once into `processed_events`) or the 2-second poll both call `invoiceOutcome`, which re-reads the invoice's payments from the Kill Bill API.
   - Only that read confirms or fails anything (brief: Business rules, Payment confirmation).
   - A callback whose processing throws deletes its identity, so a later delivery can apply it.
8. **Seeded exports** are the original ffmpeg-generated MP4s in `app/seed/exports`. They are uploaded to `renders/<seed render id>/export.mp4` at start (retried every 10 s while MinIO is down), and their SHA-256 is recorded on the seed render (decided: Seed data requires a stored export per published piece).
9. **Background loops** (`server/main.ts`):
   - hold expiry every 1 s;
   - Kill Bill poll every 2 s;
   - outbox scan every 5 s, only while this instance's latest mail probe succeeded;
   - service checks every 10 s;
   - render republish every 10 s;
   - invoice, credit note and statement PDF retry every 30 s.

   Postgres at boot is retried every 2 s, and the Kill Bill catalog/callback setup every 15 s.
10. **Idempotency** (`server/idempotency.ts`):
    - The record is keyed by user, method, path and key.
    - The key row is inserted first, carrying a SHA-256 fingerprint of canonical JSON (sorted keys).
    - A stored replay returns its status and body with `Idempotent-Replayed: true`. A different fingerprint gives 409 `idempotency_key_reused`, and a row with no stored status yet gives 409 `idempotency_in_progress`.
    - 5xx answers delete the row, so nothing is stored. Records expire after `IDEMPOTENCY_TTL_SECONDS` (brief: Business rules, Idempotency).
11. **Money** is integer cents everywhere. VAT is computed half up in `shared/rules.ts` `vatCents`, and the split and refund allocation live in `server/splits.ts` (brief: Business rules, VAT and Sale split).
