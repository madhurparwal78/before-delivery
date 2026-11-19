# TRUTH — Ottoline Rask Selected Builds (golden)

Ground truth of the golden app in `app/`. Every value says where it comes from: `brief: <section>` (copied from
`instruction.md`) or `decided: <why>` (the brief is silent; the reason ties it to the brief's intent).

## Stack and deployment

- TypeScript (strict) on Node 22, `node:http`, no runtime dependency; `npm ci`, `npm run build` (tsc for the server, tsc
  type-check plus esbuild bundle for the browser), `npm start`. brief: Technical requirements (Deployment); decided: one
  bundled script so the page is interactive as soon as it is parsed.
- Port 4173 or `APP_PUBLIC_PORT`, bound to `0.0.0.0`. Health `GET /api/health` always 200. brief: Deployment.
- Services: Mailpit over SMTP (`SMTP_HOST`, `SMTP_PORT`, `MAIL_FROM`, `MAIL_TIMEOUT_SECONDS`), MinIO over S3 with
  Signature V4 (`S3_*`, `MEDIA_PROBE_SECONDS`), grading routes only with `GRADING_KEY`. brief: Configuration and secrets.

## Journeys (start, actions, visible and provider-recorded end state)

1. **First look.** Fresh `/`: `data-intro="playing"`; greeting, 7 headline words, role line and links play in; at 1,800 ms of
   page time `data-intro="done"` and the role rotation starts. `Pause roles` (announces `Role rotation paused.`, focus stays),
   `Next role` shows role 2, Enter on `Explore projects` glides to `Selected work`: heading 80 px from the top, focus on it,
   `Work` current, address `/#work`, one new history entry. brief: Journeys 1; Interactions.
2. **Filter, read, return.** `Motion` then `Design`: four cards, `Showing 4 of 6 projects.` (announced once per change), address
   `/?category=motion,design` by `replaceState`. `Tidegauge` opens the case study; `Next project: Promptloom`; Back twice returns to
   `/` with both pressed, four cards, focus on the `Tidegauge` card link at least 72 px from the top, nothing announced. The home
   entry records the project it opened in `history.state`; Back reads it. brief: Journeys 2; Interactions (Gallery return).
3. **Callout Thread.** `Preview Foundry Loop` opens the modal on frame 1 with focus on `Next frame`; arrows step without wrapping;
   Escape returns focus to the opener. On the case study, callout 2 outlines region 15, 15, 55, 45 percent of the frame, shows frame 2
   then 3, 4, 5 every 150 ms of page time, readout `Callout 2 of 3 · frames 2–5`, address `callout=2` by replacement, announcement
   `Callout 2 of 3: Letterform morph.`; ArrowDown selects callout 3; pressing it again clears everything. brief: Journeys 3; Business rules.
4. **Keyboard and scroll tour.** Tab order as published; current header link and journey follow the 40% and 60% lines synchronously;
   counters start at the 75% line and count 1,500 ms once per load. brief: Journeys 4; Business rules.
5. **Services to enquiry.** Skills tab `Animation`, `GSAP` detail lists `Foundry Loop`; typing a name, then `Motion & Interaction` panel,
   `Enquire about Motion & Interaction`: no reload, jump to `contact`, `Project type` set, focus on `Your name`, typed value kept,
   `Project type set to Motion & Interaction.` announced once, one history entry `/?service=motion#contact`. brief: Journeys 5.
6. **Send an enquiry.** Five field messages on the first press (`Check the 5 highlighted fields.`), each cleared as corrected; a valid
   press shows `Sending your message…`, disables every field, then `Message received.` (level 3, focused) only after Mailpit accepted
   the message. Mailpit holds one email: To `hello@ottolinerask.example`, From `MAIL_FROM`, Reply-To the visitor, subject
   `New enquiry: <project type> from <name>`, plain-text body with every field. brief: Journeys 6; Business rules (Enquiry email).
7. **Phone, touch, reduced motion.** Everything in its end state; `Menu` opens a modal (focus `About`, Tab wraps, Escape, `Close menu` or a tap
   outside closes it and returns focus); choosing `Reviews` closes it and lands the heading; swipes of 40 px or more change one review and
   announce it once. brief: Journeys 7.
8. **Outages.** Mail down: `POST /api/enquiries` answers 503 `mail_unavailable`; the form shows the not-sent message, keeps every value, focus on
   `Send message`; each send connects again so it works as soon as mail is back. Media down: `/media/<key>` answers 503, plates and
   `Media notice` show, the page re-asks `/api/media` every 5 s of page time and loads the images in place, announcing
   `Project images are back.`; the app probes storage every `MEDIA_PROBE_SECONDS`, creates the bucket and stores the 42 objects when it
   returns. brief: Journeys 8; Services.

## Palette roles (hex used by the build)

paper `#E3E9DD`; paper raised `#EEF2E9`; ink `#0A0F2C`; ink raised `#161C44`; muted `#3B4262`; muted on ink `#B9C1D9`; rule `#A3AF9B`;
rule on ink `#2B3560`; accent `#2233CC`; accent on ink `#9DAEFF`; danger `#B8340F`; scrim `#0A0F2C99`; card tints `#D5DFC8`, `#CFD9E6`,
`#E4D8C3`, `#E3CFC6`, `#CDE0DD`, `#DCD3E6`. brief: Visual design (roles); decided (hex values, see DESIGN.md Palette for contrast pairs).

## Type, space, layout

Fraunces (headings, hero headline), IBM Plex Sans (body), IBM Plex Mono (figures); base 17 px, ratio 1.333 (h4 22.7, h3 30.2, h2 40.3,
h1 53.7 px; hero headline `clamp(2.75rem, 5.6vw, 5.5rem)`). brief: Visual design. Twelve-column grid, 24 px gap, 1280 px max width, 48 px
gutter (24 px under 768). Header 64 px fixed. Layout changes only at 768 and 1024 px, as in the brief's viewport table. brief: Screens and layout.

## Motion table

| Element | Trigger | Duration | Easing | Reduced motion |
|---|---|---|---|---|
| greeting, words, paragraph, late group | load | 300 / 500 from 150+100i / 400 from 1000 / 300 from 1300 ms | ease-out | intro done, no animation |
| role slide | automatic change | 400 ms | cubic-bezier(.2,.7,.2,1) | none, instant |
| journey connector | milestone reached | 300 ms | ease-out | none |
| card cover mask, title shift | hover, focus | 500 ms | cubic-bezier(.2,.7,.2,1) | none |
| filter fade-in | filter change | 250 ms | ease-out | none |
| frame crossfade | frame change | 200 ms | linear | none |
| callout outline | selection | 300 ms | ease-out | none |
| service panel / visual | open | 300 / 600 ms | ease-in-out / ease-out | none |
| skill bars | panel shown | 600 ms, 80i delay | ease-out | none |
| review track | change | 400 ms | ease-in-out | none |
| footer wordmark | first reach of the 90% line | 400 ms, 40i delay | ease-in-out | none, attribute set |
| cursor disc | state change | 150 ms | ease-out | hidden |
| menu dialog | open and close | 250 ms | cubic-bezier(.2,.7,.2,1) | none |

brief: Motion and effects. Page-clock timers: intro end (1,800 ms), role rotation (2,500 ms), counters (1,500 ms, rAF), callout stepping (150 ms),
media re-check (5,000 ms); the 30 s enquiry limit is `AbortSignal.timeout`. brief: Business rules (Page clock).

## States per async action

- Send: editing, invalid, sending, sent, failed (shared state machine). brief: Business rules (Enquiry state machine).
- Media object: loading, shown, unavailable (plate with `Cover unavailable` or `Preview frame unavailable` and `Try again`). brief: Business rules.
- Quick look and menu: closed means hidden and inert at once; only the exit animation lingers. brief: Business rules (rules that hold everywhere).

## Breakpoints

768 and 1024 px only. brief: Business rules. 375x812, 768x1024, 1280x800 are the published viewports. brief: Screens and layout.

## Media and licences

42 objects (6 covers, 36 frames) drawn as SVG by `src/server/artwork` from the seed data and stored in MinIO at start or on recovery; licence
`original`. Fonts: Fraunces, IBM Plex Sans, IBM Plex Mono, SIL OFL 1.1, self-hosted woff2. No production package ships; dev tools are
typescript (Apache-2.0), esbuild (MIT), @types/node (MIT). brief: Working rules IF-02 to IF-08.
