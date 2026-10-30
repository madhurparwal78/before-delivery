# TRUTH — Loomwise Evidence Desk (golden)

The brief made concrete. `brief:` values are copied from `instruction.md`; `decided:` values fill a silence
in the brief's direction and say why. Seed values are the brief's Seed data.

## Journeys (ideal end-to-end flow)

### 1. Triage and highlight (DP-01, 04, 05, 06, 45, 52)
- Start: `pm@tallyrun.example` signs in at `/signin` → `/inbox`; tab "Unprocessed 7" selected (brief: Seed example). N6 and N7 share `2026-10-25T09:00:00Z`; the order is `createdAt` desc then `id` desc in byte order (brief: Inbox pages); ids come from one PG sequence so they are monotonic across instances (decided: a note created later always sorts before every note already listed).
- "Load more notes" appends the next page (default limit 50, brief) until the oldest note shows; no note twice; focus stays on the button.
- Search "KPI" in "Search workspace" (≥2 chars, ~250 ms pause, brief) → option "Weekly KPI pack" → `/inbox/<id>`.
- Selecting "If reports could email themselves to the ops team" paints a pending `mark` (`data-pending="true"`, empty `data-insights`) over exactly those characters; the quote is exactly the `strong` element's text, so it crosses no element boundary and renders as one mark inside `strong` (brief: Interactions, Highlight segments); toolbar "Link to feature · L" appears above it.
- L → dialog "Link quote to feature", focus in combobox "Feature"; pick "Scheduled report emails", importance default "Important" → "Link quote" ("Linking…").
- Provider end state: `insights` row (note id, feature id, start, end, `important`, quote = exact text slice); response `before.impact 3` → `feature.impact 6`, 2 insights, 2 companies, priority 67.20, rank 1 of 5 (brief: Seed example).
- Visible end state: thread draws mark → row (420 ms), row counts 3→6 and rank 2→1 (280 ms), thread fades (167 ms) into the tick img "Linked to Scheduled report emails"; "Evidence announcements": "Linked to Scheduled report emails; impact 3 → 6; now rank 1 of 5" (brief). The row slides from rank 2 to rank 1 (brief: Journeys 1): the rail orders features by rank inside their component and components (and products) by their best-ranked feature, so the Reporting group with the row moves above Access while the thread end stays on the row (decided: makes the rank change a visible slide inside the tree).
- "Mark processed" → "Marked processed."; note leaves Unprocessed. Reload: marks on the same characters.

### 2. Keep the evidence honest (DP-08, 09, 10, 46)
- Merge "Northwind Freight Ltd" into "Northwind Freight" (page button "Merge into…", dialog "Merge company") → "Merged Northwind Freight Ltd into Northwind Freight."; contacts and `nwfreight.example` move; Scheduled report emails' company count drops by one; the old company URL answers 404.
- Edit note contact, unlink ("Unlink <feature>"), delete ("Delete note?" → "This also removes its <n> linked insights.") → rail rows show recomputed numbers without reload. Delete records `object_deletions` prefix `notes/<id>/`; a worker on any instance empties it within `ATTACHMENT_RETRY_SECONDS` + 5 s.
- Snooze "next Monday 09:00" in America/New_York (dialog "Snooze note", zone name under the field) → "Snoozed until <local time>."; read-time view `notes_live` returns it to Unprocessed at the instant (decided: no sweeper race between instances).

### 3. Call note with transcript (DP-12, 13, 14, 47)
- "Log note": Title, Note body (rich text, pasted formatting kept, reduced by the server allowlist), Contact, Source "Sales call", "Attach transcript or file" `.vtt` → "Note saved."; object `notes/<noteId>/<attachmentId>-R-nder-call.vtt`.
- HTML named `.vtt` → 422 → "<filename> is not a valid .vtt file." under the file field; nothing stored.
- Storage down (instance with `S3_ENDPOINT=http://127.0.0.1:9`): note saves, attachment `pending` with bytes in PG → "Note saved. <filename> will upload when storage is back."; list shows "<filename> — Pending upload"; any instance uploads it on its next pass; the open note re-checks every 5 s and shows a link. Download keeps `Ränder call.vtt` via `filename*=UTF-8''R%C3%A4nder%20call.vtt`.

### 4. Legacy import (DP-15, 16, 48)
- Paste CSV with BOM/CRLF/multi-line cell → "Preview import" → "Preview ready: … Nothing has been imported yet."; table "Import preview" (Line, Outcome, Reason); nothing written.
- "Import rows" → "Imported <notes> notes: …". Real imports run under `pg_advisory_xact_lock(hashtext('import:'||workspace))`; a simultaneous second import creates nothing and reports every row the first kept as `duplicate`, while rows skipped for an earlier reason (e.g. `missing_email`) keep that reason; the two reports' `notes` add up to the notes created (brief: Legacy import, Real imports).

### 5. Weigh and rank (DP-17, 18, 19, 20)
- Settings › Objectives: weights 50/30/20 (seed). Feature detail › Scores: effort 2 on Scheduled report emails at v1 → v2, priority 84.00, rank 1 of 5; SAML single sign-on rank 2 (brief: Seed example). History item "v2 · effort 2 · confidence 80% · priority 84.00".
- Simultaneous saves on one version: feature row lock; one 200, every other 409 `version_conflict` with identical `current`; UI alert "Someone else saved these scores first. Current values: effort <e>, confidence <c>%. The form now shows them; review and save again."

### 6. Roadmap board (DP-21, 22, 23)
- Lane "Unscheduled", then month groups ("March 2027") oldest first; releases by target date; cards are buttons named by the feature.
- Keyboard: Space/Enter pick up, arrows step, Left/Right change list (shipped skipped), Space/Enter drop, Escape cancel; every step in "Board announcements" with 1-based positions. Pointer drag shows a dashed cobalt drop slot. Move carries `expectedOrderVersions` of every touched release; stale → 409 `order_conflict` → "The board changed while you were moving <feature>. It now shows the latest order."

### 7. Freeze, ship, close the loop (DP-24–29)
- "Freeze scope" writes `releases/<id>/scope-v1.json` before the release reports frozen; storage down → "Storage is unavailable, so <release> was not frozen. Try again in a minute." and the release stays open.
- Head of product moves Bulk user import out of frozen March Drop → snapshot v2. "Ship release" → dialog "Ship March Drop" ("Each customer who asked for these features gets one email.") → "Ship and notify customers" with one `Idempotency-Key` per dialog → "March Drop shipped. 2 customer emails queued for delivery." Outbox: Priya Nair (SAML single sign-on), Lee Chen (Scheduled report emails) (brief: Seed example); subject "You asked, we shipped: March Drop"; From `MAIL_FROM`.
- Orchard Lane Bank page › "Requests": "SAML single sign-on … Shipped in March Drop · March 2027".

### 8. Share and export (DP-30–33, 49, 50)
- Settings › Share links: "Create share link" (lifetime empty = no expiry) → listitem "Active" with URL `<APP_BASE_URL>/r/<token>` (256-bit base64url token, decided). `/r/<token>`: h1 "Product roadmap", one region per month, public releases only; headers `Cache-Control: no-store`, `Referrer-Policy: no-referrer`, `X-Robots-Tag: noindex` on every status.
- Rename shows everywhere live; scope snapshots and queued outbox rows keep the old name. "Export CSV" (head of product) downloads `evidence-desk-features.csv`, CRLF, formula cells prefixed with `'`.
- Expired → 404 `link_inactive` and "This roadmap link is no longer active"; "Regenerate" gives a new token and window; "Revoke" is final.

## Palette (brief: Visual design; values decided in DESIGN.md)

| Role | Hex | Use |
|---|---|---|
| paper ground | #F7F3EA | html, body, note list, rail, board |
| sheet | #FCFAF5 | reading column, dialogs, tables, cards |
| ink | #16213E | text (14.35:1 on paper) |
| muted ink | #4A5370 | secondary text (6.86:1 on paper) |
| stone hairline | #D8D1C3 | 1 px rules; #B9B09F for input borders |
| tint | #EFE9DC | hover tint, selected tab track |
| cobalt | #2346C8 | actions, links, focus ring, thread (paper on cobalt 6.82:1) |
| cobalt pressed | #1A37A3 | pressed buttons |
| marker | #FFE779 | highlight |
| marker deep | #F6C935 | overlapping highlights (`data-depth` ≥ 2) |
| danger | #A12A1F | alert and field errors, with an icon |

No gradients, no shadows (brief).

## Type, space, layout

- Fraunces 600 for headings, workspace name, release names; Inter 400/500/600 for everything else; self-hosted latin woff2 (brief: Type; decided: weights in use only).
- Scale ×1.2 from body: 16 → 19.2 → 23 → 27.6 → 33.2 px (brief: one fifth larger per level).
- Every count, score, rank and table number uses `font-variant-numeric: tabular-nums` (brief).
- 8 px rhythm; controls ≥ 44 × 44 px; reading column 68ch (brief).
- ≥ 900 px: inbox 280 px | reading | 320 px rail (64 px collapsed); full ranking table; board columns side by side in a sideways-scrolling region (brief).
- < 900 px (768, 375): "Panes" tablist (Inbox, Note, Hierarchy); ranking shows Rank, Feature, Priority + "Details"; board columns stacked; top bar wraps to brand + Sign out / search / nav (brief; decided wrapping).

## Motion

| Element | Trigger | Duration | Easing | Reduced motion |
|---|---|---|---|---|
| pending mark | selection | 167 ms clip sweep L→R | cubic-bezier(0.2,0,0,1) | appears at once |
| evidence thread | link confirmed, rail visible | 420 ms stroke-dashoffset (WAAPI) | same | never drawn |
| rail numerals | new values | 280 ms count with WAAPI opacity pulse | same | new value at once |
| rail row | rank change | 280 ms FLIP translateY | same | jumps |
| thread → tick | after count | 167 ms opacity | same | tick at once, "Linked" badge on row |
| board card | keyboard step, drop, cancel (never a reload or freeze: decided, so a re-render can't slide a card over a release's buttons) | 280 ms FLIP | same | jumps |
| dialogs, popovers, toolbar | open / close | 167 ms fade + 4 px rise | same | none |
| hover | rows, cards, buttons | 167 ms background/underline | same | none |
| progress bar | request > 300 ms | 1200 ms loop | linear | not shown |

Whole link sequence ≤ 420 + 280 + 167 = 867 ms after the server confirms (brief: within 1.2 s).

## States per async action (brief: Feedback states)

Pending copy on the button or in "Save status"; success in "Save status" (or the named announcement region); errors in the single alert, field errors under the field with `aria-describedby`. A 401 sends to `/signin` with "Your session ended. Sign in again."; any other 5xx shows "Something went wrong on our side. Nothing was saved." The message slot is a fixed 40 px strip under the top bar (decided: no layout shift).

## Breakpoints

900 px is the only layout breakpoint (brief); 1240 px hides the "Evidence Desk" product label in the top bar (decided: keeps the navigation on one row at 1280).

## Media and licences

- Icons: Lucide via `lucide-react` 1.62.0 (ISC).
- Fonts: Fraunces (latin 600) and Inter (latin 400/500/600) woff2 copied from @fontsource 5.2.x, SIL OFL 1.1, listed in `app/assets.json` with sha256 and the full OFL text in `app/THIRD_PARTY_NOTICES.md`.
- Illustrations: three inline SVG drawings made for this app (empty inbox, empty release, public roadmap ornament) — licence original. No raster images.
