# Stillhour golden: ground truth

The ideal flow of every journey in the brief, as the golden app implements it. Each value is marked
`brief:` (copied from instruction.md) or `decided:` (the brief leaves it open; the reason follows).

## Journey 1: walk the evening and plan an hour

1. `/` opens on the gate: `dialog "Stillhour"`, the crescent mark tracing its circle, `progressbar
   "Gathering the evening"` with "<n>%" (brief). Progress counts the three font faces (Fraunces normal and
   italic, Hanken Grotesk), the four sound files, the film poster and the six scenes compiled (brief:
   fonts, audio, poster, textures; decided: scene compilation is the app's "textures the app draws"
   step). The circle's drawn share is that same progress (decided: the trace reports real loading, so
   nothing loops). Scroll is locked (decided: `overflow: hidden` on the root
   plus Lenis stopped).
2. At 100% the two buttons appear (brief) and focus moves to "Begin the hour", or "Begin in silence"
   when this browser last chose silence (brief). The gate fades in 640 ms (brief: about two thirds of a
   second) and focus moves to the hero heading (brief) the moment the choice is made, while the fading
   gate already lets clicks through (decided: focus never lands on something hidden, and the fade never
   covers or delays a control).
3. The hero title "Give your last hour a shape." reveals letter by letter in about 1.4 s (brief: under
   two seconds); its accessible name stays exact through `aria-label` (brief).
4. Scrolling moves the story clock from 21:00 by `floor(page fraction × 60)` minutes (brief). The city
   counter reads 4,096 to p = 0.18, then `round(4096 − 4095 × (p − 0.18) / 0.64)`, and 1 from p = 0.82,
   with captions at 0.40 and 0.82 (brief). p is the window progress: 0 when the window's top is at the
   top of the screen, 1 when its bottom is at the bottom (brief).
5. "Breathe with me" runs 4 / 7 / 8 seconds × 3 rounds with "Round r of 3" (brief); "Stop" ends it. The
   counter always shows (brief: chapter three lists "the round counter"; decided: "Round 1 of 3" at rest and
   after Stop, "Round 3 of 3" once done).
6. In chapter four the visitor adds three rituals; each toggle announces "<title> added. <total> of 60
   minutes planned." in `status "Ritual updates"` (brief) and the address becomes
   `/?rituals=<id>:<minutes>,…` in the order added, replaced without a history entry (brief).
7. "Play the film" opens `dialog "One still hour"`; the film plays (not under reduced motion, brief).
8. In the planner they type an email (bedtime starts at 23:00 and the time zone at the browser's zone,
   brief), press "Save my hour" twice: the button is disabled while pending, one Idempotency-Key covers
   the exact field values (brief), so one draft and one "Confirm your Stillhour" email (brief).
   `status "Planner status"` reads "Check your inbox. We sent a link to confirm your hour." (brief).

## Journey 2: confirm the hour

The email link `<origin>/signin?token=c-…` (brief: `/signin?token=<token>`; decided: `c-` and `s-`
prefixes tell a confirmation link from a sign-in link, because the verify reply is identical for both
when the address already has an hour). `/signin` checks the token once on load, has a single "Manage my hour" link and no site footer (brief), and shows "Your
Stillhour is confirmed. Reminders are on." (brief). The live count is one higher on the next load; Manage
my hour shows the hour and "Next reminder: <weekday> <day> <month> at <time> (<zone>)" in the hour's zone
(brief).

## Journey 3: the nightly reminder

Due at bedtime − 60 minutes in the hour's zone; spring-forward gaps move to the first valid minute,
fall-back repeats use the first occurrence; one "sent" or "skipped" record per hour and night; more than
60 minutes late is skipped (brief). The scheduler runs every 15 s (brief: at least every 30 s; decided:
15 s keeps tests and real use prompt) and inside `PUT /api/test/clock`. Subject "Your Stillhour starts at
<HH:MM>" (brief).

## Journey 4: sign in and edit

`/manage` signed out: "Send me a sign-in link" → "If that address has a Stillhour, a sign-in link is on
its way. It works once, for 15 minutes." (brief), for every address. The editor sends only changed
fields with `If-Match`; a stale tab gets 409 and the editor refills every field from `error.current` with
"This plan changed somewhere else. Here is the latest version; your edits were not saved." (brief).

## Journey 5: share with a partner

"Create a share link" fills `textbox "Share link"` with `<origin>/p/<token>` (token ≥ 22 URL-safe
characters, brief; decided: 32 random bytes in base64url). The partner page shows "A shared Stillhour",
"Winding down from <start> for bed at <bedtime>, <zone> time." and the rituals, never the email or note
(brief). "Turn off sharing" makes the old link answer 404 and shows "This shared hour is no longer
available." (brief).

## Journey 6: delete everything

`dialog "Delete everything"`; "Delete my hour for good" is enabled only for exactly DELETE (brief). It
removes the hour, drafts, links, sessions, share link, unsent mail and reminder records; rate-limit
counts are kept for their hour (brief). Focus moves to the "Manage my hour" heading (brief).

## Journey 7: outages

- **Database down:** the story, scenes and gate still load; the live count shows "Tonight, people
  everywhere are keeping a Stillhour." (brief); data routes answer 503 `unavailable` and the planner
  keeps every value and the address (brief). It recovers without a restart, creating tables if needed
  (brief).
- **Mail down:** saves answer `confirmation_queued` with the queued copy (brief); the outbox retries
  every 10 s (brief: at least every 15 s) and delivers exactly once when mail returns; link lifetimes
  start when SMTP accepts the email (brief).
- **Every email** (decided, from brief: Services, The outbox): the change and its email are committed together
  first; only then does the request hand the email to SMTP, claiming the outbox row so no other instance
  sends it, and marking it sent in the same commit. A save remembers `confirmation_queued` for its key at the
  first commit and upgrades it to `confirmation_sent` if SMTP accepts before the answer. Every message is From
  `MAIL_FROM` (brief: Services, set to `Stillhour <goodnight@stillhour.example>`; decided: the envelope sender is
  the address inside its angle brackets) and shows the bedtime as `HH:MM` (brief). Requests carrying
  the same Idempotency-Key are serialised by a database advisory lock held for the whole save.

## Decided values the brief leaves open

| Value | Decision | Why |
|---|---|---|
| Stack | TypeScript; React 19 markup + an imperative runtime; Vite 7 build; `node:http` server bundled by esbuild; `pg` | the brief requires TypeScript and allows only MIT/ISC/BSD/Apache/0BSD shipped packages |
| 3D | three.js r180, six scenes built in code, one fixed canvas, drawn only when scroll, pointer or size changes or a loop runs; software WebGL renders at 0.6 scale | DP-59, a CPU-only browser, and "no other element moves on its own" |
| Smooth scroll | Lenis (lerp 0.2) on desktop with a fine pointer, off on touch and under reduced motion | DP-56 forbids page smoothing under reduced motion |
| Sideways chapter | pinned only at widths ≥ 1024 without reduced motion; the rail is the pin's own horizontal scroll, kept in step with the page scroll both ways | DP-14; focus and scrollIntoView must reach every card |
| Sound | Web Audio master gain; ambient bed and three chimes decoded from `/audio/*.mp3`; the film routed through the master gain, the bed at a third while it plays; fades of 0.35 s | DP-02, DP-59 |
| Fonts | Fraunces (display, numerals, clock) and Hanken Grotesk, self-hosted woff2 under OFL from `/fonts/` | the brief names two typefaces and IF-03 counts npm packages |
| Media | every image, clip, film, caption track and sound made by `scripts/media/*` (`original` in assets.json) | IF-06 and the kit's licence policy |
| Clock and counters | computed from layout every animation frame; DOM written only on change | "settles within a tenth of a second" |

## Scenes and what moves them

| Scene | Window (height) | Driven by | Moves on its own |
|---|---|---|---|
| contour landscape, low ember sun | hero (180svh) | window progress: the sun sinks to the horizon, the land cools | no (brief: Loops) |
| city, 4,096 windows | city (300lvh, at least three screens) | `litCount(window progress)`, far to near; the last window burns ember | no |
| still water, paper boat | water (220svh) | window progress: ripples calm, the boat drifts to the centre | ripples loop at the size scroll sets (brief: Loops) |
| moonflowers | flowers (240svh) | window progress: fold, farthest first; hover or tap closes one within a second; scrolling back above its closing point reopens it | no |
| moon | chapter four | window progress: new → full → new | no |
| paper lantern | footer (160svh) | window progress: the flame shrinks, out at 1 | flame flicker (brief: Loops) |

Under reduced motion the two loops freeze and every scene is redrawn to match scroll (brief: Reduced motion).
Without WebGL the same fixed layer shows a flat SVG drawing of whichever scene covers the screen, in the same
colours; every counter, caption and control works the same (brief: No WebGL).

## Palette (hex values the build uses)

| Role | Hex | Source |
|---|---|---|
| night | `#0d0a1e` | brief: Colour |
| dusk lilac | `#ece4f3`, `#ddd0ea`, `#c5b3dc` (chapter one, numbers band, chapter two) | brief: Colour, The darkening ground |
| dusk violet | `#4b3d78`, `#3a2f66`, `#231c44` (chapter three, settle line, chapter five; account pages) | brief: Colour, Forms |
| night chapters | `#120e26` (chapter six, footer) | brief: The darkening ground |
| ember | `#f4a259`, hover `#ffb978` | brief: Colour (light sources and actions only) |
| moonlight | `#f3efe7`, soft `#d8d1e6` | brief: Colour |
| ink on light chapters | `#1a1533`, soft `#3f3866` | brief: "Text is night on the light chapters" |
| danger | `#ffb4a8` | decided: field errors need a colour apart from ember, which is reserved for light and actions |

## Type, space and layout per viewport

| Viewport | Layout | Source |
|---|---|---|
| 375x812 | one column; numerals stacked; ritual cards one column; planner summary below the fields; city counter centred at the bottom; gate buttons stacked | brief: Screens and layout |
| 768x1024 | ritual cards two columns; planner one column with the summary below; no pinning | brief: Screens and layout |
| 1280x800 | chapter four pinned, cards travel sideways; planner fields left, summary right; manage editor two columns | brief: Screens and layout |

Fraunces (display: title, headings, numerals, clock, settle line) and Hanken Grotesk (everything else),
self-hosted woff2; root size `clamp(8.5px, 100vw / 144, 11px)` so type scales with the viewport (decided).
Every control's own box is at least 44 px tall (brief: Controls); the ritual checkbox's box is 44 px with a
2.6 rem square drawn inside it (decided: the visible mark stays small and calm).

## Motion

| Element | Trigger | Duration | Easing | Reduced-motion substitute |
|---|---|---|---|---|
| gate | a choice | 640 ms `opacity` | `cubic-bezier(0.45, 0, 0.2, 1)` | removed at once |
| hero title letters | gate closed | 0.6–0.7 s each, 18 ms stagger, about 1.4 s in all | `cubic-bezier(0.22, 1, 0.36, 1)` | letters in place from the start |
| numerals | band first on screen | 650 ms + 45 ms stagger, under 1 s | `cubic-bezier(0.22, 1, 0.36, 1)` | final values |
| breathing circle | Breathe with me | 4 s / 7 s / 8 s per phase | `cubic-bezier(0.45, 0, 0.2, 1)` | one size; phase and a seconds countdown change |
| toggles, buttons, focus | press, hover | 180 ms | `cubic-bezier(0.45, 0, 0.2, 1)` | no transition |
| chapter titles and paragraphs | just before first on screen | 640 ms `opacity` only | `cubic-bezier(0.45, 0, 0.2, 1)` | shown at once |
| clock, counter, captions, dial, settle letters, rail, scenes | scroll | each frame, no easing | none | identical (no smoothing) |
| film dialog, delete dialog | open | 640 ms `opacity`, `transform` | `cubic-bezier(0.22, 1, 0.36, 1)` | none |

## States per async action

| Action | Pending | Success | Failure |
|---|---|---|---|
| live count | (no copy) | "<count> people are keeping a Stillhour tonight" / "1 person …" | resting copy |
| save | "Saving your hour…" | sent or queued copy | field errors, 429, 503 (values kept), other |
| sign-in request | "Sending your link…" | neutral sent copy | email field message, 429, 503 |
| link check | "Checking your link…" | confirmed or signed-in copy | used, expired, unknown, 503 |
| manage actions | "Saving your hour…" | saved, reminders on/paused, share ready, copied, sharing off, deleted, signed out | conflict copy (fields refilled), field errors, 401 → signed out, 503 |
| shared hour | "Opening the shared hour…" | the hour | "This shared hour is no longer available." heading, 503 |

All copy is verbatim from brief: Feedback states.

## Breakpoints

375 (phone rules up to 767), 768 (tablet rules up to 1023), 1024 (pinning and the two-column planner
from here), 1280 (the two-column Manage editor from here; one column at every width below). Source: brief:
Screens and layout ("the editor has two columns at 1280x800 … and one column below that width"), brief:
Interactions (Sideways chapter: "widths of 1024 and above"); decided: the planner's two columns start with the
sideways chapter at 1024, a width the brief leaves open for the planner.

## Media and licences

Every file under `app/public/` is original: sounds synthesised and clips, film and posters rendered by
`app/scripts/media/*`, the mark drawn as SVG; the two typefaces are SIL OFL 1.1 (texts in
`app/public/fonts/`). The no-WebGL scene drawings (`app/src/story/fallback/*.svg`) and the flame-out
lantern (`app/src/story/components/lantern-out.svg`) are hand-drawn SVG, also original. Each binary under
`app/public/` and `app/src/` is listed with its sha256 in `app/assets.json` (regenerated by
`scripts/media/write_assets.py`); the caption track is text, written for this app.
