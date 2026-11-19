# TRUTH — Oxbow Assembly Rushes (golden)

Every value says where it came from: `brief: <section>` (verbatim) or `decided: <why>`.

## Journeys (ideal end-to-end flow)

1. **Collect references** (brief: Journeys 1). Start: Juno signed out. `/signin` → email + password → lands on
   `/w/northvale` (brief: Return after sign-in, member lands on wall). Upload (button "Upload references",
   Enter opens the file chooser) two JPEGs → "Uploading <file>..." then "Uploaded <title>." in
   `status "Wall announcements"`; the stored objects have no APP1/APP13/COM segments (brief: Upload hygiene).
   A WebM opens `dialog "Clip details"` (Title, Frame rate 24/25/30, Upload clip) → durationMs is read from the
   file in the browser (decided: the dialog asks only title and rate; the brief sends durationMs with clips).
   Typing "SS27" runs search 250 ms after typing stops, replacing the history entry with `?q=SS27`; Enter adds an
   entry. Status: "Searching..." then "<a> clusters and <b> references match <q>." Reload restores field,
   results and counts. "Add <title> to cluster" → picker, type "Coastal", ArrowDown, Enter → POST entries → the
   cluster becomes the tray's active cluster, "Added <title>. <n> items in <cluster>." in
   `status "Tray announcements"`, count rolls, row slides in at the end; reload shows the same order.
   Provider end state: rows in `"references"`, objects at `references/northvale/<id>.<ext>`, entry appended.
2. **Pluck a frame** (brief: Journeys 2). "Open clip Capstan reel" docks the strip (420 ms rise), focus on
   `slider "Playhead"` (0..49, value text = timecode). Drag, touch-drag or keys (←/→ 1 frame, Shift 25 frames,
   Home/End) → preview + `timer "Timecode"` update per frame. P → slot appears with "Saving", tile flies 420 ms
   to it, "Saving frame <tc>..." once the captured still is sent (decided: the pending copy names a save that is
   actually under way; a frame that cannot be captured announces the not-saved row) → server stores PNG (metadata chunks removed) with object metadata
   `source-clip`, `timecode` → "Plucked <tc> from Capstan reel. <n> items in <cluster>." Count rolls 160 ms. Focus
   stays on the playhead. Reload: slot shows "Capstan reel · <tc>".
3. **Order for a presentation** (brief: Journeys 3). Handle Space lifts ("Lifted ..."), ↑↑ moves ("<title>,
   position p of n."), Space drops → row "Saving" → "Moved <title> to position p of n. Order saved." Drag moves
   by slot under the pointer. If a colleague embargoes meanwhile: 409 → order restored, "<cluster> is locked
   while Embargoed. The order is unchanged." Sheet: `text/csv; charset=utf-8`, CRLF, formula-like title and
   source cells prefixed with `'`.
4. **Review round** (brief: Journeys 4). Settings → Send to review → review link form (Freelancer email,
   Expires as UTC datetime → `YYYY-MM-DDTHH:MM:00.000Z`, Allow comments) → mail "Review <title> for Northvale"
   with `<APP_PUBLIC_URL>/review/<token>` → freelancer sees "Review: <title> · expires <UTC> UTC", entries,
   comments; 6th comment within 60 s → 429 with retryAfter, button disabled for that many seconds, text kept,
   focus moves to the Comment field (brief: Review comment wait).
   Regenerate → old token answers 410 link_revoked and shows "This review link was revoked."
5. **Embargoed release** (brief: Journeys 5). Schedule embargo → Lift date/time read in Europe/London →
   "Embargo set. Goes public at <local> Europe/London." and "Goes public at <local> Europe/London (<UTC> UTC)".
   From liftsAt the cluster is public on every read (lift applied at request start + 1 s ticker); the settings
   screen re-reads every 30 s and shows "Public" without touching typed text. One digest per follower:
   subject "New from Juno Park: <title>", text/plain, exactly 4 CRLF lines.
6. **Discover and follow** (brief: Journeys 6). Phone Explore → Menu → profile → Follow (signed out) →
   `/signin?next=/@ilse` → Create an account (next carried) → back on `/@ilse`, Follow unpressed → press → count
   +1 at once → "Following Ilse Vartan. <n> followers." Explore Load more → `?pages=2`; Back restores cards.
7. **Seats, invites and upgrade** (brief: Journeys 7). Admin: filter `?seat=unseated`, invite (mail "You're
   invited to Northvale on Rushes" naming Mara), accept at `/invite/<token>` → designer without seat, assign last
   seat (workspace row lock; concurrent loser gets 409 no_seats_left and re-reads the roster), upgrade
   (Kill Bill change IMMEDIATE → read back → receipt "Rushes receipt: Northvale is now on Pro 10 seats" → record
   cap; mail failure changes Kill Bill back). Idempotency-Key replays return the stored body.
8. **Cluster lifecycle** (brief: Journeys 8). New cluster with empty title → error summary focused, link to
   Title → create → settings, "Created <title> as a draft." → Send to review → Back to draft ("Back to draft.
   Review links are no longer active.") → ops lead withdraws a public cluster via the dialog; refresh leaves the
   dialog and note alone; public page, profile listing, feed and public media disappear at once,
   except media another public cluster still holds as a non-private entry.

Titles keep every character as sent, line breaks included, in the API and feed (brief: API, "Titles are stored exactly
as sent"). Explore articles are named by their title heading, and the accessible-name algorithm collapses whitespace
runs, so a title with a line break is read with single spaces there (decided: browsers do not keep the raw text in an
accessible name; changing the stored title would break brief API and Digest).

## Palette (decided values; roles from brief: Visual design)

| Role | Hex |
|---|---|
| ground | `#0f1012` |
| panel | `#181a1e` |
| panel-raised (fields) | `#20232a` |
| band (strip) | `#08090a` |
| ink | `#ede6da` |
| secondary | `#9ba3ae` |
| accent (playhead, active slot, picker option, current tile only) | `#f0a23a` |
| control boundary | `#737b87` |
| error rule (non-text) | ink `#ede6da` (the single accent stays amber; brief: Visual design) |

## Type, space, layout

- Familjen Grotesk 600 (headings, wordmark, cluster titles); IBM Plex Sans 400/500/600 (body 14px/1.45, controls);
  IBM Plex Mono 400/500 tabular (timecodes, counts, meter, prices, dates, slot numbers) (brief: Type).
- Scale ×1.333: 14 / 18.67 / 24.89 / 33.19 px (brief: about a third per level, top ≈ 2⅓× body).
- 4px spacing unit; masonry gap 8px; tray rows 56px; every button/link ≥ 44×44 (brief: Density).
- 375×812: 1 wall column, tray bottom bar, Menu, 1 Explore column, stacked settings/admin.
- 768×1024: 2 wall columns, tray right column (264px), inline nav, 2 Explore columns, stacked.
- 1280×800: 3 wall columns, tray right column (324px), 4 Explore columns, settings/admin side by side.
- Strip dock (decided: brief Screens > Wall puts preview and timecode at the strip's left end): from 1024 wide the
  preview (192×108), the readout over Pluck/Close, and the 108 px band share one centre line; 720–1023 keeps the
  preview (160×90), the readout under it and Pluck/Close under that in one column at the band's left end; below 720
  (tray a bottom bar) the preview and readout sit above the band (brief: Screens > Wall).
  The strip fits at least 8 and at most the clip's total frames (every frame for shorter clips), resamples on width changes and never scrolls; space past each band end
  keeps the playhead's hit area and focus ring on screen at the first and last frame.
- Strip tiles fill the 72 px row between the sprocket rails (40 px below 720), each frame cover-cropped to its tile
  (decided: brief Composition, a film strip of evenly spaced frame tiles, not letterboxed thumbnails).
- Tray header: the active cluster's title, then the switcher with the "New cluster" button beside it on one row (the
  switcher takes the remaining width and cuts a long title short with an ellipsis; its open list spans the whole row; the
  tray is 324 px from 1024 wide and the text-only "New cluster" button is tight, so a seeded cluster title shows whole beside it),
  then the item count, 8 px above the order's top rule (brief: Screens > Wall, "a switcher with the "New cluster" button
  beside it"). The right-column tray live line is a status bar at the tray's foot, above "Cluster settings": one small
  line high with 8 px of padding, growing downward for a longer result (decided: the head stays compact and a result
  never shifts the order under a landing still).
- Status labels, link states and the seat tag are borderless 4 px tags; the settings status label shows a small
  "Status" word before its tag (decided: brief Public screens names the label "Status"; a tag never reads as a button).
- Settings header: the title, then the status label on its own line, then the status actions on a new row 12 px below;
  forward steps (Send to review, Schedule embargo, Set embargo) take the primary style, backward steps (Back to draft,
  Cancel embargo) the secondary style (decided: the status reads apart from the actions; emphasis follows the
  lifecycle's forward direction). Tags size to their icon and word, never stretching across a grid cell.
- Sign-in, sign-up and invite headings use the page-title size (33.19 px) like every other page heading (brief: Type).
- Tray order scrolls on its own with a 32 px fade at the bottom while rows remain below; docking the strip scrolls it
  to the end, where a plucked still lands, and an order left at its end stays there while rows grow or the list
  shrinks (decided: the new slot is always in view).
- Wall tools: the Wall and Search status lines take one small line (16 px), 4 px under the search row and 8 px above
  the first card row (decided: brief Density, compact).
- Top bar: the ops lead's "Brand workspace" combobox draws a 36 px box like the nav pills inside a transparent 4 px
  border, so its tap target stays 44 px (brief: Density, every tap target).
- Admin: the left two-thirds hold the roster and, under it, the collaborator offboarding form; the right column holds
  the seat meter, plan and invite (brief: Screens > Admin, the roster sits beside the plan and invite sections). The
  roster has a "Seat" column with a borderless tag (circle-check "Seated" / circle-pause "No seat"); seat buttons use
  the 14 px secondary button style (decided: a row's seat state reads apart from its action, never by colour alone).
- Review link rows: the email with its state tag 8 px after it on one line, then the UTC expiry with Regenerate and
  Revoke right-aligned on the next line (decided: the state reads with the link it describes).
- Settings entry rows: the privacy checkbox shows the word "Private"; its accessible name stays "Keep <title> private"
  (brief: Public screens; decided: the row already shows the title once).
- A still's source line breaks after "<source clip title> ·", keeping the timecode whole (decided: brief Type, the
  timecode never splits).
- Public cluster meta: "Curated by <name> @<handle> · <n> items", then the publish date on its own line (decided: no
  separator ever dangles at a wrap). The review page keeps banner, entries and comments on one 792 px measure.
- Credits: one link per person ("<name> @<handle>", handle in secondary grey), 24 px apart, underlined on hover only
  (decided: brief Public cluster, credits show display name and handle; each person reads as one credit).
- Headings balance their line breaks, so a two-line heading never leaves one word alone (decided: brief Screens,
  long titles wrap).
- Sign-in and sign-up switch links are at least 44 × 44 (brief: Density, every tap target).
- A wall card's full-title overlay shows on hover only when its title line is cut short (brief: Hover, the title shows
  in full; decided: never the same name twice).

## Breakpoints (brief: Screens and layout table; lower bounds inclusive)

600 (wall/explore 2 columns), 720 (tray right column, inline nav), 1024 (wall/explore 3 columns), 1280
(explore 4 columns, side-by-side settings and admin).

## Motion (brief: Motion and effects; easing decided `cubic-bezier(0.16, 1, 0.3, 1)`)

| Element | Trigger | Duration | Reduced-motion substitute |
|---|---|---|---|
| strip dock | open / close clip | 420 ms translateY | 160 ms opacity in place |
| pluck flight | P / Pluck | 420 ms translate+scale to slot (or bar when collapsed); failure reverses | slot thumbnail fades 125 ms, no travel |
| count roll | item count changes | 160 ms digits slide | changes in place |
| add row | entry added | 240 ms slide in | none |
| seat meter roll | seats used or cap change | 160 ms digits slide | changes in place |
| reorder shift / settle / restore | lift, step, drop, refusal | 160 ms FLIP | jump |
| menu / tray panel | open / close | 200 ms opacity+translate | instant |
| hover / press | pointer | 140 ms colour/border | instant |
| pending dots | request in flight | 900 ms loop | steady |

## States per async action (brief: Feedback states, copy verbatim in code)

Upload, pluck, add, reorder, status change, details, privacy, review link create/regenerate/revoke, comments,
seats, invites, offboarding, upgrade, follow, feed: each control is disabled while pending (its pending copy is implementation-defined unless the brief gives one); each
result goes to its named live region with the brief's copy; failures restore the earlier state except that stale-order refusals show the server-returned order, illegal status transitions show the returned `from` status, and a no-seats-left refusal re-reads the roster and puts the server's current state in place (brief L403); refused forms
render the one error summary with field messages from the API.
A pluck answered 503 (storage unavailable) announces the storage row (brief: Feedback states).
A touch tap on Pluck plucks on release, and the click a browser may add afterwards is ignored (decided: brief
Interactions > Plucking names a tap on a touch screen, and a tap right after a scrub does not always become a click).
"Moved <title> to position p of n. Order saved." is announced once the 160 ms settle has finished, so the saved order
is at rest where it is read (decided: brief Motion > Reorder, a dropped item settles, then the move is reported).
Request keys and multipart boundaries use `crypto.getRandomValues`, which also works on plain-http origins
(decided: Deployment serves plain http on any host).
Menu and tray panel keep `aria-expanded="true"` throughout the close animation, then set it to `false` when the contents are
hidden, not focusable and absent from the accessibility tree (brief: Collapsed navigation and tray).

## Media and licences

- `assets/capstan-reel.webm`: original, FFmpeg `testsrc` 480×270, 25 fps, 2.000 s, VP9 (brief: Seed data).
- Seed image plates: original, generated 720 px wide PNGs without metadata chunks, twice the widest card width so no
  plate shows upscaled (brief: Seed data; decided: Media must never read as stretched).
- Fonts: Familjen Grotesk, IBM Plex Sans, IBM Plex Mono via Fontsource, OFL-1.1, self-hosted; the served page head
  preloads each woff2 and the faces use `font-display: block`, so no screen paints a fallback face (decided: brief Type).
- Icons: lucide-react (ISC), bundled.
