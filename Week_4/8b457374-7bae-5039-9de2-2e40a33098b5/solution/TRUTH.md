# TRUTH — Coldset Works Dotgain (golden)

The brief made concrete. `brief: <section>` values are copied verbatim; `decided: <why>` fills silence in the
brief's intent.

## Journeys (ideal end-to-end flow)

1. **Draft and launch** (brief: Journeys 1; DP-06, DP-10). Start: `/`, no key in the browser. "Start a campaign" →
   `dialog "Your details"` → Name, Email, Continue → `POST /api/people` 201 → dialog shows `Your Dotgain key: <key>`
   (key held in `localStorage`, decided: the browser's only identity store) → Done → `/studio/campaigns/new`.
   Fill Title, Story, Goal (£), Minimum run (copies), break points, Ships from, Time zone, Deadline (`YYYY-MM-DD HH:MM`)
   → Save draft → `Saving draft.` then `Draft saved.`; URL becomes `/studio/campaigns/<id>` (decided: no reload, so
   the announcement stays). Add tiers (Save tier → `Tier saved.`), choose Cover art / Spread previews → each row
   `Uploading` → `Stored` with `Cover stored.` / `Image stored.`; the bucket holds
   `campaigns/<campaign id>/media/<media id>.png`. Launch campaign → `Campaign launched.`; status `live`.
   End: `/campaigns/<id>` shows the cover in its circle (served by `/api/media/<id>`) and an empty Plate Fill.
2. **Keyboard pledge** (DP-11). Tab enters `radiogroup "Reward tier"`, arrows select, Tab → `Shipping country` →
   `Add-on (£)` → `Review pledge`; each change re-quotes within 150 ms debounce (decided, under the brief's 500 ms)
   and updates `status "Pledge preview"` and proof rings. Review → `dialog "Confirm pledge"` (focus Name or Card
   number) → Enter in card → `Asking the payment service to hold £X.` → 201 → dialog closes, focus `Change pledge`,
   rings ink, total counts, then `Pledge authorised: £X held on your card. You are charged only if the run is funded.`
   Provider: one Kill Bill account (externalKey = person id, GBP), payment `<pledge id>` with SUCCESS AUTHORIZE
   `<pledge id>-auth`; Mailpit receives `Pledge held: <title>` with `Your card is held, not charged.`
3. **Phone, reduced motion** (DP-28, DP-29): same, by tap; gauge, total and announcement update at once.
4. **Last signed cover** (DP-21, DP-22): claims run under the campaign row lock; the loser gets 409 `tier_sold_out`
   before any Kill Bill call, the dialog closes, focus returns to Review pledge, the radio becomes disabled and the
   tier row shows `Gone`; Kill Bill has no account/payment for the loser.
5. **Change, cancel, final day** (DP-23–DP-25, DP-30): My pledges → `Manage pledge` (`/campaigns/<id>#manage`, focus
   Change pledge) → change tier → `Confirm change` → new AUTHORIZE, then VOID `<old id>-void`; announcement
   `Pledge changed: …`. In the final window a cancellation that would unfund → 409 `would_unfund`, copy
   `This change would take a funded run below its minimum in the final 24 hours, so it cannot be made.`, pledge held.
6. **Funded deadline** (DP-36–DP-38, DP-44, DP-45): close-out within ~1 s of the deadline (1 s tick); each held pledge
   is CAPTURED (`<id>-capture`) with notice `Funded and charged: <title>` and a pending statement in one transaction;
   statements render via Gotenberg into `statements/<pledge id>.pdf`; campaign `funded → collecting → settled`;
   settlement sheet `settlements/<campaign id>.pdf`, email `Settlement ready: <title>`.
7. **Unfunded deadline** (DP-33): every hold VOIDed, `Not funded, card released: <title>`, campaign page shows
   `Not funded. No card was charged.` in place of the stage.
8. **Fix a failed card** (DP-39–DP-42): capture-fail card → `errored`, fix code (43 URL-safe chars), fix window =
   deadline + `FIX_WINDOW_SECONDS`, notices at error time and every `FIX_NOTICE_SECONDS` strictly before the window
   end, each with `<APP_PUBLIC_URL>/fix/<code>`. A fix AUTHORIZEs payment `<id>-fix-<n>` and voids the earlier fix
   hold; at the window end the latest fix hold is captured (original hold voided) → `captured`, or everything is
   voided → `dropped` with `Pledge dropped: <title>`.

## Decided where the brief is silent

- Pledge 201 body: the pledge fields flat plus `campaign_total`, `campaign_percent` (and `key` once). decided: the
  brief writes `{pledge, "campaign_total","campaign_percent"}`.
- The backer's own pledge reads add `fix_code` so My pledges can link `Fix payment` to `/fix/<code>`; the creator's
  backer list never carries it. decided: the brief requires the link but the pledge object has no other route to it.
- Test cards are the "card network": the decline card is refused before Kill Bill (402, no AUTHORIZE); the
  capture-fail card's CAPTURE is refused by that simulation, so Kill Bill records none. Behaviour is read from the
  stored last four digits. decided: the external payment plugin accepts everything.
- Card entries (pledge, change, fix) place their hold through a payment method on the backer's account using the
  `__EXTERNAL_PAYMENT__` plugin. brief: Services › Kill Bill "Each card entry adds a payment method on that account
  using the `__EXTERNAL_PAYMENT__` plugin."
- `seconds_left` rounds up (never 0 while open); the final window is `deadline − now ≤ FINAL_WINDOW_SECONDS`.
- Error code for every 422 is `invalid`, with `fields`.
- Media upload rows are inserted `uploading`, then `stored` after PUT + HEAD byte check, else `failed` (503).
- Launch gate 422s are combined into one answer with every failing field.
- Creator cancellation probes Kill Bill first (503 leaves it live), then voids every hold (retried every 10 s).
- Seed person ids: `mara-quillfeather`, `ines-calloway`, `tobias-ferrante`, `wren-adeyemi`; seeded covers
  `<campaign>-cover` are drawn halftone PNGs (600×800, teal on paper).

## Palette (brief: Visual design › Colour; hex decided)

| Role | Hex |
|---|---|
| paper ground | `#EEF4F1` |
| raised surface | `#DCE7E2` |
| ink / accent / focus | `#0C4E4F` (8.5:1 on paper) |
| secondary text | `#2E6A68` (5.6:1 on paper, 4.9:1 on surface) |

## Type, space, layout

- Jost variable, self-hosted (brief: Type); headings bold uppercase, steps 24/32/42/56 px (×1.333); figures
  `tabular-nums`. Body 18 px. Labels sentence case (decided: CSS uppercase would change the text readers see).
- Spacing unit 8 px; page padding 20 / 32 / 48 px; radius 0 everywhere, 999 px on buttons and chips only.
- Breakpoints (brief: Campaign page): <768 one column in the order cover, title, Plate Fill, totals and countdown,
  stage, story, band, tiers; 768–1199 two columns (`1fr 300px`, Plate Fill 280 px, right column scrolls);
  ≥1200 right column 440 px, Plate Fill 420 px, sticky with a measured top so the stage stays in view.
- Hero (brief: Hero): disc diameter 1.2×vh at (0.75 vw, 0.55 vh) with a hex ramp on its left edge; phones/portrait:
  diameter 1.3×vw, top at 0.6 vh, ramp on its top edge. decided: the hero starts at the window top under a
  transparent header, so the window crops the disc (landscape: the header links sit on a square paper plate);
  the headline stays at least 48 px clear of the ramp.

## Motion

| Element | Trigger | Duration | Easing | Reduced motion |
|---|---|---|---|---|
| proof outlines | quote | 150 ms (`r`, opacity) | ease-out | appear at once |
| Plate Fill ink | confirmed hold / refresh | 500 ms per ring, 40 ms stagger (WAAPI `r`) | cubic-bezier(0.16,1,0.3,1) | instant |
| Pledged so far count | confirmed hold | 500 ms (rAF) | ease-out quart | final figure |
| image iris | image load | 320 ms clip-path | cubic-bezier(0.2,0.7,0.2,1) | none |
| banner | service down | 200 ms translate | ease-out | in place |
| button hover / press | pointer | 150 ms colours / 90 ms scale 0.97 | ease | none |
| loading dots | fetch | 1200 ms loop, 150 ms per ring | linear | one still ring + `Loading` |

## States per async action

All copy verbatim from brief: Feedback states (pledge result, fix result, Studio result, closed headings, banners,
empty states, not found). Decided extras: `You already have a pledge on this campaign.`, `This is your own campaign,
so you cannot back it.`, `Your pledge already has that tier, country and add-on.`, `Use a PNG, JPEG or WebP image.`,
`That image is larger than 5 MB.`, `Payment service unavailable. The campaign is still live.`, `That key was not
recognised.`

## Media and licences

- Jost font: OFL-1.1, `@fontsource-variable/jost@5.3.0` (assets.json).
- Hero disc, Plate Fill, marks, empty dot, loading dots: drawn in code (original).
- Seeded covers: drawn by `src/server/png.ts` at first start (original).

## Disputes (verifier, iteration 1; resolved)

- `test_wf_statements_settlement_backer_statement`, `test_wf_statements_settlement_creator`: the refreshed tests
  read the PDFs from `${S3_BUCKET}-short`, the short-timer copy's own bucket (brief: Services › MinIO "All objects
  live in the bucket named by `S3_BUCKET`"). The app was not changed; both pass.
- `test_storage_document_outages[storage]`: the refreshed test no longer lists the unreachable bucket, in line
  with brief: Services › MinIO "a storage outage is observed through refused uploads and `failed` media rows
  only". The app was not changed; it passes.
