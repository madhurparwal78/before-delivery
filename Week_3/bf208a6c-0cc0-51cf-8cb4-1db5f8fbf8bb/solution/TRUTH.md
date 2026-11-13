# TRUTH — Pinsheet golden

Every value says where it came from: `brief: <section>` (copied from the brief) or `decided: <why>` (the brief is silent; the reason ties it to the brief's intent).

## Journeys

1. **Rearranging by keyboard** (brief: Journeys 1; Interactions, Moving by keyboard).
   - Start: owner has the board open in columns layout; a contributor watches it in another browser.
   - Actions: the owner tabs to a frame, Space picks it up (`Picked up <title>. <section>, position <p> of <n>.`, `data-moving="true"`, focus stays on the frame), ArrowDown steps within the section (`<title>: <section>, position <p> of <n>.`), ArrowRight steps to the next section at the same position number clamped to one past its last post, Space drops and saves.
   - End: `Dropped <title>: <section>, position <p> of <n>.` is announced after the server saved; focus is still on the frame; `GET /api/boards/<id>/posts` and the contributor's screen show the same order without reload; the post's `version` rose by one.
2. **Three people posting at once** (brief: Journeys 2).
   - Two contributors open Add post, type a title and submit with Ctrl+Enter or `Post`; the phone user taps Add post (a bottom sheet), taps `Attach a file`, picks a photo and taps Post (`Uploading <file name>…` is announced first).
   - End: every screen lists the three frames in the server's commit order; each screen hears `<name> added <title>.` for the others' posts; the photo frame appears once MinIO confirmed the object at `boards/<board id>/posts/<post id>/<attachment id>`.
3. **Reading in the loupe** (brief: Journeys 3; Frontend, Loupe lift).
   - Enter on a frame grows that same element to four times its height (448px) in 280ms, neighbours dim to .56 and glide, focus moves to its level-2 heading. The contributor comments (Enter sends) and then moves the post.
   - End: the viewer's loupe lists the comment and stays open on the post at its new place; `<title> moved to <section>, position <p> of <n>.` is announced; Escape closes it and focus returns to the frame.
4. **Approval** (brief: Journeys 4; Business rules, Post states).
   - Approval on: a contributor's post is held (`Sent <title> for approval.`), shown only to its author in `Waiting for approval` and to moderators/owner in `Approvals`; exactly one ntfy message goes to `pinsheet-approvals-<board id>` with title `Post waiting on <board title>` and message `<post title>`.
   - The moderator approves by keyboard; focus moves to the next held post's Approve button or the `Approvals (<n>)` heading; the post appears last in its section on every screen and the author hears `Your post <title> was approved.`
5. **Inviting and demoting** (brief: Journeys 5).
   - Owner opens Members, enters an email and role, presses Enter: the invite arrives in Mailpit (subject `<inviter> invited you to <board title> on Pinsheet`); `Invite sent to <email>.`. The invitee signs up, confirms the 6-digit code, opens the invite link and joins.
   - Owner changes the role to Viewer: the invitee's open tab loses Add post and the comment box live and hears `Your role on <board title> is now Viewer.`; the next post attempt answers 403.
6. **Privacy and links** (brief: Journeys 6).
   - A stranger opens the share link of a password board: password screen (page status 200), a wrong password shows `That password didn't open this board.`, the right one opens the board for the browser session (cookie `pinsheet_pass`, HttpOnly, no expiry). The owner rotates the link: the stranger's open screen turns into `Board not found`; the old link answers 404.
7. **Embed on a phone** (brief: Journeys 7).
   - The embed shows published posts only, stacked one section per row, frames tabbable, Enter opens a read-only loupe. A post added by the owner appears and a deleted post leaves, live; the deleted post's attachment URL answers 404.
8. **Presenting and exporting** (brief: Journeys 8).
   - Owner sorts by Most liked, presses Present: `Post <k> of <n>`, arrow keys step, a moderator deletes a post and the count drops live, Escape returns focus to Present, Export CSV downloads published posts in displayed order with `'`-neutralised cells.

## Palette roles (hex values the build uses)

| Role | Hex | Source |
|---|---|---|
| ground | #EFE7D3 | brief: Visual design (warm light sand); hex decided |
| surface | #E2D6BB | brief: Visual design (slightly deeper sand); hex decided |
| ink (also the landing field) | #23271C | brief: Visual design (near-black olive grey); hex decided |
| muted | #5A5039 | brief: Visual design (dark grey-brown); hex decided |
| accent (moss) | #47662A | brief: Visual design; hex decided |
| accent pressed | #365020 | brief: Motion (darkens a step); hex decided |
| on accent | #FFFFFF | brief: Visual design |
| danger (text only) | #8B2E1E | decided: errors need their own hue; AA on ground and surface |
| focus ring | #47662A (#8FB35A on the landing field) | brief: Interactions (moss-green focus ring) |

## Type

Work Sans, bundled (latin and latin-ext variable woff2, OFL-1.1): body 15px/20px weight 400, titles 600 at the body size, small 13px/16px, notch 19px/24px only for the landing sentence and the loupe heading (brief: Visual design: "Only the landing sentence and the loupe heading step up one notch"); the slide title is a title at the body size, weight 600 (brief: Visual design; sizes decided).

## Space and layout per viewport

| Viewport | Layout | Source |
|---|---|---|
| 375 x 812 | one section per row, the frames of a section share the full width, Add post pinned to the bottom edge (56px), Add post opens as a bottom sheet, embed stacks, margin 16px | brief: Frontend (Arrangement by viewport) |
| 768 x 1024 | columns layout shows two sections per row | brief: Frontend |
| 1280 x 800 | up to four sections side by side, more than 24 frames visible, margin 24px | brief: Frontend |
| rows layout | each section is a full-width titled run, frames wrap | brief: Frontend |

Frame: 112px high (art 72px + 40px title band), 136px wide (images keep their natural width between 88px and 224px); gaps 8px between frames and 16px between sections, outer margin 24px; radius 0; no shadows (decided numbers; brief: Visual design).

## Motion table

| Element | Trigger | Duration | Easing | Reduced-motion substitute | Source |
|---|---|---|---|---|---|
| frame and its neighbours | drop, live move, new or removed post | 220ms | cubic-bezier(.2,.8,.2,1) | frames jump | brief: Motion (150 to 300) |
| loupe frame (scale from the old size to the new one; layout is final at once) | Enter, click or tap; Escape, Close | 280ms | same | opens and closes at once, full size | brief: Motion (200 to 360) |
| neighbours of the loupe | loupe opens or closes | 280ms opacity to .56 | same | static dim, no fade | brief: Motion |
| Add post dialog | open and close below 768px | 280ms slide from the bottom | same | appears in place | brief: Motion (200 to 360) |
| slides | next, previous, swipe | 350ms, out to the left and in from the right, reversed going back | same | swap at once | brief: Motion (250 to 450) |
| landing strip frames | hover or focus | 200ms opacity | ease-out | none | brief: Motion (about a fifth of a second) |
| buttons | pressed | instant darker moss | none | same | brief: Motion |

## States per async action

| Action | Pending | Success | Failure |
|---|---|---|---|
| Post | `Posting…`, dialog open, `Uploading <file name>…` announced first | `Posted <title>.` (or `Sent <title> for approval.`), dialog closes, focus on the new frame | dialog `alert` and field messages, everything typed kept (`Give your post a title.`, `Titles can be at most 80 characters.`, `Text can be at most 2,000 characters.`, `<file name> is over the <limit> byte limit.`, `<file name> isn't a PNG, JPEG, GIF, WebP, PDF or plain-text file.`, `Uploads are unavailable right now. Your post was not saved.`) |
| Send comment | `Sending…` | box empties and keeps focus; loupe lists it | `Write a comment first.` / `Comments can be at most 500 characters.` under the box |
| Move | frame shows at its target | `Dropped …` after the server saved | `<name> moved <title> first. It is now in …` (409) or the blocked line |
| Create account / Confirm email | button busy | code step `We sent a 6-digit code to <email>.`, then dashboard | field messages; `We can't send your code right now. Try again in a few minutes.` (503) |
| Send invite | `Sending…` | `Invite sent to <email>.` in `status "Invite status"` | field messages; `Invites can't be sent right now. Try again in a few minutes.` |
| Storage / push down | moss `region "Service notice"` band within 12s | back to empty when the service answers | n/a |

## Breakpoints

Columns layout uses as many sections per row as fit at 280px each, up to four (so 2 at 768 and 4 at 1280); 767px and below (Add post pinned, bottom sheet), 639px and below (16px margin, stretched frames) (decided around the brief's 375, 768 and 1280).

## Media and licences

- Work Sans woff2 (OFL-1.1) from `@fontsource-variable/work-sans` 5.3.0, listed in `assets.json`.
- Lucide icons (ISC) through `lucide-react` 1.69.0, inlined as SVG.
- Procedural photo-like fields: drawn in code, licence `original`.
- Every package is MIT, ISC or Apache-2.0 (see `THIRD_PARTY_NOTICES.md`).

## Services and what lands in them

- Postgres: accounts, codes, boards, sections, members, posts (position, version), likes, votes, comments, invites, unlocks, link tokens, the event log, pending object removals. Counts are queries over these rows.
- MinIO: `boards/<board id>/posts/<post id>/<attachment id>`, put before the post commits, removed when the post or board is deleted (retried every 10s).
- SMTP: `Your Pinsheet code` (`Your Pinsheet code is <code>.`) and the invite mail; 503 and nothing stored when the server cannot accept it.
- ntfy: one message per held post, retried every 10s until it answers 200; `Push pending` meanwhile.
