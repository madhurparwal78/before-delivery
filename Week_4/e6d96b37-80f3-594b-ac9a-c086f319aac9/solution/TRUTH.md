# TRUTH — Hollowmint Desk Co. Flan (golden)

The brief made concrete. `brief:` values are copied from `instruction.md`; `decided:` values fill
silences in the brief's intent. Copy strings live once in `app/src/shared/feedback.ts` (brief:
Feedback states) and are not repeated here.

## Journeys (ideal end-to-end flow)

1. **Intake** — start: empty intake form, two staged faces (brief: Journeys 1). The dealer chooses
   or drops a file on "Obverse photo", moves it to "Obverse slot" (drag, tap-then-tap, or Space /
   Tab / Enter), the same for the reverse, types "Specimen reference", opens "Review intake" and
   confirms "Create specimen". G07 shows F_PENDING until MinIO confirmed both objects
   (`specimens/<ns>/<ref>/<label>-<sha256>.<ext>`, read back by HEAD), then F_INTAKE_OK; focus
   moves to the created specimen's heading. End: specimen `<ref>`, status `pending_catalogue`,
   two photos, event `specimen.created` (brief: Business rules, Intake photographs). A wrong file
   is refused in its slot by the shared photo rules before any upload; the server repeats them.
2. **Attribution and reconciliation** — the dealer zooms the mintmark (A02, keys or pinch around
   the touched point), writes a note and confirms "Quarantine attribution" (F_ATTR_OK, status
   `quarantined`, certainty `uncertain`, event `specimen.quarantined`, filled holes reopen). Or the
   dealer types a correction, wipes Register / Obverse (R02), confirms "Save reconciliation": the
   server stores the correction (`register: "pending"`), calls the register variety lookup and
   image within FLAN_PROVIDER_TIMEOUT_MS, stores the SVG at `catalog/<ns>/<ref>/r<rev>.svg`, then
   commits `register: "stored"` and status `attributed` (F_CATALOG_OK). Register failures keep the
   correction and show the pending catalogue note with R04 or the countdown (brief: Catalogue
   reconciliation).
3. **Shelving and sets** — holders move into cells and are confirmed through "Place holder"
   (F_TRAY_OK, `tray.placed`); a slab 70×90 mm is refused for a 60×60 mm cell (422 `cell`
   F_TRAY_SIZE), an occupied cell answers F_TRAY_TAKEN, a stale tray version F_CONFLICT. Album
   holes fill through "Fill album hole" (F_SET_OK, `album.filled`) and redraw on other screens
   from the event stream.
4. **Condition and keepers** — the dealer wipes Obverse / Arrival (C02), places the condition
   marker on the scratch by drag, keys or Image x / Image y, confirms "Save condition note"
   (F_CONDITION_OK, annotation in original-image coordinates on the arrival photograph). The keeper
   list is reordered by Space / arrows / Enter or touch drag (each move announced F_REORDER) and
   saved or undone through "Save keeper order".
5. **Offer and counteroffer** — the dealer fills both baskets, confirms "Send reciprocal offer";
   without a fresh step-up the review shows F_MFA_REQUIRED and "Verify identity", which runs
   Keycloak's one-time-code page and resumes the send once (F_OFFER_OK, both baskets `reserved`,
   window FLAN_OFFER_WINDOW_S). A replacement by either party clears both acceptances
   (F_COUNTER_VOID on both screens); each party re-accepts via "Accept offer version" after
   "Verify acceptance".
6. **Dispatch and receipt** — the sender orders the packing manifest and confirms "Freeze
   dispatch evidence": copies of each latest obverse to
   `manifests/<ns>/<offer>/<party>/<key>-dispatch-<sha>.<ext>` and `manifest.json`, all read back,
   then F_DISPATCH_OK; both frozen makes the offer `dispatched`. Each receiver compares arrival and
   dispatch photographs at one shared zoom, optionally adds an arrival photograph, ticks "Manifest
   matches" and records receipt with a fresh step-up; the second matching receipt swaps owners in
   one transaction (F_RECEIPT_DONE on both screens).
7. **Dispute** — the receiver pins the damage marker on the arrival photograph and confirms "Hold
   ownership transfer": a snapshot `disputes/<ns>/<dispute>/evidence-<sequence>.json` is written
   first, then the offer becomes `disputed` (F_DISPUTE_OPEN on both screens). A private link
   `/evidence/<token>` is copied (F_LINK_COPIED) and revoked through "Revoke evidence access"
   (F_LINK_REVOKED). One party proposes, the other approves through "Resolve transfer hold"
   (F_RESOLUTION_WAIT, then F_RESOLUTION_DONE).
8. **Audit** — the dealer walks the audit tray (swipe, arrows, Previous / Next cell), records a
   missing item through "Record missing item"; offline marks queue in browser storage with chained
   expected versions, replay through `/audit/sync` on reconnect, announce F_AUDIT_MISSING per mark
   and F_SYNCED, and stale marks stay visible with "Reload current".

## Palette (hex used by the build)

ground #ECEEEF · sheet #FFFFFF · ink #000000 · slate #434A55 · teal #3D8B97 (edges) · teal-deep
#1F6E7A (all teal text, focus ring) · teal-deep-hover #185A64 · corner block #2B7A86 / hover
#226670 · unselected tab #A8A29E with label #262220 · caption #5C636D · amber pill #E8B04A with
slate text · album gap dash #7D838B. Source: brief: Colour roles; decided: exact shades chosen for
WCAG 2.2 AA (see DESIGN.md Palette).

## Type, space and layout

- Saira 500/600 (wordmark 40px desktop, 30px phone; lockups 26px; headings 14.67px); Archivo
  400/700 at 13.33px/20px; tabular figures for counts and coordinates (brief: Type; decided: sizes).
- Margins 36px desktop/tablet, 10px phone; sheet inset 34 / 18 / 8px; inner boxes pad 13.33px;
  square corners except the amber pill and the "Keeper" badge; no shadows (brief: Ground and sheet).
- Breakpoints: phone < 768, tablet 768–1279, desktop ≥ 1280 (brief: Screens and layout). Layout
  changes are CSS grid-area swaps; the Inspector role is set by `matchMedia` without remounting.

## Motion

| Element | Trigger | Duration | Easing | Reduced motion |
|---|---|---|---|---|
| wipe marker caption | divider uncovers / covers its point | FLAN_MOTION_MS | linear | instant |
| replaced offer slot image | committed replacement | FLAN_MOTION_MS out, then in | linear | instant |
| zoom, wipe divider, markers, drags | pointer, touch, keys | 0 (tracks input) | none | same |
| wipe tab swap at 50 percent | divider crosses midpoint | 0 | none | same |

Source: brief: Motion and effects. Graded fades use `element.animate`; no CSS transitions exist.

## States per async action

Every confirmed command: G07 F_PENDING from send to reply, Confirm disabled; success copy only
after the persisted state is known (state refetched first); 401 → G08 F_SESSION + note with
"Sign in again" and the command stored for one resume (F_RESUMED then the result); 403 step-up →
F_MFA_REQUIRED inside the review with "Verify identity" / "Verify acceptance"; 409 stale →
F_CONFLICT + "Reload current"; other 409 → its copy in G08; 422 → F_INVALID (or the field copy the
brief routes to G08) plus field errors; 503 → F_SERVICE + "Retry save" (same command id);
catalogue errors → their copy in G08 and the pending catalogue note with R04 or the countdown.
Source: brief: Feedback states.

## Decided where the brief is silent

- The namespace clock reaches the browser as the `x-desk-clock` response header of the state read
  (decided: "Today" and counts must never come from the device clock).
- The register reference image is served by the photo route under the id `register:<reference>`
  as face "register" (decided: G27 names the face; the brief gives no other image route).
- Non-secret interface limits are embedded in the served page; secrets never are (decided: the
  browser must apply the same photo, text, zoom and target rules).
- Seeded identities' one-time codes may be reused within a period (decided: tests take a fresh
  code before each challenge and two challenges can fall in one period).
- New intake specimens arrive in a 50×50 mm flip; certainty starts `certain` (decided).
- A counterpart sees offers past their draft; drafts are the dealer's own work (decided).
- A basket item owned by the other side answers 404 (brief: Error precedence, a foreign resource
  key in the body). Ineligible items are 409 state conflicts in the brief's listed order
  (brief: Error precedence step 5): reserved or held F_OFFER_TAKEN, outbound F_IN_OFFER,
  quarantined or uncertain F_SET_UNCERTAIN, missing or transferred F_SET_OUTBOUND, unreconciled
  F_CATALOG_PENDING (decided: these are the brief's only eligibility copies for those states).
- Stock grid pages show 12 chips (decided: fits the desktop left third).

## Media and licences

Fixture coin photographs are drawn procedurally by `app/src/server/fixtures/draw.ts` (original).
Their rim band (r 410–450 of 1000) is evenly toned like the register drawings' stroked ring, and
the mintmark sits at (600,400) (brief: Services, register image; Fixture photographs), so a
reference and a photograph line up across the wipe divider (decided: DP-12 continuity).
Saira and Archivo (SIL OFL 1.1) ship through Fontsource; icons are Lucide (ISC). Every shipped
package is MIT, ISC or OFL-1.1 (`app/THIRD_PARTY_NOTICES.md`).
