# Brightmoss Games Deedfall

Deedfall is a game-style habit tracker for people who keep routines with friends. Each Player keeps four lists: Habits they score up or down, Dailies due on chosen weekdays, To-dos with optional checklists, and Rewards they set for themselves and buy with the gold they earn. Finished tasks earn experience and gold. In a party, finished tasks also strike a shared, original boss, and a member's missed dailies make the boss strike back at the whole party. The server settles each Player's day once, at that Player's own hour in their own time zone. Every strike and strike-back carries a name and an amount. Boss health, member health, chat, the party banner and a Player's own lists update live on every open screen. Build it as one TypeScript web app backed by Postgres (the system of record) and a MinIO object store. The object store holds every task-list import file and every party banner. Accounts are local, with a username and password only. Out of scope: email, account verification, outside sign-in, AI features, sound, paid plans, gems or any purchase with real money, pets, mounts, equipment art, classes and skills, guilds, challenges, push or email notifications, outside integrations, external assets or web fonts (both typefaces are bundled with the app), import formats other than the one published here, and any datastore, queue or cache other than Postgres and the object store.

## Problem and users

People use game-style trackers to stick to routines. Most people who stay with them stay for the party: friends fight a shared boss, and a missed daily lets the boss hit everyone. Today that shared stake feels unfair. The day's settlement runs when a member next opens the app, not when that member's own day ends. A party spread over Lisbon, Toronto and Manila takes hits at odd hours, and nobody can see whose missed daily caused one. Boss health and chat only refresh on reload. An undo leaves experience or gold behind, and two phones ticking the same daily can pay it out twice. Players lose streaks, health and levels they feel they did not deserve. People moving from a notebook or another tracker also want to bring a whole routine at once and see exactly what became of each line.

- **Player**: keeps habits, dailies, to-dos and rewards from the keyboard or a phone, and earns experience and gold. Never loses health, a streak or a level to a day close that ran at the wrong hour or twice. Uses the app daily.
- **Party member**: strikes the shared boss with finished tasks, sees teammates' strikes and the boss's strike-backs arrive live, and chats with the party. Uses the app daily.
- **Party leader**: forms a party, invites friends by username, sets the party banner, and starts or abandons a quest. Uses the app weekly.

The device clock may be wrong. Deedfall never trusts it for anything the game decides.

## Journeys

1. **Keep the lists by keyboard.** A signed-in Player with an empty board presses N in each list to add a habit, a daily, a to-do and a reward. They complete the daily with Space, score the habit with `+`, move a task with Alt+ArrowDown and hear its new position, then cross between lists with the arrow keys. Their phone, open to the same account, shows each change within two seconds. End state: four non-empty lists in the chosen order, unchanged after reload.
2. **Score, earn and spend.** A Player scores habits up and down and watches experience, gold, health and the band chip on each row change by the published amounts. They buy a reward they can afford and are refused one they cannot. End state: the gold shown equals the sum of the gold ledger.
3. **Live party quest.** A leader forms a party and invites a friend, who accepts in another browser. They chat, and the leader invites the party to "Wake the Drowsewyrm". The member accepts and the leader begins the quest. Each member's finished tasks lower the boss's Health Seam on both screens. End state: the boss falls, the panel turns into the defeat field naming the member who landed the last blow, and both members are paid the quest reward once.
4. **My day, my hour.** A Player in Toronto sets their day-start hour to 6 in Settings and reads the server's next day start. When their day closes, missed dailies cost health and reset streaks, and done dailies extend theirs. If they are on a quest, the boss strikes back at every teammate who is not resting, and the strike-back names them. End state: every member's health and the strike list show the same attributed lines.
5. **Rest when you need to.** A Player turns on rest mode before a trip and sees the rest banner. Their day closes with dailies missed. End state: their health and streaks are unchanged, no strike-back names them, a teammate's strike-back does not touch them, and the strikes they make still count.
6. **Bring a routine from a file.** A Player imports a `.deedlist` file that has three mistakes and sees each one by line number. They fix the file and import it again. End state: the new tasks are on the board, import history lists both attempts with their results, and "Download original" returns each file exactly as uploaded.
7. **A party under its banner, and its history.** A leader uploads a banner image, and the member sees it appear on their quest screen without reload. After the quest is defeated, both find it in quest history after reload, with each member's total damage and every strike line. End state: a quest address belonging to another party shows the not-found screen.
8. **On the phone.** A Player on a phone switches lists with tabs, swipes a daily to the right to complete it, and opens the party as a dialog. End state: everything fits the screen, with no sideways scrolling.

## Mandatory requirements

This is the complete list of mandatory requirements; every check traces to one of these lines and the detailed sections below.

- **DP-01 — Four task lists** The board shows Habits, Dailies, To-dos and Rewards as four lists whose rows carry the published accessible names, and a player adds a task to each with the "New task" dialog.
- **DP-02 — Keyboard-complete board** Every board action works from the keyboard with the published keys, dialogs keep Tab inside them, and closing any dialog returns focus to the row that opened it.
- **DP-03 — Keyboard reorder** Alt+ArrowUp and Alt+ArrowDown move the focused task one place, keep focus on it, announce its new position and the order persists after reload.
- **DP-04 — Task API and ordering** The task endpoints create, read, edit, delete and move tasks with contiguous positions, and conflicting moves apply in arrival order.
- **DP-05 — Stale edit protection** An edit carrying an outdated updatedAt answers 409 stale_task, changes nothing and shows the published stale copy in the "Edit task" dialog.
- **DP-06 — Own lists live on every device** A change to a player's lists, totals or settings made on one device appears on that player's other open screens within 2 seconds without reload.
- **DP-07 — Reward formulas** Completing, checking and scoring pay experience, gold and boss damage by the published difficulty, value-band and rounding rules.
- **DP-08 — Task value and bands** Each task's value moves by the published steps within -20 to 20, and its row chip shows the band name for the current value.
- **DP-09 — Habit scoring journey** A player scores a habit up and down from the keyboard and sees the experience, gold, health, row score and band chip change and hears the feed sentence.
- **DP-10 — Checklist to-dos** A to-do's checklist items tick independently for no reward and raise the to-do's completion reward by the published checklist bonus.
- **DP-11 — Undo window** Unticking a daily or to-do inside the undo window reverts exactly what the tick gave, and after the window an untick changes no total, as qualified in Business rules.
- **DP-12 — Undo seen by the party** An undo inside the window restores the player's level, experience, health and gold and the boss health on the player's screen and every teammate's screen without reload.
- **DP-13 — Gold ledger** Every gold movement is a ledger entry of a published kind and the shown balance always equals the sum of the entries.
- **DP-14 — Refused purchases** Buying a reward priced above the balance answers 422 with the published gold error, shows it, and changes nothing.
- **DP-15 — Buying rewards from the keyboard** A player buys a reward with the keyboard, sees the gold fall by exactly its price, sees the refusal for an unaffordable one and keeps focus on the reward row.
- **DP-16 — Server-settled day close** The server closes each player's local date once at their day-start hour in their zone, running the published steps in order, and a repeated run changes nothing.
- **DP-17 — Daylight-saving closes** A day-start hour inside a spring-forward gap closes at the first instant after the gap and one inside a fall-back repeat closes at its first occurrence, once per date.
- **DP-18 — Zone and day-start settings** Settings validate the time zone and day-start hour, show the server's next day start, and a change takes effect from the next close without skipping or repeating a date.
- **DP-19 — Server-decided due state** Due-today, done state and the next day start come from the server and stay correct when the device clock is wrong.
- **DP-20 — Missed dailies journey** A player whose day closes with missed dailies sees the health loss, reset streaks and kept streaks on reload exactly as the close computed them.
- **DP-21 — Rest mode rules** A resting player's close costs no health, keeps streaks and adds no strike-back, they take no strike-back from others, and their strikes still count.
- **DP-22 — Resting journey** A player turns rest mode on with the switch, sees the rest banner, and after a close neither they nor their teammate lose health to their missed dailies.
- **DP-23 — Levels** Experience levels the player up at the published thresholds with carry-over and refills health on every level gained.
- **DP-24 — Fainting** Health reaching zero costs one level (never below 1), resets experience in the level, takes the published share of gold and resets health.
- **DP-25 — Level-up and faint dialogs** A level-up or faint, live or waiting from a close, opens its dialog with the published copy and closing it returns focus where it came from.
- **DP-26 — Level-up badge motion** The level-up badge grows to full size in about half a second and under reduced motion appears at full size at once.
- **DP-27 — Parties and invites** A leader forms a party and invites by username within the party-size limit, and invitees join or decline, as qualified in Business rules.
- **DP-28 — Quest lifecycle** A quest moves invited, active, then defeated or abandoned only along the published edges, with the published rejection for every other move.
- **DP-29 — Party chat** Members send chat messages of 1 to 500 characters within the chat rate limit, and the limit answers 429 with the published composer copy.
- **DP-30 — Live party journey** A leader and a member in two browsers see the invite, the acceptance, chat, the quest start and each strike arrive on the other screen without reload.
- **DP-31 — Live stream** One server-sent event stream delivers every published live change to every screen it concerns within 2 seconds.
- **DP-32 — Strikes in server order** Strikes from different members apply to the boss in the order the server receives them, and every member sees the same strike lines in that order.
- **DP-33 — Idempotent ticks** A tick, score or purchase repeated with one Idempotency-Key counts once and returns the stored response, and the same key with a different request answers 409.
- **DP-34 — Defeat and quest reward** The strike that takes the boss to 0.0 defeats the quest and pays every member the quest reward exactly once.
- **DP-35 — Simultaneous strikes journey** Two members tick at the same moment and both screens show both strikes, in the same order, with the boss meter matching the server.
- **DP-36 — Strike-back** During an active quest a close with missed dailies makes the boss strike back once, attributed to the player who missed, against every member who is not resting.
- **DP-37 — Strike-back seen live** When a teammate's close strikes back, every non-resting member's health meter and strike list update without reload and the feed announces the loss.
- **DP-38 — Game feed announcements** The polite "Game feed" region announces each published event in its exact sentence.
- **DP-39 — Phone board and party dialog** At 375 by 812 a player switches lists with the "Lists" tabs by tap or keyboard and opens the party rail as the "Party" dialog.
- **DP-40 — Swipe to complete** On a touch screen, a rightward swipe of at least 80 px on a daily or to-do row completes it and a shorter swipe does nothing.
- **DP-41 — Responsive layouts and touch targets** The board takes the published arrangement at 375, 768 and 1280 px wide with no horizontal overflow and every control at least 44 by 44 px on phone.
- **DP-42 — Task-list import format** An import file is checked against the published format and any error rejects the whole file with every error listed by line in the published wording.
- **DP-43 — Stored import originals** Every checked import file is stored byte for byte under its published key before any task is created, and "Download original" returns those bytes.
- **DP-44 — Upload type and size limits** Import files and banners of the wrong type or over their size limit are refused with 413 or 415 and the published copy before anything is stored.
- **DP-45 — Import journey** A player imports a file with errors, sees each error by line in the dialog, imports the fixed file, and finds both in import history with their results.
- **DP-46 — Storage outage** With the object store unreachable, import and banner upload answer 503 with the published copy and create nothing, while every other feature keeps working.
- **DP-47 — Party banner** A leader's banner is stored under its published key before success is reported, is served only to members, and replaces the old one live on every member's quest screen.
- **DP-48 — Quest history** Every finished quest is listed in each participant's quest history with each member's total damage and every strike and strike-back line, after reload and after leaving.
- **DP-49 — Party privacy** Another party's party, chat, quest, banner and history answer exactly like ones that do not exist, with 404.
- **DP-50 — Banner and history journey** A member sees the leader's new banner live, sees the quest fall, finds it in quest history after reload, and gets the not-found screen for another party's quest.
- **DP-51 — Local accounts** Players sign up and sign in with a username and password under the published rules and stay signed in by the session cookie.
- **DP-52 — Grading routes** The token-guarded setup and rollover routes create the published records in one transaction and run due closes exactly as the scheduler would.
- **DP-53 — One error order** Every endpoint applies the published error order and error body shapes.
- **DP-54 — Run manifest and health** The app installs, builds and serves from /app/run.json on port 4173 and answers the health check as published.
- **DP-55 — Server boundary** The server serves only the app and its API on one origin, enforces the published body limits, and never serves source files or credentials.
- **DP-56 — Health Seam** The boss panel's seam sits at the boss's remaining share of health, runs the published strike sequence, reaches the hot-pink defeat field once, and shows end states at once under reduced motion.
- **DP-57 — Duotone field look** Every screen is built from flat, square-cornered blush and aubergine fields that trade places at each section break, with hot pink used once per page.
- **DP-58 — Landing hero** The signed-out landing page shows the split hero with the cropped headline field on one side and the boss field on the other.
- **DP-59 — Landing demo quest** The landing page's three sample dailies strike a demo boss on the page without signing in, ending in the defeat field on the third tick.
- **DP-60 — Credentials from the environment** Every service credential and URL is read from the environment at start and never hard-coded or sent to the browser.

## Frontend

### Screens and layout (DP-01, DP-39, DP-41, DP-58)

Pages and their addresses:

- `/`: the landing page when signed out. A signed-in visitor goes to `/board`.
- `/signin`: sign-in and sign-up on one screen, with two labelled fields and two buttons.
- `/board`: the task board. It has a player bar, the four lists and the party rail.
- `/settings`: time zone, day-start hour, rest mode, and the next day start text.
- `/imports`: import history.
- `/history`: quest history, listing the Player's finished quests.
- `/quests/<questId>`: one quest's detail, with the boss, state, each member's total damage, and every strike and strike-back line in server order. An unknown quest, or another party's, shows the not-found screen.

**Landing (`/`).** This is a split hero with two flat fields that meet on a crisp vertical line with no gutter. The left field is blush. It holds the headline in very heavy, very wide display type, about seven hundredths of the window width, cropped by the left edge of the page. Under it sit the subline in body type and the hot-pink "Start your first day" action. The right field is aubergine. It holds a drawn, original sleepy serpent boss, the Drowsewyrm, made of blush lines and fills only. Under the serpent is a working demo Health Seam with three sample dailies (DP-59). On phone the headline field comes first, full width, and the boss field follows below it.

**Board (`/board`).**
- Desktop, 1280×800. The player bar runs across the top. Below it, Habits, Dailies and To-dos sit in three equal columns whose fields alternate blush, aubergine, blush. On the right, a fixed party rail about 360 px wide holds the Quest region, member health bars and party chat on an aubergine field. Rewards is a blush band across the bottom of the page under the three columns.
- Tablet, 768×1024. The lists sit two side by side in two rows: Habits and Dailies, then To-dos and Rewards. The party rail is replaced by the "Party" button that opens the "Party" dialog, as on phone.
- Phone, 375×812. A "Lists" tab bar sits under the player bar and shows one list at a time. The party rail is replaced by the "Party" button, which opens the rail's full content in the "Party" dialog.

There is no horizontal overflow at any of the three viewports on any page.

**Player bar.** It shows the username, the level text, the health meter, the experience meter and the gold status. It also has links to Settings, Import history and Quest history, the "Import tasks" button and the "Sign out" button. The player bar sits at the top of every signed-in page: the board, settings, import history, quest history and quest detail. While the Player is resting, the rest banner sits directly under it on each of those pages.

**Party rail.** Its content depends on the Player's state:
- Not in a party: the party name field and the form button.
- In a party: the banner, if one is set. Then the Quest region with the Health Seam panel, the boss meter, the strike list and the quest controls. Then the member list with one health meter per member, then chat.
- A pending party invite: the invite text with join and decline buttons, above everything else.

### Public screens and controls (DP-01, DP-02, DP-25, DP-29, DP-39, DP-45, DP-50, DP-56)

Only the roles and names below are public. Everything else is free. `<title>` is a task's title, `<v>` its value, `<n>` and `<total>` whole numbers, and `<username>` a username.

| Where | Role and accessible name | Visible copy / notes |
|---|---|---|
| Sign-in | `textbox "Username"`, password field labelled "Password", `button "Sign in"`, `button "Create account"` | |
| Landing | `heading "Every chore lands a blow."`, `link "Start your first day"` (to `/signin`), `region "Demo quest"` | The demo region holds `meter "Demo boss health"` and three `checkbox "Complete <title>"` for "Water the plants", "Stretch for ten minutes" and "Read one chapter" |
| Player bar | `meter "Health"` | Value is health, maximum 50.0, value text `<health> / 50.0` |
| Player bar | `meter "Experience"` | Value is experience in the current level, maximum is the level's threshold |
| Player bar | `status "Gold"` | Text `<gold> gold` |
| Player bar | text `Level <n>`, `link "Settings"`, `link "Import history"`, `link "Quest history"`, `button "Import tasks"`, `button "Sign out"` | |
| Board | `list "Habits"`, `list "Dailies"`, `list "To-dos"`, `list "Rewards"` | Each list has a visible heading with the same name |
| Board | `button "Add habit"`, `button "Add daily"`, `button "Add to-do"`, `button "Add reward"` | One beside each list heading. Each opens "New task" with its own list's type preselected |
| Habit row | `listitem` named `Habit: <title>, score <v>` | `<v>` uses an ASCII hyphen-minus for negatives and no sign otherwise. Holds `button "Score <title> up"` and `button "Score <title> down"` |
| Daily row | `listitem` named `Daily: <title>, due today` or `not due today`, then `, streak <n>, done` or `not done` | Holds `checkbox "Complete <title>"` |
| To-do row | `listitem` named `To-do: <title>, <c> of <t> checklist items, done` or `not done`; without a checklist, `To-do: <title>, done` or `not done` | Holds `checkbox "Complete <title>"` and, per checklist item, `checkbox "<item text>"` |
| Reward row | `listitem` named `Reward: <title>, costs <price> gold` | Holds `button "Buy <title>"` |
| Every habit, daily and to-do row | The value chip, as visible text | The band name from Business rules |
| Task dialogs | `dialog "New task"`, `dialog "Edit task"` | Fields: `combobox "Type"` (options "Habit", "Daily", "To-do", "Reward"; the fields below follow the selected type; disabled in "Edit task"), `textbox "Title"`, `combobox "Difficulty"` (options "trivial", "easy", "medium", "hard"; default "easy"), for dailies `group "Weekdays"` with `checkbox "Mon"` to `checkbox "Sun"` (all checked by default), for to-dos `textbox "Checklist"` (one item per line), for rewards `textbox "Price"`. Buttons: `button "Save task"`, `button "Cancel"`, and in "Edit task" also `button "Delete task"` |
| Level-up | `dialog "Level up"` | `button "Keep going"`, and the badge `img "Level <n> badge"` (`<n>` is the new level); its growth is described in Motion and effects |
| Faint | `dialog "You fainted"` | `button "Get back up"` |
| Import | `dialog "Import tasks"` | File input labelled "Task list file", `button "Import"`, `list "Import errors"` with one `listitem` per error |
| Import history (`/imports`) | `list "Import history"` | One `listitem` per import, showing the file name and result, with `link "Download original"` |
| Party rail | `textbox "Party name"`, `button "Form party"` | When not in a party |
| Party rail | `button "Join party"`, `button "Decline invite"` | For a pending party invite |
| Party rail | `textbox "Invite by username"`, `button "Invite"` | Leader only |
| Party rail | `region "Quest"` | Holds `img` with alt `<party name> banner` when a banner is set, the Health Seam panel, `meter "Boss health"` (value is boss health, maximum is the boss's full health, value text `<hp> / <max>`), and `list "Strikes"` with one `listitem` per strike or strike-back line, newest last |
| Quest controls | `combobox "Quest"` (options are the three fixture quest names exactly as in Business rules, in that table's order, with the first selected by default), `button "Invite party to quest"` (leader, no quest); `button "Accept quest"`, `button "Decline quest"` (invited member); `button "Begin quest"` (leader, disabled until the start rule is met); `button "Abandon quest"` (leader) | Abandon opens `dialog "Abandon quest"` with `button "Abandon"` and `button "Keep fighting"` |
| Party rail | Banner file input labelled "Banner image", `button "Upload banner"` | Leader only |
| Party rail | `list "Party members"` | Each member's `listitem` holds `meter "<username> health"` (maximum 50.0, value text `<health> / 50.0`) |
| Party rail | `log "Party chat"`, `textbox "Message"`, `button "Send"` | Each message reads `<username>: <text>` |
| Health Seam panel | The panel carries `data-seam="panel"`, and its blush remaining-health field carries `data-seam="remaining"` | The test hook for the seam position |
| Phone and tablet | `tablist "Lists"` with `tab "Habits"`, `tab "Dailies"`, `tab "To-dos"`, `tab "Rewards"` (phone only); `button "Party"` opening `dialog "Party"` | |
| Settings | `combobox "Time zone"` (every IANA zone, option text is the zone id), `spinbutton "Day start hour"`, `switch "Rest mode"`, `button "Save settings"` | The next day start text sits under the fields |
| Everywhere | `status "Game feed"` | Polite live region |
| Everywhere | `alert` | Full-width error and outage strip |
| Quest history (`/history`) | `list "Quest history"` | One `listitem` per finished quest, newest first. Each holds `link "<quest name>"` to `/quests/<questId>` and the history entry line from Feedback states |
| Quest detail (`/quests/<questId>`) | `heading "<quest name>"`, `list "Member damage"`, `list "Strikes"` | The quest state line; one `listitem` per member in `list "Member damage"`, in username order; one `listitem` per strike or strike-back line in `list "Strikes"`, in server order. All lines use the formats from Feedback states |
| Not-found screen | `heading "Quest not found"` | |

The rest banner is a `status` region under the player bar. Its copy is in Feedback states.

### Interactions (DP-02, DP-03, DP-06, DP-09, DP-15, DP-25, DP-30, DP-39, DP-40, DP-45)

**Keyboard on the board.** Each list is one stop in the Tab order. Inside a list, focus moves between rows (roving focus), and the list remembers its last focused row. An empty list takes focus itself.
- ArrowUp and ArrowDown move focus to the previous or next row in the list. They stop at the ends.
- ArrowLeft and ArrowRight move focus to the row at the same position in the neighbouring list, or to its last row if it is shorter. The list order is Habits, Dailies, To-dos, Rewards, and focus does not wrap past either end.
- Space completes the focused daily or to-do, or unticks it if it is done.
- `+` scores the focused habit up and `-` scores it down.
- Enter opens "Edit task" for the focused row. On a reward row, Enter also opens "Edit task". Buying uses the row's "Buy" button.
- Alt+ArrowUp and Alt+ArrowDown move the focused task one place within its list and keep focus on it. The move is saved to the server and announced in the feed. At the top or bottom of the list, nothing happens and nothing is announced.
- N opens "New task" with the type preselected for the list that holds focus.

These keys work whichever control inside a row or list has focus, the row's own buttons included. They are ignored while focus is in a text field, a select or a spinbutton.

**Dialogs and sheets.** "New task", "Edit task", "Import tasks", "Abandon quest" and "Party" open as sheets from the right edge. "Level up" and "You fainted" open centred.
- When a dialog opens, focus goes to its first field or button.
- Tab past the last control wraps to the first, and Shift+Tab from the first wraps to the last. Focus never leaves an open dialog.
- Escape, "Cancel" and the dialog's closing button close it. Focus then returns to the control that opened it: the task row, or the list's add button. After a create, focus goes to the new row. After a delete, it goes to the row that took the deleted row's place, or to the list.
- Closing "Level up" or "You fainted" returns focus to the row whose action caused it. If the dialog opened on page load or from a live event, focus goes to the first row of Habits.

**Mouse and touch.**
- Clicking a row's title opens "Edit task".
- The score buttons, the complete checkbox and the "Buy" button act at once.
- On a touch screen, a daily or to-do row follows a horizontal drag. Releasing after at least 80 px of movement to the right completes a row that is not done. A shorter drag, or any drag on a done row, springs back and does nothing.
- Tapping a "Lists" tab shows that list. With focus on the tablist, ArrowLeft and ArrowRight move between tabs and activate them.

**Live.** The board subscribes to the live stream on load. Changes made by teammates, by the server's day close, or by the same Player on another device update in place (DP-31). This includes rows, totals, meters, the strike list, chat, the quest controls, the banner and invites, and the open "Edit task" dialog's stale check.

**Chat.** Enter in "Message" sends, the same as "Send". The message appears in the log for every member, and the field clears after the server accepts it.

**Settings.** The "Rest mode" switch applies as soon as it is toggled. It saves only rest mode to the server, without "Save settings", and the rest banner appears or disappears within one second. Toggling it does not show the settings success status. "Save settings" saves the zone and day-start hour together and shows the settings success status from Feedback states. The next day start text then shows the server's new value.

**Not-found.** Opening `/quests/<questId>` for a quest the Player may not see shows the not-found screen.

**Landing demo.** The demo runs entirely in the page and sends nothing to the server. A reload starts it afresh.
- The demo boss is the Drowsewyrm with full health 30.0. `meter "Demo boss health"` starts at 30.0, with value text `30.0 / 30.0`.
- Each sample daily ticked deals 10.0 damage, so the meter reads 20.0, then 10.0, then 0.0. Each tick announces the own-strike sentence from Feedback states in the "Game feed".
- A ticked sample daily stays ticked and becomes disabled. It cannot be unticked.
- The third tick brings the boss to 0.0, and the demo panel turns into the demo defeat field from Feedback states.

### Visual design (DP-57, DP-58)

The direction is **duotone swap**. Two flat colours trade places as field and type at every section or column break, and no two neighbouring fields share a colour.

- **Colour roles:**
  - Ground: a warm blush pink.
  - Surface: a lighter, paler blush, used for task rows on blush fields.
  - Ink: a deep aubergine brown, used for type on blush and as the dark field colour.
  - Muted: a dusky mauve brown, used only for secondary text and for the giant empty-state words.
  - Accent: a hot pink. It appears once per page, as the page's single primary action. On the landing page that is "Start your first day". On the board it is the Quest region's current call to action ("Form party", "Accept quest", "Begin quest" or "Join party"). On the day a boss falls, the defeat field replaces it as the page's single hot-pink statement.
  - On-accent: a near-black wine colour for type on the hot pink.
- **Type:** Hubot Sans for display, at its heaviest weight and widest setting for list headings, the boss name and the hero. Mona Sans for body text. Each step up the heading scale is about one third larger than the one below. List headings are large, solid words, about two and a half times body size. Body text in forms is a comfortable 18 px reading size. Every amount, health value, price and strike number uses tabular figures, so columns of numbers line up.
- **Density:** comfortable. Rows have generous padding, and fields reach edge to edge inside a thin, even outer margin.
- **Shape:** square corners everywhere. The only circles on any page are the score buttons and the complete checkboxes. Rows are flat blocks: pale blush on blush fields, and an aubergine block tinted toward ink on aubergine fields. There are no shadows, gradients, glass, hairline rules, monospace labels or index numbers.
- **Board fields:** Habits, Dailies and To-dos alternate blush, aubergine, blush. The party rail is aubergine. Rewards is a blush band with prices in tabular figures.
- **Empty states:** one giant word in muted type, cropped by the field edge and hidden from assistive technology, behind the list's empty sentence. The words and sentences are in Feedback states.
- **Errors and outages:** a full-width aubergine strip with blush text. The only icons are line icons from the Lucide set.
- **Forms:** a blush sheet sliding in from the right edge, with labelled inputs in 18 px body type.
- **Quest history and quest detail:** flat rows, one per strike or strike-back line, with the name on the left and the amount on the right in tabular figures.
- **The boss name:** set so large in the Health Seam panel that it spans the panel from edge to edge and the seam cuts through its letters. Above the seam the glyph halves are blush on aubergine, and below it they are aubergine on blush, so the boss's health reads in the type itself. The meter's accessible name and the numeric value text stay fully legible beside it.
- **Controls and contrast:** every control is at least 44 by 44 px. Text and controls meet WCAG 2.2 AA contrast on their field.

### Motion and effects (DP-26, DP-56, DP-59)

Every motion starts fast and settles softly, and none lasts longer than 0.6 seconds. Nothing loops, and there are no idle or decorative animations. Animations run on the page's own clock. Tests pause and advance the browser clock, so every motion must reach its end state when the clock is advanced, and must not need wall time to pass. Service workers are blocked during grading, so the app must not rely on one.

**The Health Seam (signature).** The boss panel is two flat fields split by a horizontal seam: blush below for remaining health, aubergine above for damage dealt. At rest, the remaining-health field's height equals boss health divided by full health, times the panel height, within 1 px. This holds before and after a reload, and matches the server's values. When the Player finishes a task during an active quest, these steps run in order:

1. The row's damage chip, which shows `−<damage>`, lifts out of the row and travels to the seam in about a third of a second.
2. The seam drops by damage divided by full health of the panel height, in under half a second.
3. The boss meter's numerals count down from the old value to the new one, one tenth at a time, finishing within 0.6 seconds.
4. The attribution line slides into the bottom of the strike list and stays there.

A teammate's live strike runs steps 2 to 4 without the chip flight. When a strike takes the boss to 0.0, the seam reaches the bottom. The panel then turns once into a hot-pink statement field with the word "DOWN" in giant display type cropped by its edges, and the defeat line under it. It never repeats or loops, and it shows the same way after a reload of a defeated quest.

**Sheets:** they slide in from the right edge in under half a second and slide back out on close.

**The "Level up" badge** (`img "Level <n> badge"`): it grows to full size in about half a second. Full size is the badge's rendered width and height with no scaling applied, at least 96 px each way. When the growth starts, its rendered width is at most a quarter of its full width.

**Reduced motion:** when the system asks for reduced motion, there is no chip flight, no counting, no slide and no growth. The seam, the numerals, the attribution line, the defeat field, the sheets and the level-up badge show their final state in the same frame the server's reply or live event arrives. The "Game feed" sentences are the same.

**The landing demo:** each sample-daily tick runs the same seam sequence on the demo boss, without the chip flight. Under reduced motion it shows its end state at once.

### Feedback states (DP-05, DP-14, DP-22, DP-25, DP-29, DP-38, DP-44, DP-45, DP-46, DP-50)

Placeholders used in all copy:
- `<damage>`, `<h>`, `<hp>` and `<max>`: one decimal (`7.5`).
- `<gold>` and `<price>`: two decimals (`12.50`).
- `<xp>`, `<n>`, `<k>`, `<total>` and `<level>`: whole numbers.
- `<Boss>`: the boss name.

Every async action shows a pending state: its button is disabled while the request is in flight. The import button reads `Importing...` and the banner upload button reads `Uploading...` while pending.

**"Game feed" announcements** (the polite `status "Game feed"` region, in these exact sentences):
- Own completion of a daily or to-do: `<title> complete: +<xp> experience, +<gold> gold`
- Own habit scored up: `<title> scored: +<xp> experience, +<gold> gold`
- Own habit scored down: `<title> scored down: you lost <h> health`
- Own strike, announced after the completion or score sentence: `Boss took <damage> damage`
- A teammate's strike: `<username> hit the boss for <damage> damage`
- A strike-back that cost this Player health: `<Boss> struck back: you lost <h> health`
- A reorder: `<title> moved to position <n> of <total>`
- An undo: `<title> undone`
- A purchase: `<title> bought for <price> gold`
- Quest reward paid: `Quest complete: +<gold> gold, +<xp> experience`

A strike made by the same Player on another device is announced on this device as their own strike.

**Strike list lines** (the `list "Strikes"` region, quest detail and quest history):
- Strike: `<username> −<damage>`
- Strike-back: `<Boss> struck back for <h> (<username> missed <n>)`

The minus sign in strike lines and damage chips is the true minus sign (U+2212). `<h>` is the strike-back amount per member and `<n>` the number of missed dailies.

**Defeat field:** the word `DOWN` and the line `<username> landed the last blow.`

**Demo defeat field** (landing page): the word `DOWN` and the line `You landed the last blow.`

**Quest history and quest detail lines:**
- History entry: `<Boss>, <state>, ended <date>`. Here `<state>` is `defeated` or `abandoned`, and `<date>` is the ended instant's local date in the viewer's zone, as `YYYY-MM-DD`.
- Quest detail state line: `State: <state>`, where `<state>` is `invited`, `active`, `defeated` or `abandoned`.
- Member damage line: `<username> <damage>`, where `<damage>` is that member's total strike damage in the quest, in one decimal (strike-backs do not count). Every member who took part is listed, at `0.0` if they made no strike.
- The detail's strike list uses the strike list lines above.

**Level up dialog:** heading `Level up`, body `You reached level <level>. Your health is full again.`

**You fainted dialog:** heading `You fainted`, body `You dropped to level <level> and lost <gold> gold. Your health is back to 50.0.`

**Rest banner (`status`):** `Resting: missed dailies will not hurt you or your party.`

**Errors**, shown in the `alert` strip and announced by it:
- Not enough gold: `Not enough gold.` (the message from the 422 body).
- Stale edit, shown inside "Edit task" in its own `alert`: `This task changed on another device. Close and reopen it to edit.`
- Chat rate limit, shown under the composer: `Slow down: you can send <limit> messages a minute.` Here `<limit>` is the value of `CHAT_MAX_PER_MINUTE`.
- Field validation: each field's message from the 422 body sits under its field and is announced by the field's `alert`.
- Import line errors: each message from the 422 body, verbatim, as one item in `list "Import errors"`.
- Import file too large: `The file is larger than 100,000 bytes.`
- Import wrong type: `Choose a .deedlist text file.`
- Banner too large: `The image is larger than 2,000,000 bytes.`
- Banner wrong type: `Choose a PNG or JPEG image.`
- Storage outage on import: `File storage is unavailable. Nothing was imported.`
- Storage outage on banner: `File storage is unavailable. The banner was not changed.`
- Any other failed request: `Something went wrong. Try again.`

**Success:**
- Import: the dialog shows `Imported <n> tasks` (`Imported 1 task` when there is one) in a `status`.
- Import history rows read `Imported <n> tasks` or `Rejected: <k> errors` (`task` and `error` are singular when the number is 1).
- Banner: `status` text `Banner updated.`
- Settings: `status` text `Settings saved.`
- Next day start, under the settings fields: `Next day start: <weekday> <HH:MM> (<zone>)`. Here `<weekday>` is the three-letter English weekday (Mon to Sun) and `<HH:MM>` the 24-hour local time of the next close in the Player's zone, as given by the server's `nextDayStart`.

**Empty states** (giant cropped word, then sentence):
- Habits: `FRESH`, then `No habits yet. Add one to start scoring.`
- Dailies: `OPEN`, then `No dailies yet. Pick the days that matter.`
- To-dos: `CLEAR`, then `No to-dos. Add one, or enjoy the quiet.`
- Rewards: `TREAT`, then `No rewards yet. Name a treat worth the gold.`
- Party rail without a party: `You are not in a party yet.`
- Quest region with no quest: `No quest under way.`
- Quest history: `No finished quests yet.`
- Import history: `No imports yet.`

**Party and quest text:**
- Party invite: `<username> invited you to <party name>.`
- Quest invite: `<quest name>: <n> of <total> accepted`

**Not-found screen:** heading `Quest not found`, body `This quest does not exist or is not yours to see.`

**Sign-in failure:** `Wrong username or password.`

## Backend

### API (DP-04, DP-05, DP-13, DP-14, DP-27, DP-28, DP-29, DP-31, DP-33, DP-42, DP-43, DP-44, DP-46, DP-47, DP-48, DP-49, DP-51, DP-52, DP-53)

All endpoints are JSON (`application/json; charset=utf-8`) unless stated. Every endpoint except the health check, sign-up, sign-in and the grading routes needs the session cookie.

**Number formats in JSON.** Experience and value are integers. Gold, prices and amounts are numbers that represent two decimals (for example `12.5` means 12.50). Health and damage are numbers that represent one decimal. Instants are ISO 8601 UTC strings, and local dates are `YYYY-MM-DD`.

**Error order (one rule for the whole API).** Each request is checked in this order, and the first failing check answers:
1. 401 unauthenticated.
2. 404 for an unknown resource, or one that belongs to another Player or another party.
3. 403 forbidden.
4. A request carrying an `Idempotency-Key` that was already used: its stored response is returned here, before any state check.
5. 409 state conflict.
6. 413 too large.
7. 415 wrong type.
8. 422 validation.

**Error catalogue:**

| Name | Status | Body |
|---|---|---|
| unauthenticated | 401 | `{"error":"unauthenticated"}` |
| invalid credentials | 401 | `{"error":"invalid_credentials"}` |
| not found | 404 | `{"error":"not_found"}` |
| leader only | 403 | `{"error":"leader_only"}` |
| cross origin | 403 | `{"error":"cross_origin"}` |
| stale task | 409 | `{"error":"stale_task"}` |
| already done | 409 | `{"error":"already_done"}` |
| not done | 409 | `{"error":"not_done"}` |
| username taken | 409 | `{"error":"username_taken"}` |
| already in party | 409 | `{"error":"already_in_party"}` |
| party full | 409 | `{"error":"party_full"}` |
| already invited | 409 | `{"error":"already_invited"}` |
| invite expired | 409 | `{"error":"invite_expired"}` |
| quest in progress | 409 | `{"error":"quest_in_progress"}` |
| not enough accepted | 409 | `{"error":"not_enough_accepted"}` |
| quest not active | 409 | `{"error":"quest_not_active"}` |
| idempotency key reused | 409 | `{"error":"idempotency_key_reused"}` |
| body too large | 413 | `{"error":"body_too_large"}` |
| file too large | 413 | `{"error":"file_too_large"}` |
| unsupported file type | 415 | `{"error":"unsupported_file_type"}` |
| unsupported media type | 415 | `{"error":"unsupported_media_type"}` |
| validation | 422 | `{"errors":{"<field>":"<message>"}}` |
| not enough gold | 422 | `{"errors":{"gold":"Not enough gold."}}` |
| chat rate limited | 429 | `{"error":"chat_rate_limited"}` |
| storage unavailable | 503 | `{"error":"storage_unavailable"}` |

Validation messages:
- username: `Use 3 to 20 lowercase letters, digits or _.`
- password: `Use at least 8 characters.`
- title: `Title must be 1 to 80 characters.`
- difficulty: `Choose trivial, easy, medium or hard.`
- weekdays: `Choose at least one weekday.`
- price: `Price must be from 0.01 to 9999.99.`
- position: `Position must be from 1 to <total>.`
- direction: `Direction must be up or down.`
- type: `This action does not fit this task type.`
- timeZone: `Unknown time zone.`
- dayStartHour: `Day start hour must be a whole number from 0 to 23.`
- text (chat): `Message must be 1 to 500 characters.`
- name (party): `Party name must be 1 to 40 characters.`
- quest: `Unknown quest.`
- invite target (field `username`): `No player with that username.`

**Shapes.**
- **Player:** `{"id","username","level","experience","experienceToLevel","health","maxHealth":50.0,"gold","timeZone","dayStartHour","resting","today","nextCloseAt","nextDayStart","partyId","notices":[{"id","kind":"level_up"|"faint","level","goldLost"}]}`. Here `today` is the Player's open local date, `nextCloseAt` the instant it closes, and `nextDayStart` the text `<weekday> <HH:MM> (<zone>)`.
- **Task:** `{"id","type":"habit"|"daily"|"todo"|"reward","title","difficulty","value","band","streak","done","dueToday","weekdays","checklist":[{"id","text","checked"}],"price","position","updatedAt"}`. Fields that do not apply to the type are `null`.
  - `weekdays` is always a JSON array of weekday names from `"Mon"`, `"Tue"`, `"Wed"`, `"Thu"`, `"Fri"`, `"Sat"`, `"Sun"`, in week order (for example `["Mon","Wed","Fri"]`). This holds in requests, responses and the grading setup body.
  - `band` is the band name exactly as shown on the row's chip: `"Crimson"`, `"Amber"`, `"Sand"`, `"Teal"` or `"Blue"`.
  - In `POST /api/tasks`, `checklist` is an array of item texts, each created unchecked.
  - In `PATCH /api/tasks/<id>`, `checklist` is an array of `{"id","text"}` or `{"text"}` objects in the new order. An item sent with an existing id keeps its id and checked state and takes the new text. An item without an id is added unchecked. Existing items not sent are removed. Omitting `checklist` leaves the items unchanged.
- **Action result:** `{"task","player","delta":{"experience","gold","health","damage"},"strike","levelUp","fainted"}`. `strike` is a Strike or `null`.
- **Strike event:** `{"id","seq","kind":"strike"|"strikeback","username","amount","missed","bossHealthAfter","createdAt"}`. `missed` is `null` for strikes, and `username` on a strike-back names the Player who missed.
- **Party:** `{"id","name","leader","members":[{"username","level","health","resting"}],"pendingInvites":[username],"bannerUrl","questId"}`. `bannerUrl` is `null` or `/api/parties/<id>/banner?v=<uploadId>`.
- **Quest:** `{"id","partyId","name","boss","maxHealth","bossHealth","power","state","invitedAt","expiresAt","acceptedBy":[username],"startedAt","endedAt","defeatedBy","members":[{"username","damage"}],"events":[Strike event]}`. Events are in `seq` order.
- **Import:** `{"id","filename","size","status":"imported"|"rejected","createdAt","taskCount","errorCount","lines":[{"line","taskId","type","title"}],"errors":[{"line","message"}]}`

**Health and accounts.**

| Method and path | Request | Success | Errors |
|---|---|---|---|
| `GET /api/health` | | 200 `{"status":"ok"}`; see Server boundary for the degraded cases | |
| `POST /api/auth/signup` | `{"username","password"}` | 201 Player; sets the session cookie | username taken, validation |
| `POST /api/auth/login` | `{"username","password"}` | 200 Player; sets the session cookie | invalid credentials |
| `POST /api/auth/logout` | | 204; clears the cookie | |
| `GET /api/me` | | 200 Player | |
| `PATCH /api/settings` | any of `{"timeZone","dayStartHour","resting"}` | 200 Player | validation |
| `POST /api/notices/<id>/ack` | | 204 | not found |

**Tasks and gold.** The endpoints marked with an asterisk (*) accept an optional `Idempotency-Key` header.

| Method and path | Request | Success | Errors |
|---|---|---|---|
| `GET /api/tasks` | | 200 `{"habits":[Task],"dailies":[Task],"todos":[Task],"rewards":[Task]}`, each in position order | |
| `POST /api/tasks` | `{"type","title","difficulty","weekdays","checklist":[text],"price"}` (fields per type) | 201 Task, placed at the end of its list | validation |
| `PATCH /api/tasks/<id>` | `{"updatedAt", ...the same fields}` | 200 Task | stale task, validation |
| `DELETE /api/tasks/<id>` | | 204 | |
| `POST /api/tasks/<id>/move` | `{"position"}` (1-based) | 200 `{"tasks":[Task]}` for that list | validation |
| `POST /api/tasks/<id>/score` * | `{"direction":"up"\|"down"}` (habits only) | 200 Action result | validation (type, direction) |
| `POST /api/tasks/<id>/complete` * | (dailies and to-dos) | 200 Action result | already done, validation (type) |
| `POST /api/tasks/<id>/uncomplete` * | | 200 Action result | not done |
| `PATCH /api/tasks/<id>/checklist/<itemId>` | `{"checked":true\|false}` | 200 Task | |
| `POST /api/rewards/<id>/buy` * | | 200 Action result (`delta.gold` negative) | not enough gold |
| `GET /api/gold/ledger` | | 200 `{"balance","entries":[{"id","kind","amount","taskId","createdAt"}]}`, oldest first | |

**Parties, quests, chat and history.**

| Method and path | Request | Success | Errors |
|---|---|---|---|
| `POST /api/parties` | `{"name"}` | 201 Party | already in party, validation |
| `GET /api/party` | | 200 `{"party":Party\|null}` | |
| `GET /api/parties/<id>` | | 200 Party | |
| `POST /api/parties/<id>/invites` | `{"username"}` | 201 `{"id","party","username"}` | leader only, already in party, already invited, party full, validation |
| `GET /api/invites` | | 200 `{"invites":[{"id","partyId","partyName","from"}]}` | |
| `POST /api/invites/<id>/accept` | | 200 Party | already in party, party full |
| `POST /api/invites/<id>/decline` | | 204 | |
| `POST /api/parties/<id>/leave` | | 204 | |
| `GET /api/quest-fixtures` | | 200 `{"quests":[{"name","boss","maxHealth","power","rewardGold","rewardExperience"}]}` | |
| `POST /api/parties/<id>/quests` | `{"quest":"<fixture name>"}` | 201 Quest (state `invited`; the leader counts as accepted) | leader only, quest in progress, validation |
| `GET /api/quests/<id>` | | 200 Quest | |
| `POST /api/quests/<id>/accept` | | 200 Quest | invite expired, quest not active |
| `POST /api/quests/<id>/decline` | | 200 Quest | quest not active |
| `POST /api/quests/<id>/begin` | | 200 Quest (state `active`) | leader only, invite expired, not enough accepted, quest not active |
| `POST /api/quests/<id>/abandon` | | 200 Quest (state `abandoned`) | leader only, quest not active |
| `GET /api/parties/<id>/chat` | | 200 `{"messages":[{"id","username","text","createdAt"}]}`, the latest 100, oldest first | |
| `POST /api/parties/<id>/chat` | `{"text"}` | 201 message | chat rate limited, validation |
| `GET /api/history` | | 200 `{"quests":[Quest]}`, finished quests the Player took part in, newest first | |

**Files** (multipart/form-data, one part named `file`).

| Method and path | Success | Errors |
|---|---|---|
| `POST /api/imports` | 201 Import (status `imported`) | file too large, unsupported file type, storage unavailable; line errors answer 422 `{"importId":"<id>","errors":[{"line":<n>,"message":"<text>"}]}` |
| `GET /api/imports` | 200 `{"imports":[Import]}`, newest first | |
| `GET /api/imports/<id>` | 200 Import | |
| `GET /api/imports/<id>/original` | 200, the stored bytes unchanged, `Content-Type: text/plain; charset=utf-8`, `Content-Disposition: attachment; filename="<filename>"` | |
| `PUT /api/parties/<id>/banner` | 201 `{"bannerUrl"}` | leader only, file too large, unsupported file type, storage unavailable |
| `GET /api/parties/<id>/banner` | 200, the image bytes with `Content-Type` `image/png` or `image/jpeg` | not found (also when no banner is set) |

**Live stream: `GET /api/live`.** This is a `text/event-stream` on the same session cookie. Each message is `event: <name>` with `data: <JSON>`. Event names and data:
- `player`: Player
- `tasks`: the `GET /api/tasks` body
- `party`: Party, or `{"party":null}`
- `invite`: the `GET /api/invites` body
- `quest`: Quest
- `strike`: Strike event plus `questId`
- `chat`: a message plus `partyId`
- `banner`: `{"partyId","bannerUrl"}`
- `notice`: a notice

A stream only carries events about its own Player and its own current party.

**Grading routes.** These need the header `X-Grading-Token: <GRADING_TOKEN>`. A missing or wrong token, or an unset `GRADING_TOKEN`, answers 404 not found before any other check.

`POST /api/grading/setup` creates everything in one transaction. If any check fails, nothing is created. The body:

```json
{"users":[{"username","password","timeZone","dayStartHour","level","experience","health","gold","resting","currentDate"}],
 "parties":[{"name","leader","members":[username]}],
 "quests":[{"party","quest","bossHealth","state":"invited"|"active","acceptedBy":[username]}],
 "tasks":[{"owner","type","title","difficulty","value","streak","done","weekdays","checklist":[{"text","checked"}],"price","position"}]}
```

- User defaults: `timeZone` "UTC", `dayStartHour` 0, `level` 1, `experience` 0, `health` 50.0, `gold` 0, `resting` false.
- `currentDate` (`YYYY-MM-DD`) sets the user's open local date. It defaults to the local date whose day contains the current server instant, computed with that user's `timeZone` and `dayStartHour` by the day rule in Business rules.
- Starting gold is written as one `task` ledger entry.
- A party's `members` lists the non-leader members.
- A quest's `bossHealth` defaults to the boss's full health, and `acceptedBy` to the leader. An active quest starts with no strike events.
- A task's `position` defaults to the end of its list.

It answers 201:

```json
{"users":{"<username>":{"id","today","nextCloseAt"}},"parties":{"<name>":"<id>"},"quests":{"<party name>":"<id>"},"tasks":{"<username>":{"<title>":"<id>"}}}
```

Errors: username taken, or validation keyed by the failing field path (for example `users[0].timeZone`).

`POST /api/grading/rollover` takes `{"at":"<ISO instant>"}`. It runs every close that is due at or before `at` and has not yet run, for every Player, in order of close instant and then by username. It answers 200 `{"closes":[{"username","date","missed","healthLost","strikeBack"}]}`:
- `date`: the local date D that was closed, as `YYYY-MM-DD`.
- `missed`: the number of due dailies not done.
- `healthLost`: the Player's own step-1 loss.
- `strikeBack`: the amount dealt to each member, or `0.0`.

Live events go out exactly as for a scheduled close.

### Business rules (DP-04, DP-07, DP-08, DP-10, DP-11, DP-13, DP-16, DP-17, DP-18, DP-19, DP-21, DP-23, DP-24, DP-27, DP-28, DP-29, DP-32, DP-33, DP-34, DP-36, DP-42, DP-43, DP-47, DP-48, DP-49)

**Published limits.** Each line gives the setting, its environment variable where there is one, its default, and the rule.
- **Undo window**, `UNDO_WINDOW_SECONDS`, default 30 seconds. An untick received strictly less than this many seconds after its tick is an undo.
- **Chat rate limit**, `CHAT_MAX_PER_MINUTE`, default 5 messages. This counts per Player per rolling 60 seconds, and the message after the limit is refused.
- **Party size**, `PARTY_MAX_MEMBERS`, default 4 members, leader included. An invite or acceptance that would make members plus pending invites exceed it is refused as party full.
- **Quest invite expiry**, `QUEST_INVITE_SECONDS`, default 600 seconds. An acceptance or begin at or after this many seconds from the invite is refused as invite expired.
- **Grading token**, `GRADING_TOKEN`, unset by default. When unset, the grading routes answer 404.
- **Import file size**, fixed: 100,000 bytes is allowed and 100,001 bytes is refused.
- **Banner size**, fixed: 2,000,000 bytes is allowed and 2,000,001 bytes is refused. PNG or JPEG only.
- **Day-start hour**, fixed default 0: whole hours from 0 to 23 inclusive.

**Numbers and rounding.**
- Experience is a whole number.
- Gold is kept in hundredths and shown with two decimals.
- Health and boss health are kept in tenths and shown with one decimal.
- Rounding is always half up to the shown precision, applied once at the end of each formula.

**Difficulty and value.**
- Difficulty multiplier d: trivial 0.5, easy 1, medium 1.5, hard 2.
- Every habit, daily and to-do has a value v. It is a whole number that starts at 0 and is clamped to -20 to 20.
- The band and factor f are taken from v before the action changes it. The band name shown on the row's chip always reflects the current v, each in its own colour:
  - v ≤ -10: Crimson, f = 2
  - -9 to -1: Amber, f = 1.5
  - 0 to 4: Sand, f = 1
  - 5 to 9: Teal, f = 0.75
  - v ≥ 10: Blue, f = 0.5

**Rewards for actions.**
- Completing a daily or to-do, or scoring a habit up: experience = round(10 × d × f). Gold = experience ÷ 10, in two decimals. Boss damage = experience ÷ 2, in one decimal, only while the Player's party has an active quest. Then v rises by 1.
- A to-do with a checklist: experience = round(10 × d × f × (1 + 0.5 × checked ÷ total)). Gold and damage follow from that experience. Ticking or unticking a checklist item gives and takes nothing.
- Scoring a habit down: the Player loses health = round(2 × d × f), in one decimal. Then v falls by 1. It gives no experience, gold or damage.
- A daily may be completed on any day. Its streak and due state come from the close.
- Completing a done task is refused as already done. Two simultaneous completions of one task without a shared key: exactly one succeeds and the other is refused as already done.

For example, a medium to-do at value 0 pays 15 experience, 1.50 gold and 7.5 damage. With 1 of 2 checklist items ticked, it pays 19 experience, 1.90 gold and 9.5 damage.

**Levels.**
- Every Player starts at level 1 with 0 experience and health 50.0 of 50.0.
- Reaching level L+1 needs 25 × L experience within level L. Extra experience carries over, and several levels can be gained at once.
- Every level-up sets health to 50.0 and records a `level_up` notice.

**Fainting.**
- When health is 0.0 or less after any loss, the Player faints. They lose one level (never below 1). Their experience in the level resets to 0. They lose 10% of their gold, rounded down to the hundredth and written as a `faint` ledger entry. Their health resets to 50.0, and a `faint` notice is recorded.
- Notices stay in the Player's `notices` until acknowledged. The board opens the matching dialog for each one, oldest first, live or on the next load.
- A level-up and a faint from the same action apply in that order: level-up first, then faint.

**Gold ledger.**
- Every gold change writes exactly one entry. The kinds are `task` (earned, positive), `reward` (bought, negative), `quest` (quest reward, positive), `faint` (negative) and `undo` (the negative of the gold the undone tick earned).
- Entries are never edited or deleted, and the balance always equals their sum.
- Buying a reward whose price is greater than the balance is refused with not enough gold and changes nothing. A price equal to the balance is allowed.
- An undo always writes its full entry, even if that takes the balance below zero.

**Undo.** Unticking a daily or to-do inside the undo window reverts exactly what that tick gave:
- Experience. If the tick caused level-ups, the level, experience in the level and health return to their values just before the tick. Otherwise the tick's experience is subtracted.
- Gold, as an `undo` entry.
- The value change.
- The boss damage. Boss health rises by the same amount, and the strike event is removed for every member, with no strike announcement.

The undo is announced. After the window, an untick only clears the done state: no total, value, health or boss health changes. An untick of a tick whose strike defeated the boss, or of any tick once its quest has left the active state, does not change boss health. Inside the window it still reverts experience, gold and value.

**Ordering.**
- Each list's positions run 1 to n with no gaps. A move takes the task out and inserts it at the given position, shifting the others.
- Moves apply in the order the server receives them, and the last move wins.
- New and imported tasks go to the end of their list.

**Day close.**
- Each Player has an IANA time zone (default `UTC`) and a day-start hour.
- A Player's day for local date D is the span of instants from the day-start instant on D up to, but not including, the day-start instant on D+1. The day-start instant on a date is the first instant that date's local clock reads the day-start hour, on the hour, adjusted by the gap and repeat rules below. The close of D runs at the end of D's day. For example, with day-start hour 6 in UTC, the instant 03:00 on 5 March belongs to local date 4 March, and 06:00 on 5 March begins local date 5 March.
- The Player's open local date is the earliest local date not yet closed. At sign-up it is the local date whose day, by this rule, contains the sign-up instant.
- The close for local date D runs at the first instant on D+1 when the zone's local clock reads the day-start hour, on the hour. If that hour falls in a spring-forward gap, the close runs at the first instant after the gap. If the hour repeats in a fall-back, the close runs at the first occurrence only.
- Each Player and local date closes exactly once. Running a close again for the same date changes nothing and returns nothing for it.
- The server runs every due close within 60 seconds of its instant, from its own clock.
- A daily is due on D when D's weekday, in the Player's zone, is one of its weekdays.
- At a close, in this order:
  1. For each due daily not done, in list order: the Player loses round(2 × d × f) health, in one decimal. Its v falls by 2 (clamped), and its streak resets to 0.
  2. Each due daily that is done gains 1 streak.
  3. If the Player's party has an active quest and the Player missed N ≥ 1 due dailies, the boss strikes back once. Every party member who is not resting loses round(power × N) health, in one decimal. One strike-back event is recorded, attributed to the Player who missed.
  4. Faint checks run for every member who lost health in this close, in username order.
  5. Every daily's done state clears, and the open date moves to D+1.
- To-dos and habits are untouched by a close. Dailies not due on D keep their streak and lose nothing.

For example, with the seed data, tomas (zone America/Toronto, day-start hour 6) has his days closed at 06:00 Toronto time.

**Settings changes.**
- A changed zone or hour applies from the next close, which is the close of the current open date. That close's instant is recomputed with the new settings.
- If the recomputed instant has already passed when the settings are saved, the open date closes at that moment. No date is skipped or closed twice.
- Due-today, done state, `today`, `nextCloseAt` and `nextDayStart` are always computed by the server. The browser shows them and never derives them from the device clock.

**Rest mode.**
- A resting Player's close skips steps 1 and 3 for them: no health loss, streaks unchanged, and no strike-back from their misses. Their done dailies still gain streak in step 2.
- A resting Player takes no damage from anyone's strike-back.
- A resting Player's strikes still count.
- Rest mode can be turned on and off at any time, and each close uses the setting in force at its instant.

**Parties.**
- A Player is in at most one party. Forming a party makes the Player its leader.
- Only the leader invites, by username. Invites do not expire, and a Player may hold invites from several parties. Accepting one makes the Player a member and drops their other invites.
- Leaving removes the member. If the leader leaves, leadership passes to the member who joined earliest. If the last member leaves, the party is deleted.
- A member who leaves keeps the history of quests they took part in. Strike-backs and quest rewards apply only to current members.

**Quests.**
- States: `invited` → `active` → `defeated`, or `invited` or `active` → `abandoned`.
- Only the leader starts a quest invite, from the three fixtures, and only when the party has no quest in `invited` or `active`.
- Members accept or decline while the invite is live. The leader begins the quest once at least 2 members (leader included) have accepted, before expiry.
- Once active, every current member takes part, whether or not they accepted.
- Only the leader abandons.
- Every other move is refused as quest not active. This covers accepting, declining, beginning or abandoning a quest that is `active` where not allowed, `defeated` or `abandoned`, and beginning one that is already active.

**Strikes.**
- Strikes apply to the boss in the order the server receives them. Each strike and strike-back gets the next sequence number in its quest.
- Boss health never goes below 0.0. The strike that brings it to 0.0 is the defeating blow, and its damage is the health that was left.
- On defeat, the quest becomes `defeated`, `defeatedBy` is set, and every current member is paid the quest reward exactly once, as a `quest` ledger entry plus experience.
- Later ticks still pay experience and gold but make no strike.

**Idempotency.**
- An `Idempotency-Key` header (1 to 100 characters, scoped to the Player, kept at least 24 hours) on a score, complete, uncomplete or buy request makes it count once.
- A second request with the same key, method, path and body returns the stored status and body and changes nothing.
- The same key with a different method, path or body is refused as idempotency key reused.

**Chat.**
- Messages are 1 to 500 characters after trimming.
- A message beyond `CHAT_MAX_PER_MINUTE` within the last 60 seconds is refused as chat rate limited.

**Privacy.**
- A party, its chat, quests, banner and members' health are visible only to its current members.
- A finished quest is also visible to the Players who were members when it finished.
- To anyone else, they answer exactly like a resource that does not exist (404 not found), never 403 or 422. This also applies to ids sent inside request bodies.
- Imports are visible only to their owner.

**Quest history.** Each finished (`defeated` or `abandoned`) quest lists the boss, invited, started and ended instants, each member's total damage, and every strike and strike-back event. It persists after reload and after the Player leaves the party.

**Quest fixtures (the only quests):**

| Quest | Boss | Full health | Strike-back power | Reward |
|---|---|---|---|---|
| Wake the Drowsewyrm | Drowsewyrm | 400.0 | 1.5 | 25.00 gold and 100 experience |
| Hush the Clutterhound | Clutterhound | 250.0 | 1.0 | 15.00 gold and 60 experience |
| Dim the Gloamtide Moth | Gloamtide Moth | 600.0 | 2.0 | 40.00 gold and 150 experience |

**Task-list import format.**
- The file name ends in `.deedlist`, and the content is UTF-8 text.
- Line 1 is exactly `DEEDLIST 1`.
- Blank lines and lines starting with `#` are skipped.
- Every other line has fields separated by `|`, with surrounding spaces trimmed:
  - `habit | <title> | <difficulty>` (3 fields)
  - `daily | <title> | <difficulty> | <weekdays>` (4 fields; weekdays are comma-separated from Mon, Tue, Wed, Thu, Fri, Sat, Sun, at least one, no repeats)
  - `todo | <title> | <difficulty> | <checklist items separated by ;>` (3 or 4 fields)
  - `reward | <title> | <price>` (3 fields; price from 0.01 to 9999.99 with at most two decimals)

Error messages, with line numbers counted from 1:
- `Line 1: the first line must be DEEDLIST 1`
- `Line <n>: unknown task type "<type>"`
- `Line <n>: expected <k> fields, found <m>`, where `<k>` is `3` for habit and reward, `4` for daily and `3 or 4` for todo
- `Line <n>: title must be 1 to 80 characters`
- `Line <n>: difficulty must be trivial, easy, medium or hard`
- `Line <n>: weekdays must be chosen from Mon, Tue, Wed, Thu, Fri, Sat, Sun`
- `Line <n>: price must be a number from 0.01 to 9999.99`

How errors are reported:
- If line 1 is wrong, that is the only error reported.
- An unknown type or a wrong field count is the only error for its line.
- Otherwise each line reports every error it has, in the order listed above.
- All errors are reported in line order.

How a file is processed:
- Any error creates no task, and the import is recorded as `rejected`.
- A file with no errors creates its tasks in file order, appended to their lists, and records which line became which task.
- Every file that passes the size and type checks is stored before it is checked line by line (Services). Tasks are created only after the store confirms the write.

**Upload checks.**
- An import file over the size limit is too large. One whose name does not end in `.deedlist`, or whose bytes are not valid UTF-8 or contain a NUL byte, is the wrong type.
- A banner over its size limit is too large. One whose leading bytes are not a PNG or JPEG signature is the wrong type, whatever its name or declared type.
- Too-large and wrong-type files are refused before anything is stored.

### Services (DP-43, DP-46, DP-47)

**Postgres** is the system of record. It holds:
- Players and their settings.
- Tasks with value, streak, checklist and weekdays.
- The gold ledger.
- Experience, level and health events, and notices.
- Parties, invites, quests and strike events.
- Chat.
- The undo record per tick.
- Idempotency records.
- A closed-days record keyed by Player and local date. This makes each close happen once.
- Import records with their line results.

**The object store** (MinIO, S3 API) holds:
- Import files, byte for byte, at `imports/<userId>/<importId>.deedlist`, for every import that passes the size and type checks, accepted or rejected.
- Party banners at `banners/<partyId>/<uploadId>.png` or `banners/<partyId>/<uploadId>.jpg`, by detected type. The party's current banner is the latest stored one.

The app reports success, and creates the import's tasks or changes the party's banner, only after the store confirms the write. "Download original" and the banner route read the stored object.

**When the object store is unreachable:**
- Import and banner upload answer 503 storage unavailable, store nothing and create nothing: no import record, no task, no banner change. The UI shows the matching storage outage copy from Feedback states.
- Downloads of stored files answer 503 storage unavailable.
- Every other feature keeps working, including sign-in, tasks, closes, parties, quests, chat and live updates.

### Seed data (DP-52)

On every start, the app applies its schema and seeds the following if they are missing, without duplicating. Every person, party and message here is invented. All seeded players have password `deedfall-demo`.

**Players:**

| Username | Zone | Day-start hour | Level | Experience | Health | Gold |
|---|---|---|---|---|---|---|
| mira | Europe/Lisbon | 0 | 3 | 20 | 42.5 | 18.40 |
| tomas | America/Toronto | 6 | 2 | 10 | 50.0 | 7.25 |
| ines | Asia/Manila | 4 | 1 | 5 | 38.0 | 2.00 |

Each seeded balance is one `task` ledger entry.

**Party:** "Lantern Crew", leader mira, members tomas and ines.

**Active quest:** "Wake the Drowsewyrm", boss health 212.6. Its strike events, in order: mira −100.0, tomas −60.0, ines −27.4.

**Chat:** mira `Drowsewyrm is wobbling. One more push tonight.`, then tomas `Walking the dog counts, right?`

**mira's tasks:**
- Habit "Drink a glass of water": easy, value 3.
- Habit "Doomscroll after midnight": medium, value -4.
- Daily "Stretch for ten minutes": easy, Mon to Fri, value 0, streak 4.
- Daily "Read one chapter": medium, every day, value 6, streak 12.
- To-do "Book the dentist": hard, value 0, checklist "Find the number" (checked) and "Call before noon" (unchecked).
- Reward "Fancy coffee": 5.00.
- Reward "Episode of a show": 12.00.

**tomas's tasks:**
- Habit "Take the stairs": easy, value 0.
- Daily "Walk the dog": easy, every day, value 0, streak 0.
- To-do "Return library books": trivial, value 0.
- Reward "New paperback": 15.00.

**ines's tasks:**
- Daily "Practice guitar": medium, Mon, Wed, Fri, value 0, streak 2.
- Reward "Bubble tea": 6.50.

## Technical requirements

### Deployment (DP-54)

Backend: TypeScript on Node 22. Frontend: TypeScript built with Node 22 in the same `build` step.

`/app/run.json` holds the string commands `install`, `build` and `serve`, plus `"_schema":"run-manifest-v1"`. For example:

```json
{"_schema":"run-manifest-v1","install":"npm ci","build":"npm run build","serve":"npm start"}
```

- `serve` binds `0.0.0.0` on port 4173, or on `APP_PUBLIC_PORT` when it is set.
- `serve` applies the database schema and the seed idempotently every time it starts, not only at build.
- `GET /api/health` answers HTTP 200 JSON as stated in Server boundary.
- The verifier may run extra instances of the same build against their own empty database and bucket. These use different values of `UNDO_WINDOW_SECONDS`, `QUEST_INVITE_SECONDS`, `CHAT_MAX_PER_MINUTE` and `PARTY_MAX_MEMBERS`, or an unreachable object store.

### Configuration and secrets (DP-60)

The app reads these at start, never hard-codes them, and never sends them to the browser:

- Postgres: `DATABASE_URL`.
- Object store: `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_FORCE_PATH_STYLE`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`. The app creates the bucket if it is missing.
- Game settings: `UNDO_WINDOW_SECONDS`, `CHAT_MAX_PER_MINUTE`, `PARTY_MAX_MEMBERS`, `QUEST_INVITE_SECONDS`, `GRADING_TOKEN`.
- Server: `APP_PUBLIC_PORT`.

The session cookie is `deed_session`, HttpOnly and SameSite=Lax. Passwords are stored only as salted slow hashes.

### Server boundary (DP-55)

- **One origin.** The app and its API are served from one origin. State-changing requests whose `Origin` header names another origin are refused with 403 cross origin before any other check.
- **Body limits.** JSON bodies are limited to 64,000 bytes (64,000 is allowed), and larger bodies are refused with body too large. Upload bodies are limited by the file limits in Business rules. A JSON endpoint called with another content type is refused with unsupported media type.
- **What is served.** The server serves only built assets, the pages and the API. Paths such as `/package.json`, `/run.json`, `/.env`, `/src/` and any source map of server code answer 404. Credentials never appear in any response, page or bundle.
- **Health while Postgres is unreachable** (at boot or later): the server keeps retrying, `GET /api/health` answers 503 `{"status":"starting"}`, and other routes answer 503 `{"error":"database_unavailable"}`.
- **Health while the object store is unreachable:** `GET /api/health` answers 200 `{"status":"unavailable"}` (never 503), and the app serves everything else.
- **Health when both are reachable:** 200 `{"status":"ok"}`.

### Browser support and performance (DP-41)

- Current Chromium, Firefox and WebKit, at 375×812 (touch), 768×1024 and 1280×800.
- The board is usable within three seconds of a cold load with the seed data.
- Every own action shows its server result within one second on the grading machine.
- Every live change reaches other open screens within two seconds.

## Working rules

- IF-01: `/app/run.json` exists with string `install`, `build` and `serve` commands and `"_schema":"run-manifest-v1"`.
- IF-02: `THIRD_PARTY_NOTICES.md` at `/app` lists every shipped package with its version and licence. Shipped packages are the production dependency tree from `npm ls --omit=dev --all --json`. It also lists the bundled Hubot Sans and Mona Sans fonts.
- IF-03: Every shipped package and bundled font uses one of these licences: MIT, ISC, BSD-2-Clause, BSD-3-Clause, Apache-2.0, 0BSD or OFL-1.1.
- IF-04: The only datastores are the provided Postgres database and object store bucket. There is no SQLite, Redis, file-based store or in-memory store of game state that outlives a request, except live stream connections.
- IF-05: The app loads no external network resources at runtime: no CDN scripts, styles or web fonts.
- IF-06: A `package-lock.json` is committed, and `install` uses it.
- IF-07: The provided service configuration (the dev compose files and their seeded credentials) is left unchanged.

## Engineering standards

- The code is idiomatic, strictly typed TypeScript with no `any` in domain code. Names match this brief's terms: habit, daily, to-do, reward, value, band, strike, strike-back, close, rest mode, ledger.
- Each domain rule is decided in exactly one place in the source: the reward formulas, the band table, the close instant, the close steps, the quest state transitions, the undo reversal and the error order.
- Gold balance, boss health and the due-today set are derived from stored records by the server, never recomputed in the browser.
- There is no abstraction with a single implementation, and no dead, commented-out or unreachable code.
- There are no defensive checks for states the rules make impossible.
- Every error response uses the shapes in the error catalogue.
- No feature goes beyond this brief.
