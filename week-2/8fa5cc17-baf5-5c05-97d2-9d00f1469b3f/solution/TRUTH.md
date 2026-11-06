# TRUTH — Oakgall Press Quire

The intended behaviour of the golden app. Every value says where it came from: `brief: <section>` (verbatim)
or `decided: <why>`.

## Journeys, end to end

1. **Morning reading log** (brief: Journeys 1).
   - Start: signed out, 1280x800, bookmarked `/o/<Florilegium id>`. The server answers `302 /sign-in?return=%2Fo%2F<id>` (brief: Signing in).
   - Sign in → `window.location` = `/o/<id>` (safe return, brief: Return address). Heading `Florilegium`.
   - Ctrl+K → dialog `Command palette`, focus in `Search Quire`; typing `margni` then `margin`: commands re-ranked by the command score each keystroke; notes searched ≤150 ms after the last keystroke (decided: under the brief's fifth of a second); late answers dropped; `Palette status` = `<c> commands, <n> notes`.
   - Enter on `Go to Today` → `/today`, `main` reveals left to right over 320 ms on the Quire curve, focus on the h1; empty note shows `Nothing written today. Start with a line from what you're reading.`
   - Type a line, Enter → new block via `POST /api/daily/today/blocks` with a fresh `Idempotency-Key`; `((` opens `Quote a block`; picker results only for the text now in the box.
   - Enter on a result → morph card (280 ms) → `201` → `((` leaves the host, figure `Quote from The Gathered Margin` after the host, tether draws (180 ms) after the morph lands, numeral rolls (160 ms) from one below to the server count; `Announcements`: `Quoted from The Gathered Margin. 2 backlinks.`
   - Ctrl+Z mid-tether → `DELETE /api/blocks/<quote>`; the tether holds at the press, then pulls back from where it is over 180×(1−o) ms; figure collapses (280 ms); `Undid quote.` (brief: Undo and redo).
   - Scrolling: chips level with figures within 1 px; `data-reading-progress` scaled by p = scrollY ÷ (scrollHeight − innerHeight), updated every animation frame (brief: Scrolling at 1280).
   - Provider: `blocks` rows with positions 1..n, `link_edges` quote row removed, `revisions` for every text edit, `sync_events` numbered.
2. **Late capture on the phone** (brief: Journeys 2): capture lands on the home-clock date (`homeDate(now, zone)` on the server); the laptop applies `block.saved` in place (no reload, caret rebased); a resend with the same key after a network drop returns the first `201` body byte for byte with `Idempotent-Replay: true` and creates nothing; a dropped live channel reconnects after 2 s with `Last-Event-ID` and receives the missed events; Alt+ArrowLeft on a timeline handle moves the block to the nearest earlier day with a note, focus stays on its handle, `Moved block to <date heading>.`
3. **Filing a source** (brief: Journeys 3): `New type` → `POST /api/types`; properties save on Enter/blur or change; Author relation adds a `link_edges` relation row and `backlinks.changed`; saved query `Kind = "Book" OR @backlinks >= 1` checked live with `Unknown field <name> at column <c>.`; grouped results by label, `No value` last; reorders slide 240 ms.
4. **Sharing with an advisor** (brief: Journeys 4): link expiry entered on the home clock, stored as a UTC instant; graph scope dims out-of-scope nodes to 0.25 and labels them `, not shared`; share page polls status and content every 5 s; `never` share removes the object from scope at once and deletes its cached rendering and every rendering quoting it; concurrent regenerate/revoke: exactly one winner (`UPDATE … WHERE revoked_at IS NULL AND expires_at > now()`).
5. **Lost phone** (brief: Journeys 5): `sessions.changed` updates Settings in place; a 404 on `Sign out device` shows `That device is already signed out.`; password change rotates the current session id and cookie and ends every other session (their channels get `session.ended` and close); lockout is decided by the server only.
6. **Storage outage** (brief: Journeys 6): upload type from leading bytes; the block exists only after a HEAD reports the uploaded size; outage → banner `Attachments are unavailable right now. Your writing is still saved.`, placeholders, `GET /api/storage` every 10 s, images reload when it answers `available`.
7. **Two devices, one block** (brief: Journeys 7): ops transformed in commit order; overlap cases answer 409 with the current block; the losing device shows `Edit conflict` with both texts; `Keep mine` = full replacement on the current version.
8. **Arranging by lamplight** (brief: Journeys 8): theme saved in PostgreSQL, `settings.saved` reaches other tabs; board zoom about the pointer, 8-unit snap, arrows recomputed every frame; graph filters in the address (full navigation); fly-to 600 ms; drag pins; idle turn 6°/s resuming 5 s after input.

## Palette (brief: Theme tokens; hex derived from the printed channels)

| Role | Token | Paper | Lamplight |
|---|---|---|---|
| page | `--quire-paper` | #F4F0E6 | #1E1A15 |
| text and nodes | `--quire-ink` | #1F1C18 | #EDE4D3 |
| hairlines and edges | `--quire-rule` | #CFC6B4 | #4A4136 |
| live changes | `--quire-accent` | #B23A24 | #E0674C |
| links, tethers, selection, focus | `--quire-link` | #2F6B6A | #7FB8B5 |

Muted text, washes and shadows are `color-mix()` of two tokens (decided: no other colour value may appear). Share pages are always Paper (brief: Share pages).

## Type, space and layout

- Fonts (brief: Type): Fraunces (headings), Source Serif 4 (reading), IBM Plex Mono (ids, dates, coordinates, numerals); self-hosted woff2, all preloaded (decided: no swap shift).
- Sizes (decided, recorded in DESIGN.md): body 17 px / 1.65; h1 42.5 px (2.5× body, brief) on a 48 px line; h2 29.4 px; h3 24.5 px; h4 20.4 px.
- Measure 36rem (576 px), at most 68 characters of body text (brief: at most 68 characters; decided: one fixed length so headings and text share the column). Block gap one line (brief: Density). Quoted block indented 1.25 em with a 1 px link-colour rule (brief: Composition).
- Layouts (brief: Screens and layout): ≥1200 three panes (rail 248 px sticky, viewport tall; margin 280 px); 768–1199 drawer + column + margin (232 px); <768 one column, 56 px pinned top bar, drawer, bottom sheet at about two thirds of the screen, chips inside quoted blocks, no tethers.
- Board group 600 px (1280/768) / 480 px (375); graph canvas 560 / 480 px, full width of `main` (brief).
- Timeline columns 280 px, 16 px gaps; heat band 12 px (brief).
- Every tappable control ≥ 44×44 px; focus ring 2 px link colour, 2 px offset (brief: Accessibility).

## Motion (brief: Motion and effects; Quire curve = cubic-bezier(0.2, 0, 0, 1))

| Element | Trigger | Duration | Easing | Reduced motion |
|---|---|---|---|---|
| morph card | Enter in picker | 280 ms | Quire | none (figure appears on 201) |
| tether dash offset 1→0 | after 201 and morph | 180 ms | Quire | drawn in one frame |
| numeral roll + flash | after tether | 160 ms (+ flash ≤ 1 s) | Quire / linear | value set at once |
| unquote | after server 200 | numeral 160 → tether 180×(1−o) → collapse 280 ms | Quire | all at once |
| refusal shrink | 409/422/2nd network failure | 167 ms | Quire | — |
| daily reveal (`main` clip-path) | Today button, rail daily note, palette, new-day capture | 320 ms | Quire | 120 ms linear fade, nothing clipped |
| card turn | Show properties / front | 420 ms; rows 160 ms at 210 + 60k ms | Quire | end angle at once, face fades 120 ms |
| title transition (h1) | card/board → object | 280 ms | Quire | 120 ms fade |
| results reorder | refetch | slide 240, fade 160 ms | Quire | instant |
| block gap | block removed | 180 ms | Quire | instant |
| board live / refusal slide | `board.saved` / refused save | 240 / 160 ms | Quire | instant |
| drawer / sheet | open, Escape, backdrop, release | critically damped spring k=400, c=40, m=1 | computed per frame | instant |
| timeline | release | coast τ=325 ms then snap 200 ms | exponential / Quire | snap at once |
| graph fly-to / grow / edge in / dim | select / count change / new edge / scope | 600 / 280 / 400 / 180 ms | Quire (dim linear) | one frame |
| graph orbit/zoom keys and wheel during a fly-to | key / wheel | at once; the fly-to keeps flying to its node with the change applied to its start and end poses (decided: brief stops a fly-to only for a drag, and orbit/zoom pivot on `c` as set by the fly-to) | — | same |
| graph orbit/zoom limits | key / wheel / drag | `φ` clamped to −80..80°, `d` to 12..90 exactly in 64-bit floats before `u_view` is built (brief: Orbit and zoom); `u_view` is uploaded as float32, so an eye reconstructed from it at `d` = 90 far from the origin differs from 90 only by upload precision | — | same |
| graph idle turn | nothing selected | 6°/s, resumes 5000 ms after input | linear | off |
| arrival mark | remote block | 2000 ms fade | linear | shown 2 s, no fade |

## States per async action (brief: Feedback states)

| Action | Pending | Success | Error / outage |
|---|---|---|---|
| block save | `Saving` | `Saved` | `Not saved. Check your connection and try again.`; 409 → `Edit conflict` with `This block changed on another device.` |
| quote | morph card only | figure, tether, numeral; `Quoted from <title>. <n> backlinks.` | `That block couldn't be quoted.` |
| upload | `Uploading <filename>` | `<filename> saved.` + `<filename> attached to <title>.` | 413 `That file is too large to attach.`; 415 `Attach an image (PNG, JPEG, GIF, WebP) or a PDF.`; 503 `Storage is unavailable, so this file was not attached.` + not-saved |
| board move | — | `Moved <title> to x <x>, y <y>.` / `Moved <n> cards.` | `Those cards couldn't be moved.` + slide back |
| restore | — | `Restored version <v>. Saved as version <n>.` | `This block changed since you opened its history.` |
| sign-in | — | navigate | `That email and password don't match.` / `Too many sign-in attempts. Wait a while, then try again.` |
| live sync | `Live updates paused. Reconnecting.` | `Live` | — |

## Breakpoints

768 and 1200 px (brief: Screens and layout); no other breakpoint changes the layout of a published viewport.

## Media and licences

- Fonts: Fraunces 5.3.0, Source Serif 4 5.3.1, IBM Plex Mono 5.3.0 from Fontsource, OFL-1.1 (`app/assets.json`, full OFL texts in `THIRD_PARTY_NOTICES.md`).
- Icons: inline SVG paths (menu, panel) in the Lucide style; empty-day ornament original (decided: DESIGN.md Media).
- No pictures, audio, video or models ship.
