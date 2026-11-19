# Marram & Wick Hushfoot

Hushfoot is a browser game of family wildlife photography across an invented archipelago of five islands, for a parent, a child and a far-away grandparent who want to do this together from any browser. An explorer walks hand-built islands in third person, photographs invented creatures that keep their own routes, and has every photo scored by the server. Good photos fill field albums, finished albums earn stamps, and three stamps open a lighthouse. Friends join shared safaris, visit gallery halls and like photos live, rangers approve notes for the harbour notice board, and a photo postcard reaches any email address. The backend services are Postgres, MinIO and Mailpit. Out of scope: outside sign-in, AI features, paid plans, real-money items, loot boxes, ads, analytics, languages other than English, any other datastore, queue or cache, pointer lock, gamepad, WebXR and device sensors. Creatures are only photographed, never caught or harmed.

## Problem and users

Families who want to photograph wildlife together pay for it in hardware or in weather. Photo adventure games are often bought for one console or PC, can be finished in an afternoon and plant the player's feet while the camera is up. Nature apps need real outdoors, struggle with fast animals and keep badges on one device, so a lost phone can take a child's progress with it. Blind players meeting browser games often hear little more than a label for the canvas. Hushfoot gives every family member one place, on any browser, where the score is decided by the server and the progress survives any device.

- **Explorer** (daily): plays with the guide creature on the title screen, walks the islands with keys, click, tap or joystick, photographs every creature, finishes albums, earns stamps, opens the lighthouse, hangs a gallery hall, enters challenge boards and posts postcards, with all progress kept after reload.
- **Safari guest** (weekly): takes the one guest seat on a friend's shared safari by typing a safari code, then sees the host walking, the host's map sightings and every new photo arrive live.
- **Gallery visitor** (weekly): walks through a friend's gallery hall, reads each hung photo's server score and likes it, watching counts move live.
- **Harbour ranger** (daily): approves or declines pending notes, so only approved notes ever appear to other players.
- **Postcard recipient** (occasional): receives in an ordinary inbox, with no account, a postcard carrying the photo, its creature, its score and the sender's line.
- **Text world reader** (weekly): uses a screen reader or a device without WebGL to read every island, creature and personal progress and acts on progress without the 3D scene.

## Journeys

1. **First steps.** A signed-in explorer on the title screen tabs to Wump, spins, scales and nudges it by keyboard, presses `Start walking`, arrives on Saltmarsh Harbour, walks and runs along the dock, jumps a rock, orbits the camera and reloads. The end state is the same saved tile with the same progress.
2. **Phone expedition.** An explorer at phone size holds the joystick, taps Run and Jump, taps a tile on the map sheet, orbits and pinches with two fingers, closes the sheets and takes a photo with on-screen buttons. The end state is a kept photo and a result sheet with its four rows.
3. **Lens Up.** An explorer opens a deep link to a spot, raises the camera by keyboard, frames the Mossback newt, sets zoom, takes the photo, hears the score, closes the result and opens the album. The end state is a filled album page whose image comes from storage, and it also appears in the player's other open tab.
4. **Dusk and rain.** Two explorers watch one world while its clock moves. The end state is the same tick, weather and creatures on both screens, and a dusk-only moth standing in the frame of the one who waited at the right spot.
5. **The last stamp.** An explorer with two stamps and three of four pages photographs the last creature. The end state is a new page, a third stamp, an open lighthouse and returned film, in every tab; a confirmed restart then puts all of it back to the start while photos stay.
6. **Hall and safari.** A friend visits an explorer's hall, views and likes a photo, and later takes the guest seat on the explorer's safari. The end state is a moved like count on the explorer's open page, then a live feed of the host's position, sightings and photos on the guest's.
7. **Board and notes.** An explorer pins a note and enters a photo on a challenge board. The end state is the note visible to everyone once a ranger approves it, and a re-ranked board on every open page.
8. **Postcard to a grandparent.** An explorer posts a photo to an address with no account. The end state is one message in the inbox, and a public read-only postcard page reached from its link, with no trace of the sender's address.

## Mandatory requirements

This is the complete list of mandatory requirements; every check traces to one of these lines and the detailed sections below.

- **DP-01 — First steps from the title screen** From a grading world, signed in as `explorer`, a keyboard-only session plays with Wump, opens play through `Start walking`, walks, runs, jumps and orbits as published, and after reload `data-tile` still reads the saved tile.
- **DP-02 — Title screen Tab order** Pressing Tab through the title screen reaches its controls in exactly the order printed in Interactions, for the signed-in and the signed-out header.
- **DP-03 — Guide creature keyboard control** With `application "Guide creature"` focused, ArrowRight twice gives `data-spin="30"`, + gives `data-zoom="1.25"`, Space gives `data-nudges="1"`, and `Guide status` announces each result with its published template.
- **DP-04 — Guide creature pointer pull** A pointer drag on `Guide creature` changes `data-spin` and raises `data-stretch`, and after release `data-stretch` springs back to `0.00` within 600 ms of page time.
- **DP-05 — Published walk and run steps** From spot 1, holding D for 400 ms of page time ends on tile 5,12, and then R with D held for 400 ms ends on 9,12, with `data-step`, `data-tile`, `data-heading` and `data-gait` matching the movement rule after every step.
- **DP-06 — Rock stop and jump** From tile 7,5 on Saltmarsh Harbour, holding S stops at the rock with `data-heading="S"`, and Space lands on 7,7 on the fourth step with `data-gait="jump"` until it lands.
- **DP-07 — Explore camera keys and focus scope** In explore mode Q, E, + and Home change `data-yaw` and `data-zoom` as the keyboard table says, and after Tab leaves `World view`, pressing D moves nothing.
- **DP-08 — Phone expedition** At 375x812 with touch, an explorer walks by joystick, runs and jumps by button, walks by map tap, closes the sheets and keeps a photo using only `Camera`, `Zoom in`, `Focus` and `Take photo`.
- **DP-09 — Joystick holds a direction** At 375x812, a touch that starts on `group "Joystick"` and moves at least 16 px north, held for 400 ms of page time, walks exactly 2 tiles north, and lifting the finger stops it.
- **DP-10 — Run and Jump by tap** At 375x812, tapping `button "Run"` sets its `aria-pressed` and makes a 400 ms joystick hold cover 4 tiles, and tapping `button "Jump"` runs the published four-step jump.
- **DP-11 — Tapped map tile walks the published path** Tapping tile 12,10 on the `Island map` from spot 1 walks the published shortest path, and `data-tile` reads each published tile after its step.
- **DP-12 — Two-finger orbit and pinch** In explore mode on `World view`, two touches moving sideways change `data-yaw` by 1 degree per 2 px of midpoint movement, rightward adding and leftward subtracting, and each 40 px of pinch steps `data-zoom`, including through 1, 2 and 4 in photo mode.
- **DP-13 — Phone sheets close completely** At 375x812 the map, album and photo result open as full-width bottom sheets, and `Close map`, `Close album` and `Close` leave them hidden, out of the accessibility tree and out of the Tab order with focus back on the opener.
- **DP-14 — Published layouts at three viewports** At 375x812, 768x1024 and 1280x800 the layouts printed in Screens and layout appear, including 44 px targets, no horizontal overflow, and at 768x1024 the Joystick shown only with a coarse pointer.
- **DP-15 — Keyboard photo from a deep link** Opening `/play?island=1&spot=2` and using only keys, an explorer enters photo mode, sets zoom 2, takes worked example 1, closes the result and sees the page filled in the album opened with J.
- **DP-16 — Entering photo mode by keyboard** C sets `data-mode="photo"`, `data-yaw` to the heading's angle, `data-zoom="1"` and `data-focus="4"` at once, with `data-in-view="mossback-newt"` at spot 2 and the matching `Frame guide` message.
- **DP-17 — Turning changes the frame guide** In photo mode at spot 2, E turns the explorer east and `Frame guide` reads its no-creature message with `data-in-view` empty, and Q turns it back so the newt message returns, with `data-tile` unchanged.
- **DP-18 — Scoring pending and one announcement** While the photo request is held, `Photo status` holds only its scoring message, and after release it announces the published result template exactly once and `dialog "Photo result"` opens.
- **DP-19 — Score figures count up** After a kept photo the `score-total` figure reads strictly between 0 and 100 at 300 ms of page time and `100 / 100` at 600 ms for worked example 1, and the row figures end on 30, 25, 25 and 20.
- **DP-20 — Result survives the world** `dialog "Photo result"` stays open with its text intact through clock, weather and live events, Tab and Shift+Tab wrap inside it, and Escape closes it with focus back on `World view`.
- **DP-21 — Album shows only a stored photo** After worked example 1 the album shows the newt page filled with `4 of 4 pages` and an image from the app's origin, the player's second tab shows it live, and the MinIO object is byte-identical to the uploaded image.
- **DP-22 — Scored examples by keyboard poses** Worked examples 1, 3 and 4, reached by deep link, keys and the clock route, show the published rows and totals in `Photo result`, and the API answers on the wire carry the same numbers.
- **DP-23 — Worked examples and refusal order on the API** All five worked examples through `POST /api/photos` answer `201` with the published scores, and combined faults answer with the single refusal the published photo error order selects.
- **DP-24 — Rewritten poses are refused** With the page's outgoing pose rewritten to water tile 15,4, a tick 31 behind, or a camera 2 tiles away, `Photo status` shows that refusal's exact message, no result opens, nothing is stored and the `film` figure stays.
- **DP-25 — Nothing in frame is refused** From spot 1 facing E at tick 6000, taking a photo by keyboard shows the `nothing_in_frame` message in `Photo status` with no photo row, no object and an unchanged film figure.
- **DP-26 — One shot key makes one photo** Repeating the page's Take request under its `Shot-Key` returns the first answer and spends one frame, a reused key with another pose answers the `shot_key_reused` 409, and the `film` figure matches the ledger after reload.
- **DP-27 — Two presses keep one photo** Two Enter presses in photo mode within 100 ms of page time send one request and leave one `photos` row and one spent frame.
- **DP-28 — Interleaved players keep their own answers** Two players taking photos at the same time in separate contexts each see only their own creature, total and film count in `Photo status` and `Photo result`, whatever order the requests finish in.
- **DP-29 — One world on two screens** `explorer` and `friend` in one grading world watch the clock move through morning, dusk and rain, and at each stop both `World view` elements report the same `data-tick`, `data-weather` and `data-creatures`.
- **DP-30 — Same tick and creatures on both screens** At tick 6000 both contexts on Saltmarsh Harbour show `data-tick="6000"` and `data-creatures="mossback-newt@12,6,S;reedpipe-heron@6,16,E"`.
- **DP-31 — Clock change arrives with the page clock paused** After the clock route moves to tick 6030, both pages show `reedpipe-heron@9,16,E` in `data-creatures` within 2 seconds of real time, with their page clocks still paused.
- **DP-32 — The device clock is ignored** A context whose page clock is set years away and whose time zone differs still shows `data-world-hour="10"`, `timer "World time"` `10:00` and `data-weather="clear"` at tick 6000.
- **DP-33 — Dusk arrives from the server** At tick 11000 `World status` announces the dusk message, `data-world-hour="18"`, the moth appears in `data-creatures` and in `data-in-view` from spot 4, and a scene capture differs from the one at 10:00.
- **DP-34 — Rain arrives from the server** At tick 4000 `World status` announces the rain message, `data-weather="rain"` and `puddle-lark@4,4,S` appears in `data-creatures`, and a later clock move out of the rain hours announces its end and removes the lark.
- **DP-35 — Route rule on the world API** `GET /api/world` reports each creature's position and heading by the published route rule at several ticks, lists dusk-only and rain-only creatures only in their hours and ignores any tick the client sends.
- **DP-36 — The last stamp opens the lighthouse** Tab A photographs the newt as worked example 1 and tab B of the same player shows the new page, stamp and open lighthouse live, then a keyboard restart resets both while photos and the hall stay.
- **DP-37 — Page, stamp and lighthouse announcements** That photo announces the album-page message in `Photo status` and the stamp and lighthouse messages in `World status`, and `data-lighthouse` becomes `open`.
- **DP-38 — Other tab follows stamps** Tab B's `stamps` figure reads `3 stamps` after its count-up and its `data-lighthouse` reads `open`, with no reload and no change of focus.
- **DP-39 — Film figure equals the paired ledger** The `film` figure counts from `30 frames` to `35 frames`, strictly between at 300 ms of page time, every `film_ledger` change is a pair summing to zero, the satchel sum equals the figure, and `Refill film` restores 36 on Saltmarsh Harbour only.
- **DP-40 — Album tabs by keyboard** J opens the album with focus on `tablist "Islands"`, arrow keys move across its tabs and change the shown island's `album-pages` figure, and Escape returns focus to `World view`.
- **DP-41 — Restart confirmation by keyboard** `Restart expedition` opens `alertdialog "Restart the expedition?"` with its published sentence, Tab and Shift+Tab wrap inside, and Escape or `Keep playing` closes it with focus back on the opener and nothing changed.
- **DP-42 — Restart reaches every tab and the text world** Confirming `Restart` puts album counts, stamps, the lighthouse, film and position back as published in both tabs within 2 seconds, keeps photos and the hall, and `/text-world` shows the same counts as the API.
- **DP-43 — A friend visits and likes a hall** `explorer` reorders and saves a hall, `friend` walks it, views and likes a photo, and `explorer`'s open hall page shows the new count and hears the like without a reload.
- **DP-44 — Reorder the hall by keyboard** On `/hall`, Alt+ArrowDown on the focused heron item moves it to frame 2, `Gallery status` announces the move message, focus stays on the item, and `Save hall` keeps the order after reload.
- **DP-45 — Walk a hall by keys** On `/hall/<handle>`, holding W for 400 ms of page time with `application "Gallery hall"` focused moves `data-tile` from 2,13 to 2,11, and the outer walls stop it.
- **DP-46 — Photo viewer by keyboard** `View Reedpipe heron photo` opens `dialog "Photo viewer"` by keyboard, + raises its `data-zoom` from 1 to 2, and Escape closes it with focus back on the opener.
- **DP-47 — Like counts move in place** When `friend` likes a photo, `explorer`'s `likes` figure reaches `1 like` after its count-up with no reload and no loss of scroll position or focus, and `Gallery status` announces the like message once.
- **DP-48 — One like per visitor and request-scoped readers** A repeat like from a second `friend` tab leaves one `likes` row, unliking shows `0 likes` live, and interleaved hall reads by owner and visitors each return the reader's own `liked_by_me`, film count and account menu.
- **DP-49 — Public hall switch** Turning `switch "Public hall"` off makes that hall answer 404 for `friend` on reload, in the API and for the images shown only there, and turning it on restores them.
- **DP-50 — A friend takes the guest seat** `friend` joins `explorer`'s safari by code and follows the host's walking, sightings and photos live while `rival` is refused the seat, and after `friend` leaves `rival` can join.
- **DP-51 — Join a safari by keyboard** `dialog "Join a safari"` opens, accepts a typed code with Enter, shows `no_safari`'s message in `Safari status` for a wrong code with focus kept in the field, joins on the right code, and returns focus to its opener when closed.
- **DP-52 — Host position arrives live** On the guest's `World view`, `data-host-island` and `data-host-tile` follow each tile the host walks within 2 seconds, with no reload and no change of the guest's own tile.
- **DP-53 — Sightings by map keyboard** The host moves the map cursor with arrows and presses S, and both players' `list "Sightings"` gain the published sighting line in place and `Safari status` announces it.
- **DP-54 — Host photos reach the guest** Each photo the host keeps appears in the guest's `log "Safari feed"` as its published line with an image from the app's origin, without moving the guest's focus or closing an open panel.
- **DP-55 — One winner for the last seat** When `friend` and `rival` join the same safari at once, one gets the seat and the other sees the `safari_full` message in `Safari status` with the API answering 409, and the seat count stays at one guest.
- **DP-56 — A closed guest page frees its seat and connection** On `short-limits`, closing the guest's page frees the seat no earlier than 3 seconds and no later than 6 seconds after it closes, the host hears the left message, `rival` can join, and after ten streams closed mid-way no app session stays active or idle in transaction.
- **DP-57 — A note reaches the board through a ranger** `explorer` pins a note by keyboard, `ranger` approves it, and `friend`'s open board shows it live; `ranger` also declines `friend`'s pending note and `friend` is told why.
- **DP-58 — Pin a note by keyboard, shown as typed** Pinning `<b>Low</b> tide **today**` by keyboard shows those literal characters with `Waiting for a ranger` to the author only, two presses leave one pending note, and a half-typed draft stays intact through live events.
- **DP-59 — Approved notes arrive live** After `ranger` approves by keyboard on `/ranger`, `friend`'s open `list "Notice board"` shows the note within 2 seconds with its characters exactly as typed and `Notes status` announces the new-note message.
- **DP-60 — Decline by keyboard with a reason** `dialog "Decline note"` works by keyboard, Escape returns focus to the note's `Decline`, and confirming `Shares personal details` sends the author the published declined message live.
- **DP-61 — Two rangers on one note** When `ranger` and `ranger2` decide one note, the first decision stands, the API answers the second with the `note_decided` 409, and the second ranger's `Notes status` shows the message naming the outcome and first ranger.
- **DP-62 — Note length limit** Typing and pinning 141 characters shows the `note_too_long` message in `Notes status` and stores nothing, and exactly 140 characters is accepted.
- **DP-63 — Unconfirmed players cannot pin** `newcomer` pressing `Pin note` sees the `unconfirmed` message in `Notes status`, the API answers 403, and no note row is stored.
- **DP-64 — Postcard to someone with no account** `explorer` posts the moth photo to an address, one message arrives, and a signed-out context opens its link and reads the image, creature, score, island and line.
- **DP-65 — Post by keyboard once** `dialog "Send postcard"` works by keyboard, two presses of Post make one postcard and one Mailpit message, and `Postcard status` announces the posted message once only after Mailpit accepted it.
- **DP-66 — Postcard message content** The Mailpit message has the published sender, subject, text body, link and attachment, with the line exactly as typed including `<i>`, and the sender's address appears nowhere in it.
- **DP-67 — Public postcard page** In a signed-out context `/postcards/<id>` shows the image from the app's origin and the published fields as literal text, with the sender's address absent from the page and its API answer.
- **DP-68 — Postcard with storage unreachable** On `storage-down`, pressing Post shows the postcard storage message in `Postcard status`, the API answers 503, no message reaches Mailpit and no postcard is stored as posted.
- **DP-69 — Postcard rate limit** On `short-limits`, the third postcard shows the `postcard_limit` message with the limit 2 in `Postcard status`, and the API answers 429 with `Retry-After` in seconds.
- **DP-70 — Confirmation code by mail** `newcomer` gets the `unconfirmed` message on Post, presses `Send a new code`, reads the six-digit code from Mailpit, types it on `/confirm`, and can then post.
- **DP-71 — Board re-ranks as players enter** `explorer` and `friend` enter their heron photos over `rival`'s seeded entry, both open boards re-rank in place, and a filter then narrows the list.
- **DP-72 — Enter a photo by keyboard** `dialog "Enter a photo"` opens, selects `radio "Reedpipe heron photo, 74"` and submits by keyboard, focus returns to `Enter a photo`, and the player's row appears without a reload.
- **DP-73 — Ranking and tie break move in place** `friend`'s 74 at tick 5100 ranks above `explorer`'s 74 at tick 5200 on every open board within 2 seconds, with `Board status` announcing the update message for `friend` at number 1.
- **DP-74 — Filter waits for the last keystroke** Typing in `searchbox "Filter players"` sends one `GET /api/boards/1?player=<text>` 250 ms of page time after the last key, none before, and `Board status` shows the published filtered message.
- **DP-75 — An older filter answer is ignored** With the answer for an older input held and released last, only the latest input's rows and message stay on screen.
- **DP-76 — A failed board load stays visible** When a board load fails, `Board status` shows its failure message and keeps it through later timers and live events until a new load succeeds.
- **DP-77 — The browser cannot set a board score** Adding a score to the outgoing entry request changes nothing, and each row's score, the entry count and the API all equal the `photos` row's total.
- **DP-78 — The whole photo journey with reduced motion** Under reduced motion an explorer keeps worked example 1, reads the result, then follows the same player's sail in a text-world tab, with every task completed and the end states published for normal motion.
- **DP-79 — Photo mode cuts under reduced motion** Under reduced motion C and Home make `data-mode`, `data-yaw`, `data-zoom` and `data-camera` final on the next frame, with `data-guide="drawn"` and no glide.
- **DP-80 — Shutter and figures under reduced motion** Under reduced motion taking a photo starts no running animation on `World view` or its overlays, `data-shutter` stays `idle`, and each figure shows its final text at once with the same `Photo status` announcement.
- **DP-81 — Stillness under reduced motion** With the explorer idle and the tick unchanged, two scene captures 1 second of page time apart are identical, and Space on `Guide creature` raises `data-nudges` and announces with no hop and `data-stretch` at `0.00`.
- **DP-82 — Text world follows the explorer live** With `/text-world` open in a second tab, `Sail to Fernhollow` updates its location line and announces it in `Text world status` within 2 seconds, without a reload or a change of focus.
- **DP-83 — Still fallback without WebGL** Without WebGL `/play` sets `data-state="still"`, shows `img "Still map of Saltmarsh Harbour"`, the exact notice from Feedback states and text-world content with the same progress as the API.
- **DP-84 — Text world content and access** `/text-world` shows every island heading and published creature and progress line, has no axe violations, and its `Refill film` and sail buttons work with no 3D scene.
- **DP-85 — Sound, settings and links in one visit** One visit turns sound on and off, saves settings, follows deep links and Back, and survives a sign-in round trip, with every request from `/play` going to the app's own origin.
- **DP-86 — Sound starts only on request** Before `button "Sound"` is pressed no audio context, source or gain exists; one press makes the published graph with master gain 1 and `aria-pressed="true"`, the next sets master gain 0, and each reload starts off.
- **DP-87 — Settings by keyboard** Setting `Music volume` to 40 by ArrowLeft and `Graphics` to `Light` by keyboard and saving announces the saved message, a second context after reload shows them with `data-preset="light"`, and `?gfx=balanced` overrides one load without saving.
- **DP-88 — Deep links, sailing and Back** `/play?island=3&spot=2` opens on Driftglass Reef at 12,10 facing N and survives reload, sailing adds a history entry, and Back returns to the earlier island and tile without a page reload.
- **DP-89 — Sign-in round trip and unknown spots** A signed-out visit to a deep link returns to that exact path after signing in, a non-local `next` lands on `/play`, and an unknown spot shows the published notice with the address replaced.
- **DP-90 — Private halls answer 404 everywhere** For everyone but `rival`, `rival`'s private hall shows the heading `No gallery here`, and its API, its like route and the image of `rival_private` answer 404.
- **DP-91 — Play continues with storage unreachable** On `storage-down`, a photo shows the photo storage message in `Photo status` with film and storage unchanged, D still walks, the map, album text and text world work, and `GET /api/health` answers 200 with `unavailable`.
- **DP-92 — The landing page performs the product** The title page shows the split headline around a live 35% wide viewfinder on an otherwise empty white first screen, followed by cropped working camera and album fragments carrying `data-ui` as Visual design describes.
- **DP-93 — Islands in natural light** At the `full` preset the islands show a sun and sky following the world hour, soft shadows, water reflecting the sky and explorer, grass swaying and parting, fireflies at dusk, rain rings, and depth of field in photo mode.
- **DP-94 — Lens Up feels like a serious camera** Photo mode shows a stark framing guide whose corners turn red on a creature, equal-width readouts, depth of field following focus, moving shutter bars and a pinned `Scoring` thumbnail before the breakdown appears.
- **DP-95 — The dealt design on every working screen** The HUD, sheets, albums, boards, notice board, ranger queue and postcard form use Albert Sans on white with grey panels, near-square corners, equal-width figures, viewfinder empty states and solid black error bands, with red only on the shutter, focus lock and single action.
- **DP-96 — World and assets from the app's own code** Source shows three.js installed as a bundled dependency and every model, texture and sound generated by the app's code or shipped with a permitted licence and listed in `THIRD_PARTY_NOTICES.md`, with no remote asset reference.
- **DP-97 — Server-only scoring and environment credentials** Source shows score, frame acceptance for storage, weather and creature truth decided on the server with client-sent values ignored, and every service credential read from the environment and never hard-coded or sent to the browser.

## Frontend

### Screens and layout (DP-02, DP-08, DP-13, DP-14, DP-83, DP-84, DP-92)

The published viewports are exactly 375x812, 768x1024 and 1280x800. The phone layout applies below 768 px wide, the tablet layout from 768 to 1199 px, and the desktop layout from 1200 px. No viewport has horizontal overflow, and every control is at least 44 by 44 px at 375x812 and 768x1024.

| Path | What it shows |
|---|---|
| `/` | Title screen: header, split headline around the live viewfinder holding Wump, the pinned reel of working fragments, and the `Islands` section with the five islands. |
| `/signup`, `/signin`, `/confirm` | Single-column forms on white with grey panels. |
| `/play` | World view and HUD, with the map, album and photo result as sheets or panels. |
| `/hall` | Hall editor. |
| `/hall/<handle>` | Read-only walk-through hall beside `Hung photos`. |
| `/board` | Notice board and note form. |
| `/ranger` | Waiting notes, for rangers. A non-ranger sees the `not_ranger` message. |
| `/boards/<island>` | Challenge board for island 1 to 5. |
| `/postcards/<id>` | Public read-only postcard. |
| `/text-world` | Plain headings and lists. |

**Title screen.** At 1280x800 and 768x1024, `Walk softly` sits flush left and `and bring film.` flush right with a 35% wide 16:9 live viewfinder between them. The wordmark sits top left; the links and the small solid red `Start walking` sit top right. On phones the two halves stack around a 4:3 frame. Below that, one section pins the viewfinder fragment while three short statements change its zoom, focus and score, on a single-column sequence of about five parts frame to seven parts page.

**Play page by width.**

| Width | World view and touch controls | Map and album | Photo result |
|---|---|---|---|
| Below 768 px | World view fills the screen. `group "Joystick"` sits bottom left, `Run` and `Jump` bottom right. | Each opens as a full-width bottom sheet, one at a time. | Full-width bottom sheet. |
| 768 to 1199 px | Joystick, `Run` and `Jump` show only when the primary pointer is coarse. | One right side sheet 360 px wide, one at a time. | Right side sheet 360 px wide. |
| From 1200 px | Joystick, `Run` and `Jump` show only when the primary pointer is coarse. | Both side by side in one right panel 40% of the viewport width, split by the separator; album pages sit in two columns. | Right side sheet 360 px wide. |

Album pages sit in two columns at every width. Below 1200 px the map and album sheets are modal: Tab wraps inside them. From 1200 px the panel is not modal. `Map`, `M`, `Album` and `J` all open the panel with focus on the map or the album, and `Close map` and `Close album` both close the whole panel.

**Map contents.** `Island map`, one `Sail to <Island name>` button for each other island, `Start a shared safari`, `Join a safari` and the `Notice board` link. The `Island map` 24 by 24 grid fills a square. `data-tile-size` gives whole px per tile, and tile `x,y` covers x times that size to (x + 1) times it from the map's left edge, and the same from its top edge.

**Album contents.** `tablist "Islands"`, the `album-pages` figure, `list "Album pages"` with each creature's page, `Refill film`, the `Your hall` and `Challenge board` links.

**Safari region.** Once the player is in a safari, `region "Safari"` shows on the play page with the code, `list "Sightings"`, `log "Safari feed"` and `End safari` or `Leave safari`, in a compact scrollable strip under the HUD on phones and at the lower left from 768 px.

**Without WebGL.** `/play` shows the fallback described for DP-83 in place of the World view: the still map image, the notice from Feedback states and the text world content.

**Hall pages.** On phones the walk-through sits above `Hung photos`. From 768 px they sit side by side. The hall editor is a single list with `Your photos` below it on phones and beside it from 768 px.

### Public screens and controls (DP-02, DP-03, DP-16, DP-30, DP-44, DP-51, DP-58, DP-72, DP-86, DP-87)

Only these roles, names and hooks are public. Everything else is free.

| Screen | Role and accessible name | Notes and visible copy |
|---|---|---|
| Title | `link "Hushfoot"`, `link "Islands"`, `link "Text world"`, `link "Start walking"` | `Start walking` goes to `/play`. |
| Title | `link "Sign in"` when signed out; `button "Account"` when signed in | `Account` shows the player's name and opens `menu "Account"` with `menuitem "Your hall"`, `menuitem "Sign out"` and the player's film count. |
| Title | `application "Guide creature"`, `button "Reset view"`, `slider "Demo zoom"`, `slider "Demo focus"` | `Guide creature` carries `data-spin` (whole degrees 0 to 345), `data-zoom` (two decimals, 0.50 to 2.00), `data-stretch` (two decimals, 0.00 to 1.00), `data-nudges` (whole number), `data-state`. |
| Title, play, hall | `button "Sound"` | aria-pressed. |
| Sign-up | `textbox "Name"`, `textbox "Email"`, field labelled `Password`, `button "Create account"` | |
| Sign-in | `textbox "Email"`, field labelled `Password`, `button "Sign in"`, `link "Create an account"` | |
| Confirm | `textbox "Confirmation code"`, `button "Confirm"`, `button "Send a new code"`, `link "Later"` | |
| Play | `application "World view"`, `link "Skip to the text world"`, `timer "World time"` | `World time` shows `HH:MM`. |
| Play | `button "Camera"` (aria-pressed), `button "Map"`, `button "Album"`, `button "Settings"`, `button "Restart expedition"`, `button "Run"` (aria-pressed), `button "Jump"`, `group "Joystick"` | |
| Photo mode | `button "Zoom in"`, `button "Zoom out"`, `button "Focus"`, `button "Take photo"` | Shown in photo mode at every width. |
| Photo result | `dialog "Photo result"`, `button "Close"`, `button "Send as postcard"` | Rows Size, Centring, Facing, Sharpness and total. |
| Map | `dialog "Map"` below 1200 px, `complementary "Map and album"` from 1200 px, `application "Island map"`, `button "Close map"`, `button "Sail to <Island name>"`, `button "Start a shared safari"`, `button "Join a safari"`, `link "Notice board"` | `Island map` carries `data-cursor` (`x,y`) and `data-tile-size`. |
| Map and album | `separator "Resize map and album"` | `aria-valuenow` is the map pane width percent, 30 to 70, start 50. |
| Album | `dialog "Album"` below 1200 px, `tablist "Islands"`, `tab "<Island name>"`, `list "Album pages"`, `img "<Creature name> photo"`, `button "Send <Creature name> photo as a postcard"`, `button "Refill film"`, `button "Close album"`, `link "Your hall"`, `link "Challenge board"` | `Refill film` is enabled only on Saltmarsh Harbour while film is below 36. An unfilled page says `Not photographed yet.` |
| Restart | `alertdialog "Restart the expedition?"`, `button "Restart"`, `button "Keep playing"` | Its sentence reads `Start the whole expedition again?` |
| Settings | `dialog "Settings"`, `slider "Music volume"`, `slider "Effects volume"`, `radiogroup "Graphics"` with `radio "Full"`, `radio "Balanced"`, `radio "Light"`, `button "Save settings"` | Sliders run 0 to 100 in steps of 5. |
| Safari | `dialog "Join a safari"`, `textbox "Safari code"`, `button "Join"`, `region "Safari"`, `list "Sightings"`, `log "Safari feed"`, `button "End safari"`, `button "Leave safari"` | Host sees `Safari code <CODE>`. |
| Hall editor | `list "Hall order"`, `switch "Public hall"`, `button "Save hall"`, `list "Your photos"`, `button "Hang <Creature name> photo"`, `button "Take down <Creature name> photo"`, `button "Move <Creature name> photo up"`, `button "Move <Creature name> photo down"`, `textbox "Caption for <Creature name> photo"` | `Hall order` items are focusable and named `<Creature name> photo, frame <n>`. Each shows a `likes` figure. |
| Hall visit | `application "Gallery hall"`, `list "Hung photos"`, `button "Like <Creature name> photo"` (aria-pressed), `button "View <Creature name> photo"`, `dialog "Photo viewer"` | `Gallery hall` carries `data-step`, `data-tile`, `data-heading`, `data-gait`, `data-preset`, `data-state`. `Photo viewer` carries `data-zoom`, 1 to 4. A private or unknown hall shows heading `No gallery here`. |
| Board | `textbox "Your note"`, `button "Pin note"`, `list "Notice board"`, `button "Remove note"` | `Remove note` is for rangers. An author's unapproved note reads `Waiting for a ranger`. |
| Ranger | `list "Waiting notes"`, `button "Approve"`, `button "Decline"`, `dialog "Decline note"`, `radiogroup "Reason"` with `radio "Not about the islands"`, `radio "Unkind"`, `radio "Shares personal details"`, `button "Decline note"` | |
| Postcard | `dialog "Send postcard"`, `textbox "Recipient email"`, `textbox "Your line"`, `button "Post"` | A public page shows `Sent by <sender name>`. An unknown postcard shows heading `No postcard here`. |
| Boards | `table "Challenge board"` with columns Rank, Player, Creature, Score, `button "Enter a photo"`, `dialog "Enter a photo"`, `radiogroup "Your photos"`, `button "Enter photo"`, `searchbox "Filter players"` | `Your photos` holds one `radio "<Creature name> photo, <total>"` for each of the player's kept photos taken on that board's island, highest total first. |
| Text world | `button "Sail to <Island name>"`, `button "Refill film"` | Headings and lists as in Business rules. |
| No WebGL | `img "Still map of <Island name>"` | |

**Hooks on `application "World view"`**, each with one format:

| Attribute | Format |
|---|---|
| `data-step` | Steps simulated since ready. |
| `data-tick` | The world tick the server last sent. |
| `data-island` | 1 to 5. |
| `data-tile` | `x,y`. |
| `data-heading` | `N`, `E`, `S` or `W`. |
| `data-gait` | `idle`, `walk`, `run` or `jump`. It reads `walk` or `run` on a step where a direction is held or a path is being walked, even when blocked, and `jump` through the fourth jump step. |
| `data-mode` | `explore` or `photo`. |
| `data-yaw` | Camera yaw in whole degrees 0 to 359; 0 looks north, 90 east. At load it is the heading's angle. |
| `data-zoom` | Explore: whole numbers 1, 2, 3 or 4, default 2. Photo: 1, 2 or 4. |
| `data-focus` | Photo: 2, 4, 8 or 16. Empty in explore. |
| `data-in-view` | Photo mode: in-frame creature ids by the frame rule, nearest first, comma separated. Empty when none and in explore mode. |
| `data-creatures` | Every creature present on this island at `data-tick` as `<id>@<x>,<y>,<heading>`, sorted by id, joined by `;`. |
| `data-world-hour` | 0 to 23. |
| `data-weather` | `clear` or `rain`. |
| `data-lighthouse` | `open` or `closed`. |
| `data-preset` | `full`, `balanced` or `light`. |
| `data-state` | `loading`, `ready` or `still`. |
| `data-camera` | Camera position then look target as six numbers with two decimals, comma separated, updated every animation frame. |
| `data-guide` | `hidden`, `drawing` or `drawn`. |
| `data-shutter` | `idle`, or `moving` while the shutter bars run. |
| `data-host-island`, `data-host-tile` | The host's live position on a guest's page, in the `data-island` and `data-tile` formats. Empty otherwise. |

Movement hooks update on every step; server hooks update inside the live message handler. The page may evaluate the frame rule on server-sent positions for `data-in-view` and `Frame guide`, and never computes or previews a score.

**Figures.** Count-up figures carry `data-figure` and are hidden from assistive technology because announcements carry the values. Final texts:

| `data-figure` | Final text |
|---|---|
| `score-total` | `<n> / 100` |
| `score-size`, `score-centring`, `score-facing`, `score-sharpness` | `<n>` |
| `film` | `<n> frames`, `1 frame` when one |
| `stamps` | `<n> stamps`, `1 stamp` when one |
| `album-pages` | `<n> of 4 pages` |
| `likes` | `<n> likes`, `1 like` when one |

`film` and `stamps` show on the play HUD at all times.

### Interactions (DP-03 to DP-07, DP-09 to DP-13, DP-16, DP-17, DP-20, DP-40, DP-41, DP-44 to DP-46, DP-51, DP-53, DP-60, DP-65, DP-72, DP-74, DP-75, DP-82, DP-88, DP-89)

**Page time.** The verifier pauses the page clock and blocks service workers. Every client timer, tween, debounce and count-up runs on page timers (timeouts, intervals, animation frames, `performance.now`), so advancing the page clock drives them. Nothing waits for a CSS transition event. There is no service worker, no Web Worker game loop and nothing driven by the audio clock. "Page time" in this brief means this clock.

**Simulation.** The page simulates the explorer in fixed steps of 100 ms of page time, counted from when the World view became ready, on animation frames with `performance.now`. A late frame runs every step it owes, in order. Each step reads keys and on-screen buttons as they were at that step's own moment: a key counts as held for a step when it went down before the step's moment and came up at or after it. So holding a key for exactly N x 100 ms of page time always gives N held steps, whatever the frame rate, and the same keys over the same steps always land on the same tile. The walk grid and movement outcomes are in Business rules.

**Immediate UI.** UI changes that are not movement (a sheet opening, focus moving, a button state, a yaw or zoom key, a turn in photo mode) happen in the event handler itself, with no page time needed, unless this brief states a duration.

**Live transport.** Live changes (world tick, creatures, weather, likes, safari moves, sightings and photos, notes, board entries, the same player's progress in another tab) arrive over one same-origin server-sent events stream at `GET /api/live` and are applied to the DOM and announced inside its message handler, without waiting for a page timer or animation frame. They reach every open page within 2 seconds of real time. Only motion a live change starts (a count-up) runs on page time. A live change never replaces a list wholesale, never moves focus or scroll position and never closes or resets an open panel, draft or dialog.

**Keyboard table.** Game keys act only while `World view` has focus. Tab and Shift+Tab move in and out of it normally.

| Context | Key | Effect |
|---|---|---|
| World view, explore | W or ArrowUp | North (hold to keep moving) |
| | A or ArrowLeft | West |
| | S or ArrowDown | South |
| | D or ArrowRight | East |
| | R | Toggles run |
| | Shift held | Runs |
| | Space | Jumps |
| | Q, E | Orbit the camera 90 degrees left and right (`data-yaw` - 90 and + 90, mod 360) |
| | +, - | `+` adds 1 to `data-zoom` and `-` subtracts 1, stopping at 4 and at 1; from the default 2, `+` gives 3 |
| | Home | Camera behind the explorer (`data-yaw` is the heading's angle, `data-zoom="2"`) |
| | C | Enters photo mode |
| | M, J | Open the map, the album |
| World view, photo | Direction keys | Only turn the explorer, on key press |
| | Q, E | Turn the explorer 90 degrees left and right |
| | +, - | Step the zoom through 1, 2, 4 |
| | F | Cycles focus 2, 4, 8, 16 |
| | Enter | Takes the photo |
| | C or Escape | Leaves photo mode |
| Any open sheet or dialog | Escape | Closes the top one, focus back on the control that opened it (`World view` for sheets opened by keys) |
| `Guide creature` | ArrowLeft, ArrowRight, Q, E | Spin Wump 15 degrees (`data-spin`) |
| | +, - | Change `data-zoom` by 0.25 between 0.50 and 2.00 |
| | Space | Nudges (`data-nudges` + 1) |
| | Home | Same as `Reset view`: spin 0, zoom 1.00, stretch 0.00 |
| `Island map` | Arrows | Move the cursor one tile; it starts on the explorer's tile |
| | Enter | Walks there |
| | S | Host marks a sighting at the cursor during a shared safari; does nothing for anyone else |
| | Escape | Closes the map |
| Hall editor item | Alt+ArrowUp, Alt+ArrowDown | Move the focused photo one frame up or down |
| `Gallery hall` | The walk keys, R, Shift and Space | As explore; the position is not saved |
| `Photo viewer` | +, -, Escape | Step `data-zoom` 1 to 4; close |
| `Resize map and album` | ArrowLeft, ArrowRight | Change it by 5 |
| | Home, End | Go to 30 and 70 |
| `tablist "Islands"` | ArrowLeft, ArrowRight | Move across island tabs |

Every sheet and dialog named as modal wraps Tab and Shift+Tab inside itself and takes focus when it opens: the selected tab in the album, `Island map` in the map, `Close` in the photo result, the first field or control elsewhere.

**Title screen Tab order.** 1 `Hushfoot`, 2 `Islands`, 3 `Text world`, 4 `Sign in` or `Account`, 5 `Start walking`, 6 `Guide creature`, 7 `Reset view`, 8 `Sound`, 9 `Demo zoom`, 10 `Demo focus`.

**Play HUD Tab order.** 1 `Skip to the text world`, 2 `World view`, 3 `Camera`, then in photo mode only `Zoom in`, `Zoom out`, `Focus`, `Take photo`, then 4 `Map`, 5 `Album`, 6 `Sound`, 7 `Settings`, 8 `Restart expedition`, then `Run` and `Jump` when visible.

**Guide creature by pointer and touch.** Horizontal drag spins Wump 15 degrees per 20 px. Drag distance divided by 200 px, capped at 1, sets `data-stretch` while the pointer is down, and on release it springs back to 0.00 within 600 ms of page time. Two fingers pinching change `data-zoom` in its steps of 0.25, one step per 40 px.

**Walking on request.** Enter on the `Island map` cursor, a click or tap on a map tile, or a click or tap on land in the World view walks the explorer. A press that moves less than 6 px counts as a click. The map stays open while the explorer walks. Paths and stops are in Business rules.

**Touch and pointer.** A touch that starts on the Joystick and moves 16 px or more holds the compass direction of its larger movement (up = north) until the finger lifts, exactly like holding that key. On the World view in explore mode, two touches moving sideways together orbit the camera by 1 degree per 2 px of the midpoint's movement, and a one-finger pointer drag orbits the same way on every device. Moving right adds to `data-yaw` and moving left subtracts. During one gesture `data-yaw` is its value at the gesture's start, plus or minus the gesture's net sideways px divided by 2 with halves rounded up to a whole degree, mod 360. For example, 61 px right from yaw 90 gives 121, and 61 px left gives 59. In photo mode `data-yaw` always stays the heading's angle: sideways gestures and drags change nothing there, and the Joystick turns the explorer as the direction keys do. On the World view in either mode, the distance between two touches growing by each 40 px steps `data-zoom` one value up and shrinking by each 40 px steps it one value down, through 1, 2, 3, 4 in explore mode and 1, 2, 4 in photo mode, stopping at each end.

**Lens Up.**

1. C, `Camera` or a right click enters photo mode. `data-mode="photo"` at once, `data-yaw` the heading's angle, `data-zoom="1"`, `data-focus="4"`. C, Escape or `Camera` leaves it and restores the explore yaw and zoom.
2. Enter or `Take photo` takes the photo. In the handler the page renders one frame, captures the canvas at no more than 960 px wide as PNG or JPEG, and sends `POST /api/photos` with `tick` equal to `data-tick` and a new `Shot-Key`.
3. Presses while a photo is scoring are ignored, so two Enter presses send one photo.
4. The answer opens the result, or shows the refusal with no result open. Result rows show the server's measurement beside the points. Figures start counting when the answer arrives. The result dialog stays open with its text intact until the player closes it.

**Hall editor.** Each `Move` button and Alt+Arrow move announce and keep focus on the moved photo. `Public hall` applies at once. `Save hall` stores order and captions.

**Hall likes.** `Like` toggles and acts on the button's current state. A second tab's button shows pressed within 2 seconds because the like reaches it live. A signed-out visitor pressing `Like` goes to the sign-in round trip.

**Safari code.** Typed codes are upper-cased before they are sent. Enter in `Safari code` presses `Join`.

**Postcard and note.** `Post` and `Pin note` ignore presses while their request is pending, and each draft carries one `Request-Key`. On success the postcard dialog closes with focus back on its opener, and the note box empties with focus kept on it.

**Filter.** `Filter players` sends its request 250 ms of page time after the last keystroke. An answer for an older input is ignored. A failed load's message stays through later timers until a new load succeeds.

**Links.** The deep link `/play?island=<n>&spot=<m>` (n 1 to 5, m 1 to 4) puts the explorer on that spot and saves it on every load of that address, so reload keeps it. Plain `/play` opens on the saved position. Sailing from the map puts the explorer on spot 1 of that island, sets the address to `/play?island=<n>&spot=1` and adds a history entry; Back returns to the island and tile the explorer sailed from without a reload. Walking never changes the address. A signed-out visitor to a signed-in page goes to `/signin?next=<local path>` and returns to that exact path after signing in; a `next` that is not a local path (one not starting with a single `/`) lands on `/play`. An unknown island or spot shows its notice and replaces the address with `/play?island=1&spot=1`. Graphics overrides: `?gfx=light`, `?gfx=balanced` or `?gfx=full` on any play or hall URL selects that preset for that page load without saving it.

### Visual design (DP-92, DP-94, DP-95)

The direction is "the product performs": the interface is the working tool, shown doing its job. Albert Sans is both the display and the body typeface, bundled with the app. Each heading step is a quarter larger than the one below it. Density is comfortable.

Colour roles: pure white ground; pale neutral grey surface for filled panels; near-black ink; mid grey for muted text; signal red accent, with white on it. Red appears only on the shutter, the focus lock and the single main action of a screen.

The mood is blunt, alert and patient. Interface slabs are solid white or solid black, with no glass. Most of the first screen is empty white around one live frame. A family wildlife world in full natural colour gets stark white, black and red chrome as blunt as a camera body, with no cute rounded game interface. The creatures and the light are the only soft things on screen.

**Composition.** Every interface surface on the landing page is a cropped working piece of the camera or album at its true small working size, set on the single-column sequence. Those fragments carry `data-ui`. CC0 coast photographs, bundled and listed in the notices, supply the only pictures of the outdoor world around them; if none can be obtained, scenes rendered from the world take their place.

**Hero.** `Walk softly` flush left, `and bring film.` flush right, the live viewfinder between, holding Wump, an invented moss-backed tide-newt. The reel steps through a working zoom and focus fragment, a score breakdown and an album page.

**Working screens.** Albums, boards, the notice board, the ranger queue and the postcard form use Albert Sans on white with grey filled panels. Every score, film count and tick uses equal-width digits. Frames and controls have near-square corners of about 4 px; the round joystick is the one exception. Empty states show an empty viewfinder frame with one plain sentence. Errors are a solid black band with white text and the published copy. Loading shows the frame's guide corners, never a grey skeleton. The text world uses the same type as plain headings and lists. Every text and control meets WCAG 2.2 AA contrast. Controls are large enough to tap comfortably, at least 44 px.

### Motion and effects (DP-04, DP-19, DP-33, DP-79 to DP-81, DP-93, DP-94)

All moves start quickly and settle softly.

| Motion | Meaning | Timing and behaviour |
|---|---|---|
| View to eye | Entering photo mode | `data-camera` moves to the explorer's eye over 320 ms of page time. |
| Framing guide | Ready to frame | `data-guide` reads `drawing` while the centre box and corners draw over 180 ms, then `drawn`. Corners turn red while a creature is in frame. |
| Shutter bars | Photo taken | `data-shutter` reads `moving` while the bars close and open over 210 ms, then `idle`. The shot then pins to a corner as a thumbnail labelled `Scoring` until the answer. |
| Figures | Value changed | Count from the previous value to the new one over 600 ms of page time: strictly between the two at 300 ms when they differ by 2 or more, exact final text at 600 ms and after. Score figures count from 0 when the result opens. First paint of a page shows values without counting. |
| Sheets | Open and close | Slide in and out in under a third of a second, moved by script on page time. |
| Wump | Hop and stretch | Space makes a hop of under half a second. Stretch springs back within 600 ms. Idle: one slow breath every 3 to 5 seconds. |

**Signature, step by step.** Pressing C, `Camera` or right click moves the view from the orbit camera to the explorer's eye. The guide draws. Zoom and focus readouts change in equal-width figures and the depth-of-field blur on the canvas follows focus. When a creature is inside the frame the corners turn red and the label names it, with no score shown. Taking the photo runs the shutter bars. The thumbnail pins. The server's answer opens the breakdown, whose rows and film figure count together. A refused shot shows its refusal, no score and an unchanged film count.

**Landing reel.** As the visitor scrolls through the pinned section, the three statements advance the fragment's zoom, then focus, then score; scrolling back reverses them step by step. Under reduced motion the three states appear as a static stack.

**World.** The 3D scene renders with three.js from the app's own origin. Sun and sky follow the server's world hour. Shadows are soft. Water reflects the sky and the explorer. Grass sways in a cycle of 2 to 4 seconds and parts around the explorer. Fireflies show only at dusk. Rain rings mark the water only while it rains. Depth of field shows only in photo mode. None of it blocks a control or the text world.

**Graphics presets.**

| Preset | What it shows |
|---|---|
| `full` | The default and the look above. |
| `balanced` | No reflections, simpler shadows. |
| `light` | No shadows, flat water, no grass sway, no particles, no depth of field. Islands, explorer and creatures still render. |

No other decorative loop exists. A one-finger drag orbits the camera also under reduced motion.

**Reduced motion.** Entering and leaving photo mode and Home cut at once: hooks and `data-camera` are final on the next frame, with no glide, and `data-guide` reads `drawn` at once. The shutter has no flash or shake: `data-shutter` stays `idle` and no animation runs on the World view or its overlays when a photo is taken. Every figure shows its final text at once. Wump does not hop and its stretch returns at once. Wump's breath, grass sway, fireflies and rain streaks stop, so with the explorer idle and the world tick unchanged two captures 1 second of page time apart are identical. Every task stays possible and every announcement is the same.

### Feedback states (DP-18, DP-37, DP-44, DP-47, DP-51, DP-53, DP-55, DP-59, DP-61 to DP-63, DP-65, DP-68, DP-69, DP-72, DP-73, DP-76, DP-83, DP-89)

Errors from the API show their `message` from the API error catalogue, in a solid black band, in the region the error map below names. These are the only live regions. All have role `status` except `Safari feed`, a `log`. They stay in the page and in the accessibility tree whether or not their panel is open.

`World status`, `Gallery status`, `Safari status` and `Notes status` keep their last five messages as separate lines, oldest first, so that messages close together never overwrite each other. `Photo status` shows only the current photo's messages, and a new photo clears it. Every other region shows only its latest message.

| Region | Messages (`<n>` and names are live values) |
|---|---|
| `World status` | `You are on <Island name>. <n> of 4 album pages filled.` (on load and on arrival) |
| | `Stamp earned for <Island name>. You have <n> stamps.` |
| | `The lighthouse at Lantern Point is open.` |
| | `Rain begins on the islands.` |
| | `The rain stops.` |
| | `Dusk falls on the islands.` |
| | `Dusk is over.` (these four only on a change while the page is open) |
| | `No path to that spot.` |
| | `Expedition restarted. You are on Saltmarsh Harbour.` |
| | `That spot doesn't exist. You are at Saltmarsh Harbour, spot 1.` |
| | `You spot a <Creature name>.` (the first time a present creature is within 6 tiles of the explorer in both axes since the explorer arrived on the island) |
| | `Film refilled to 36 frames.` |
| `Photo status` | Pending `Scoring…` |
| | Success `<Creature name>: <total> points. Size <s>, centring <c>, facing <f>, sharpness <p>.`, then when a page newly filled, `Album page filled: <Creature name>.` |
| | Network failure `Couldn't reach the islands. Try again.` |
| | Refusals and the storage outage show their catalogue message. |
| `Frame guide` | `<Creature name> in frame` for the first id in `data-in-view`, else `No creature in frame` |
| `Guide status` | `Wump faces <deg> degrees.`, `Wump at <percent> percent.`, `Wump hops.`, `Wump is back at rest.` |
| `Gallery status` | `<Creature name> photo moved to frame <n> of <total>.` |
| | `Hall saved.`, `Saving hall…`, `Hall is now public.`, `Hall is now private.` |
| | `Liked <Creature name> photo.`, `Like removed from <Creature name> photo.` |
| | `<visitor name> liked your <Creature name> photo.` (on the owner's open hall pages) |
| `Safari status` | `Safari started.`, `Safari ended.` |
| | `You joined <host name>'s safari.`, `<guest name> joined your safari.`, `<guest name> left. The guest seat is free.` |
| | `Sighting at <x>, <y> by <host name>` |
| `Safari feed` | `<host name> photographed <Creature name>: <total> points.` with `img "<Creature name> photo by <host name>"` |
| `Notes status` | `Pinning…`, `Note pinned.`, `Note approved.`, `Note declined.`, `Note removed.` |
| | `New note on the board.` |
| | `Your note is on the board.` |
| | `Your note was declined: <reason>.` |
| `Board status` | `<n> entries` (`1 entry`) |
| | `Showing <n> of <m> entries for “<text>”.` (always `entries`) |
| | `Couldn't load the board. Try again.` |
| | `Board updated. <player name> is now number <rank>.` |
| | `Your <Creature name> photo is entered.` |
| `Postcard status` | `Posting…`, `Postcard posted.` |
| `Settings status` | `Settings saved.`, `Couldn't save settings. Try again.` |
| `Text world status` | The location line, whenever it changes; `Film refilled to 36 frames.` |
| `Account status` | `Email confirmed.`, `New code sent.`, `Couldn't send the code. Press Send a new code to try again.` |

**Error map.** Each catalogue code a screen can show appears in this region:

| Region | Codes |
|---|---|
| `Account status` | On sign-up and sign-in: `bad_credentials`, `email_taken`, `bad_name`, `bad_email`, `bad_password`. On Confirm: `bad_code`, `code_expired`, and `mail_unavailable` with its new-code copy. |
| `Photo status` | `photo_too_large`, `not_an_image`, `out_of_film`, `shot_key_reused`, `bad_pose`, `tick_passed`, `tick_ahead`, `cannot_stand`, `camera_too_far`, `nothing_in_frame`, and `storage_unavailable` with its photo copy. |
| `World status` | On the play page: `not_land`, `not_at_harbour`, `film_full`. |
| `Text world status` | On `/text-world`: `not_at_harbour`, `film_full`. |
| `Gallery status` | `own_photo`, `hall_full`, `caption_too_long`. |
| `Safari status` | `no_safari`, `safari_full`, `safari_ended`, `own_safari`, `not_host`. |
| `Notes status` | `not_ranger`, `note_decided`, `note_not_approved`, `note_empty`, `note_too_long`, `bad_reason`, and from `Pin note`: `unconfirmed`, `request_key_reused`. |
| `Board status` | From `Enter photo`: `unconfirmed`, `wrong_island`. |
| `Postcard status` | `unconfirmed`, `request_key_reused`, `bad_email`, `line_empty`, `line_too_long`, `postcard_limit`, and `storage_unavailable` and `mail_unavailable` with their postcard copy. |

Any other code shows in the region of the screen where the action was made: `World status` on the play page, its map and its album; `Gallery status` on hall pages; `Notes status` on `/board` and `/ranger`; `Board status` on `/boards/<island>`; `Settings status` in `Settings`; `Text world status` on `/text-world`; `Account status` on `/signup`, `/signin` and `/confirm`. The image and grading-world copy of `storage_unavailable` is an API answer only and shows in no region.

**Placeholders.** `<total>`, `<s>`, `<c>`, `<f>` and `<p>` are the server's score numbers. `<deg>` is `data-spin`. `<percent>` is `data-zoom` times 100, whole. `<Island name>` and `<Creature name>` come from Seed data. `<host name>`, `<guest name>`, `<visitor name>`, `<player name>` and `<ranger name>` are those players' names. `<rank>` is the full-board rank. `<text>` is the filter text as typed. `<reason>` is the chosen radio's label. `<limit>` is the configured limit.

**Other visible copy.**

- No-WebGL notice: `3D is not available here. The text world below has everything.`
- Empty states: `No photos hung yet.`, `No entries yet.`, `No notes yet.`, `No notes waiting.`
- Text world without a session: `Sign in to see your progress.`

Field errors on sign-up, sign-in and confirm appear in `Account status` with the field marked invalid and focused. `Send a new code` announces `New code sent.` only after Mailpit accepted the message.

## Backend

### API (DP-23, DP-26, DP-35, DP-55, DP-61, DP-69, DP-90)

All bodies are JSON except the photo upload, and JSON bodies are at most 64,000 bytes, exactly that size allowed. Unknown paths answer `404`.

**Error rule, for the whole API.** Check in this order: 401 when not signed in; then 404 for an unknown record or one the caller may not see (a private hall, another player's unshown photo: 404, never 403); then 403 for a visible action the caller may not take; then 413; then 415; then 409 for state conflicts; then 422 for validation and photo refusals; then 429 for rate limits, with `Retry-After` in seconds; then 503 for an unreachable dependency. A replay of a request key with the same content returns its stored response right after the 401 check, before any other check. One body shape: `{"error": "<code>", "message": "<exact copy>"}`.

**Error catalogue.**

| Status | `error` | `message` |
|---|---|---|
| 401 | `not_signed_in` | `Sign in first.` |
| 401 | `bad_credentials` | `That email and password don't match.` |
| 403 | `unconfirmed` | `Confirm your email to post postcards, pin notes and enter boards.` |
| 403 | `not_ranger` | `Only rangers can do that.` |
| 403 | `not_host` | `Only the host can do that.` |
| 403 | `own_photo` | `You can't like your own photo.` |
| 403 | `bad_origin` | `That request came from another site.` |
| 404 | `not_found` | `Nothing here.` |
| 404 | `no_safari` | `No safari with that code.` |
| 413 | `photo_too_large` | `Photos can be at most <limit> bytes.` (`<limit>` with thousands separators, for example `2,000,000`) |
| 413 | `too_large` | `That request is too large.` |
| 415 | `not_an_image` | `Photos must be PNG or JPEG images.` |
| 409 | `out_of_film` | `Out of film. Refill at Saltmarsh Harbour.` |
| 409 | `shot_key_reused` | `That shot key was already used for another photo.` |
| 409 | `request_key_reused` | `That request key was already used for something else.` |
| 409 | `email_taken` | `That email already has an account.` |
| 409 | `safari_full` | `That safari is full.` |
| 409 | `safari_ended` | `That safari has ended.` |
| 409 | `own_safari` | `You are the host of this safari.` |
| 409 | `note_decided` | `Already <approved|declined> by <ranger name>.` |
| 409 | `note_not_approved` | `Only an approved note can be removed.` |
| 409 | `not_at_harbour` | `Refill film works only on Saltmarsh Harbour.` |
| 409 | `film_full` | `Your film is already full.` |
| 422 | `tick_passed` | `That moment has passed. Photo refused.` |
| 422 | `tick_ahead` | `That moment hasn't happened yet. Photo refused.` |
| 422 | `cannot_stand` | `No one could stand there. Photo refused.` |
| 422 | `camera_too_far` | `The camera was too far from the explorer. Photo refused.` |
| 422 | `nothing_in_frame` | `No creature in frame. Photo refused.` |
| 422 | `bad_pose` | `That photo's details aren't valid.` |
| 422 | `not_land` | `That tile isn't land.` |
| 422 | `bad_name` | `Enter a name of 1 to 40 characters.` |
| 422 | `bad_email` | `Enter a valid email address.` |
| 422 | `bad_password` | `Use a password of at least 8 characters.` |
| 422 | `bad_code` | `That code isn't right.` |
| 422 | `code_expired` | `That code has expired. Send a new one.` |
| 422 | `note_empty` | `Write a note first.` |
| 422 | `note_too_long` | `Notes can be at most 140 characters.` |
| 422 | `bad_reason` | `Choose a reason.` |
| 422 | `line_empty` | `Write a line for your postcard.` |
| 422 | `line_too_long` | `Postcard lines can be at most 140 characters.` |
| 422 | `caption_too_long` | `Captions can be at most 140 characters.` |
| 422 | `hall_full` | `A hall holds 12 photos.` |
| 422 | `wrong_island` | `That photo wasn't taken on this island.` |
| 422 | `bad_request` | `That request isn't valid.` |
| 429 | `postcard_limit` | `You can send <limit> postcards an hour. Try again later.` |
| 503 | `storage_unavailable` | Photo: `Storage unreachable. Photo not kept, and your frame is still on the roll.` Postcard: `Storage unreachable. Postcard not sent.` Image and grading world: `Storage unreachable. Photo not available.` |
| 503 | `mail_unavailable` | Postcard: `Mail unreachable. Postcard not sent.` New code: `Mail unreachable. No code sent.` |
| 503 | `database_unavailable` | `The islands are unreachable. Try again soon.` |

**Shared shapes.** `player` is `{"id","name","handle","email","confirmed","ranger"}`, and `email` appears only in the player's own answers. `score` is `{"size","centring","facing","sharpness","total"}`. Tiles in JSON are `[x, y]`.

| Method and path | Request | Success | Own errors |
|---|---|---|---|
| `GET /api/health` | | `200` as in Configuration | Never another status |
| `POST /api/signup` | `{"name","email","password"}` | `201 {"player","code_sent":<bool>}`, sets session cookie, mails the code | 409 `email_taken`; 422 `bad_name`, `bad_email`, `bad_password` |
| `POST /api/session` | `{"email","password"}` | `200 {"player"}`, sets session cookie | 401 `bad_credentials` |
| `DELETE /api/session` | | `204` | |
| `POST /api/confirm` | `{"code"}` | `200 {"player"}`; repeat when already confirmed also `200` | 422 `bad_code`, `code_expired` |
| `POST /api/confirm/resend` | `{}` | `200 {"sent":true}` after Mailpit accepted | 503 `mail_unavailable` |
| `GET /api/me` | | `200 {"player","position":{"island","tile","heading"},"film","stamps","lighthouse","settings"}` | |
| `PUT /api/me/position` | `{"island","tile","heading"}` | `200 {"position"}` | 422 `not_land` |
| `GET /api/me/albums` | | `200 {"albums":[{"island","island_name","pages":[{"creature","creature_name","filled","photo_id","total"}],"pages_filled","stamp"}],"stamps","lighthouse","film"}` | |
| `POST /api/me/refill` | `{}` | `200 {"film":36}` | 409 `not_at_harbour`, `film_full` |
| `POST /api/me/restart` | `{}` | `200 {"position","film":36,"stamps":0,"lighthouse":"closed"}` | |
| `GET`, `PUT /api/me/settings` | PUT `{"music","effects","graphics"}` | `200 {"settings":{"music","effects","graphics"}}` | 422 `bad_request` |
| `GET /api/world` | | `200 {"world":"<id>","tick","hour","minute","time":"HH:MM","weather","dusk":<bool>,"lighthouse","creatures":[{"id","name","island","size","x","y","heading"}]}`, every present creature on all five islands sorted by id; query parameters are ignored | |
| `GET /api/live` | | `200 text/event-stream` | |
| `POST /api/photos` | Multipart: part `image`, part `pose` = JSON `{"island","tile":[x,y],"camera":[x,y],"heading","zoom","focus","tick"}`; optional header `Shot-Key` | `201` below | Below |
| `GET /api/me/photos` | | `200 {"photos":[<photo>]}` | |
| `GET /api/photos/<id>` | | `200 {"photo"}` | 404 `not_found` |
| `GET /api/photos/<id>/image` | | `200` image bytes, not cached, no sign-in needed | 404 `not_found`; 503 `storage_unavailable` |
| `GET /api/me/hall` | | `200 {"hall":{"handle","public","frames":[{"frame","caption","photo","likes"}]}}` | |
| `PUT /api/me/hall` | `{"public":<bool>,"frames":[{"photo","caption"}]}`, either key optional | `200 {"hall"}` | 404 `not_found`; 422 `hall_full`, `caption_too_long` |
| `GET /api/halls/<handle>` | No sign-in needed | `200 {"hall":{"handle","owner_name","frames":[{"frame","caption","photo","likes","liked_by_me"}]}}` | 404 `not_found` |
| `PUT`, `DELETE /api/photos/<id>/like` | `{}` | `200 {"likes":<n>,"liked":<bool>}`, unchanged when repeated | 404 `not_found` (not hung in a hall the caller may see); 403 `own_photo` |
| `POST /api/safaris` | `{}` | `201 {"safari":{"code","status":"open","host","guest":null}}`; `200` with the same safari when the host already has one open or joined | |
| `GET /api/safaris/current` | | `200 {"safari":{"code","status","host","guest","sightings":[{"island","x","y","by"}]}}`, or `{"safari":null}` | |
| `POST /api/safaris/<code>/join` | `{}` | `200 {"safari"}`; repeat by the seated guest also `200` | 404 `no_safari`; 409 `safari_full`, `safari_ended`, `own_safari` |
| `POST /api/safaris/<code>/sightings` | `{"island","tile"}` | `201 {"sighting":{"island","x","y","by"}}` | 403 `not_host`; 409 `safari_ended` |
| `POST /api/safaris/<code>/leave` | `{}` | `200 {"safari"}` | 403 `not_host` is not used here; 404 `no_safari` for a non-guest |
| `POST /api/safaris/<code>/end` | `{}` | `200 {"safari"}` | 403 `not_host`; 409 `safari_ended` |
| `GET /api/notes` | | `200 {"notes":[{"id","text","author_name","status","reason"}]}`: approved notes, plus the caller's own in any state | |
| `POST /api/notes` | `{"text"}`; optional header `Request-Key` | `201 {"note":{"id","text","status":"pending"}}` | 403 `unconfirmed`; 409 `request_key_reused`; 422 `note_empty`, `note_too_long` |
| `GET /api/ranger/notes` | | `200 {"notes":[...]}`, pending in this world | 403 `not_ranger` |
| `POST /api/notes/<id>/approve` | `{}` | `200 {"note":{"id","status":"approved","decided_by"}}` | 403 `not_ranger`; 409 `note_decided` |
| `POST /api/notes/<id>/decline` | `{"reason"}`, one of the three reasons | `200 {"note":{"id","status":"declined","decided_by","reason"}}` | 403 `not_ranger`; 409 `note_decided`; 422 `bad_reason` |
| `DELETE /api/notes/<id>` | | `204` | 403 `not_ranger`; 409 `note_not_approved` |
| `POST /api/postcards` | `{"photo","recipient","line"}`; optional header `Request-Key` | `201 {"postcard":{"id","url","status":"posted"}}` | 404 `not_found`; 403 `unconfirmed`; 409 `request_key_reused`; 422 `bad_email`, `line_empty`, `line_too_long`; 429 `postcard_limit`; 503 `storage_unavailable`, `mail_unavailable` |
| `GET /api/postcards/<id>` | No sign-in needed | `200 {"postcard":{"id","image_url","creature_name","total","island_name","line","sender_name"}}` | 404 `not_found` |
| `GET /api/boards/<island>` | Optional `?player=<text>`, a case-insensitive part of the name | `200 {"entries":[{"rank","player","handle","creature","creature_name","total","tick","photo"}],"total":<m>,"shown":<n>}`; rank is the full-board rank | 404 `not_found` |
| `POST /api/boards/<island>/entries` | `{"photo"}`; any other field is ignored | `201 {"entry"}`, or `200 {"entry"}` when the player already had one | 404 `not_found`; 403 `unconfirmed`; 422 `wrong_island` |

Everything except `health`, `signup`, `session`, the image, public hall and public postcard routes needs a session.

**`POST /api/photos`.** The image must be PNG or JPEG by its file signature, and at most `PHOTO_MAX_BYTES` bytes, exactly the limit allowed. The whole request may exceed that limit by at most 64,000 bytes. After 401 and the key replay, one order applies: 413 `photo_too_large`, 415 `not_an_image`, 409 `out_of_film`, 409 `shot_key_reused`, then 422 in this order: `bad_pose`, `tick_passed`, `tick_ahead`, `cannot_stand`, `camera_too_far`, `nothing_in_frame`; finally 503 `storage_unavailable`. A kept photo answers:

```json
{"photo": {"id": "...", "creature": "mossback-newt", "creature_name": "Mossback newt", "island": 1, "tick": 6000,
 "score": {"size": 30, "centring": 25, "facing": 25, "sharpness": 20, "total": 100},
 "measures": {"distance": 4, "best_distance": 4, "offset": 0, "focus_error": 0, "creature_facing": "toward"},
 "album": {"page_filled": true, "pages_filled": 4, "stamp_earned": true},
 "film": 35, "image_url": "/api/photos/.../image"}}
```

`page_filled` means this photo newly filled the page, and `creature_facing` is `toward`, `side` or `away`. `<photo>` elsewhere is this object without `measures`, `album` and `film`.

### Grading routes (DP-15, DP-22, DP-29)

`POST /api/grading/world` and `POST /api/grading/clock` exist only when `GRADING_ROUTES=on`. With any other value or unset they answer 404 like any unknown path.

`POST /api/grading/world`, body `{}` or `{"tick": <n>}`, answers `201` with one fresh, isolated grading world each call, with unique emails such as `explorer-<random>@example.test` and unique handles, so tests never share data. Its world clock is frozen at `tick` (default 6000) until moved by the clock route. Its contents are in Seed data. With storage unreachable it answers the 503 `storage_unavailable`.

```json
{"world":    {"id": "...", "tick": 6000},
 "explorer": {"id": "...", "name": "...", "handle": "...", "email": "...", "password": "..."},
 "friend":   {"id": "...", "name": "...", "handle": "...", "email": "...", "password": "..."},
 "rival":    {"id": "...", "name": "...", "handle": "...", "email": "...", "password": "..."},
 "ranger":   {"id": "...", "name": "...", "handle": "...", "email": "...", "password": "..."},
 "ranger2":  {"id": "...", "name": "...", "handle": "...", "email": "...", "password": "..."},
 "newcomer": {"id": "...", "name": "...", "handle": "...", "email": "...", "password": "..."},
 "photos":   {"heron": "...", "moth": "...", "lark": "...", "friend_heron": "...", "rival_lark": "...",
              "rival_private": "..."},
 "safari":   {"code": "..."},
 "notes":    {"pending": "...", "approved": "..."}}
```

`POST /api/grading/clock`, body `{"world": "<id>", "tick": <n>}`, answers `200 {"world": "<id>", "tick": <n>}` and keeps that world's clock frozen at the new tick. Every open page of that world shows the new tick, hour, weather and creatures within 2 seconds, pushed at once rather than at the next interval. An unknown world answers 404 `not_found`; a tick that is not a whole number of 0 or more answers 422 `bad_request`.

Each browser context can sign in through `POST /api/session`.

### Business rules (DP-05, DP-06, DP-11, DP-19, DP-23 to DP-28, DP-31 to DP-35, DP-37 to DP-39, DP-42, DP-47 to DP-49, DP-52 to DP-56, DP-58 to DP-63, DP-65, DP-69, DP-73, DP-77, DP-82 to DP-84, DP-97)

**Worlds.** Every player belongs to one world. Clock, notice board, waiting notes, challenge boards, safari codes and live events are all that world's own. A player's own data never leaves it except through the visibility rules below. The main world holds players who signed up normally.

**World clock.** The server owns the world clock, the creature routes, the weather, every score, the albums, the stamps and the lighthouse door. The page shows the server's answer even when the device clock or time zone is wrong, and it never advances the world tick on its own. One world tick passes every `WORLD_TICK_MS` of server time and one world day is `WORLD_DAY_TICKS` ticks, except a grading world, which stays frozen. Hour = floor((tick mod `WORLD_DAY_TICKS`) x 24 / `WORLD_DAY_TICKS`). Minute = floor((tick mod (`WORLD_DAY_TICKS` / 24)) x 60 / (`WORLD_DAY_TICKS` / 24)). For example, tick 6000 is `10:00`, 11000 is `18:20` and 4000 is `06:40`. Dusk is from `DUSK_START_HOUR` up to but not including `DUSK_END_HOUR`. Rain falls from `RAIN_START_HOUR` up to but not including `RAIN_END_HOUR`, every world day. Dusk-only creatures exist only at dusk, rain-only creatures only while it rains. The clock lives in a Postgres row. Instances sharing a database agree on it, and each instance reads it at least every `LIVE_INTERVAL_MS`, so a change made through one reaches pages on another within 2 seconds.

**Route rule.** A patrol from A to B covers L tiles at p ticks per tile. With k = floor(tick / p) mod 2L: for k < L the creature stands k tiles from A towards B facing towards B; otherwise it stands (k - L) tiles from B towards A facing towards A. A staying creature never moves. Creatures do not block the explorer. For example, the heron is on 6,16 facing E at tick 6000, on 9,16 facing E at tick 6030 and on 10,16 facing W at tick 11000.

**Movement.** On the first held step of a direction key the explorer turns to face it and moves one tile if the tile ahead is land; walking, it moves again every second held step (steps 1, 3, 5); running, every held step. A tile that is not land stops it with its heading turned (for example from 7,5 holding S on Saltmarsh Harbour, the rock at 7,6 stops it). Running is on while `Run` is pressed (R toggles it) or Shift is held. Space starts a jump on the next step; it lasts 4 steps and on the 4th the explorer lands 2 tiles ahead if that tile is land, crossing any one tile (from 7,5 facing S it lands on 7,7 over the rock), else back on its starting tile. Direction keys are ignored during a jump, and a jump cancels a walk in progress. Holding for 400 ms of page time walks 2 tiles or runs 4.

**Walking to a spot.** The explorer walks the shortest 4-direction path over land, starting on the next step at the current gait. Among equal paths it takes, at each tile, the first of north, east, south, west that still lies on a shortest path. A direction key stops the walk. No path: the explorer stays and `World status` shows its no-path message. For example, from spot 1 on Saltmarsh Harbour to 12,10 the tiles are 3,11, 3,10, then 4,10 east through to 12,10.

**Position.** Every tile change sends `PUT /api/me/position`. The server keeps the last land tile as the saved position, a non-land tile answers `not_land`, and the position is relayed to a safari guest and to the same player's other tabs. Position moves between islands are always allowed.

**Frame rule.** With the explorer on tile (ex, ey) facing H and a creature on (cx, cy), forward a and lateral l are, for N: a = ey - cy, l = cx - ex; E: a = cx - ex, l = cy - ey; S: a = cy - ey, l = ex - cx; W: a = ex - cx, l = ey - cy. The creature is in frame when 1 <= a <= 24 and 2 x zoom x |l| <= a. Rock and water never hide a creature. The subject is the in-frame creature with the smallest a (then the smallest |l|, then the lower id). `data-in-view` lists in-frame creatures in that same order.

**Score**, in whole numbers, total out of 100:

- size = max(0, 30 - 10 x |a - 2 x zoom x S|), with S the creature's size
- centring = max(0, 25 - 10 x |l| x zoom)
- facing = 25 when the creature faces the explorer (its heading opposite to H), 15 when side-on, 0 when facing away
- sharpness = max(0, 20 - 5 x |focus - a|)

The server computes these from the pose and the creature at the pose's tick on the pose's island, and ignores any score, creature position or weather the client sends. The pose's tile need not match the saved position.

**Worked examples**, on Saltmarsh Harbour:

| # | Tick | Explorer tile, heading | Zoom | Focus | Subject | Size | Centring | Facing | Sharpness | Total |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | 6000 | 12,10 N (spot 2) | 2 | 4 | Mossback newt | 30 | 25 | 25 | 20 | 100 |
| 2 | 6000 | 12,10 N (spot 2) | 1 | 2 | Mossback newt | 10 | 25 | 25 | 10 | 70 |
| 3 | 6000 | 13,10 N | 2 | 8 | Mossback newt | 30 | 5 | 25 | 0 | 60 |
| 4 | 6030 | 8,20 N (spot 3) | 1 | 4 | Reedpipe heron | 30 | 15 | 15 | 20 | 80 |
| 5 | 11000 | 20,12 W (spot 4) | 1 | 2 | Gloamfin moth | 30 | 25 | 0 | 20 | 75 |

With example 4's pose `data-in-view` is `reedpipe-heron,mossback-newt`. With example 5's it is `gloamfin-moth,reedpipe-heron` at tick 11000 and `reedpipe-heron` at tick 6000. From spot 1 facing E at tick 6000 nothing is in frame at any zoom.

**Photo refusals.**

- `tick_passed`: the pose's tick is more than `PHOTO_TICK_GRACE` ticks behind the server's tick.
- `tick_ahead`: the pose's tick is ahead of the server's.
- `cannot_stand`: the explorer tile is not land.
- `camera_too_far`: the camera is more than 1 tile from the explorer tile in either axis.
- `nothing_in_frame`: no creature is in frame.
- `bad_pose`: the pose is malformed, or has an island, heading, zoom or focus outside its published values.

A refused photo stores nothing, spends no film and does not use up its shot key.

**Photo state machine.** A photo is received, then either stored and scored, refused, or not kept when storage is unreachable. It is kept only after MinIO confirms the object, byte-identical to the uploaded image. Then the photo, its score, the album change and the film change commit together, or none of them, and no object stays without its row. Several requests under one `Shot-Key` from one player make one photo and one spent frame: a repeat with the same pose returns the first answer unchanged, also while the first is in flight, and a repeat with another pose answers `shot_key_reused`. When two tabs take a player's last frame at once, one photo is kept and the other gets `out_of_film`.

**Albums.** Each island's album has four pages, one per creature. A kept photo of total 60 or more fills its page, and the page keeps the player's best photo of that creature; only a strictly higher total replaces it. A newly filled page returns 6 frames. Four filled pages earn that island's stamp once. Three stamps open the lighthouse at Lantern Point until a restart. Open means the door stands lit in the scene and `data-lighthouse` reads `open`; the lighthouse tile still blocks like rock.

**Film.** Film starts at 36 at sign-up. A kept photo spends one. `Refill film` sets it to 36 from the player's saved position on Saltmarsh Harbour. The film ledger is Postgres table `film_ledger`, with columns `player_id`, `change_id`, `account` (`satchel` or `locker`), `amount`, `reason` (`start`, `photo`, `page`, `refill` or `restart`), `created_at`. Every change writes two rows with one `change_id`, the satchel row and the opposite locker row, summing to zero. Rows are never edited or deleted. The film figure on every screen always equals the sum of the player's satchel rows. A change of nothing writes no rows.

**Tables tests read,** with these exact names: `film_ledger`; `photos` (`id`, `player_id`, `creature_id`, `total`); `likes` (`photo_id`, `visitor_id`). Album counts, stamp totals, film, like counts and board entries on every screen, including the text world, equal what the rows say.

**Restart.** Restart clears albums, stamps and the lighthouse, sets film to 36 and puts the explorer on Saltmarsh Harbour spot 1, in every open tab of that player within 2 seconds, replacing a deep-link address with `/play`. Photos, the hall, notes, board entries and settings stay.

**Text is literal.** Notes, hall captions and postcard lines are plain text shown exactly as typed. No HTML, no markdown: `<b>x</b>`, `**x**` and `[a](b)` render as those literal characters. Limits count characters, and exactly 140 is allowed. A value of only spaces counts as empty.

**Request keys.** A repeat of `POST /api/notes` or `POST /api/postcards` from one player with the same `Request-Key` and the same body returns the first answer and creates nothing. The same key with another body answers `request_key_reused`.

**Hall.** A hall has 12 frames, and a player hangs only their own kept photos. A new player's hall is private and empty. Likes are one per visitor per hung photo, and each count equals its rows. Moving a photo keeps its likes. A photo's image is visible to its owner; to anyone while it is hung in a public hall, entered on a board, on a postcard, or fed to the seated safari guest; and to no one else (`not_found`). A private hall answers 404 everywhere for everyone but its owner: the page, the hall API, likes, and the images of photos shown only there.

**Shared safari.** Safari state: open, joined, ended. A code is six capital letters. Join moves open to joined. A guest leaving moves joined to open. The host ending it moves open or joined to ended, after which every action answers `safari_ended`. One host and one guest seat: when two join at once, one wins and the other gets `safari_full`. Only the host marks sightings. Every photo the host keeps while a guest is seated goes to the guest's feed. When the guest's page closes, the live stream ends at once and its Postgres connection is released. The stream never holds a transaction open between pushes, and after any number of streams closed mid-way no app session stays active or idle in transaction. The seat frees no earlier than `SAFARI_SEAT_RELEASE_SECONDS` and no later than `SAFARI_SEAT_RELEASE_SECONDS` plus 3 seconds after the guest's last live stream ended or, if no stream ever opened, after joining. For example, on `short-limits` the seat frees from 3 to 6 seconds after the guest's page closes. A guest who opens a stream again before the seat frees keeps it.

**Notes.** Note state: pending, then approved or declined by one ranger, then an approved note removable by a ranger. A note is unseen by everyone but its author until a ranger approves it. Any existing note of the world can be tried by anyone: a non-ranger gets `not_ranger`, and an unknown id gets `not_found`. When two rangers decide one note, the first decision stands and every later decision gets `note_decided` naming the outcome and first ranger. Approved notes appear on every open board within 2 seconds, and the author hears the outcome within 2 seconds.

**Postcards.** A postcard needs a confirmed sender and the sender's own photo. It reads the stored image first, so unreachable storage answers 503 with no message. It takes `Posted` only after Mailpit accepted the message. A failed send stores nothing as posted and does not count towards the limit. At most `POSTCARD_LIMIT` postcards per sender in any rolling `POSTCARD_WINDOW_SECONDS`, exactly the limit allowed; `Retry-After` is the seconds until the oldest counted one leaves the window. Postcard content and its public answers never include the sender's address.

**Challenge boards.** One entry per player per island: their best entered photo of that island, and only a strictly higher total replaces it. Ranking: total high to low, then the photo's world tick earlier first, then the entry made first. The total is always the `photos` row's. Boards re-rank in place on every open page within 2 seconds.

**Confirmation.** Sign-up is name, email and password. The sign-up message carries a six-digit code valid for `CONFIRM_CODE_TTL_SECONDS`, and a new code replaces the old one. Unconfirmed players may walk and take photos but may not post postcards, pin notes or enter boards. A failed sign-up mail still creates the account, with `code_sent` false.

**Text world.** `/text-world` has one heading per island, level 2, named exactly `<Island name>`, in island order. Under each heading is a list of that island's four creatures in the order of the Seed data table, always all four whatever the hour or weather, followed by the line `<n> of 4 album pages`, where `<n>` is that island's filled pages. Each creature line reads `<Creature name>: <present rule>, photographed, best <n> points` when the player has a kept photo of that creature, with `<n>` the highest `photos` total of those photos, and otherwise `<Creature name>: <present rule>, not photographed yet`. `<present rule>` is the creature's Present value in Seed data: `always`, `dusk only` or `rain only`. A level 2 heading named `Your progress` follows the islands, with these lines in this order: `Stamps: <n>`, then `Lighthouse: open` or `Lighthouse: closed`, then `Film: <n> frames` (`Film: 1 frame` when one), then the location line `You are on <Island name> at tile <x>, <y>.` For example, with the seed data at start, `explorer` reads `Mossback newt: always, not photographed yet`, `Reedpipe heron: always, photographed, best 74 points` and `3 of 4 album pages` under Saltmarsh Harbour, `Stamps: 2` and `You are on Saltmarsh Harbour at tile 3, 12.` Each island other than the player's current one has its `Sail to <Island name>` button under its heading, which puts the player on spot 1 of that island. `Refill film` sits under `Your progress` and follows the album button's enabled rule. All of these lines change in place within 2 seconds of the change they report. Without a session, each creature line ends after `<present rule>`, and the signed-out sentence from Feedback states replaces the page-count lines, the progress lines, the location line and the buttons.

**Settings.** Settings are saved per player. Music gain = music value / 100; effects gain = effects value / 100.

**Sound graph.** Island sound uses the Web Audio API with generated sound and no audio file. Before the first press of `Sound` no audio context, source or gain exists. The first press creates one audio context and starts one looping generated buffer source (island ambience) through a music gain and one master gain set to 1 to the output. Effects go through an effects gain into the same master. `aria-pressed` becomes `true`. The next press sets the master gain to 0 and `aria-pressed` to `false`, and the press after that sets it back to 1 with no new context. Every page load starts with sound off.

### Services (DP-21, DP-65, DP-66, DP-68, DP-70, DP-91)

**Postgres.** Holds players, sessions, worlds and their clocks, photos and scores, albums, stamps, halls, likes, notes, safaris, sightings, board entries, postcards, settings and the film ledger. The schema is applied idempotently on every serve.

**MinIO.** Every photo image lives under `photos/<photoId>.png` or `photos/<photoId>.jpg` in `S3_BUCKET`, and reaches the browser only through `GET /api/photos/<photoId>/image` on the app's origin. Albums, halls, safaris and postcards read that same object. When MinIO is unreachable, a photo answers the 503 `storage_unavailable` with no photo row, object or film change, and `Photo status` shows that photo copy; walking, the map, the album text and the text world keep working.

**Mailpit.** Two messages, both over `SMTP_HOST` and `SMTP_PORT`, from `MAIL_FROM`.

- Sign-up and new code: to the player, subject `Your Hushfoot confirmation code`, text body containing `Your code is <code>.`
- Postcard: exactly one message per postcard, to the recipient, subject `A postcard from <sender name> on <Island name>`. The text body holds the line exactly as typed, `<Creature name>, <total> points` and the link `<APP_PUBLIC_URL>/postcards/<postcardId>`. It has no HTML part and no Reply-To, and the stored image is attached with its exact bytes. `<Island name>` is the photo's island.

### Seed data (DP-01, DP-22, DP-30, DP-36, DP-43, DP-50, DP-57, DP-64, DP-71, DP-90)

Every seeded person, place and creature is invented.

**Main world.** It starts at tick 6000 when the app first starts with an empty database and advances as the world clock says. One ranger exists there: name `Sal Marram`, email `ranger@hushfoot.example`, password `Harbour-Ranger-1`.

**Islands.** Five islands in this order, ids 1 to 5. Every island is a grid of 24 by 24 tiles: x 0 to 23 west to east, y 0 to 23 north to south, tile `0,0` in the north-west corner. Water: every tile with x or y equal to 0 or 23, plus the island's pond. Rock: the island's rock tiles. Every other tile is land, the only tiles an explorer may stand on.

| Island | Pond (water) | Rock tiles |
|---|---|---|
| 1 Saltmarsh Harbour | x 15-17, y 3-5 | 6,6  7,6  8,6  14,14  14,15  14,16 |
| 2 Fernhollow | x 4-6, y 15-17 | 10,4  10,5  10,6  17,17  18,17  19,17 |
| 3 Driftglass Reef | x 11-13, y 11-13 | 5,18  6,18  7,18  18,5  18,6  18,7 |
| 4 Mistcrown Fells | x 17-19, y 15-17 | 4,9  5,9  6,9  12,2  12,3  12,4 |
| 5 Lantern Point | x 3-5, y 3-5 | 9,15  10,15  11,15  16,9  16,10  16,11; the lighthouse stands on 20,4 (blocks like rock) |

**Spots,** the same on every island: spot 1 = tile 3,12 facing E (the dock), spot 2 = 12,10 facing N, spot 3 = 8,20 facing N, spot 4 = 20,12 facing W. Saltmarsh Harbour also carries the notice board by the dock.

**Hall floor.** A hall is a room of 6 by 14 tiles, x 0 to 5, y 0 to 13, all floor with walls beyond. A visitor starts on 2,13 facing N and walks by the movement rule.

**Creatures.** Twenty, four per island.

| Island | Id | Name | Size in tiles | Present | Route |
|---|---|---|---|---|---|
| 1 | `mossback-newt` | Mossback newt | 1 | always | stays at 12,6 facing S |
| 1 | `reedpipe-heron` | Reedpipe heron | 2 | always | patrols 6,16 to 10,16, 10 ticks per tile |
| 1 | `gloamfin-moth` | Gloamfin moth | 1 | dusk only | stays at 18,12 facing W |
| 1 | `puddle-lark` | Puddle lark | 1 | rain only | patrols 4,4 to 4,9, 5 ticks per tile |
| 2 | `bracken-hare` | Bracken hare | 1 | always | patrols 8,8 to 14,8, 6 ticks per tile |
| 2 | `mossfern-stag` | Mossfern stag | 3 | always | patrols 12,13 to 12,18, 8 ticks per tile |
| 2 | `lantern-toad` | Lantern toad | 1 | dusk only | stays at 16,12 facing W |
| 2 | `drizzle-snail` | Drizzle snail | 1 | rain only | stays at 20,6 facing S |
| 3 | `glasswing-crab` | Glasswing crab | 1 | always | patrols 3,6 to 9,6, 6 ticks per tile |
| 3 | `tidewhistle-otter` | Tidewhistle otter | 2 | always | patrols 15,16 to 20,16, 8 ticks per tile |
| 3 | `duskshell-snipe` | Duskshell snipe | 1 | dusk only | stays at 6,12 facing E |
| 3 | `rainbead-gecko` | Rainbead gecko | 1 | rain only | patrols 15,3 to 15,8, 5 ticks per tile |
| 4 | `cragtail-goat` | Cragtail goat | 2 | always | patrols 8,14 to 8,20, 10 ticks per tile |
| 4 | `fell-mouse` | Fell mouse | 1 | always | patrols 15,4 to 20,4, 4 ticks per tile |
| 4 | `mistcrown-owl` | Mistcrown owl | 2 | dusk only | stays at 14,8 facing S |
| 4 | `cloudpuff-vole` | Cloudpuff vole | 1 | rain only | stays at 6,4 facing E |
| 5 | `beacon-gull` | Beacon gull | 2 | always | patrols 12,20 to 18,20, 6 ticks per tile |
| 5 | `shingle-plover` | Shingle plover | 1 | always | patrols 4,12 to 4,18, 5 ticks per tile |
| 5 | `wickwing-bat` | Wickwing bat | 1 | dusk only | stays at 8,8 facing S |
| 5 | `sleetfoot-fox` | Sleetfoot fox | 2 | rain only | patrols 13,4 to 13,10, 8 ticks per tile |

**Grading world contents.** Every player is confirmed except `newcomer`, and no code has been mailed to `newcomer`. `ranger` and `ranger2` have the ranger role. Every player starts on Saltmarsh Harbour at spot 1, with film 36 and no album pages unless stated, and settings music 60, effects 80, graphics full. Every seeded photo's image is a small PNG the route generates and stores in MinIO. Seeded totals, pages, stamps and film are stored as given and are not re-derived from a pose or from each other; seeded ledger rows are valid pairs whose satchel sum equals the given film.

- `explorer`: album pages filled on Saltmarsh Harbour for Reedpipe heron (`heron`, total 74, taken at tick 5200), Gloamfin moth (`moth`, 81, tick 5300) and Puddle lark (`lark`, 66, tick 5400), the Mossback newt page empty. Stamps for Fernhollow and Driftglass Reef (2 stamps), whose album pages stay at 0 of 4. Lighthouse closed. Film 30. A public hall with frames 1 to 3 holding heron, moth and lark, no likes. One approved note (`approved`, text `Fresh water at the harbour tap.`). Host of an open shared safari (`safari.code`, guest seat free, one sighting at 12,6 on Saltmarsh Harbour by `explorer`).
- `friend`: no album pages, film 36. One kept photo `friend_heron` (Reedpipe heron, Saltmarsh Harbour, total 74, tick 5100). One pending note (`pending`, text `Seal pups on the dock at low tide.`).
- `rival`: one kept photo `rival_lark` (Puddle lark, Saltmarsh Harbour, total 66, tick 5300), entered on the Saltmarsh Harbour board. A private hall with frame 1 holding `rival_private` (Mossback newt, Saltmarsh Harbour, total 55, shown nowhere else).

## Technical requirements

### Deployment (DP-85)

Node.js with npm is available. `/app/run.json` has string `install`, `build` and `serve` and `"_schema":"run-manifest-v1"`, for example:

```json
{"_schema":"run-manifest-v1","install":"npm ci","build":"npm run build","serve":"npm run start"}
```

The server binds `0.0.0.0` on port 4173, honouring `APP_PUBLIC_PORT`. `GET /api/health` always answers HTTP 200: `{"status":"ok"}` when Postgres and MinIO answer, `{"status":"unavailable"}` when either does not, never 503, and within 2 seconds. The world renders with three.js, installed as a dependency, bundled and served from the app's own origin. Sessions live in Postgres, so instances sharing a database honour one sign-in method and rules.

### Configuration and secrets (DP-69, DP-91, DP-97)

All are read at start, and none is ever sent to the browser or hard-coded.

| Variable | Default | Meaning |
|---|---|---|
| `DATABASE_URL` | | Postgres |
| `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_FORCE_PATH_STYLE`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | | MinIO |
| `SMTP_HOST`, `SMTP_PORT`, `MAILPIT_URL` | | Mailpit |
| `MAIL_FROM` | `Hushfoot <hello@hushfoot.example>` | Sender of both messages |
| `APP_PUBLIC_PORT` | 4173 | Port to bind |
| `APP_PUBLIC_URL` | `http://localhost:<port>` | Origin in postcard links |
| `GRADING_ROUTES` | off | Grading routes |
| `WORLD_TICK_MS` | 100 | Milliseconds per tick |
| `WORLD_DAY_TICKS` | 14400 | Ticks per world day, 24 real minutes at the default tick |
| `DUSK_START_HOUR`, `DUSK_END_HOUR` | 18, 20 | Dusk hours |
| `RAIN_START_HOUR`, `RAIN_END_HOUR` | 6, 9 | Rain hours |
| `PHOTO_TICK_GRACE` | 30 | Ticks |
| `PHOTO_MAX_BYTES` | 2000000 | Bytes |
| `LIVE_INTERVAL_MS` | 1000 | How often the server pushes the tick and creatures |
| `SAFARI_SEAT_RELEASE_SECONDS` | 30 | Seconds |
| `POSTCARD_LIMIT` | 10 | Postcards |
| `POSTCARD_WINDOW_SECONDS` | 3600 | Seconds |
| `CONFIRM_CODE_TTL_SECONDS` | 86400 | Seconds |

The verifier runs extra instances of the same build. `storage-down` has a broken `S3_ENDPOINT` and shares the primary's database, so a grading world made on the primary is visible there. `short-limits` has its own empty database and bucket and lower limits for photo size, seat release, postcards and live interval.

### Server boundary (DP-28, DP-48, DP-85, DP-91, DP-97)

Same origin only: the server sends no cross-origin headers and answers `bad_origin` to a state-changing request whose `Origin` host differs from its `Host`. Every page's assets come from the app's origin, with no CDN and no remote font, image, model or sound. The session cookie is HTTP-only. The server never serves source files, dotfiles, credentials or the `film_ledger` raw. Size limits are in API. Concurrent requests from different players never see each other's identity or data: like state, film count, account menu and answers always belong to the caller, and nothing request-specific lives in process-wide state. Pages for a signed-in player are never cached across players.

A dependency unreachable at boot does not stop the server. With MinIO unreachable it serves normally except for the storage answers above. With Postgres unreachable it keeps retrying, the health route reads `unavailable`, and other API routes answer `database_unavailable`.

### Browser support and performance (DP-14, DP-30)

Current Chromium, Firefox and Safari at the three published viewports. The title page is usable within 3 seconds. `/play?gfx=light` reaches `data-state="ready"` within 10 seconds of real time under software rendering, and asset loading needs no more than 1 second of page time. Without WebGL the fallback appears instead, with no error shown.

## Working rules

- IF-01: `/app/run.json` exists with string `install`, `build`, `serve` and `"_schema":"run-manifest-v1"`.
- IF-02: The application is written in TypeScript.
- IF-03: `THIRD_PARTY_NOTICES.md` lists every shipped package and every bundled font, photograph or other asset not generated by the app, with its licence; "shipped packages" means the production dependency tree (`npm ls --omit=dev --all --json`).
- IF-04: Shipped packages and bundled assets use only MIT, Apache-2.0, BSD, ISC, OFL or CC0 licences.
- IF-05: The only datastores are Postgres and MinIO, and the only mail path is Mailpit; no other database, queue or cache is added.
- IF-06: The page source references no remote script, font, image, model or sound.
- IF-07: No service worker, pointer lock, gamepad, WebXR or device sensor API appears in the source.

## Engineering standards

- Code is idiomatic strict TypeScript, with names that match this brief's domain terms: tick, spot, pose, subject, frame, album page, stamp, film, satchel, locker, hall, safari, sighting, note, postcard.
- Each domain rule (the route rule, the frame rule, the score, a state transition, a derived count) is decided in exactly one place in the source.
- No abstraction has a single implementation unless a boundary with a service requires it.
- There is no dead, commented-out or unreachable code.
- There are no defensive checks for impossible states; input is checked at the request boundary and trusted after it.
- All API errors go through one error shape with one catalogue of codes and messages.
- A multi-write change that must commit together runs in one database transaction, and the source shows the order of storage confirmation and commit.
- There are no features beyond this brief.
