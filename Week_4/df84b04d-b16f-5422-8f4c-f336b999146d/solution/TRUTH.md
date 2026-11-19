# TRUTH

Source key: `brief: <section>` is copied from `instruction.md`; `decided: <why>` is where the brief is silent.

## Journeys (ideal end-to-end)

1. **Sign up and build by keyboard.** Start `/` signed out. Click `Start your outline` (brief: Journeys 1) to `/signup`. Empty submit shows `Enter your name.`, `Enter a valid email address.`, `Use at least 10 characters.` inline. A valid submit shows button `Sending` (disabled, aria-busy) until Mailpit accepts; then status `We sent a 6-digit code to <email>.` and the code step. Mailpit holds one message, subject `Your Twigline code is NNNNNN`, body with `15 minutes`. A wrong code shows `That code doesn't match. Check the latest email.`; the right code opens Home with `Your outline is empty. Start with one thought.` and `Add first bullet`. Enter, Tab, Shift+Tab and ArrowUp/Down build a three-level plan; after reload depths match (`data-depth`). Server state: accounts row confirmed, bullets rows with parent and position.
2. **Restructure.** As Wren: Ctrl+ArrowUp on `Tomatoes #seedlings` announces `Moved to position 4 of 4 under Site prep #soil`; Tab/Shift+Tab indent and outdent with published announcements; Ctrl+Space collapses (saved per placement); Alt+ArrowRight zooms (`/b/<id>`, title, crumb, focus in `Branch title`); Ctrl+Enter completes; Hide completed announces `3 completed bullets hidden`. A second tab updates within two seconds through the Valkey stream.
3. **Mirror, delete, undo.** Ctrl+Shift+M places a copy directly below (`data-mirror-of`). Editing through the copy changes the original everywhere. Deleting the original moves it to trash and every copy shows `This bullet was deleted.`; Ctrl+Z restores the same ids and copies show text again.
4. **Search.** `#soil` gives `3 matching bullets`; `@mira` 2; `has:date -is:complete` 2 (shown inside a collapsed parent); clearing restores the outline.
5. **Board.** `?view=board` shows columns `Site prep #soil` (3), `Planting plan` (3), `Volunteers` (2). Pointer drag, or Space, arrows, Space with the published announcements; Escape cancels.
6. **Share.** Share dialog sends the invitation; the row reads `Sending` then `Sent` only after Mailpit accepted; the emailed `/invite/<token>` link signs in, accepts and lands on the shared bullet as the top of the view. Stale saves answer 409 and the loser sees `<name> changed this bullet first. Their text is shown; your edit was not saved.` Removing access shows `This branch is no longer shared with you.` and every outside id answers 404.
7. **Phone and download.** At 375x812 the Bullet actions toolbar is pinned to the bottom with 44px targets; swipes of at least 48px indent and outdent; downloads are `twigline-<slug>.<ext>`.

## Palette (hex used by the build)

ground #FFFFFF, band #F3F4F4, ink #2A3135, muted #4B5155, quiet #666D71 (decided: seed #868C90 fails AA), hairline #DCE0E2, accent #0B79B8 (decided: seed #49BAF2 gives 2.2:1 with white), accent hover #08669D, chip #F1F2F3, add glyph #B7BEC2 (brief: Visual design; see DESIGN.md Palette).

## Type, space, layout

Noto Sans for page text, Inter for bullets, breadcrumb, board cards and invitation rows (brief: Visual design). Hero 48px/700 (28px phones), section headings 32.4px, lead 22.8px, rows 15px/29px (44px on touch). Indent 24px per level; column 1216px; top bar 64px sticky. Breakpoints: 640px menu button and stacked hero pills; 480px phone toolbar, 44px targets, search on its own line; 768px two cards per row (decided: auto-fit grid with a 300px minimum).

## Motion table

| Element | Trigger | Duration, easing | Reduced motion |
|---|---|---|---|
| Hover and press | pointer | 150ms ease | none |
| Zoom title | zoom in | 150ms ease-out, FLIP | swap |
| Zoom children | zoom in | 150ms each, 40ms stagger for 12 rows (brief: Motion); slide ease-out curve, fade ease-out over the full 150ms (decided: each child visibly lands after the one above) | swap |
| Crumb | zoom | 150ms slide | none |
| Nest it | button | 150ms each, 40ms stagger, timers | instant |
| Hero typing | in view | 30-60ms per character, caret 1.06s while typing | finished list at once |
| Collapse | toggle | 150ms height; expand 150ms clip reveal | instant |
| Segment pill | tab | 150ms | none |
| Board parting | drag | 150ms | none |

## States per async action

Sign-up code: Sending, then code step, or alert `We couldn't send your code right now. Try again in a minute.` on 503. Invitation: Sending, Sent, Not sent with Retry and alert. Saves: optimistic, ordered queue; failure shows `Couldn't save your last change. Retrying when the connection returns.`. Loading: three rows of grey dots. Not found: `We couldn't find that bullet`. Live sync paused: banner with `Reload branch`.

## Media and licences

No pictures. Two self-hosted font families (OFL-1.1, in `assets.json`), icons drawn inline (original). Packages are listed in `THIRD_PARTY_NOTICES.md`.
