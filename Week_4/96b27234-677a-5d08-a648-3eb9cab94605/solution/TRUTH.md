# TRUTH — Hearthtile golden

The intended behaviour of the reference app, made concrete from the brief. Every value says where it came from:
`brief: <section>` (copied verbatim from `instruction.md`) or `decided: <why>` (the brief is silent; the reason ties it
to the brief's intent).

## Journeys (start state, actions, visible and provider-recorded end state)

1. **Walking a room by keyboard** (brief: Journeys 1). Start: a Member on an open session page, focus on `button "Step north"`.
   Arrow keys turn then step (`data-facing`, then `data-tile-x/y`); a wall, seat or person refuses with the exact text
   in `status "Room announcements"` (`A wall blocks that way.`, `A seat blocks that way.`, `Someone is standing there.`);
   `S` sits on the seat straight ahead (`data-seated="true"`, `list "Room features"` item `data-occupied-by` = the person)
   and stands back (`Stand up to move.` while seated); `N` announces `Nearby: <names>.`; `M` opens `dialog "Person actions"`
   for the nearest person; Escape returns focus to the control that had it. End: the mirror shows the new tile and
   focus is back on the starting control. Provider record: the Valkey hash `session:<id>:positions` holds the tile.
2. **Meeting across instances** (brief: Journeys 2). Two Members on instance A and instance B in one session see each other
   arrive and move with no reload through the Valkey channel `session:<id>:events`. Both step for one tile: the Valkey claim
   gives it to one; the other reads `Someone is standing there.` and stays. End: both mirrors agree on the winner's tile,
   then the announced departure `<name> left.`.
3. **Walking on a phone** (brief: Journeys 3). At 375x812 the four direction buttons (56 px) step once on press and repeat
   every 250 ms of page clock while held, also when released outside the button. `button "People and chat"` opens
   `dialog "People and chat"` (focus on its first control), Tab wraps, arrow keys in the chat field move only the caret,
   Close or Escape closes it, and reopening during the 250 ms exit keeps it open (one cancellable timer). End: an open
   sheet and a canvas above it showing the person's tile.
4. **Talking nearby** (brief: Journeys 4). Send: `Sending...`, then `Heard by N.` (the server's `heardBy`); the speaker's
   region runs `data-ripple="growing"` radius 0 to 6, one tile per 60 ms of page clock, held 500 ms, then `none`; the
   recipient reads `<name>: <text>` in `log "Nearby chat"`; the distant Member receives nothing, in the API or on the socket.
5. **Opening and filling a session** (brief: Journeys 5). A Host opens a room with a level and capacity; friends see it,
   others get 404 and never see it in lists; of concurrent joiners exactly one takes the last place (Valkey claim), the
   others read `This session is full.`; when the host leaves the longest-present person becomes host.
6. **Publishing a checked model** (brief: Journeys 6). In the studio by keyboard: a renamed file reads
   `This file is not a GLB model.`; a real GLB reads `Rank: <rank>. Worst measure: <measure>.` with `table "Measures"`
   (rows `triangles`, `materials`, `texture size`, `file size`); Publish reads `Version <n> published.`. MinIO holds the bytes at
   `assets/<assetId>/v<n>.glb`.
7. **Changing a room while people stand in it** (brief: Journeys 7). Publishing a new version leaves people inside on their
   version (`data-room-version`) until they rejoin; restoring creates a new version with the old bytes; removing a version
   in use answers `This version is in use by an open session.`; a removed file answers 404.
8. **Staying safe and being heard** (brief: Journeys 8). Block, mute, hide by rank, removal vote and report all apply at once
   with the exact notices; a Moderator moves a report; suspend ends sessions and sign-ins; a demotion removes
   `button "Schedule gathering"` on the pushed event and focus moves to the main heading; a reminder mail arrives at
   `REMINDER_LEAD_MINUTES` before the occurrence, once, in the member's zone.

## Palette roles (brief: Visual design; hex values decided to meet WCAG 2.2 AA)

| Role | Hex | Source |
|---|---|---|
| ground (cream paper) | #F7F0DF | brief: Visual design (cream paper ground) |
| paper (panels) | #FFFBF0 | decided: a lighter sheet of the same paper |
| ink (text, outlines, offset shadows) | #23303B | brief: Visual design (dark slate ink) |
| muted text | #4A5864 | decided: one step lighter slate, 6.44:1 on ground |
| accent (lantern yellow: primary actions, own avatar base, exit tiles) | #F2B632 | brief: Visual design (one lantern yellow) |
| danger (brick red: safety actions and refusals) | #A8392B | brief: Visual design (brick red reserved for safety) |
| calm (muted teal: confirmations, Earshot Ripple) | #25675F text, #3F9086 tiles | brief: Visual design (muted teal) |
| floor tiles | #F1E6C8 and #E8DAB4 | brief: 3D scene (two close shades) |
| walls, stools | #B7A58A, #D9B98C | decided: kraft paper |

Focus is a 3px solid ink outline with a 3px offset (brief: Visual design: thick ink outline).

## Type, space and layout

- Headings use the built-in serif stack (`Georgia, "Iowan Old Style", "Palatino Linotype", "Times New Roman", serif`) and body the
  built-in sans-serif stack (`system-ui, ...`), no downloaded fonts; levels are 1.728rem, 1.44rem, 1.2rem, 1rem, each one fifth
  larger than the next (brief: Visual design).
- Panels and buttons: 2px ink border, 14px radius, hard offset shadow `4px 4px 0 0` with no blur, every control at least 44 px
  (brief: Visual design, Density).
- Room page arrangement (brief: Screens and layout): 1280x800 three columns, people list left (room features below it),
  canvas centre with direction buttons below, chat right; 768x1024 canvas on top, buttons under it, then people list left and
  chat right; 375x812 canvas, buttons, `button "People and chat"`, with people, features and chat in the sheet. Breakpoints:
  phone below 700px, tablet 700 to 1099px, desktop from 1100px (decided: the three published viewports fall cleanly into them).
  `status "Room announcements"` is outside the sheet at every viewport.
- No screen scrolls sideways at 375, 768 or 1280 (brief: Screens and layout); tables of members and reports stack at phone width.

## Motion table

| Element | Trigger | Duration and easing | Reduced-motion substitute | Source |
|---|---|---|---|---|
| Button press | pointer down | 100 ms ease-out, transform and shadow | none | brief: Motion (press feedback about a tenth of a second) |
| People-and-chat sheet in | open | 280 ms settling cubic-bezier | opens at once | brief: Motion (under a third of a second) |
| Sheet out | close | 250 ms | closes at once | brief: Motion (about a quarter of a second) |
| Avatar glide | a move | 200 ms ease-out (rAF, only while moving) | jumps | brief: Motion (about a fifth of a second) |
| Camera follow | own move | 400 ms ease-out | cuts | brief: Motion (under half a second) |
| Earshot Ripple | Send accepted | radius +1 per 60 ms to 6, held 500 ms (page timers) | static outline, `data-ripple="outline"`, radius 6, held 2000 ms | brief: Earshot Ripple |
| Idle | nothing changes | none, the scene holds still | none | brief: Motion (idle) |

`data-motion` is `reduced` when the person's system asks for it, including a change made while the page is open.

## States per async action (brief: Feedback states, verbatim)

| Action | Region | Pending | Success |
|---|---|---|---|
| Sign up | `status "Account result"` | `Sending...` | `Check your email to confirm your account.` |
| Sign in | `status "Account result"` | `Signing in...` | goes to the intended page |
| Open or join | `status "Session result"` | `Opening...` | goes to the room |
| Chat | `status "Chat result"` | `Sending...` | `Heard by N.` |
| Upload | `status "Upload result"` | `Checking your file...` | `Rank: <rank>. Worst measure: <measure>.` |
| Publish / restore / remove | `status "Version result"` | `Saving...` | `Version <n> published.` / `Version <n> restored as version <m>.` / `Version <n> removed.` |
| Block, mute, hide | `status "Safety result"` | `Saving...` | `Blocked.`, `Unblocked.`, `Muted.`, `Unmuted.`, `Avatars above <rank> are hidden.`, `All avatars are shown.` |
| Vote | `status "Vote result"` | `Saving...` | `Vote counted.` |
| Report | `status "Report result"` | `Sending...` | `Report sent.` |
| Move a report | `status "Moderation result"` | `Saving...` | `Report moved to <state>.` |
| Role, remove member | `status "Community result"` | `Saving...` | `Role changed.`, `Member removed.` |
| Schedule, attend | `status "Gathering result"` | `Saving...` | `Gathering scheduled.`, `You're attending.`, `You're no longer attending.` |
| Send an invite | `status "Invite result"` | `Sending invite...` | `Invite on its way.` |

A refusal shows its exact server text in the same region and is never overwritten by a later repaint. Outage texts
`Live rooms are unavailable right now.` and `File storage is unavailable. Nothing was saved.` also appear in `alert`.
Denied headings: `This session isn't available.`, `This invite isn't available.`, `This link isn't available.`, `Page not found.`

## Backend facts the app holds to

- Error order 401, 404 (never 403), 409, 422, 429 with `{"error": ...}`; a state-changing request or upgrade with a foreign
  `Origin` answers 403 first; JSON bodies up to 64,000 bytes (setup 1,000,000, uploads 51,000,000), then 413.
- Ranks, measures, vote thresholds, chat reach (Chebyshev 6), gathering times and daylight-saving notes are each decided in
  one module (`rank.ts`, `votes.ts`, `chat.ts`, `zones.ts`/`gatherings.ts`) exactly as in Business rules.
- Valkey keys: `presence:<personId>`, `session:<sessionId>:positions`, channel `session:<sessionId>:events`; MinIO key
  `assets/<assetId>/v<version>.glb`.

## Breakpoints and media

- Breakpoints: 375, 768 and 1280 are the published viewports; 320 must not overflow (decided: reflow rule).
- Media: no raster images, fonts, audio or video. The lantern and the mini room are original inline SVG; icons are inline
  SVG paths from Lucide (ISC); the 3D room is drawn live with three.js (MIT); seed GLB models are generated by the app
  (licence `original`). Nothing is fetched from outside at run time (brief: Same origin).
