# Longroom Works Overcall

Overcall is a cricket scoring and league app for unpaid cricket: park and weekend clubs, school and office teams, tape-ball and street games. A volunteer scorer records a match ball by ball on a phone or a laptop, using the keyboard or an on-screen pad. The server applies a published subset of the laws and keeps strike, bowler limits, free hits, targets and run rates. Viewers follow a live scoreboard and ball-by-ball commentary from their own devices through the match's viewer link. Organisers run tournaments with groups, points tables and net run rate, invite scorers by mail and keep each team's logo. Players keep career figures built from finished scorecards. Overcall is one TypeScript app server with a browser client, and it uses four services. Postgres stores everything, including each innings' ball log. Valkey carries the live per-match channel and the scorer's pen. MinIO stores team logos. Mailpit receives scorer invitations. Out of scope: any other datastore or service, outside sign-in (accounts are email and password only), paid plans, fantasy games, betting or odds, video or streaming, rain-rule targets, generated commentary, offline scoring, service workers, and any real league, club, logo or player.

## Problem and users

Most cricket today is unpaid, and a volunteer scores it at the boundary on a phone: a parent, a twelfth man, or a batter waiting to go in. Free scoring apps are crowded and lock features away. Their users report crashes when a ball is changed afterwards, strike shown at the wrong end, and live scores that lag. The laws are hard to apply by hand. A free hit follows every no-ball and carries on through wides. Byes count for the team but not against the bowler. Bowlers have an over limit and cannot bowl two overs in a row. A super over has rules of its own. So the scorecard at the end often does not add up: extras do not reconcile, the strike is wrong, a bowler's figures are short. The organiser then rebuilds the points table and net run rate in a spreadsheet, and has to remember that a side bowled out counts as having faced its full overs. Overcall keeps the laws in one server-side engine. After every ball, correction or undo, that engine rebuilds the whole innings from its ball log.

- **Scorer** (weekly): records a match ball by ball from a phone or laptop, by keyboard or on-screen pad. Corrects or undoes a ball when needed. Ends with a scorecard that reconciles exactly.
- **Viewer** (weekly): follows the live score, the current over and the commentary on their own device without refreshing, then reads the final scorecard. Needs no account.
- **Organiser** (weekly): runs a tournament with groups, matches, scorer invitations, a points table and a net run rate that nobody edits by hand. Keeps each team's logo.
- **Player** (occasional): keeps exact career batting and bowling figures across every finished match they played.

## Journeys

1. **Score an over by keyboard.** Start: a signed-in scorer opens the scoring page of a match whose first innings has begun, with the opening bowler chosen. The scorer types runs, wides, no-balls, byes and leg byes with the keyboard. They see each ball in the This over strip and the commentary, the FREE HIT badge after the no-ball, and the score and run rate change. End: the over ends, the batters change ends, and the Next bowler dialog opens with focus on its Bowler select.
2. **Take wickets and fix mistakes.** Start: a match in progress on the scoring page. The scorer records a catch, an LBW and a run out through the Wicket dialog and picks each new batter. They then change an earlier ball's runs and undo the last ball. End: the batters, commentary lines, fall of wickets and bowler figures show the replayed innings, and each change is announced.
3. **Follow from home.** Start: a viewer opens the match's viewer link on a phone, with no account. The scoreboard stays at the top while the commentary scrolls. Each ball the scorer records appears a few seconds later: the changed digits roll and the screen reader announces the ball. When the scorer corrects a ball, the viewer sees a notice and the recomputed values. End: at the result the viewer reads the result line and the full scorecard.
4. **Hand over the pen.** Start: an organiser's match page. The organiser invites a second scorer by email. The invitee opens the mailed link, accepts, and lands on the scoring page. While the first scorer is scoring, that page is read-only and names the first scorer. When the first scorer closes their page, the second page offers Take the pen. End: the second scorer holds the pen and scores by keyboard.
5. **Chase and finish.** Start: the first innings ends and both scorer and viewers see the innings break with the target sentence. The scorer starts the second innings and records the chase, and the chase line updates after every ball. End: the result shows on the scorer page, every viewer page, the scorecard and both teams' history, and stays there after reload.
6. **Settle a tie.** Start: a match with super overs on ends level. Scorer and viewers see the super-over break, which says who bats first. The scorer plays both super-over innings. End: the super-over result shows for everyone, and the super overs appear on the scorecard but not in careers or net run rate.
7. **Run the group.** Start: an organiser opens a tournament page with a points table per group. A scorer finishes a group match. End: the organiser's table reorders in place, with the new points and net run rates, and the change is announced. A player's career page shows the new figures after reload.
8. **Keep a logo.** Start: the organiser's team page. The organiser uploads a PNG logo, and the page shows that it is uploading until storage confirms the file. End: the logo shows on the team page and the scoreboard. If storage is down, the organiser sees the outage text and the previous logo stays.

## Mandatory requirements

This is the complete list of mandatory requirements; every check traces to one of these lines and the detailed sections below.

- **DP-01 — Keyboard scoring** With focus anywhere on the scoring page outside a text field, select or open dialog, the keys of Scoring controls record runs, arm and disarm extras, open the Wicket and Retire batter dialogs and undo, exactly like the pad buttons.
- **DP-02 — Delivery accounting** Each delivery adds team runs, batter runs, balls faced, bowler runs and extras exactly as the delivery table in Laws of the game says, and only legal deliveries count toward the over.
- **DP-03 — Commentary and this-over strip** Every delivery and over end appears newest first in the Commentary list with its published attributes and exact line, and the This over list shows one chip per delivery of the over in progress.
- **DP-04 — Ball announcements** When a page shows a recorded delivery, its polite live region announces the commentary line and the score in the published announcement grammar, on the scorer page and every viewer page.
- **DP-05 — Scoreboard lines** The scoreboard, batters, bowler and run-rate elements show the server's values in the published formats after every delivery.
- **DP-06 — Strike rotation** The server swaps the batters after an odd number of runs run and again after the sixth legal ball of an over, and every page marks the striker with `data-on-strike` and an asterisk.
- **DP-07 — Touch scoring** On a phone a scorer records deliveries, wickets and the next bowler by tapping the pad and the dialogs, with the same results as the keyboard.
- **DP-08 — Phone pad layout** At 390 by 844 pixels the pad keys are at least 48 by 48 pixels, the pad never covers the scoreboard or the This over strip, and no page scrolls sideways at 320 or 390 pixels wide.
- **DP-09 — Wicket dialog** The Wicket dialog records every published kind of dismissal with fielder, batter out, runs completed and new batter by keyboard or touch, keeping focus inside it and returning focus on close.
- **DP-10 — Wicket kinds per delivery** The server allows each kind of wicket only on the deliveries Laws of the game lists, the dialog disables the others, and anything else is refused with 422 `WICKET_NOT_ALLOWED`.
- **DP-11 — New batter placement** After a wicket the new batter takes the end that Laws of the game gives, before any end-of-over swap.
- **DP-12 — Dismissals, fall of wickets and all out** Dismissal text and the fall-of-wickets line follow the published formats, and the server ends the innings as all out when no batter is left to come in.
- **DP-13 — Free hit rule** The server makes the delivery after a no-ball a free hit, carries it through wides and no-balls, and on it accepts only a run out.
- **DP-14 — Free hit on screen** The FREE HIT badge shows exactly while the next delivery is a free hit, free-hit lines carry the free-hit suffix, and the Wicket dialog on a free hit offers only Run out.
- **DP-15 — Next bowler dialog** Before every over after the first the Next bowler dialog opens by itself with focus on its Bowler select, and a scoring key pressed while a bowler is needed is refused and reopens it.
- **DP-16 — Bowler limits** The server refuses a bowler who bowled the previous over or has reached the over limit, checking consecutive overs first, with 422 and the published sentences.
- **DP-17 — Bowling figures** Bowler lines and bowling rows show overs, maidens, runs charged, wickets, wides, no-balls and economy derived from the ball log in the published formats.
- **DP-18 — Change a past delivery** The pen holder changes the runs and extra of any delivery of the current innings through its Change delivery dialog, by keyboard or touch.
- **DP-19 — Innings replay after a change** After a change the server replays the whole innings, so every later striker, label, free-hit flag, total, row, fall of wickets, over-end line and target follows from the changed log.
- **DP-20 — Change refusals** A change that would move the overs or make a recorded wicket impossible is refused with 422 and the published sentence, and nothing changes.
- **DP-21 — Corrections shown to viewers** Viewer pages show a change or undo with the published notice and the recomputed values, in the order the scorer made them, as qualified in Live viewer delay.
- **DP-22 — Undo the last delivery** The U key or the Undo button removes the last scoring event of the innings, restores a dismissed batter, and announces the undo.
- **DP-23 — Undo across an over or innings** Undo with no delivery yet in the over removes that over's bowler together with the previous delivery, reopens a finished innings or result as Corrections states, and is refused when nothing is left.
- **DP-24 — Retired hurt** The scorer retires a batter between deliveries, the new batter takes that end, and the retired batter can come back later or ends the innings as `retired hurt` and not out.
- **DP-25 — End of an innings** The server ends an innings when its over quota is bowled, it is all out, or the target is reached, and refuses further deliveries in it with 409.
- **DP-26 — Innings break** At the innings break the scorer and every viewer see the published break heading and target sentence, and the scorer starts the next innings from the Start innings dialog.
- **DP-27 — Chase line** During a chase the chase line shows runs needed, balls left and the required rate after every delivery, and a wide or no-ball never changes balls left.
- **DP-28 — Result and team history** When the match ends, the server's result text shows on the scorer page, viewer pages, the scorecard and both teams' history, and the history keeps it after reload.
- **DP-29 — Scorecard** Each innings' scorecard shows batting and bowling tables, extras, total, did-not-bat and fall of wickets in the published formats, and reconciles with the ball log.
- **DP-30 — Super over play** With super overs on and scores level, the scorer and viewers see the super-over break, and the scorer plays each super over to the published result.
- **DP-31 — Super over rules** Each super-over innings is one over that ends at 2 wickets, the previous super over's bowler is barred, and super overs repeat up to `SUPER_OVER_MAX` before the match is tied.
- **DP-32 — Viewer link** Anyone with a match's viewer code follows its scoreboard and scorecard read-only, nothing can be recorded through it, and when the organiser turns the link off it answers 404 and open viewer pages say so.
- **DP-33 — Live viewer delay** Viewer pages show each new state from the live connection exactly `LIVE_DELAY_MS` after it arrives, timed by the page's clock, never earlier, and in the order the scorer made the changes.
- **DP-34 — Viewer data fields** The viewer state and scorecard responses carry exactly the published fields and never an email address or account id.
- **DP-35 — Ball tick** When a page shows a new state, each scoreboard digit that changed rolls once as a `ball-tick` animation in the published order and timing, and unchanged digits never move.
- **DP-36 — Reduced motion** With reduced motion requested, no `ball-tick` animation is created and the digits, text and announcement change at once to the same values.
- **DP-37 — Pinned scoreboard** On the viewer page the scoreboard stays at the top of the viewport while the commentary scrolls beneath it.
- **DP-38 — Scorer invitations** An organiser invites a scorer by email from the match page, and the invitee accepts from the mailed link and lands on the scoring page.
- **DP-39 — Invitation mail and tokens** Each invitation is a Mailpit message with the published sender, subject, link and expiry line, and its token works once, within `INVITE_TTL_HOURS` hours by the server clock.
- **DP-40 — Invitation rate limit** An organiser may send at most `INVITE_RATE_PER_HOUR` invitations in any hour, and the next one answers 429 with the published sentence.
- **DP-41 — One pen per match** Exactly one open scoring page holds a match's pen, which is kept in Valkey while that page's live connection is open and released `PEN_GRACE_MS` after it closes, and every scoring call without the pen answers 409 `PEN_HELD`.
- **DP-42 — Read-only scoring page** A scoring page without the pen shows the holder's name, disables every scoring control, ignores scoring keys, and updates live with no delay.
- **DP-43 — Taking the pen** When the pen is released, every read-only scoring page says so live and offers Take the pen, which gives the pen to exactly one page.
- **DP-44 — Tournament groups** An organiser creates a tournament with groups of teams and matches between teams of a group, and its page shows a points table per group.
- **DP-45 — Points and order** The points table gives 2 points for a win, 1 for a tie and 0 for a loss, and orders teams by points, wins, net run rate, head-to-head and name.
- **DP-46 — Net run rate** Net run rate is derived from finished group matches using exact overs, counts a bowled-out side's full quota, leaves super overs out, and is shown to 3 decimals with a sign.
- **DP-47 — Live points table** The tournament page updates its points table in place, with an announcement, whenever a group match gets, changes or loses its result.
- **DP-48 — Careers** A player's career page shows batting and bowling figures derived only from finished matches with a ball log, leaving super overs out.
- **DP-49 — Private records** Another organiser's teams, players, tournaments, matches and deliveries answer 404 exactly like missing ids, on pages and in the API.
- **DP-50 — Accounts** People sign up, sign in and sign out with email and password, and sign-in answers identically for an unknown email and a wrong password.
- **DP-51 — Teams and players** An organiser creates teams with players whose short names default to the last word of the full name and are unique within the team.
- **DP-52 — Team logos** A PNG or JPEG logo of at most `LOGO_MAX_BYTES` bytes is stored in MinIO and shown on the team page and the scoreboard only after storage confirms the object.
- **DP-53 — Logo storage outage** With MinIO unreachable, an upload answers 503 with the published text and the team keeps its previous logo.
- **DP-54 — Live updates outage** With Valkey unreachable, scoring still saves and every scoring and viewer page shows the published paused text.
- **DP-55 — Invitation mail outage** With Mailpit unreachable, an invitation answers 503 with the published text and no invitation is stored.
- **DP-56 — Grading routes** With the grading key, the seed and clock routes build users, teams, tournaments, matches, ball logs and invitations exactly as if they had been played, and set the server clock; without the key they answer 404.
- **DP-57 — Platform and server boundary** The app installs, builds and serves from `/app/run.json` on port 4173, answers health and service status, reads every setting from the environment, and serves only same-origin requests within the published limits.
- **DP-58 — Page structure and layouts** Every page has one main landmark, one h1 and the Main navigation, and lays out without sideways scrolling at 320, 390, 768, 1024, 1280 and 1440 pixels wide.
- **DP-59 — Pinned-poster look** The landing hero and the working screens carry the pinned-poster direction of Visual design: the poster-scale score, the split name, the palette roles, square corners and the flat banded tables.
- **DP-60 — Laws engine on the server** Every total, figure, strike position, line, table and career is computed in one server-side laws engine by replaying the ball log, and the browser only renders what the server sends.

## Frontend

### Screens and layout (DP-05, DP-08, DP-26, DP-28, DP-29, DP-37, DP-44, DP-48, DP-58, DP-59)

Every page has one `main` landmark and one `h1`. The `nav` named `Main` (links `Matches`, `Teams`, `Tournaments`) sits in the top bar. At 390 pixels wide and narrower, the nav collapses behind the button `Menu`. No page scrolls sideways at 320, 390, 768, 1024, 1280 or 1440 pixels wide. The judge's three viewports are 375 by 812, 768 by 1024 and 1280 by 800.

| Screen | Path | Who | What it shows |
|---|---|---|---|
| Landing | `/` | anyone | The hero (Visual design) and the links `Start scoring →`, `Follow a match`, `Tournaments`, `Careers` |
| Sign up | `/signup` | anyone | Single-column form |
| Sign in | `/signin` | anyone | Single-column form |
| Follow a match | `/follow` | anyone | Textbox `Viewer code` and button `Follow`, which opens `/live/<code>` |
| Matches | `/matches` | signed in | The matches the user organises or scores, newest first, and the link `New match` |
| New match | `/matches/new` | signed in | Match form (Public screens and controls) |
| Match | `/matches/:id` | organiser | h1 `<home> v <away>`; the `Viewer link` switch; `#viewer-url` with the full viewer address while the link is on; the invitation form; links `Score this match` and `Scorecard` |
| Scoring | `/matches/:id/score` | organiser, accepted scorers | The scoreboard parts, the pad, the dialogs, `#pen-notice`, `#live-status` |
| Scorecard | `/matches/:id/scorecard` | organiser, accepted scorers | Scorecard sections |
| Viewer | `/live/:code` | anyone with the code | The scoreboard parts without the pad, plus `#notice` and `#live-status` |
| Viewer scorecard | `/live/:code/scorecard` | anyone with the code | Scorecard sections |
| Teams | `/teams` | signed in | Team list and the link `New team` |
| New team | `/teams/new` | signed in | Team form |
| Team | `/teams/:id` | organiser, scorers of its matches | Logo, players, the logo form (organiser only), the `Matches` history list |
| Tournaments | `/tournaments` | signed in | Tournament list and the link `New tournament` |
| New tournament | `/tournaments/new` | signed in | Tournament form |
| Tournament | `/tournaments/:id` | organiser, scorers of its matches | One points table per group, then the group's matches |
| Players | `/players` | signed in | Every player of the user's visible teams |
| Career | `/players/:id` | as the player's team | `Batting` and `Bowling` career tables |
| Invitation | `/invitations/:token` | signed in | Heading and `Accept invitation` |

A page for something the user cannot open, or that does not exist, answers HTTP 404 and shows the not-found copy from Feedback states as its `h1`.

**Scoreboard parts.** The scoring and viewer pages share these parts and ids. Every value comes from the match state the server sends (Backend, API).

- `#scoreboard`: text `<team> <runs>/<wickets> (<overs> ov)`. `<team>` is the batting team's name. Before the first innings starts, it is the side batting first with `0/0 (0 ov)`. Attributes: `data-runs`, `data-wickets`, `data-legal-balls`, and `data-innings` (`1` or `2` for the match innings, and `so<n>-1` or `so<n>-2` for the first or second half of super over `<n>`). Each digit of the runs, the wickets and the overs is its own element with class `digit`. The element's text content is always the final value. The batting team's logo, when it has one, sits beside it as an image with alt `<team> logo`.
- `#batters`: two items. Each has `data-player` (player id) and `data-on-strike` (`true` or `false`), and the text `<short><star> <runs> (<balls>)`, where `<star>` is `*` on the striker only. For example `Rao* 7 (3)`.
- `#bowler`: `<short> <figures>` for the current bowler, or the last one between overs. Figures follow Bowling figures in Business rules.
- `#run-rate`: `Run rate <rate>`, defined in Business rules.
- `#chase`: shown only in a second innings or a super-over chase; text from Business rules.
- `#free-hit`: text `FREE HIT`. In the DOM only while the next delivery is a free hit.
- `#innings-break`: a region with an `h2` heading and a paragraph. Present only at a break (Innings and result in Business rules).
- `#result`: the result text. Present only once the match has ended.
- `#this-over`: an ordered list (`aria-label` `This over`) with one item per delivery of the over in progress. After an over ends, it keeps that over until the next over's first delivery. Chip text is defined in Business rules.
- `#commentary`: an ordered list (`aria-label` `Commentary`), newest item first. Item attributes are listed in Business rules. Each item's `.line` element holds its exact line. On the scoring page, every delivery item also holds the button `Change delivery <seq>`, outside `.line`.
- `#notice` (viewer pages): the latest correction notice.
- `#live-status`: the outage and sharing texts from Feedback states, empty otherwise.
- `#pen-notice` (scoring page): the pen texts from Feedback states, empty while this page holds the pen.

**Scoring page layout.** On a phone at 390 by 844, from the top: `#scoreboard` at poster scale (about a third of the screen), the batters and bowler lines, `#this-over`, `#free-hit`, then the pad as a four-by-four grid of square keys with `Retire batter` below it. The commentary follows under the pad. The pad's bounding box never overlaps the boxes of `#scoreboard` or `#this-over`, and every pad key is at least 48 by 48 CSS pixels. At 768 pixels wide and above, the pad sits in a right column beside the scoreboard and the commentary, and its keys are at least 44 by 44.

**Viewer page layout.** `#scoreboard` is the pinned poster title. After the page has scrolled 1000 pixels, its top stays 0 to 1 pixels from the viewport's top. The over panels (the commentary) scroll beneath it. Below the commentary the pin releases into the link `Scorecard`. On a phone the score is larger relative to the width than on a laptop.

**Scorecard layout.** Sections in innings order. Each has heading `<team> innings` (super overs: `Super over <n>: <team>`), the `Batting` table (column headers in order: `Batter`, `Dismissal`, `R`, `B`, `4s`, `6s`, `SR`), `.extras`, `.total`, `.did-not-bat` and `.fow` lines, the `Bowling` table (column headers in order: `Bowler`, `O`, `M`, `R`, `W`, `Wd`, `Nb`, `Econ`), and then `#result`. All formats are in Business rules. On a phone each table scrolls inside its own section, never the page. The table is the only thing allowed to scroll sideways.

**Tournament page.** One `table` per group with caption `<group name>` and columns `Team`, `P`, `W`, `L`, `T`, `Pts`, `NRR`, in table order. Below each table are the group's matches with their result or status.

**Career page.** `h1` is the player's full name. The tables are captioned `Batting` (columns `Mat`, `Inns`, `NO`, `Runs`, `HS`, `Avg`, `SR`, `4s`, `6s`) and `Bowling` (columns `Overs`, `Runs`, `Wkts`, `Best`, `Econ`), each with one row.

**Team page.** `h1` is the team name, with the logo image (alt `<team> logo`) when one is confirmed. Players are listed by full name with short name. The list `Matches` shows the team's history (Business rules, Teams and careers).

### Public screens and controls (DP-01, DP-07, DP-09, DP-14, DP-15, DP-18, DP-24, DP-26, DP-30, DP-32, DP-38, DP-42, DP-43, DP-50, DP-51, DP-52, DP-58)

Only these roles, names and ids are public. Names never change with state: state lives in `aria-pressed`, `aria-checked`, `disabled` or `data-` attributes.

| Where | Role and accessible name | Visible copy and notes |
|---|---|---|
| Every page | `navigation "Main"` with links `Matches`, `Teams`, `Tournaments` | `button "Menu"` opens it on narrow screens |
| Every page | `status` `#announcer` (polite), `alert` `#alert` (assertive) | Visually hidden |
| Landing | links `Start scoring →`, `Follow a match`, `Tournaments`, `Careers` | `Start scoring →` goes to `/matches` (or `/signin` when signed out); `Careers` goes to `/players` |
| Follow | `textbox "Viewer code"`, `button "Follow"` | |
| Sign up | `textbox "Email"`, `textbox "Password"`, `textbox "Display name"`, `button "Create account"` | |
| Sign in | `textbox "Email"`, `textbox "Password"`, `button "Sign in"` | Signed-in pages show `button "Sign out"` in the top bar |
| New team | `textbox "Team name"`, `textbox "Player full name"`, `textbox "Player short name"`, `button "Add player"`, `button "Create team"` | The short name fills itself with the last word of the full name and stays editable |
| Team (organiser) | file input `Team logo`, `button "Upload logo"` | |
| New tournament | `textbox "Tournament name"`, `spinbutton "Overs per side"`, `spinbutton "Players per side"`, `checkbox "Super over"`, `textbox "Group name"`, a `checkbox` per team named after the team, `button "Add group"`, `button "Create tournament"` | |
| New match | `combobox "Home team"`, `combobox "Away team"`, `combobox "Tournament"` (first option `No tournament`), `spinbutton "Overs per side"`, `spinbutton "Players per side"`, `checkbox "Super over"`, `combobox "Batting first"`, a `checkbox` per player named `<team>: <full name>` (ticked players form the XI in team order), `button "Create match"` | Picking a tournament fixes overs, players per side and super over to the tournament's values |
| Match (organiser) | `switch "Viewer link"`, `textbox "Scorer email"`, `button "Send invitation"`, links `Score this match`, `Scorecard` | `#viewer-url` holds the address |
| Scoring | `group "Scoring pad"` with buttons `0` `1` `2` `3` `4` `5` `6` `Wide` `No-ball` `Bye` `Leg bye` `Wicket` `Undo`, in that order | `Wide`, `No-ball`, `Bye`, `Leg bye` carry `aria-pressed` |
| Scoring | `button "Retire batter"` | Outside the pad group |
| Scoring | `button "Start first innings"`, `button "Start second innings"`, `button "Start super over"` | Each shown only when that innings can start; each opens Start innings |
| Scoring | `button "Change delivery <seq>"` on each delivery item | |
| Scoring | `button "Take the pen"` | Only while nobody holds the pen and this page lacks it |
| Dialog | `dialog "Wicket"`: `radiogroup "How out"` with radios `Bowled`, `Caught`, `LBW`, `Stumped`, `Hit wicket`, `Run out`; `combobox "Fielder"`; `radiogroup "Batter out"`; `combobox "Runs completed"`; `combobox "New batter"`; `button "Record wicket"` | Field presence is described in Interactions |
| Dialog | `dialog "Next bowler"`: `combobox "Bowler"`, `button "Start over"` | Options are the fielding XI's short names. Each option carries `data-barred` (`none`, `consecutive`, `limit`, `super-over`) from the server's state |
| Dialog | `dialog "Retire batter"`: `radiogroup "Batter"`, `combobox "New batter"`, `button "Retire"` | |
| Dialog | `dialog "Start innings"`: `combobox "Striker"`, `combobox "Non-striker"`, `combobox "Bowler"`, `button "Start innings"` | |
| Dialog | `dialog "Change delivery <seq>"`: `group "Change pad"` with buttons `0`-`6`, `Wide`, `No-ball`, `Bye`, `Leg bye`; `#change-preview` with text `New: <runs part>`; `button "Save change"` | `<runs part>` uses the commentary wording |
| Invitation | `button "Accept invitation"` | `h1` `Score <home> v <away>` |
| Scorecard | link `Scorecard` on viewer and match pages; tables captioned `Batting`, `Bowling` | |
| Team history | `list "Matches"`; each item holds a link `Scorecard` when the match has a ball log | |

Each pad button also shows its key letter or digit in a hint that assistive technology does not read, so its accessible name stays exactly as listed.

### Interactions (DP-01, DP-07, DP-09, DP-14, DP-15, DP-18, DP-22, DP-24, DP-26, DP-42, DP-43)

**Scoring keys.** The keys below work on the scoring page whenever focus is not in a text field, select or open dialog. They work the same whichever button of the page has focus, and letters are case-insensitive.

| Key | Pad button | Effect |
|---|---|---|
| `0`-`6` | `0`-`6` | Records a delivery with that many runs off the bat, or completes the armed extra with that number |
| `D` | `Wide` | Arms a wide; the next digit is the runs the batters ran |
| `N` | `No-ball` | Arms a no-ball; the next digit is the runs off the bat |
| `B` | `Bye` | Arms byes; the next digit (1-6) is the byes |
| `L` | `Leg bye` | Arms leg byes; the next digit (1-6) is the leg byes |
| `W` | `Wicket` | Opens the Wicket dialog for this delivery, keeping any armed extra |
| `U` | `Undo` | Undoes the last scoring event (Business rules, Corrections) |
| `R` | `Retire batter` | Opens the Retire batter dialog |
| `Escape` | | Disarms an armed extra; or closes the open dialog |

- An armed extra shows `aria-pressed="true"`, a lime outline and the text `armed` on its key, so colour is never the only signal. Pressing its key again, or Escape, disarms it. Arming another extra replaces it. After a delivery records, every extra disarms.
- Each digit sends one delivery to the server. Keys pressed while a delivery is still being saved are queued and sent in order once it saves, each against the then-current sequence. Nothing on screen changes for a delivery until the server has answered.
- `B 0` or `L 0` is refused by the page with the byes copy from Feedback states, and nothing is sent.
- While the server's state says a bowler is needed, a digit, extra key or `W` is refused with the bowler-first copy, and the Next bowler dialog opens.

**Dialogs.** Every dialog is a modal `dialog` named by its heading. Tab and Shift+Tab wrap inside it and never reach the page behind. Escape closes it without saving. When it closes, focus returns to the control that was focused before it opened, or to the pad's `0` button if that was the page body. Enter on a dialog's button submits it.

- **Wicket**: focus starts on the first enabled radio of `How out`. Arrow keys move and select within a radio group, and Tab moves between fields. Kinds that the server's rules forbid on this delivery are `disabled` (Business rules, Wickets). On a free hit, the dialog shows the free-hit wicket copy from Feedback states. `Fielder` (the fielding XI by short name) shows for Caught, Stumped and Run out; picking the bowler for Caught gives the caught-and-bowled text. `Batter out` (both batters' short names) and `Runs completed` (0-3) show for Run out only. `New batter` lists the players yet to bat in XI order, then any retired-hurt players as `<short> (retired hurt)`. It is absent when this wicket would end the innings. `Record wicket` sends the delivery with the wicket.
- **Next bowler**: opens by itself whenever the server's state says the next over needs a bowler, with focus on `Bowler`. `Start over` sends the choice. A refusal shows inside the dialog under the select and in `#alert`, and the dialog stays open.
- **Retire batter**: focus starts on the first radio of `Batter`. `Retire` sends it.
- **Start innings**: opened by `Start first innings`, `Start second innings` or `Start super over`. Focus starts on `Striker`. `Start innings` sends it.
- **Change delivery `<seq>`**: opened by its button. Focus starts on the `Change pad` button matching the delivery's current runs. Inside it the same keys `0`-`6`, `D`, `N`, `B`, `L` pick the choice instead of recording, and `#change-preview` shows it. `Save change` sends it. A refusal shows in the dialog and in `#alert`, and nothing changes.

**Touch.** Every pad key and dialog control works by a single tap. The pad works one-handed in the lower part of a phone screen. Nothing needs a drag, hover or long press.

**Read-only scoring page.** When this page does not hold the pen (Business rules, The pen), every pad button, `Retire batter` and every `Change delivery <seq>` button are `disabled`. Scoring keys do nothing. The page still updates live with no delay. Pressing `Take the pen` asks for the pen. If the pen is granted, the controls enable and the notice clears. If someone else got it first, the notice names them.

**Viewer page.** No controls besides `Scorecard`. Scrolling moves the commentary under the pinned scoreboard. A viewer can open `/live/<code>` straight from the link or through `/follow`.

**Innings and result.** At a break, the pad is disabled except `Undo`, and the start button for the next innings shows. After the result, the pad is disabled except `Undo`.

### Visual design (DP-59)

The direction is **pinned-poster**: the live total is a poster title that stays pinned while panels pass beneath it, and then it releases into ordinary scorecard sections.

- **Type.** Display face Dela Gothic One, a blocky gothic, for the total, the split name, team and player names in lists, and empty-state lines. Body face DM Sans for everything else, with tabular figures in every table and score line. Each heading step is a third larger than the one below it. The scoring and viewer total is set at about an eighth of the screen width on a laptop and about a sixth on a phone, like numerals hung on a field scoreboard. Overs and run rates sit beneath it at body size. List names are about twice body size, with facts at body size beside them.
- **Palette roles.** The ground is a near-black with a violet cast. Panels and the pad sit on a slightly lighter deep-indigo surface. Text is a very pale lavender-white ink. Secondary facts are a greyed lavender. The one accent is an acid lime, used only on the scorer's primary actions (`Record wicket`, `Start over`, `Start innings`, `Save change`, `Retire`), on an armed modifier's outline, and on scoreboard digits that just changed (they stay lime until the next state arrives). Text on lime uses the ground colour. A deep electric-violet band, with white text, is kept for the result, the points-table slab on the landing page, and error and outage states. Every text and control meets WCAG 2.2 AA contrast.
- **Shape and density.** Square corners everywhere, with no rounding. Comfortable density: rows and keys have generous padding, and every tappable control is at least 44 by 44 pixels (pad keys 48 on phones). Run keys are ink on surface in a four-by-four grid.
- **Hero (landing).** The product name splits to opposite corners. `OVER` is pinned top-left and `CALL` bottom-right, very large (about a tenth of the screen width, never past the size of a short headline on wide screens). Both are white and drawn so they show the inverse of whatever scrolls beneath them. On the first screen, a pale panel across the left three-quarters holds the sentence `Score every ball. Everyone sees it land.` a little above the middle, with the single link `Start scoring →`. The right quarter holds a full-height drawn picture of a mown pitch strip seen from above, with crease lines and a ball's trail, made in the page as vector art. The three links `Follow a match`, `Tournaments` and `Careers` are stacked on the panel's right edge. Below, three to four screens of panels pass between the corners: a close-up of the scoring pad, one over's pitch map, a points-table slab on the violet band, and a wagon wheel of shots. All of them are drawn vector art with no images. Then the pin releases. On a phone the corner words shrink to about a sixth of the width with narrow margins, and the stacked links collapse into `Menu`.
- **Working screens.** The live match page reuses the poster idea. The commentary is grouped visually into one flat panel per over. Each over-end item heads its panel with a small drawn pitch map of that over's deliveries (one mark per delivery, larger for more runs, hidden from assistive technology) and one caption line in DP Sans at body size. Scorecard tables have no rules. Rows alternate between ground and surface bands. Lists use big Dela Gothic names. Forms are a single column about 34 characters wide. An empty state is one Dela Gothic line with one text link. Error, outage and not-found states fill the violet band with white text.
- Nothing else decorates the pages: no paper or cream grounds, no thin divider rules, no monospace labels, no index numbering, no frosted glass, no gradients or shadows beyond the flat bands.

### Motion and effects (DP-35, DP-36, DP-37)

**Ball tick (the signature).** The scorer and every viewer see exactly what one delivery changed. When a page shows a new state, in this order:

1. The new chip joins `#this-over` and the new item tops `#commentary`. Both appear at once, with no animation.
2. Each `.digit` element of the runs whose value changed rolls vertically into place, the old figure leaving and the new one arriving, in about a quarter of a second, starting quickly and settling softly. Then the wickets digit rolls, if it changed, `TICK_STAGGER_MS` later. Then each changed overs digit, another `TICK_STAGGER_MS` later. A wide or no-ball never changes the overs digits, so they stay still.
3. The run-rate and chase lines never animate. Their text is already final.

Each roll is one Web Animation on that digit element, with `id` `ball-tick`, duration `TICK_MS`, and a start delay of 0 for runs digits, `TICK_STAGGER_MS` for the wickets digit and twice `TICK_STAGGER_MS` for overs digits. While a digit's animation runs, the digit has `data-ticking="true"`. Unchanged digits never animate: 20/0 to 21/0 rolls exactly one runs digit, and 99/0 to 103/0 rolls every runs digit. A new digit column rolls in, and a removed column simply goes. A change or undo rolls the affected digits back the other way, downward instead of upward. Nothing moves before the page has the server's new state. The `.digit` text content is the final value from the first frame.

**Other motion.** Dialogs and notices appear and disappear at once. Buttons darken slightly on press for as long as they are held. There are no other animations on scoring, viewer and tournament pages: no loops, pulses, skeleton shimmer or decorative motion. The landing page's pinned name and passing panels move only with the user's scroll and stop when scrolling stops. Scrolling back up reverses them step by step.

**Reduced motion.** With the browser's reduced-motion preference set, no `ball-tick` animation is ever created. Digits change in place at once, the lime marking of changed digits stays, and the polite announcement is the same. The landing page shows its panels as a plain stack, with the corner words fixed and no scroll-linked movement.

### Feedback states (DP-04, DP-14, DP-15, DP-16, DP-20, DP-21, DP-22, DP-23, DP-26, DP-28, DP-30, DP-32, DP-38, DP-39, DP-40, DP-42, DP-43, DP-47, DP-50, DP-52, DP-53, DP-54, DP-55)

**Live regions.** Every page (including the match, team, invitation, sign-in and sign-up pages) has one polite region `#announcer` (`role="status"`, `aria-live="polite"`) and one assertive region `#alert` (`role="alert"`). An announcement replaces the region's whole text. To announce the same sentence twice, the page empties the region and sets the text on the next animation frame. Refusals and failures go to `#alert`. Everything else goes to `#announcer`. On viewer pages, announcements happen when the page shows the state, after the delay in Live viewer delay.

**Async actions.**

| Action | Pending | Success | Field error or refusal | Outage |
|---|---|---|---|---|
| Record a delivery | Pad has `aria-busy="true"`; later keys are queued | The announcement grammar below | Refusal copy in `#alert` (and in the dialog if one is open) | Network failure: the not-saved copy in `#alert` |
| Change a delivery | `Save change` disabled | The changed copy in `#announcer`; dialog closes | The change refusal copy, in the dialog and `#alert` | As above |
| Undo | `Undo` disabled | The undid copy in `#announcer` | The nothing-to-undo copy in `#alert` | As above |
| Start an over or innings | Dialog button disabled | Dialog closes; the scoreboard shows the new state | Bowler refusals, in the dialog and `#alert` | As above |
| Send invitation | `Send invitation` disabled | The sent copy under the form and in `#announcer` | Field error under the textbox | The mail outage copy in `#alert` |
| Upload logo | `Upload logo` disabled; `Uploading logo` shown under it | The image appears; the uploaded copy in `#announcer` | Type or size copy under the file input | The storage outage copy, shown under the file input on the violet band and in `#alert` |
| Sign in or sign up | Button disabled | Lands on `/matches` | Sign-in failure or field errors under each field | |
| Points table change | | The table re-sorts in place; the table copy in `#announcer` | | |

A stale delivery (409 `STALE_DELIVERY`) shows the stale copy in `#alert`, and the page fetches the current state.

**Messages.** This is the single home of every published sentence. Placeholders: `<team>`, `<chasing>`, `<home>`, `<away>` are team names. `<short>` is a player's short name. `<bowler>` and `<striker>` are short names. `<runs>`, `<wickets>`, `<target>`, `<balls>`, `<need>` are whole numbers. `<overs>` uses the overs notation of Laws of the game. `<rate>` has two decimals. `<seq>` is a delivery's sequence number. `<n>` is an over or super-over number. `<kind>` is a wicket's data value. `<holder>` is a display name. `<email>` is the address as entered, trimmed. `<hours>` is `INVITE_TTL_HOURS`. `<max bytes>` is `LOGO_MAX_BYTES` written with commas between thousands (`1,048,576`). `<date>` is `D Mon YYYY` (`4 Nov 2026`).

| Trigger | Exact copy |
|---|---|
| Delivery commentary line | `<label> <bowler> to <striker>, <runs part>`; a wicket adds `, OUT! <dismissal>` (when the runs part is `no run`, the runs part and its comma are left out: `<label> <bowler> to <striker>, OUT! <dismissal>`); a free-hit delivery ends with ` (free hit)` |
| Runs part, off the bat 0-6 | `no run`, `1 run`, `2 runs`, `3 runs`, `FOUR`, `5 runs`, `SIX` |
| Runs part, wide | `1 wide`, `2 wides`, ... counting the wide's total runs (1 + runs run) |
| Runs part, no-ball | `no-ball, ` followed by the off-the-bat wording (`no-ball, no run`, `no-ball, FOUR`) |
| Runs part, byes and leg byes | `1 bye`, `2 byes`, ...; `1 leg bye`, `3 leg byes`, ... |
| Over end line | `End of over <n>: <runs in that over> runs. <team> <runs>/<wickets>` (`1 run` when 1) |
| Retirement line | `<short> retired hurt` |
| Delivery announcement | `<line>. <team> <runs>/<wickets>.`, then ` End of over <n>: <runs in that over> runs.` when it ended an over, then ` <break text>` when it ended an innings, or ` <result>.` when it ended the match |
| Retirement announcement | `<short> retired hurt. <team> <runs>/<wickets>.` |
| Innings break heading | `Innings break` |
| Break text (after innings 1, or after the first half of a super over) | `<team> <total> (<overs> ov). <chasing> need <target> runs from <balls> balls.` where `<total>` is `<runs>/<wickets>` or `<runs> all out` (`1 run`, `1 ball` when 1) |
| Super-over break heading | `Super over <n>` |
| Super-over start text | `Scores level. <team> bat first in super over <n>.` |
| Chase line | `Need <need> from <balls> balls. Required rate <rate>` (`1 ball` when 1) |
| Result, chasing side wins | `<team> won by <wickets> wickets (<balls> balls left)` (`1 wicket`, `1 ball left`; the parenthesis is left out when 0 balls are left) |
| Result, defending side wins | `<team> won by <runs> runs` (`1 run`) |
| Result, super over decides | `<team> won the super over` |
| Result, level without super overs | `Match tied` |
| Result, level after the last super over | `Match tied after <n> super overs` |
| Byes key with 0 | `Byes need at least 1 run.` |
| Scoring key while a bowler is needed | `Choose the next bowler first.` |
| Delivery, over or retirement in `ready`, before the first innings starts | `Start the innings first.` |
| Delivery, over or retirement at `innings_break` or `super_over_break` | `This innings is over.` |
| Delivery after the result | `This match is over.` |
| Over started while one is in progress | `This over has already started.` |
| Innings started while one is in progress | `This innings has already started.` |
| Wicket kind on a free hit | `Free hit: only a run out can dismiss a batter.` |
| Wicket kind not allowed on this delivery | `A <kind> cannot happen on this delivery.` |
| Bowler bowled the previous over | `<short> bowled the last over.` |
| Bowler at the over limit | `<short> has bowled <limit> of <limit> overs.` |
| Bowler of the previous super over | `<short> bowled in the last super over.` |
| New batter missing or not available | `Choose a batter who is waiting to bat.` |
| Retire with nobody left to come in | `No batter is left to come in.` |
| Change that moves the overs | `That change would move the overs. Undo back to this delivery instead.` |
| Change that breaks a later wicket | `That change would make delivery <seq> a free hit, and its wicket (<kind>) cannot happen on a free hit.` |
| Change that breaks this delivery's wicket | `That change would make its wicket (<kind>) impossible.` |
| Change saved (scorer pages) | `Delivery <seq> changed. Innings recalculated.` |
| Undo (scorer pages) | `Undid delivery <seq>.` |
| Undo of a retirement | `Undid the retirement of <short>.` |
| Nothing to undo | `Nothing to undo in this innings.` |
| Viewer notice and announcement, change | `The scorer changed delivery <seq>.` |
| Viewer notice and announcement, undo | `The scorer undid delivery <seq>.` |
| Stale delivery | `The score has moved on. Showing the latest.` |
| Delivery not saved (network failure) | `That ball was not saved. Check your connection and try again.` |
| Pen held by someone else | `<holder> is scoring this match. You are viewing it read-only.` |
| Pen free | `No one is scoring this match.` |
| Invitation sent | `Invitation sent to <email>.` |
| Invitation mail line | `This invitation works once and expires after <hours> hours.` |
| Invitation used | `This invitation has already been used.` |
| Invitation expired | `This invitation has expired.` |
| Invitation rate limit | `Too many invitations. Try again later.` |
| Mail outage | `The invitation could not be sent. Try again later.` |
| Logo uploading | `Uploading logo` |
| Logo uploaded | `Logo updated.` |
| Logo wrong type | `Logo must be a PNG or JPEG image.` |
| Logo too large | `Logo must be <max bytes> bytes or smaller.` |
| Storage outage | `Logo storage is unavailable. The team keeps its previous logo.` |
| Live outage, viewer pages | `Live updates are paused. Reload for the latest score.` |
| Live outage, scoring page | `Live updates are paused. Scoring still saves.` |
| Viewer link turned off | `This match is no longer shared.` |
| Points table updated | `Points table updated.` |
| Not found page | `Not found.` |
| Sign-in failure | `Email or password is wrong.` |
| Sign-in required page | `Sign in to continue.` |
| Field errors summary | `Check the highlighted fields.` |
| Email field | `Enter a valid email address.` |
| Email taken (sign up) | `An account with this email already exists.` |
| Password field | `Password must be at least 10 characters.` |
| Display name, team name, tournament name, player name | `Enter a name.` |
| Short name clash | `Short names must be unique within a team.` |
| Overs field | `Overs must be a whole number from 1 to 50.` |
| Players per side field | `Players per side must be a whole number from 2 to 11.` |
| XI field | `Pick exactly <players per side> players from each team.` |
| Teams not in one group | `Both teams must be in the same group of this tournament.` |
| Runs field | `Runs must be a whole number from 0 to 6.` |
| Empty lists | `No fixtures yet` (link `New match`), `No teams yet` (link `New team`), `No tournaments yet` (link `New tournament`), `No players yet` (link `New team`) |
| Unexpected server error | `Something went wrong. Try again.` |

## Backend

### API (DP-02, DP-10, DP-16, DP-18, DP-20, DP-22, DP-25, DP-32, DP-34, DP-38, DP-39, DP-40, DP-41, DP-44, DP-48, DP-49, DP-50, DP-51, DP-52, DP-57)

All bodies are JSON (`application/json; charset=utf-8`) except the logo upload, which is `multipart/form-data`. Every error has one shape: `{"error": {"code": "<CODE>", "message": "<copy from Messages>"}}`. The error object carries at most one extra key. `fields` (an object of field name to message) comes only with `VALIDATION`. `seq` (the current last seq) comes only with `STALE_DELIVERY`. `holder` (display name or null) comes only with `PEN_HELD`. The app never answers 403.

**Error precedence, for the whole API.** Checks run in this order:

1. Body checks: 413 `PAYLOAD_TOO_LARGE`, 415 `UNSUPPORTED_MEDIA_TYPE`, 400 `BAD_JSON`.
2. 401 `SIGN_IN_REQUIRED`: no valid session on a signed-in route.
3. 404 `NOT_FOUND`: an unknown id, or anything this user may not open, including another organiser's private records, a delivery seq that is not in the current innings, and organiser-only actions attempted by a scorer.
4. 409 `PEN_HELD`.
5. 409 `STALE_DELIVERY`.
6. 409 state errors.
7. 422 rule and validation errors.
8. 429 `RATE_LIMITED`.
9. 503 provider errors.

An unexpected failure answers 500 `INTERNAL` with the unexpected-error copy. Endpoint rows below list only their own codes.

**Sessions.** Sign-in and sign-up set the cookie `oc_session` (HttpOnly, SameSite=Lax, Path=/). Signed-in routes read it.

| Method and path | Request | Success | Own errors |
|---|---|---|---|
| `POST /api/auth/signup` | `{"email","password","display_name"}` | 201 `{"user":{"id","email","display_name"}}` and cookie | 422 `VALIDATION` (`email`, `password`, `display_name`) |
| `POST /api/auth/signin` | `{"email","password"}` | 200 `{"user":{...}}` and cookie | 401 `SIGN_IN_FAILED`, with an identical body for an unknown email and a wrong password |
| `POST /api/auth/signout` | | 204 and the cookie cleared | |
| `GET /api/me` | | 200 `{"user":{...}}` | |
| `GET /api/teams` | | 200 `{"teams":[{"id","name","logo_url"}]}` | |
| `POST /api/teams` | `{"name","players":[{"name","short_name"}]}` (`short_name` optional: last word of `name`) | 201 with the same body as `GET /api/teams/:id` for the new team (`logo_url` null, `matches` empty) | 422 `VALIDATION` (`name`, `players[<i>].name`, `players[<i>].short_name`) |
| `GET /api/teams/:id` | | 200 `{"id","name","logo_url","players":[{"id","name","short_name"}],"matches":[{"id","line","scorecard_url"}]}` | |
| `POST /api/teams/:id/players` | `{"name","short_name"}` | 201 `{"id","name","short_name"}` | 422 `VALIDATION` |
| `POST /api/teams/:id/logo` (organiser) | multipart field `logo` | 201 `{"logo_url"}` once storage confirms | 422 `VALIDATION` (`logo`), 503 `STORAGE_UNAVAILABLE` |
| `GET /api/teams/:id/logo` | | 200 the confirmed image with its type | 404 when there is none |
| `GET /api/players` | | 200 `{"players":[{"id","name","short_name","team":{"id","name"}}]}` | |
| `GET /api/players/:id` | | 200 career (Teams and careers) | |
| `GET /api/tournaments` | | 200 `{"tournaments":[{"id","name"}]}` | |
| `POST /api/tournaments` | `{"name","overs","players_per_side","super_over","groups":[{"name","teams":["<team id>"]}]}` | 201 with the same body as `GET /api/tournaments/:id` for the new tournament | 422 `VALIDATION` |
| `GET /api/tournaments/:id` | | 200 `{"id","name","overs","players_per_side","super_over","groups":[{"name","table":[{"team":{"id","name"},"p","w","l","t","pts","nrr"}],"matches":[{"id","home","away","status","result"}]}]}` | |
| `GET /api/matches` | | 200 `{"matches":[{"id","title","status","played_on","result"}]}` | |
| `POST /api/matches` | `{"home","away","overs","players_per_side","super_over","batting_first","tournament","xi":{"<team id>":["<player id>"]}}` | 201 with the same body as `GET /api/matches/:id` for the new match (which includes `id` and `viewer_code`) | 422 `VALIDATION` (`overs`, `players_per_side`, `xi`, `tournament`) |
| `GET /api/matches/:id` | | 200 `{"id","title","status","home","away","overs","players_per_side","super_over","tournament","viewer_link","viewer_code","scorers":[{"display_name"}]}` | |
| `PATCH /api/matches/:id/viewer-link` (organiser) | `{"on": true or false}` | 200 `{"viewer_link","viewer_code"}` | |
| `POST /api/matches/:id/invitations` (organiser) | `{"email"}` | 202 `{"message":"<sent copy>"}`, the same whether or not the email has an account | 422 `VALIDATION` (`email`), 429 `RATE_LIMITED`, 503 `MAIL_UNAVAILABLE` |
| `GET /api/invitations/:token` | | 200 `{"match":{"id","title"},"status":"open" or "used" or "expired"}` | |
| `POST /api/invitations/:token/accept` | | 200 `{"match_id"}` | 409 `INVITATION_USED`, 409 `INVITATION_EXPIRED` |
| `GET /api/matches/:id/state` | | 200 state | |
| `GET /api/matches/:id/scorecard` | | 200 scorecard | |
| `POST /api/matches/:id/innings` | `{"striker","non_striker","bowler"}` | 201 state | 409 `INNINGS_IN_PROGRESS`, `MATCH_OVER`; 422 `BOWLER_BARRED`, `VALIDATION` |
| `POST /api/matches/:id/overs` | `{"bowler"}` | 201 state | 409 `NEEDS_INNINGS`, `OVER_IN_PROGRESS`, `INNINGS_OVER`, `MATCH_OVER`; 422 `BOWLER_CONSECUTIVE`, `BOWLER_LIMIT`, `BOWLER_BARRED` |
| `POST /api/matches/:id/deliveries` | `{"expected_seq","extra":"none" or "wide" or "no-ball" or "bye" or "leg-bye","runs","wicket":null or {"kind","fielder","batter_out":"striker" or "non-striker","new_batter"}}` | 201 state | 409 `NEEDS_INNINGS`, `NEEDS_BOWLER`, `INNINGS_OVER`, `MATCH_OVER`; 422 `WICKET_NOT_ALLOWED`, `BYES_NEED_RUNS`, `NEW_BATTER_INVALID`, `VALIDATION` |
| `PUT /api/matches/:id/deliveries/:seq` | `{"extra","runs"}` | 200 state | 422 `CHANGE_MOVES_OVERS`, `CHANGE_BREAKS_WICKET`, `BYES_NEED_RUNS`, `VALIDATION` |
| `DELETE /api/matches/:id/deliveries/last` | | 200 state | 409 `NOTHING_TO_UNDO` |
| `POST /api/matches/:id/retirements` | `{"batter","new_batter"}` | 201 state | 409 `NEEDS_INNINGS`, `INNINGS_OVER`, `MATCH_OVER`; 422 `NEW_BATTER_INVALID`, `NO_BATTER_LEFT` |
| `GET /api/live/:code/state` | | 200 viewer state | 404 when the code is unknown or the link is off |
| `GET /api/live/:code/scorecard` | | 200 viewer scorecard | 404 as above |
| `GET /api/live/:code/teams/:id/logo` | | 200 the team's confirmed logo | 404 |
| any other method on `/api/live/...` | | | 404 `NOT_FOUND` |
| `GET /api/config` | | 200 `{"live_delay_ms","tick_ms","tick_stagger_ms"}` from the environment | |
| `GET /api/health` | | 200 `{"status":"ok"}` | |
| `GET /api/services` | | 200 `{"postgres":"up" or "down","valkey":...,"minio":...,"mailpit":...}` | |

**Scoring calls and the pen.** The six scoring calls (innings, overs, deliveries POST, PUT and DELETE, retirements) must carry the header `X-Pen: <pen id>`, naming the pen this page holds (Business rules, The pen). A missing or different pen answers 409 `PEN_HELD`, with `holder` set to the current holder's display name, or null when nobody holds it. `expected_seq` is the seq the caller expects the new delivery to get: the current last seq plus 1, where the first delivery of an innings is seq 1. Any other value answers 409 `STALE_DELIVERY` with the current `seq`. So a double-tapped or replayed delivery is recorded once. Of two simultaneous deliveries with the same `expected_seq`, exactly one gets 201 and the other gets 409 `STALE_DELIVERY`.

**Delivery body rules.** `runs` is 0 to 6. For a wicket other than run out, `runs` is 0. For a run out, `runs` is the runs completed, 0 to 3. With `bye` or `leg-bye`, `runs` is at least 1, otherwise 422 `BYES_NEED_RUNS`. `fielder` is required for caught, stumped and run out and comes from the fielding XI. `batter_out` is used only for a run out and defaults to `striker`. `new_batter` is required unless the wicket ends the innings.

**State.** The state body (from both state endpoints and the live channel) has exactly these keys:

- `match`: `{"id","title","status","overs","players_per_side","super_over","home","away","played_on"}`. A team is `{"id","name","logo_url"}`. `status` is one of `ready`, `innings_1`, `innings_break`, `innings_2`, `super_over_break`, `super_over`, `result`, `tied`. `title` is `<home> v <away>`.
- `innings` (the `data-innings` value, or null), `batting_team`, `bowling_team`.
- `runs`, `wickets`, `legal_balls`, `overs_text`, `scoreboard`.
- `batters`: `[{"player","short_name","runs","balls","on_strike","text"}]`.
- `bowler`: `{"player","short_name","figures","text"}` or null.
- `next_bowler_needed`, `barred_bowlers`: `[{"player","reason":"consecutive" or "limit" or "super-over"}]`.
- `free_hit`, `run_rate` (the `#run-rate` text), `chase`: `{"target","need","balls_left","required_rate","text"}` or null.
- `this_over`: an array of chip strings.
- `commentary`: newest first. Delivery items are `{"kind":"delivery","seq","over","ball","label","runs","bat_runs","extra","extra_runs","wicket","free_hit","striker","bowler","line"}`. Over-end items are `{"kind":"over-end","over","line"}`. Retirement items are `{"kind":"retirement","player","line"}`.
- `yet_to_bat`: `[{"player","short_name","retired_hurt"}]`.
- `innings_break`: `{"heading","text"}` or null.
- `result`: the result text or null.
- `last_seq`.

`GET /api/matches/:id/state` adds only `viewer_link` and `viewer_code`. The viewer state has exactly the keys above and nothing else. No response that viewers receive, and no live message to a viewer, carries an email address, an account id, a scorer's name, or anything beyond these keys. Player ids are not account ids.

**Scorecard body.**

- `{"match":<the state's match object, exactly the keys listed under State>,"innings":[{"innings","heading","batting":[{"player","name","dismissal","runs","balls","fours","sixes","strike_rate"}],"extras":{"b","lb","w","nb","total","text"},"total_text","did_not_bat":["<short>"],"fall_of_wickets","bowling":[{"player","name","overs","maidens","runs","wickets","wides","no_balls","economy"}]}],"result"}`.
- Rates are strings, formatted as in Business rules.
- The viewer scorecard has the same keys.

**Live connection.** One WebSocket at `/ws` on the same port, using the session cookie when present. The client sends one of:

- `{"type":"watch","code":"<viewer code>"}` (anyone)
- `{"type":"watch","match":"<id>"}` (organiser or scorer, read-only)
- `{"type":"watch","tournament":"<id>"}`
- `{"type":"score","match":"<id>"}` (asks for the pen, then watches)
- `{"type":"take-pen","match":"<id>"}`

The server sends:

- `{"type":"state","event":{"kind":"delivery" or "change" or "undo" or "retirement" or "innings" or "over","seq"},"state":{...}}` (the viewer state shape on code watches)
- `{"type":"pen","pen":"<pen id>" or null,"holder":"<display name>" or null}` (only to scoring watchers)
- `{"type":"table","tournament":"<id>","groups":[...]}` (the tournament groups shape)
- `{"type":"link-off"}`
- `{"type":"live","status":"paused"}`

A watch on an unknown, private or switched-off target gets `{"type":"error","code":"NOT_FOUND"}`, and the socket is closed.

### Business rules (DP-02, DP-06, DP-10, DP-11, DP-12, DP-13, DP-16, DP-17, DP-19, DP-20, DP-23, DP-24, DP-25, DP-27, DP-28, DP-29, DP-31, DP-33, DP-39, DP-40, DP-41, DP-43, DP-45, DP-46, DP-47, DP-48, DP-49, DP-60)

The server decides every rule below in one laws engine. After every delivery, change, undo or retirement, it replays the innings' whole ball log from the start. The browser never computes a score, strike, free hit, over end, innings end, target, barred bowler or result. Every page shows the state the server sends, and the device clock may be wrong.

#### Laws of the game

A match has `overs` per side (1 to 50), `players_per_side` (2 to 11), an XI per team chosen at creation in batting order (exactly `players_per_side` players of that team), the team batting first, and `super_over` on or off. **Overs notation** is `<completed overs>.<legal balls of the over in progress>`, with `.0` left out (`7.4`, `20`, `0.3`, `0`).

**Deliveries.**

| Delivery | Legal (counts toward the over) | Team runs | Striker's runs | Ball faced by striker | Charged to bowler | Extras |
|---|---|---|---|---|---|---|
| Runs `n` (0-6) off the bat | yes | n | n | yes | n | none |
| Wide + `n` run (0-6) | no | 1 + n | 0 | no | 1 + n | w: 1 + n |
| No-ball + `n` off the bat (0-6) | no | 1 + n | n | yes | 1 + n | nb: 1 |
| Bye `n` (1-6) | yes | n | 0 | yes | 0 | b: n |
| Leg bye `n` (1-6) | yes | n | 0 | yes | 0 | lb: n |

- Six legal balls make an over. Wides and no-balls never count toward it.
- A batter's 4s and 6s count runs of exactly 4 or 6 off the bat, on run or no-ball deliveries.
- A maiden is a completed over of 6 legal balls by one bowler in which that bowler was charged 0 runs (byes and leg byes allowed).
- Bowler figures are `<overs>-<maidens>-<runs charged>-<wickets>` (for example `1-0-17-0`, `0.3-0-1-2`).
- Run rate is runs × 6 / legal balls, to 2 decimals; it is `-` with 0 legal balls. The `#run-rate` text is `Run rate <value>`.
- **Rounding.** Every two-decimal value (run rate, required rate, strike rate, economy, average) rounds half away from zero: 0.125 gives `0.13`, 66.666 gives `66.67`.

**Strike.**

- After a delivery, if the runs the batters ran (the `n` above; a 4 or 6 off the bat is even) is odd, the batters swap ends. This applies to byes, leg byes and wides as well.
- After the 6th legal ball of an over, the batters swap ends again, after any swap for runs.
- After a wicket, the new batter is placed first (Wickets below), and then the end-of-over swap applies if that ball ended the over.

**Wickets.**

| Kind (dialog label, data value) | Allowed on | Credited to bowler | Who is out | Dismissal text |
|---|---|---|---|---|
| Bowled, `bowled` | run delivery | yes | striker | `b <bowler>` |
| Caught, `caught` | run delivery | yes | striker | `c <fielder> b <bowler>`; when the bowler catches it, `c & b <bowler>` |
| LBW, `lbw` | run delivery | yes | striker | `lbw b <bowler>` |
| Stumped, `stumped` | run delivery or wide | yes | striker | `st <fielder> b <bowler>` |
| Hit wicket, `hit-wicket` | run delivery | yes | striker | `hit wicket b <bowler>` |
| Run out, `run-out` | any delivery | no | striker or non-striker | `run out (<fielder>)` |
| Retired hurt | between deliveries | no | chosen batter | `retired hurt` |
| Not dismissed | | | | `not out` |

- Names use short names in dismissal text, commentary, the batters block and the bowler line. Batting and bowling table rows use full names.
- On a no-ball, bye or leg bye, only Run out is allowed. On a wide, only Stumped and Run out. On a free hit, only Run out. Any other kind is refused with 422 `WICKET_NOT_ALLOWED`: the free-hit copy on a free hit, the not-allowed copy otherwise.
- Bowled, caught, LBW, stumped, hit wicket: the new batter comes in at the striker's end, on strike, whatever the batters ran.
- Run out: the batters first swap ends for the completed runs (when odd). Then the new batter takes the end of the batter who is out.
- **Fall of wickets.** `Fall of wickets: <w>-<team runs> (<short>, <label>), ...`, where `<w>` is the wicket number, `<team runs>` is the total at that wicket including that delivery, and `<label>` is the delivery's over label. With no wicket it reads `Fall of wickets: none`. Retired hurt is not a wicket and is not listed.
- **All out.** The innings is all out when a wicket falls and no batter is left to come in. Players yet to bat and retired-hurt players count as left. With `players_per_side` p, at most p - 1 wickets fall.

**Free hit.** The delivery after a no-ball is a free hit. If the free-hit delivery is a wide, the free hit carries to the next delivery. If it is a no-ball, the next delivery is a free hit anyway. A legal delivery uses the free hit up. The state's `free_hit` is true while the next delivery is a free hit.

**Bowlers.**

- Each over is bowled by one bowler from the fielding XI, chosen before its first delivery: in Start innings for the first over, and through `POST /overs` after that.
- Consecutive overs: a bowler who bowled the previous over is refused with 422 `BOWLER_CONSECUTIVE` and the last-over copy.
- **Over limit.** `overs` ÷ 5, rounded up (2 overs: 1; 5: 1; 6: 2; 10: 2; 20: 4; 50: 10). A bowler who has completed that many overs is refused with 422 `BOWLER_LIMIT` and the limit copy.
- The consecutive check comes before the limit check.

**Retired hurt.**

- Between deliveries, with an innings in progress, the scorer retires either batter. It is neither a wicket nor a delivery. The new batter takes the retired batter's end.
- A retired-hurt batter can come back later, offered after the players yet to bat, and continues their row.
- If they never come back, their row reads `retired hurt` and counts as not out.
- With nobody left to come in, a retirement is refused with 422 `NO_BATTER_LEFT`.
- A missing or unavailable `new_batter`, on a wicket or a retirement, is refused with 422 `NEW_BATTER_INVALID`.

**Delivery items.**

| Attribute | Meaning |
|---|---|
| `data-kind` | `delivery`, `over-end` or `retirement` |
| `data-seq` | 1, 2, ... per innings |
| `data-over` | 1-based over number |
| `data-ball` | The legal ball number (1-6) the delivery belongs to; a wide or no-ball has the number of the next legal ball |
| `data-label` | The over label: `<completed overs before it>.<data-ball>`. The 3rd legal ball of the first over is `0.3`, and a wide bowled before it is also `0.3` |
| `data-runs` | Team runs from it |
| `data-bat-runs` | Runs off the bat |
| `data-extra` | `none`, `wide`, `no-ball`, `bye`, `leg-bye` |
| `data-extra-runs` | Extras from it |
| `data-wicket` | `none` or the wicket's data value |
| `data-free-hit` | `true` or `false` |
| `data-striker`, `data-bowler` | Player ids |

**This-over chips.**

- Runs: `0`-`6`.
- Wide: `<total>wd` (`1wd`, `2wd`). No-ball: `<total>nb` (`5nb`). Byes: `<n>b`. Leg byes: `<n>lb`.
- A wicket adds `W`: `W` alone when the chip would be `0`, `1W` for a run out after a single, `1wdW` for a stumping off a wide.

**End of an innings.**

- An innings ends when the over quota has been bowled, when it is all out, or (second innings) as soon as the target is reached.
- At `innings_break` and `super_over_break` (an innings has ended and the next has not started), deliveries, overs and retirements answer 409 `INNINGS_OVER` with the innings-over copy, never `NEEDS_INNINGS`.
- In `ready`, before the first innings starts, they answer 409 `NEEDS_INNINGS` with the start-the-innings copy. With a bowler needed, a delivery answers 409 `NEEDS_BOWLER` with the bowler-first copy.
- Starting an over while one is in progress answers 409 `OVER_IN_PROGRESS`. Starting an innings while one is in progress answers 409 `INNINGS_IN_PROGRESS`.

**Match state machine.**

- `ready` → `innings_1` (Start innings) → `innings_break` (innings ends) → `innings_2` (Start innings).
- From `innings_2`: → `result` (a side wins); or → `tied` (level with `super_over` off); or → `super_over_break` (level with `super_over` on).
- `super_over_break` → `super_over` (Start innings) → `super_over_break` (first half ends, or level again below the maximum) → `super_over` → `result` or `tied`.
- After `result` or `tied`, any delivery, over or innings call answers 409 `MATCH_OVER` with the match-over copy.
- Undo walks these edges backwards (Corrections). No other transition exists.

**Worked examples.** These are exact outputs of the reference engine. Kestrels' XI is Rao, Iyer, Sen, Bose, Khan, Das. Herons' XI is Mehta, Pillai, Nair, Gill, Kurian, Varma. Rao is on strike with Iyer, and Mehta bowls, unless stated otherwise.

E1, one over with every extra. Keys `0`, `D 0`, `1`, `N 4`, `B 2`, `L 1`, `6`, `D 1`, `2`:

| seq | label | line | data-runs | data-bat-runs | data-extra | data-extra-runs | data-free-hit | chip |
|---|---|---|---|---|---|---|---|---|
| 1 | 0.1 | `0.1 Mehta to Rao, no run` | 0 | 0 | none | 0 | false | `0` |
| 2 | 0.2 | `0.2 Mehta to Rao, 1 wide` | 1 | 0 | wide | 1 | false | `1wd` |
| 3 | 0.2 | `0.2 Mehta to Rao, 1 run` | 1 | 1 | none | 0 | false | `1` |
| 4 | 0.3 | `0.3 Mehta to Iyer, no-ball, FOUR` | 5 | 4 | no-ball | 1 | false | `5nb` |
| 5 | 0.3 | `0.3 Mehta to Iyer, 2 byes (free hit)` | 2 | 0 | bye | 2 | true | `2b` |
| 6 | 0.4 | `0.4 Mehta to Iyer, 1 leg bye` | 1 | 0 | leg-bye | 1 | false | `1lb` |
| 7 | 0.5 | `0.5 Mehta to Rao, SIX` | 6 | 6 | none | 0 | false | `6` |
| 8 | 0.6 | `0.6 Mehta to Rao, 2 wides` | 2 | 0 | wide | 2 | false | `2wd` |
| 9 | 0.6 | `0.6 Mehta to Iyer, 2 runs` | 2 | 2 | none | 0 | false | `2` |

After E1:

- Over-end line `End of over 1: 20 runs. Kestrels 20/0`. Scoreboard `Kestrels 20/0 (1 ov)`.
- Batters `Rao* 7 (3)` and `Iyer 6 (4)`. Bowler `Mehta 1-0-17-0`.
- `Extras 7 (b 2, lb 1, w 3, nb 1)`, `Run rate 20.00`.
- Batting rows: Arjun Rao not out 7 3 0 1 233.33; Kabir Iyer not out 6 4 1 0 150.00.
- Bowling row: Vik Mehta 1 0 17 0 2 1 17.00.
- Example announcement for seq 4: `0.3 Mehta to Iyer, no-ball, FOUR. Kestrels 7/0.`

E2, strike. Keys `1`, `2`, `B 1`, `D 1`, `3`, `4`, `1`, then Pillai bowls over 2: `0`, `L 3`.

- Strikers in order: Rao, Iyer, Iyer, Rao, Iyer, Rao, Rao, Rao, Rao.
- Lines: `0.1 Mehta to Rao, 1 run`, `0.2 Mehta to Iyer, 2 runs`, `0.3 Mehta to Iyer, 1 bye`, `0.4 Mehta to Rao, 2 wides`, `0.4 Mehta to Iyer, 3 runs`, `0.5 Mehta to Rao, FOUR`, `0.6 Mehta to Rao, 1 run`, `End of over 1: 14 runs. Kestrels 14/0`, `1.1 Pillai to Rao, no run`, `1.2 Pillai to Rao, 3 leg byes`.
- After it: `Kestrels 17/0 (1.2 ov)`, batters `Iyer* 5 (3)` and `Rao 6 (5)`.

E3, wickets (6 a side). Over 1 by Mehta:

1. `1`.
2. Caught by Nair; new batter Sen.
3. LBW; new batter Bose.
4. `2`.
5. Run out of the non-striker Rao by Gill after 1 completed run; new batter Khan.
6. Bowled; new batter Das.

Over 2 by Pillai: a wide (`D 0`) on which Bose is stumped by Kurian.

- Lines: `0.1 Mehta to Rao, 1 run`, `0.2 Mehta to Iyer, OUT! c Nair b Mehta`, `0.3 Mehta to Sen, OUT! lbw b Mehta`, `0.4 Mehta to Bose, 2 runs`, `0.5 Mehta to Bose, 1 run, OUT! run out (Gill)`, `0.6 Mehta to Khan, OUT! b Mehta`, `End of over 1: 4 runs. Kestrels 4/4`, `1.1 Pillai to Bose, 1 wide, OUT! st Kurian b Pillai`.
- After 0.5: `Khan* 0 (0)` and `Bose 3 (2)`. After 0.6: `Bose* 3 (2)` and `Das 0 (0)`.
- The last wicket ends the innings: `Total 5 all out (1 ov)`, `Extras 1 (b 0, lb 0, w 1, nb 0)`, `Fall of wickets: 1-1 (Iyer, 0.2), 2-1 (Sen, 0.3), 3-4 (Rao, 0.5), 4-4 (Khan, 0.6), 5-5 (Bose, 1.1)`.
- Batting rows:
  - Arjun Rao `run out (Gill)` 1 1 0 0 100.00
  - Kabir Iyer `c Nair b Mehta` 0 1 0 0 0.00
  - Dev Sen `lbw b Mehta` 0 1 0 0 0.00
  - Neel Bose `st Kurian b Pillai` 3 2 0 0 150.00
  - Omar Khan `b Mehta` 0 1 0 0 0.00
  - Ravi Das `not out` 0 0 0 0 `-`
- Bowling rows: Vik Mehta 1 0 4 3 0 0 4.00; Sam Pillai 0 0 1 1 1 0 `-`.
- A hit wicket on the first ball gives `0.1 Mehta to Rao, OUT! hit wicket b Mehta`. A catch by the bowler gives `OUT! c & b Mehta`.

E4, free hit. Keys `0`, `N 1`, `D 0`, `6`, `0`.

- Lines: `0.1 Mehta to Rao, no run`, `0.2 Mehta to Rao, no-ball, 1 run`, `0.2 Mehta to Iyer, 1 wide (free hit)`, `0.2 Mehta to Iyer, SIX (free hit)`, `0.3 Mehta to Iyer, no run`.
- `FREE HIT` shows after the no-ball, stays after the wide, and is gone after the six.
- After the six: `Kestrels 9/0 (0.2 ov)`. After the last ball: `Kestrels 9/0 (0.3 ov)`, batters `Iyer* 6 (2)`, `Rao 1 (2)`.
- Instead, after `0` and `N 1`: bowled is refused with `WICKET_NOT_ALLOWED`. A run out of the striker Iyer by Gill after 1 completed run is recorded as `0.2 Mehta to Iyer, 1 run, OUT! run out (Gill) (free hit)`, with `Fall of wickets: 1-3 (Iyer, 0.2)`. The new batter Sen stands at the non-striker's end, with Rao on strike.

E5, bowlers (6 overs, limit 2). Mehta bowls over 1 (six dots, a maiden), Pillai over 2 (six singles), Mehta over 3 and Pillai over 4 (six singles each).

- For over 5, Pillai is refused with `Pillai bowled the last over.` and Mehta with `Mehta has bowled 2 of 2 overs.`
- Rows: Vik Mehta 2 1 6 0 0 0 3.00 (`2-1-6-0`); Sam Pillai 2 0 12 0 0 0 6.00 (`2-0-12-0`).
- Score `Kestrels 18/0 (4 ov)`, batters `Rao* 9 (15)`, `Iyer 9 (9)`.

E6 and E7 are under Corrections. E8 and E9 are under Innings and result and Super over. E10 is under Tournaments. E11 is under Teams and careers.

#### Corrections

**Change a past delivery** (`PUT /deliveries/:seq`).

- Any delivery of the current innings may get new runs and a new extra, as long as it stays legal or stays not legal: runs, bye and leg bye change among themselves, and wide and no-ball among themselves. Any other change is refused with 422 `CHANGE_MOVES_OVERS`.
- A wicket on that delivery stays. If the new delivery kind does not allow that wicket, the change is refused with 422 `CHANGE_BREAKS_WICKET` and the this-wicket copy.
- If the change makes a later delivery a free hit and that delivery carries a wicket other than run out, it is refused with 422 `CHANGE_BREAKS_WICKET` and the later-wicket copy, naming that delivery's seq and kind. For example, turning a wide just before a bowled into a no-ball.
- On a refusal nothing changes.
- On success the server replays the innings, so every later delivery's striker (and so whose runs and balls they are), labels, free-hit flags, totals, extras, batting and bowling rows, fall of wickets, over-end lines, run rate, chase line and, in the first innings, the target follow from the changed log.

E6, changing E2:

- Delivery 2 changed to 1 run. Every later strike flips. Lines become `0.2 Mehta to Iyer, 1 run`, `0.3 Mehta to Rao, 1 bye`, `0.4 Mehta to Iyer, 2 wides`, `0.4 Mehta to Rao, 3 runs`, `0.5 Mehta to Iyer, FOUR`, `0.6 Mehta to Iyer, 1 run`, `End of over 1: 13 runs. Kestrels 13/0`, `1.1 Pillai to Iyer, no run`, `1.2 Pillai to Iyer, 3 leg byes`. Score `Kestrels 16/0 (1.2 ov)`, batters `Rao* 4 (3)`, `Iyer 6 (5)`. Rows: Arjun Rao 4 3 0 0 133.33; Kabir Iyer 6 5 1 0 120.00; Mehta `1-0-12-0`, economy 12.00.
- Instead, delivery 4 (2 wides) changed to a no-ball with 1 off the bat. Lines `0.4 Mehta to Rao, no-ball, 1 run`, `0.4 Mehta to Iyer, 3 runs (free hit)`. Score unchanged at `Kestrels 17/0 (1.2 ov)`. Rao's row 7 6 1 0 116.67. Mehta's row Wd 0, Nb 1.

**Undo the last scoring event** (`DELETE /deliveries/last`).

- Undo removes the last scoring event of the current innings: its last delivery, or a retirement recorded after it.
- A wicket on an undone delivery is undone too: the batter is back, and the new batter returns to the players yet to bat.
- If the over in progress has a bowler but no delivery yet, Undo removes that bowler choice and the last delivery of the previous over together.
- If the current innings has started but has no delivery, or the match is at a break, Undo removes that start (if any) and the last delivery of the finished innings, which reopens.
- After a result, Undo removes the last delivery, reopens the innings and clears the result. Points tables, net run rates, team histories and careers follow at once.
- With nothing left in the match to undo, Undo answers 409 `NOTHING_TO_UNDO`.

E7: after E3's third delivery (the LBW), the state is `Kestrels 1/2 (0.3 ov)`, batters `Bose* 0 (0)`, `Rao 1 (1)`, `Fall of wickets: 1-1 (Iyer, 0.2), 2-1 (Sen, 0.3)`, Mehta `0.3-0-1-2`. Undo gives `Kestrels 1/1 (0.2 ov)`, batters `Sen* 0 (0)`, `Rao 1 (1)`, `Fall of wickets: 1-1 (Iyer, 0.2)`, Mehta `0.2-0-1-1`, and Bose is back among the players yet to bat.

#### Innings and result

- **Target** is the first-innings total + 1. At the first innings' end, `innings_break` carries the break heading and break text from Messages.
- **Results.**
  - The chasing side reaching the target wins by wickets in hand (`players_per_side` - 1 - wickets lost), with the legal balls left of its quota.
  - A defending side whose opponent's innings ends short wins by the difference in runs.
  - Level scores go to a super over when `super_over` is on, otherwise to `Match tied` (status `tied`).
- The result text appears in the state and every scorecard and team history.
- E8 (5 overs, 6 a side):
  - Kestrels make `Total 52/0 (5 ov)`. Break: `Kestrels 52/0 (5 ov). Herons need 53 runs from 30 balls.`
  - Herons at 2.4: `Herons 31/0 (2.4 ov)`, `Run rate 11.63`, `Need 22 from 14 balls. Required rate 9.43`.
  - The chase finishes with each line followed by its chase line: `2.5 Sen to Pillai, FOUR` (`Need 18 from 13 balls. Required rate 8.31`), `2.6 Sen to Pillai, 2 runs` (`Need 16 from 12 balls. Required rate 8.00`), `3.1 Bose to Mehta, 1 wide` (`Need 15 from 12 balls. Required rate 7.50`), `3.1 Bose to Mehta, FOUR` (`Need 11 from 11 balls. Required rate 6.00`), `3.2 Bose to Mehta, OUT! b Bose` (`Need 11 from 10 balls. Required rate 6.60`), `3.3 Bose to Nair, SIX` (`Need 5 from 9 balls. Required rate 3.33`), `3.4 Bose to Nair, FOUR` (`Need 1 from 8 balls. Required rate 0.75`), `3.5 Bose to Nair, 1 run`.
  - The chase ends at `Total 53/1 (3.5 ov)`, result `Herons won by 4 wickets (7 balls left)`.
  - If Herons were bowled out for 9 in 1.5 overs instead: `Total 9 all out (1.5 ov)`, result `Kestrels won by 43 runs`.

#### Super over

- With `super_over` on and level scores, the state moves to `super_over_break` with heading `Super over 1` and the super-over start text.
- In super over 1, the side that batted second in the match bats first. In each later super over, the side that batted second in the previous super over bats first.
- Each super-over innings is one over and ends at 2 wickets, printed `all out`. Batters come from the full XI.
- No bowler bowls more than its one over. A team's bowler of the previous super over may not bowl in the next one: 422 `BOWLER_BARRED` with the super-over copy, from `POST /innings`.
- Between the two halves the state is `super_over_break`, with heading `Super over <n>` and the break text. The second half's target is the first half's total + 1, and `chase` is filled.
- The side with more runs wins the super over: `<team> won the super over`, and that side gets the match win.
- Level again: super over `<n + 1>`, up to `SUPER_OVER_MAX`. Still level after the last: `Match tied after <n> super overs` (status `tied`).
- Super overs appear in the scorecard as their own sections and never count toward net run rate or careers.
- E9: Herons bat first. Lines `0.1 Rao to Mehta, FOUR`, `0.2 Rao to Mehta, 1 run`, `0.3 Rao to Pillai, OUT! c Sen b Rao`, `0.4 Rao to Nair, 1 wide`, `0.4 Rao to Nair, SIX`, `0.5 Rao to Nair, 2 runs`, `0.6 Rao to Nair, OUT! b Rao` give `Total 14 all out (1 ov)`. Kestrels need 15: `0.1 Mehta to Rao, SIX`, `0.2 Mehta to Rao, 1 run`, `0.3 Mehta to Iyer, FOUR`, `0.4 Mehta to Iyer, no-ball, no run`, `0.4 Mehta to Iyer, 2 runs (free hit)`, `0.5 Mehta to Iyer, 1 run` reach 15/0, result `Kestrels won the super over`. In super over 2, choosing Rao again for Kestrels is refused with `Rao bowled in the last super over.`

#### Live viewer delay

- Every recorded delivery, change, undo, retirement, innings start and over start is published once on the match's live channel, in the order made. Every watcher receives it within one second.
- A viewer page (`/live/:code`) shows each state exactly `LIVE_DELAY_MS` after the message arrives, measured by the page's own clock. At `LIVE_DELAY_MS` - 1 milliseconds it still shows the previous state, and states are shown in arrival order.
- The first state, loaded with the page, shows at once.
- The scorer's page shows its own changes from the API answer at once. Read-only scoring pages and tournament pages show live messages with no delay.
- A change or undo on a viewer page sets `#notice` to the matching viewer notice, which is also announced, together with the recomputed values.

#### The pen

- The match's organiser and every user who accepted an invitation to it are its scorers.
- A scoring page asks for the pen when it loads. If nobody holds it, the server makes that page the holder and sends it a pen id.
- The holder is stored in Valkey as `pen:<match id>`. Its expiry is `PEN_GRACE_MS`, and the server renews it at least four times per `PEN_GRACE_MS` for as long as that page's live connection stays open. When the connection closes, the server stops renewing, and the pen lapses `PEN_GRACE_MS` later by server time. No page timer is involved, so a paused page clock never loses the pen.
- Any other scoring page (another scorer, or the same scorer's second tab) is read-only and gets the holder's display name.
- When the pen lapses, every read-only scoring page of that match gets the pen-free message at once.
- Of several pages asking for a free pen at the same moment, exactly one gets it. The others get the holder's name.

#### Invitations

- An invitation belongs to one match and carries a random token of at least 128 bits.
- It works once, and only while less than `INVITE_TTL_HOURS` hours have passed since it was sent, by the server clock. At exactly that age it has expired.
- Accepting requires a signed-in user and makes that user a scorer of the match. Accepting again answers 409 `INVITATION_USED`; accepting after expiry answers 409 `INVITATION_EXPIRED`. An unknown token answers 404.
- Each organiser may send at most `INVITE_RATE_PER_HOUR` invitations in any rolling hour by the server clock. That number is allowed, and the next one answers 429 `RATE_LIMITED`.
- The answer to an invitation never reveals whether the email has an account.

#### Tournaments

- A tournament has a name, overs per side, players per side, super over on or off, and named groups of teams the organiser owns. A team may be in one group per tournament.
- A tournament match takes the tournament's settings, and both its teams must be in one group (422 `VALIDATION` with field `tournament` otherwise).
- **Points.** A win is 2, a tie is 1 (including a match tied after super overs), a loss is 0. The super-over winner gets the win.
- **Net run rate.** Runs scored ÷ overs faced − runs conceded ÷ overs bowled, over the team's finished group matches.
  - Overs are legal balls ÷ 6 as an exact number (17.3 overs = 105 balls = 17.5).
  - A side bowled out counts as having faced the full over quota of that match.
  - Super overs are left out.
  - It is shown rounded half away from zero to 3 decimals, with `+` before a positive value and `-` before a negative one. It is `0.000` for zero, including a team with no finished match.
- **Order.** Points, then wins, then net run rate (unrounded), then head-to-head, then team name A to Z. Head-to-head applies only when exactly two teams are level on all earlier keys and the match between them had a winner, which goes first.
- Whenever a group match gets, changes or loses its result, the tournament's live channel sends the new tables.
- E10, one match: Falcons 140 all out in 18.3 overs, Ospreys 141/3 in 17.3 overs. Falcons' NRR counts 20 overs faced: 140/20 − 141/17.5 = `-1.057` (it would be `-0.490` if the all-out rule were ignored). Ospreys get `+1.057`.
- E10, a group of four (20 overs, 11 a side):
  - Kestrels 160/4 (20) beat Herons 150/7 (20).
  - Ospreys 141/3 (17.3) beat Falcons 140 all out (18.3).
  - Herons 180/5 (20) beat Falcons 120 all out (16).
  - Kestrels 156/2 (19.3) beat Ospreys 155/6 (20).
  - Table (Team P W L T Pts NRR): Kestrels 2 2 0 0 4 `+0.375`; Herons 2 1 1 0 2 `+1.250`; Ospreys 2 1 1 0 2 `+0.400`; Falcons 2 0 2 0 0 `-2.060`.
  - Then Ospreys chase Herons' 150/8 (20) and finish on 154/5 in 19.5 overs (`Ospreys won by 5 wickets (1 ball left)`). New table: Kestrels 2 2 0 0 4 `+0.375`; Ospreys 3 2 1 0 4 `+0.353`; Herons 3 1 2 0 2 `+0.747`; Falcons 2 0 2 0 0 `-2.060`. Kestrels are above Ospreys on net run rate.

#### Teams and careers

- A team has a name and players. Each player has a full name and a short name, which defaults to the last word of the full name. Short names are unique within a team.
- **Logos.** A logo is a PNG or JPEG, checked by its content (the file's leading bytes), never by its name or declared type. It is at most `LOGO_MAX_BYTES` bytes, and that size is allowed.
- **Team history.** The team's `Matches` list (and its API `matches`) has one item per finished match, newest first: `<home> v <away>, <date>: <result>`. `<date>` is the day the match was played in `APP_TZ`: the server date of its first delivery, or the seeded `played_on`. For example, with the E8 match played on 4 November 2026: `Kestrels v Herons, 4 Nov 2026: Herons won by 4 wickets (7 balls left)`. Summary-only seeded matches are listed with their result built from the summary by the same result rule, and have no Scorecard link.
- **Scorecard formats.**
  - Batting rows are in the order batters came in.
  - `Extras <total> (b <b>, lb <lb>, w <w>, nb <nb>)`.
  - `Total <runs>/<wickets> (<overs> ov)`, or `Total <runs> all out (<overs> ov)`.
  - `Did not bat: <short>, <short>`, left out when nobody is left.
  - The fall-of-wickets line.
  - Bowling rows in the order bowlers first bowled; Wd and Nb count deliveries, not runs.
  - Strike rate is runs × 100 / balls and economy is runs × 6 / legal balls, both to 2 decimals, and `-` when the balls are 0.
- The scorecard always reconciles: total = batters' runs + byes + leg byes + wides + no-ball extras, and the bowlers' runs plus byes and leg byes equal the total.
- **Careers** count finished matches with a ball log only, leaving super overs out.
  - `Mat`: matches the player was in the XI of.
  - `Inns`: innings they batted in. `NO`: innings they ended not out or retired hurt. `Runs`.
  - `HS`: highest score, with `*` when not out.
  - `Avg`: runs ÷ (Inns − NO), to 2 decimals, `-` with no dismissal.
  - `SR`: runs × 100 / balls. `4s`, `6s`.
  - Bowling: `Overs` (overs notation of all legal balls), `Runs`, `Wkts`, `Best` (most wickets in an innings, then fewest runs, written `3/21`, `-` with no wicket), `Econ`.
- E11: Arjun Rao after two finished matches. Match one is E8, where Rao made 29 not out off 15 and bowled one over for 9 runs. Match two has E3 as its first innings (run out 1 off 1), and in its second innings Herons hit `6` off Iyer's first ball (`Herons won by 5 wickets (29 balls left)`). Rao's career: Mat 2, Inns 2, NO 1, Runs 30, HS `29*`, Avg `30.00`, SR `187.50`, 4s 1, 6s 3; Overs `1`, Runs 9, Wkts 0, Best `-`, Econ `9.00`.
- Career JSON: `{"player":{"id","name","short_name","team":{"id","name"}},"batting":{"matches","innings","not_outs","runs","high_score","average","strike_rate","fours","sixes"},"bowling":{"overs","runs","wickets","best","economy"}}`.

#### Accounts and visibility

- Sign-up takes an email (unique, case-insensitive), a password of at least 10 characters (10 allowed), and a display name.
- Sign-in with an unknown email or a wrong password gives the same 401 body and takes the same work on the server.
- An organiser's teams, players, tournaments and matches are private to that organiser and to the accepted scorers of the matches. A scorer sees only their matches, the teams playing them, those teams' players and careers, and the tournaments of those matches.
- Everything else answers 404, with a body identical to a missing id, both on pages (the not-found page) and in the API and live connection. This includes a delivery seq from another match or innings.
- A new match has its viewer link on, with a random viewer code of at least 22 letters and digits from a secure source.
- Turning the link off makes `/live/<code>`, its scorecard and its state answer 404, and sends the link-off message to every open viewer page, which then shows the link-off copy in `#live-status` at once.
- Turning it back on issues a new code. The old code stays 404.

### Services (DP-41, DP-39, DP-52, DP-53, DP-54, DP-55, DP-57)

| Service | What the app records | When it is unreachable |
|---|---|---|
| Postgres (`DATABASE_URL`) | Accounts, sessions, teams, players, tournaments, groups, matches, each innings' ball log, retirements, scorer memberships, invitations, logo records. Every derived figure is computed from these. The schema is applied idempotently on every serve | `/api/services` reports `down`; at boot the app retries for up to 60 seconds |
| Valkey (`VALKEY_URL`) | Pen key `pen:<match id>` (value: pen id; expiry `PEN_GRACE_MS`). Live channels `match:<match id>` and `tournament:<tournament id>`, whose messages are the live connection's JSON. The app server relays them to its sockets | Scoring still saves, and the app keeps the pen in its own memory with the same rules. No live messages flow. Every viewer page shows the viewer paused copy in `#live-status` and the latest state on reload. The scoring page shows the scoring paused copy |
| MinIO (`S3_*`) | One object per upload: key `logos/<team id>/<n>.png` or `.jpg`, where `<n>` is the team's upload count from 1, with the matching content type. The team's logo switches to the new object only after the write is confirmed. The app serves logo bytes back from storage | Upload answers 503 `STORAGE_UNAVAILABLE` with the storage outage copy. The team's logo record and image address stay as they were |
| Mailpit (`SMTP_HOST`, `SMTP_PORT`) | One message per invitation, from `MAIL_FROM` to the invited address. Subject `Score <home> v <away> on Overcall`. The body contains the link `<APP_BASE_URL>/invitations/<token>` and the invitation mail line. The invitation is stored only after the SMTP server accepts the message | Answers 503 `MAIL_UNAVAILABLE` with the mail outage copy, and no invitation is stored |

On the outage instances, the broken service's address points at a closed local port, which may be written with an `http://` scheme. The app treats any address it cannot reach as down and never crashes on it.

### Seed data (DP-56)

At start the database is empty: no accounts, teams, tournaments or matches. Tests build every record through the grading routes. The examples in this brief use these invented teams and players. Every person and team in this brief is invented.

- Kestrels: Arjun Rao (Rao), Kabir Iyer (Iyer), Dev Sen (Sen), Neel Bose (Bose), Omar Khan (Khan), Ravi Das (Das), Yash Pandey (Pandey), Ishan Roy (Roy), Manav Lal (Lal), Tarun Gupta (Gupta), Hari Menon (Menon).
- Herons: Vik Mehta (Mehta), Sam Pillai (Pillai), Jai Nair (Nair), Tom Gill (Gill), Ash Kurian (Kurian), Leo Varma (Varma), Zubin Shah (Shah), Pranav Dutta (Dutta), Kiran Bhat (Bhat), Raj Malik (Malik), Anil Joseph (Joseph).
- Falcons and Ospreys: invented players named by tests.
- People: organiser Olga Fernandes, scorer Mira Joshi, second scorer Sam Kapoor.

### Grading routes (DP-56)

These routes work only with the header `X-Grading-Key` equal to `GRADING_KEY`. Without it, or with any other value, they answer 404 `NOT_FOUND`.

**`POST /api/grading/seed`** (up to 1,048,576 bytes) takes any of `users`, `teams`, `tournaments`, `matches`, `invitations`:

```json
{"users": [{"key": "olga", "email": "olga@example.test", "display_name": "Olga Fernandes", "password": "long-password-1"}],
 "teams": [{"key": "kes", "organiser": "olga", "name": "Kestrels", "players": [{"key": "k1", "name": "Arjun Rao", "short_name": "Rao"}]}],
 "tournaments": [{"key": "t1", "organiser": "olga", "name": "Autumn Cup", "overs": 20, "players_per_side": 11, "super_over": false,
                  "groups": [{"name": "Group A", "teams": ["kes", "her", "fal", "osp"]}]}],
 "matches": [{"key": "m1", "organiser": "olga", "home": "kes", "away": "her", "overs": 5, "players_per_side": 6, "super_over": true,
              "batting_first": "kes", "tournament": null, "xi": {"kes": ["k1", "k2", "k3", "k4", "k5", "k6"], "her": ["h1", "h2", "h3", "h4", "h5", "h6"]},
              "scorers": ["mira"], "viewer_link": true, "played_on": "2026-11-04",
              "innings": [{"striker": "k1", "non_striker": "k2", "bowlers": ["h1", "h2"],
                           "deliveries": ["0", "D0", "1", "N4", "B2", "L1", "6", "D1", "2", {"ball": "0", "out": "caught", "fielder": "h3", "new_batter": "k3"}],
                           "retirements": [{"before_seq": 5, "batter": "k1", "new_batter": "k3"}]}],
              "summary": null}],
 "invitations": [{"key": "i1", "match": "m1", "email": "sam@example.test", "sent_at": "2026-11-04T10:00:00+05:30"}]}
```

- **Delivery tokens.** `"0"`-`"6"` are runs. `"D<n>"` is a wide with n run, `"N<n>"` a no-ball with n off the bat, `"B<n>"` byes, `"L<n>"` leg byes.
- An object adds a wicket to a token: `{"ball": "<token>", "out": "<wicket data value>", "fielder", "batter_out": "striker" or "non-striker", "new_batter"}`. `new_batter` defaults to the next player yet to bat in XI order.
- `bowlers` lists one bowler per over, in order. A bowler listed for an over with no deliveries yet means that over has been started.
- Innings are listed in play order, super-over innings included. The server replays every delivery through the laws engine exactly as if it had been scored, so a seed can leave a match at any innings, over and ball. A complete last innings leaves the match at the break, the super-over break or the result that follows.
- `scorers` are user keys that have accepted invitations. `played_on` is optional.
- `"summary": {"first": {"runs", "wickets", "balls", "all_out"}, "second": {...}, "winner": "<team key>" or null}`, used with no `innings`, makes a finished match that counts only in points, net run rate and team history.
- Seeded invitations are stored without sending mail.
- **Response 201:** `{"users": {"olga": {"id", "session"}}, "teams": {"kes": {"id", "players": {"k1": "<id>"}}}, "tournaments": {"t1": {"id"}}, "matches": {"m1": {"id", "viewer_code"}}, "invitations": {"i1": {"token"}}}`. A user's `session` is a valid `oc_session` cookie value.
- An invalid seed answers 422 `SEED_INVALID`, with a message naming the first problem, for example `match m1 innings 1 delivery 7: bowled cannot happen on a free hit`. Nothing is stored.

**`POST /api/grading/clock`** `{"now": "2026-11-06T15:30:00+05:30"}` sets the server clock to that instant, and it runs on from there. `{"now": null}` returns to real time. Answers 200 `{"now": "<ISO instant>"}`. The server clock governs invitation expiry, rate limits and match dates. The pen grace uses elapsed time, which the clock route does not change.

## Technical requirements

### Deployment (DP-57)

Backend: TypeScript on Node 22 with npm. Frontend: TypeScript built with Node 22 in the same `build`.

`/app/run.json` holds string `install`, `build` and `serve` commands and `"_schema": "run-manifest-v1"`, for example:

```json
{"_schema": "run-manifest-v1", "install": "npm ci", "build": "npm run build", "serve": "npm run start"}
```

The server binds `0.0.0.0` on port 4173, or on `APP_PUBLIC_PORT` when that is set. HTTP and the `/ws` WebSocket share that port. `GET /api/health` answers HTTP 200 JSON `{"status":"ok"}` on every instance, outage instances included. It reports the app process and never answers 503. The lockfile is committed. Fonts (Dela Gothic One, DM Sans) are files the app serves itself.

### Configuration and secrets (DP-57)

Every value is read from the environment at start. None is hard-coded, and none reaches the browser except the three client values through `GET /api/config`.

| Variable | Meaning | Default |
|---|---|---|
| `DATABASE_URL` | Postgres | required |
| `VALKEY_URL` | Valkey | required |
| `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_FORCE_PATH_STYLE`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | MinIO; create the bucket if it is missing | required |
| `SMTP_HOST`, `SMTP_PORT` | Mailpit SMTP | required |
| `MAIL_FROM` | Invitation sender | `Overcall <scorers@overcall.test>` |
| `GRADING_KEY` | Grading routes key | required |
| `APP_BASE_URL` | Start of invitation links | `APP_PUBLIC_URL`, else `http://localhost:<port>` |
| `APP_TZ` | Time zone for match dates | `Asia/Kolkata` |
| `LIVE_DELAY_MS` | Viewer delay, in milliseconds | `3000` |
| `PEN_GRACE_MS` | Pen lapse after the socket closes, in milliseconds | `2000` |
| `TICK_MS` | Ball tick roll duration, in milliseconds | `260` |
| `TICK_STAGGER_MS` | Ball tick stagger, in milliseconds | `80` |
| `SUPER_OVER_MAX` | Most super overs per match | `2` |
| `INVITE_TTL_HOURS` | Invitation lifetime, in hours | `48` |
| `INVITE_RATE_PER_HOUR` | Invitations per organiser per hour | `20` |
| `LOGO_MAX_BYTES` | Largest logo, in bytes | `1048576` |

### Server boundary (DP-49, DP-57)

- **Same origin.** The app sends no cross-origin headers, and it refuses a WebSocket upgrade whose Origin is not its own host.
- **JSON size.** Request bodies are at most 65,536 bytes, and that size is allowed; larger answers 413 `PAYLOAD_TOO_LARGE`.
- **Logo upload size.** A logo upload is at most `LOGO_MAX_BYTES` + 65,536 bytes in total. A larger request answers 413. A logo file within that request but over `LOGO_MAX_BYTES` answers 422 with the size copy.
- **Seed size.** The grading seed route allows up to 1,048,576 bytes.
- **What it never serves.** No source files, source maps of server code, environment files, credentials or directory listings. No responses from other origins, CDNs, analytics or remote fonts are ever loaded. No service worker is registered.
- **Boot.** The app starts and answers health even when Valkey, MinIO or Mailpit is unreachable, and reports each one in `/api/services`. That route checks every service live, within one second each.

### Browser support and performance (DP-08, DP-58)

- **Browsers.** Current Chromium, Firefox and Safari.
- **Viewports.** 320, 375, 390, 768, 1024, 1280 and 1440 pixels wide; touch phones at 390 by 844.
- **Speed.** A scoring or viewer page is usable within three seconds of opening, and a recorded delivery shows on the scorer's page within one second of the key press.
- **Clocks.** Every client timer (the viewer delay, Ball tick, notices) uses the page's own timers and animation frames, never a worker timer. Tests control the page clock.

### How Overcall is checked (DP-56, DP-57)

- **What tests read.** Tests read DOM attributes, accessible roles and names, published text, computed layout boxes, the page's Web Animations list, API JSON and the providers' records. They never read pixels or colours.
- **Setup.** Most checks start from a match built through the grading seed at the innings, over and ball they need. Tests add a user's `session` to a browser as the `oc_session` cookie instead of signing in through the form.
- **Clock and motion.** Pages open with the clock paused, and tests move it forward. Reduced motion is checked with the browser's reduced-motion preference.

## Working rules

- IF-01: `/app/run.json` exists with string `install`, `build`, `serve` and `"_schema": "run-manifest-v1"`, and these commands alone install, build and serve the app.
- IF-02: `THIRD_PARTY_NOTICES.md` at `/app` lists every shipped package (the production dependency tree from `npm ls --omit=dev --all --json`) and both font families, each with its licence.
- IF-03: Every shipped package is under MIT, ISC, BSD-2-Clause, BSD-3-Clause, Apache-2.0, 0BSD or BlueOak-1.0.0, and the fonts are under the SIL Open Font License.
- IF-04: The app uses only Postgres, Valkey, MinIO and Mailpit as services. There is no other datastore, queue, cache file or embedded database.
- IF-05: Server and browser source is TypeScript, and the lockfile `package-lock.json` is committed.
- IF-06: The app loads nothing from another origin at runtime (no CDN scripts, styles, fonts or analytics) and registers no service worker.

## Engineering standards

- The code is idiomatic, strictly typed TypeScript on both server and client, with no `any` escaping a module boundary.
- Names match this brief's domain terms: delivery, over, innings, striker, non-striker, free hit, pen, invitation, viewer code, net run rate.
- Each law (legality, strike, free hit, wicket permission, bowler limits, innings end, result, net run rate) is decided in exactly one place in the source, and every derived figure comes from replaying the ball log there.
- There is no abstraction with a single implementation, and no dead, commented-out or unreachable code.
- There are no defensive checks for states the laws engine makes impossible.
- Every API error uses the one published error shape and code list.
- The code has no features beyond this brief.
