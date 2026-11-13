# TRUTH — Lowlamp Field Log golden

Every value says where it came from: `brief: <section>` (copied) or `decided: <why>` (the brief is silent).

## Journeys (ideal end-to-end flows)

### 1. Set up a kit
- Start: empty account. Sign up at `/signup` (Email, Password, Your name → Create account) → lands on `/kit` (brief: Landing routes).
- Add telescope: name, Aperture + Aperture unit `in`, Focal length (mm); `status "Aperture in millimetres"` updates per keystroke (`25.4 mm`, `254 mm`) (brief: Kit). Add telescope → `Added <name>.` in Kit status, fields clear, focus on Telescope name (brief: Account, kit and site forms).
- Add eyepiece and Barlow the same way; they appear in the Your kit list and in the Session pickers.
- Repeated Enter while a request is unanswered sends one request (single-flight per form) (brief: DP-94).
- Wrong password five times for one email → `Too many sign-in attempts for this email. Wait 15 minutes and try again.` in `alert "Account problem"`, even with the right password (brief: Business rules).
- Visible end state: kit list with 3 items; provider-recorded: rows in Postgres `telescopes`, `eyepieces`, `barlows` for the account; telescope `aperture_mm` 254.

### 2. Log and sketch at the scope
- Tonight: Site + Start session → queues `session.create` with default optics (first telescope, longest eyepiece, no Barlow, Straight through) → `/sessions/<id>`; readout `48× · 84′ field · 5.3 mm exit pupil · North down, east right.` (brief: Default optics).
- Pick optics: readout text is the final line within the same frame; the Field swap runs 320 ms (numerals + scale) then 180 ms (compass + marks turn/flip); the compass name and the `Field now …` announcement land at 500 ms (brief: Motion).
- Sketch: arrows move the cursor 1′ (5′ with Shift) in the on-screen direction; 1–5 brightness; Enter star (or pair point in Measure); brackets swap eyepiece; Ctrl/Cmd+Z undo; finger/stylus draw; Save observation → `observation.create` (+ `sketch.put` when marks exist); stroke file stored in MinIO byte for byte under `observers/<account>/strokes/<observation>/<sha256>.json`.
- Provider-recorded end state: observation row version 1, stroke object in MinIO; after reload the same sketch and values show.

### 3. A night with no signal
- Offline banner `You're offline. Everything you log is kept on this device and syncs when signal returns.`; waiting-count line `<n> change(s) waiting to sync.`; Start session + two sketched observations = `5 changes waiting to sync.`.
- On return the journal is sent in order within 5 s (online event), one sentence per observation in `status "Sync results"`, count line disappears, each observation exists once (same client op ids on any retry).
- Storage refusing a sketch: 503, nothing changes server-side, the change stays queued, storage sentence in Save status / Sync results. 401 on sync: signed-out line with `Sign in`, no sends until sign-in, unsaved typing and marks restored after same-account sign-in.

### 4. Two devices, one field
- Tablet edits the description offline; laptop edits it later; on sync the newer laptop text is kept, `Newer description from laptop kept.` is announced, form and history copy update without reload. Two tabs share one journal (Web Lock) and one sender; each sync sentence appears once in each.

### 5. Tidy notes at the home desk
- Signed out at `/objects/m13` → `/signin?next=%2Fobjects%2Fm13` → after sign-in back on M13's history (newest first), Open the 2025 row, lengthen description, Save → `M13 saved.`; history row shows the new text.

### 6. Follow a program and check a packet
- Programs: Follow moves the row between lists at once; newest press wins; Program screen: progress bar, counts line `5 of 6 objects · certificate at 5`, edition line, checklist, Build packet → draft packet; Check packet lists `M2, 2026-10-31: add the Shapley-Sawyer concentration class.` and the 80-character reason; Remove M2 (focus to next Remove / previous / Check packet), Check packet again → `Checked: 5 observations ready to render.` with label Checked.

### 7. Render and send
- Render packet → Rendering (poll 1/s, one timer, one request) → `Packet <n> is rendered and stored (<pages> pages).`; PDF stored at `observers/<account>/packets/<packet>/<sha256>.pdf` after a read-back of size and checksum; Paper preview shows the same pages; Download PDF downloads the stored bytes as `lowlamp-packet-<n>.pdf`.
- Send to coordinator → dialog (focus Send now; Tab wraps; Escape returns focus at once) → Send now: Sending → Sent; Mailpit holds one message (To coordinator, Cc observer, PDF attached).

### 8. Edit after sending, and delete a mistake
- Redraw a cited sketch: sent packet stays Sent, its PDF and cited stroke file unchanged; a new packet cites the new stroke file. Delete from a session row or history row: row, stroke files, sketch images go; focus moves to the next row's Open (else previous, else New observation / `Tonight` link); a delete of an observation a sent packet cites is refused (`cited_by_sent_packet`) and the row returns.

## Palette roles (hex the build uses)

| Role | Hex | Source |
|---|---|---|
| ground | `#140C16` | brief: deep plum-black; decided: hex |
| surface | `#2A1C2F` | brief: slightly lifted plum; decided: hex |
| surface-hover | `#352439` | decided |
| ink | `#FFFFFF` | brief: pure white |
| muted | `#B9A9BF` | brief: dusty mauve-grey; decided: hex |
| accent | `#FF2E93` (text `#140C16`) | brief: hot pink with plum-black text; decided: hex |
| white field | `#FFFFFF`, text `#10173A` | brief: landing white field, near-black blue-ink |
| field ground | `#0B060D` | brief: near-black field; decided: hex |
| graphite | `#34343B` | brief: graphite on white; decided: hex |

## Type, space, layout

- Sora variable (OFL-1.1) latin + latin-ext, served from `/fonts/`; body 16px/1.55, h3 20px, h2 25px, h1 31.25px (×1.25 steps), sentences 18px, small 13–14px; tabular figures (brief: Typefaces).
- Column 520px at 22vw (≥600px), `100% − 32px` with 16px margins at 375; Session circle = column width, 343px at 375 and at 812×375; tools 56×56; every tappable control ≥ 44×44 (brief: Screens and layout, Controls).
- Session per viewport: 375 tools row under circle, pickers stacked, form stacked; 768/1024 tools strip 16px right of circle top-aligned, pickers 2×2, Seeing+Transparency on one row; 812×375 (landscape, max-height 500) 343px column at 16px, tools 2-column grid right of the circle with the readout under it, pickers stacked below; 1280 tools row, pickers one row of four (brief: Session screen, per viewport).
- Radius 8px on inputs and buttons only (landing plinth 24px: decided, brief says "rounded-square"); list rows 24px apart, no rules (brief: Density).

## Motion table

| Element | Trigger | Duration | Easing | Reduced motion |
|---|---|---|---|---|
| numerals + circle scale | optics pick | 320 ms | cubic ease-out (decided: "fast start, soft stop") | one frame, readout stays visible |
| compass + marks turn/flip | after scale | 180 ms | cubic ease-out | one frame |
| swap end (figures removed, compass named, announcement) | 500 ms after pick | n/a | n/a | immediate |
| landing hero crossfade | every 6 s (each object holds 6 s, then the crossfade starts at the boundary; the accessible name flips at its midpoint) | 1000 ms | linear mix | holds M13 |
| buttons/rows hover, press | pointer | 120 ms | ease-out | none |
| dialogs in/out | open/close | 140 ms | ease-out | none |

## States per async action

| Action | Pending | Success | Error / outage |
|---|---|---|---|
| sign up / in | one request in flight | land on `/kit` / `next` | field errors inline + focus first invalid; `Account problem` sentence; no-network sentence |
| kit/site forms | one request in flight | `Added <name>.`, clear, focus first field | 422 values stay + focus first invalid; 5xx/offline: values and focus stay |
| Save observation | `Saving <designation>.` | `<designation> saved.` / `saved on this device.` | `Fix these first` alert with links; 503 storage sentence |
| sync | count line | sentences per observation | 401 signed-out line; 413 split; 4xx rolled back |
| packet actions | pressed control keeps focus, one action in flight | status label + sentence, focus per table | stale: `This packet changed somewhere else…`; renderer/mail/storage sentences |
| Follow / Unfollow | row moves at once | `Following …` / `Stopped following …` | no-signal / 500 sentence, row returns |

## Breakpoints

375×812, 768×1024, 1280×800, plus 812×375 and 1024×768 for Session (brief: Browser support). Column switches at 600px; landscape phone rule `orientation: landscape and max-height: 500px`; desktop tools row from 1200px (decided: 1024×768 must use the tablet strip).

## Media and licences

No photographs. Drawn in code (licence `original`): landing eyepiece views (canvas), compass and packet-page demonstrations (SVG), tool icons, empty ring, favicon. Fonts: Sora (OFL-1.1) from `@fontsource-variable/sora@5.3.0`, listed in `app/assets.json` with sha256; full OFL text in `THIRD_PARTY_NOTICES.md` and `public/fonts/OFL.txt`.
