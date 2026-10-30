# Stillhour Wind-Down Planner

Stillhour is a single-page scroll story and planner for adults who sleep badly and want help with the hour before bed. Visitors scroll through one evening, from 21:00 to 22:00, told in text chapters and full-screen 3D scenes. On the way they try a guided breath, watch a short film, choose the rituals that suit them and save their own hour with a bedtime and a time zone. Once they confirm by email, they become an hour keeper. Each night they get exactly one reminder email when their hour starts, in their own time zone. From Manage my hour they can edit, pause, share or delete their hour. A partner can open a shared, read-only view of the hour so the two of them wind down at the same time. Build it in TypeScript on two services: PostgreSQL is the only system of record, and Mailpit receives every email the app sends over SMTP. Out of scope: passwords and accounts beyond emailed one-time links, streaks, badges, push notifications, social features, payments, analytics, any datastore other than the provided PostgreSQL, and any third-party service at runtime.

## Problem and users

People who sleep badly are told to build a wind-down routine: dim the lights, put the phone away, take a warm shower, stretch, write tomorrow's list, breathe slowly and keep the same bedtime every night. Almost nobody plans that last hour. It fills with one more episode and one more message, and by the third night the routine is forgotten. Habit apps bury the evening under streaks, badges and notifications that keep people on their phones. Calendar reminders handle clock changes badly. A traveller, or anyone near a daylight-saving change, gets the reminder an hour off, twice or not at all. People pay for this with short, broken sleep, and the apps that profit from attention are not built to let them go.

Stillhour sends one quiet email a night and otherwise leaves people alone.

- **Evening visitor** (occasional): walks through the story of one evening, picks the rituals that fit, and leaves with a saved hour and a bedtime.
- **Hour keeper** (daily): gets exactly one email each night when their hour starts, in their own time zone, and can change, pause, share or delete their hour.
- **Partner** (occasional): opens a shared read-only hour to wind down at the same time, without seeing the keeper's email or private note.

## Journeys

1. **Walk the evening and plan an hour.** Start: a first-time evening visitor opens `/`. They wait for the gate to finish gathering the evening, choose "Begin the hour" or "Begin in silence", and scroll. The story clock moves from 21:00 towards 22:00 and the city goes dark window by window. They try "Breathe with me", add three rituals in chapter four, play the film, then enter their email, bedtime and time zone in the planner and press "Save my hour" (perhaps twice by accident). End: the planner status says the saved message from Feedback states, the address shows their rituals, and exactly one "Confirm your Stillhour" email is waiting in their inbox.
2. **Confirm the hour.** Start: the visitor has an unconfirmed draft and its confirmation email. They open the email's link. End: the sign-in page announces that the hour is confirmed, the visitor is signed in, the live count in the numbers band is one higher on the next load, and Manage my hour shows the hour with its next reminder in the hour's own time zone.
3. **Get the nightly reminder.** Start: an hour keeper has a confirmed hour with reminders on, for example a bedtime of 23:00 in Asia/Tokyo. At 22:00 Tokyo time one "Your Stillhour starts at 22:00" email arrives. On a night when their zone changes its clocks they still get exactly one reminder, at the time stated in Business rules. End: one reminder per local night is in Mailpit, none are duplicated, and none arrive while the hour is paused.
4. **Sign in and edit.** Start: a signed-out hour keeper opens `/manage`. They type their email and press "Send me a sign-in link", read the neutral sent message, and open the link from the email. In the editor they move their bedtime and press "Save changes". In a second, older tab they make another change and save it. End: the first tab's save stands. The second tab shows the conflict message with the latest hour filled in, and nothing was overwritten.
5. **Share with a partner.** Start: a signed-in hour keeper is on `/manage`. They press "Create a share link", press "Copy link" and send the address to a partner. The partner opens `/p/<token>` and sees the bedtime, time zone, rituals and total minutes, with no email and no note. Later the keeper presses "Turn off sharing". End: the partner's page now shows the share-gone message, and a newly made link works while the old one does not.
6. **Delete everything.** Start: a signed-in hour keeper with a shared link is on `/manage`. They press "Delete everything", type DELETE in the dialog and confirm. End: the page shows the deleted message and the sign-in form. No further reminder is ever sent, the partner's link shows the share-gone message, the live count drops by one, and every old emailed link answers not found.
7. **Arrive during an outage.** Start: the database (or the mail service) is unreachable. A visitor still gets the gate, every chapter and scene, and the resting live-count copy. When they save: if the database is down, the planner announces the unavailable message and keeps all their choices on the page; if mail is down, the planner announces the queued message. End: once the database returns, saving works without a restart. Once mail returns, the delayed confirmation email arrives exactly once.

## Mandatory requirements

This is the complete list of mandatory requirements; every check traces to one of these lines and the detailed sections below.

- **DP-01 — Loading gate.** The page opens on a gate that traces the Stillhour mark and shows "Gathering the evening" with a real loading percentage, then offers "Begin the hour" and "Begin in silence", and nothing scrolls or sounds before one is chosen.
- **DP-02 — Sound switch.** A "Sound" switch in the top bar starts on or off according to the gate choice, mutes and unmutes all sound with a short fade, and is remembered in this browser, as detailed in Interactions.
- **DP-03 — Hero title reveal.** After the gate the title "Give your last hour a shape." appears letter by letter over the contour landscape and keeps its full text as its accessible name.
- **DP-04 — Story clock.** The top-bar story clock reads 21:00 at the top of the page and 22:00 at the very bottom, moving one minute at a time with scroll in both directions.
- **DP-05 — City window counter.** In the city chapter a counter falls from 4,096 windows to 1 and the caption steps through three lines at fixed points of that chapter's scroll, rising and reverting exactly when the visitor scrolls back.
- **DP-06 — Numbers band.** The numbers band rolls up 60 minutes, 06 rituals and 01 bedtime and shows the live count of people keeping a Stillhour tonight from the server, or resting copy when the count is unavailable.
- **DP-07 — Scroll-tied chapters.** The brightness dial falls from 100% to 5%, the settle line's letters sink into place and the moonflowers close with scroll, each reversing on the way up, and a moonflower also closes early when hovered or tapped.
- **DP-08 — Goodnight footer.** The page ends on the lantern scene, whose flame goes out as the last part of the page scrolls into view, with the word "Goodnight." and the links "Manage my hour" and "Privacy".
- **DP-09 — Breathing guide.** "Breathe with me" runs three rounds of four seconds in, seven held and eight out, announcing each phase, and "Stop" ends it at once.
- **DP-10 — Film player.** "Play the film" opens a modal film dialog with a 40-second film and a custom player with play and pause, seek, captions, mute, full screen and keyboard keys, which returns focus to its opener when closed.
- **DP-11 — Ritual cards.** Chapter four shows the six catalogue rituals as cards with their title, default minutes and a looping clip that plays only while the card is on screen.
- **DP-12 — Ritual toggles.** Each card's toggle adds or removes its ritual, shows its pressed state and changed label, announces the new total, and refuses a ritual that would take the hour past 60 minutes.
- **DP-13 — Rituals in the address.** The chosen rituals and their minutes live in the page address, so a reload, a shared address or returning with Back restores the same choices.
- **DP-14 — Sideways ritual chapter.** On wide screens without reduced motion chapter four pins while the cards travel sideways over a turning moon, and on every other screen the cards stack vertically with no pinning.
- **DP-15 — Planner form.** The planner collects email, bedtime, time zone, rituals with minutes and a note, and shows the hour's local start time and planned minutes as the visitor edits.
- **DP-16 — Planner error summary.** Saving with invalid fields shows an error summary whose links move focus to each field, alongside each field's own message, without sending anything.
- **DP-17 — Save endpoint.** POST /api/plans saves a draft hour and answers 202 with the same body for new and known addresses, as specified in API.
- **DP-18 — Plan rules.** The server rejects rituals, bedtimes, time zones, notes and extra fields outside the plan rules with 422 naming each offending field.
- **DP-19 — Note and body limits.** A note of up to 280 characters, counted as a reader sees them, is accepted and a longer one is refused, and a request body over 16,384 bytes is refused with 413.
- **DP-20 — Idempotent saves.** Repeating a save with the same Idempotency-Key and body within 24 hours returns the first answer without a second draft or email, and a different body under that key answers 409.
- **DP-21 — Confirmation email.** Each new draft sends one "Confirm your Stillhour" email to its address through the outbox, with a link to /signin carrying a one-time token.
- **DP-22 — One save per click.** A visitor who double-clicks "Save my hour" or retries after a dropped connection gets one draft, one confirmation email and the saved message in the planner status.
- **DP-23 — Emailed link lifetime.** Every emailed link works once and expires fifteen minutes after it was sent, answering 404, 410 link_used or 410 link_expired as qualified in Business rules.
- **DP-24 — Link verification.** POST /api/session/verify with a confirmation token confirms the draft as the address's hour with reminders on, and any valid token signs the visitor in.
- **DP-25 — Session cookie and sign out.** A successful verification sets the stillhour_session cookie for 30 days, /api/me routes answer 401 signed_out without it, and signing out ends the session.
- **DP-26 — Live count.** GET /api/tonight returns exactly the number of confirmed hours with reminders on, right after every confirmation, pause, resume and deletion.
- **DP-27 — Confirm journey.** Opening the confirmation link shows the confirmed message on the sign-in page and then the hour on Manage my hour.
- **DP-28 — Same reply for every address.** Asking for a sign-in link answers 202 with the same body whether or not the address has a saved hour, and only addresses with a saved hour receive an email.
- **DP-29 — Hourly link limits.** Saves are limited to 3 and sign-in requests to 5 per address per hour, after which the server answers 429 with Retry-After for every address alike.
- **DP-30 — Sign-in journey.** On Manage my hour a keeper enters their email, sees the neutral sent message, opens the emailed link and reaches their editor.
- **DP-31 — Read my hour.** GET /api/me/plan returns the keeper's hour in the published plan shape, including its local start time, next reminder and share link.
- **DP-32 — Editable fields only.** PATCH /api/me/plan changes only bedtime, time zone, rituals, note and reminders, and refuses any other field with 422 while changing nothing.
- **DP-33 — Stale edits refused.** An edit without If-Match answers 428 and an edit against an older version answers 409 with the current hour, so a stale tab never overwrites a newer save.
- **DP-34 — Manage editor.** The signed-in editor saves changes, switches reminders on and off, and on a conflict shows the conflict copy with the latest hour filled in.
- **DP-35 — Reminder at local start.** Each confirmed hour with reminders on gets a "Your Stillhour starts at <HH:MM>" email at bedtime minus 60 minutes in the hour's own time zone.
- **DP-36 — Clock-change nights.** On a night when the hour's time zone changes its clocks the keeper still gets exactly one reminder, at the first valid local start as qualified in Business rules.
- **DP-37 — One reminder per night.** A keeper gets at most one reminder per local night, and a reminder more than 60 minutes late is skipped for that night.
- **DP-38 — When reminders begin.** Reminders start with the first night whose hour starts at or after the confirmation, the resume or the bedtime or time-zone edit, and a paused hour gets none.
- **DP-39 — Next reminder shown locally.** Manage my hour shows the next reminder's day and time in the hour's own time zone whatever the browser's time zone, or that reminders are paused.
- **DP-40 — Test clock.** With STILLHOUR_TEST_CLOCK=1, PUT and DELETE /api/test/clock set and clear the app clock for every instance and run due reminders before answering, and otherwise both answer 404.
- **DP-41 — Share links.** A keeper can create a share link, replace it with a new one that kills the old, and turn sharing off, after which the old link answers 404.
- **DP-42 — Shared hour stays private.** A share link shows only bedtime, time zone, rituals and total minutes, never the email or note, and cannot change anything.
- **DP-43 — Partner view.** A partner opening /p/<token> sees the shared hour read-only, and sees the no-longer-available copy once sharing is off or the hour is deleted.
- **DP-44 — Delete everything.** DELETE /api/me removes the hour, drafts, links, sessions, share link, unsent emails and future reminders, so nothing more is sent and every old link answers not found.
- **DP-45 — Delete journey.** On Manage my hour, Delete everything asks the keeper to type DELETE in a dialog before deleting, then shows the deleted message and the sign-in form.
- **DP-46 — Database outage.** While the database is unreachable every data route answers 503 with the unavailable copy and /api/health still answers 200, and saving works again once the database returns, without a restart.
- **DP-47 — Mail outage.** While mail is unreachable saves answer confirmation_queued, and every queued email is sent exactly once when mail returns.
- **DP-48 — Planner during an outage.** A visitor arriving while the database is down still gets the whole story, the resting live-count copy and, on save, the unavailable message with their choices kept.
- **DP-49 — Run manifest and health.** The app installs, builds and serves from /app/run.json on port 4173 or APP_PUBLIC_PORT and answers GET /api/health with 200 {"status":"ok"}.
- **DP-50 — Request limits and error shape.** Every API error uses the single published error body, with 405, 415, 400 and 413 answered as published in Server boundary and API.
- **DP-51 — Same-origin and private internals.** Writes from another origin answer 403 cross_origin, and the server never serves source, configuration or credentials and never shows stack traces, queries or library names.
- **DP-52 — Credentials from the environment.** Database and mail settings are read from the environment at start, never hard-coded and never sent to the browser.
- **DP-53 — Keyboard-complete story.** Every control from the gate to the planner and Manage my hour works by keyboard with a visible focus ring, dialogs trap focus, Escape closes them and focus is never lost.
- **DP-54 — Announced results.** Every ritual change, breathing phase, film state, save, sign-in, share and error result is announced in its named live region with the exact copy from Feedback states.
- **DP-55 — Three viewports.** At 375x812, 768x1024 and 1280x800 every chapter and control is present and reachable and the page never scrolls sideways.
- **DP-56 — Reduced motion.** With reduced motion there is no smooth scrolling, pinned sideways section, letter scatter or autoplaying clip, while scenes, clock, counter and captions still follow scroll.
- **DP-57 — Dusk look.** The page ground darkens chapter by chapter from pale lilac to near-black, with the ember accent kept for light sources and actions and the two named typefaces used throughout.
- **DP-58 — Story scenes look.** The contour landscape, city, still water, moonflowers, moon and lantern read as one cinematic night on a single fixed canvas behind opaque text chapters.
- **DP-59 — Code-built scenes and sound.** Every 3D scene is built in code on one canvas without model files, and all sound is decoded from the app's own audio files through one master volume.
- **DP-60 — Calm forms.** The planner, Manage my hour, the sign-in page and the shared hour are calm two-column or single-column forms in the same dusk style with large touch targets.

## Frontend

### Screens and layout (DP-01, DP-03, DP-06, DP-08, DP-11, DP-14, DP-15, DP-43, DP-55, DP-60)

The product has five addresses: `/` (the story and the planner), `/manage`, `/signin`, `/p/<token>` and `/privacy`.

**`/` is one long page.** One WebGL canvas stays fixed behind the whole page. The page alternates between transparent full-screen scene windows, which show the canvas, and opaque text chapters, which slide over it. From top to bottom:

1. **Gate.** A full-screen layer over everything. The Stillhour mark (a crescent inside a thin circle) draws its own outline, with "Gathering the evening" and a percentage under it. When loading finishes, two buttons appear side by side, or stacked on a phone.
2. **Top bar.** Fixed at the top across every chapter: the wordmark on the left, the story clock in the centre, the sound switch on the right. On a phone it is one compact row.
3. **21:00 hero scene.** A landscape of glowing contour lines under a low ember sun, with the title set large in the lower third.
4. **Chapter one, "The hour nobody plans."** Two or three short paragraphs about the unplanned last hour.
5. **Numbers band.** Three large rolling numerals in a row ("60 minutes", "06 rituals", "01 bedtime"), stacked on a phone, with the live-count line under them.
6. **City scene.** A 3D skyline. The window counter and caption sit in a lower corner (centred at the bottom on a phone) and stay put while the chapter scrolls.
7. **Chapter two, "Put the screen to bed."** Text beside a large round brightness dial, with the dial under the text on a phone.
8. **Still water scene.** Dark water and a small paper boat.
9. **Chapter three, "Breathe in for four, hold for seven, out for eight."** Text, a large breathing circle, the round counter and the "Breathe with me" button.
10. **Moonflowers scene.** A field of pale flowers.
11. **Settle line.** One very large line, "Let the day settle.", across the width.
12. **Chapter four, "Build your hour."** The six ritual cards over a 3D moon. On wide screens they form a row that travels sideways. Elsewhere they form a vertical list, two columns at 768x1024 and one column at 375x812.
13. **Chapter five, "One still hour."** A short paragraph, a still from the film and the "Play the film" button.
14. **Chapter six, "Plan your Stillhour."** The planner: fields on the left and a live summary of the hour on the right at 1280x800; one column with the summary below the fields at 768x1024 and 375x812.
15. **22:00 footer scene.** A paper lantern, the word "Goodnight." and the two footer links.

**`/manage`** is a single centred column on the dusk-violet ground. Signed out, it shows a short explanation and the sign-in form. Signed in, the editor has two columns at 1280x800 (hour fields on the left; reminders, sharing, delete and sign out on the right) and one column below that width.

**`/signin`** is a centred card with the link result and a link onward.

**`/p/<token>`** is a centred card titled with the shared hour. It shows the start time and bedtime, the time zone, the rituals with their minutes and the total. There is nothing to edit.

**`/privacy`** is one readable column. It lists what Stillhour stores (email, bedtime, time zone, rituals, note, reminder records, emailed links, sessions), that no email is shown to a partner, and that Delete everything removes it all.

In all three viewports (375x812, 768x1024, 1280x800) every chapter and control is present, no text is cut off, and the page never scrolls sideways.

### Public screens and controls (DP-01, DP-02, DP-04, DP-05, DP-06, DP-09, DP-10, DP-12, DP-15, DP-16, DP-34, DP-39, DP-41, DP-43, DP-45, DP-54)

Placeholders used below and in Feedback states:
- `<title>` is a ritual title from Seed data.
- `<minutes>` is a whole number of minutes.
- `<total>` is the sum of the chosen rituals' minutes.
- `<start>` is the hour's local start in 24-hour `HH:MM` form.
- `<bedtime>` is the bedtime in `HH:MM` form.
- `<zone>` is the hour's IANA time-zone name exactly as saved.
- `<count>` is a whole number with a comma as the thousands separator.
- `<m>` is a Retry-After value converted to minutes and rounded up.
- `<email>` is the signed-in address.

Only the controls and regions below are public. Everything else is free.

| Where | Role and accessible name | Visible copy |
|---|---|---|
| Gate | `dialog "Stillhour"` | the mark |
| Gate | `progressbar "Gathering the evening"` (value 0 to 100) | "Gathering the evening" and "<n>%" |
| Gate | `button "Begin the hour"` | "Begin the hour" |
| Gate | `button "Begin in silence"` | "Begin in silence" |
| Top bar | `banner`, `link "Stillhour"` (to the top of `/`) | wordmark |
| Top bar | `timer "Story clock"` | `HH:MM` |
| Top bar | `switch "Sound"` (checked when sound is on) | a small speaker mark |
| Hero | `heading` level 1 "Give your last hour a shape." | same |
| Chapters | `region` named by each chapter heading, `heading` level 2 | the six chapter titles listed in Screens and layout |
| Numbers band | `region "Tonight in numbers"` | "60 minutes", "06 rituals", "01 bedtime", and the live-count line from Feedback states |
| City | `region "The city at night"` | "<count> windows lit" ("1 window lit" at one) and the caption from Motion and effects |
| Chapter two | `meter "Screen brightness"` (value 5 to 100) | "<n>%" |
| Chapter three | `button "Breathe with me"` (its name becomes "Stop" while running) | same as the name |
| Chapter three | `status "Breathing guide"` | phase copy from Feedback states, plus a visible "Round <r> of 3" |
| Chapter four | `group "<title>"` per card | "<title>" and "<minutes> min" |
| Chapter four | `button "Add <title> to my hour"`, pressed false; once added its name becomes "Remove <title> from my hour", pressed true | same as the name |
| Chapter four | `status "Ritual updates"` | ritual copy from Feedback states |
| Chapter five | `button "Play the film"` | same |
| Film | `dialog "One still hour"` (modal) | film title |
| Film | `button "Play"` (its name becomes "Pause" while playing) | icon with text |
| Film | `slider "Seek"` (value text "<m:ss> of 0:40") | elapsed time |
| Film | `button "Captions"` (pressed when on), `button "Mute"` (pressed when muted), `button "Full screen"`, `button "Close"` | icons with text |
| Film | `status "Film status"` | film copy from Feedback states |
| Planner | `textbox "Email"` | label "Email" |
| Planner and editor | `combobox "Bedtime"` (00:00 to 23:55 in 5-minute steps; the planner starts at 23:00) | label "Bedtime" |
| Planner and editor | `combobox "Time zone"` (the browser's list of IANA names; the planner starts on the browser's own zone) | label "Time zone" |
| Planner and editor | `group "Rituals"` with one `checkbox "<title>"` and one `spinbutton "<title> minutes"` (5 to 30, step 5, enabled only when checked) per ritual | titles and minutes |
| Planner and editor | `textbox "A note for tonight"` | "<n> of 280 characters" under it |
| Planner and editor | summary text | "Your hour starts at <start> and ends at <bedtime>, <zone> time." and "<total> of 60 minutes planned." |
| Planner | `button "Save my hour"` | same |
| Planner | `status "Planner status"` | planner copy from Feedback states |
| Planner and editor | `alert` containing `heading "Check your hour"` and one `link` per invalid field, named by the field label | the field messages from Business rules |
| Footer | `contentinfo`, `link "Manage my hour"` (to `/manage`), `link "Privacy"` (to `/privacy`) | "Goodnight." and the link names |
| `/manage` | `heading` level 1 "Manage my hour" | same |
| `/manage` signed out | `textbox "Email"`, `button "Send me a sign-in link"`, `status "Sign-in status"` | same |
| `/manage` signed in | text "Signed in as <email>"; bedtime, time zone, rituals and note controls as in the planner; `button "Save changes"` | same |
| `/manage` signed in | `switch "Reminders"` (checked when reminders are on) | "Reminders" |
| `/manage` signed in | next-reminder line | "Next reminder: <weekday> <day> <month> at <time> (<zone>)", for example "Next reminder: Sunday 1 November at 22:00 (Europe/London)"; or "Reminders are paused." The weekday, day, month and time are those of `next_reminder_at` in the hour's zone. |
| `/manage` signed in | `button "Create a share link"` (named "Make a new share link" while a link exists), `textbox "Share link"` (read-only, the full address), `button "Copy link"`, `button "Turn off sharing"` | same |
| `/manage` signed in | `button "Delete everything"`, `button "Sign out"`, `status "Manage status"` | same |
| Delete dialog | `dialog "Delete everything"` (modal), `textbox "Type DELETE to confirm"`, `button "Delete my hour for good"` (disabled until the box holds exactly DELETE), `button "Cancel"` | "This removes your hour, your reminders and any share link. It cannot be undone." |
| `/manage` draft only | text | "Your hour is waiting for confirmation. Open the link in your confirmation email." |
| `/signin` | `heading` level 1 "Your Stillhour link", `status "Link status"`, `link "Manage my hour"` | link copy from Feedback states |
| `/p/<token>` | `heading` level 1 "A shared Stillhour", `list "Rituals"` with one item per ritual | "Winding down from <start> for bed at <bedtime>, <zone> time.", "<title> · <minutes> min", "<total> minutes in all" |

### Interactions (DP-01, DP-02, DP-07, DP-09, DP-10, DP-12, DP-13, DP-14, DP-15, DP-16, DP-22, DP-34, DP-41, DP-45, DP-53)

**Gate.** While the gate is up the page cannot scroll, by wheel, touch or keys, and no sound plays. The percentage reports real progress: the share of the gate's assets loaded so far (fonts, audio files, the film's poster and the scene textures the app draws). It reaches 100 even if an asset fails; a failed audio file just leaves sound off. When it reaches 100 the two buttons appear and focus moves to the button that matches this browser's remembered sound choice, or "Begin the hour" on a first visit. Enter or Space on either button closes the gate. "Begin the hour" turns sound on and "Begin in silence" leaves it off. The gate fades away, scrolling unlocks and focus moves to the hero heading.

**Sound.** All sound comes from the app's own audio files: one ambient bed that loops and three soft chimes, all played through one master volume. Chime one plays when a ritual is added, chime two at each breathing phase change and chime three when an hour is saved. The film's own sound also goes through the master volume, and the ambient bed lowers to about a third while the film plays. Toggling the "Sound" switch by click, tap, Enter or Space fades everything in or out in under half a second. The setting is remembered in this browser across reloads, and the remembered choice decides which gate button gets focus next time.

**Scroll.** Scrolling by wheel, touch, scrollbar or the keys Page Down, Page Up, Space, Home, End and the arrows drives every scroll-linked effect in Motion and effects. Each scroll-linked value settles within a tenth of a second after scrolling stops.

**Moonflowers.** Moving the pointer over a flower, or tapping it, closes that flower within one second, before its scroll position would. Scrolling back above the point where it would close reopens it.

**Breathing.** Pressing "Breathe with me" renames the button "Stop" and keeps focus on it. It then runs three rounds; each round is breathe in for 4 seconds, hold for 7 seconds and breathe out for 8 seconds, 57 seconds in all. Pressing "Stop", by any means, ends it at once, and the button returns to "Breathe with me". After the third round the button also returns to "Breathe with me".

**Ritual toggles.** Pressing a card's toggle adds the ritual at its default minutes, or removes it. The planner's matching checkbox and spinbutton follow at once, and the reverse holds too: checking or unchecking a planner checkbox updates the card. Adding a ritual that would take `<total>` past 60 is refused: nothing changes, and the no-room message is announced. Changing a spinbutton is refused in the same way if it would take the total past 60, and the value stays as it was.

**Address.** Every ritual change, and every minutes change in the planner, replaces the current address without adding a history entry. The address takes the form `/?rituals=<id>:<minutes>,<id>:<minutes>`, in the order the rituals were added, using the ids from Seed data; for example `/?rituals=dim-lamps:10,breathe:5`. With no rituals chosen the `rituals` parameter is absent. On load the page reads this parameter. It drops entries with an unknown id, a repeated id, or minutes that are not 5 to 30 in steps of 5. It then drops later entries until the total is at most 60, and rewrites the address to the cleaned list. Reloading, opening the same address in another browser, or leaving for `/privacy` and coming back with Back restores the same rituals and minutes.

**Sideways chapter.** At widths of 1024 and above, without reduced motion, chapter four stays pinned while further vertical scrolling moves the row of cards from right to left. The moon behind turns from new to full and back to new across the chapter. When keyboard focus reaches a card's toggle, the page scrolls so that the card sits fully on screen. Below that width, and always with reduced motion, the cards are an ordinary vertical list and nothing pins. Each card's clip plays only while at least half the card is on screen, and pauses otherwise.

**Film.** "Play the film" opens the "One still hour" dialog, moves focus to "Play" and starts the film, except under reduced motion, where it waits for "Play". Tab and Shift+Tab cycle through the dialog's controls only. While focus is in the dialog:
- Space or K plays and pauses.
- Left and Right arrows seek 5 seconds back or forward (on the slider they move it by 5 seconds).
- M toggles mute, C toggles captions and F toggles full screen.
- Escape leaves full screen first if it is on, and otherwise closes the dialog.
Closing, by "Close" or Escape, pauses the film and returns focus to "Play the film". Captions start off. Every video, the film and the ritual clips, is offered as WebM first, with MP4 after it as a fallback.

**Planner.** Typing in "Email" or "A note for tonight" and changing a select, checkbox or spinbutton updates the summary text at once. The character counter uses the counting rule in Business rules. Pressing "Save my hour" first checks every field against the plan rules for a new hour in the browser. If any field fails, nothing is sent: the "Check your hour" alert appears above the form and receives focus, each field shows its message under itself and is marked invalid, and activating a link in the alert moves focus to that field.

If every field passes, the planner sends the save:
- It makes an Idempotency-Key for this exact set of field values and reuses it for every retry until a value changes.
- While the save is pending the button is disabled, so a second press does nothing.
- If the connection drops, it retries the same request with the same key up to three times, a few seconds apart.

**Manage.** "Send me a sign-in link" sends the typed email. "Save changes" sends only the fields changed since load, with the loaded version; the browser checks only those fields before sending, and shows the alert and field messages as in the planner if any fails. Toggling "Reminders" sends at once with the loaded version. After any success the editor reloads the hour, so the version is current. On a conflict the editor replaces every field with the latest hour returned by the server.
- "Create a share link" and "Make a new share link" fill the "Share link" box with the full address.
- "Copy link" copies it.
- "Turn off sharing" empties the box.
- "Delete everything" opens the delete dialog with focus in the text box. Escape or "Cancel" closes it and returns focus to "Delete everything". "Delete my hour for good" deletes, closes the dialog, shows the signed-out form and moves focus to the "Manage my hour" heading.
- "Sign out" ends the session and shows the signed-out form.

**Sign-in page.** `/signin?token=<token>` checks the token once, as soon as the page loads, and never on its own again. Reloading the page checks it again, which then shows the used result. The page shows a single "Manage my hour" link and no site footer.

**Focus.** Every control reaches focus by Tab in reading order: top bar, hero, chapters, planner, footer. Each shows a visible focus ring in the ember accent, at least 2 px thick and clear against both light and dark grounds. Focus never lands on something hidden, and never falls back to the page body when a control disappears or changes name. Touch targets are at least 44 by 44 px.

### Visual design (DP-57, DP-58, DP-60)

- **Colour.** Five colour roles. Night is an ink so dark it is nearly black, with a violet tinge. Dusk lilac is a very pale, cool lavender. Dusk violet is a deep, muted purple. Ember is a warm orange like a low flame, used only for light sources in the scenes (sun, windows, lantern flame) and for actions (buttons, focus rings, pressed toggles). Moonlight is a warm off-white for text on dark grounds.
- **The darkening ground.** The page ground darkens chapter by chapter: dusk lilac behind chapter one, moving through dusk violet in the middle chapters to night behind chapter six and the footer. Text is night on the light chapters and moonlight on the dark ones, switching where the ground passes the middle.
- **Contrast.** All text and control borders meet WCAG 2.2 AA contrast on the ground they sit on.
- **Type.** Fraunces for display: a soft, slightly old-style serif with generous curves, used for the title, chapter headings, numerals, the clock and the settle line. Hanken Grotesk for everything else: a plain, open sans serif. Each heading level is about a third larger than the one below it, starting from body text. The hero title and the settle line are the largest type on the page.
- **Density and composition.** The layout is airy: wide margins, short lines of about sixty characters and long pauses of empty ground between chapters. The story is one continuous scroll over one fixed canvas. Scenes fill the screen edge to edge, and text chapters are solid panels that slide over them.
- **Forms.** The planner and the Manage, sign-in and shared pages are quiet: dusk-violet panels with moonlight text, thin lilac field borders, and one ember button per action group.
- **Controls.** Every control's own box is at least 44 px tall.

### Motion and effects (DP-03, DP-04, DP-05, DP-07, DP-08, DP-09, DP-14, DP-56, DP-58)

Motion has two speeds. Quick feedback, such as a press, a toggle or a focus ring, takes about a fifth of a second. Larger changes, such as the gate leaving, a dialog opening or a card settling, take about two thirds of a second. Everything starts quickly and settles softly at the end; nothing bounces.

**Scroll progress.** Two measures are used:
- *Page fraction* is how far the page has scrolled, from 0 at the very top to 1 at the very bottom.
- *Window progress* for a tall scene window or chapter is 0 when its top edge is at the top of the screen and 1 when its bottom edge is at the bottom of the screen, held at 0 before and at 1 after. The city window is at least three screen heights tall.

**Lights-out clock (signature).**
- The story clock shows 21:00 plus the whole number of minutes in page fraction × 60, rounded down. It reads 21:00 at the top, 21:30 halfway, and 22:00 only at the very bottom. It changes the moment the scroll position crosses a minute, with no easing.
- In the city scene the window counter follows the city's window progress (p). Up to p = 0.18 it shows 4,096. From p = 0.82 on it shows 1. In between it shows 4,096 − 4,095 × (p − 0.18) / 0.64, rounded to the nearest whole number.
- The lit windows in the skyline match the counter, and they go dark in a wave from the farthest buildings to the nearest.
- The caption reads "The offices close." below p = 0.40, "The kitchens go quiet." from 0.40 to below 0.82, and "One window left." from 0.82 on.
- Scrolling back relights the same windows in reverse order, raises the counter through the same values and restores the earlier captions at the same points. Nothing in this effect depends on time; only scroll position moves it.

**Other scroll-linked effects.**
- The hero sun sinks towards the horizon as the hero window progresses.
- The brightness dial's value is 100 − 95 × q, rounded to the nearest whole number, where q is 0 when the dial's top reaches the bottom of the screen and 1 when its bottom reaches the top. The dial's glow dims with it.
- The still water's ripples shrink from choppy to a mirror-still surface, and the paper boat drifts to the centre, across the water window's progress.
- The moonflowers fold shut across their window's progress, the farthest flowers first.
- The settle line's letters start up to about one line height above their places, scattered and tilted. They sink into place as the line's window progress goes from 0 to 0.6 and rise back on the way up.
- The lantern flame shrinks as the footer's window progress goes from 0 to 1 and is out at 1.

**Timed effects.**
- After the gate, the hero title's letters fade up one after another. The whole title appears in under two seconds.
- The numbers band's numerals roll up from zero once, in under one second, the first time the band comes on screen.
- The breathing circle grows over the 4-second inhale, holds for 7 seconds and shrinks over the 8-second exhale.
- A pressed ritual toggle fills with ember in about a fifth of a second.

**Loops.** Only these loop: the ambient sound, each ritual clip while its card is on screen, the water's ripples at the size set by scroll, the lantern flame's flicker at the size set by scroll, the breathing circle while it runs, and the film while it plays. No other element moves on its own.

**Reduced motion.** When the system asks for reduced motion:
- Scrolling is never smoothed or animated by the page.
- Chapter four never pins and its cards stack vertically.
- The hero title and settle line show every letter in place from the start.
- The numerals show their final values.
- Ritual clips show a single still frame.
- The film does not start until "Play" is pressed.
- The breathing circle stays one size while the phase name and a visible seconds countdown change.
- Every scene shows a still picture that is redrawn to match the current scroll position: the sun's height, the lit windows, the water's calm, the closed flowers, the moon's phase, the lantern flame.
- The story clock, the window counter, the brightness dial and the captions follow scroll exactly as described above. The page itself scrolls, never an inner scrolling element, and the window counter is one plain text string such as "4,096 windows lit", never digits split across elements.

**No WebGL.** If the browser cannot draw WebGL, each scene shows a flat drawing in the same colours, and every counter, caption and control still works.

### Feedback states (DP-06, DP-09, DP-10, DP-12, DP-16, DP-22, DP-27, DP-30, DP-34, DP-41, DP-43, DP-45, DP-48, DP-54)

Every async result below appears on screen and is announced through the named live region given in Public screens and controls. Each announcement replaces the region's previous text.

**Live count** (numbers band). The count is fetched when the gate closes and again every 60 seconds while the band is on screen.
- `<count>` other than 1: "<count> people are keeping a Stillhour tonight".
- `<count>` of 1: "1 person is keeping a Stillhour tonight".
- When the count cannot be fetched (resting copy): "Tonight, people everywhere are keeping a Stillhour."

**Breathing guide.**
- Phases: "Breathe in", "Hold", "Breathe out".
- After three rounds: "Three rounds done. Notice how you feel."
- On Stop: "Breathing stopped."

**Ritual updates.**
- Added: "<title> added. <total> of 60 minutes planned."
- Removed: "<title> removed. <total> of 60 minutes planned."
- Refused: "There is no room for <title>. Your hour already has <total> of 60 minutes."

**Film status.** "Playing", "Paused", "Captions on", "Captions off", "Muted", "Sound on".

**Planner status.**

| State | Copy |
|---|---|
| Pending | "Saving your hour…" |
| Success, `confirmation_sent` | "Check your inbox. We sent a link to confirm your hour." |
| Success, `confirmation_queued` | "Your hour is saved as a draft. The confirmation email is delayed and will arrive as soon as our mail service is back." |
| Field errors | "Some details need another look." (the alert and field messages appear as in Interactions) |
| 429 | "You have saved three hours for this address in the last hour. Try again in <m> minutes." |
| 503 | the `unavailable` message from API; every field keeps its value |
| Any other failure | "Your hour was not saved. Please try again." |

**Sign-in status** (`/manage` signed out).

| State | Copy |
|---|---|
| Pending | "Sending your link…" |
| Success | "If that address has a Stillhour, a sign-in link is on its way. It works once, for 15 minutes." |
| Field error | the email field message from Business rules |
| 429 | "That address has asked for five links in the last hour. Try again in <m> minutes." |
| 503 | the `unavailable` message from API |

**Link status** (`/signin`).

| State | Copy |
|---|---|
| Pending | "Checking your link…" |
| Confirmed (`confirmed` true after a confirmation token) | "Your Stillhour is confirmed. Reminders are on." |
| Signed in (sign-in token) | "You are signed in." |
| `link_used` | "This link has already been used. Ask for a new one on Manage my hour." |
| `link_expired` | "This link has expired. Ask for a new one on Manage my hour." |
| `link_unknown` or a missing token | "We do not recognise this link." |
| 503 | the `unavailable` message from API |

**Manage status.**

| State | Copy |
|---|---|
| Pending | "Saving your hour…" |
| Saved | "Your hour is saved." |
| Reminders switched on | "Reminders are on." |
| Reminders switched off | "Reminders are paused." |
| 409 `version_conflict` | "This plan changed somewhere else. Here is the latest version; your edits were not saved." |
| Field errors | "Some details need another look." |
| Share created | "Your share link is ready." |
| Copied | "Link copied." |
| Sharing off | "Sharing is off. The old link no longer works." |
| Deleted | "Everything is deleted. You will not get another reminder." |
| Signed out | "You are signed out." |
| 401 | the form switches to signed out, with "Sign in to manage your hour." |
| 503 | the `unavailable` message from API; the editor keeps its values |

**Shared hour** (`/p/<token>`).
- While loading: "Opening the shared hour…"
- On `not_found`, the heading reads: "This shared hour is no longer available."
- On 503: the `unavailable` message from API.

## Backend

### API (DP-17, DP-20, DP-23, DP-24, DP-25, DP-26, DP-28, DP-29, DP-31, DP-32, DP-33, DP-40, DP-41, DP-42, DP-44, DP-46, DP-47, DP-49, DP-50)

Every request and response body is JSON (`application/json; charset=utf-8`). The size and media-type rules are in Server boundary. Times in responses are ISO 8601 in UTC with a `Z`, for example `2026-11-01T22:00:00.000Z`.

**Error body.** Every error uses one shape: `{"error":{"code":"<code>","message":"<sentence>","fields":{"<field>":"<sentence>"}}}`. `fields` appears only on 422. Codes and their messages:

| Status | Code | Message |
|---|---|---|
| 400 | `invalid_json` | "The request body is not valid JSON." |
| 400 | `idempotency_key_required` | "Send an Idempotency-Key header of 8 to 64 characters." |
| 401 | `signed_out` | "Sign in to manage your hour." |
| 403 | `cross_origin` | "This request did not come from Stillhour." |
| 404 | `not_found` | "Nothing is here." |
| 404 | `no_plan` | "There is no confirmed hour for this address." |
| 404 | `link_unknown` | "We do not recognise this link." |
| 405 | `method_not_allowed` | "This method is not allowed here." |
| 409 | `idempotency_conflict` | "This Idempotency-Key was already used with a different hour." |
| 409 | `version_conflict` | "This hour changed since you loaded it." |
| 410 | `link_used` | "This link has already been used." |
| 410 | `link_expired` | "This link has expired." |
| 413 | `too_large` | "The request is larger than 16,384 bytes." |
| 415 | `unsupported_media_type` | "Send the request body as JSON." |
| 422 | `invalid` | "Some details need another look." |
| 428 | `version_required` | "Send the version you are editing in an If-Match header." |
| 429 | `rate_limited` | "Too many requests for this address. Try again later." |
| 500 | `internal` | "Something went wrong on our side. Please try again." |
| 503 | `unavailable` | "Saving is unavailable right now. Your choices are still on this page; try again in a minute." |

**Error precedence**, for the whole API. A request is checked in this order and answered at the first failure:
1. Unknown `/api` path: 404 `not_found`.
2. Wrong method: 405.
3. Cross-origin write: 403.
4. Non-JSON body: 415.
5. Oversized body: 413.
6. Malformed JSON: 400 `invalid_json`.
7. Database unreachable on a data route: 503.
8. Missing or expired session on `/api/me` routes: 401.
9. Missing or badly sized Idempotency-Key: 400 `idempotency_key_required`.
10. Idempotent replay (returns its stored response) or `idempotency_conflict`.
11. Unknown resource: 404 `no_plan`, `link_unknown` or `not_found`.
12. Missing If-Match: 428.
13. State conflict: 409 `version_conflict`, or 410 `link_used` or `link_expired`.
14. Validation: 422.
15. Rate limit: 429.

Endpoint rows list only their own extra errors.

**Plan shape** (`<plan>` below):
`{"id":"<opaque>","email":"<lowercased address>","bedtime":"HH:MM","time_zone":"<IANA name>","rituals":[{"id":"<id>","title":"<title>","minutes":<n>}],"total_minutes":<n>,"note":"<text>","reminders":"on"|"paused","version":<n>,"starts_at_local":"HH:MM","next_reminder_at":"<ISO UTC>"|null,"share_url":"/p/<token>"|null}`.
Rituals keep the order they were sent in. `starts_at_local`, `total_minutes` and `next_reminder_at` are derived as in Business rules.

**Endpoints**

- `GET /api/health` → `200 {"status":"ok"}`. Never touches the database or mail; always answers.
- `GET /api/tonight` → `200 {"keeping":<n>}`.
- `POST /api/plans`
  - Header `Idempotency-Key`: 8 to 64 printable ASCII characters.
  - Body: `{"email","bedtime","time_zone","rituals":[{"id","minutes"}],"note"}`. Which keys are required is set by the plan rules in Business rules.
  - Success: `202 {"status":"confirmation_sent"}` when the confirmation email reached the mail service before the response, otherwise `202 {"status":"confirmation_queued"}`. The answer is the same whether or not the address already has a draft or a confirmed hour.
  - Extra errors: `422` with `fields`; `429` with header `Retry-After: <seconds>`.
- `POST /api/session/request`
  - Body: `{"email"}`.
  - Success: `202 {"status":"link_sent"}`, always, whether the address is known or not and whether mail is up or not.
  - Extra errors: `422` with `fields.email`; `429` with `Retry-After`.
- `POST /api/session/verify`
  - Body: `{"token"}`.
  - Success: `200 {"signed_in":true,"email":"<address>","confirmed":true|false}`, plus the session cookie.
  - Extra errors: `404 link_unknown`; `410 link_used`; `410 link_expired`; `422` with `fields.token` when the token is missing or not a string.
- `POST /api/session/end` → `204`, with the cookie cleared. Answers 204 even without a session.
- `GET /api/me/plan` → `200 {"plan":<plan>}`. Extra error: `404 no_plan` when the signed-in address has no confirmed hour.
- `PATCH /api/me/plan`
  - Header `If-Match: <version>`: the version number, bare or in double quotes. A value that is not a number counts as a mismatch.
  - Body: one or more of `bedtime`, `time_zone`, `rituals`, `note` and `reminders`; omitted keys keep their stored values. Which keys are checked is set by the plan rules in Business rules.
  - Success: `200 {"plan":<plan>}` with `version` one higher.
  - Extra errors: `404 no_plan`; `428 version_required`; `409 version_conflict` with the current hour at `error.current`, as in `{"error":{"code":"version_conflict","message":"...","current":<plan>}}`; `422 invalid` (with `fields` for bad or extra fields, without `fields` for an empty or missing body).
- `POST /api/me/share` → `201 {"share":{"url":"/p/<token>","created_at":"<ISO UTC>"}}`. Extra error: `404 no_plan`.
- `DELETE /api/me/share` → `204`, whether or not a link existed. Extra error: `404 no_plan`.
- `GET /api/share/<token>` → `200 {"plan":{"bedtime","time_zone","rituals":[{"id","title","minutes"}],"total_minutes"}}`, and nothing else. Extra error: `404 not_found` for an unknown, replaced, turned-off or deleted link. `POST`, `PUT`, `PATCH` and `DELETE` on this path answer 405.
- `DELETE /api/me` → `204`, with the cookie cleared.
- `PUT /api/test/clock`
  - Body: `{"now":"<ISO 8601 with Z or an offset>"}`.
  - Success: `200 {"now":"<same instant, ISO UTC with milliseconds>"}`.
  - Extra error: `422` with `fields.now` "Send an ISO 8601 date and time with a time zone."
- `DELETE /api/test/clock` → `204`.
- Both test-clock routes exist only when the environment variable `STILLHOUR_TEST_CLOCK` is `1`. Otherwise both answer `404 not_found`.

**Data routes** are every `/api` route except `/api/health`.

**Session cookie.** `stillhour_session`, opaque, `HttpOnly`, `SameSite=Lax`, `Path=/`, `Max-Age` 2,592,000 seconds (30 days). A session lasts 30 days from sign-in on the app clock; after that it answers as missing.

### Business rules (DP-18, DP-19, DP-20, DP-22, DP-23, DP-24, DP-26, DP-28, DP-29, DP-32, DP-33, DP-35, DP-36, DP-37, DP-38, DP-40, DP-41, DP-42, DP-44, DP-47)

**App clock.** Every server time rule uses the app clock. The app clock is real time, unless the test clock is set; then it is that instant, frozen until it is changed or cleared. The set instant is stored in the database, and every instance uses it within 1 second. Every duration below is checked by moving the test clock.

**Plan rules.** The field rules below are shared by `POST /api/plans` and `PATCH /api/me/plan`. Which keys each request must or may carry differs:

- **Saving a new hour (`POST /api/plans`).** `email`, `bedtime`, `time_zone` and `rituals` are required; a missing one fails with its own field message. `note` is optional and defaults to `""`. `reminders` is not accepted. Every key present is checked.
- **Editing an hour (`PATCH /api/me/plan`).** No key is required; the body carries one or more of `bedtime`, `time_zone`, `rituals`, `note` and `reminders`. Only the keys present are checked; an omitted key keeps its stored value and is never an error. The supplied values are then laid over the stored hour, and the merged hour must meet every field rule below except the email rule, which PATCH never checks because the address cannot change. Since the stored values already met these rules, a failure always names a supplied key. `email` is not accepted.

Field rules:

- **Email:**
  - What is valid: trimmed and lowercased; at most 254 characters; one `@` with text on both sides and a dot in the domain part.
  - Field message: "Enter an email address, like name@example.com."
- **Bedtime:**
  - What is valid: `HH:MM` on 24-hour time, `00:00` to `23:55`, minutes a multiple of 5.
  - Field message: "Choose a bedtime on a five-minute step, like 22:30."
- **Time zone:**
  - What is valid: a name from the IANA time-zone database, such as `Europe/London` or `UTC`. Offsets such as `+02:00` and unknown names are refused.
  - Field message: "Choose a time zone from the list."
- **Rituals:**
  - What is valid: a list of 1 to 6 items. Each item has exactly the keys `id` (a catalogue id from Seed data, no repeats) and `minutes` (5 to 30 in steps of 5). The total is at most 60; exactly 60 is allowed. When supplied on PATCH, the list replaces the stored list whole.
  - Field message: "Choose between one and six rituals, 5 to 30 minutes each, 60 minutes at most in total."
- **Note:**
  - What is valid: a string of 0 to 280 characters; 280 is allowed and 281 is refused. Characters are counted as a reader sees them: each emoji counts as 1, including emoji built from several symbols, such as a family or a flag, and an accented letter counts as 1.
  - Field message: "Keep your note to 280 characters."
- **Reminders** (PATCH only):
  - What is valid: `"on"` or `"paused"`.
  - Field message: "Choose on or paused."
- **Any other key:**
  - Refused, including `version`, `id`, `reminders` on POST, `email` on PATCH, `confirmed`, `share_url` and `status`.
  - Field message: "This field is not accepted."
- **Token** (verify):
  - What is valid: a non-empty string.
  - Field message: "Paste the full link from your email."

A key present with `null` or a value of the wrong type fails its own rule. Every failing field appears in `fields` at once, and a refused request changes nothing.

**Hour states.**
- Saving creates a **draft**. A draft is never counted, never reminded and never returned by `/api/me/plan`.
- Verifying the draft's confirmation token makes it the address's **confirmed** hour with reminders **on**.
- If the address already had a confirmed hour, the draft's bedtime, time zone, rituals and note replace that hour's. The hour keeps its id and share link, its version goes up by one, and reminders are on.
- A new confirmed hour starts at version 1.
- A confirmed hour moves between **on** and **paused** only through `PATCH` `reminders`.
- `DELETE /api/me` moves everything for the address to **deleted**, which is gone. A deleted hour cannot be confirmed, edited, shared or reminded: its old links answer `404 link_unknown`, its share answers `404 not_found`, and its sessions answer 401.
- A later save for the same address starts again from a fresh draft.
- Every successful PATCH raises the version by one, even when the values are unchanged.

**Emailed links.**
- Each link moves from **issued** to **used** or **expired**.
- A link expires 15 minutes after its email was handed to the mail service. For a queued email, that is when it was actually sent, not when it was queued.
- Verification at any moment strictly before that point succeeds and marks the link used. At or after that point the answer is `410 link_expired`.
- A used link answers `410 link_used` from then on, even after it has also expired: used takes precedence over expired.
- A token that never existed, or that was deleted, answers `404 link_unknown`.
- Issuing a new link never cancels older unexpired ones.
- A confirmation token both confirms its draft and signs in; `confirmed` is then `true`.
- A sign-in token only signs in; `confirmed` is `true` when the address has a confirmed hour.

**Sign-in requests.**
- An address with a draft or a confirmed hour receives one "Your Stillhour sign-in link" email per accepted request.
- An address with neither receives nothing.
- The response status, body and headers are identical either way.

**Idempotent saves.**
- The server remembers each Idempotency-Key with its request body and its 202 response for 24 hours on the app clock.
- Within that time, the same key with the same body replays the stored status and body. It creates no draft, sends no email and does not count towards the rate limit. Bodies are compared as parsed JSON, so key order and spacing do not matter.
- The same key with a different body answers `409 idempotency_conflict`.
- At or after 24 hours the key is forgotten and the request is handled as new.
- When several requests with the same key and body arrive at the same moment, exactly one draft and one confirmation email are made, and every request receives the same 202 body.
- Only 202 responses are remembered.

**Rate limits.**
- `POST /api/plans`: at most 3 accepted saves per email address in any 60 minutes on the app clock. The 4th answers 429.
- `POST /api/session/request`: at most 5 accepted requests per email address in any 60 minutes. The 6th answers 429.
- Counts apply to every address in the same way, known or not, and are kept for their hour even after Delete everything.
- `Retry-After` is the number of whole seconds, rounded up and at least 1, until the oldest counted request is 60 minutes old.

**Concurrent edits.**
- When two edits arrive with the same `If-Match` version, exactly one succeeds and the other answers 409 with the winner's hour at `error.current`.
- An edit with an older version always answers 409 and changes nothing.

**Derived values.**
- `starts_at_local` is the bedtime minus 60 minutes on the wall clock, wrapping past midnight. For example, a bedtime of 00:30 gives 23:30.
- `total_minutes` is the sum of the rituals' minutes.
- The live count is the number of confirmed, non-deleted hours with reminders on. It is exact on the first request after any confirmation, pause, resume or deletion.

**Reminders.**
- A **night** is the local calendar date, in the hour's time zone, on which the hour starts. A bedtime of 00:30 starts its hour on the previous date.
- Each night's reminder is due at that date's `starts_at_local` in the hour's time zone, with two adjustments:
  - If that local time does not exist because the clocks spring forward, it is due at the first valid local minute after it.
  - If it happens twice because the clocks fall back, it is due at the first occurrence only.
- The reminder subject's `<HH:MM>` is the local time at which that night's reminder is due.
- The **reminders-start moment** is the latest of: the confirmation, the last change of `reminders` to `on`, and the last edit of `bedtime` or `time_zone`.
- A night is eligible only if its due time is at or after the reminders-start moment.
- While reminders are paused, no night is eligible.
- On each scheduler run, every eligible night that is due and has no reminder record gets one:
  - If the app clock is no more than 60 minutes past the due time (exactly 60 counts as on time), the reminder email is written to the outbox and a "sent" record is kept for that hour and night.
  - If the app clock is more than 60 minutes past, a "skipped" record is kept and nothing is sent.
- No hour ever gets a second record for the same night, so no keeper gets more than one reminder per night, even if the time zone or bedtime changes that night or several instances run.
- The scheduler runs at least every 30 seconds of real time, and also inside every `PUT /api/test/clock` before it answers.
- `next_reminder_at` is the due time of the earliest eligible night that has no record, in UTC; it is null while paused.

For example (these values hold whatever is stored):
- An hour with bedtime 23:00 in `Asia/Tokyo` is due at 22:00 Tokyo time, which is 13:00 UTC.
- An hour with bedtime 03:30 in `America/New_York` on the night of 14 March 2027 would start at 02:30, which does not exist that night. It is due at 03:00 local (07:00 UTC), with subject "Your Stillhour starts at 03:00".
- An hour with bedtime 02:30 in `America/New_York` on the night of 1 November 2026 starts at 01:30, which happens twice. It is due once, at 05:30 UTC, and never at 06:30 UTC.

**Share links.**
- `POST /api/me/share` creates a new random token of at least 22 URL-safe characters. Any previous link stops working at once.
- `DELETE /api/me/share` stops the current link.
- A link keeps working while the hour is paused and dies with the hour.
- The shared view exposes only the fields in API and can change nothing.

**Delete everything.** Removes all of the following for the address, in one step:
- the confirmed hour;
- every draft;
- every emailed link;
- every session;
- the share link;
- every unsent email in the outbox;
- every reminder record, so no future reminder can be sent.

Emails already delivered stay in the recipient's inbox.

### Services (DP-21, DP-35, DP-46, DP-47)

**PostgreSQL** is the only system of record. It holds:
- drafts and confirmed hours, with rituals, bedtime, time zone, note, reminder state and version;
- emailed links;
- sessions;
- share links;
- Idempotency-Keys;
- rate-limit counts;
- the outbox of emails;
- the record of every reminder sent or skipped per hour and night;
- the test clock.

The app creates its tables on every serve if they are missing, so an empty database works.

- **Database outage.** While the database is unreachable, every data route answers 503 `unavailable`. `/api/health` and every page and asset are still served. The first request after the database returns succeeds, without a restart, and if the tables were never created they are created then.

**Mailpit** receives every email over SMTP. Every message is From the value of `MAIL_FROM`, which is set to `Stillhour <goodnight@stillhour.example>`. The app sends exactly three kinds:

| Subject | Sent to | When | Body |
|---|---|---|---|
| "Confirm your Stillhour" | the draft's address | one per new draft (never for a replay) | the hour's bedtime as `HH:MM`, time zone and rituals, and the link `<origin>/signin?token=<token>` with the line "This link works once, for 15 minutes." |
| "Your Stillhour sign-in link" | an address with a draft or confirmed hour | one per accepted sign-in request | the link `<origin>/signin?token=<token>` with the same line |
| "Your Stillhour starts at <HH:MM>" | the hour's address | one per reminded night | the bedtime as `HH:MM`, the rituals with their minutes, and a link to `<origin>/manage` to change or pause reminders; never the note |

`<origin>` is `STILLHOUR_PUBLIC_ORIGIN` when it is set, and otherwise `http://localhost:<port>`.

- **The outbox.** Every email is first written to the outbox in the database, in the same step as the change that causes it, then handed to SMTP.
  - A save tries delivery before it answers; that attempt decides `confirmation_sent` or `confirmation_queued`.
  - Every instance that can reach the mail service retries undelivered outbox emails at least every 15 seconds.
  - Each email is claimed by one instance at a time and marked sent when SMTP accepts it, so it reaches Mailpit exactly once, even with several instances sharing one database.
  - An email in the outbox is delivered when mail returns, however late; the 60-minute lateness rule applies only to deciding whether a reminder is written.
- **Mail outage.** While mail is unreachable:
  - saves answer `confirmation_queued` and show the queued copy;
  - sign-in requests still answer `link_sent`;
  - reminders queue in the outbox.
  Nothing else in the app is affected.

### Seed data (DP-11, DP-18)

At start the database is empty. The app makes its tables on serve; there are no hours, drafts, links or emails. The ritual catalogue is fixed in this order, and its default minutes add up to exactly 60:

| id | Title | Default minutes |
|---|---|---|
| `dim-lamps` | Dim the lamps | 10 |
| `warm-shower` | Warm shower | 15 |
| `paper-not-pixels` | Paper, not pixels | 15 |
| `tomorrow-list` | Tomorrow list | 5 |
| `slow-stretch` | Slow stretch | 10 |
| `breathe` | Breathe | 5 |

Every person or address in examples, tests and copy is invented (for example `mira@example.com`).

## Technical requirements

### Deployment (DP-49)

- **Runtime.** Node.js 22 with npm is available. Write all server and browser code in TypeScript.
- **Run manifest.** At the root of `/app`, provide `run.json` with string fields `install`, `build` and `serve` and `"_schema":"run-manifest-v1"`, for example:

```json
{"_schema":"run-manifest-v1","install":"npm ci","build":"npm run build","serve":"npm run start"}
```

- **Serving.** `serve` listens on `0.0.0.0`, on the port in `APP_PUBLIC_PORT` when it is set and otherwise on 4173. Additional instances may run on other ports against the same database.
- **Health.** `GET /api/health` answers HTTP 200 with JSON `{"status":"ok"}` within one second of the server listening, whatever the state of the database and mail.

### Configuration and secrets (DP-52)

The app reads its configuration from the environment once, at start:
- `DATABASE_URL`: the PostgreSQL connection string.
- `SMTP_HOST` and `SMTP_PORT`: Mailpit's SMTP server.
- `MAIL_FROM`: the From address of every email.
- `APP_PUBLIC_PORT`: the listening port.
- `STILLHOUR_PUBLIC_ORIGIN`: optional; the origin used in email links.
- `STILLHOUR_TEST_CLOCK`: `1` enables the test clock.

`MAILPIT_URL` is for inspecting mail and is not needed by the app. No credential, host or password is hard-coded, logged in full, or sent to the browser in any page, script or response. The app connects as a non-superuser database owner.

### Server boundary (DP-50, DP-51, DP-46)

- **Same-origin writes.** A `POST`, `PUT`, `PATCH` or `DELETE` whose `Origin` header is present and is not the origin the request was addressed to (scheme, host and port of its `Host`) answers `403 cross_origin`. Writes without an `Origin` header are accepted.
- **Body size.** A request body may be at most 16,384 bytes; 16,384 is allowed. A larger body, by `Content-Length` or by actual size, answers 413 before it is parsed.
- **Media type.** A request with a body whose content type is not `application/json` (a `charset` parameter is allowed) answers 415.
- **Malformed JSON.** A body that is not valid JSON answers `400 invalid_json`.
- **Unexpected failures.** An unexpected failure answers `500 internal` with its plain sentence. No response ever contains a stack trace, SQL, a file path or a library name.
- **What is served.** The server serves only the built pages and assets and the API. It never serves source files, `run.json`, lockfiles, environment files or configuration; for example, `GET /.env` and `GET /package.json` answer 404.
- **Unknown addresses.** An unknown page address answers 404 with a short page reading "This page is not here." and a link home.
- **Booting without dependencies.** If the database or mail is unreachable at boot, the server still starts and serves the story and `/api/health`, and connects as soon as each dependency answers.

### Browser support and performance (DP-01, DP-55, DP-56)

- **Browsers.** Current Chromium, Firefox and WebKit, at 375x812 (touch), 768x1024 (touch) and 1280x800 (pointer), with and without reduced motion.
- **Gate.** On a local connection the gate reaches 100% and offers its buttons within ten seconds.
- **Scroll.** Every scroll-linked value settles within a tenth of a second after scrolling stops.
- **API.** Every API response other than the test clock arrives within two seconds.
- **Assets.** The page loads no fonts, scripts, audio, film or textures from any other origin.

## Working rules

- IF-01: Ship `/app/run.json` with exactly the string fields `install`, `build`, `serve` and `"_schema":"run-manifest-v1"`.
- IF-02: Ship `/app/THIRD_PARTY_NOTICES.md` listing every shipped package, meaning the production dependency tree from `npm ls --omit=dev --all --json`, with its name, version and licence, plus every bundled font and its licence.
- IF-03: Shipped packages (the production dependency tree from `npm ls --omit=dev --all --json`) use only MIT, ISC, BSD-2-Clause, BSD-3-Clause, Apache-2.0 or 0BSD licences; fonts use the SIL Open Font License 1.1.
- IF-04: Use no datastore other than the provided PostgreSQL: no SQLite, Redis, embedded database or files written as application state.
- IF-05: Leave the provided service configuration and its development credentials unchanged.
- IF-06: Serve every font, audio file, film, caption track and texture from the app itself; nothing is fetched from a CDN or other origin at runtime.
- IF-07: Write all server and browser source in TypeScript.

## Engineering standards

- The TypeScript is idiomatic and strictly typed, with no `any` except at JSON parse boundaries, where values are then validated.
- Names in the code match the domain terms in this brief: hour, draft, ritual, bedtime, time zone, reminder, night, share link, outbox, live count.
- Each domain rule is decided in exactly one place in the source: the plan rules, the hour's state transitions, the reminder due-time and night calculation, link expiry, the live count, idempotent replay and the rate limits.
- Every API error is built through one error shape; no route writes its own error body by hand.
- There is no abstraction with only one implementation, and no defensive check for a state the rules above make impossible.
- There is no dead, commented-out or unreachable code, and no feature, setting or endpoint beyond this brief.
- Scenes, audio and the film player are real code: geometry built in code, sound decoded from the app's own files, and no mocked or simulated server state in the browser.
