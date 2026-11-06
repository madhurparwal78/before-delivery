# Mela Events

Mela is a free public event platform for small community hosts such as run clubs, book circles, board-game evenings and firework watch parties. Each event gets its own themed page with a Registration card that the server renders. People can discover events by city and by category, follow community calendars, and join guest lists that the host approves. An event's street address stays private until the host lets a guest in, and no event ever takes more approved guests than its capacity. You build a Flask app with Jinja templates, served by a production WSGI server, with Alpine.js served from the app's own origin. All data lives in the PostgreSQL database at `DATABASE_URL`, and that is the only backing service. Out of scope: pricing, billing, paid tickets, ticket types, an app download, phone sign-in, social sign-in, passkeys, chat and translation. There is no datastore other than PostgreSQL.

## Problem and users

Small community hosts gather people today through group chats and spreadsheets. They post a street address in public and then get more people at the door than the room holds. They cannot tell who is really coming, and they have no fair way to hand a freed place to the next person waiting. Guests cannot tell whether their request was seen, whether they are in, or where they stand in the queue. Mela gives each event a public page that shows only the city, a guest list the host decides, a capacity the server enforces, and a waitlist that moves up in a fair order.

Every event, host, guest, venue and community in Mela is invented. The only brand name in the product is Mela.

| Role | Goal and limits |
|---|---|
| Visitor | Not signed in. Reads the landing page, `/discover`, community pages and public event pages, and opens a private event only by its direct link. Sees the city of every event but never the street address or the virtual link. Cannot register, follow, contact a host, report an event, create an event or open `/home`, `/create` or any manage page. |
| Guest | A signed-in member. Can do everything a visitor can, and can also request to join or register for events, join and leave waitlists, cancel their own registration, follow community calendars, contact a host, report an event and see their own events on `/home`. Sees an event's street address only while the host has approved them. Cannot read any guest list or change another member's registration. |
| Host | A signed-in member who created an event. For that event only, sees the street address and the guest list with each guest's name and email; approves, declines and removes guests; edits the event, including its capacity; and closes or reopens registration. Cannot manage an event they did not create, and cannot reach a guest of one of their events through the manage page of another. |

## Journeys

The route inventory below is the whole information architecture.

| Route | Purpose | Access |
|---|---|---|
| `/` | Landing page | Public |
| `/discover` | Discover events by city and category | Public |
| `/c/{slug}` | One community calendar | Public |
| `/{slug}` | Event page with the Registration card | Public; private events by direct link only |
| `/signin` | Sign in or sign up | Public |
| `/home` | My events, Upcoming and Past | Member |
| `/create` | Create an event | Member |
| `/manage/{slug}` | Guest list and event settings | Host of that event only |

1. **Request to join while signing up.**
   - Start: a visitor on `/discover`.
   - They choose `Gurugram` and then `Games`, and open `Founders Board Game Night`. The location shows the city only, with the address-hidden line.
   - They press `Request to Join`, are sent to sign in, enter a new email, choose a name and a password, and press `Create Account`.
   - End: they land back on the event with the request already made. The card shows the pending state, and `/home` lists the event with the pending pill. Nowhere on the page, in its title or in any toast does the street address appear.
   - (Had the visitor followed a sign-in link whose `next` pointed away from Mela, signing up would have landed them on `/home` instead.)
2. **Host runs a small approval event.**
   - Start: a signed-in member on `/create`.
   - They name an event and set a start and an end. They add an offline venue with a street address and a city, turn on `Require Approval`, set the capacity to two with `Waitlist Enabled`, and press `Create Event`.
   - Three guests request to join. On `/manage/{slug}` the host approves two of them. Approving the third is refused with the at-capacity message, so the host declines the third.
   - The first approved guest reloads and sees the approved state with the full street address. The declined guest sees the declined state, with no address and no action.
   - With two guests going, the host tries to lower the capacity to one and is refused beside `Capacity` with the floor message. They raise it to three instead and the edit is saved.
   - The host removes the first approved guest. On that guest's very next load the address is gone.
   - Partway through, the database drops out. The host's next load of `/manage/{slug}` shows Mela's short-break page. Once the database returns, the host presses `Try Again` and carries on in the same session without signing in again.
3. **Register and cancel at once.**
   - Start: the seeded guest Ravi Menon, signed in, on `/runclub7`.
   - They press `Register`. The card, the going count and the capacity meter change in place, the change is announced, and a celebration plays.
   - They press `Cancel Registration`. End: the going count is one lower than it was after registering.
4. **Access code.**
   - Start: a signed-in guest who follows the `firework shows` link on the landing page to `/fireworx`.
   - The card shows the access-code state. They press `I have an access code`, enter a wrong code and press `Submit Code`. The invalid-code message appears beside the field.
   - They enter the code from Seed data and are registered. The street address appears and fireworks burst.
   - (Had they entered five wrong codes in a row, the sixth attempt would have shown the lockout message beside the field, and even the right code would have been refused until the lock ran out.)
5. **Follow and contact.**
   - Start: a signed-in member on `/discover`.
   - They press `Follow Chapterhouse Readers`, and the button turns into `Following`. They open `/c/chapterhouse` and see a follower count one higher than before.
   - They open `Small Press Zine Fair`, press `Contact the Host`, type a message and press `Send`. If that send fails, as defined under Outage, in-page in Feedback states (for example, its answer is lost), the dialog stays open with the in-page outage alert, and pressing `Send` again still delivers exactly one message to the host.
   - End: the dialog closes, focus returns to `Contact the Host`, and the sent toast appears.
6. **Move up from the waitlist.**
   - Start: the seeded guest Lena Ortiz, plus a new member, on the full `/potterya`.
   - The new member presses `Join Waitlist` and the card reads that they are first in line.
   - Lena presses `Cancel Registration`. In that same request the waiting member becomes approved, and Lena's toast names who moved up.
   - End: on their next visit the new member sees the approved state with the moved-up line and the street address, and the celebration plays once.

## Mandatory requirements

This is the complete list of mandatory requirements; every check traces to one of these lines and the detailed sections below.

- **DP-01 — Healthy deployment** `GET /api/health` answers 200 as soon as the server listens, with `"status": "ok"` once the database answers and seeding has finished and `"status": "unavailable"` before that, and the server listens on every interface at the public port.
- **DP-02 — Seed data** The three seeded members, the fifteen seeded events and the four communities exist exactly once with the values under Seed data, after any number of restarts and when two instances boot together.
- **DP-03 — Self-contained runtime** Pages load only from the app's own origin, with Alpine.js served by the app, and contact no other host.
- **DP-04 — Sign up** `POST /api/auth/signup` creates one member with an HttpOnly session cookie and refuses a taken email in any letter case with 409, and `POST /api/auth/check` reports whether an email exists.
- **DP-05 — Sign-up validation** An invalid email, a password shorter than eight characters or a missing name returns 422 and stores no member.
- **DP-06 — Generic sign-in failure and sign-out** A wrong password and an unknown email get the same 401 response, and signing out stops the token and the cookie at once.
- **DP-07 — Salted password hashes** Passwords are stored only as salted hashes, so one password never yields the same stored value for two members.
- **DP-08 — Sign-in screen** `/signin` takes a visitor from the email step to the password or new-account step, shows a failed sign-in as one generic alert and lands on `next` or `/home` on success, as qualified in Interactions.
- **DP-09 — Visitor boundary** Every member-only endpoint answers 401 to a visitor and leaves events, registrations, follows, host messages and reports unchanged.
- **DP-10 — Member pages** `/home`, `/create` and `/manage/{slug}` redirect a visitor to `/signin?next=` with the requested path and open for a member.
- **DP-11 — Host-only management** The guest list, the manage page, event edits and guest decisions answer not found to any signed-in member who is not the host and change nothing.
- **DP-12 — Address privacy** The street address, the `Open in maps` link and the virtual link reach only the host and approved guests, in every API response and page.
- **DP-13 — Landing page** `/` renders its headline, paragraph links, actions and every section in the first response, and its three example links and quiet buttons change colour on hover.
- **DP-14 — Hero motion** The first hero word cycles through its four words and the floating covers scatter as the page scrolls and gather again on the way back, while under reduced motion the word stays on `Joyful` and nothing moves.
- **DP-15 — Discover filters** City and category filters narrow the list to upcoming public events, put `?place=` and `?category=` in the address and never show a private or past event.
- **DP-16 — Discover sections and counts** `/discover` shows its four sections with the twelve category tiles and the six city tiles, counting only upcoming public events.
- **DP-17 — Registration card states** Each event page renders the right Registration card state, one level-one heading and its sections in the first HTML response.
- **DP-18 — Dates and times** The event page shows the date tile, the long date and the time range in the event's own time zone.
- **DP-19 — Countdown and capacity meter** The countdown and the capacity meter are correct in the first response, the countdown ticks every second, and the meter and card update in place from the response to a card action.
- **DP-20 — Themes** The `night` event page is dark with light text, the five other themes are light with dark text, and the theme accent fills the primary button.
- **DP-21 — Event page layout** On a narrow screen the event page stacks the cover, the title, the Registration card, `About Event` and `Hosted By` in that order.
- **DP-22 — Request to join** A visitor who presses `Request to Join` on `Founders Board Game Night`, signs up and returns sees the pending card state, and `/home` lists the event with the pending pill.
- **DP-23 — Host decisions** Approving, declining and removing guests move registrations only along the edges in Business rules and refuse every other change with 409.
- **DP-24 — Capacity under concurrency** Simultaneous registrations and approvals for the last places never approve more guests than the capacity.
- **DP-25 — One registration per member** A repeat request returns 200 with the existing status and stores no second registration, and a cancelled member may register again.
- **DP-26 — Fair queue under concurrency** Places freed by simultaneous cancellations go to waiting guests in queue order, never to newcomers.
- **DP-27 — Register and waitlist** An open event approves at once or records a pending request, a full event waitlists or refuses by its waitlist setting, and the card shows the matching state.
- **DP-28 — Automatic promotion** Cancelling, removing an approved guest, raising the capacity or making it unlimited moves waiting guests up in queue order within the same request, as qualified in Business rules.
- **DP-29 — Queue positions** A waitlisted guest's place in the queue shows as a number in the API and as an English ordinal on their card and on the manage page.
- **DP-30 — Registration refusals** Closed, ended and code-only events refuse registration with 403, and a host registering for their own event gets 409.
- **DP-31 — Access codes** A guest on `/fireworx` is refused a wrong code beside the field and registers with the valid code, which matches with its letter case after surrounding spaces are trimmed.
- **DP-32 — Create event** `POST /api/events` stores the event in UTC with a new eight-character slug, applies every default and escapes authored text.
- **DP-33 — Event validation** Each invalid create-event or edit field returns 422 with that field in `errors` and stores nothing.
- **DP-34 — Create form** `/create` offers every field and the six-theme shuffle, shows inline errors that keep what was typed, then publishes to `/{slug}`.
- **DP-35 — Edit and close** The host edits only the fields a request carries, moves registration status only along its edges and can close and reopen registration without touching registrations.
- **DP-36 — My events** `/api/me/events` and `/home` list the member's upcoming and past events with the right pill in the stated order.
- **DP-37 — Following** A follow counts once even under simultaneous requests, can be undone and redone, and its button turns into `Following`.
- **DP-38 — Contact and report** Host messages and reports are validated and stored, and each dialog keeps focus inside, closes with Escape and returns focus.
- **DP-39 — Live card updates** A guest who registers for `/runclub7` and then cancels sees the card, going count and meter change in place and hears each change announced politely without focus moving.
- **DP-40 — Notifications** Member actions confirm with the named toasts, at most three show at once, and each waits while hovered or focused and closes with `Dismiss notification` or Escape.
- **DP-41 — Celebration** A confirmed place plays one confetti or firework celebration that never blocks, never replays on reload and never plays under reduced motion.
- **DP-42 — Global chrome** The header shows `Sign In` to visitors and the initials avatar menu to members, and `/home` shows its tabs, empty state and pills.
- **DP-43 — Accessible public pages** The landing page, `/discover`, a community page, an event page and `/signin` meet WCAG 2.2 AA.
- **DP-44 — Accessible themes** An event page in each of the six themes meets WCAG 2.2 AA.
- **DP-45 — Accessible member pages** `/home`, `/create`, a manage page and an event page seen by its host meet WCAG 2.2 AA.
- **DP-46 — Skip link** `Skip to Content` is the first focus target and moves focus into the main content.
- **DP-47 — Reflow at 320 pixels** Every page reflows at 320 CSS pixels wide without sideways scrolling.
- **DP-48 — Not-found responses** Unknown addresses, unknown events, unknown communities and `/pricing` answer 404 with Mela's own not-found page.
- **DP-49 — Not-found page** The not-found page's `Back to Discover` link takes the visitor to `/discover`.
- **DP-50 — Visual design** The pages follow the palette, type, shapes and shadows under Visual design.
- **DP-51 — Engineering standards** The code meets every line under Engineering standards.
- **DP-52 — Outage and recovery** The app starts and serves Mela's 503 page and bodies while PostgreSQL is unreachable, then recovers without a restart and keeps existing sessions, within the times in Server boundary.
- **DP-53 — Strict request bodies** Every JSON endpoint refuses a non-object body, an unknown key or a wrongly typed value with 422 and stores nothing.
- **DP-54 — Immediate loss of access** A declined or removed guest loses the address on their very next request and cannot undo the decline by cancelling or registering again, and no event response may be stored by any cache.
- **DP-55 — Counts from the committed change** Every registration and guest-decision response reports the counts as of its own committed change and names the guests it moved up, and every event object keeps going count plus places left equal to capacity.
- **DP-56 — Capacity edits and queue order** A capacity edit never drops below the going count and never loses a concurrent edit, and promotions take only the earliest guests in a queue where a guest who rejoins goes to the back.
- **DP-57 — Access code lockout** Five wrong access codes from one member on one event within the lockout window answer every further attempt with 429 and `Retry-After`, counted atomically across instances.
- **DP-58 — Guest records belong to their event** A guest decision acts only on a registration of the event in its path, and a guest id from another event or not a canonical positive whole number answers JSON not found and changes nothing.
- **DP-59 — One message per send** A contact or report sent again with the same `Idempotency-Key` and body returns the first id and stores nothing new even under simultaneous sends, the same key with a different body is refused with 422, and the dialog resends its key after a failed send.

## Frontend

### Screens and layout (DP-13, DP-15, DP-16, DP-17, DP-18, DP-19, DP-21, DP-36, DP-42, DP-47)

Every page renders its text, links and Registration card state on the server, so it reads correctly before any script runs. Alpine.js adds the dialogs, the theme picker, the filters and the card actions on top. No page scrolls sideways at 375x812, 768x1024 or 1280x800, or at any width down to 320 CSS pixels.

**Landing page (`/`).** The landing page is centred on a white page.
- **Headline.** A three-line headline sits under the sparkle mark:
  1. a first word that cycles through `Joyful`, `Cozy`, `Lively` and `Bright`;
  2. `gatherings`;
  3. `made simple`, filled with a magenta-to-amber gradient.
- **Paragraph.** Under the headline: `From run clubs to launch parties and firework shows, Mela makes every event feel effortless.` Here `run clubs` links to `/runclub7`, `launch parties` links to `/launchpt` and `firework shows` links to `/fireworx`, each with a wavy underline.
- **Actions.** A dark `Create Your First Event` pill opens `/create`. A quiet `Discover Events` link with an arrow opens `/discover`.
- **Floating covers.** Twelve square event covers float around the headline at mixed sizes and gentle tilts, in white-framed cards with soft shadows.
- **Sections below the hero, in order:**
  1. `Coming Up in`, with a city switcher of the six cities that defaults to `New Delhi` and up to six upcoming public events in the chosen city as cards (cover, title, weekday and time). This default applies to the landing page only.
  2. `Multi-Day Highlights`: up to four wide cards for the soonest upcoming public events that span more than one calendar day, each with its date range and city.
  3. `Communities to Join`: community cards with avatar, name and one-line description.
  4. `Browse by Category`: the twelve category tiles.
  5. A closing line, `Someone is saving you a seat.`, with `Discover Events`.
- **Layout by viewport.**
  - At 1280x800 the covers ring the headline on both sides.
  - At 768x1024 they sit in two loose columns beside a narrower headline.
  - At 375x812 the headline shrinks and the covers gather in a loose cluster under the buttons.

**Discover (`/discover`).**
- **Header.** The heading `Discover Events` and the line `Find something to do near you, browse by what you love, or follow a community calendar.`
- **Sections, in order:**
  1. **`Coming Up`**, followed by the current filter label: the city name when only a city is chosen, the category name when only a category is chosen, `<category> in <city>` when both are chosen, and `All cities` when neither is chosen. Then a quiet `View All` button and a list of up to six matching events. With no filter, the list holds upcoming public events from every city. Each row shows a square cover, the start in the event's zone (for example `Wed, Oct 21, 5:00 PM`), the title clamped to two lines, and the venue name. `View All` expands the list in place to every matching event.
  2. **`Browse by Category`**: the twelve tiles `Family`, `Books`, `Games`, `Tech`, `Food & Drink`, `AI`, `Running`, `Arts & Culture`, `Climate`, `Fitness`, `Wellness` and `Crypto`. Each tile has a tinted icon, its name and `<count> Events` (`1 Event` in the singular).
  3. **`Community Calendars`**: community cards with a `Follow` button.
  4. **`Events by City`**: a region tab `South & East Asia` over a grid of the six cities, each with its `<count> Events`.
- **Filters.** Choosing a city or a category filters the list in place and writes `?place=<slug>` or `?category=<slug>` to the address, so a shared link restores the filter. A category with no city chosen covers every city.
- **Layout by viewport.**
  - At 1280x800 the event list has two columns, categories four columns and cities three columns.
  - At 768x1024: two, three and two columns.
  - At 375x812: one column for events, two for categories and two for cities.

**Event page (`/{slug}`).**
- **Wide screens (1280x800): two columns.**
  - The left column holds:
    - the cover;
    - `Presented by` with the community name and `Follow`, when the event belongs to a community;
    - `Hosted By` with the host's avatar and name;
    - the going count `<n> Going`;
    - when the host shows the guest list, up to six overlapping guest avatars and a names line such as `Ravi Menon, Lena Ortiz and 3 others`;
    - quiet `Contact the Host` and `Report Event` links.
  - The right column holds:
    - an optional chip: `Featured in <city>` for public events, `Private Event` for private ones;
    - the event name as the only level-one heading;
    - the date tile (month abbreviation over the day number);
    - the long date (for example `Wednesday, October 21`) and the time range (for example `5:00 PM - 8:00 PM`), both in the event's own time zone;
    - the countdown;
    - the location row;
    - the Registration card;
    - `About Event`;
    - `Location`.
- **Countdown.** Under the time range, an upcoming event shows `Starts in` with a countdown that is correct in the first HTML response and then ticks every second without a reload.
  - A start one day or more away reads days, hours and minutes, for example `3 days 04 hrs 12 min`.
  - A closer start reads hours, minutes and seconds, for example `5 hrs 07 min 09 sec`.
  - The first number has no leading zero and every later number has two digits. A single unit reads `1 day`, `1 hr`.
  - A running event reads `Happening now`. An ended event shows no countdown.
- **Location for the host and approved guests.** The location row and the `Location` section show the venue name, the street address, the city and an `Open in maps` link. The link is a `geo:` link with the address as its query, so no outside host is named. A virtual event shows its link only to the same viewers.
- **Location for everyone else.** The address-hidden copy from Feedback states and the city only.
- **Narrower screens.** At 768x1024 and 375x812 the page becomes one column in this order: cover, title, date and countdown, location row, Registration card, `About Event`, `Location`, `Hosted By`, then the guest block and the quiet links.

**My events (`/home`).**
- **Tabs.** Two tabs.
  - `Upcoming` lists events that have not ended where the member is the host or holds a pending, approved, waitlisted or declined registration, soonest first.
  - `Past` lists ended events where the member was host or held any status except cancelled, most recent first.
- **Rows.** Each row shows the cover, title, date and time, and one pill: `Hosting`, `Going`, `Pending`, `Waitlist` or `Declined`. A declined registration on an upcoming event appears in `Upcoming` with `Declined`.
- **Layout.** Rows have the cover on the left at every viewport. At 375x812 the pill wraps under the title.

**Manage event (`/manage/{slug}`).** Only the event's host can open this page.
- **Summary.** The event name links to the public page. Counts for `Going`, `Pending`, `Waitlist` and `Declined` sit beside the capacity or `Unlimited`.
- **Guest table.** Name, email, requested time (in the event's zone) and status, filtered by a `Status` select offering `All`, `Pending`, `Going`, `Waitlist` and `Declined`.
  - Pending rows have `Approve` and `Decline`.
  - Waitlisted rows have `Approve` and `Decline`, and show `<ordinal> in line` beside the status.
  - Going rows have `Remove`.
  - Declined rows have no action.
- **`Edit Event` form.** The fields of the create form, plus `Save Changes`, and `Close Registration` (or `Reopen Registration` while closed).
- **Layout.** At 1280x800 the table and the edit form sit side by side. At 768x1024 they stack. At 375x812 each guest becomes a card with name, email, requested time, status and actions, with nothing cut off.

**Sign in (`/signin`).** A centred card holds a door icon, the heading `Sign in to Mela`, the line `Use your email to sign in or create an account.`, an `Email` field with the placeholder `you@email.com`, and a dark `Continue with Email` button.
- An existing member is then asked for `Password` and presses `Sign In`.
- A new email is asked for `Name` and `Password` and presses `Create Account`.

**Create event (`/create`).**
- **Left side.** A preview cover with the `Theme` select and `Shuffle Theme`.
- **Right side:**
  - `Calendar`, offering `Personal Calendar` and every community the member follows;
  - `Visibility` (`Public` or `Private`);
  - a large `Event Name` field;
  - `Start` and `End` rows, each with a date and a time;
  - a time zone tile defaulting to `GMT+05:30 Kolkata` and also offering `GMT+09:00 Tokyo`;
  - `Add Event Location`, with `Location type` (`Offline` with venue name, street address and city, or `Virtual` with a link);
  - `Add Description`;
  - `Event Options`: `Ticket Price` shown fixed as `Free`, `Require Approval`, `Capacity` with the placeholder `Unlimited`, and `Waitlist Enabled`.
- **Submit.** The button reads `Create Event`.
- **Layout.** At 375x812 the preview stacks above the form.

**Community page (`/c/{slug}`).** The avatar, name, description and city; `<n> Followers` (`1 Follower` in the singular); `Follow` or `Following`; and the community's upcoming public events, soonest first.

**Global chrome.**
- **Header.** Every page except `/` has a slim sticky header:
  - at the left, the Mela wordmark with its sparkle;
  - at the right, the viewer's local time with its offset (for example `2:47 PM GMT+5:30`, updated each minute from the browser clock), `Discover Events`, and a `Sign In` pill.
  - For a member, the pill becomes an initials avatar that opens a menu with `My Events`, `Create Event` and `Sign Out`.
- **Landing header.** The landing page header holds only the sparkle mark and the `Sign In` pill or the avatar.
- **Footer.** `Discover`, `Help` and the sparkle mark.

**Private events.** A private event never appears on the landing page, `/discover`, a category, a community page or any count. It is reachable only by its direct link.

### Public screens and controls (DP-08, DP-12, DP-17, DP-19, DP-29, DP-31, DP-34, DP-37, DP-38, DP-42, DP-46)

These roles and names are public. Anything not listed here is up to you.

| Where | Role and accessible name | Visible copy or notes |
|---|---|---|
| Every page | link `Skip to Content` | the first focusable element; moves focus to the main landmark |
| Header | link `Mela`, link `Discover Events`, link `Sign In`; for members, button `Account menu` opening a `menu` with menuitems `My Events`, `Create Event`, `Sign Out` | the avatar shows initials |
| Landing | links `run clubs`, `launch parties`, `firework shows`, `Create Your First Event`, `Discover Events` | as in Screens and layout |
| Discover | links named by each city and category, button `View All`, tab `South & East Asia`, button `Follow <community name>` | |
| Community page | button `Follow <community name>` or `Following <community name>`, with `aria-pressed` | |
| Event page | img `<event name> cover`; `timer` named `Starts in`; `region` named `Registration`; inside the card, `status` named `Registration status`; buttons `Request to Join`, `Register`, `Join Waitlist`, `Cancel Request`, `Cancel Registration`, `Leave Waitlist`, `I have an access code`, `Submit Code`; textbox `Access code`; `meter` named by its places-taken line; links `Manage Event`, `Open in maps`, `Contact the Host`, `Report Event` | card copy in Feedback states |
| Dialogs | dialog `Contact the Host` with textbox `Message` and button `Send`; dialog `Report Event` with combobox `Reason` (`Spam`, `Misleading`, `Inappropriate`, `Other`), textbox `Details` and button `Send Report`; each has button `Close` | |
| Sign in | textboxes `Email`, `Name`, `Password`; buttons `Continue with Email`, `Sign In`, `Create Account`; one `alert` for failure | |
| Create and Edit Event | combobox `Theme` showing the current theme name; button `Shuffle Theme`; comboboxes `Calendar`, `Visibility`, `Location type`, `Time zone`; textboxes `Event Name`, `Start date`, `Start time`, `End date`, `End time`, `Venue name`, `Street address`, `City`, `Virtual link`, `Description`, `Capacity`; switches `Require Approval`, `Waitlist Enabled`; button `Create Event` or `Save Changes` | |
| Manage page | combobox `Status`; buttons `Approve <guest name>`, `Decline <guest name>`, `Remove <guest name>`, `Close Registration`, `Reopen Registration` | |
| My events | tablist with tabs `Upcoming` and `Past` | pills as in Screens and layout |
| Toasts | `status` region named `Notifications`; on each toast, button `Dismiss notification` | |
| Not-found page | heading level one; link `Back to Discover` to `/discover` | copy in Feedback states |
| Outage page | heading level one; link `Try Again` to the same path | copy in Feedback states |

### Interactions (DP-08, DP-10, DP-14, DP-19, DP-22, DP-34, DP-38, DP-39, DP-40, DP-46, DP-59)

**Sign-in flow.**
- `Continue with Email` checks the email and reveals either the password step or the new-account step without a page load. Enter submits the step that has focus.
- **Where success lands.** Success goes to `next` only when, after percent-decoding, it starts with a single `/`, and contains no backslash, no control character and no scheme. Anything else lands on `/home`. For example, `//host`, `/\host`, `%2F%2Fhost`, `/%5Chost`, `https://host/` and `javascript:…` all land on `/home`, and the browser never leaves the app origin. A safe `next` such as `/c/chapterhouse?x=1` lands exactly there.
- **Member-page redirect.** A visitor opening `/home`, `/create` or `/manage/{slug}` is redirected to `/signin?next=<path>`. `<path>` is the requested path and query, percent-encoded, for example `/signin?next=%2Fhome%3Ftab%3Dpast` for `/home?tab=past`.
- A visitor who presses `Request to Join`, `Register` or `Join Waitlist` goes to `/signin?next=/{slug}`. After signing in or signing up they return to the event with that action already made, and the card shows the result. The page remembers the press in the browser across the sign-in.
- Pressing `Contact the Host`, `Report Event` or `Follow` as a visitor goes to sign in first.

**Card actions.**
- Pressing a card button sends the request and then updates the following in place from the response, without a reload:
  - the card state;
  - the location row and `Location` (the address appears for a newly approved guest);
  - the going count;
  - the meter.
- The new card heading, or the body line for a state with no heading, is announced through `Registration status`. Focus stays on the card's first control, or on the card region when the state has no control.
- `I have an access code` reveals `Access code` and `Submit Code` and moves focus to the field. Enter submits.

**Dialogs.**
- Opening `Contact the Host` or `Report Event` moves focus to the first field. Tab and Shift+Tab cycle inside the dialog.
- Escape or `Close` closes the dialog and returns focus to the link that opened it. A successful send closes it and returns focus the same way.
- **One key per opening.** Each opening of a dialog makes one new random `Idempotency-Key` and sends it with every `Send` or `Send Report` from that opening. When a send fails, as defined under Outage, in-page in Feedback states, the dialog stays open with what was typed and shows the in-page outage alert. Pressing the button again sends the same key, so the host gets one message. Opening the dialog again after a success starts a new key.

**Account menu.** Enter or Space opens it. The arrow keys move between items. Escape closes it and returns focus to `Account menu`.

**Manage page.**
- Decisions update the row, the counts and any promoted rows in place.
- `Save Changes` sends only the fields the host changed since the page loaded. That way two hosts' tabs editing different fields never undo each other.
- A field error appears beside its field.

**Theme picker.** Each press of `Shuffle Theme` moves the preview to the next theme in the fixed order `amber`, `harbor`, `moss`, `plum`, `ember`, `night`. Six presses show every theme once and return to the first. The `Theme` select shows the current name.

**Filters.** On `/discover`, choosing a city or category updates the list and the address without a full page load. Back and Forward restore the earlier filter.

**Toasts.** A toast never takes focus. Hovering or focusing a toast pauses its timer. Escape closes the toast that has focus.

**Keyboard order.** Tab order follows the visual order at every viewport: skip link, header, main content, footer.

### Visual design (DP-20, DP-43, DP-44, DP-45, DP-50)

**Mood.** Mela looks bright, airy and celebratory: lots of white page around a few large, confident elements, and accents that feel like a party poster. The landing page carries a hot magenta that warms into amber across the last headline line and on the logo tint. Event pages each take on their own mood colour: a board-game night feels like warm honey, and a fireworks evening turns deep, dark blue.

**Colour roles.**
- **Base.** A near-white neutral page, near-black ink, a softer grey for secondary text, and a pale translucent grey for hairlines and quiet button fills.
- **Links.** Plain text links in content are a vivid mid blue that deepens on press. Header, footer and pill-styled links stay neutral. A light violet appears only in small accents.
- **Event themes.** Each theme pairs a near-black ink with one accent that tints the page wash, the labels, the meter and the primary button:
  - `amber`: warm near-black with a soft orange;
  - `harbor`: cool near-black with a soft cyan;
  - `moss`: neutral near-black with a deep olive grey;
  - `plum`: muted indigo-black with a light indigo;
  - `ember`: muted red-black with a soft red;
  - `night`: the one dark theme, with white text on a near-black blue ground and a light blue accent.
- **Contrast.** Every text and control colour meets WCAG 2.2 AA contrast on its own ground in every theme, even where that means deepening a shade described here.

**Type.**
- One humanist sans-serif throughout, with a system fallback. Event titles on themed pages may use a serif display face with a serif fallback.
- Body text is a comfortable reading size with roomy line spacing. Labels and meta text are a step smaller. Card titles are about a quarter larger than body text and semibold.
- The landing headline is very large: about five times the body size on wide screens and about three times on phones, with tight line spacing.

**Shape and depth.**
- Corners are generously rounded: inputs and rows a little, cards more, content cards most. Buttons are pills and avatars are circles.
- Cards cast a soft shadow, avatars carry a thin ring, and the dark primary pill sits on a deep layered shadow.
- The sticky header and translucent buttons blur what passes beneath them.

**Covers and icons.**
- Every cover is drawn by the app from the event's theme colours as layered gradients, with the event name set large inside, like a gig poster.
- The page carries a faint drawn grain over the wash and a soft, blurred copy of the cover behind the content.
- Icons are original thin line drawings in the current text colour, about the size of the text beside them:
  - a teardrop location pin with a small circle inside;
  - a right chevron;
  - the four-point concave sparkle brand mark;
  - a hash mark for categories;
  - an up-right arrow for the venue link.
- Avatars are initials on a tinted circle.

**Density and touch.**
- Sections breathe with at least a full line of space between groups.
- Every tappable control is at least 44 px in both directions on touch screens.
- Focus shows as a clearly visible ring in the theme's ink colour.
- Status never relies on colour alone; every pill carries its word.

**Assets.** Use no photographs, logos, maps, avatars or font files from anywhere else. Every picture is made by the app from colours and lettering.

### Motion and effects (DP-14, DP-19, DP-41)

**Transitions and feedback.**
- **Colour changes.** Colour, fill and shadow changes on hover and press cross-fade in about a sixth of a second, starting briskly and settling softly.
- **Small pop-ins.** Menus, the date tile and switches pop in with a small springy overshoot, in under a third of a second.
- **Hero lines.** Each hero line rises into place from behind an edge that opens from its bottom centre, once on load and in under one second. The first hero word swaps with the same rise every two and a half seconds.
- **Event page wash.** Fades in behind the content in about half a second.
- **Loading rows.** A light shimmer sweeps across loading rows while data loads, and only then.
- **Registration card.** When its state changes, the card swells very slightly and settles in under half a second. The meter bar slides to its new fill in about a third of a second.
- **Hover effects.**
  - Quiet buttons fill with dark grey and their text turns white.
  - The dark landing pill drops its shadow and turns see-through.
  - Themed links darken.
  - The three hero example links turn green, magenta and blue respectively.
- **Allowed movement.** Movement only changes position, scale, transparency and colour. Nothing animates the size or spacing of the layout.

**Signature interaction: cover scatter.** On the landing page, the floating covers respond to scrolling.
- At the top of the page they sit at rest around the headline.
- Over the first full screen-height of scroll, each cover moves steadily away from the headline's centre, by about a third of its own size, and fades to about half strength. At half a screen of scroll each cover is about halfway along.
- Scrolling back up returns every cover step by step along the same path. At the top they are exactly at rest again.
- Nothing about the scatter depends on time; it follows the scroll position only.

**Celebration.** The moment a guest's place is confirmed, the page celebrates.
- **What plays.** At least forty confetti pieces in at least three colours, drawn from the event theme and the Mela accents, burst from the Registration card and rain across the screen. On the `night` theme, at least forty firework sparks burst across the sky instead.
- **The layer.** It plays on one element added to the document outside the header, main and footer, marked `aria-hidden="true"`. It never takes focus, never blocks a click, causes no sideways scroll, ends within three seconds, and is then removed or hidden with nothing left running. DOM pieces and a canvas both qualify, provided the pieces show as separate specks of colour.
- **When it plays.** Once per confirmed place, the first time the guest sees that confirmation: right after `Register` or a valid access code, or on the guest's next view of the event after the host approves them or they move up from the waitlist.
- **When it does not.** A reload never replays it. Registering again after cancelling plays it again. A request, a waitlist place or a decline never celebrates.

**Loops.** The only things that repeat are the hero word cycle, the countdown tick and the loading shimmer. No other decorative loop exists.

**Reduced motion.** When the device asks for reduced motion:
- every reveal and pop-in shows its finished state at once;
- colour changes happen instantly;
- the hero word stays on `Joyful`;
- the covers stay at rest whatever the scroll;
- the card and meter change state without swelling or sliding;
- the shimmer is replaced by a still pale fill;
- the celebration never plays.

All content stays visible.

### Feedback states (DP-17, DP-19, DP-22, DP-27, DP-29, DP-31, DP-39, DP-40, DP-48, DP-49, DP-52, DP-56, DP-57, DP-59)

**Registration card.** The card under the heading `Registration` shows exactly one state, chosen on the server and present in the first HTML response. The first rule that applies wins:
1. the viewer is the host;
2. the event has ended;
3. the viewer's own status (pending, approved, declined or waitlisted);
4. registration is closed;
5. code only;
6. full;
7. open.

The host sees a `Manage Event` link to `/manage/{slug}` instead of the card.

| State | Heading | Body | Action |
|---|---|---|---|
| open, approval required | `Approval Required` | `The host reviews every request before confirming a place.` then `Save your place below.` | `Request to Join` |
| open, no approval | none | `Save your place below.` | `Register` |
| full, waitlist on | `Event Full` | `This event is at capacity. You can join the waitlist.` | `Join Waitlist` |
| full, waitlist off | `Event Full` | `This event is at capacity.` | none |
| pending | `Pending Approval` | `We will let you know when the host approves your registration.` | `Cancel Request` |
| approved | `You're In` | the address is shown on the page; `A place opened up, so you moved up from the waitlist.` is added when the place came from the waitlist automatically | `Cancel Registration` |
| declined | `Registration Declined` | `The host was not able to approve your registration.` | none |
| waitlisted | `On the Waitlist` | `You will move up if a place opens.` then `You are <ordinal> in line.` | `Leave Waitlist` |
| closed | `Registration Closed` | `The host has stopped taking registrations for this event. You can still contact the host.` | none |
| access code only | `Access Code Needed` | `This event is open only to guests with an access code. Enter yours below to register.` | `I have an access code` |
| past | `Past Event` | `This event ended today.`, `This event ended 1 day ago.` or `This event ended <days> days ago.` | none |

- `<days>` is the number of whole days since the end, rounded down, computed when the page is rendered.
- `<ordinal>` is the queue position written as an English ordinal that handles the teens: `1st`, `2nd`, `3rd`, `4th`, `11th`, `12th`, `13th`, `21st`, `22nd`, `23rd`, `101st`, `111th`, `112th`. The manage page shows the same ordinal as `<ordinal> in line`.

**Address hidden.** Everyone except the host and approved guests sees `Register to See Address`, the city, and `The exact address is shared with confirmed guests.`

**Capacity meter.**
- **Where it shows.** On a capped event, the meter ends the card in every state except declined, closed, access code only and past. The host also sees it, under `Manage Event`.
- **Line.** It reads `<going> of <capacity> places taken`, beside `<left> places left` or `1 place left`.
- **When full.** The places-left text becomes:
  - `Full · <waiting> waiting` when guests wait;
  - `Full · waitlist open` when the waitlist is on and nobody waits;
  - `Full` when the waitlist is off.
- **Bar.** Under the line, a thin rounded bar fills in the theme accent in proportion to `<going>` over `<capacity>`.
- **Unlimited events.** No meter.
- **Values.** `<going>`, `<capacity>`, `<left>` and `<waiting>` are the event object's `going_count`, `capacity`, `places_left` and `waitlist_count`. They are taken from the first response and then from each card action's response.

**Pending.** While any async action is in flight, until it succeeds or fails:
- its button is disabled and its region is marked busy;
- the button keeps its accessible name;
- a second press sends nothing.

**Field errors and alerts.** An invalid field is marked invalid and points to its message, shown directly beside it. Fixed messages:

| Where | Copy |
|---|---|
| Sign-in failure (one `alert`) | `Incorrect email or password` |
| Wrong access code | `That code is not valid` |
| Missing access code | `Enter your access code` |
| Access code lockout | `Too many attempts. Try again in <minutes> minutes.` (`1 minute` in the singular), where `<minutes>` is `retry_after` divided by 60, rounded up |
| Capacity outside the allowed range | `Capacity must be a whole number from 1 to 10,000, or empty for unlimited` |
| Capacity below going count | `Capacity cannot be lower than the <going> guests already going` (`1 guest` in the singular) |
| Approve when full (beside the row) | `Event is at capacity` |
| Join a full event with no waitlist | `This event just filled up` |
| Any other field | the API's message for that field |

After a 429, the lockout line stays beside `Access code` and the card keeps its access-code state.

**Success toasts.** Every member action confirms with a toast in the `Notifications` region at the bottom of the screen:

| Action | Toast |
|---|---|
| register | `Registered. See you there!` |
| request | `Request sent to the host` |
| waitlist | `Added to the waitlist` |
| cancel | `Registration cancelled` |
| withdraw request | `Request withdrawn` |
| leave waitlist | `Left the waitlist` |
| contact | `Message sent to the host` |
| report | `Report sent. Thank you.` |
| follow | `Following <community name>` |
| unfollow | `Unfollowed <community name>` |
| sign in | `Signed in as <name>` |
| sign up | `Welcome, <first name>! Your account is ready.` |
| sign out | `Signed out` |
| publish | `Your event is live` |
| save edits | `Changes saved` |
| close registration | `Registration closed` |
| reopen registration | `Registration reopened` |
| approve | `Approved <guest name>` |
| decline | `Declined <guest name>` |
| remove | `Removed <guest name>` |

- When a response's `promoted` list is not empty, the toast adds ` · <names> moved up from the waitlist`. `<names>` is the promoted names joined with commas and a final `and`.
- When signing in or up also completes a registration, the toast names that registration instead.
- No toast ever contains a street address or virtual link.
- At most three toasts show at once, newest last. Each leaves after about five seconds unless it is hovered or focused.

**Card announcements.** The `Registration status` region politely announces each new card state as described under Interactions.

**Outage, in-page.** An action fails when any one of these happens:
- it is answered with 503;
- its request fails at the network level, for example the connection is refused, reset or dropped before an answer arrives;
- no answer has arrived within 10 seconds of sending. At that moment the page stops waiting, abandons the request and ignores any answer to it that arrives later.

When an action fails:
- the pressed control is re-enabled;
- nothing on the page changes state, and an open dialog stays open with what was typed;
- an `alert` beside the control reads `Mela is taking a short break. Your change was not saved. Please try again in a moment.`

**Outage page.**
- Status: 503.
- It keeps the header (in its visitor form), the footer and `Skip to Content`.
- It shows the level-one heading `Mela is taking a short break`, the line `We can't reach our data right now. Please try again in a moment.`, and the `Try Again` link to the same path.

**Not-found page.**
- Status: 404.
- It shows the level-one heading `We couldn't find that page`, the line `The page or event you're looking for isn't here.`, and the `Back to Discover` link.

**Empty states.**

| Where | Copy |
|---|---|
| Empty `Upcoming` tab | `No Upcoming Events`, with `Create Event` and `Discover Events` links |
| Empty `Past` tab | `No Past Events` |
| A filter with no events | `No upcoming events here yet`, with a link `See all cities` to `/discover` with no filter |
| A community with no upcoming events | `No upcoming events on this calendar yet` |
| A manage filter with no guests | `No guests with this status` |

## Backend

### API (DP-01, DP-04, DP-05, DP-06, DP-09, DP-11, DP-12, DP-15, DP-16, DP-23, DP-25, DP-27, DP-30, DP-32, DP-33, DP-35, DP-36, DP-37, DP-38, DP-52, DP-53, DP-54, DP-55, DP-57, DP-58, DP-59)

**Conventions.**
- **Base.** The JSON API lives under `/api` on the app origin. Responses are `application/json; charset=utf-8`.
- **Body size.** A request body may be at most 65,536 bytes; exactly 65,536 is allowed. A larger body returns `413 {"error": "payload_too_large"}`.
- **Error shape.** Every error is `{"error": "<code>"}`, optionally with extra keys named below, or, for validation, `{"errors": {"<field>": "<message>"}}`. An unknown `/api` path returns `404 {"error": "not_found"}`.

**Error precedence.** For every `/api` request, the first rule that applies decides the response:
1. Database unreachable: `503 {"error": "service_unavailable"}` with `Retry-After: 5`, for every `/api` request except `GET /api/health`, which still answers 200 with `{"status": "unavailable"}` as in its own row below.
2. Body over the size limit: 413.
3. No valid session on a member endpoint: `401 {"error": "unauthenticated"}`.
4. Unknown event, community or guest (a guest of another event is unknown, as are malformed guest ids, under Business rules), or a signed-in member who is not the host on a host-only endpoint: `404 {"error": "not_found"}`.
5. Body shape: `422`, as defined under Request bodies, together with a malformed `Idempotency-Key`.
6. On contact and report, an `Idempotency-Key` this member already used on this event and endpoint: the original `201` when the body is the same, otherwise `422 {"error": "idempotency_key_reused"}`.
7. On register, a member who already holds a pending, approved, waitlisted or declined registration: `200` with that registration (the replay).
8. On register, an access-code lockout: 429.
9. State refusals: 403.
10. Conflicts: 409.
11. Field values: 422.

**Request bodies.** Every endpoint that takes a body accepts only the keys its row names. Bodiless endpoints accept no body or `{}`.
- A body that is not a JSON object (an array, a string, a number, `null` or invalid JSON) returns `422 {"errors": {"body": "Expected a JSON object"}}`.
- Any other key returns 422 with `errors.<key>` = `"Unknown field"`. For example: `status` on register; `slug`, `id`, `host`, `host_id`, `going_count`, `is_host`, `viewer_status`, `access_code` or `created_at` on create or edit; `id` or `is_host` on sign-up.
- Types are exact:
  - text fields are JSON strings;
  - `capacity` is a JSON integer or `null` (`"5"`, `5.5` and `true` are refused);
  - `require_approval`, `waitlist` and `show_guest_list` are JSON booleans (`"false"` and `0` are refused);
  - `categories` is an array of strings;
  - `calendar` is a string or `null`.
- A wrong type returns 422 under that key.
- Nothing is stored when any key is refused.

**Health.**

| Method and path | Response |
|---|---|
| `GET /api/health` | `200 {"status": "ok", "started_at": "<instant>"}` once the database answers and seeding has finished; otherwise `200 {"status": "unavailable"}`. Health always answers 200 once the server listens, so a running server is never mistaken for a dead one; the body says whether it is ready. `<instant>` is the ISO 8601 UTC time the `serve` process started, the same from every worker of that serve. |

**Accounts and sessions.**

| Method and path | Body | Success | Extra errors |
|---|---|---|---|
| `POST /api/auth/check` | `{"email"}` | `200 {"exists": true\|false}` | 422 invalid email |
| `POST /api/auth/signup` | `{"name", "email", "password"}` | `201 {"user": {"id", "name", "email"}, "token"}` and a session cookie | `409 {"error": "email_taken"}`; 422 for an invalid email, a password shorter than 8 characters (8 allowed) or longer than 200, or a name that is empty after trimming or longer than 80 characters |
| `POST /api/auth/signin` | `{"email", "password"}` | `200`, same shape and cookie | `401 {"error": "invalid_credentials"}` for an unknown email or a wrong password alike |
| `POST /api/auth/signout` | none | `204`; the token and the cookie stop working at once | |
| `GET /api/me` | none | `200 {"user"}` | |

- Emails are stored lower-cased and are unique regardless of letter case.
- The session cookie is HttpOnly and SameSite=Lax, and works over plain HTTP on the app origin.
- Member endpoints and member pages accept either the cookie or `Authorization: Bearer <token>`.

**Discovery.**

| Method and path | Success |
|---|---|
| `GET /api/discover?place=&category=` (both optional) | `200 {"places", "categories", "events"}`: `places` is `[{"slug", "name", "event_count"}]` for the six cities; `categories` is `[{"slug", "name", "event_count"}]` for the twelve categories, in tile order; `events` holds the matching upcoming public events, soonest first, each `{"slug", "name", "start_at", "end_at", "timezone", "city", "venue_name", "theme", "categories"}`. Without `place`, `events` covers every city; without `category`, every category; with neither, it holds every upcoming public event. An unknown place or category slug returns 404. |
| `GET /api/categories` | `200`, the category list as above |
| `GET /api/calendars` | `200 [{"slug", "name", "description", "city", "follower_count"}]` |

**Event object.**
- **Fields.** `slug`, `name`, `description`, `start_at`, `end_at` (ISO 8601 UTC), `timezone` (an IANA name), `location_type` (`offline` or `virtual`), `venue_name`, `street_address`, `city`, `virtual_link`, `visibility` (`public` or `private`), `require_approval`, `capacity` (an integer, or `null` for unlimited), `waitlist`, `registration_status` (`open`, `closed` or `code_only`), `theme`, `categories`, `calendar` (a community slug or `null`), `show_guest_list`, `host` (`{"id", "name"}`), `going_count`, `places_left` (`null` when unlimited), `waitlist_count`, `viewer_status` (the caller's registration status or `null`), `viewer_waitlist_position` (from 1, or `null`) and `is_host`.
- **Privacy.** `street_address` and `virtual_link` are absent, not blanked, unless the caller is the host or an approved guest.
- **Access code.** The access code never appears in any response.

**Events.**

| Method and path | Body | Success | Extra errors |
|---|---|---|---|
| `GET /api/events/{slug}` | none | `200`, the event object | |
| `POST /api/events` | editable fields | `201`, the event object with its new slug | 422 per field |
| `PATCH /api/events/{slug}` | any subset of the editable fields plus `registration_status` | `200`, the event object | 422 per field |

- **Editable fields.** `name`, `description`, `start_at`, `end_at`, `timezone`, `location_type`, `venue_name`, `street_address`, `city`, `virtual_link`, `visibility`, `require_approval`, `capacity`, `waitlist`, `theme`, `categories`, `calendar`, `show_guest_list`.
- **Defaults for omitted fields on create:**
  - `description` empty;
  - `timezone` `Asia/Kolkata`;
  - `location_type` `offline`;
  - `visibility` `public`;
  - `require_approval` false;
  - `capacity` null;
  - `waitlist` false;
  - `theme` `amber`;
  - `categories` `[]`;
  - `calendar` null;
  - `show_guest_list` true.
- **Field rules.** `start_at` and `end_at` are ISO 8601 date-times with an offset.
  - `name` is required, from 1 to 140 characters after trimming (140 allowed).
  - `end_at` is after `start_at`.
  - `start_at` is not in the past, checked on create and whenever `start_at` changes.
  - `timezone` is a known IANA name.
  - `capacity` is from 1 to 10,000 inclusive, or null; a value outside that range gets the range message from Feedback states.
  - An offline event needs `city`. A virtual event needs a `virtual_link` starting with `https://`.
  - `theme` is one of the six themes.
  - `categories` holds zero to two distinct known category slugs.
  - `calendar` is null or a community the member follows.
  - `description` is at most 5,000 characters.
- **Edit rules.** On PATCH, cross-field rules use the stored value for any field the request leaves out. The capacity floor and the `registration_status` edges are under Business rules, with their messages under `errors.capacity` and `errors.registration_status`.

**Registrations.**

| Method and path | Body | Success | Extra errors |
|---|---|---|---|
| `POST /api/events/{slug}/register` | optional `{"access_code"}` | `201 {"status", "event", "promoted"}` for a new or renewed registration; `200` with the same shape and `promoted: []` for a replay | `403 {"error": "registration_closed"}`, `403 {"error": "event_ended"}`, `403 {"error": "access_code_required"}`, `403 {"error": "invalid_access_code"}`, `429 {"error": "too_many_attempts", "retry_after": <seconds>}` with `Retry-After: <seconds>`, `409 {"error": "event_full"}`, `409 {"error": "host_cannot_register"}` |
| `DELETE /api/events/{slug}/register` | none | `200 {"status": "cancelled", "event", "promoted"}`; an already-cancelled registration replays with `promoted: []` | `404 {"error": "not_registered"}`, `409 {"error": "registration_declined", "status": "declined"}` |
| `GET /api/events/{slug}/guests?status=` | none | `200 [{"id", "name", "email", "status", "requested_at", "waitlist_position"}]`, ordered by `requested_at` then `id`; `?status=` is one of the five statuses | 422 for an unknown status |
| `POST /api/events/{slug}/guests/{id}` | `{"action"}` of `approve`, `decline` or `remove` | `200 {"status", "event", "promoted"}` | `409 {"error": "event_full"}`, `409 {"error": "invalid_transition"}`, 422 for an unknown action |
| `GET /api/me/events?tab=` | none | `200 [{"slug", "name", "start_at", "end_at", "pill"}]`, where `tab` is `upcoming` (the default) or `past` and `pill` is `hosting`, `going`, `pending`, `waitlist` or `declined` | 422 for an unknown tab |

- Guest `{id}` is the registration id, found as stated under Guest records in Business rules. `requested_at` is the time of the member's latest register request.
- In mutation responses:
  - `status` is the registration's status after the request;
  - `event` is the event object as the caller sees it, with its counts as defined under Business rules;
  - `promoted` is `[{"id", "name"}]` for the registrations this request moved from waitlisted to approved, in queue order, or `[]`.
- `<seconds>` is a whole number from 1 to the lockout window.

**Following, contact and reports.**

| Method and path | Body and headers | Success | Extra errors |
|---|---|---|---|
| `PUT /api/calendars/{slug}/follow` | none | `200 {"following": true, "follower_count"}` | |
| `DELETE /api/calendars/{slug}/follow` | none | `200 {"following": false, "follower_count"}` | |
| `POST /api/events/{slug}/contact` | `{"message"}`; optional header `Idempotency-Key` | `201 {"id"}` | 422 unless the message is 1 to 1,000 characters after trimming; `422 {"errors": {"idempotency_key": "Idempotency-Key must be 1 to 64 letters, digits, hyphens or underscores"}}`; `422 {"error": "idempotency_key_reused"}` |
| `POST /api/events/{slug}/report` | `{"reason", "details"}`, `details` optional; optional header `Idempotency-Key` | `201 {"id"}` | 422 unless `reason` is `spam`, `misleading`, `inappropriate` or `other` and `details` is at most 1,000 characters; the same two `Idempotency-Key` errors as contact |

`follower_count` is the count after this request's own change. The replay and reuse semantics of `Idempotency-Key` are under Business rules.

### Business rules (DP-22, DP-23, DP-24, DP-25, DP-26, DP-27, DP-28, DP-29, DP-30, DP-31, DP-35, DP-37, DP-54, DP-55, DP-56, DP-57, DP-58, DP-59)

**Places.**
- An event is full when it has a capacity and `going_count` equals it.
- `going_count` counts approved registrations only. `places_left` is capacity minus `going_count`.
- `waitlist_count` counts waitlisted registrations.

**Registering (POST register), after the replay rule.** The server first refuses:
- a closed event (`registration_status` is `closed`);
- an ended event;
- on a code-only event, a missing or wrong code;
- the host's own event.

Otherwise:
- On a full event, the result is `waitlisted` when the waitlist is on, and `event_full` when it is off.
- On an event that is not full and needs approval, the result is `pending`.
- On an event that is not full and needs no approval, the result is `approved` when nobody is waiting, and `waitlisted` otherwise.
- A member with a cancelled registration re-registers on the same row.

**Registration edges.** A member holds at most one registration per event.

| From | Action | To | Otherwise |
|---|---|---|---|
| none or cancelled | register | `pending`, `approved` or `waitlisted`, as above | refusals above |
| pending | host `approve` | `approved` | `event_full` when full |
| pending or waitlisted | host `decline` | `declined` | |
| waitlisted | host `approve` or automatic promotion | `approved` | `event_full` when full |
| approved | host `remove` | `declined` | |
| pending, approved or waitlisted | guest cancel | `cancelled` | |
| declined | anything | stays `declined` | register replays `declined` with 200 and stores nothing; cancel returns the declined 409; every host action returns `invalid_transition` |
| cancelled | any host action | unchanged | `invalid_transition` |

- Approve on approved, decline on declined or approved, and remove on anything other than approved all return `invalid_transition`.
- Declined is final for that member on that event.

**Guest records.**
- A guest `{id}` is looked up only among the registrations of the event named by `{slug}`. A registration of any other event, including another event with the same host, is unknown there: the request answers the not-found 404 and nothing changes, not the registration's status, not its `requested_at`, and not either event's counts.
- A guest `{id}` that is not a positive whole number written in canonical decimal form (digits only, no sign, no leading zero, no exponent) of at most 9223372036854775807 is unknown too. For example, `0`, `-1`, `abc`, `1e3`, `007` and `99999999999999999999` all answer the JSON not-found 404, never a 500 or an HTML page.

**Queue order.**
- Waiting guests are ordered by the time they most recently entered `waitlisted`, with the registration id breaking ties.
- A guest who leaves the waitlist, or who was approved and cancels, and then joins again goes to the back.
- `viewer_waitlist_position` and `waitlist_position` count from 1 in this order.

**Automatic promotion.** Applies to an event that keeps a waitlist, needs no approval and has not ended, whatever its registration status. On such an event, each of these moves the earliest waiting guests to `approved` within the same request:
- an approved guest cancelling;
- the host removing an approved guest;
- a capacity raise;
- setting the capacity to `null`.

It moves exactly as many guests as there are free places, or every waiting guest when the capacity becomes unlimited. Those guests are listed in `promoted`. On an event that needs approval, the waitlist stays for the host to approve.

**Concurrency.** Each event's registration changes are serialized. Under any mix of simultaneous registrations, approvals, cancellations, removals and capacity edits on one event:
- `going_count` never exceeds the capacity;
- no newcomer is approved while anyone waits on a no-approval event;
- promotions take only the earliest waiting guests, and no guest is promoted twice;
- after N simultaneous capacity raises, cancellations and new registrations, the approved count equals the smaller of the final capacity and the number of approved plus waiting guests;
- one member never gets two registrations for one event.

**Counts from the committed change.**
- The counts in a mutation response's `event` (`going_count`, `places_left`, `waitlist_count`, `viewer_waitlist_position`) are read inside that change's own transaction, after the change, while the event is still serialized.
- So under N simultaneous registrations for C free places on a no-approval event with G going:
  - the approved responses report `places_left` of exactly C−1 down to 0, each once, and `going_count` of exactly G+1 up to G+C, each once;
  - the waitlisted responses report `waitlist_count` and `viewer_waitlist_position` of exactly 1 up to k, each once, where k is the number waitlisted.
- Every event object in any response or page satisfies going count plus places left equals capacity on a capped event.

**Capacity checks, in order.** A `capacity` value is checked in this order, and only the first failing check answers under `capacity`:
1. type (a JSON integer or `null`);
2. range (1 to 10,000 inclusive), with the range message from Feedback states, even when the value is also below the going count;
3. floor: a value in range but below the current `going_count` is refused with the floor message from Feedback states, and nobody is removed. The floor check happens at the edit's own serialized moment, so it holds against registrations in flight.

**Partial edits.**
- PATCH writes only the fields the request carries. Two simultaneous PATCHes, one carrying `name` and one carrying `capacity`, both persist.
- Turning approval off leaves pending requests pending for the host.

**Registration status edges.**
- An event without an access code moves only between `open` and `closed`. The code-only event moves only between `code_only` and `closed`.
- Sending the current value is a 200 no-op. Any other value or edge is refused under `registration_status`; for example, `code_only` on `/runclub7` or `open` on `/fireworx`.
- Events created through the API have no access code and start `open`.

**Access codes.**
- Codes match case-sensitively after surrounding whitespace is trimmed.
- A missing code is refused and never counted.
- A wrong code counts one failure for that member on that event.

**Access code lockout.**
- **Trigger.** Five failures from one member on one event within the lockout window lock that member out of that event.
- **During the lock.** Every further attempt is answered with the lockout 429, even one with the right code. The lock lasts until one lockout window after the fifth failure, and `retry_after` is the whole seconds left, rounded up.
- **Window.** The window lasts 900 seconds (15 minutes) unless `MELA_ACCESS_CODE_WINDOW_SECONDS` sets another whole number of seconds.
- **Scope.** The count is per member and per event, so another member, or the same member on another event, is unaffected.
- **Clearing.** A successful registration clears that member's count for that event.
- **Shared and atomic.** The count is kept in PostgreSQL and updated atomically, so it holds across instances. Under 12 simultaneous wrong attempts by one member, exactly 5 return 403 and 7 return 429.

**Loss of access.**
- A declined or removed guest's very next request gets no street address, virtual link or `Open in maps` link in any page or response, and their `viewer_status` is `declined`.
- When the host edits `street_address`, the next response to the host and to approved guests shows the new value, and the old value appears nowhere.

**One message per send.** Applies to contact and report.
- **Key form.** An `Idempotency-Key` is 1 to 64 characters, each a letter `A–Z` or `a–z`, a digit, a hyphen or an underscore. Any other value, including an empty one, gets the malformed-key 422 from API.
- **Scope and lifetime.** A key belongs to one member, one event and one endpoint. It is remembered from the send that stored a row for 86,400 seconds (24 hours) unless `MELA_IDEMPOTENCY_RETENTION_SECONDS` sets another whole number of seconds; after that it counts as new. A send that is refused stores no key.
- **Same key, same body.** When the parsed JSON body equals the remembered one (key order and whitespace do not matter), the request answers 201 with the remembered `{"id"}` and stores nothing new.
- **Same key, different body.** The request answers the `idempotency_key_reused` 422 and stores nothing, even when the new body would also fail a field check.
- **Simultaneous sends.** N simultaneous identical requests with one key, across any number of instances, store exactly one row, and every one of them answers 201 with that row's id.
- **No key.** Each valid request without the header stores a new row.
- **Independence.** The same key from another member, on another event or on the other endpoint is unrelated.

**Following.**
- A follow is unique per member and calendar. N simultaneous `PUT`s store one follow and raise `follower_count` by exactly one.
- `DELETE` removes it. Following again afterwards works.

**Derived values.** Category, place, going, waitlist and follower counts are computed from stored rows when read, never kept as separate running totals.

### Services (DP-02, DP-07, DP-52, DP-59)

PostgreSQL, through `DATABASE_URL`, is the only backing service. The app connects as a non-superuser that owns its database.
- **Storage.** All timestamps are stored in UTC. Passwords are stored only as salted hashes.
- **Table names.** Tests observe these tables, so use these names:

| Table | Holds |
|---|---|
| `members` | `id`, a unique lower-cased `email`, `name` and the password hash |
| `events` | `id`, a unique `slug`, `name`, `start_at` and the event fields |
| `registrations` | `id`, `event_id` referring to `events.id`, `member_id` referring to `members.id`, one row per member and event, `status` holding the five status words, and `requested_at` |
| `calendars` | the community calendars |
| `follows` | one row per member and calendar |
| `host_messages` | host messages, each with `member_id`, `event_id`, the message and a nullable `idempotency_key` |
| `event_reports` | reports, each with `member_id`, `event_id`, the reason, the details and a nullable `idempotency_key` |

- **Startup.** The app applies its schema and seed idempotently when `serve` starts and whenever it first reaches the database afterwards, never during `install` or `build`.
- **When PostgreSQL is unreachable:**
  - every page answers with the outage page from Feedback states;
  - every `/api` request except `GET /api/health` answers the 503 from API, and health answers 200 with `{"status": "unavailable"}`;
  - in-page actions show the in-page outage alert;
  - static files (scripts, styles and drawn assets) are still served.

### Seed data (DP-02, DP-15, DP-16, DP-22, DP-31, DP-37)

Every seeded person, business, venue and community is invented.

**Members.** All three share the password `deku-demo-pw-2026`.

| Email | Name |
|---|---|
| `host@example.com` | `Noor Kapoor` |
| `guest@example.com` | `Ravi Menon` |
| `guest2@example.com` | `Lena Ortiz` |

**Cities.**

| Slug | Name |
|---|---|
| `new-delhi` | `New Delhi` |
| `gurugram` | `Gurugram` |
| `noida` | `Noida` |
| `bengaluru` | `Bengaluru` |
| `mumbai` | `Mumbai` |
| `tokyo` | `Tokyo` |

**Categories.** These slugs, in this order, match the tiles: `family`, `books`, `games`, `tech`, `food-drink`, `ai`, `running`, `arts-culture`, `climate`, `fitness`, `wellness`, `crypto`.

**Communities.** No follows exist at start.

| Slug | Name | City | Description | Tint |
|---|---|---|---|---|
| `chapterhouse` | `Chapterhouse Readers` | Mumbai | `Readings, swaps and zine days for slow readers.` | soft plum |
| `builders-guild` | `Builders Guild` | Noida | `Evening meetups for people who build software.` | soft cyan |
| `trail-runners` | `Trail Runners Collective` | Bengaluru | `Easy-paced group runs around lakes and parks.` | soft olive |
| `maker-hub` | `Maker Hub` | New Delhi | `Hands-on workshops for makers of every age.` | soft red |

**Events.** All fifteen events are hosted by `Noor Kapoor`, are offline, and show their guest list.
- Day `+n` means n calendar days after the seed day: the date in Asia/Kolkata when seeding first runs.
- Times are local to the event's zone: Asia/Tokyo for Tokyo events, Asia/Kolkata for all others.
- Unless a row says otherwise, an event is public, needs no approval, has unlimited capacity, has no waitlist, has `registration_status` `open`, and belongs to no community.
- Each event has an invented description of two to four sentences.

| Slug | Name | Theme | City, venue, street address | When | Setup |
|---|---|---|---|---|---|
| `gamenite` | `Founders Board Game Night` | `amber` | Gurugram, `Rolling Dice Cafe`, `First Floor, 14 Sector 29 Market` | day +3, 17:00–20:00 | approval required, capacity 40, `games` |
| `streamup` | `Stream Processing Meetup` | `harbor` | Noida, `Riverside Tech Park`, `Tower B, 7 Sector 62` | day +5, 18:00–21:00 | approval required, `tech`, community `builders-guild` |
| `runclub7` | `Sunrise 5K Run Club` | `moss` | Bengaluru, `Lakeside Gate 2`, `11 Kensington Road` | day +2, 06:00–07:30 | capacity 60, `running` and `fitness`, community `trail-runners` |
| `launchpt` | `Indie App Launch Party` | `plum` | Mumbai, `Harbour Loft`, `3rd Floor, 41 Colaba Causeway` | day +9, 19:00–23:00 | private, approval required, `tech` |
| `fireworx` | `Riverside Fireworks Viewing` | `night` | Tokyo, `Sumida Riverbank Zone C`, `2-1 Mukojima Riverside Walk` | day +12, 19:00–21:00 | private, `registration_status` `code_only` with access code `GLOW-2026` |
| `closedbf` | `Founders Breakfast Club` | `ember` | New Delhi, `Lodhi Garden Cafe`, `Shop 12, 5 Lodhi Road` | day +4, 08:00–10:00 | `registration_status` `closed`, `food-drink` |
| `poetwalk` | `Monsoon Poetry Walk` | `harbor` | Mumbai, `Marine Drive Steps`, `Steps 9, Netaji Subhash Road` | day −7, 17:00–19:00 (ended) | `books`, community `chapterhouse` |
| `potterya` | `Pottery Wheel Workshop` | `ember` | New Delhi, `Clayroom Studio`, `22 Hauz Khas Village` | day +6, 11:00–13:00 | capacity 2, waitlist on, `arts-culture`, community `maker-hub` |
| `designjm` | `Design Jam Saturday` | `plum` | Bengaluru, `Courtyard Studio`, `18 Wood Street, Ashok Nagar` | day +8, 10:00–17:00 | approval required, `arts-culture` |
| `foodwalk` | `Old Delhi Food Walk` | `amber` | New Delhi, `Chandni Chowk Gate 5`, `Gate 5, Chandni Chowk Road` | day +3, 09:00–12:00 | `food-drink` |
| `climatec` | `Climate Circle Meetup` | `moss` | Mumbai, `Greenhouse Commons`, `9 Linking Road, Bandra West` | day +10, 18:00–20:00 | approval required, `climate` |
| `chessblt` | `Blitz Chess Afternoon` | `amber` | Tokyo, `Asakusa Board Room`, `1-4 Kaminarimon, Taito` | day +7, 14:00–17:00 | `games` |
| `kidsartm` | `Family Art Morning` | `harbor` | Noida, `Sector 18 Library`, `Block C, Sector 18 Market` | day +5, 10:00–12:00 | `family` and `arts-culture`, community `maker-hub` |
| `zinefest` | `Small Press Zine Fair` | `plum` | Mumbai, `Bandra Warehouse`, `27 Hill Road, Bandra West` | day +14 11:00 to day +15 19:00 | `books` and `arts-culture`, community `chapterhouse` |
| `gardenfs` | `Monsoon Garden Festival` | `moss` | Bengaluru, `Cubbon Park Bandstand`, `Bandstand Lawn, Kasturba Road` | day +20 10:00 to day +21 18:00 | `family` and `wellness` |

**Registrations.** No other registrations exist at start. No access-code failures, host messages, reports or idempotency keys are recorded.

| Event | Member | Status |
|---|---|---|
| `gamenite` | `guest@example.com` | approved |
| `gamenite` | `guest2@example.com` | pending |
| `potterya` | `guest@example.com` | approved |
| `potterya` | `guest2@example.com` | approved (so it starts full with nobody waiting) |

For example, with the seed data at start, an unfiltered `/discover` lists upcoming public events from all six cities under `Coming Up` `All cities`.

**Seeding runs once.** Seeding creates each record exactly once across any number of restarts, and also when two instances start at the same moment against an empty database.

## Technical requirements

### Deployment (DP-01, DP-02, DP-52)

- **Runtime.** Python 3.12 is available as `python3`.
- **Run manifest.** The app root carries `/app/run.json` with `"_schema": "run-manifest-v1"` and the string fields `install`, `build` and `serve`. `run.json` is the only way the app is started. For example:
  `{"_schema": "run-manifest-v1", "install": "python3 -m venv --clear .venv && .venv/bin/pip install -r requirements.txt", "build": "", "serve": ".venv/bin/python -m gunicorn --bind 0.0.0.0:${APP_PUBLIC_PORT:-4173} --workers 3 app:app"}`
- **How it is run.**
  - The contents of `/app` are copied into a fresh folder elsewhere, and `install`, `build` and `serve` run in that order from that folder, with `/bin/sh`, as an unprivileged user who can write only inside that folder.
  - Dependencies go into a `.venv` inside the app folder, and the manifest calls tools by relative path (`.venv/bin/<tool>`) or as `.venv/bin/python -m <tool>`, never through `/app/...`. `install` creates that `.venv` on the grading machine, so `/app` itself holds no virtual environment when you finish: delete any you made while working, because its interpreter links point outside `/app` and the folder cannot be copied with them.
  - No database is reachable during `install` and `build`.
- **Serving.**
  - `serve` runs a production WSGI server such as gunicorn in the foreground, never Flask's development server, a debug or reload mode, or a background job.
  - It binds `0.0.0.0` on the port in `APP_PUBLIC_PORT`, or on `4173` when that variable is unset.
  - It opens its port whether or not the database is reachable.
  - More than one instance may run against the same database at once.
- **Health.** `GET /api/health` behaves as in API.
- **Logins.** The seeded logins are written to `/app/USER_README.md`.
- **Containers.** No persistent volumes, no fixed container names, no custom networks.

### Configuration and secrets (DP-52, DP-57, DP-59)

| Variable | Meaning |
|---|---|
| `DATABASE_URL` | the PostgreSQL connection URL, read at start |
| `APP_PUBLIC_PORT` | the listening port |
| `MELA_ACCESS_CODE_WINDOW_SECONDS` | optional whole number of seconds for the access-code lockout window (default 900) |
| `MELA_IDEMPOTENCY_RETENTION_SECONDS` | optional whole number of seconds a contact or report `Idempotency-Key` is remembered (default 86400) |

- None of these values is written into the code, logged in full, or sent to the browser.
- The database is already running. Never download, install or start a database yourself.

### Server boundary (DP-03, DP-09, DP-12, DP-52, DP-54)

**Authorization and privacy.**
- Every member-only read and write checks the signed-in member on the server.
- Hiding a control is never authorization: a visitor's direct API call to a member endpoint changes nothing.
- No response or page sent to anyone other than the host or an approved guest contains an event's street address or virtual link anywhere: page title, share preview tags, markup, script state, data attributes or JSON.
- Authored text is escaped wherever it is rendered.

**Caching.** Every response from `/{slug}`, `/manage/{slug}`, `/home`, `/api/me…` and every `/api/events/{slug}…` endpoint, for every viewer including visitors and at any status, carries:
- `Cache-Control: private, no-store`
- `Vary: Cookie, Authorization`

**Origin.** Pages load scripts, styles and fonts only from the app's origin, and the browser contacts no other host. Requests that change state are accepted only from the app's own origin. Every redirect the app issues points at its own origin.

**Never served.** The server never serves source files, `run.json`, the virtual environment, `.env` files or credentials. Those paths answer 404.

**Dependency outage.**
- **Before the database is up.** Nothing touches the database at import or worker boot. The app listens and serves the outage responses, and becomes ready within 30 seconds of the database becoming reachable.
- **Mid-run.** Once the database becomes unreachable, the outage responses begin within 10 seconds. Every request made while the database is unreachable is answered within 10 seconds of arriving, and none ever gets a 500 or a traceback.
- **Recovery.** Within 30 seconds of the database coming back, the same process answers health with `"status": "ok"` and the same `started_at`, with no restart. Sessions issued before the outage still work, and the next register, follow or approve succeeds.

### Browser support and performance (DP-13, DP-19, DP-47)

- **Browsers.** Current Chromium, Firefox and WebKit, at 375x812, 768x1024 and 1280x800, and down to 320 CSS pixels wide.
- **Speed.** The landing headline and every event page's card are in the first server response, and each page is usable within three seconds on a local connection.
- **Stability.** The floating covers do not shift the layout as they appear. Decorative motion never blocks input.

## Working rules

- **IF-01.** Ship `/app/run.json` with `"_schema": "run-manifest-v1"` and string `install`, `build` and `serve`, where `serve` starts a production WSGI server in the foreground: not `flask run`, no debug or reload flag, and no `nohup`, `setsid`, `disown` or trailing `&`.
- **IF-02.** Write the three seeded logins and their shared password to `/app/USER_README.md`.
- **IF-03.** Declare Flask as a dependency and ship no datastore client other than PostgreSQL's (no MongoDB, MySQL, SQLite, Redis, Supabase or Firebase client) among the shipped packages, meaning the production dependency tree: every package in `requirements.txt`, or the lockfile's non-dev group, together with their transitive dependencies.
- **IF-04.** Ship `/app/THIRD_PARTY_NOTICES.md` naming Alpine.js and every shipped package with its licence and where it came from. Each licence is one of MIT, BSD-2-Clause, BSD-3-Clause, Apache-2.0, ISC, PSF-2.0, MPL-2.0 or LGPL-3.0.
- **IF-05.** Pin every Python dependency to one exact version: every line of `/app/requirements.txt` reads `name==version` (extras such as `psycopg[binary]==3.2.13` are allowed), or ship `pyproject.toml` with its lockfile (`uv.lock`, `poetry.lock`, `pdm.lock` or `Pipfile.lock`).
- **IF-06.** Do not download, install or start a database or any other service while building; use only the PostgreSQL at `DATABASE_URL`.

## Engineering standards

- The code is idiomatic Python, Flask, Jinja and SQL, and its names use the domain terms of this brief: event, registration, guest, host, waitlist, queue position, places left, going count, community calendar, access code.
- Each domain rule is decided in exactly one place in the source: the registration status edges, the capacity-and-promotion decision, the queue order, the address-visibility decision, the guest lookup, the access-code limit, the send-once decision, the safe `next` decision, the request-body check and each derived count.
- Every SQL statement takes request values through driver placeholders, and every change that touches more than one row runs in one transaction.
- Errors leave the server in the one shape stated under API, produced by one shared path, including the outage 503.
- There is no abstraction with only one implementation, no dead, commented-out or unreachable code, and no defensive check for a state the rules make impossible.
- One Registration card template renders every card state, and one theme setting on each event flows into its page rather than colouring parts one by one.
- The code contains no feature beyond this brief.
