# TRUTH — Lumenfold Dispatch golden

The brief made concrete. Every value says where it came from: `brief: <section>` (verbatim) or
`decided: <why>` (the brief is silent; the reason ties it to the brief's intent).

## Journeys (ideal end-to-end flow)

1. **Retry without paying twice** (brief: Journeys 1; DP-01..04, DP-07).
   Start: Mara holds `dpk_mara_4c19e7`; Storefront has 5,000.00 credits granted.
   Mara `POST /api/jobs` `{"model":"reel-10","input":{"prompt":…,"duration_seconds":10}}` with `Idempotency-Key: K` →
   `201 {"job"}` (queued, reserved 85,000,000 micro). One `reserve` movement (available −85,000,000 / reserved +85,000,000).
   Same request again → `201`, identical body, header `Idempotent-Replayed: true`, no new job/movement; the replay is
   listed in the meter's `recent_replays` for 10 s. Browser: one notch tab `Job j_N, 10.0 video-seconds reserved`;
   on the replay its outline brightens and fades within 220 ms (static 1 s outline under reduced motion) and
   `Meter announcements` reads "Job j_N already reserved; nothing added". Jobs table shows one row.
   Provider: one `jobs` row, one `reserve` movement, one `idempotency_keys` row (decided: keys scoped per team, 24 h).
2. **Playground run and reuse** (brief: Journeys 2; DP-12, DP-15, DP-16).
   Ines on `/run` picks Halftone XL; the form is rebuilt from the schema (Prompt textarea, Width/Height selects at
   1024, Number of images 1–4, Starting image media field), focus moves to Prompt; estimate "Estimated 3.50 credits
   for 1.05 megapixels". Run → "Submitting…" → Notices "Job j_N queued — 3.50 credits reserved." A notch slides out
   of available (420 ms) and the job appears in the "Halftone XL lane". On success the notch resizes then merges into
   settled; the output thumbnail appears in the Lineage strip. Library → search → asset dialog → "Use as input" opens
   Run with the current model (or Reel 10) and fills its first media field with `asset:<id>`; the second run's output
   is linked to the first by a drawn connector. Provider: `asset_edges(from=a1, to=v1)`; objects under
   `outputs/t_campaigns/j_N/1.png` and `…/1.webm`.
3. **Top up and reconcile** (brief: Journeys 3; DP-30, DP-31, DP-33, DP-34).
   June on `/finance`, Team "Campaigns", Credits 1000, Top up → "Recording payment…" → "Added 1,000 credits to
   Campaigns."; Top-ups row Paid with the Kill Bill invoice id; Ledger row `top_up` funding −1,000,000,000 /
   available +1,000,000,000 carrying `kb_invoice_id`; ribbon available grows; receipt email
   "Top-up receipt: 1,000 credits for Campaigns" to june@halden.example with `10.00` USD and the invoice id;
   "Export ledger CSV" sums per account to the ribbon totals. Kill Bill: account external key `t_campaigns`
   (USD, name "Campaigns", `__EXTERNAL_PAYMENT__` default method), one committed invoice with one external charge
   "Dispatch credits tu_N", one successful PURCHASE payment.
4. **Rate change on a known date** (brief: Journeys 4; DP-22..24). June schedules Reel 10 at "9.5" effective
   "YYYY-MM-DD HH:MM" in America/New_York → `micro_per_unit` 9,500,000, `effective_at_local` "…T…:00" →
   Notices "New rate for Reel 10 takes effect <local> America/New_York." Jobs submitted before the instant keep
   `r_3` (8.500000) for reservation, settlement, CSV and every screen; later jobs use the new rate.
5. **Setting policy** (brief: Journeys 5; DP-38, DP-39, DP-41, DP-42). Rafael on `/admin` sets Campaigns
   "Murmur Voice playground" Blocked, lowers the Campaigns soft cap, Storefront Payload visibility Restricted, Save
   policy → "Policy saved as version N+1."; Ines sees Murmur Voice "Blocked for playground" (aria-disabled); Theo's
   Jobs row for Mara's job shows "Hidden — restricted payload" with status, model and cost.
6. **Webhooks fail and recover** (brief: Journeys 6; DP-25..29). Mara adds an endpoint → `dialog "Signing secret"`
   shows `whsec_<32 hex>` once with Copy secret. Final jobs deliver signed events; failures retry after
   base×2^(n−1) s (2, 4, 8, 16, 32 by default); the 6th consecutive failure disables the endpoint, cancels pending
   retries and emails admins "Webhook endpoint disabled: Storefront"; Rafael's "Re-enable <url>" → "Endpoint
   re-enabled."; the next event is delivered.
7. **Deleting media** (brief: Journeys 7; DP-43..47). Sol searches, opens the asset, Delete → `alertdialog "Delete
   asset"` (focus on Keep) → Delete permanently → "Asset a_N deleted from storage, search and lineage.", focus to
   the search box; object removed first, then `removed_at`; reads answer 410 `asset_gone` with `reason:"deleted"`;
   derived output's lineage shows "Removed <d Month yyyy> (deleted)" tombstone.
8. **Storage outage** (brief: Journeys 8; DP-35..37). With storage unreachable the server reports `storage:"down"`
   within 5 s (decided: checks every 5 s); text-only jobs reserve and queue with `waiting_reason:"storage_unavailable"`
   and lane text "Waiting for storage"; uploads and URL inputs answer 503; the Service status region shows the
   storage notice; when storage returns the dispatcher resumes within one check (≤ 5 s) without restart.

## Rules made concrete (decided)

- Unknown `model` in a submission: 422 on `model`; an `asset:` reference that is unknown, gone or hidden: 422 on
  the field ("That asset is not available. Choose a live asset you can see.") — decided: it is a body field.
- Submission order: idempotency (session advisory lock per team+key, held to the end so duplicates wait) → member
  role → model_blocked → schema + address checks (422) → 402 → 429 → 503 for URL inputs while storage is down →
  fetch and store URL inputs → one transaction (team row lock, re-check funds, job, reserve movement, idempotency
  record). Brief: Error precedence.
- Job input is stored with schema defaults applied (decided: the run uses those values).
- Jobs CSV `team` and `submitted_by` columns carry ids (decided: stable, unambiguous).
- A withdrawn rate is deleted from the schedule (decided: rates are not ledger movements).
- The browser learns the org time zone from `<meta name="org-timezone">` filled at serve time (decided: members
  cannot read the policy, and no extra endpoint may be added).
- Person references on rates, top-ups, endpoints and policy versions use `{"id","name"}` (decided: same shape as
  jobs and assets); seeded rates and version 1 have `null`.
- Lease lapse: lapses 1 and 2 return the job to `queued`; the 3rd fails it `lease_expired` (brief: state machine).
- A stored replay answers the first 201 as stored even when the same request would now be refused (blocked model,
  hard cap); a teammate replaying in a restricted team gets the restricted projection (brief: Idempotency, L328).
- A queued job whose model is now blocked for the context it was submitted in (`api` key / `playground` session)
  fails `model_blocked` when the dispatcher reaches it, releases its whole reservation, and the slot goes to the
  next job (brief: L339, L353).
- Webhook events go to each endpoint one at a time, oldest first; later events wait behind a retrying one with no
  delivery row; only the 6th failed attempt in a row abandons it, disables the endpoint and records the waiting
  events `skipped_disabled` (brief: Webhooks, L461-463).
- Kill Bill: the account is looked up by external key before it is created; before each pending retry the server
  reads the account's invoices for "Dispatch credits <top-up id>" and that invoice's payments, reuses an existing
  invoice and never pays a paid one twice; top-up ids are `tu_` + 16 random lowercase hex (brief: L478, L495, L567).
- Lineage walks through tombstones in both directions; tombstones keep their edges (brief: L74, L444).
- An asset reads as gone with reason `expired` from the instant `expires_at` is reached, before the sweeper runs
  (brief: L439).
- Output media: Quill Still PNG 1024×1024 per image; Halftone XL PNG width×height per image; Reel 10 one WebM
  container header 1280×720 with the duration; Murmur Voice one 8 kHz 8-bit mono WAV of the billed seconds
  (decided: smallest exact format).

## Palette (DESIGN.md)

| Role | Hex | Source |
|---|---|---|
| ground (bone) | `#F3EEE4` | brief: Visual design; decided hex |
| panel | `#FAF7F0` | decided: hairline-separated flat panels |
| ink (graphite) | `#1E1C19` (14.7:1 on ground) | brief: Visual design |
| muted | `#5C564D` (6.3:1) | decided |
| rule (hairline) | `#D6CCBB` | brief: Visual design |
| rule-strong | `#8B8070` (3.35:1) | decided: control boundaries and essential graphics ≥ 3:1 |
| teal (settled only) | `#0E5C57` (6.8:1) | brief: Visual design |
| vermilion (in-flight, caps) | `#C4391D` (4.6:1) | brief: Visual design |

## Type

Bricolage Grotesque 600/700 for headings; IBM Plex Sans 400/500/600 body at 14px; IBM Plex Mono 400/500 with
tabular figures for every number. Heading scale ×1.2 per level from body: h3 16.8px, h2 20.16px, h1 24.19px
(brief: Type). All fonts self-hosted woff2 (brief: Browser support).

## Space and layout per viewport

| Viewport | Layout | Source |
|---|---|---|
| 1280×800 | rail ≈ 1/6 at left; main: meter (40px bar) full width, 12-col grid form 7 / lanes 5, lineage strip last | brief: Screens and layout |
| 768×1024 | `button "Catalogue"` opens `dialog "Catalogue"`; form full width; lanes in two columns; tables keep Job, Status, Cost; other columns in the row detail dialog | brief |
| 375×812 | one column meter, form, lanes, lineage; `button "Menu"` opens Primary navigation; lineage scrolls in its own region | brief |
| all | 4px spacing unit; controls ≥ 44×44; 1px hairlines; radius 2px; focus ring 2px ink, offset 2px | brief: Density, Touch; decided values |

## Motion

| Element | Trigger | Duration | Easing | Reduced-motion substitute |
|---|---|---|---|---|
| segment and notch widths, numerals | reserve, release, settle step 1 and step 2 | 420 ms each step | cubic-bezier(0.2, 0, 0, 1) | instant; announcement still made |
| notch + tab outline | replay | 220 ms fade | same | static 3px outline for 1 s |
| soft cap marker | soft cap crossed | 220 ms opacity | same | instant |
| hard-cap hatching + message | throttled | 220 ms opacity | same | instant |
| dialogs | open/close | 220 ms opacity + 6px rise | same | instant |
| buttons, lane items | hover/press | 220 ms background/border tint | same | none |
| running lane item | each second | text step | — | same |

Sequences play one after another in ledger order, each within 1 s; nothing loops (brief: Motion and effects).

## States per async action

As the brief's Feedback states table, verbatim: pending copy in the button or Notices, success in
`status "Notices"`, errors in `alert` plus beside the field. Outage notices in `region "Service status"`
within 10 s (server checks every 5 s, the page polls every 1 s — decided).

## Breakpoints

`max-width: 1023px` (catalogue dialog, stacked form/lanes), `max-width: 767px` (Menu, single column).

## Media and licences

Fonts: Bricolage Grotesque, IBM Plex Sans, IBM Plex Mono — OFL-1.1, Fontsource woff2, listed in `app/assets.json`
and `app/THIRD_PARTY_NOTICES.md`. Icons: original inline SVG. Job outputs: rendered by the server at run time.
