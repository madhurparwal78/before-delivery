# Underleaf Works Candour Bench

Candour Bench is a website where laboratory and biotech bench technicians share anonymous workplace reviews, pay reports and interview notes, and where they can search and apply for lab jobs. The users are research assistants, QC analysts, lab managers and core-facility staff in four invented cities. Members give before they get. A member's first approved post unlocks the full pay and review detail for every lab. A pay range appears only once enough approved reports exist that no one person can be picked out. Every post goes through a live moderation queue run by a few volunteer moderators. Verified employer teams answer reviews in public and move applicants through a hiring pipeline that candidates can watch as it changes. Build it as one TypeScript web server with four backend services. PostgreSQL is the system of record. Meilisearch runs job search and company search. MinIO stores resume PDFs and employer marks. Mailpit receives every email. Out of scope: any AI feature (review summaries, resume help, job matching), real company data, outside sign-in, LinkedIn or calendar integrations, paid plans, ads, and any other service or datastore. Every lab, company, city, person, role title and pay figure in the product is invented.

## Problem and users

Bench technicians at contract research labs, university cores and small biotechs have almost no reliable pay information. Job postings leave out the salary. A title like "Research Associate II" means something different at every employer. A review written at a 30-person lab can identify its author from one detail. General review sites mix technicians in with every other job, so a typical lab role has two salary reports and nothing anyone can use, and their moderators do not know lab vocabulary. Their job boards swallow applications, and most applicants never hear back. Technicians fill the gap with private spreadsheets and group chats. The cost lands on them: they accept underpaid offers without knowing it, and they interview at labs whose problems everyone already knew about.

- **Member** (weekly): posts one anonymous review, pay report or interview note to unlock full pay and review detail for every lab, then talks shop in anonymous topic channels.
- **Job seeker** (daily): a member who searches lab jobs by city, role, work pattern and pay band with typos forgiven, saves jobs, sets email alerts, applies with a PDF resume and follows each application as it moves.
- **Moderator** (daily): works the shared moderation queue live alongside the other moderators, and approves or rejects each pending post exactly once, giving a reason for every rejection.
- **Employer recruiter and employer admin** (daily): the employer admin verifies the team by email code. Both answer reviews in public on their own lab's page, list jobs and move applicants through the pipeline stages.
- **Founder** (weekly): keeps the site honest. The founder adds companies and employer users, appoints moderators, revokes employer verification, watches service health and checks that anonymity thresholds hold.

## Journeys

1. **A locked member contributes and unlocks.** Start: a signed-in member with no approved post opens a company page and sees cut review text, no pay figures and the "Contribute once to unlock" panel. They follow `Share something`, write a review through the four steps using only the keyboard, and post it. They land on My contributions with the review `Pending`. A moderator claims and approves it. Without reloading, the member's My contributions shows `Claimed` and then `Approved`, and the member hears the approval announcement. End: the open company page shows full text and pay figures, and still does after a reload and on another device.
2. **Moderators share the queue.** Start: two moderators have the queue open. One claims a post and the other's row shows who claimed it, live. The claimant approves it or picks a rejection reason with the arrow keys, submits, and focus moves to the next post. If the second moderator presses a stale button, they get the conflict alert and nothing else happens. A claim left without a decision returns to the queue after the lapse time. End: the queue shows each post decided once, with the deciding moderator's name.
3. **A pay band resolves.** Start: an unlocked member reads a company's pay section, where QC Analyst in Harrowgate shows four of five reports and no figure. A moderator approves the fifth report. End: without a reload, the hatched tile withdraws, the low, median and high figures count up to the server's values, the row reads `5 reports`, and the announcement names the role.
4. **A job seeker searches.** Start: a member opens job search on a desktop or a phone. They type a misspelled city and role, pick a suggestion by keyboard, and press and remove filter chips while counts are announced. They save a job and save an alert from the current filters. On a phone the filters live in a bottom sheet, and a job page keeps a pinned apply bar. End: the URL holds the filters, a reload restores them, saved jobs persist, and the alert later reports new matching jobs live and by one email.
5. **A job seeker applies and follows the application.** Start: a member on a listed job presses `Apply now`, fills in the form and picks a resume. A file that is not a PDF is refused under the field. During a storage outage, the typed answers stay and `Try again` resends them. End: a stored PDF creates exactly one application, the `Application sent` heading takes focus, and each later stage move shows on My applications live and arrives as one email.
6. **An employer team answers and hires.** Start: an employer admin asks for a verification code, reads it in the inbox and verifies the team. A team member replies to a review, and the reply appears live under that review for every reader. The team lists jobs and moves applicant cards between stage columns by keyboard. They filter columns with stage chips and export the applicants as CSV. End: every open team window shows the same column counts, and each candidate sees their own stage.
7. **Members talk shop.** Start: two members have `Bench pay talk` open. One posts using only the keyboard. End: the other sees the post appear as `Anonymous bench member` with an announcement and no reload. A post containing a phone number is refused with the published copy.
8. **The founder checks the site.** Start: the founder opens the console. They see service health, the outbox backlog and every pay threshold row without any figure. They add a company and an employer user, appoint a member as moderator and revoke a verification. End: each change shows in the console and takes effect at once.

## Mandatory requirements

This is the complete list of mandatory requirements; every check traces to one of these lines and the detailed sections below.

- **DP-01 — Run manifest and health** The app installs, builds and serves from `/app/run.json` on port 4173 and answers the health routes as stated in Deployment.
- **DP-02 — Grading routes** `POST /api/grading/setup` and `POST /api/grading/clock` create test records and move the server clock only with the right token, and answer 404 otherwise.
- **DP-03 — One error shape and order** Every API error uses one JSON shape with a published code and message, chosen by the single precedence order in API.
- **DP-04 — Configuration from the environment** Every service URL, credential, token, timer and limit is read from the environment at start and never hard-coded or sent to the browser.
- **DP-05 — Split-stage look** Pages use Literata on the cool paper ground with one deep teal ink, the 50/50 split with a sticky specimen tile, procedural glassware art and the corner rule from Visual design.
- **DP-06 — Published motion and reduced motion** Every named motion publishes its name, duration and state, reaches its end state after its published duration on the page clock, and jumps to its end at once under reduced motion.
- **DP-07 — Mail through an outbox** Every email goes through an outbox, is sent exactly once, waits out a mail outage without failing the action, and never carries post text or an author's identity.
- **DP-08 — Founder console** The founder adds companies and employer users, appoints moderators, revokes employer verification, and sees service health and every pay threshold without any pay figure.
- **DP-09 — Sign-in and recovery reveal nobody** Sign-in, joining and forgot password give the same reply and timing for addresses with and without an account.
- **DP-10 — Review form by keyboard** A member writes a review through the four published steps by keyboard alone, with focus moving to each step heading or to the first invalid field.
- **DP-11 — Star ratings** Each rating is a radiogroup of five star radios worked by arrow keys, Home and End, announcing the chosen value.
- **DP-12 — Company picker** The Company combobox filters companies as you type, moves an announced active option with arrow keys, selects with Enter and restores the typed text on Escape.
- **DP-13 — One review per company per year** A member's second review of the same company within the review limit window answers 409 `duplicate_review`.
- **DP-14 — Pay reports and interview notes** Members post pay reports and interview notes that enter moderation as pending with the published fields and limits.
- **DP-15 — Anonymous posts** Every post shows as `Anonymous bench member` with month-and-year dates, no author field reaches any browser, and bodies with an email address or phone number are refused.
- **DP-16 — Live moderation queue by keyboard** Moderators claim, approve or reject with a reason, and move to the next post using only the keyboard, with every change shown live in every open queue.
- **DP-17 — Outcomes reach the author** Each claim and decision reaches the author's open My contributions page live, with the published announcement, and each decision sends one outcome email.
- **DP-18 — First claim wins** Of simultaneous claims on one post exactly one succeeds and every other answers 409 `already_claimed` naming the winner.
- **DP-19 — Claim leases** A claim is a lease that the claimant's activity renews; a lease that ends returns the post to pending after `CLAIM_LAPSE_SECONDS` of server time, and every claim, renewal, lapse and decision is added to the post's history, live in every open queue.
- **DP-20 — Decide once on a stale screen** A moderator acting on a post another moderator has claimed or decided, or on their own lapsed claim, sees the published conflict alert and causes no second effect.
- **DP-21 — Rating averages from approved reviews** Rating averages and review counts come from approved reviews only, rounded half up to one decimal, and agree on the company page, in company search and after reload.
- **DP-22 — Pay ranges behind the threshold** A role's low, median and high pay are computed from approved reports and are never sent to any client below `MIN_PAY_REPORTS` reports or to a locked viewer.
- **DP-23 — Band resolve** When an approval brings a role to the threshold, an open company page shows the range resolving live with the published motion, values and announcement.
- **DP-24 — Company page reading column** The company page reading column sets the rating, reviews, pay table, interview notes and employer replies in the distinct published forms.
- **DP-25 — Contribute once to unlock** A member with no approved post sees the locked view, and the first approval unlocks full detail live, after reload and on every device, for good.
- **DP-26 — Editing and deleting your posts** Authors edit posts within the edit window, and a deleted post leaves every page, count, search document and channel quote and its link answers not found.
- **DP-27 — Employer verification by email code** An employer admin verifies their team with a six-digit emailed code that expires and is rate limited as published.
- **DP-28 — Public employer replies** A verified team replies once to a review of its own company, and the reply appears live under that review on every open company page.
- **DP-29 — Job and company search** Job and company search forgive typos, filter by the published facets, and show facet counts built from listed jobs and approved posts only.
- **DP-30 — Filter chips by keyboard** Filter chips toggle with Space, are removed with Delete or Backspace, keep the filters in the URL, and announce the published filter and count text after the debounce.
- **DP-31 — Search outage fallback** While search is down, job and company search show the outage banner and a plain list by city with every listed record.
- **DP-32 — Published breakpoints** At 375, 768 and 1280 pixels wide the company page shows the stacked sticky tile, the narrowed split and the full split, with no sideways scrolling.
- **DP-33 — Phone filters and apply bar** On a phone the filters open in a bottom sheet that closes by button, Escape or swipe, and a job page keeps a sticky apply bar.
- **DP-34 — Saved jobs** Members save and unsave jobs with the published announcements and motion, and saved jobs persist after reload.
- **DP-35 — Company section tabs** On a phone the company page sections are tabs that switch by tap, arrow keys or swipe and are kept in the URL.
- **DP-36 — Jobs listed once indexed** A new job counts as listed only after its search document is indexed, and stays a draft with 503 when search is down.
- **DP-37 — Job alerts** Members save alerts from the current search, see new matches live, and get one batched email per alert after `ALERT_BATCH_SECONDS`.
- **DP-38 — Resume checks** Only a real PDF of at most `RESUME_MAX_BYTES` bytes, judged by its bytes, is accepted, with the published refusal under the field.
- **DP-39 — Apply with a stored resume** An application exists only after storage confirms the resume, a storage outage keeps the typed answers, and every submit of one form carries one idempotency key, so repeated submits make one application.
- **DP-40 — Pipeline stage rules** Applications move one stage at a time or to Declined, only by the owning company's team, and every other move answers 409 `invalid_transition`.
- **DP-41 — Keyboard pipeline board** Recruiters pick up, move and drop applicant cards by keyboard with the published announcements, and the candidate sees each move live and by one email.
- **DP-42 — Application privacy** Applicant rows show only the published applicant fields, and an application or resume opens only for its candidate and the owning company's team.
- **DP-43 — Applicants CSV export** The team exports a job's applicants as a CSV with the published header, order, quoting and date format.
- **DP-44 — Applicant list with stage chips** The pipeline page filters stage columns with chips by keyboard, and column counts update live in every open team window.
- **DP-45 — Live anonymous channels** Members post in topic channels by keyboard and every open window shows the new post live as `Anonymous bench member`; a window that lost its live connection gets each missed post once, in order, when it reconnects.

## Frontend

### Screens and layout (DP-05, DP-24, DP-32, DP-33, DP-35)

The three published viewports are 375 × 812 (phone), 768 × 1024 (tablet) and 1280 × 800 (desktop). The phone layout applies at every width below 640 pixels, so a 390 × 844 phone gets it too. The tablet layout applies from 640 to 1023 pixels and the desktop layout from 1024 pixels up. No other breakpoint changes the layout a published viewport gets. No page scrolls sideways at any of the three sizes.

Every page has a header with the wordmark `Candour Bench` (a link to `/`) and the navigation. On tablet and desktop the navigation links are visible. On a phone they sit behind `button "Menu"`, which opens `dialog "Menu"`.

| Screen | Path | What it shows |
|---|---|---|
| Landing | `/` | The split stage hero (Visual design), then three reading sections, one for each seeded sample lab, each with the lab's name, city and a link to its company page. |
| Sign in, join, password | `/sign-in`, `/join`, `/join/confirm?token=<token>`, `/forgot-password`, `/reset-password?token=<token>` | One narrow form per page on the ground colour. |
| Job search | `/jobs` | Full width. Facet groups as a text list on the left, and a single-column result list with no cards. |
| Job page | `/jobs/<id>` | Title, company, city, work pattern, pay range, description, `Apply now` and `Save job`. |
| Apply | `/jobs/<id>/apply` | The application form. |
| Company search | `/companies` | Full width. A search box, city chips and a result list of companies. |
| Company page | `/companies/<slug>` | The split stage: the reading column on the left and the sticky specimen tile on the right. |
| Review link | `/companies/<slug>/reviews/<id>` | One approved review, set as on the company page. |
| Contribute | `/contribute`, `/contribute/review`, `/contribute/pay`, `/contribute/interview` | A chooser page and the three forms. |
| My contributions | `/me/contributions` | The member's own posts and their states. |
| Saved jobs | `/saved` | The member's saved jobs. |
| Alerts | `/alerts` | The member's saved alerts. |
| My applications | `/applications`, `/applications/<id>` | The member's applications and one application's detail. |
| Channels | `/channels`, `/channels/<slug>` | The channel list, and one channel's posts with a composer. |
| Moderation queue | `/moderation` | Full width. The queue table. |
| Employer home | `/employer` | Verification, the team's jobs, and the job form at `/employer/jobs/new`. |
| Pipeline | `/employer/jobs/<id>` | Full width. Stage chips and five stage columns. |
| Applicant | `/employer/applications/<id>` | One applicant's shared details and resume link. |
| Founder console | `/founder` | Service health, members, companies and pay thresholds. |
| Not found | any unknown or hidden page | The not-found sentence and one link, served with HTTP 404. |

**Company page (DP-32).**
- Desktop: two equal halves meet at the exact horizontal middle of the window, within 2 pixels. The left reading column scrolls. The right field fills the window height, stays pinned while the column scrolls, and centres the square specimen tile.
- Tablet: a narrowed split. The reading column takes between 55% and 62% of the width, and the pinned field takes the rest, with the tile sized to fit it.
- Phone: stacked. The tile becomes a full-width band between 25% and 40% of the window height. It stays pinned to the top of the window while the content scrolls beneath it. Below the tile come the company heading, the rating figure, the section tabs and the selected tab's panel.
- On tablet and desktop the four sections (Reviews, Pay, Interviews, Jobs) follow one another in the reading column. Loading the page with `?tab=<name>` scrolls that section into view.

**Landing page.** Desktop and tablet use the same split as the company page. On a phone the headline block comes first, and the tile follows it in the page flow without being pinned.

**Job search.**
- Desktop: the facet list takes about a quarter of the width on the left.
- Tablet: the facet list takes about a third of the width.
- Phone: results take the full width, and the facets move into the filter sheet.

**Job page on a phone.** A pinned `region "Apply bar"` stays at the bottom of the window. The bar does not exist at tablet and desktop widths, where its two buttons sit in the job header instead.

**Moderation queue and pipeline.** These are full width at tablet and desktop. On a phone, the queue table shows only its Type, Summary and Status columns, and the claimed post's detail opens below its row at full width. The pipeline columns stack vertically.

**Reading column forms (DP-24).** Each kind of content on the company page has its own form:
- The overall rating is one large figure with lining, equal-width digits, with the review count beside it and the four sub-ratings beneath.
- Reviews are a plain list of quotes separated only by space, each with its title, ratings and month.
- The pay table lists one row per role and city, with figures in equal-width digits.
- Interview notes are set in italics.
- An employer reply is indented under its review in the softer teal.

### Public screens and controls (DP-10, DP-11, DP-12, DP-15, DP-16, DP-25, DP-28, DP-30, DP-33, DP-34, DP-35, DP-41, DP-44, DP-45)

These roles and accessible names are public. Each is unique on its page, and names are exact. Everything else is free. Every review, interview note, job row, queue row, contribution, saved job, alert, application, applicant card and channel post is an element carrying `data-id="<record id>"`. Each pay row carries `data-id="<role family id>:<city id>"`. Every page has exactly one polite `status "Announcements"` region, which carries every announcement in Feedback states.

| Screen | Role and name | Visible copy or notes |
|---|---|---|
| Every page | `link "Lab jobs"`, `link "Companies"`, `link "Channels"`, `link "Share"` | Header navigation. Signed in as a member, also `link "My contributions"`, `link "Saved jobs"`, `link "My applications"`, `link "Alerts"` and `button "Sign out"`. Signed out, `link "Sign in"`. |
| Every page | `status "Announcements"` | Visually hidden. |
| Landing | `heading "Know the bench before you take the job."` | Followed by the sentence `Pay ranges open only once enough people have shared theirs, so no one can be picked out.` |
| Landing | `link "Search lab jobs"`, `link "For employers"` | The solid teal rectangle, and the top-right link to `/employer`. |
| Specimen tile | `figure` named by its caption | The caption under the tile names the item and one fact (Business rules, Derived values). |
| Sign in | `textbox "Email"`, password field labelled `Password`, `button "Sign in"`, `link "Forgot password?"` | |
| Join | `textbox "Display name"`, `textbox "Email"`, password field labelled `Password`, `button "Create account"` | |
| Forgot password | `textbox "Email"`, `button "Send reset link"` | |
| Reset password | password field labelled `New password`, `button "Change password"` | |
| Join confirm | `heading "Welcome to Candour Bench"` | |
| Job search | `combobox "Job title"` with `listbox "Job title suggestions"` of `option "<job title>"` | Up to 8 options. |
| Job search | `group "City"`, `group "Role"`, `group "Work pattern"`, `group "Pay band"`, each of `button "<label>"` chips with `aria-pressed` | Each chip's count sits beside it, outside its name. |
| Job search | `button "Clear filters"`, `button "Save alert"` | |
| Job search | `list "Job results"` of `listitem`, each with `link "<job title> at <company name>"` | Each item also shows city, work pattern and pay range. |
| Job search | the count line | `<count line>` (Feedback states), above the results. |
| Job search | `link "Next page"`, `link "Previous page"` | Shown only when that page exists. |
| Job search, empty | `link "Show all jobs"` | With the empty sentence from Feedback states. |
| Job search, phone | `button "Filters"`, `dialog "Filters"`, `button "Show <n> jobs"` | `Show 1 job` when n is 1. |
| Job search, outage | `alert` and `list "Jobs by city"` | |
| Company search, outage | `alert` and `list "Companies by city"` | Items are the companies of each city, each showing name, city, rating and review count. |
| Company search | `searchbox "Search companies"`, `group "City"` of chips, `list "Company results"` | Each result shows name, city, rating and review count. |
| Company page | `heading "<company name>"`, the text `Verified employer` when verified | |
| Company page | `list "Reviews"` of `article` items | Each shows `Anonymous bench member` and `<Month Year>`. |
| Company page | `table "Pay by role"` with columns Role, City, Reports, Low, Median, High | |
| Company page | `list "Interview notes"`, `list "Open jobs"` | |
| Company page | `region "Response from <company name>"` | Under its review: `<company name> replied in <Month Year>` and the reply text. |
| Company page | `region "Contribute once to unlock"` with `link "Share something"` | Text: `Share one review, pay report or interview note to unlock full pay and review detail.` |
| Company page, team | `button "Reply to <review title>"`, `textbox "Your public reply"`, `button "Post reply"` | Verified team only, and only on reviews without a reply. |
| Company page, phone | `tablist "Company sections"` of `tab "Reviews"`, `tab "Pay"`, `tab "Interviews"`, `tab "Jobs"`, with one `tabpanel` | |
| Contribute | `link "Write a review"`, `link "Report your pay"`, `link "Add an interview note"` | |
| Review form | `list "Review steps"` with items `Company`, `Ratings`, `Your review`, `Check and post` | The current item has `aria-current="step"`. |
| Review form | `heading "Step <k> of 4: <step name>"` | Focusable. |
| Review form | `combobox "Company"` with `listbox "Company suggestions"` of `option "<company name>"` | |
| Review form | `radiogroup "Overall rating"`, `radiogroup "Work-life balance rating"`, `radiogroup "Pay rating"`, `radiogroup "Management rating"`, each of `radio "1 star"`, `radio "2 stars"` … `radio "5 stars"` | |
| Review form | `textbox "Title"`, `textbox "Pros"`, `textbox "Cons"`, `button "Next"`, `button "Back"`, `button "Post review"` | |
| Pay form | `combobox "Company"`, `combobox "Role"`, `combobox "City"`, `spinbutton "Annual pay in rupees"`, `spinbutton "Years of experience"`, `button "Post pay report"` | |
| Interview form | `combobox "Company"`, `combobox "Role"`, `radiogroup "Difficulty rating"` of star radios, `radiogroup "Outcome"` of `radio "Got an offer"`, `radio "No offer"`, `radio "Never heard back"`, `textbox "What happened"`, `button "Post interview note"` | |
| My contributions | `list "My contributions"` | Each item shows its `<post label>` and status text. Editable items have `button "Edit <post label>"`, and deletable items have `button "Delete <post label>"`. |
| Delete dialog | `dialog "Delete this post?"` with `button "Delete post"` and `button "Keep post"` | |
| Saved jobs | `list "Saved jobs"` | Empty state: `You have not saved any jobs yet.` with `link "Search lab jobs"`. |
| Job page | `button "Apply now"`, `button "Save job"` (name fixed, `aria-pressed`) | The visible text reads `Save job` or `Saved`. A closed job shows `This job is closed.` and no Apply button. |
| Apply form | `textbox "Full name"`, `textbox "Contact email"`, `textbox "Phone (optional)"`, `textbox "Note to the employer (optional)"`, file field labelled `Resume (PDF, up to 5 MB)`, `button "Send application"` | |
| Apply, outage | `alert` and `button "Try again"` | |
| Application | `heading "Application sent"` | Shown right after a successful submit. |
| Application | `link "Download resume"` | |
| My applications | `list "My applications"` | Each item reads `<job title> at <company name>` and shows its `<Stage>`. |
| Alerts | `list "Saved alerts"` | Each item shows `<alert label>`, `<new count text>`, `link "See jobs for <alert label>"` and `button "Delete alert <alert label>"`. |
| Channels | `list "Channels"` of `link "<channel name>"` | |
| Channel | `heading "<channel name>"`, `log "Posts in <channel name>"` of `article` items, `textbox "Write a post"`, `button "Post"` | |
| Moderation | `table "Moderation queue"` | Each row shows Type, Company, Summary, Posted (`<Month Year>`) and Status, plus `button "Claim <post label>"`. Under the Summary, each row shows `list "History of <post label>"`, oldest first, with one item per history event. |
| Moderation, claimed row | `radiogroup "Decision"` of `radio "Approve"`, `radio "Reject"`; `radiogroup "Reason"`; `textbox "Reason details"`; `button "Submit decision"` | The Reason group appears when Reject is chosen, and the details field when `Other` is chosen. |
| Moderation, empty | `link "Back to job search"` | With the sentence `Nothing is waiting for review.` |
| Moderation | `alert` | Conflict and error copy, including the lease-ended copy. The page has one `alert`; a new message replaces the old one. |
| Employer home | `textbox "Work email"`, `button "Send code"`, `textbox "Verification code"`, `button "Verify"` | |
| Employer home | `list "Your jobs"` | Each item has `link "<job title>"`, `button "Close <job title>"` and, for drafts, `button "List <job title> again"`. |
| Employer home | `link "List a job"`, file field labelled `Lab mark (PNG)` | |
| New job | `textbox "Title"`, `combobox "Role"`, `combobox "City"`, `radiogroup "Work pattern"` of `radio "On site"`, `radio "Hybrid"`, `radio "Remote"`, `spinbutton "Pay from (rupees a year)"`, `spinbutton "Pay to (rupees a year)"`, `textbox "Description"`, `button "List job"` | |
| Pipeline | `group "Stage filter"` of chips `button "Submitted"`, `button "Screening"`, `button "Interview"`, `button "Offer"`, `button "Declined"`, and `button "Clear filters"` | |
| Pipeline | `list "Submitted"`, `list "Screening"`, `list "Interview"`, `list "Offer"`, `list "Declined"` | Each column has a heading `<Stage> (<n>)` and holds `button "<candidate name>, <Stage>"` cards. |
| Pipeline | `button "Export applicants CSV"` | |
| Founder | `table "Service health"`, `table "Members"`, `table "Companies"`, `table "Pay thresholds"` | |
| Founder | `button "Make <display name> a moderator"`, `button "Revoke verification for <company name>"` | |
| Founder | `form "Add company"` with `button "Add company"`; `form "Add employer user"` with `button "Add user"` | |
| Not found | `heading "Page not found"`, `link "Search lab jobs"` | Sentence: `It may have been removed, or the link is wrong.` |
| Loading | the tile frame with the text `Loading` | |

### Interactions (DP-10, DP-11, DP-12, DP-16, DP-30, DP-33, DP-35, DP-41, DP-44, DP-45)

- **Focus.** Every focusable control shows a visible focus ring: a deep teal outline at least 2 pixels thick, set a little outside the control. Tab order follows visual order on every page.
- **Dialogs and sheets** (`Menu`, `Filters`, `Delete this post?`). Opening one moves focus to its first control. Tab past the last control wraps to the first, and Shift+Tab before the first wraps to the last. Escape closes it, and focus returns to the control that opened it.
- **Star radiogroups.** When no star is chosen, Tab lands on `1 star`. Space chooses the focused star. ArrowRight and ArrowUp move to the next star and choose it, ArrowLeft and ArrowDown move to the previous one, and both wrap at the ends. Home chooses 1 and End chooses 5. Clicking a star chooses it.
- **Comboboxes** (`Company`, `Job title`). Typing filters the listbox after the search debounce. ArrowDown and ArrowUp move the active option (the field's `aria-activedescendant` points at it), stopping at the ends, and each move is announced. Enter selects the active option, puts its text in the field and closes the list. Enter with no active option keeps the typed text and runs the search. Escape closes the list and restores the text the user typed.
- **Review form steps.** Inside a step, Tab follows visual order and ends at `button "Next"`, or `button "Post review"` on the last step. Pressing Next on a step with an error keeps the step, shows the error under the field (linked through `aria-describedby`) and moves focus to the first invalid field. For a ratings group, that means the group's first radio. Pressing Next on a valid step moves focus to the next step's heading. `Back` returns to the previous step, keeps every value and focuses its heading.
- **Filter chips** (job search and pipeline). Space or Enter toggles a chip. Delete or Backspace on a pressed chip unpresses it and moves focus to the next chip in its list. If it was the last chip, focus goes to `button "Clear filters"`. On an unpressed chip those keys do nothing. Values within one facet combine with "or", and facets combine with "and". `Clear filters` unpresses every chip.
- **Job search URL.** The query and chips live in the URL as `/jobs?q=<text>&city=<city id>&role=<role family id>&remote=<work pattern id>&band=<pay band id>&page=<n>`. Each pressed value is its own repeated parameter. Reload and the back button restore the field, chips and results.
- **Filter sheet (phone).** `button "Filters"` opens `dialog "Filters"` as a bottom sheet holding the four chip groups and `Clear filters`. Chip presses take effect at once. `button "Show <n> jobs"`, Escape, or a downward swipe of at least 80 pixels that starts on the sheet's top edge closes the sheet. Each of these returns focus to `button "Filters"`.
- **Company tabs (phone).** Tapping a tab selects it. ArrowLeft and ArrowRight move between tabs and select them. A horizontal swipe of at least 60 pixels on the tab panel moves one tab: a leftward swipe goes to the next tab and a rightward swipe to the previous one, with no wrap. The URL becomes `?tab=reviews|pay|interviews|jobs` without a reload, and loading that URL selects the tab. The default is `reviews`.
- **Specimen tile and scroll.** As each pay row's centre crosses the window's middle, in either scroll direction, the tile shows that row's band. Scrolling back up runs the same change toward the earlier row. Above the first pay row, the tile shows the company's glassware.
- **Moderation queue.** The full key path is: Tab to a row's `Claim` button and press Enter, choose `Approve` or `Reject` in `Decision` with the arrow keys, choose a reason in `Reason` with the arrow keys, type in `Reason details` when `Other` is chosen, then Tab to `Submit decision` and press Enter. The focus result of each step is stated in Feedback states.
- **Pipeline cards.** Space or Enter on a card picks it up. ArrowLeft and ArrowRight move the drop target one column at a time over all five columns in order Submitted, Screening, Interview, Offer, Declined, stopping at the ends. Space drops the card on the target column. Dropping on the card's own column cancels the move. Escape cancels. Mouse and touch can also drag a card to a column. Focus stays on the moved card. The announcements are listed in Feedback states.
- **Channel composer.** Enter sends the post and Shift+Enter adds a new line. `button "Post"` also sends. After a successful send, the composer clears and keeps focus.
- **Review links in channels.** A channel post whose body contains a review's path (`/companies/<slug>/reviews/<id>`) shows a quote under the post: the review's title and its first 140 characters of pros.
- **Search debounce.** Typing in a search field, pressing chips and choosing filters run the search 300 milliseconds after the last change, measured on the page's own timers.

### Visual design (DP-05, DP-24)

- **Direction: split stage.** The site reads like a printed lab label: one deep teal ink on cool paper, everything stated in plain words, and a fixed half that never moves while you read.
- **Type.** Literata is used for both display and body text and is served from the site itself. Body text is large, about 18 pixels, in a comfortable reading measure of about 46 characters in the reading column. Each heading level is a quarter larger than the level below it. Figures in ratings, pay tables and bands use lining, equal-width digits so columns line up.
- **Colour roles.**
  - Ground: a very pale, cool grey-green paper. It sits behind the reading column and every full-width page.
  - Surface: a slightly deeper sage-grey. It fills the pinned right field.
  - Ink: a deep teal for all text.
  - Muted: a lighter, softer teal for secondary text and employer replies.
  - Accent: the same deep teal, used for solid buttons, the tile, the claimed queue row and bands.
  - On accent: the paper colour, used for text on teal.
  All text meets WCAG 2.2 AA contrast.
- **Density.** Comfortable, with generous space between blocks and no dividing lines between reviews.
- **Composition.** The landing and company pages are a 50/50 split along a straight vertical edge with no rule drawn on it. The left reading column scrolls on the ground. The right half fills the window height on the surface colour, stays pinned, and holds one square specimen tile.
- **Hero.**
  - The wordmark `Candour Bench` sits top-left with a wide margin, about 40 pixels.
  - Bottom-left on the ground sit the headline (about 28 to 40 pixels, growing with the window, medium weight), the softer-teal pay sentence and the solid teal `Search lab jobs` rectangle.
  - The right field holds a large teal tile, about a third of the window wide (about 450 pixels on desktop), with clearly rounded corners. On it, a line drawing of lab glassware (a pipette rack, a flask, a centrifuge rotor) is drawn in the paper colour at slightly reduced strength.
  - Under the tile sit the item name and one fact in small text.
  - The `For employers` link sits top-right on the field.
  - As the reading column passes each sample lab, the tile's object and fact change with a slow crossfade.
- **Imagery.** All imagery is drawn by the app as vector glassware, generated from the company or role name. Nothing is a photo or a fetched file, apart from an employer's own uploaded mark.
- **Working screens.**
  - Job search, the queue and the pipeline break the split and run full width on the ground.
  - Results are a single-column text list with no cards.
  - The queue is a table whose claimed row is filled teal with paper text.
  - The pipeline is five columns of plain text rows.
  - The `Contribute once to unlock` panel is the only inverted band: teal with paper text.
  - An empty state is one Literata sentence and one action.
  - Loading shows the tile frame with the label `Loading`.
  - Errors and outage banners are a full-width teal band with paper text.
- **Locked bands.** A locked or under-threshold band is a frosted tile with fine diagonal teal hatching and only its count sentence, like a slide still under its cover glass. It never shows a number.
- **Corner rule.** The tile has clearly rounded corners (about 24 pixels) and solid buttons are barely rounded (about 4 pixels). Nothing else is rounded.
- **Touch targets.** Every control is at least 44 by 44 pixels.

### Motion and effects (DP-06, DP-23, DP-34, DP-33, DP-41)

Each moving element publishes `data-motion="<name>"`, `data-motion-ms="<duration in milliseconds>"` and `data-state`. Its `data-state` reaches its end value once the published duration has passed on the page's own timers, whether or not the browser draws frames. `<html>` carries `data-motion-pref="reduced"` when the user prefers reduced motion, and `data-motion-pref="full"` otherwise.

| Name | Duration (ms) | On | States | Meaning and feel |
|---|---|---|---|---|
| `star-fill` | 160 | a rating radiogroup | `running` → `done` | The chosen stars fill quickly from the left and settle. |
| `save-toggle` | 200 | `button "Save job"` | `running` → `done` | The mark fills or empties with a short press. |
| `filter-sheet` | 280 | `dialog "Filters"` | `opening` → `open`, `closing` → `closed` | The sheet rises from the bottom quickly and settles softly, and sinks back the same way. |
| `toast` | 200 | the toast | `opening` → `open`, then `closing` → `closed` | It fades and lifts in. It starts to leave `TOAST_SECONDS` after opening, then is hidden. |
| `card-drop` | 240 | the moved applicant card | `running` → `done` | The card settles into its new column. |
| `band-crossfade` | 420 | the specimen tile | `running` → `done` | The tile crossfades to the band of the row in view. |
| `band-unhatch` | 320 | the tile's hatching | `covered`, then `running` → `done` | The hatching withdraws from left to right. |
| `band-count` | 600 | the tile's figures | `running` → `done` | Low, median and high count up to the server's values. |

Every motion starts quickly and settles gently. No motion lasts more than 0.6 seconds. Hover and press feedback on buttons is an immediate small darkening with no movement. There are no decorative loops, idle animations, parallax or autoplaying effects.

**Signature: Band resolve.**
1. On a company page, the pay table has one row per role and city.
2. As each row's centre crosses the window's middle, the tile's `data-band` becomes that row's `<role family id>:<city id>` and the tile crossfades to it (`band-crossfade`). Above the first row, `data-band` is `none` and the tile shows the company's glassware.
3. Under the threshold, the tile shows the hatching (`band-unhatch` at `covered`) and the row's count sentence (Business rules). The page holds no salary figure for that row in any text or attribute.
4. When a live approval brings the row to the threshold for an unlocked viewer:
   1. The row's count text changes at once to the at-threshold form.
   2. The announcement is made.
   3. If that row is in the tile, the hatching withdraws (`band-unhatch` `running` → `done`).
   4. The low, median and high figures count up (`band-count` `running` → `done`) and end exactly on the server's values.
   5. A median tick marked `data-part="median-tick"` drops onto the band at the median's position.
5. Scrolling back up crossfades to the earlier row's band in the same way, so the change runs identically in both directions.

**Reduced motion.** Every `data-motion-ms` reads `0`. Every `data-state` jumps straight to its end value. The tile changes with no crossfade. The hatching disappears and the final figures appear at once, with no counting. Sheets appear and disappear in place. Every text change, count change and announcement is the same as in the animated version.

### Feedback states (DP-06, DP-10, DP-16, DP-17, DP-20, DP-23, DP-25, DP-30, DP-31, DP-34, DP-37, DP-38, DP-39, DP-41, DP-44, DP-45)

**General rules.**
- While any action's request is in flight, its button is disabled, the caption `Working` appears beside it, and `status "Announcements"` reads `Working`. The exception is applying, which uses its own pending copy below.
- A field error appears under its field, linked through `aria-describedby`, and shows the API's `message` for that field.
- Any other API error appears in the page's `alert` with the API's `message`.
- Every live change made by another person reaches every open page it affects within two seconds, with no reload.

**Copy placeholders.**
- `<count line>`: `<n> jobs found`, or `1 job found` when n is 1, or `No jobs match these filters` when n is 0.
- `<applicant line>`: `<n> applicants shown`, `1 applicant shown`, or `No applicants shown`.
- `<kind>`: `review`, `pay report` or `interview note`.
- `<post label>`: a review's title; `Pay report: <role name> at <company name>`; or `Interview note: <role name> at <company name>`.
- `<reason>`: the chosen reason, or for `Other` the typed details.
- `<Stage>`: `Submitted`, `Screening`, `Interview`, `Offer` or `Declined`.
- `<new count text>`: `<n> new jobs`, `1 new job`, or `No new jobs`.

| Moment | What appears | Announced in `status "Announcements"` |
|---|---|---|
| Combobox active option moves | the option is highlighted | `<option text>, <i> of <n>` |
| Rating chosen | the stars fill | `<group label> rating: <n> of 5`, for example `Overall rating: 4 of 5` |
| Job search results arrive | the count line and results | `<count line>` |
| Job chip pressed or removed | the chip state, count line and results | `Filter added: <label>. <count line>.` or `Filter removed: <label>. <count line>.` (the change that started the search; with several changes in one debounce, the last one) |
| Pipeline chip pressed or removed | the visible columns | `Filter added: <Stage>. <applicant line>.` or `Filter removed: <Stage>. <applicant line>.` |
| Job saved or unsaved | the button state | `Saved <job title> at <company name>.` or `Removed <job title> from saved jobs.` |
| Alert saved | toast with the same text | `Alert saved for <alert label>` |
| Alert match arrives live | the alert's `<new count text>` updates | none |
| Post submitted | moves to My contributions with the post `Pending`, and a toast with the same text | `Thanks. Your <kind> is waiting for a moderator.` |
| Post edited | the item returns to `Pending` | `Changes saved. Your <kind> is waiting for a moderator.` |
| Post deleted | the item leaves the list | `Post deleted.` |
| Author's post claimed (live) | the status text `Claimed` | none |
| Author's post approved (live) | the status text `Approved` | `Your <kind> for <company name> was approved.` |
| Author's post rejected (live) | the status text `Rejected: <reason>` | `Your <kind> for <company name> was rejected: <reason>.` |
| Member unlocked (live) | the open company page shows full detail | `Full pay and review detail is now unlocked.` |
| Pay band resolves (live) | the Band resolve signature | `Pay range now shown for <role name>` |
| Employer reply arrives (live) | the reply region under the review | none |
| Reply posted | toast with the same text | `Reply posted.` |
| Verification code requested | the text `A code is on its way to <email>.` | the same text |
| Team verified | the text `Verified employer` | `Your team is verified.` |
| Job listed | toast with the same text | `<job title> is listed.` |
| Job closed | the item shows `Closed` | `<job title> is closed.` |
| Mark uploaded | the new mark | `Mark updated.` |
| Apply pending | the button is disabled with the caption `Sending your application` | `Sending your application` |
| Apply succeeded | `heading "Application sent"` takes focus | none |
| Apply refused | the API message under the field, or the `alert` for a conflict | none |
| Storage outage on apply | `alert` with the `storage_unavailable` message, every typed field and the chosen file kept, and `button "Try again"` resending them | none |
| Application stage changes (live) | the item's `<Stage>` | `Your application for <job title> is now at <Stage>.` |
| Pipeline card picked up | the card is raised | `Picked up <candidate name>, in <Stage>. Use Left and Right to move, Space to drop, Escape to cancel.` |
| Pipeline target moves | the target column is outlined | `<candidate name> over <Stage>.` |
| Pipeline card dropped | the card moves | `<candidate name> moved to <Stage>.` |
| Pipeline move cancelled | the card stays | `Move cancelled. <candidate name> stays in <Stage>.` |
| Pipeline move refused (illegal or 409) | the card stays | `<candidate name> cannot move to <Stage>.` |
| Pipeline move by a teammate (live) | the card and column headings update | none |
| Channel post sent | the post appears at the bottom of the log | `Posted in <channel name>.` |
| Channel post from someone else (live) | the post appears | `New post in <channel name>` |
| Missed channel posts replayed after a reconnect | each missed post appears once, in order, with no reload | `<n> new posts in <channel name>` (`1 new post in <channel name>`), once for the whole replay |
| Moderator claims a post | the row is filled teal with status `Claimed by you`, and focus moves to `radio "Approve"` | `Claimed <post label>.` |
| Moderator chooses Reject | `radiogroup "Reason"` appears; Tab from Decision enters it | none |
| Moderator submits without a reason | the field error under Reason, and focus moves to Reason's first radio | none |
| Decision recorded | the row shows `Approved by you` or `Rejected by you`, and focus moves to the next row's `Claim` button, or to `link "Back to job search"` when none is left | `Approved <post label>.` or `Rejected <post label>.` |
| Another moderator claims, decides or a claim lapses (live) | the row status becomes `Claimed by <moderator display name>`, `Approved by <moderator display name>`, `Rejected by <moderator display name>` or `Pending`; focus stays where it was | none |
| Stale claim or decision (409) | `alert` with the API's message, and focus stays on the pressed button | none |
| The claimant's own lease ends (live) | the decision form closes, the page's `alert` reads `Your claim on this post expired. Claim it again to decide.`, and the row's `Claim` button is back | none |
| History event (live) | the event's item is added at the end of the row's history list in every open queue | none |
| Search outage, job search | `alert` with `Search is unavailable right now. Showing all jobs by city instead.` and `list "Jobs by city"` | none |
| Search outage, company search | `alert` with `Search is unavailable right now. Showing all companies by city instead.` and `list "Companies by city"` | none |
| Search outage, listing a job | `alert` with the `search_unavailable` message | none |
| Empty job results | `No jobs match these filters` and `link "Show all jobs"` | the count line |
| Sign in failed | `alert` with the `invalid_credentials` message | none |
| Join submitted | `Check your email to finish joining.` | the same text |
| Forgot password submitted | `If that address has an account, a reset link is on its way.` | the same text |
| Password changed | moves to `/`, signed in | `Password changed. You are signed in.` |
| Founder appoints a moderator | the member's row shows `Moderator` | `<display name> is now a moderator.` |
| Founder revokes verification | the company's row shows `Not verified` | `Verification revoked for <company name>.` |

Moderated posts carry their date as `<Month Year>` with the full English month name, for example `March 2026`. Ratings always show one decimal, for example `4.0`. When a company has no approved review, the rating figure is replaced by `No ratings yet`. The review count reads `<n> reviews`, or `1 review`.

## Backend

### API (DP-02, DP-03, DP-09, DP-13, DP-14, DP-18, DP-19, DP-20, DP-26, DP-27, DP-28, DP-29, DP-36, DP-38, DP-39, DP-40, DP-42, DP-43, DP-45)

**General.**
- All routes are under the app's own origin.
- Requests and responses are `application/json; charset=utf-8` unless a route says otherwise.
- JSON bodies of up to 65,536 bytes are read (65,536 is allowed). Larger bodies answer `413 {"error":"payload_too_large","message":"That request is too large."}`, decided while reading the body and before every other check.
- Apply requests are `multipart/form-data`. Bodies of up to `RESUME_MAX_BYTES` plus 1,048,576 bytes are read; larger ones answer the same 413.
- The session cookie is `cb_session`: HttpOnly, SameSite Lax, path `/`. A session lasts 30 days.
- Malformed JSON answers 422 `validation_failed`.

**Error shape.** Every error body is `{"error":"<code>","message":"<copy>"}`.
- `validation_failed` adds `"fields":{"<field>":"<copy>"}` covering every invalid field.
- `contains_email` and `contains_phone` add `"field":"<field>"`.
- 429 adds a `Retry-After` header in whole seconds.

**Error precedence, for the whole API.** Checks run in this order, and the first failing check answers:
1. 401 `unauthenticated`: a protected route with no valid session.
2. 404 `not_found`: an unknown record, or one the caller may not see. That includes another member's pending, claimed or rejected post, a deleted post, a draft job seen from outside its team, another company's job, application, applicant, review reply target or resume, and an id inside a request body that points at any of these. A `company_id`, `user_id` or `company_slug` in a request body that names no existing record also answers 404 `not_found`; only a missing or non-text value for it answers 422 in step 6. Visibility never answers 403.
3. 403 `forbidden` or `not_verified`: a signed-in user whose role cannot use the route, or an unverified team on a team write route.
4. 429 `rate_limited`.
5. 409 conflicts.
6. 422 input errors. Field rules come first, then `contains_email`, then `contains_phone`, then `resume_not_pdf`, then `resume_too_large`.
7. 503 `search_unavailable` or `storage_unavailable`.

| Code | Status | Message |
|---|---|---|
| `unauthenticated` | 401 | `Sign in to continue.` |
| `invalid_credentials` | 401 | `Email or password is not right.` |
| `not_found` | 404 | `We could not find that.` |
| `forbidden` | 403 | `Your account cannot do that.` |
| `not_verified` | 403 | `Verify your employer team first.` |
| `rate_limited` | 429 | `Too many tries. Wait a minute and try again.` |
| `already_claimed` | 409 | `Already claimed by <moderator display name>.` |
| `already_decided` | 409 | `Already <approved\|rejected> by <moderator display name>.` |
| `not_claimed` | 409 | `Claim this post before deciding.` |
| `claim_expired` | 409 | `Your claim on this post expired. Claim it again to decide.` |
| `in_review` | 409 | `A moderator is reviewing this post. Try again shortly.` |
| `duplicate_review` | 409 | `You have already reviewed this employer this year.` |
| `duplicate_application` | 409 | `You have already applied for this job.` |
| `idempotency_mismatch` | 409 | `This application was already sent with different answers.` |
| `job_closed` | 409 | `This job is no longer taking applications.` |
| `already_replied` | 409 | `Your team has already replied to this review.` |
| `invalid_transition` | 409 | `That stage move is not allowed.` |
| `edit_window_closed` | 409 | `This post can no longer be edited.` |
| `validation_failed` | 422 | `Check the highlighted fields.` |
| `contains_email` | 422 | `Remove the email address before posting. Posts stay anonymous.` |
| `contains_phone` | 422 | `Remove the phone number before posting. Posts stay anonymous.` |
| `resume_not_pdf` | 422 | `Upload a PDF file.` |
| `resume_too_large` | 422 | `The resume must be 5 MB or smaller.` |
| `mark_not_png` | 422 | `Upload a PNG image.` |
| `mark_too_large` | 422 | `The mark must be 1 MB or smaller.` |
| `code_invalid` | 422 | `That code is not right. Check the email and try again.` |
| `code_expired` | 422 | `That code has expired. Ask for a new one.` |
| `token_invalid` | 422 | `This link has expired or was already used.` |
| `search_unavailable` | 503 | `Search is unavailable right now. The job is saved as a draft; list it again in a moment.` |
| `storage_unavailable` | 503 | `We could not store your resume right now. Your answers are kept; try again in a moment.` |

**Roles per route group.**
- Member routes (posts, saved jobs, alerts, applications, channels): `member`.
- Moderation routes: `moderator` and `founder`.
- Team routes: `employer_admin` and `recruiter` of the record's company. Verification routes: `employer_admin` only.
- Founder routes: `founder`.
- Any other signed-in role answers 403 `forbidden`.

**Health and grading**

| Method and path | Request | Success |
|---|---|---|
| `GET /api/health` and `GET /health` | — | `200 {"status":"ok"}`, or `200 {"status":"unavailable"}` while Meilisearch or MinIO is unreachable |
| `POST /api/grading/setup` | header `X-Grading-Token`; body below | `201 {"ids":{"<key>":"<id>"},"sessions":{"<user key>":"<cb_session value>"}}` |
| `POST /api/grading/clock` | header `X-Grading-Token`; `{"advance_seconds": <integer 0 to 31536000>}` | `200 {"now":"<ISO 8601 UTC time>"}` |
| `POST /api/grading/live/close` | header `X-Grading-Token` | `200 {"closed":<number of streams>}`: ends every open live stream on this instance at once; clients reconnect as usual |

All three grading routes answer `404 not_found` unless the environment sets `GRADING_TOKEN` and the header equals it. No page or link mentions them.

The setup body has optional arrays. Each item has a caller-chosen `key`, unique within the call, and items refer to one another by key:
- `users`: `{key, role, display_name, email, password, company?, unlocked?}`. The role is one of `member`, `moderator`, `employer_admin`, `recruiter`, `founder`. `company` is a company key or a seeded slug and is required for the employer roles. `unlocked` defaults to false.
- `companies`: `{key, name, slug, city, size, verified, email_domain, mark?}`. `mark: true` stores a generated PNG mark.
- `posts`: `{key, kind, company, author, state, claimed_by?, decided_by?, reason?, created_at, ...kind fields}`. `kind` is `review`, `pay_report` or `interview_note`. `state` is `pending`, `claimed`, `approved` or `rejected`. The kind fields are those of `POST /api/posts`. `author` is required for every post, and `claimed_by` and `decided_by` are moderator keys.
- `replies`: `{review, by, body}`.
- `jobs`: `{key, company, title, role_family, city, remote, pay_low, pay_high, description, status, listed_at}`. `status` is `draft`, `listed` or `closed`.
- `saved_jobs`: `{user, job}`.
- `alerts`: `{key, user, q, city[], role[], remote[], band[]}`.
- `applications`: `{key, job, user, candidate_name, contact_email, stage, applied_at}`, which stores a small generated PDF resume.
- `channels`: `{key, name, slug}`.
- `channel_posts`: `{key, channel, author, body, created_at}`. `channel` is a key or a seeded slug.

Setup writes straight to the records with no moderation, contact-detail checks, mail or rate limits. It still validates enums and references, and answers 422 `validation_failed` for a reused email, slug or company name. It indexes listed jobs and affected companies before it answers. The clock route adds the seconds to a server clock offset stored in the database, so every instance on that database shares it. It then runs every job that has fallen due (claim lapses, alert batches, outbox sends, search sync) before it answers.

**Accounts**

| Method and path | Request | Success | Extra errors |
|---|---|---|---|
| `POST /api/auth/sign-in` | `{email, password}` | `200 {"user":{"id","display_name","role","unlocked"}}`, sets `cb_session` | 401 `invalid_credentials` |
| `POST /api/auth/sign-out` | — | `204`, clears the cookie | |
| `GET /api/me` | — | `200 {"id","display_name","email","role","company_slug","unlocked"}` | |
| `POST /api/auth/join` | `{display_name, email, password}` | `202 {"status":"check_email"}` | 422 |
| `POST /api/auth/join/confirm` | `{token}` | `201` with the sign-in body, sets `cb_session` | 422 `token_invalid` |
| `POST /api/auth/forgot` | `{email}` | `202 {"status":"sent"}` | 422 |
| `POST /api/auth/reset` | `{token, password}` | `200` with the sign-in body, sets `cb_session` | 422 `token_invalid` |

Sign-in with an unknown address and sign-in with a known address and wrong password give the identical 401 body. Join and forgot password give the identical 202 body whether or not the address has an account. Every one of these replies takes the same time, to within 100 milliseconds, for known and unknown addresses: the server does the same password work in both cases and sends any email after replying. The emails sent are listed in Services.

**Companies and posts (public projection)**

| Method and path | Success |
|---|---|
| `GET /api/companies/<slug>` | `200` company (below). Open to everyone, including signed-out visitors. |
| `GET /api/companies/<slug>/reviews/<id>` | `200` review, only while approved |
| `GET /api/companies/options?q=<text>` | `200 {"options":[{"id","name","city"}]}`: up to 8 companies whose name contains the text, case-insensitive, in alphabetical order |
| `GET /api/companies/search?q=&city=&page=` | `200 {"total","page","page_size","hits":[company hit],"facets":{"city":{"<city id>":n}}}` |

The response keys are exactly these:
- **Company:** `slug, name, city, city_name, size, verified, mark_url, viewer_unlocked, rating, reviews, pay_rows, interview_notes, jobs`. `mark_url` is `/api/files/<id>` or null. `rating` is `{overall, work_life, pay, management, review_count}`, with each average a number or null.
- **Review:** `id, title, overall, work_life, pay, management, pros, cons, truncated, posted_month, author_label, reply`. `posted_month` is `YYYY-MM`, `author_label` is `Anonymous bench member`, and `reply` is null or `{company_name, body, posted_month}`.
- **Pay row:** `role_family, role_name, city, city_name, report_count, threshold, band`. `band` is null or `{low, median, high}` in whole rupees.
- **Interview note:** `id, role_family, role_name, difficulty, outcome, text, truncated, posted_month, author_label`.
- **Company hit:** `slug, name, city, city_name, size, verified, rating, review_count, pay_report_count`.

**Member posts**

| Method and path | Request | Success | Extra errors |
|---|---|---|---|
| `POST /api/posts` | review: `{kind:"review", company_id, overall, work_life, pay, management, title, pros, cons}`; pay report: `{kind:"pay_report", company_id, role_family, city, annual_pay, years_experience}`; interview note: `{kind:"interview_note", company_id, role_family, difficulty, outcome, text}` | `201 {"id","kind","state":"pending","label","company_name","posted_month"}` | 409 `duplicate_review`; 422 |
| `GET /api/me/posts` | — | `200 {"posts":[{"id","kind","label","company_name","state","reason","posted_month","editable"}]}` | |
| `PATCH /api/posts/<id>` | the kind's fields, except `kind` and `company_id` | `200` as in POST | 409 `edit_window_closed`, `in_review`; 422 |
| `DELETE /api/posts/<id>` | — | `204` | 409 `in_review` |

`state` in My posts is `pending`, `claimed`, `approved` or `rejected`. `outcome` is `offer`, `no_offer` or `no_reply`.

**Moderation**

| Method and path | Request | Success | Extra errors |
|---|---|---|---|
| `GET /api/moderation/queue` | — | `200 {"posts":[{"id","kind","label","company_name","posted_month","state","claimed_by_name", ...the kind's content fields}]}`: pending and claimed posts, oldest first | |
| `POST /api/moderation/<id>/claim` | — | `200 {"id","state":"claimed","claimed_by_name"}` | 409 `already_claimed`, `already_decided` |
| `POST /api/moderation/<id>/renew` | — | `200 {"id","state":"claimed","lease_ends_at"}` | 409 `already_claimed`, `already_decided`, `not_claimed`, `claim_expired` |
| `GET /api/moderation/<id>/history` | — | `200 {"events":[{"type","by_name","reason","at"}]}`, oldest first | |
| `POST /api/moderation/<id>/decision` | `{decision:"approve"\|"reject", reason?, details?}` | `200 {"id","state","decided_by_name"}` | 409 `not_claimed`, `claim_expired`, `already_claimed`, `already_decided`; 422 |

`reason` is one of `Identifies a person`, `Not about this employer`, `Abusive language`, `Duplicate post` or `Other`. It is required to reject, and `details` is required with `Other`. A moderator's re-claim of their own claim answers 200 and leaves the claim time unchanged.

**Employers**

| Method and path | Request | Success | Extra errors |
|---|---|---|---|
| `POST /api/employer/verification/request` | `{email}` | `202 {"status":"queued"}` | 429; 422 |
| `POST /api/employer/verification/confirm` | `{code}` | `200 {"verified":true}` | 422 `code_invalid`, `code_expired` |
| `POST /api/employer/reviews/<id>/reply` | `{body}` | `201 {"review_id","company_name","body","posted_month"}` | 409 `already_replied`; 422 |
| `POST /api/employer/jobs` | `{title, role_family, city, remote, pay_low, pay_high, description}` | `201` job with `"status":"listed"` | 422; 503 `search_unavailable` |
| `POST /api/employer/jobs/<id>/list` | — | `200` job with `"status":"listed"` | 503 `search_unavailable` |
| `POST /api/employer/jobs/<id>/close` | — | `200` job with `"status":"closed"` | |
| `GET /api/employer/jobs` | — | `200 {"jobs":[job]}` | |
| `GET /api/employer/jobs/<id>/applicants` | — | `200 {"applicants":[applicant]}` | |
| `GET /api/employer/applications/<id>` | — | `200` applicant | |
| `POST /api/employer/applications/<id>/stage` | `{stage}` | `200` applicant | 409 `invalid_transition` |
| `GET /api/employer/jobs/<id>/applicants.csv` | — | `200 text/csv; charset=utf-8`, attachment `applicants-<job id>.csv` | |
| `PUT /api/employer/company/mark` | raw `image/png` body | `200 {"mark_url"}` | 429; 422 `mark_not_png`, `mark_too_large` |

A reply to another company's review answers 404. A job is `{id, title, company_name, company_slug, city, role_family, remote, pay_low, pay_high, pay_band, description, status, listed_at}`.

An **applicant** has exactly the keys `id, job_id, candidate_name, contact_email, phone, cover_note, stage, applied_on, updated_on, resume_file_id`, which is only what the candidate typed into the apply form, plus the stage and dates. It never carries the member's account id, display name, account email, posts or any link to them. `stage` is `submitted`, `screening`, `interview`, `offer` or `declined`.

**Jobs, saved jobs, alerts and applications**

| Method and path | Request | Success | Extra errors |
|---|---|---|---|
| `GET /api/jobs/search?q=&city=&role=&remote=&band=&page=` | repeated filter params | `200 {"total","page","page_size","hits":[job summary],"facets":{"city":{},"role_family":{},"remote":{},"pay_band":{}}}` | |
| `GET /api/jobs/suggest?q=<text>` | — | `200 {"options":["<job title>"]}` | |
| `GET /api/jobs/<id>` | — | `200` job summary plus `description`, `status` | |
| `PUT /api/saved-jobs/<job id>` | — | `200 {"saved":true}` (repeat is the same) | |
| `DELETE /api/saved-jobs/<job id>` | — | `200 {"saved":false}` (repeat is the same) | |
| `GET /api/saved-jobs` | — | `200 {"jobs":[job summary]}`, newest saved first | |
| `POST /api/alerts` | `{q, city[], role[], remote[], band[]}` | `201 {"id","label","new_count":0}` | 422 |
| `GET /api/alerts` | — | `200 {"alerts":[{"id","label","new_count"}]}` | |
| `POST /api/alerts/<id>/seen` | — | `200 {"id","label","new_count":0}` | |
| `DELETE /api/alerts/<id>` | — | `204` | |
| `POST /api/jobs/<id>/applications` | header `Idempotency-Key`; multipart: `candidate_name`, `contact_email`, `phone`, `cover_note`, file `resume` | `201 {"id","job_id","stage":"submitted","resume_file_id","applied_on"}` | 429; 409 `job_closed`, `duplicate_application`, `idempotency_mismatch`; 422; 503 `storage_unavailable` |
| `GET /api/me/applications` | — | `200 {"applications":[{"id","job_id","job_title","company_name","stage","applied_on","updated_on"}]}` | |
| `GET /api/applications/<id>` | — | `200` the same item plus `candidate_name, contact_email, phone, cover_note, resume_file_id` | |
| `GET /api/files/<id>` | — | `200` the stored bytes with their content type | |

A job summary is `{id, title, company_name, company_slug, city, city_name, role_family, remote, pay_low, pay_high, pay_band, listed_at}`.

On a search outage, `GET /api/jobs/search` answers `200 {"fallback":"by_city","cities":[{"city","city_name","total","jobs":[job summary]}]}` built from PostgreSQL: every listed job, cities in alphabetical order, jobs newest listed first. `GET /api/companies/search` falls back the same way, answering `200 {"fallback":"by_city","cities":[{"city","city_name","total","companies":[company hit]}]}` built from PostgreSQL: every company, cities in alphabetical order, companies in alphabetical order by name, and `GET /api/jobs/suggest` answers `200 {"options":[]}`.

A resume file opens only for its candidate and the owning company's team. A company mark opens for everyone. Everyone else gets 404.

**Channels, live stream and founder**

| Method and path | Request | Success | Extra errors |
|---|---|---|---|
| `GET /api/channels` | — | `200 {"channels":[{"slug","name"}]}` | |
| `GET /api/channels/<slug>/posts` | — | `200 {"posts":[channel post]}`, oldest first | |
| `POST /api/channels/<slug>/posts` | `{body}` | `201` channel post | 422 |
| `GET /api/live` | — | `200 text/event-stream` | |
| `GET /api/founder/health` | — | `200 {"database","search","storage","mail","outbox_pending","search_sync_pending"}`, each service `ok` or `unavailable` | |
| `GET /api/founder/members` | — | `200 {"members":[{"id","display_name","email","role","company_slug"}]}` | |
| `POST /api/founder/moderators` | `{user_id}` of a member | `200` the member row with `"role":"moderator"` | 409 `invalid_transition` when the user is not a member |
| `POST /api/founder/companies` | `{name, slug, city, size, email_domain}` | `201` company hit | 422 |
| `POST /api/founder/employer-users` | `{company_slug, display_name, email, role}` | `201` member row; sends the set-password email | 422 |
| `POST /api/founder/companies/<slug>/revoke-verification` | — | `200` company hit with `"verified":false` | |
| `GET /api/founder/thresholds` | — | `200 {"rows":[{"company_slug","role_family","city","report_count","threshold","shown"}]}` | |

A channel post has exactly `id, channel_slug, body, posted_month, author_label, quote`. `quote` is null, `{review_id, company_slug, title, excerpt}`, or `{removed:true}` once the quoted review is gone.

**Live stream.** Every event is `event: <type>` with `data: <JSON>`, filtered to what that viewer may see. Events never carry author fields. The server sends a comment line every 15 seconds. The stream starts with `retry: 1000`, before any event. `hello` and the comment lines carry no `id:` line and use no id. Every other event carries an `id:` line, a decimal number that grows by one per event across the server and is the same for every viewer. On a reconnect that sends `Last-Event-ID`, the server first sends every kept event after that id that this viewer may see, in id order and with their original ids, and then `hello` with `{"replay":"complete"}`; the page applies the replayed events without reloading its data, so each missed item appears once and in order. On a first connect, or when that id is older than the kept range, the server sends `hello` with `{"replay":"reload"}`, and the page reloads its data from the API. The event types are:
- `queue.changed` `{post_id, state, by_name}`, to moderators.
- `queue.history` `{post_id, event}`, with the event as in the history route, to moderators.
- `post.state` `{post_id, state, reason}`, to the author.
- `member.unlocked` `{}`, to that member.
- `company.changed` `{slug, company}`, carrying the company in that viewer's projection, to everyone with the page open.
- `application.stage` `{application_id, job_id, stage}`, to the candidate and the owning team.
- `channel.post` `{channel_slug, post}`, to members.
- `alert.matched` `{alert_id, new_count}`, to the alert's owner.

### Business rules (DP-06, DP-13, DP-14, DP-15, DP-18, DP-19, DP-20, DP-21, DP-22, DP-25, DP-26, DP-27, DP-28, DP-29, DP-36, DP-37, DP-38, DP-39, DP-40, DP-42, DP-45)

**Timers and limits.** Each is read from the environment at start, with this default. Server-side durations use the server clock including the grading offset.

| Env var | Default | Rule and boundary |
|---|---|---|
| `EDIT_WINDOW_MINUTES` | 15 | An author may edit while fewer than this many minutes have passed since the post's `created_at`. At exactly the limit, editing is closed. |
| `EMAIL_CODE_TTL_SECONDS` | 600 | A code is accepted while fewer than this many seconds have passed since it was issued. At or after the limit it is expired. |
| `EMAIL_LINK_TTL_SECONDS` | 3600 | Join, reset and set-password links work the same way and are single use. |
| `ALERT_BATCH_SECONDS` | 300 | An alert batch is sent once at least this many seconds have passed since its first match. |
| `MIN_PAY_REPORTS` | 5 | A pay row shows figures at this count or more (inclusive). Allowed values are 2 to 50. |
| `REVIEWS_PER_COMPANY_PER_YEAR` | 1 | The number of reviews one member may post for one company within 365 days. |
| `RESUME_MAX_BYTES` | 5242880 | The largest resume accepted, in bytes. Exactly this size is allowed. |
| `UPLOAD_RATE_PER_MINUTE` | 5 | Upload requests (apply with a file, mark upload) per account in any 60 seconds. One more answers 429. |
| `CLAIM_LAPSE_SECONDS` | 600 | A claim lapses when at least this many seconds have passed since it was made or last renewed, whichever is later. |
| `APPLY_KEY_TTL_SECONDS` | 86400 | How long the server keeps an apply `Idempotency-Key` and its answer. A key older than this counts as new. |
| `LIVE_REPLAY_LIMIT` | 500 | The number of most recent live events the server keeps for replay. |
| `TOAST_SECONDS` | 5 | How long a toast stays open, on the page clock. |
| `SEARCH_PAGE_SIZE` | 20 | Results per search page. |
| `OUTBOX_RETRY_SECONDS` | 30 | The gap between attempts for unsent mail and pending search sync. |

Due jobs (claim lapses, alert batches, outbox sends, search sync) run at least every 5 seconds of real time and on every grading clock call.

**Reference values.**
- Cities: `harrowgate` Harrowgate, `kelvane` Kelvane, `brindlemoor` Brindlemoor, `saltmere` Saltmere.
- Role families: `research_assistant` Research Assistant, `qc_analyst` QC Analyst, `lab_manager` Lab Manager, `core_facility` Core Facility Specialist.
- Work patterns: `on_site` On site, `hybrid` Hybrid, `remote` Remote.
- Company sizes: `1-10`, `11-50`, `51-200`, `201-1000`.
- Pay bands: a job's band is fixed by its `pay_low`, with each lower bound included.
  - `under_4` `Under ₹4 lakh`: below 400000.
  - `4_6` `₹4–6 lakh`: 400000 to 599999.
  - `6_8` `₹6–8 lakh`: 600000 to 799999.
  - `8_10` `₹8–10 lakh`: 800000 to 999999.
  - `10_plus` `₹10 lakh and over`: 1000000 and up.
- Chips show these labels and appear in the order listed.

**Field rules.** Text lengths count characters after trimming, and limits are inclusive.

| Field | Rule | Copy |
|---|---|---|
| `display_name` | 2 to 40 characters | `Use 2 to 40 characters.` |
| `email`, `contact_email` | an email address | `Enter an email address.` |
| `password` | at least 10 characters | `Use at least 10 characters.` |
| `company_id` | present, as text (an id that names no company answers 404, as stated in the precedence order) | `Choose a company.` |
| `overall`, `work_life`, `pay`, `management`, `difficulty` | integer 1 to 5 | `Choose a rating from 1 to 5.` |
| `title` (review) | 5 to 120 characters | `Add a title of 5 to 120 characters.` |
| `pros`, `cons`, `text` | 20 to 3,000 characters | `Write 20 to 3,000 characters.` |
| `role_family` | a role family id | `Choose a role.` |
| `city` | a city id | `Choose a city.` |
| `annual_pay`, `pay_low`, `pay_high` | integer 100000 to 5000000 | `Enter yearly pay between ₹1,00,000 and ₹50,00,000.` |
| `pay_high` | at least `pay_low` | `The top of the range must be at least the bottom.` |
| `years_experience` | integer 0 to 40 | `Enter 0 to 40 years.` |
| `outcome` | one of the three outcomes | `Choose what happened.` |
| `reason` | one of the five reasons | `Choose a reason.` |
| `details` | 5 to 200 characters, required with `Other` | `Add 5 to 200 characters.` |
| reply `body` | 20 to 2,000 characters | `Write 20 to 2,000 characters.` |
| `title` (job) | 3 to 120 characters | `Use 3 to 120 characters.` |
| `remote` | a work pattern id | `Choose a work pattern.` |
| `description` | 40 to 5,000 characters | `Write 40 to 5,000 characters.` |
| `candidate_name` | 2 to 100 characters | `Use 2 to 100 characters.` |
| `phone` | empty, or 7 to 20 characters of digits, spaces, dashes and a leading + | `Enter a phone number or leave it empty.` |
| `cover_note` | at most 2,000 characters | `Use at most 2,000 characters.` |
| `resume` | a file part is present | `Choose a PDF resume.` |
| channel `body` | 1 to 2,000 characters | `Write 1 to 2,000 characters.` |
| verification `email` | an address at the company's email domain | `Use an address at <email domain>.` |

**Anonymity (DP-15).**
- Every review, pay report, interview note and channel post shows its author only as `Anonymous bench member`.
- No response, live event, search document, page or attribute served to any browser carries a post's author id, author email, author name or the member's display name. That covers moderators, employers and the author's own public views. The author's own My contributions lists only their own posts.
- Moderated posts and channel posts carry only month and year (`posted_month`), never a day or time.
- Review titles, pros and cons, interview note text, channel post bodies and reply bodies are refused with 422 when they contain an email address (`contains_email`) or a phone number (`contains_phone`). The email check runs first, and fields are checked in the order listed in the request. Both checks ignore any review path (`/companies/<slug>/reviews/<id>`) in the text, so a link to a review is never refused as a phone number.
  - An email address is text of the form name@domain.tld.
  - A phone number is a run of at least seven digits that may start with + and may have a single space, dash or dot between digits. Grouped figures with commas, such as `₹6,40,000`, are not phone numbers.
- A moderator never sees their own past posts in the queue, and a claim on one answers 404.

**Contribute to unlock (DP-25).**
- A member is unlocked from the moment one of their posts is first approved. Unlocking is stored on the account, so it holds after reload, on every device and in every session. A later rejection, edit or deletion never removes it.
- A locked viewer (a signed-out visitor, or a member who is not unlocked) gets reviews with `pros` and `cons`, and interview notes with `text`, cut to their first 140 characters, with `truncated: true`. The page shows the cut text followed by `…`.
- A locked viewer gets `band: null` on every pay row whatever the count, and sees the `Contribute once to unlock` panel.
- Unlocked members, employer users, moderators and the founder get full text and the bands the threshold allows.

**Moderation state machine (DP-16, DP-18, DP-19, DP-20).**
- Post states and moves:
  - `pending` → `claimed`, by a claim.
  - `claimed` → `approved` or `rejected`, by the claimant's decision.
  - `claimed` → `pending`, when the claim's lease ends.
  - `pending`, `approved` or `rejected` → `deleted`, by the author.
  - `pending` or `approved` → `pending`, by the author's edit within the edit window. Editing an approved post takes it off every public surface until it is approved again.
- A claim runs in one database transaction. The first claim in server order wins and records the claimant and the claim time.
  - A claim on a post claimed by someone else answers 409 `already_claimed` naming the current claimant.
  - A claim or decision on an approved or rejected post answers 409 `already_decided` naming the decider and the decision.
  - A decision or renewal on a pending post answers 409 `not_claimed`, except from the moderator whose lease on it ended most recently, which answers 409 `claim_expired`.
  - **Lease renewal.** While the decision form is open, the claimant's choice in `Decision` or `Reason` and their typing in `Reason details` call `POST /api/moderation/<id>/renew`, at most once every 5 seconds on the page clock: the first action renews at once, and any action within 5 seconds after a renewal is dropped, with no later catch-up renewal. So a claim followed by two choices 2 seconds apart gives exactly one `Claim renewed by <name>` item. A renewal restarts the lease from the server's now. A renewal by anyone else answers 409 `already_claimed`. A re-claim is not a renewal.
  - A decision by anyone other than the current claimant answers 409 `already_claimed`.
  - Edits and deletes of a claimed post answer 409 `in_review`.
  - Every refused attempt leaves the post, counters, index, mail and live events unchanged.
- **History.** Each claim, renewal, lapse and decision appends one history event in the same transaction: `type` is `claimed`, `renewed`, `expired`, `approved` or `rejected`; `by_name` is the moderator's display name, or null for `expired`; `reason` is set for `rejected` only. Refused attempts append nothing. The item texts are `Claimed by <name>`, `Claim renewed by <name>`, `Claim expired`, `Approved by <name>` and `Rejected by <name>: <reason>`.
- Each claim, decision and lapse sends `queue.changed` to every open queue and `post.state` to the author. Each history event sends `queue.history` to every open queue.
- An approval or rejection queues one outcome email to the author.

**Derived values (DP-21, DP-22, DP-29).** These are computed on the server from approved records only. Pending, claimed, rejected, edited-back-to-pending and deleted posts never count. The company page, company search documents, live events and the founder's thresholds all read the same computation, so they agree everywhere and after reload. An approval, rejection, edit or deletion changes each value exactly once.
- **Rating:** each of `overall`, `work_life`, `pay` and `management` is the mean over approved reviews, rounded half up to one decimal on the exact mean (a mean of 4.25 gives 4.3). With no approved review each is null. `review_count` is the number of approved reviews.
- **Pay row:** there is one row per role family and city with at least one approved pay report at the company, ordered by role family then city in reference order. `report_count` is the number of approved reports, and `threshold` is `MIN_PAY_REPORTS`. When `report_count` is at least the threshold and the viewer is unlocked, `band` is low = 25th percentile, median = 50th and high = 75th, interpolated linearly between closest ranks (the same result as PostgreSQL's continuous percentile), each rounded half up to whole rupees. Otherwise `band` is null, and no figure from those reports leaves the server in any response, event, document or page.
- **Pay row text:** below the threshold, the row's Reports cell and the tile read `<n> of <threshold> reports. The range opens at <threshold>.` At or above it, the Reports cell reads `<n> reports`. For a locked viewer at or above the threshold, the tile reads `Share one post to see this range.`
- **Tile caption:**
  - Over the glassware: `<company name>, <city name>. <review count line>`, where the line is `<n> reviews`, `1 review` or `No ratings yet`.
  - On the landing page, for each sample lab's first pay row: `<role name>, <city name>. Pay range from <n> reports` at or above the threshold, else `<role name>, <city name>. <n> of <threshold> reports so far`.
- **Money:** whole Indian rupees with Indian digit grouping and no decimals, for example `₹6,40,000`. A range reads `<low> – <high>` with a spaced en dash, for example `₹5,20,000 – ₹7,10,000`. The tile also shows `Median <median>`. The API returns integers.
- **Search facets:** facet counts are the search index's facet distribution for the current query and filters. The index holds only listed jobs, and companies with their approved-only counts, so its counts never include draft or closed jobs or unapproved posts.

**Review limit (DP-13).** A member may post `REVIEWS_PER_COMPANY_PER_YEAR` reviews for one company within any rolling 365 days. Every review they posted for that company counts, whatever its state, including deleted ones. A review stops counting once 365 days have passed since its `created_at`; exactly 365 days is no longer counted. One more review answers 409 `duplicate_review`.

**Deletion (DP-26).** A deleted post answers 404 at its API route, its review link and its company page anchor. It leaves the company page, the rating, the counts and the pay rows. Its company's search document is updated before the delete answers. Every channel quote of it becomes `{removed:true}` and shows `Quoted review removed.` in place of the quote. Open company pages receive `company.changed`.

**Employer verification and replies (DP-27, DP-28).**
- A code is six random digits. A new request replaces the previous code, so the old one answers `code_invalid`.
- More than 3 requests per company within `EMAIL_CODE_TTL_SECONDS` answers 429.
- A correct, unexpired code verifies the company.
- Only a verified team may reply, list, relist or close jobs, or move applicants. An unverified team answers 403 `not_verified`.
- Each review has at most one reply. The reply is public at once, shows under its review for every viewer, and sends `company.changed`. A reply carries only the company name, never the replying person.

**Jobs (DP-36).**
- Job states: `draft` → `listed`; `listed` → `closed`; `draft` → `closed`.
- Creating or relisting writes the job, adds its search document, and waits for the indexing task to finish. Only then does the job become `listed` and the request answer.
- If indexing fails or search is unreachable, the job stays `draft` and the request answers 503 `search_unavailable`.
- Closing removes the document before answering. Applying to a closed job answers 409 `job_closed`.
- A draft job is visible only to its team.

**Job alerts (DP-37).**
- An alert stores the query text and chips. Its `label` is the trimmed query text (if any) followed by each chip label in facet order (City, Role, Work pattern, Pay band) and list order, joined by `, `. With no query and no chips the label is `All jobs`. For example: `qc, Harrowgate, Remote`.
- When a job becomes listed, it matches every alert whose chips it satisfies and, when the alert has text, whose text search returns that job.
- Each match adds one to the alert's `new_count` and sends `alert.matched`. Opening `See jobs for <label>` calls seen and resets the count.
- An alert's first match opens a batch. Once `ALERT_BATCH_SECONDS` have passed, exactly one email lists every job matched in that batch that is still listed, newest listed first. A batch whose jobs have all closed sends nothing.

**Uploads and applications (DP-38, DP-39).**
- A resume is a PDF only when its first five bytes are `%PDF-`. The file name and declared type never count.
- A resume of up to `RESUME_MAX_BYTES` bytes is accepted.
- An application is created only after storage confirms the object exists with the exact stored size. Until then nothing is recorded. If storage is unreachable or does not confirm, the request answers 503 `storage_unavailable` and leaves no application and no object.
- One member has at most one application per job. Of simultaneous or repeated submits with different idempotency keys, exactly one answers 201 and every other answers 409 `duplicate_application`, and no extra object remains in storage.
- **Idempotency key.** The apply form makes one `Idempotency-Key` (a random UUID) when it opens and sends it on every submit of that form, including `Try again`. A submit that repeats a completed 201 submit's key, from the same member with the same answers and the same file bytes, answers that stored 201 body again and creates nothing. The same key with different answers or a different file answers 409 `idempotency_mismatch`. Simultaneous submits with one key create at most one application, and each of them answers the same 201 body. A submit without the header answers 422 `validation_failed` with the field `idempotency_key` and the copy `Reload the form and try again.` A key that ended in an error is not stored, so `Try again` with it is a fresh attempt.
- A mark is a PNG only when its first eight bytes are the PNG signature, and is at most 1,048,576 bytes (exactly that size is allowed).

**Pipeline (DP-40).**
- Stages run in order `submitted`, `screening`, `interview`, `offer`, plus `declined`.
- A move is legal when it goes one step forward, goes one step back, or goes from any non-declined stage to `declined`. `declined` is final.
- Any other move, including a move to the current stage, answers 409 `invalid_transition`.
- Moves on one application are applied one at a time, each judged against the stage current at its turn.
- Each legal move sends `application.stage` and queues one stage email to the application's contact email.

**Applicants CSV (DP-43).**
- UTF-8 with no byte order mark and CRLF line ends.
- Header `application_id,candidate_name,job_title,stage,applied_on,updated_on`, then one row per application of the job, all stages included, newest applied first, with ties broken by id ascending.
- `stage` is lower case. Dates are `YYYY-MM-DD` in UTC.
- A field containing a comma, double quote or line break is enclosed in double quotes, with each inner quote doubled.

**Channels (DP-45).** Only members read and post in channels. Posts appear at once, oldest first, and each new post sends `channel.post`.

### Services (DP-07, DP-29, DP-31, DP-36, DP-37, DP-39)

**PostgreSQL** (`DATABASE_URL`) holds every record:
- members and roles, sessions, companies and teams, verification codes;
- posts with moderation state, claims and decisions;
- employer replies, jobs, saved jobs, alerts and alert batches;
- applications and stage history, channels and channel posts;
- the outbox, the search sync queue, the clock offset and an audit of every claim, decision and stage move.

The app applies its schema and the seed data idempotently every time it serves.

**Meilisearch** (`MEILISEARCH_URL`, `MEILISEARCH_API_KEY`).
- **Index `jobs`**, primary key `id`, holds one document per listed job with fields `id, title, company_id, company_name, company_slug, city, city_name, role_family, role_family_name, remote, pay_band, pay_low, pay_high, listed_at` (Unix seconds).
  - Searchable: `title`, `company_name`, `city_name`, `role_family_name`.
  - Filterable: `city`, `role_family`, `remote`, `pay_band`, `company_id`.
  - Sortable: `listed_at`.
- **Index `companies`**, primary key `id`, holds one document per company with fields `id, slug, name, city, city_name, size, verified, rating, review_count, pay_report_count`. `rating` is the overall average or null, and `pay_report_count` counts approved reports. The documents contain no pay figure.
  - Searchable: `name`, `city_name`.
  - Filterable: `city`, `verified`.
- **Behaviour.** Typo tolerance is on with the default rules: one typo from five letters, two from nine, so `harowgate qc` finds QC jobs in Harrowgate. An empty query sorts newest listed first; otherwise results come in relevance order. Suggestions are the distinct titles of the top hits.
- **Sync.** Every approval, rejection of a previously approved edit, edit, delete, reply, verification change, job listing and closing updates the affected document and waits for the task before answering. The exception is job listing, which follows the job rule in Business rules: when search is down, the other writes still succeed and a search sync entry is queued and retried until it is applied. On every start, the app makes both indexes match PostgreSQL.
- **Outage.** Job and company search show the fallback from Feedback states, and the health route reports `unavailable`.

**MinIO** (`S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_FORCE_PATH_STYLE`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`).
- A resume is stored byte for byte at `resumes/<resume_file_id>.pdf` with content type `application/pdf`. A mark is stored at `marks/<company id>.png` with content type `image/png`. File ids are random UUIDs.
- The browser never receives a storage URL or credential. Files stream through `GET /api/files/<id>`.
- **Outage.** Apply answers 503 `storage_unavailable`, marks are replaced by the drawn glassware, and the health route reports `unavailable`.

**Mailpit** (`SMTP_HOST`, `SMTP_PORT`, `MAIL_FROM`).
- Every email is plain text from `MAIL_FROM`, which is `Candour Bench <no-reply@candour-bench.test>`.
- Every email is first written as an outbox row in the same transaction as the action that causes it. A sender claims each row and sends it once. On failure it retries every `OUTBOX_RETRY_SECONDS` until it succeeds. Any instance on the database may send a row, but no row is sent twice. An instance claims rows only while its own SMTP server answers, so an instance that cannot reach SMTP leaves every row for the others.
- No email carries review, pay report, interview note or channel text, or any reviewer's identity. Links use `APP_PUBLIC_URL`.
- The app sends only these emails:

| Email | To | Subject | Body includes |
|---|---|---|---|
| Verification code | the work email | `Your Candour Bench verification code` | `Your code is <code>. It expires in <minutes> minutes.`, where minutes is `EMAIL_CODE_TTL_SECONDS` divided by 60, rounded up |
| Join | a new address | `Finish joining Candour Bench` | `<APP_PUBLIC_URL>/join/confirm?token=<token>` |
| Join, existing account | an existing address | `You already have a Candour Bench account` | links to `/sign-in` and `/forgot-password` |
| Reset | an existing address | `Reset your Candour Bench password` | `<APP_PUBLIC_URL>/reset-password?token=<token>` |
| Set password | a new employer user | `Set your Candour Bench password` | `<APP_PUBLIC_URL>/reset-password?token=<token>` |
| Moderation outcome | the author's account email | `Your post on Candour Bench was <approved\|rejected>` | `Your <kind> for <company name> was <approved\|rejected>.`, plus `Reason: <reason>.` when rejected |
| Stage change | the application's contact email | `Your application for <job title> at <company name>` | `Your application is now at the <Stage> stage.` |
| Job alert | the alert owner's account email | `<n> new lab jobs for <alert label>`, or `1 new lab job for <alert label>` | one line per job, `<job title> at <company name>, <city name>, <pay range>`, then `<APP_PUBLIC_URL>/jobs/<id>` |

- **Outage.** Every action succeeds as normal, mail waits in the outbox, the founder's health shows `mail` `unavailable` with the backlog, and no screen claims an email was delivered.

### Seed data (DP-08, DP-29)

Every seeded company, city and figure is invented, and there are no seeded people. On every serve the app inserts any of these that are missing.
- **Cities and role families:** as listed in Business rules.
- **Channels:** `bench-pay-talk` `Bench pay talk`; `interview-prep` `Interview prep`; `core-facility-life` `Core facility life`.
- **Sample labs:** all unverified, with no team, mark, jobs, reviews or interview notes, shown on the landing page in this order:

| Slug | Name | City | Size | Email domain |
|---|---|---|---|---|
| `fernhollow-assay-labs` | Fernhollow Assay Labs | harrowgate | `51-200` | `fernhollow.test` |
| `thistlecombe-biologics` | Thistlecombe Biologics | kelvane | `11-50` | `thistlecombe.test` |
| `larkspur-core-facility` | Larkspur Core Facility | brindlemoor | `11-50` | `larkspur.test` |

- **Approved pay reports:** these have no member author, 2 years of experience and month `2026-03`.
  - Fernhollow Assay Labs, QC Analyst, Harrowgate: 480000, 510000, 530000, 560000, 580000, 600000, 620000, 650000, 690000, 720000, 780000.
  - Thistlecombe Biologics, Research Assistant, Kelvane: 360000, 410000, 445000.
  - Larkspur Core Facility, Core Facility Specialist, Brindlemoor: 520000, 560000, 600000, 640000, 700000, 760000.

  For example, with the seed data at start and the default threshold, an unlocked viewer sees:
  - Fernhollow's row as `11 reports` with `₹5,45,000 – ₹6,70,000` and `Median ₹6,00,000`.
  - Larkspur's row as `6 reports` with `₹5,70,000 – ₹6,85,000` and `Median ₹6,20,000`.
  - Thistlecombe's row as `3 of 5 reports. The range opens at 5.`
- **Founder:** if `FOUNDER_EMAIL` and `FOUNDER_PASSWORD` are set and no founder exists, the app creates a founder with display name `Founder`.

## Technical requirements

### Deployment (DP-01)

- **Runtime.** The app is TypeScript on Node.js 22.
- **Run manifest.** `/app/run.json` holds string `install`, `build` and `serve` commands and `"_schema":"run-manifest-v1"`. For example:
  ```json
  {"_schema":"run-manifest-v1","install":"npm ci","build":"npm run build","serve":"node dist/server.js"}
  ```
- **Serving.** The server binds `0.0.0.0` on port 4173, or on `APP_PUBLIC_PORT` when that is set.
- **Health.** `GET /api/health` and `GET /health` answer as stated in API.
- **Grading instances.** Outage copies of the app run on further ports with one service address broken, and share the same database.

### Configuration and secrets (DP-04)

- **Read once at start:**
  - services: `DATABASE_URL`, `MEILISEARCH_URL`, `MEILISEARCH_API_KEY`, `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_FORCE_PATH_STYLE`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `SMTP_HOST`, `SMTP_PORT`, `MAIL_FROM`, `MAILPIT_URL`;
  - app: `APP_PUBLIC_URL`, `APP_PUBLIC_PORT`, `GRADING_TOKEN`, `FOUNDER_EMAIL`, `FOUNDER_PASSWORD`;
  - every timer and limit in Business rules.
- **Never exposed.** No credential, key, token or service address is hard-coded, logged in responses, or sent to the browser. The browser receives only `TOAST_SECONDS`, `MIN_PAY_REPORTS` and `SEARCH_PAGE_SIZE`.
- **Passwords** are stored only as slow salted hashes.

### Server boundary (DP-03, DP-04)

- **Same origin only.** The app sends no cross-origin allowance headers. State-changing requests from another origin are refused with 403 `forbidden`.
- **Request size.** Body limits are as stated in API.
- **What is served.** The server serves only the built client assets and the API. It never serves source files, the run manifest, environment files, lockfiles or credentials. Unknown paths get the not-found page with 404.
- **Self-contained pages.** Pages load nothing from another origin: no web fonts, CDN, image host or analytics. No service worker is registered.
- **Startup with a dependency down.** If Meilisearch, MinIO or Mailpit is unreachable at start, the server still starts and serves, with the outage behaviour from Services, and keeps retrying. If PostgreSQL is unreachable, it retries every 2 seconds, and the health routes answer `503 {"status":"starting"}` until it connects.

### Browser support and performance (DP-32)

- **Browsers and sizes.** The latest Chromium, Firefox and WebKit, at the three published viewports.
- **Responsiveness.**
  - Every page is usable within three seconds of opening.
  - Search results replace the old ones within one second after the debounce.
  - Live changes appear within two seconds.
- **No canvas text.** Every page renders as DOM elements.

## Working rules

- IF-01: `/app/run.json` exists, is valid JSON, and holds exactly the string keys `install`, `build`, `serve` and `"_schema":"run-manifest-v1"`.
- IF-02: `/app/THIRD_PARTY_NOTICES.md` lists every shipped package and the Literata font, each with its licence. "Shipped packages" means the production dependency tree from `npm ls --omit=dev --all --json`.
- IF-03: Every shipped package (the production tree from `npm ls --omit=dev --all --json`) is under MIT, ISC, BSD-2-Clause, BSD-3-Clause, Apache-2.0, 0BSD or BlueOak-1.0.0, and the font is under OFL-1.1.
- IF-04: The app uses no datastore beyond PostgreSQL, Meilisearch and MinIO: no SQLite, Redis, file-based database, or in-memory store used as a source of truth.
- IF-05: No source or built file references an external origin for scripts, styles, fonts or images.
- IF-06: The provided service configuration and its environment values are not changed.
- IF-07: Application source is TypeScript compiled with strict type checking turned on.

## Engineering standards

- The code is idiomatic, strictly typed TypeScript. Names match this brief's domain terms: post, claim, decision, pay row, threshold, band, alert batch, outbox, applicant, stage.
- Each domain rule is decided in exactly one place in the source: each state machine's legal moves, the error precedence, the rating and percentile calculations, the anonymity projection, the unlock rule and the contact-detail checks.
- Every API error goes through the one published error shape; no route builds its own.
- There is no abstraction with a single implementation, no dead, commented-out or unreachable code, and no defensive check for a state the rules make impossible.
- Live updates, mail and search sync come from committed database changes, never from optimistic client state or app self-reports.
- No feature, route, setting or dependency exists beyond this brief.
