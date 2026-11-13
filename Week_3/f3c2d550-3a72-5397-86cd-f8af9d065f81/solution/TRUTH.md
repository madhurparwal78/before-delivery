# TRUTH — what the golden Stowdeck does

Every value says where it came from: `brief: <section>` (verbatim from instruction.md) or `decided: <why>`.

## Journeys (start state → actions → visible end state → provider-recorded end state)

1. **Capture at a flea market** (brief: Journeys 1). Start: phone 375×812, seed library. Tap Capture → choose a sideways JPEG (orientation tag 6, Display P3 profile, GPS). The photo shows upright in the tile's whole-photo view. Fill Name, Maker, Year, Size unit `in`, Width/Height/Depth, Materials, Finish, Colour family, Where you found it; Pick swatch → crosshair → Use this colour. Save with a bad year: Deck status `Saving the original to storage.` then `Check the highlighted fields.`, Year `aria-invalid`, focused. Fix and save: pending copy at the tap, a dropped connection resends with the same `Idempotency-Key` and gets 409 `idempotency_in_flight` (`This save is still in progress. Wait for it to finish.`, focus on Save to deck), then `Saved to your deck.` once. End: top of Saved today, once; upright in its tile on its swatch. Provider: MinIO has `references/<id>/original.jpg` byte-identical and `display.jpg` (no EXIF/ICC); Postgres row `stored` v1; Meilisearch document present when the 201 arrives.
2. **Answer a client's question** (brief: Journeys 2). Library at 1280×800: type `kettle` then `radio` (250 ms pause), filter colour family; only latest results show; Deck status `<n> references match.`. A reference captured elsewhere appears on the next refetch without disturbing the focused row. Arrow through rows: each focused row loads into the tile. Open one, switch size to inches, press `O`: original shown upright, `Escape` closes, focus returns.
3. **Edit on two devices** (brief: Journeys 3). Both windows hold version v. Phone saves finish (v+1). Laptop saves title with v → 409 `reference_version_conflict`; laptop shows `This reference changed in another window. Reloaded the latest facts.`, reloads, focus on Edit facts; nothing overwritten.
4. **Play a reel** (brief: Journeys 4). Fader focus; Arrow/Home/End/`[`/`]` change stops; each runs the Fader Pull, scrolls the row to the viewport middle, rewrites `?stop=k` (replaceState), announces `Reference k of N: …`. Two quick `]` settle on the newer stop. Reload reopens the same stop with no swap or announcement. A stop trashed elsewhere: next refetch moves to a neighbouring stop with one announced swap.
5. **Reorder and print** (brief: Journeys 5). Move up ×3 quickly: queued PUTs with versions v, v+1, v+2; success copy per accepted move. Print contact sheet → US Letter + inches → `Contact sheet queued.`; list shows Queued → Rendering → Ready; `Contact sheet ready.`; Download PDF. PDF: stops in new order, maker, inch size line, swatch, footer; no notes, source link or where-found note; display crops only.
6. **Trash and change your mind** (brief: Journeys 6). Eyedropper swatch set (v+1). Move to trash → dialog (`<title> will be purged 30 days after it is trashed unless you restore it.`), Keep it focused. Trash shows `Restorable for <d>d <h>h` from the server's `seconds_left`. Restore: same id, `captured_at`, swatch + source, reel positions, search document. Past `purge_at`: purged within 5 s (objects, search document, stops, +1 reel version); late restore → 410 `The restore window for this reference has closed. It has been purged from your library.`
7. **Daily Pull on an early train** (brief: Journeys 7). Browser in Los Angeles, clock hours off: card shows the server's pick, `Pulled for 2 November 2026`, `Next pull at 06:00, Europe/London` before 06:00 London; also on the night the clocks go back.
8. **Move home, outage** (brief: Journeys 8). Settings: Asia/Tokyo → notice `Your home zone changes to Asia/Tokyo at midnight on <date> in Europe/London.`; the change applies at that true local midnight. Storage down at boot: every screen opens with `Storage is offline. New captures can't be saved until it returns.`; capture → 503, form keeps every value, same key succeeds once storage returns. Search index lost: fallback under its banner, index rebuilt from Postgres within 30 s; banners clear on their own.

## Palette (decided hex, roles from brief: Visual design)
ground `#160A12` · surface `#26121F` · ink `#FFFFFF` · muted `#BCA7B6` · accent `#FF2E93` (primary action + fader knob only; text on it `#160A12`) · accent-pressed `#E0187C` · field `#5E1440` · facts paper `#FFFFFF` / ink `#0B1020` · focus `#FF2E93` (white on pink controls, `#B0006A` on the facts paper) · danger `#FF9AAE` / `#B3123C` on paper. Contrast pairs are in DESIGN.md.

## Type, space, layout
Host Grotesk (OFL-1.1, variable, self-hosted) for display and body (brief: Visual design); body 18px; steps ×1.25; rows and capture facts 1.5× body; hero 1.75–2.5× body scaling with viewport; tabular figures on size lines, countdowns, detent numbers (brief). Margins 24/40/64px (decided: airy). Phone <700: field 52% of visible height, pinned, tile centred, fader at its bottom edge, then heading, primary action, list/form. Tablet 700–1099: field band 40% pinned, lists in two equal columns, forms one column. Desktop ≥1100: left half scrolls, right half field with ≈450px tile, caption under it, fader at the bottom (all brief: Screens and layout). Tile radius 24px, controls/inputs/dialogs 0, knob pill; every control ≥44×44px (brief).

## Motion (brief: Motion and effects; easing decided: cubic-bezier(0.16, 1, 0.3, 1))
| Element | Trigger | Duration | Easing | Reduced motion |
|---|---|---|---|---|
| shutter + fill crossfade | stop change | 0–180 ms close, 180–360 ms open | decelerate | instant swap |
| incoming tile photo | stop change | translateX ±32px → 0 over 180–360 ms | decelerate | none |
| knob glide | drag release | 180 ms | decelerate | jumps |
| row scroll to middle | stop change | < 300 ms | smooth | instant |
| `main` slide | Deck-nav link | 240 ms, ±48px + fade | decelerate | none |
| dialog | open / close | 200 ms in, 120 ms out, 40px + fade | decelerate | none |
| reel rows | move / remove | 200 ms; leave 200 ms then close gap 200 ms | decelerate | none |
| button press | pointerdown | instant darken | — | same |

## States per async action
Copy per action is the brief's Deck status table, verbatim: Capture (pending / `Saved to your deck.` / 422 / 409 in-flight / 503), Search settles, Save facts, Eyedropper, Reset swatch, Add to reel, Move or drag, Remove, Create reel, Request sheet, Sheet ready/failed, Try again, Move to trash, Restore (410), Save home zone, Size unit, any other failure `Something went wrong. Try again.` Refetches, status polls and the countdown never write Deck status. Outage banners (Service notices): search, storage, printing — from `GET /api/status` polled every 5 s.

## Breakpoints
375 phone (<700), 768 tablet (700–1099), 1280 desktop (≥1100) (brief: Screens and layout).

## Media and licences
12 seed object photographs and the 3 Landing copies: drawn for this product (procedural studio illustrations), licence `original`, listed in `app/assets.json`. Host Grotesk woff2: OFL-1.1 (Fontsource). Icons: Lucide (ISC) via `lucide-react`. The kettle outline in empty states: drawn inline SVG (`original`).
