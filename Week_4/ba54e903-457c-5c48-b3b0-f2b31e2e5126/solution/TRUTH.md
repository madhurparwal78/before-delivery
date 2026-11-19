# TRUTH.md: Realtime Community Hub

Ground truth for the golden in `solution/app` (Flask on gunicorn, PostgreSQL through pg8000, plain SMTP to mailpit from a database outbox). Every value is marked `brief: <section>` when the brief states it, or `decided: <why>` when the golden chose it inside the brief's room.

## Ideal flow of every journey

### 1. Visitor browses the directory (DP-09, DP-10, DP-12, DP-41, DP-42)
1. `/` opens on the near-black hero: "GROUP CHAT FOR EVERY CREW", the support paragraph, "Get the app" (light pill, to `/download`) and "Open in your browser" (indigo pill, to `/servers`), the muted looping WebM beside the copy at 1280 and wider, below it at full width under 1280. brief: Screens and layout, Viewport ranges.
2. "Open in your browser" lands on `/servers`: near-white field, indigo "FIND YOUR NEXT COMMUNITY", the "Search popular communities" search box, the "Categories" chip group with live counts ("Gaming (5)"), a status line ("14 communities"), twelve cards and "Next page". brief: Directory, detail, and trending pages.
3. Typing "starlight" debounces (decided: 200 ms debounce, directory.js, inside the brief's 300 ms) and replaces the grid; the address becomes `?q=starlight`, the status reads "1 community"; reload keeps it. Pressing "Music (n)" sets `aria-pressed="true"` and `?category=music`. brief: Directory, detail, and trending pages.
4. A card (`article`) shows the splash banner (empty alt, `loading="lazy"`), the round icon ("Starlight Studio icon"), the linked name, description, "Verified", "75 Online" and "1,250 Members". Its heading link opens `/servers/starlight-studio`, which repeats those values over a wide banner with the channel names and "Join community". brief: Directory, detail, and trending pages.
5. A query with no match shows "No communities match your search." with "Reset filters", which clears `q` and `category`. brief: Directory, detail, and trending pages.

### 2. Visitor joins and becomes a member (DP-02, DP-03, DP-04, DP-06, DP-43, DP-46)
1. "Join community" while signed out goes to `/register?next=…`. brief: Directory, detail, and trending pages.
2. The form (Email, Display name, Username, Password, Date of birth, "Create an account") posts to `/api/auth/signup`; a refused field gets `aria-invalid="true"` plus `aria-describedby` to its visible error, other values stay, the password empties, and no member row is written. brief: Feedback states, Accounts.
3. Success stores the lowercased email, sends one "Confirm your Community Hub account" email from `no-reply@example.com` whose first line is "Hi <DISPLAY_NAME>, confirm your email for @<USERNAME>." and second line the `/verify-email?token=…` link (token at least 32 URL-safe characters, one use, 24 hours). brief: Accounts, Services.
4. The client stores the bearer token, joins the community and lands on `/channels/<id>/<general id>` with the status line "You joined Pixel Parlor."; reload keeps the session. brief: Directory, detail, and trending pages.
5. `/verify-email?token=…` shows "Your email is confirmed." or "This confirmation link is no longer valid." on the full dark page. Starlight Studio (`verification_level` `email`) refuses posts with 403 until the address is confirmed. brief: Accounts, Feedback states.

### 3. Member talks in a channel (DP-19 to DP-31, DP-51 to DP-58)
1. The workspace shows the rail (72 px), the channel sidebar (200 px) grouped under "Text Channels" and "Voice Channels" with `aria-current="page"`, the stream with the newest 50 messages and the composer "Message #general" at the bottom, and the "Members" aside with "Online (n)" and "Offline (n)" (Quiet Fern offline because invisible). brief: Screens and layout (rail at most 96 px, sidebar 180 to 340 px); decided: column widths 72/200/200 px, workspace grid in workspace.css.
2. Enter sends: the row renders at once with the `msg-enter` entrance (0.22 s), the POST stores the trimmed body and a `live_events` row, and every other open workspace receives it over its `/api/live` server-sent-events stream (bearer token in the `Authorization` header, never the URL), on whichever instance holds it, within 3 seconds. A failed POST keeps the row with "Message failed to send. Tap to retry." and "Retry", which resends with the same nonce. brief: Interactions, API (`/api/live` is the single live-update channel), Shared state across instances; decided: SSE over WebSocket, each instance's dispatcher reads `live_events` every 0.25 s (hub/live.py).
3. "@ron" opens the "Mention a member" list box; ArrowDown/ArrowUp move the active option without wrapping, Enter/Tab/click inserts "@roninvale ". brief: Interactions.
4. "Add reaction" opens "Choose a reaction", focus moves to "thumbs up"; Escape closes and returns focus. A chip reads "thumbs up: 1" with `aria-pressed="true"`; pressing it again removes the reaction. brief: Interactions.
5. "Reply in thread" opens the "Thread" aside (320 px, inside the stream area, so at 1280 the stream keeps 1280 − 72 − 200 − 200 − 320 = 488 px ≥ 480; at tablet widths it slides over the stream's right edge, min(360 px, 100%)), the parent shows "1 reply". "Edit message" swaps the body for "Edit message text"; Enter saves and the row shows "(edited)". brief: Interactions, Screens and layout (stream at least 480 px beside an open desktop panel); decided: 320 px panel.
6. "Notifications, n unread" opens the panel ("Nova Pike mentioned you"), "Mark all as read" resets the name to "Notifications". Unread counts follow the per-channel read marker. brief: Interactions, Business rules.
7. "Search messages" + Enter opens "Search results" (the same 320 px panel) with "n results", "#general", a `time` and `mark`-highlighted terms; Escape closes and refocuses the input; a refused query shows "That search could not be run.". brief: Interactions; decided: 320 px panel, as the thread.
8. Without `send_messages` the composer and "Attach files" are disabled with the placeholder "You do not have permission to send messages in this channel."; "Add reaction" is absent without `add_reactions`. brief: Interactions.

### 4. Member subscribes (DP-34, DP-35, DP-47)
1. `/membership` shows the "Compare membership tiers" table (Perk, Free, Basic, Max; Included cells carry a check icon, a dark check on a filled green disc, before the word), "$2.99 / MONTH", "$9.99 / MONTH", "Subscribe to Basic", "Subscribe to Max", and FAQ buttons with `aria-expanded`. brief: Accounts, settings, membership, and support pages; brief: Accounts, settings, membership, and support pages (Included cells carry a check icon); decided: the disc behind the check.
2. "Subscribe to Basic" opens "Checkout" naming Basic and its price; "Pay" shows "Processing payment" with a spinner (0.8 s linear infinite), then "You are now on Basic." with a drawn check (0.45 s). A declined card shows "Your card was declined. You are still on Free." and "Try again". brief: Feedback states, Motion and effects (spinner about once a second, check under half a second); decided: 0.8 s and 0.45 s.
3. Basic to Max charges 700 cents; Max to Basic charges 0 and resets a non-classic app icon to classic. brief: Business rules.

### 5. Visitor uses the public extras (DP-38, DP-39, DP-40, DP-48, DP-49, DP-50)
1. `/safety-library`: "Search articles" (`maxlength` 256), "Filter by category", "Filter by topic"; results update after a 200 ms debounce; "No articles match your search."; "Reporting and blocking" opens its article. brief: Accounts, settings, membership, and support pages; decided: debounce.
2. `/listening-room`: three tracks (Night Shift Lo-fi, Aurora Drift, Ronin Rain, original Opus files 20 to 60 s); Play starts the single `audio`; the equalizer bars animate (0.9 s alternate) only while playing; a track end starts the next. brief: Home, download, and media.
3. First visit: the "Cookie preferences" dialog in the bottom corner; "Reject optional" writes `hub_consent=analytics:0|marketing:0` with path `/` for 365 days (decided: 365 ≥ 180 days); analytics writes `hub_aid` and posts page views; marketing writes `hub_mkt`. brief: Consent and trackers.
4. `/support/new` submits a ticket and shows "Request received. Your reference is HUB-000123."; an acknowledgement email "We received your request HUB-000123" is sent. brief: Feedback states, Trending, safety, support, and analytics.

## Palette

| Token | Value | Use | Basis |
|---|---|---|---|
| space | #060a0b | marketing field, footer | brief: Visual design (near-black neutral); decided: exact value |
| surface | #23272a | message stream, cards on dark | brief: Visual design (deep neutral); decided: exact value |
| surface-2 | #2c2f33 | rail items | decided: one step above surface |
| surface-3 | #16181c | track rows | decided |
| rail | #111214 | community rail | brief: Visual design (rail darkest); decided: exact value |
| sidebar | #1e1f22 | channel sidebar | brief: Visual design (a step lighter); decided: exact value |
| ink / ink-soft / ink-muted | #ffffff / #dddddd / #b2b2b2 | text on dark | brief: Visual design (near-white, light neutral) |
| paper / paper-ink / paper-muted | #f6f6f6 / #0b0d10 / #4a4d55 | directory field and text | brief: Visual design (near-white off-white) |
| accent | #5865f2 | primary action, nav hover wash | brief: Visual design (light, vivid blue indigo) |
| accent-hover / accent-pressed | #8891f2 / #3442d9 | hover and pressed | brief: Visual design (light soft blue, mid vivid blue) |
| success / success-hi | #23a559 / #57f287 | Included marks, check | brief: Visual design (mid soft green, light vivid green) |
| alert | #ed4245 | errors, send failure | brief: Visual design (clear red) |
| magenta | #eb459e | feature highlight | brief: Visual design (light, vivid magenta) |

## Type

| Role | Value | Basis |
|---|---|---|
| Display (home line) | "Hub Display", system-ui sans stack, weight 900, uppercase, line-height .95, clamp(2.4rem, 11vw, 5.4rem) (about five times the body size at desktop); clamp(2rem, 10vw, 2.6rem) on a phone so both actions stay on screen | brief: Visual design (large, heavy, uppercase); decided: system stack, no web font shipped |
| Page heading | weight 900, uppercase, clamp(1.9rem, 4.4vw, 3rem) (about three times the body size) | brief: Visual design; decided: exact clamp |
| Feature block heading | weight 900, uppercase, 2rem (about twice the body size) | brief: Visual design |
| Body | "Hub Sans", system-ui sans stack, 16 px, line-height 1.5 | brief: Visual design (plain humanist sans) |
| Word strip | weight 900, uppercase, 1.4rem | decided |

## Layout per viewport

| Viewport | Layout | Basis |
|---|---|---|
| Desktop, 1280 and wider (reference 1280x800) | Primary links in one row; hero copy and video side by side; feature blocks 3 in one row with equal tops; directory grid 4 columns; safety hub 3 columns; detail page banner then two columns; trending featured card beside the ranked list; footer 4 columns; workspace 72 / 200 / fluid / 200 px, 100vh, no marketing chrome, member list visible, no "Show members"; Thread, Search results and Notifications open as a 320 px panel between the stream and the member list, the stream keeping at least 480 px | brief: Screens and layout, Viewport ranges; decided: track sizes |
| Tablet, 768 to 1279 inclusive (reference 768x1024) | Primary links in one row, no "Menu"; hero video below the copy at full width; feature blocks stacked in one column; directory grid and safety hub 2 columns; detail page two columns; trending featured card beside the ranked list; footer 2 columns; workspace 72 / 200 / fluid, member list hidden behind "Show members" (260 px slide-over), panels slide over the stream's right edge (min(360 px, 100%)) without covering rail or sidebar, no "Open channels" | brief: Screens and layout, Viewport ranges (768 and 1279 are tablet) |
| Phone, below 768 (reference 375x812) | Primary links behind "Menu" (`aria-expanded`), a full-width panel under the top bar; all content one column; detail page stacked; feature blocks in place and still; workspace stream full width, rail and sidebar hidden until "Open channels" slides them in (0.25 s); panels cover the stream | brief: Screens and layout, Viewport ranges |
| 320 px | No horizontal overflow on any public route; directory chip bar wraps | brief: Screens and layout |

## Motion

| Element | Motion | Reduced motion | Basis |
|---|---|---|---|
| New message row (live, history-appended or caught up) | slide up 10 px and fade in, 0.22 s ease-out | appears without sliding | brief: Motion and effects (0.1 to 0.4 s, about half a line) |
| Word strip | marquee translateX 0 to -50 %, 32 s linear infinite | stands still; stops within 1 s when switched on live | brief: Motion and effects (one pass every 20 to 40 s) |
| Feature blocks | scroll-linked: 24 px below and transparent while the top is at the window bottom, rising and fading proportionally to fully in place when the top reaches the top of the lower third; reversed on scroll up; rAF loop reading scrollY; tablet and desktop (768 and wider) only | in place and fully visible | brief: Motion and effects (signature); decided: 24 px ≈ one line |
| Buttons | background, colour, transform, shadow 0.3 s ease; hover lifts 2 px, press darkens to accent-pressed | no transition | brief: Motion and effects (0.1 to 0.3 s) |
| Nav links (Membership included) | text colour washes to the indigo accent, 0.25 s ease | no transition | brief: Motion and effects (0.1 to 0.3 s, text washes to the accent) |
| "Get the app" | background and shadow ease 0.3 s on hover | no transition | brief: Motion and effects |
| Panels, phone channel panel, phone Menu | slide in from their edge 0.25 s ease-out, reversed on close, then hidden | no slide | brief: Motion and effects (under a third of a second) |
| Spinner | rotate 0.8 s linear infinite while payment runs | still | brief: Motion and effects (about once a second) |
| Success check | stroke draw 0.45 s ease-out | drawn at once | brief: Motion and effects (under half a second) |
| Equalizer bars | height 10 to 60 px, 0.9 s alternate infinite, running only while audio plays, frozen in place on pause or end | still; audio keeps playing | brief: Motion and effects |
| Flip cards | rotateY 0.5 s | instant | decided |
| Hero video | autoplay muted loop | does not start, poster shown, button reads "Play background video"; pauses within 1 s when switched on live and is never restarted when switched off | brief: Home and download, Motion and effects |

Under `prefers-reduced-motion: reduce` a global rule removes every animation and sets every transition to zero, and a `matchMedia` change listener follows the preference live. brief: Motion and effects.

## States

| State | Copy or behaviour | Basis |
|---|---|---|
| Empty directory | "No communities match your search." + "Reset filters" | brief: Directory, detail, and trending pages |
| Empty library | "No articles match your search." | brief: Accounts, settings, membership, and support pages |
| Empty channel | "This is the start of the channel." | brief: Screens and layout |
| Send failure | "Message failed to send. Tap to retry." + "Retry" | brief: Interactions |
| Oversized attachment | "<FILENAME> is larger than your upload limit." | brief: Interactions |
| Login failure | "That email and password do not match." | brief: Feedback states |
| Not found | 404, "PAGE NOT FOUND", "This page could not be found.", "Back to home" | brief: Feedback states |
| Checkout | "Processing payment", "You are now on <TIER>.", "Your card was declined. You are still on <TIER>." | brief: Feedback states |
| No send permission | composer and Attach files disabled, placeholder "You do not have permission to send messages in this channel." | brief: Interactions |

## Breakpoints

- `max-width: 767px`: phone layout: Menu toggle, single-column content, off-canvas workspace rail and sidebar, still feature blocks. brief: Viewport ranges (below 768).
- `min-width: 768px` and `max-width: 1279px`: tablet layout: two-column cards, hero and features stacked, member list behind "Show members", overlay panels. brief: Viewport ranges (768 to 1279 inclusive).
- `min-width: 1280px`: desktop layout: four-column directory, three feature blocks in a row, hero side by side, visible member list. brief: Viewport ranges (1280 up).
- `min-width: 768px`: detail page two columns, feature-block rise enabled. brief: Screens and layout, Motion and effects.
- `prefers-reduced-motion: reduce`: all animation and transition off. brief: Motion and effects.

## Media and licences

| Asset | Use | Licence | Basis |
|---|---|---|---|
| `static/media/hero.webm` (VP9, 6 s, 960x540) | home hero, muted loop, `aria-hidden` | original, made for this app | brief: Home and download (original WebM, at least 4 s and 640x360) |
| `static/media/hero-poster.jpg` (960x540) | hero poster, reduced-motion still | original, a frame of the hero | brief: Home and download (poster image) |
| `static/media/night-shift-lofi.ogg`, `aurora-drift.ogg`, `ronin-rain.ogg` (Opus) | listening room tracks, 20 to 60 s | original, synthesised for this app | brief: Listening room (original recordings 20 to 60 s) |
| `static/favicon.svg` | favicon | original | brief: Server boundary (the favicon) |
| community icons, splashes, banners, game covers | SVG drawn by `hub/art.py` | original | brief: IF-07; decided: drawn art, no photos |
| shipped Python packages | listed with versions in `THIRD_PARTY_NOTICES.md`; driver is pg8000 1.28.3 (BSD-3-Clause) with scramp 1.4.1 (MIT) | each one of MIT, BSD-3-Clause or Apache-2.0 (packaging: Apache-2.0 OR BSD-2-Clause) | brief: IF-05, IF-06 (MIT, BSD-2-Clause, BSD-3-Clause, Apache-2.0, ISC, PSF-2.0, MPL-2.0, 0BSD or Unlicense only); decided: older scramp pinned because 1.4.3 and later are MIT-0 |

## Judged criteria mapping

| Criterion | What the golden shows | Where |
|---|---|---|
| B1 | near-black hero, 900-weight uppercase headline left, framed video right at 1280 and wider, below the copy under 1280 | templates/home.html, site.css `.hero` |
| B2 | `body.field-light` paper field, indigo h1 | site.css, templates/servers.html |
| B3 | `.btn-light` white pill, `.btn-accent` indigo pill, radius 999 px | site.css `.btn` |
| B4 | `.display` on h1 of home, trending, membership, safety | site.css `.display` |
| B5, B9 | `article.featured` with 480x270 cover, Plays, Streams, Members, a "Join <COMMUNITY_NAME>" link beside `ol.ranked` | templates/trending.html |
| B6 | six topic cards with title link and summary on the dark field | templates/safety.html |
| B7 | `.msg` grid 40 px avatar circle, name + `time`, body, reaction chips | static/js/workspace-stream.js, workspace.css `.msg` |
| B8 | Included cells carry a check icon (`.mark`, check on a green disc) the Not included cells lack | templates/membership.html, site.css `.mark` |
| B10 | banner, 96 px round icon overlapping, name, description, counts, channels, Join community | templates/server_detail.html |
| B11 | one player panel (equalizer, Now playing, buttons, ranges) above the track list | templates/listening_room.html |
| B12, B13 | Checkout dialog names tier and price, outcome replaces the form | static/js/membership.js |
| B14 | Thread aside as a 320 px panel beside the stream on desktop (stream ≥ 480 px), sliding over it on tablet | workspace.css `.ws-panel` |
| B15 | consent dialog fixed 16 px from the bottom-right corner, at most 420 px wide | templates/base.html, site.css `.consent` |
| B16 | notification entries "<Name> mentioned you", "<Name> replied to you", "<Name> posted a new message" | static/js/workspace-panels.js:330-332 |
| B17, B18, B20 | `.card` 16 px radius, banner top, icon overlapping, auto-fill grid with 20 px gap, filled badges | templates/_card.html, site.css `.card-grid` |
| B19 | rail #111214, sidebar #1e1f22, stream #23272a, panels #1e1f22 | tokens.css, workspace.css `.ws-rail`, `.ws-sidebar`, `.ws-panel` |
| B21 | phone and tablet hero single column, video below copy; side by side from 1280 | site.css `min-width: 1280px` |
| B22 | invented names only | hub/seed.py, hub/catalog.py |
| B23 | Search results aside with count heading and `mark` highlights | static/js/workspace-panels.js search |
| B24 | Attach files button inside the composer row | templates/workspace.html |
| B25 | `/verify-email` on the dark field with shared chrome | templates/verify_email.html |
| Q1 | `channel_permissions` in hub/perms.py used by every channel path | hub/perms.py, hub/api.py |
| Q2 | one error builder producing `{"error": {code, message, field}}` | hub/__init__.py |
| Q3 | Jinja autoescape on the server, `textContent` for user text in scripts; innerHTML only for static markup or server-rendered escaped HTML | templates/, static/js/ |
