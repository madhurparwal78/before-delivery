# TRUTH — Moothall, the golden's ground truth

Every value says where it came from: `brief: <section>` (copied from `instruction.md`) or `decided: <why>` (the brief is silent).

## Journeys (ideal end-to-end flow)

1. **Join the conversation** (brief: Journeys 1). Visitor on a 375 px phone opens `/signup`, types email, username, password with Tab between fields, presses Enter or "Create account". Button reads `Creating account...`; the screen becomes heading `Check your inbox` with `We sent a confirmation link to <email>.` The session is set (unverified) and Mailpit holds `Confirm your Moothall email` with a `/verify?token=` link. An upvote announces `Verify your email to vote`, `aria-pressed` stays false, no `votes` row. Opening the link shows `Checking your link...` then `Email confirmed`; the next upvote sets `aria-pressed=true`, the score +1, announces `Upvoted. Score <n>`; one `votes` row (value 1) exists.
2. **Read and vote** (brief: Journeys 2). Hot/New/Top tabs move with arrow keys (automatic activation) and write `?sort=`; `Load more posts` appends 25 more and focuses the first new card; `j`/`k` move between cards; `a` upvotes, `z` downvotes, pressing again undoes. Score reads the same on card, community feed and post page; a second member's tab updates within 3 s via the `score` event.
3. **Post with images from a phone** (brief: Journeys 3). Six images attach (each uploads at once, tile text `Uploading image <n>` then `Image <n> uploaded`), move buttons swap tiles and keep focus on the moved tile's button, alt text, spoiler checkbox, `Post` pressed twice sends one Idempotency-Key and creates one post. Stored WebP at 320/640/1080 plus original, no EXIF. Readers see blurred images until `Show spoiler`, then swipe or use arrows.
4. **Follow a long thread** (brief: Journeys 4). Depth-12 thread shows 8 levels (5 at 375 px) with `Continue this thread`; fold rail folds a branch into a pill with the server's descendant count and focus on the pill; replying at the deepest level navigates to the continue page rooted at the parent, new reply focused and highlighted. A second tab sees the reply (or the pill count rise) with `New reply from <username>`, focus unmoved.
5. **Moderate a post while others watch** (brief: Journeys 5). `Moderator actions` → `Remove post` dialog; rule radio, private note, `Remove`; announces `Post removed`; the author's tab shows `Removed by moderators: <rule title>`; the reader's card disappears with `Post removed by moderators` and focus moves to the next card; the author gets the statement-of-reasons mail without the note; the public mod log shows the removal and reason, no note.
6. **Lock, pin and race** (brief: Journeys 6). `Lock thread` 1 hour: watchers lose reply controls and see `Locked by moderators` and `Replies reopen <time>`; the server's clock ends the lock and emits `post-state` so the box returns whatever the device clock says. Pinning a third post opens `Replace a pin`. Two simultaneous moderator actions: one wins, the loser gets 409 `CONFLICT`, announces `Another moderator acted first` (alert), shows the current state, and leaves no mod log row.
7. **Run the team and stay secure** (brief: Journeys 7). A moderator of a community above `MOD_2FA_MEMBER_THRESHOLD` members is sent to `/settings/2fa?next=…`, reads `#totp-secret`, enters a code, sees `Two-factor authentication is on`, returns to `next`. Removing a moderator removes `Moderator actions` within 3 s with `Moderator tools removed`. Repeated wrong passwords lock the account (429, owner mailed once); a reset link sets a new password once and ends every session.
8. **Report illegal content** (brief: Journeys 8). Visitor: `More actions` → `Report illegal content`, dialog filled by keyboard, `Send report`; heading `Report received`, `Your reference is MH-XXXXXXXX`, announcement `Report sent. Reference <reference>`, confirmation mail. Admin queue shows `Due in <h> h <m> min` computed by the server and `Overdue` after the deadline; `Suspend <username>` signs the author's open tab out within 3 s with `Your account has been suspended`.

## Palette roles (brief: Visual design; hex decided in DESIGN.md)

| Role | Hex | Source |
|---|---|---|
| ground (warm off-white newsprint) | `#f7f1e5` | brief: Colour roles; decided hex |
| panel (dialogs, fields, menus) | `#fffaf0` | decided: lighter sheet of the same paper |
| ink (near-black) | `#1d1915` | brief: Colour roles; decided hex |
| muted | `#5e564b` | decided: 6.4:1 on ground |
| hairline (warm grey) | `#d9cfbd` | brief: Colour roles |
| accent (burnt orange; upvote, focus ring, live glow) | `#c2500f` | brief: Colour roles |
| accent-ink (orange as small text and primary button fill) | `#a8400a` | brief: darkened for 4.5:1 |
| cobalt (downvote) | `#2f4c9e` | brief: Colour roles |
| danger | `#9f1f1f` | decided: errors, always with words |

## Type, space, layout

- Display Bricolage Grotesque, body Atkinson Hyperlegible 18 px / 1.5, every score, count and time in Atkinson Hyperlegible Mono with tabular numerals; headings step ×1.2 (brief: Type). All three bundled woff2, OFL 1.1.
- Spacing scale 4/8/12/16/24/32/48, radius 2 px, 1 px hairlines, `3px double` under the masthead (brief: Mood; decided scale).
- 1280×800: rail 240, feed 680, sidebar 280. 768×1024: rail 200, sidebar under the header. 375×812: rail is a drawer (`Communities` button, `aria-expanded`, closed and `inert`), vote bar horizontal under the post (brief: Layout by viewport). Between 1024 and 1279 px the feed narrows. 44 px touch targets (brief: Density).

## Motion (brief: Motion and effects; durations decided within the brief's limits)

| Element | Trigger | Duration | Easing | Reduced motion |
|---|---|---|---|---|
| score digits | score changes | 180 ms WAAPI translateY + opacity | `cubic-bezier(0.2,0.8,0.2,1)` | instant |
| dialogs, menus, toasts | open | 160 ms CSS keyframes (rise 6 px + fade); leave instant | same | none |
| vote buttons | press | 90 ms scale 0.9 | same | none |
| fold rail | fold/unfold | 3 steps, 340 ms total, transform and opacity only | same | instant, same focus moves |
| live reply | arrives in open branch | 300 ms grow-in + 1200 ms rail glow | same | static `New` tag until focus or scroll past |
| folded pill count | live reply in folded branch | 180 ms roll | same | instant |
| drawer | open | 200 ms | same | none |

Nothing repeats forever. Toast lifetime 5 s, glow, reconnect and admin refresh run on page timers.

## States per async action (brief: Feedback states, verbatim)

Vote: optimistic, rollback with `Slow down — try again in <n> s` / `Verify your email to vote` / `Sign in to vote` / `This thread is archived. Voting and replies are closed.` / `Vote didn't save`. Sign-up, sign-in, reset, 2FA, publish, upload (`Image uploads are unavailable right now. Your draft is kept.`), edit, delete, comment, moderator actions, create community, report, suspension and live stream each use the exact copy of the brief's table; pending labels `Creating account...`, `Signing in...`, `Sending...`, `Posting...`, `Saving...`, `Creating...`. Empty feed: `Join a community to fill your home feed`; end: `You've reached the end`.

## Breakpoints (brief: Layout by viewport)

375, 768, 1024–1279, 1280.

## Media and licences

No photographs or illustrations. Icons are drawn inline SVG (`original`). Fonts: Bricolage Grotesque, Atkinson Hyperlegible, Atkinson Hyperlegible Mono from Fontsource 5.3.0, OFL-1.1, listed in `app/assets.json` and `app/THIRD_PARTY_NOTICES.md`.
