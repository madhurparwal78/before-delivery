# TRUTH — Pinbyte Switchyard golden

Ground truth of the app in `app/`. Each value says where it came from: `brief: <section>` (copied from `instruction.md`) or
`decided: <why>` (the brief is silent; the reason ties it to the brief's intent).

## Journeys (start state, actions, visible end state, provider-recorded end state)

1. **Build by keyboard and publish.** Start: signed-in owner on `/w/<ws>` with no automation. Actions: `New automation` (Enter) → dialog, name, trigger
   `Form`, `Create automation` → editor; cursor focus, `S`, `Escape`, `ArrowRight`, `E`; focus a step, `C`, `ArrowRight`, `Enter` twice to wire
   trigger → set → email; `Enter` on each step opens its dialog (focus on `Step name`), fields save on blur, `Escape` returns focus; `Publish`.
   End: `Version 1 published` in `status "Run updates"`, `data-live-version="1"`. A visitor opens `/forms/<slug>/<path>`, fills the field, `Submit`
   → `Thanks, your response was received.`; the run detail shows every step `succeeded` with its output (brief: Journeys 1); Mailpit holds the email
   with the templated subject, `X-Switchyard-Run: <run id>` and the run id in the body (brief: DP-05).
2. **Wait, cancel and resume.** Two runs sit in a wait step (`waiting`, due time in the workspace zone); one is cancelled by keyboard (Enter/Space on
   `Cancel run`) → step `cancelled`, later steps `skipped`, run `cancelled`; the grading clock advances past the due time → the other run `succeeded`;
   the cancelled run never resumes; a collaborator's `/runs` list changes without reload (brief: Journeys 2, DP-22 to DP-26).
3. **Retry and error path.** A call-webhook step to a missing hook shows `retrying` (log `Attempt 1 of 3 failed: Webhook answered 404`, `Retry at`)
   while the clock moves 30 workspace seconds per attempt, then follows its `error` edge to a send-email step (run `succeeded`, step stays `failed`) or fails the
   run with `Step s1 failed after 3 attempts: Webhook answered 404` (brief: Retries, DP-27 to DP-31).
4. **Replay.** On a failed run choose `Replay from` a step at or before the failed one, `Replay`; the page lands on `/w/<ws>/runs/<new id>`, earlier
   steps `data-reused="true"` with log `Reused output from run #<n>`, Mailpit receives no second email (brief: Replay, DP-61 to DP-65).
5. **Publish while runs are asleep.** Publishing v2 while a v1 run waits: numeral steps `v1` → `v2`, `data-drain-count="1"` and
   `Runs left on older versions: 1`; the old run finishes on version 1 when the clock advances; counter `0`, ghost edges and token gone (brief: DP-47 to DP-51).
6. **Two editors, one draft.** Both see `<name> is also editing this draft`; B saves `Seconds`, A's save is refused with
   `<B> is editing Pause. Your change was not saved.` and shows B's value; after `EDIT_HOLD_SECONDS` of workspace time A's save wins and B sees it in place (brief: DP-52 to DP-56).
7. **Webhook intake and schedules.** `POST /hooks/<slug>/<path>` with an `Idempotency-Key` twice → one run (second answers 200 `replayed:true`); schedules fire as the
   clock advances (spring-forward `daily at 02:30` fires at 07:30Z then 07:00Z; fall-back `daily at 01:30` fires once at 05:30Z); times read in `America/New_York` as
   `YYYY-MM-DD HH:mm:ss EDT` (brief: Schedules, Webhook trigger, DP-37 to DP-46).
8. **Owner tasks and viewer limits.** Owner exports (the object `exports/<ws>/<aid>/v1.json` holds exactly the downloaded bytes), imports (object `imports/<ws>/<im>.json` byte for byte, new draft, lands on its
   editor with `Import saved. This is a draft.`), invites a viewer (Mailpit link `/invite/<token>`); the viewer joins, sees disabled controls with description
   `Viewers cannot change this workspace`, and meets `We couldn't find that page` for another workspace's address (brief: Journeys 8).

## Palette (hex the build uses)

| Role | Hex | Source |
|---|---|---|
| ground | #FAFAFA | brief: Colour roles · seed inventory |
| surface-light | #F0F0F0 | brief: Colour roles |
| surface-dark | #212121 | brief: Colour roles |
| node | #333333 | decided: seed inventory node fill |
| ink / on-dark | #161616 / #FAFAFA | brief: Colour roles |
| muted / muted-on-dark | #5A5A5A / #B5B5B5 | decided: AA on both surfaces |
| accent | #FF91AC | brief: soft pink |
| neutral | #D9D9D9 | brief: secondary pills |
| danger | #A3241B | decided: AA red |
| chips | succeeded #BFE8C8, failed #FFC4C4, waiting #FFE29A, running #BFD9F5, retrying #FFD2A3, quiet #E3E3E3 | decided: chips carry the word |

## Type, space, layout

Fonts Bricolage Grotesque (display), Schibsted Grotesk (body, tabular figures), JetBrains Mono (uppercase pill labels, nav, template code): brief: Type.
Sizes 16 body; headings 20/25/31/39 (a quarter step); landing headline 64 at every viewport (four times the body; at 375 its words wrap within the gutter): brief: Type. Spacing 4/8/16/32: brief: four-step scale.
Gutter 48 / 24 / 16 at 1280 / 768 / 375: brief: Density. Breakpoints `CANVAS_BREAKPOINT_PX` (720 default, from the server) and 1024 split: brief: Screens and layout.
Canvas: 24 columns × 12 rows (brief: Canvas keyboard table); square step nodes, each about two thirds of a grid cell, 96 pixels square, so cells are 144 px square at every viewport (brief: Working screens); the 3456 × 1728 px grid scrolls inside the canvas panel and the panel follows the grid cursor (decided: the grid is larger than any viewport and the page must not scroll sideways).

| Screen | 1280x800 | 768x1024 | 375x812 |
|---|---|---|---|
| Landing | release bar, pill nav, centred stack, frame, four cards in one row, story cards, footer | same, single column | bar wraps to two lines, nav logo + Menu, cards scroll inside their box |
| Editor | toolbar column at canvas left edge | toolbar row above canvas | `list "Steps"` replaces canvas and toolbar |
| Run detail | summary left third, canvas right three fifths | summary above full-width canvas | summary above `list "Steps"` |
| Runs | filters in one row | one row | stacked |
| Members | table and invite form side by side | stacked | stacked |

(all: brief: Screens and layout)

## Motion

| Element | Trigger | Duration, easing | Reduced-motion substitute | Source |
|---|---|---|---|---|
| headline letters | page load | 300ms steps(4), 30ms stagger | all visible at once | brief: Motion |
| preview frame diagram | last letter lands | fade 300ms, completes ~600ms after the headline | shown at once, tabs enabled | brief |
| tab swap | tab choice | crossfade 300ms | instant | brief |
| hover/press | pointer | 150ms colour, scale 1.03 / 0.98 | no scale | brief |
| edge draw-in | edge added (own or pushed) | 600ms steps(4), `data-anim` running → none | drawn, `data-anim` none | brief |
| running step | status running | pulse 1000ms steps(4) | none | brief |
| version numeral | publish | digits step down 320ms each, 30ms apart | final at once | brief |
| run token | run moves | 300ms steps(4) | none | brief |
| expander body | open | opacity 300ms | instant | brief |
| panels | enter viewport | fade + 16px rise, once | visible | brief |

## States per async action

| Action | Pending | Success | Failure |
|---|---|---|---|
| any button request | `aria-busy="true"`, disabled, `Working...` | action-specific | refusal verbatim in the owning region |
| export | Notices `Saving export...` | download + `Export saved` (only after storage confirms) | alert `Storage is unavailable. Nothing was saved.` |
| import | Notices `Saving import...` | editor with `Import saved. This is a draft.` | refusal verbatim, or the storage alert |
| sign-up / invite | busy | `Check your email to confirm your account` / `Invite sent to <email>` | alert `Email is unavailable. Your account was not created.` / `... The invite was not sent.` |
| publish | busy | `Version <n> published`, numeral steps | Draft notices verbatim, focus to the named step |
| live stream drop | n/a | Notices clears on reconnect and pages refetch | Notices `Live updates paused. Reconnecting...` |

(all: brief: Feedback states)

## Media and licences

No image, audio, video or model files ship. Icons, example graphs, pixel icons, lattices and marks are drawn in code (`original`).
Fonts: three Fontsource variable woff2 files, OFL-1.1, listed in `app/assets.json` and `THIRD_PARTY_NOTICES.md` (decided: brief requires bundled fonts).
