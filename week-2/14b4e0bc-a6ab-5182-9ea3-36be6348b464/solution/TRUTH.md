# TRUTH — Quarrystone Strata (golden ground truth)

Every value says where it came from: `brief: <section>` (verbatim) or `decided: <why>`.

## Journeys (ideal end-to-end flow)

1. **Analyst finds a trustworthy table** (brief: Journeys 1).
   Start: Lena signed in on `/catalog` (all assets, `Matching assets: <n>`). Types `claims`, then `risk` within 300 ms → one search for `risk` (decided: 300 ms debounce, brief: Search as you type); picks `PII` → URL `?q=risk&tag=PII`, results `dash.risk_outreach`, `mart.member_risk`, `stg.member_claims`, Tag facet PII 3 / Confidential 4, `Matching assets: 3` once, focus on the PII radio (brief: Seed data worked example). Copying the URL reproduces it. Phone: Filters sheet opens on the checked Tag radio; Rui's tag on `src.eligibility_2019.member_id` raises PII to 7 in the open sheet, `Matching assets: 7` once. Opening `stg.member_claims` then `src.members` paints only `src.members` (latest request wins). Column detail lists glyphs and `PII inherited from <id>` lines; PII samples arrive as `[masked]` for Analysts. Provider: Postgres only (reads).
2. **Stewards tag, suppress, withdraw** (brief: Journeys 2). Suppress Confidential on `mart.claims_by_region.region_zip` with the Safe Harbor justification → `Confidential suppressed on <id>.`, focus on `Lift Confidential suppression`, both assets 0/0/0, Confidential facet 8 → 6. Racing Tag PII → `<id> already carries PII directly.` once, column resyncs, focus `Withdraw PII`. Bulk Confidential on 3 legacy columns → `Confidential applied to 2 of 3 columns.`, Undo → `Bulk tag undone on 2 columns.`, second Undo refused (`batch_undone`). Withdrawing PII on `src.members.ssn` → `PII tag withdrawn from src.members.ssn. Still reaches 3 columns through other paths.`; open canvases drop the glyph only from that node. Provider: `audit_log` rows `tag.suppress`, `tag.add`, `tag.bulk_add`, `tag.bulk_undo`, `tag.withdraw`; `column_tags` rewritten in the same transaction.
3. **Impact trace through a cycle** (brief: Journeys 3). Trace of `src.claims_legacy.paid_amount`: 7 columns, 4 hops, 1 cycle; step = min(140, 1580/4) = 140 ms; band k lights at k·140 ms, settles +220 ms; counter ends at 7; summary `Trace complete. Columns reached: 7. Hops: 4. Cycles: 1.` once. Refocus mid-sweep cancels it silently. A new lineage edge on a finished drawing appears dashed (`data-edge-state="new"`), its node unlit in band 2, `Lineage changed since this trace. Trace again to include it.` once.
4. **Verify with sign-off** (brief: Journeys 4). `signoff.docx` → 422 `Evidence must be a .pdf or .txt file.` tied to the field, focus on it. PDF → `Uploading evidence...` + progress line → 200 → dialog closes, focus `Deprecate`, `Verified. Evidence stored as <filename>.` once. Other open screens show verified + Download evidence within 3 s. Download: same bytes, `Content-Disposition: attachment`, ranges and multi-ranges exact. Provider: MinIO object `evidence/<asset>/<uuid>`, Postgres `evidence` row, audit `certification.verify`, one `evidence.download` row per 200/206 GET.
5. **Retire the legacy claims table** (brief: Journeys 5). Deprecating `src.claims_legacy` → 3 notices queued (u-rui, u-lena, u-omar), warning appears behind an open Verify dialog, submit refused `Verification blocked: upstream src.claims_legacy is deprecated.`; reinstate clears it; resubmit with the same key succeeds. Mailpit: one plain-text message per owner, To = exact stored name, Message-ID `<notice-<uuid>@strata.quarrystone.test>`.
6. **Admin governs** (brief: Journeys 6). Role change → `Role updated: <name> is now <role>.` for Morgan; the other screen shows `Your role changed to <role>.` once, controls re-render, traces cancel. Password reset → `Password reset: <name> was signed out of <n> sessions.`, their screens reach `/signin` with `Your session ended. Sign in again.` within 5 s. Held audit rows: `Show <n> new audit rows`, `<n> new audit rows.` once, rows in view stay put. Catalog as of `2026-09-30T23:59:59` → `as_of_time=2026-09-30T23:59:59-05:00` → `/catalog?as_of=<seq>`, read-only.
7. **A service is down** (brief: Journeys 7). Evidence down: verify 503 `Evidence storage is unreachable. The asset stays in draft; try again shortly.`, banner at once, same Idempotency-Key on resubmit. Mail down: deprecation 200, banner shows the queued count, another instance sends.
8. **Ingest and curate** (brief: Journeys 8). Simultaneous registrations: one 201, the rest 409 `asset_exists`. Rename term → `Term renamed: <old> is now <new>.` once on open glossaries; stale edit `This term changed since you opened it. Reload and try again.`

## Palette (brief: Visual design — Colour roles; hex decided for the design direction)

| Role | Hex | Source |
|---|---|---|
| paper ground | `#F5F0E6` | decided: warm off-white |
| slate ink | `#1E2830` | decided: near-black slate, 13.9:1 on paper |
| warm grey rule | `#CBBFA9` | decided: hairlines, undrawn edges |
| warm grey text | `#655D50` | decided: unlit node text, 5.6:1 on paper |
| PII burnt orange | `#B4521A` | decided: hatching only |
| Confidential deep teal | `#1C6B67` | decided: dotted outline only |
| hover tint / press | ink 7% / 12% over paper | brief: Hover and press |
| backdrop | paper 82% | brief: Density and composition |

No gradients or shadows (brief); PII hatching is a hard-stop repeating stripe frame (brief: Tag encoding).

## Type (brief: Type)

Fraunces 600 display (asset heading 35 px ≈ 2.5 × 14 px body; steps ×1.2: 16.8 / 20.2 / 24.2); IBM Plex Sans 400/500/600 body 14 px; IBM Plex Mono 400/500 with tabular numerals for counts, hops, seqs, hashes, samples, timestamps, ids.

## Space and layout (brief: Layout by width; decided widths)

| Width | Layout |
|---|---|
| ≥ 1200 (1280×800) | rail 280 · canvas 1fr (sticky, one viewport tall below the top bar) · detail 340, hairline-split (decided: bands of 116 px nodes at a 128 px pitch fit hops 0–4 at 1280) |
| 768–1199 (768×1024) | rail 270 · right pane: canvas (content 440 px tall) above detail |
| < 768 (375×812) | top bar, banners, Point in time note, Filters + search + status, results or Back + detail, Lineage button |

Rhythm 4/8/16/24 px; controls 46 px minimum (≥ 44×44, decided margin over sub-pixel layout); canvas empty strip 48 px; content area ≥ 240 px (brief). Sticky top bar with paper ground and hairline; root `scroll-padding-top` keeps focused/scrolled controls below it (decided).

## Motion (brief: Motion and effects)

| Element | Trigger | Duration | Easing | Reduced motion |
|---|---|---|---|---|
| dialog / sheet / rail in | open | 250 ms | cubic-bezier(.2,.8,.2,1) | appears at once, `open` |
| dialog / sheet / rail out | close | 200 ms | cubic-bezier(.4,0,1,1) | gone at once |
| sweep band | k·step from time zero | 220 ms fill + edge draw | ease-out | all bands at once + hop badges |
| node tint / seal / deprecation mark | live update | 180 ms | ease-out | at once |
| band nodes ease (DP-04) | open-canvas update | 250 ms (WAAPI translate) | cubic-bezier(.2,.8,.2,1) | `settled` at once |
| upload progress segment | verify pending | 1000 ms loop | linear | still line |
| hover tint | pointer | 90 ms | linear | none |

## States per async action (brief: Feedback states, copied verbatim in the app)

Search `Searching...` → `Matching assets: <n>`; Tag/Withdraw/Lift `Saving...` → published success copy; Suppress, Verify (`Uploading evidence...`), Deprecate, Reinstate, Save term, Create user, Reset password: pending in Dialog status, success in Activity; Trace `Tracing...` → summary; Open catalog as of `Resolving...`; Check audit chain `Checking...`; Load older `Loading...` → `Showing <n> of <total>.`. Errors: the API message exactly.

## Breakpoints

768 px and 1200 px (brief). The app follows media-query events and a 100 ms viewport check (decided: the page clock may be paused, so rendering-step events can be delayed).

## Media and licences

Fonts: Fraunces, IBM Plex Sans, IBM Plex Mono (Fontsource 5.3.0 woff2, OFL-1.1). Icons: Lucide 0.552.0 path data (ISC). `favicon.svg` and the empty-canvas survey mark: original. Listed in `app/assets.json` and `app/THIRD_PARTY_NOTICES.md`.
