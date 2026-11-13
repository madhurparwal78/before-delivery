# TRUTH — Skinout golden

Every value says where it came from: `brief: <section>` (verbatim) or `decided: <why>`.

## Journeys (ideal end to end)

1. **Keep the closet** (brief: Journeys 1). Signed in on `/closet` with the seed gear. *Add gear* opens `dialog "Add gear"`; a 3.75 oz weight is stored as 106 g (exact decimal, half-up, once; brief: Business rules, Weights); the row shows `106 g`, category, `Packed in 0 / owned 2`; status `Saved <name>.`. *Add photo*: status `Uploading photo...`, thumbnail appears only after the server answers 201 with the object confirmed in MinIO under `photos/<itemId>/<photoId>.<ext>`; type read from the leading bytes. Two devices: the Edit dialog sends `If-Match: "<version>"`; a stale save answers 412, the dialog stays open, shows `<name> changed on another device. Close this form and open it again to see the latest.`, announces it, focuses Cancel; the closet is refreshed so reopening loads the latest values. A whole-item PATCH is refused 422 with one `This field can't be set.` entry per unpublished field. End state: new item with photo, laptop's weight (Postgres items row, MinIO object).
2. **Build a trip list** (brief: Journeys 2). `/trips` → *New trip list* → dialog → `/lists/<id>` with focus on the heading; Back returns to `/trips` with the new list first. Pack by keyboard: `P` on an available row packs and moves focus to `Quantity of <name>`; `W/C/B/U/+/=/-` act on the row of the focused control (not in the quantity field, dialogs, or packed/walked lists); focus stays on the control after quantity/mode changes. Every change shows at once (provisional line), announces `Base weight <base>. <delta>.`, and is sent in order per list; late answers never move the screen back; inputs on a provisional line are held and sent as PATCHes against the issued line id; a refused pack drops them, announces `<name> is no longer in your closet.` once and focuses `region "Closet"`. Session ended: the 401 is held, `dialog "Sign in again"` opens (`Your session ended. Sign in to finish this change.`), the screen shows the last confirmed values, sign-in resends each held change once and focus returns to the control; Cancel drops it with `Change not saved. Sign in to keep packing.`.
3. **Retire** (brief: Journeys 3). `dialog "Retire <name>"` creates one Idempotency-Key per opening; a lost answer keeps the dialog open (`Couldn't reach Skinout. Your retirement was not confirmed; confirm again.`), the retry replays the stored answer. Lines whose quantity exceeds stock become Not in closet and leave every total; Delete frees the name and removes the photo object before 204.
4. **Offline** (brief: Journeys 4; Server boundary: Offline). A service worker (registered through the container prototype) keeps the app shell; the last closet, lists and profile are kept in localStorage; offline inputs become one op each (`fromQuantity` chained) in a persisted queue and are shown with totals computed by the shared rules; `status "Connection"` shows `You're offline. Changes stay on this device and sync when you reconnect.`; on reconnect `POST /api/sync` replays them and `status "Sync results"` reads `Back online. Synced <n> of <m> changes.` plus one sentence per refusal, until the next sync.
5. **Pack, print, walk** (brief: Journeys 5). Mark packed sends one request while pending (a double tap sends one), shows the packed banner only after 200; the loser of a race shows the server's refusal message and the packed view, and `List state` keeps its message. Marking packed freezes names and weights; Return to planning takes the closet's again. Print stores the PDF (Gotenberg → MinIO) before answering; `Download pack sheet` and the out-of-date notice are decided by the server on every read from content equality.
6. **Share** (brief: Journeys 6). `/s/<token>` is server-rendered with only the published share fields; revoke or regenerate kills the old token; expiry is judged on every read in the hiker's current time zone.
7. **Import** (brief: Journeys 7). The original CSV is stored before it is read; unreadable files answer one plain sentence tied to the file field (aria-invalid + description + status, focus on the field), delete the object and record nothing; confirm writes all created items in one transaction, once.

## Palette roles (hex used by the build)

ground #F3EFE5, ink #1C2A22, muted ink #46544B, rule #B7B29F, contour #D9D1BB, moss #3E5F3C (controls, focus, under goal), moss dark #2C4A2B, blaze #E4570E (goal line and chevron only), blaze deep #9C3A06 (over-goal text only). Source: brief: Visual design (roles), decided: hex values within those roles; contrast pairs listed in DESIGN.md.

## Type, space and layout

Space Grotesk 700 headings (h1 32, h2 24, h3 18: one third larger per level), IBM Plex Sans body 15/1.45, IBM Plex Mono tabular right-aligned figures (brief: Type). Unit 4px, radius 0, no shadows (brief: Density). Workspace: below 768 one column (totals, strata strip, pack list, closet; strip collapsed on every load); 768–1199 two panes (closet left; pack list over strata right); 1200+ three columns with a 340px strata column (brief: Screens and layout). Group headings in every ledger are h3 at 18 px Space Grotesk 700 with the subtotal in Plex Mono (brief: Type, one third per level). Ledger rows carry hairline `--rule` borders on the row itself (brief: Density). Dialogs sit 72 px from the top from 768 px up so they never cover the header; a field in error has a 2 px ink border plus the moss marker, and moss stays reserved for focus (decided: brief: Working screens, error text is ink with a moss-outlined marker). The workspace marks Trips as the current header link (decided: a workspace belongs to Trips). Bands at least 18 px tall show their category and weight; thinner bands are named in a hairline key under the column; the side columns carry `Worn` / `Cons.` captions over a baseline (decided: legibility of DP-16 for a stranger; accessible names unchanged). The totals strip labels the delta `Goal <goal>` (decided). The strata column is not sticky, because the brief lines the three columns' top edges up under the totals strip. Strata column height 480 px wide, 360 px phone; band height `round-half-up(categoryBaseGrams × H / goal)`; stack capped at 1.25 H (brief: Motion).

## Motion

| Element | Trigger | Duration, easing | Reduced motion |
|---|---|---|---|
| chip | pack onto a new line (step 1), unpack (last step) | 320 ms, ease-in-out | none |
| band, side columns | every change (step 2; unpack step 2) | 240 ms, ease-out | final in next frame |
| numerals | every change (step 3; unpack step 1; only step on collapsed phone strip) | 400 ms, ease-out | final in next frame |
| dialog | open | 180 ms fade and rise | none |
| ledger row | enter | 160 ms fade | none |

Sources: brief: Motion and effects (ranges); decided: the three durations inside them. Frame time drives the sequence; steps never overlap.

## States per async action

Pending and result copy are exactly the brief's Feedback states tables, shown in the named polite live regions and never cleared by a timer. Outages: MinIO down → photo 503 `Photo storage is unavailable. The item was saved without a new photo.`, import 503 `File storage is unavailable, so nothing was imported. Try again later.`; Gotenberg down → `Pack sheets can't be printed right now. Your list is unchanged; try again later.`.

## Breakpoints

768 and 1200 (each boundary belongs to the wider layout); touch targets 44×44 below 768 (brief).

## Media and licences

No images, audio, video or models ship. Fonts: Space Grotesk, IBM Plex Sans, IBM Plex Mono (Fontsource 5.3.0 woff2, SIL Open Font License 1.1, texts in THIRD_PARTY_NOTICES.md). Production dependency: `pg` and its MIT/ISC dependencies; build tools are listed in the notices.
