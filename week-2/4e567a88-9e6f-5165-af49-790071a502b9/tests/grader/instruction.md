# Lumenfold Dispatch

Lumenfold Dispatch is a hosted service for in-house creative and product teams that run image, video and audio generation models. Product squads submit generation jobs from their own code or from a playground form. Each job is paid for from the team's prepaid credit pool, and each model is metered in its own output unit. Every reservation, charge and release appears in a ledger that a finance controller can reconcile to the micro-credit. Dispatch stores its records in Postgres and its input and output media in MinIO object storage. It takes prepaid top-ups through Kill Bill and sends notices by email through an SMTP server, which is Mailpit in development and grading. Generation itself is simulated: Dispatch hosts no real models, and each run produces deterministic placeholder media of the requested size and length. Out of scope: self-service sign-up, password reset, real model inference, payment card entry, multiple organisations per installation, and any datastore beyond Postgres and MinIO.

## Problem and users

Mid-size companies now generate images, video and audio inside their products and marketing pipelines. Their platform teams pay for this from prepaid credit pools that several product squads share. Each model bills in a different unit: per image, per output megapixel, or per second of generated media. A mobile client on a poor network that retries a ten-second video request can be billed twice. A burst from one squad uses up the concurrency headroom that another squad's live, public product feature needs. When finance changes a model's rate, nobody can say whether jobs already in the queue were charged the old rate or the new one. Today the platform engineer rebuilds monthly spend from invoice exports and webhook logs in a spreadsheet and writes their own retry wrappers. Media that legal asked them to delete still turns up in search results and "derived from" graphs. The finance controller pays for the double bills, and the engineer pays in on-call hours.

- **Platform engineer** (daily): submits jobs over the API with an Idempotency-Key and receives signed webhooks. They need to trust that one logical request means one charge.
- **Creative operator** (daily): runs catalogue models from playground forms generated from each model's input schema, and reuses outputs as inputs to later runs.
- **Org admin** (weekly): decides which models each team may use from the API and from the playground (allowed, blocked or inherit), who may see request payloads, budget soft and hard caps, and how long media is kept.
- **Finance controller** (weekly): tops up team credit pools, reconciles reserved against settled spend to the micro-credit, and schedules rate changes that take effect at a known moment.
- **Compliance reviewer** (occasional): confirms that expired or deleted media is gone from storage, search and lineage, and that restricted payloads stay hidden.

## Journeys

1. **Retrying a video job without paying twice.** Start: Mara (platform engineer, Storefront) holds an API key, and Storefront has its seeded pool. Mara posts a Reel 10 job with an Idempotency-Key. The response is lost, so Mara's client posts the identical request again. End: both responses name the same job. The Jobs list shows one job, and the credit meter shows one vermilion notch for it. The notch briefly highlights on the retry and nothing new is reserved.
2. **Running a model from the playground and reusing the output.** Start: Ines (creative operator, Campaigns) is signed in on the Run screen. Ines picks Halftone XL in the catalogue rail, fills the generated form and presses Run. A notch slides out of the available segment and the job appears in the Halftone XL lane. When the job succeeds, the notch merges into settled and the output appears in the lineage strip. Ines opens the output, chooses "Use as input" and runs Reel 10 with it as the start frame. End: the lineage strip shows the video output linked to the image it was derived from.
3. **Topping up and reconciling.** Start: June (finance controller) is on the Finance screen. June tops up Campaigns with 1,000 credits. End: the top-up shows as paid with its Kill Bill invoice id, the ledger shows a paired movement, the ribbon's available segment grows, a receipt arrives by email, and the exported ledger CSV sums to the ribbon totals.
4. **Changing a rate on a known date.** Start: June schedules a new Reel 10 rate for a future moment in the org time zone. Mara submits one job before that moment and one after it. End: Jobs and the ledger show the first job settled at the old rate, even though it finished after the change, and the second at the new rate.
5. **Setting policy.** Start: Rafael (org admin) is on the Admin screen. Storefront payloads are visible to the team, and Theo can read the prompt of a finished Storefront job that Mara submitted. Rafael blocks Murmur Voice for Campaigns playground runs, lowers the Campaigns soft cap and sets Storefront payloads to restricted, then saves. End: the policy shows a new version number. Ines finds Murmur Voice marked blocked in the rail. Theo reloads Storefront jobs and sees the status, model and cost of Mara's job, with "Hidden — restricted payload" where the prompt was.
6. **Webhooks that fail and recover.** Start: Mara adds a webhook endpoint for Storefront and copies the signing secret, which is shown once. Completed jobs deliver signed events. Mara's endpoint then starts failing, and the delivery log shows retries on the published schedule. After the published number of failures the endpoint shows as disabled and the org admins receive an email. Rafael re-enables it. End: the endpoint is active and the next event is delivered.
7. **Deleting media for legal.** Start: Sol (compliance reviewer) searches the Library for an output that a later video was derived from. Sol deletes it. End: the asset is gone from search, its direct link answers "gone", its storage object no longer exists, and the video's lineage shows a tombstone in its place with no thumbnail or prompt.
8. **Working through a storage outage.** Start: object storage is unreachable. Mara keeps submitting text-only jobs. End: each job is reserved and queued, its lane shows it waiting for storage, the Service status notice explains why, and uploads are refused with the storage copy. When storage returns, the queue drains with no restart.

## Mandatory requirements

This is the complete list of mandatory requirements; every check traces to one of these lines and the detailed sections below.

- **DP-01 — Job submission over the API** A member's `POST /api/jobs` with a Bearer key and an Idempotency-Key creates one queued job and one reservation of its estimated cost, answering 201 with the job.
- **DP-02 — Replay returns the original response** Repeating a submission with the same Idempotency-Key and the same body in the same team returns the stored first response and creates no job, reservation or ledger movement.
- **DP-03 — Reused key with a different body** Reusing a team's Idempotency-Key with a different model, input or priority is refused with the `idempotency_key_reused` conflict and changes nothing.
- **DP-04 — Simultaneous retries make one job** Parallel submissions that share one Idempotency-Key and body produce exactly one job and one reservation, and every response names that job.
- **DP-05 — Inputs checked against the model schema** Each submission's input is validated against the model's published input schema, and a failure answers 422 with one message per offending field.
- **DP-06 — Job lifecycle and cancellation** Jobs move only along the published state machine; cancelling a queued, leased or running job releases its whole reservation, and cancelling a succeeded or failed job is refused.
- **DP-07 — Engineer retry journey** A platform engineer who submits a video job over the API and retries it sees one job in the Jobs list and one notch on the ribbon, and that notch highlights on the retry.
- **DP-08 — Team concurrency budget** A team never has more leased or running jobs than its concurrency budget, and when several submissions race for the last slot exactly one starts and the rest stay queued.
- **DP-09 — Dispatch order** Within a team, queued jobs start by priority and then by submission time, and a queued job whose model has since been blocked for its context fails instead of starting, as qualified in Business rules.
- **DP-10 — Queue lanes report live state** `GET /api/queue` and the Queue region list every queued and running job of a team per model with its queue position, updated as qualified in Business rules.
- **DP-11 — Queue lanes journey** An engineer submits three jobs when the team has one free slot and watches one run while the others wait in order in their lanes, then start as slots free.
- **DP-12 — Schema-generated run form** Choosing a model in the catalogue renders a run form whose fields, labels, defaults, limits and order come from that model's input schema.
- **DP-13 — Image addresses fetched safely** An image URL given as a model input is fetched and stored only when it and every redirect target resolve to a public address; otherwise the submission answers 422 on that field.
- **DP-14 — Image uploads** A member can upload a PNG, JPEG or WebP image within the upload limit in Server boundary; it is stored in object storage and becomes an asset usable as an input.
- **DP-15 — Outputs reused as inputs** Passing an asset as a media input records a "derived from" edge from that asset to every output of the new job, visible in lineage.
- **DP-16 — Playground run journey** A creative operator picks a model, fills the generated form, runs it, sees the output in the lineage strip, and uses that output as the media input of a second run.
- **DP-17 — Published unit rules** Each model's estimated and billed units follow its published unit rule, and a job's reservation equals its estimated units at the job's rate.
- **DP-18 — Exact settlement** A succeeded job is charged its billed units at its rate in integer micro-credits, with one half-up rounding of the job total.
- **DP-19 — Unused reservation returns** When a job bills fewer units than it reserved, the difference returns to available in a release movement at settlement.
- **DP-20 — Outputs stored before success** A job becomes succeeded only after every output object is in storage under the published key pattern, and its media is served only through short-lived signed links.
- **DP-21 — Ribbon matches the ledger** The ribbon's settled, reserved and available segments and numerals equal the team's ledger balances, with drawn segment widths within one pixel as measured in Visual design, and update as qualified in Business rules.
- **DP-22 — Scheduling a rate change** A finance controller schedules a model's new rate for a future local moment in the org time zone and can withdraw it until it takes effect.
- **DP-23 — Submission-time rate** A job reserves and settles at the rate in effect at its submission instant, even when it finishes after a newer rate takes effect.
- **DP-24 — Rate change journey** A finance controller schedules a rate change, and jobs submitted before and after the effective moment show their different rates side by side in Jobs and in the ledger.
- **DP-25 — Registering a webhook endpoint** A member registers a webhook URL for the team, receives its signing secret once, and is refused any address that is not public.
- **DP-26 — Signed completion events** Every job that succeeds, fails or is cancelled sends one event to each enabled endpoint of its team, signed with the endpoint secret, carrying a stable event id and only the payload the endpoint's owner may see.
- **DP-27 — Delivery retries** A delivery that gets no 2xx answer is retried on the published backoff schedule with the same event id and body, retries stop after the first success, and the endpoint's later events wait until that event is delivered or abandoned.
- **DP-28 — Endpoint disable and re-enable** An endpoint is disabled after the published number of consecutive failed attempts, the org admins are emailed, and only an org admin can re-enable it.
- **DP-29 — Webhook journey** An engineer adds an endpoint, copies its secret and watches deliveries succeed and fail in the delivery log, and an admin re-enables the endpoint after it is disabled.
- **DP-30 — Top-ups through Kill Bill** A finance controller's top-up adds credits to a team's pool only after Kill Bill records the paid invoice, and the invoice id is stored on the ledger movement.
- **DP-31 — Paired ledger movements** Every grant, top-up, reservation, settlement and release is one movement of two entries that sum to zero, and every balance equals the sum of its entries.
- **DP-32 — Billing outage keeps top-ups pending** While Kill Bill is unreachable a top-up is accepted as pending with a named reason and grants nothing, and it completes once billing returns, without a restart and without a second invoice or payment, even when a call that timed out had reached Kill Bill.
- **DP-33 — Top-up receipt** A paid top-up emails a receipt to the finance controller who requested it.
- **DP-34 — Reconciliation journey** A finance controller tops up a team, sees the paid top-up and its paired movement in the ledger, and exports a ledger CSV whose totals equal the ribbon.
- **DP-35 — Storage outage holds the queue** While object storage is unreachable, submissions without new media still reserve and queue with a named waiting reason, while uploads and URL inputs are refused, and dispatch resumes on its own once storage returns, as qualified in Business rules.
- **DP-36 — Service status notice** When storage or billing is unreachable, every signed-in screen shows the matching notice in the Service status region and removes it once the service returns, as qualified in Feedback states.
- **DP-37 — Boot with dependencies down** The app starts, answers its health check and serves its screens even when storage or billing is unreachable at boot.
- **DP-38 — Model access by context** Whether a team may run a model is resolved separately for API and playground runs: the team's model setting first, then the team's default, then the org's model setting.
- **DP-39 — Restricted payloads** In a team with restricted payload visibility, only the member who submitted a job sees its input and input media, in every screen and response; teammates and org roles see its status, model and cost.
- **DP-40 — Exports follow payload visibility** The jobs CSV export leaves the prompt empty for any job whose payload the reader may not see, and no email ever contains a prompt or input.
- **DP-41 — Policy versions and stale saves** Each policy save creates a numbered version, and a save based on an older version answers 412 and changes nothing.
- **DP-42 — Admin policy journey** An org admin blocks a model for playground runs, restricts a team's payloads and lowers a cap, and teammates then see the blocked model and hidden prompts.
- **DP-43 — Deleting media** When a compliance reviewer or org admin deletes an asset, its object leaves storage and reading the asset answers 410 for every caller in the org who could read it while it was live.
- **DP-44 — Retention expiry** An asset expires at its creation time plus the org's retention period and from that instant behaves as deleted, with its object removed as qualified in Business rules.
- **DP-45 — Lineage tombstones** Lineage keeps a deleted or expired asset's place as a tombstone with no thumbnail, prompt or link, and the walk continues through it in both directions.
- **DP-46 — Media search** Library search returns only live assets the caller may see, matching model names and visible prompt words, and never returns deleted, expired or hidden assets.
- **DP-47 — Compliance journey** A compliance reviewer finds an output by search and deletes it, then sees it gone from search and shown as a tombstone in the lineage of an output derived from it.
- **DP-48 — Budget periods in the org time zone** Each team's budget period runs from midnight on the 1st of a month to midnight on the 1st of the next month in the org time zone, correctly across daylight-saving changes.
- **DP-49 — Soft cap warning** When a team's period spend first reaches its soft cap, the org admins and finance controllers get one email for that period and the ribbon shows the soft cap marker.
- **DP-50 — Hard cap throttle** A submission that would take a team's period spend above its hard cap is refused with 429, the first refusal of the period emails a throttle notice, and the ribbon shows the throttled state.
- **DP-51 — Budget caps journey** An operator runs video jobs until the soft cap marker appears and the next run is throttled, while a retry of an already-accepted job still returns that job.
- **DP-52 — Sign-in and roles** Seeded members sign in with email and passcode or call the API with their key, and each role reaches only the screens and endpoints the role table grants.
- **DP-53 — Responsive layout** Every screen fits 375×812, 768×1024 and 1280×800 viewports without horizontal page scrolling, and every tap target is at least 44 pixels in both directions.
- **DP-54 — Keyboard and focus** Every control is reachable in the published tab order, dialogs keep focus inside them, Escape closes them, and focus then returns to the control that opened them.
- **DP-55 — Ribbon motion** Ribbon segment and numeral changes animate over the published durations in the published sequences for reserve, replay, settle and release, and nothing on screen loops.
- **DP-56 — Reduced motion** When reduced motion is requested, ribbon changes apply instantly with no slide, count or merge, and the meter's live region still announces each change.
- **DP-57 — Visual identity** Screens use the bone ground, graphite ink and hairline rules, with teal only for settled credit and vermilion only for in-flight reservations and cap breaches, the published typefaces, and tabular figures for every number.
- **DP-58 — Workspace composition** The Run screen places the catalogue rail at the left, the ribbon across the top of the main column, the run form and queue lanes side by side below it, and the lineage strip along the bottom.
- **DP-59 — Server boundary** The server accepts only same-origin browser writes, enforces the published body limits, never serves source files or credentials, and refuses outbound requests to non-public addresses as described in Server boundary.
- **DP-60 — Configuration from the environment** Every service URL and credential is read from the environment at start, never hard-coded and never sent to the browser.

## Frontend

### Screens and layout (DP-12, DP-16, DP-53, DP-58)

Every signed-in screen has a top bar with the product name, the primary navigation, the signed-in member's name and team, and a Sign out button. The Service status region sits directly under the top bar. It takes no space when nothing is wrong.

- **Sign in.** A centred, narrow form with email and passcode.
- **Run** (members, the home screen for members). A fixed left rail lists the catalogue grouped by modality under the headings Image, Video and Audio. Each model shows its name, its unit and its current rate. Models blocked for the playground in the member's team appear in the rail marked "Blocked for playground" and cannot be chosen. The main column starts with the credit meter (the Reservation ribbon) across its full width. Below the meter is a 12-column grid: the run form takes the left seven columns and the queue lanes take the right five, one lane per catalogue model. The lineage strip runs along the bottom edge of the main column. It shows the team's 20 most recent output assets as a horizontal row of thumbnails, with connectors drawn between assets linked by "derived from". Selecting a node centres that asset's lineage in the strip.
- **Jobs** (everyone signed in). A status filter, a table of jobs newest first, an Export CSV link, and a job detail dialog. Members see their own team. Org roles choose a team with the Team selector. Columns: Job, Model, Status, Submitted by, Submitted, Units, Rate, Cost (credits), Prompt.
- **Library** (everyone signed in). A search box and a result grid of asset cards (thumbnail or media-type glyph, model, created and expiry dates). An asset detail dialog shows the media, its lineage, a "Use as input" action for members, and a Delete action for compliance reviewers and org admins.
- **Webhooks** (members for their team, org admins for all teams). An add-endpoint form, an endpoints table with state and consecutive failures, and a delivery log per endpoint.
- **Finance** (finance controllers; org admins read only). A top-up form, the top-ups table, the ledger table with an Export ledger CSV link, a schedule-rate form, and the rate schedule table for the chosen model.
- **Admin** (org admins; finance controllers read only). The org policy form: time zone and retention, then one group per team (concurrency, payload visibility, soft and hard caps, context defaults and per-model access), then the org-level model access grid, a Save policy button, and the list of saved policy versions.

Org roles see the credit meter on the Jobs, Finance and Admin screens for the team chosen in the Team selector. Members see it on Run and Jobs for their own team.

Viewports:
- **1280×800**: the layout above. The rail is about a sixth of the width, and the run form and queue lanes sit side by side.
- **768×1024**: the rail collapses into a Catalogue button in the top bar that opens the catalogue as a dialog. The meter stays full width. The run form takes the full width, the queue lanes sit below it in two columns, and the lineage strip comes last. Tables keep Job, Status and Cost visible and fold the other columns into each row's detail dialog.
- **375×812**: one column in this order: meter, run form, queue lanes, lineage strip. The primary navigation collapses into a Menu button that opens the navigation. The lineage strip scrolls sideways inside its own region. The page itself never scrolls horizontally on any screen at any of the three sizes.

### Public screens and controls (DP-07, DP-11, DP-16, DP-24, DP-29, DP-34, DP-42, DP-47, DP-51, DP-52)

Only the roles and names below are public. Placeholders in angle brackets take the formats listed in Feedback states.

| Where | Role and accessible name | Visible copy |
|---|---|---|
| Sign in | `form "Sign in"`, `textbox "Email"`, password field labelled `Passcode`, `button "Sign in"` | "Sign in to Dispatch" |
| Top bar | `navigation "Primary"` with `link "Run"`, `link "Jobs"`, `link "Library"`, `link "Webhooks"`, `link "Finance"`, `link "Admin"` (each shown only to roles allowed the screen); `button "Menu"` (375 only); `button "Catalogue"` (below 1024 wide); `button "Sign out"` | |
| Any screen | `region "Service status"`; `status "Notices"`; `alert` for errors | Copy from Feedback states |
| Any screen | `link "Skip to main content"`, first in tab order | "Skip to main content" |
| Org roles | `combobox "Team"` | Team names |
| Catalogue | `navigation "Catalogue"` with headings "Image", "Video", "Audio"; one `button "<model name>"` per model, with `aria-pressed` true for the chosen one; `dialog "Catalogue"` below 1024 wide | Model name, unit label, rate |
| Meter | `region "Credit meter"`; `meter "Settled"`, `meter "Reserved"`, `meter "Available"`, each carried by that drawn segment of the bar, with its value in credits and maximum equal to granted credits; `list "In-flight jobs"` directly under the bar, holding one notch tab `button "Job <job id>, <units> <unit label> reserved"` per in-flight job; `img "Soft cap marker"` when shown; `status "Meter announcements"` (polite) | "Settled <amount>", "Reserved <amount>", "Available <amount>"; "Hard cap reached — new jobs are throttled until <period end date>" when throttled |
| Run form | `form "Run <model name>"`; one field per schema property, named by its `title`; for media fields, `textbox "<title>"` plus `button "Upload image for <title>"` and `button "Clear <title>"`; `button "Run"` | "Estimated <amount> credits for <units> <unit label>" under the button |
| Queue | `region "Queue"`; per model `list "<model name> lane"`; per job a `listitem` holding `button "Open job <job id>"` and, while cancellable, `button "Cancel job <job id>"` | "<job id> · <status> · <elapsed>" or "<job id> · queued #<queue position>"; "Waiting for storage" when waiting |
| Job detail | `dialog "Job <job id>"`, `button "Close"`, `button "Cancel job <job id>"` while cancellable | Fields of the job; "Hidden — restricted payload" in place of input |
| Lineage | `region "Lineage"`; `button "Asset <asset id>"` per live node; `button "Removed asset <asset id>"` per tombstone | Tombstone text "Removed <date> (<reason>)" |
| Jobs | `combobox "Status"`, `table "Jobs"`, `link "Export CSV"` | Prompt cell "Hidden — restricted payload" when hidden |
| Library | `searchbox "Search media"`, `list "Results"` of `button "Asset <asset id>"`; `dialog "Asset <asset id>"` with `button "Use as input"` (members), `button "Delete"` (compliance, admins); `alertdialog "Delete asset"` with `button "Delete permanently"` and `button "Keep"` | "No media matches." when empty |
| Webhooks | `form "Add endpoint"`, `textbox "Endpoint URL"`, `button "Add endpoint"`; `table "Endpoints"` with `button "Deliveries for <url>"`, `button "Remove <url>"`, and for admins on disabled endpoints `button "Re-enable <url>"`; `dialog "Signing secret"` with `button "Copy secret"` and `button "Done"`; `table "Deliveries"` | State words "Active", "Failing", "Disabled" |
| Finance | `form "Top up credits"` with `combobox "Team"`, `spinbutton "Credits"`, `button "Top up"`; `table "Top-ups"`; `table "Ledger"`; `link "Export ledger CSV"`; `form "Schedule rate change"` with `combobox "Model"`, `textbox "New rate (credits per unit)"`, `textbox "Effective at"`, `button "Schedule"`; `table "Rate schedule"` with `button "Withdraw rate <rate id>"` for scheduled rows | Top-up states "Paid", "Pending", "Failed"; rate states "Past", "Current", "Scheduled" |
| Admin | `form "Org policy"` with `combobox "Time zone"`, `combobox "Retention"`; per team `group "<team name>"` holding `spinbutton "Concurrency"`, `combobox "Payload visibility"`, `spinbutton "Soft cap (credits)"`, `spinbutton "Hard cap (credits)"`, `combobox "Default for API"`, `combobox "Default for playground"`, and per model `combobox "<model name> API"` and `combobox "<model name> playground"`; `group "Org model access"` with the same per-model comboboxes; `button "Save policy"`; `list "Policy versions"` | Options "Allowed", "Blocked", "Inherit"; visibility options "Team" and "Restricted"; retention options "7 days", "30 days", "90 days" |

### Interactions (DP-12, DP-15, DP-54)

- **Choosing a model.** Click, tap, or press Enter on a catalogue button. The run form is rebuilt from that model's input schema, the estimate updates, and focus moves to the first form field. Below 1024 wide, the catalogue dialog closes and focus goes to the form.
- **Form generation.** Fields appear in schema property order. A string with a maximum length above 200 characters becomes a multi-line text area. Any other string becomes a single-line text box. An enumeration becomes a select. An integer with minimum and maximum becomes a number field with those limits. A string whose media type is an image becomes a media field. Each field shows its `title` as the label and its `description` as help text, and starts at its `default`. Required fields are marked "Required". The estimate under Run recomputes on every change from the published unit rules and the model's current rate.
- **Media fields.** The text box accepts an image URL or an asset reference `asset:<asset id>`. "Upload image for <title>" opens the file picker, uploads the file and fills the field with the new asset reference. "Use as input" in an asset dialog opens Run with the current model, or with Reel 10 if the current model has no media field, and fills its first media field with that asset reference.
- **Run.** Pressing Run, or Enter inside a single-line field, checks the form against the schema in the browser. If there are errors, nothing is sent and focus moves to the first invalid field. Otherwise the form submits with a fresh Idempotency-Key for this press and keeps the button disabled until the response arrives. If the request fails at the network level, the form resends once with the same key.
- **Queue and meter.** Clicking a lane item or a notch tab, or pressing Enter on it, opens the job dialog. Hovering over or focusing a notch tab outlines its drawn notch in the bar. Cancel asks no confirmation; the job leaves its lane and its notch shrinks back into available.
- **Deleting.** Delete opens the "Delete asset" alert dialog with focus on Keep. "Delete permanently" deletes the asset and closes both dialogs. Focus then goes to the search box.
- **Scheduling a rate.** "New rate (credits per unit)" accepts digits with an optional decimal point and at most six decimals, with no thousands separators, from 0.000001 to 1000000 inclusive. The browser multiplies it by 1,000,000 exactly to get `micro_per_unit`. "Effective at" accepts `YYYY-MM-DD HH:MM` on a 24-hour clock, read in the org time zone, for example `2026-11-02 09:00`, and is sent as `effective_at_local` with seconds `00`. If either field does not match its format, nothing is sent and the field shows its browser-side message from Feedback states.
- **Tab order on Run**: skip link, primary navigation, Sign out, catalogue buttons, notch tabs in reserved order, run form fields in schema order, Run, queue lane items lane by lane, then lineage nodes left to right.
- **Dialogs** keep Tab and Shift+Tab inside themselves. Escape or Close closes the dialog and returns focus to the control that opened it. Alert dialogs close on Escape as if Keep was chosen.
- **Touch.** The lineage strip scrolls sideways with a swipe. Every tap target is at least 44 by 44 pixels. The drawn notches in the bar are not tap targets; each in-flight job is reached through its notch tab. Hover effects are never the only way to reach information, because every notch tab's label is also its accessible name and appears in the job dialog.

### Visual design (DP-57, DP-58)

- **Colour roles.** The page ground is a warm bone off-white. Text and controls are near-black graphite. Rules and borders are thin warm-grey hairlines. A deep teal marks settled credit and nothing else. A single vermilion appears only on reserved notches for in-flight jobs, on the soft cap marker after it is crossed, on the hard-cap hatching, and on the throttled message. Buttons are graphite with bone text. Errors use graphite text with a vermilion rule beside them. All text and essential graphics meet WCAG 2.2 AA contrast against the bone ground.
- **Type.** Headings use Bricolage Grotesque, a lively grotesque with slightly quirky letterforms. Body text and controls use IBM Plex Sans. Every number (amounts, units, ids, times) is set in a monospaced face with equal-width figures, so columns of numbers line up digit for digit and sit on a shared baseline. Each heading level is a fifth larger than the level below it, starting from body size.
- **Density.** Compact. Table rows and lane items are single lines with tight vertical padding, but every interactive target stays at least 44 pixels tall.
- **Surfaces.** Flat panels separated by hairlines. There are no shadows, except a single-pixel hairline under the open dialog's edge. Corners are square or barely rounded.
- **Composition.** As in Screens and layout: rail at the left, the ribbon as the headline of the main column, the form and lanes on a 12-column grid, and the lineage strip as a quiet footer band.
- **Ribbon.** A full-width horizontal bar about 40 pixels tall, with three segments left to right: settled in solid teal, reserved made of individual vermilion notches, and available in bone with a hairline outline. The bar is a drawing, not a set of controls: no segment or notch in it is a tap target, so the 44-pixel rule does not apply to it.
  - Each segment's drawn width is its balance ÷ granted credits × the bar's inner width. DP-21's one-pixel tolerance is measured on the rendered width of the element that carries each segment's `meter` role.
  - The reserved segment's width is the sum of its notches. Each drawn notch is its own reservation's share of the bar and may be narrower than one pixel. The hairline separations between notches are drawn inside the notch edges and add no width.
  - Queued notches are vermilion outlines and leased or running notches are solid vermilion.
  - Numerals for each segment sit above the bar, aligned to the left edge of their segment.
  - Directly under the bar sits the row of notch tabs, one per in-flight job in reserved order. Each tab is at least 44 by 44 pixels and shows its job id, with a vermilion outline when queued and solid vermilion when leased or running. The row wraps onto further lines when the tabs do not fit on one.
  - When throttled, the available segment shows fine diagonal vermilion hatching.

### Motion and effects (DP-21, DP-49, DP-50, DP-55, DP-56)

All motion starts briskly and settles gently to rest with no overshoot or bounce. Short effects take between 0.18 and 0.26 seconds; ribbon width changes take between 0.38 and 0.46 seconds. Each numeral counts from its old value to its new value over exactly the time its segment takes to change width.

Ribbon sequences:
1. **Reserve.** A new notch slides out of the left edge of the available segment and settles at the right end of the reserved segment. The available segment narrows by the same width. The available numeral counts down and the reserved numeral counts up.
2. **Replay.** The existing notch of the replayed job and its notch tab get a brighter, thicker outline that fades back within the short duration. No width or numeral changes.
3. **Settle.** The notch resizes to the width of the job's actual charge. In a second step of the same length, it slides left and merges into the settled segment. The settled numeral counts up, and any unused reservation flows into the available segment, whose numeral counts up.
4. **Release.** On failure or cancellation, the notch shrinks toward the available segment and disappears, and the available numeral counts up.
5. **Soft cap.** When the soft cap is crossed, a dashed vertical marker fades in at the soft cap position over the short duration.
6. **Hard cap.** When throttled, the hatching fades in over the short duration and the throttled message appears.

Each sequence finishes within one second. If several changes arrive together, they play one after another in ledger order.

Other motion: dialogs fade in while rising a few pixels, and fade out the same way in reverse, within the short duration. Buttons and lane items change tint on hover and press within the short duration. A running lane item shows elapsed whole seconds, updated once per second. No motion is tied to scrolling. Nothing loops or pulses for decoration: no spinners, no shimmer and no animated backgrounds.

Reduced motion: when the operating system asks for reduced motion, widths, positions and numerals change instantly with no slide, count, merge or fade. Highlights appear as a static outline for one second. Notch tabs stay focusable with their full labels.

In both modes, the `status "Meter announcements"` region politely announces each change:
- Reserve: "Job <job id> reserved <units> <unit label>, <available> credits available"
- Replay: "Job <job id> already reserved; nothing added"
- Settle: "Job <job id> settled <charged> credits, <available> credits available"
- Release: "Job <job id> released <released> credits, <available> credits available"
- Soft cap crossed: "<team name> passed its soft cap"
- Throttled: "<team name> is throttled at its hard cap"

### Feedback states (DP-10, DP-36, DP-39)

Pending and success messages go to the screen's `status "Notices"` region. Errors go to an `alert` and also sit beside the offending field. Field messages from the API are shown as returned. Placeholder formats, which apply to every screen and email in this brief:
- `<amount>`, `<available>`, `<required>`, `<charged>` and `<released>` are credits in the display format from Business rules, for example "3,180.00".
- `<credits>` is a whole number of credits with comma thousands separators and no decimals, for example "1,000".
- `<period label>` is the meter period's `label` from Business rules.
- `<period end date>` is the date of the period's `ends_at` in the org time zone, written as day, month name and year, for example "1 November 2026".
- `<date>` in a tombstone is the date of `removed_at` in the org time zone, in the same format, for example "29 October 2026".
- `<reason>` is the raw reason word, `deleted` or `expired`, for example "Removed 29 October 2026 (deleted)".
- `<elapsed>` is whole seconds since the job started followed by "s", for example "j_7 · running · 7s".
- `<local date and time> <time zone>` is the effective instant in the org time zone as `YYYY-MM-DD HH:MM` followed by the IANA zone name, for example "2026-11-02 09:00 America/New_York".
- `<units>` uses the unit display rules from Business rules.

| Action | Pending | Success | Errors |
|---|---|---|---|
| Sign in | Button reads "Signing in…" | Opens the role's home screen | "That email and passcode do not match." |
| Run | Button reads "Submitting…" | "Job <job id> queued — <amount> credits reserved." Replay: "Job <job id> was already submitted; nothing new was reserved." | Field errors plus "Fix the highlighted fields."; 402 "Not enough credits: this run needs <required> and <available> are available."; 429 "<team name> reached its hard cap for <period label>. New jobs are throttled until <period end date>."; 403 model blocked "<model name> is blocked for playground runs in <team name>."; 503 "Storage is unreachable, so the image could not be saved. Nothing was reserved." |
| Upload | "Uploading…" | "Uploaded <file name>." | 413 "That file is larger than the upload limit."; 415 "Use a PNG, JPEG or WebP image."; 503 "Storage is unreachable. Try the upload again when it returns." |
| Cancel | "Cancelling…" | "Job <job id> cancelled; <released> credits released." | 409 "Job <job id> already <status>; nothing to cancel." |
| Top up | "Recording payment…" | Paid: "Added <credits> credits to <team name>." | Pending: "Billing is unreachable. Your top-up of <credits> credits is pending; no credits have been added yet."; rejected: "Billing declined the top-up; no credits were added." |
| Schedule rate | "Saving…" | "New rate for <model name> takes effect <local date and time> <time zone>." | Field errors |
| Withdraw rate | "Withdrawing…" | "Scheduled rate <rate id> withdrawn." | 409 "That rate is already in effect and cannot be withdrawn." |
| Save policy | "Saving…" | "Policy saved as version <version>." | 412 "Someone saved a newer policy (version <current version>). Reload to see it before saving again."; field errors |
| Add endpoint | "Checking address…" | Opens `dialog "Signing secret"`: "Endpoint added. Copy the signing secret now; it is shown once." | Field errors; 409 "This team already has 5 endpoints." |
| Re-enable endpoint | "Re-enabling…" | "Endpoint re-enabled." | 409 "That endpoint is not disabled." |
| Delete asset | "Deleting…" | "Asset <asset id> deleted from storage, search and lineage." | 410 "That asset is already gone."; 503 "Storage is unreachable, so nothing was deleted. Try again when it returns." |

Field messages the API returns:
- Refused address (media URL or webhook URL): "This address is not allowed. Use a public address."
- Unfetchable image URL: "That image could not be fetched."
- Fetched content is not an image of an allowed type: "That address did not return a PNG, JPEG or WebP image."
- Fetched image too large: "That image is larger than the upload limit."
- Missing required field: "Required."
- Rate effective time not in the future: "Choose a moment in the future."
- Rate input that fails the format in Interactions (browser-side, nothing is sent): "Enter a rate from 0.000001 to 1000000 with at most six decimals."
- Effective time input that fails the format in Interactions (browser-side, nothing is sent): "Use the format YYYY-MM-DD HH:MM."
- Effective time that does not exist in the zone: "That time does not exist in <time zone> because clocks move forward."
- Other schema failures: free English naming the limit.

The run form shows "Waiting for storage" on any lane item whose job has a waiting reason. The page polls dependency state at least every ten seconds. Within ten seconds of storage becoming unreachable, the `region "Service status"` shows "Storage is unreachable. New jobs wait in the queue, and uploads and image links are paused." Within ten seconds of billing becoming unreachable, it shows "Billing is unreachable. Top-ups stay pending until it returns." Each notice is removed within ten seconds of its service returning.

## Backend

### API (DP-01, DP-02, DP-03, DP-04, DP-05, DP-06, DP-10, DP-14, DP-22, DP-25, DP-30, DP-41, DP-43, DP-46)

Every request and response body is JSON (`application/json; charset=utf-8`) unless stated otherwise. Authentication uses either `Authorization: Bearer <api key>`, which is the **API context**, or the session cookie set by sign-in, which is the **playground context**. A request that carries both uses the Bearer key.

Errors share one shape: `{"error":{"code":"<code>","message":"<English sentence>"}}`. A validation failure is `422 {"error":{"code":"validation_failed","message":"...","fields":{"<path>":"<message>"}}}`, where `<path>` is a dotted path such as `input.prompt`. Other extra members appear only where stated.

**Error precedence**, applied identically to every endpoint, first match wins:
1. Request boundary: `413 payload_too_large`, `415 unsupported_media_type`, `400 malformed_json`.
2. `401 unauthenticated`.
3. Cross-origin cookie write: `403 cross_origin`.
4. Idempotency, on `POST /api/jobs` only: `400 idempotency_key_required`, then a stored replay, then `409 idempotency_key_reused`.
5. `404 not_found`, for an unknown resource; for a member, any job, upload, meter, queue, ledger, top-up or webhook endpoint of another team (another team's output assets are not hidden from members); and for an upload that Payload visibility hides from the caller.
6. `403 forbidden` (role) and `403 model_blocked`.
7. `410 asset_gone`, for a deleted or expired asset. Because it comes after steps 5 and 6, a caller who could not read the asset while it was live still gets 404, and a caller without the role for the action still gets 403.
8. `422 validation_failed`.
9. `409` and `412` state conflicts.
10. `402 insufficient_credits`, then `429 budget_hard_cap`.
11. `503 storage_unavailable` and `502 billing_rejected`.

**Objects.**
- **Member**: `{"id","name","email","role","team_id"}`. `role` is one of `member`, `admin`, `finance`, `compliance`; `team_id` is null for org roles. Wherever a job or asset names a person, it uses `{"id","name"}` only.
- **Job, full projection** (exact keys): `id`, `team_id`, `model`, `status`, `priority`, `submitted_by`, `submitted_at`, `started_at`, `finished_at`, `attempts`, `failure_reason`, `waiting_reason`, `queue_position`, `rate` (`{"id","micro_per_unit"}`), `unit`, `estimated_units`, `billed_units`, `reserved_micro`, `charged_micro`, `released_micro`, `outputs` (asset ids in output order), `payload_visible` (true), `input`, `input_assets`.
  - The **restricted projection** has the same keys without `input` and `input_assets`, and with `payload_visible` false. The keys are absent, not null.
  - Times are UTC ISO 8601 with a `Z` suffix. Units are exact decimal strings with no exponent and no trailing zeros. Micro amounts are JSON integers. `billed_units` and `charged_micro` are null until success.
- **Asset**: `id`, `team_id`, `kind` (`upload` or `output`), `media_type`, `job_id` (null for uploads), `model` (null for uploads), `width`, `height`, `duration_seconds`, `bytes`, `created_at`, `expires_at`, `url` (signed link), `prompt` (only when the producing job's payload is visible), `derived_from` (asset ids, only when the producing job's payload is visible).
- **Top-up**: `id`, `team_id`, `credits`, `amount_usd` (string with two decimals), `status` (`pending`, `paid`, `failed`), `pending_reason`, `failure_reason`, `kb_account_id`, `kb_invoice_id`, `kb_payment_id`, `created_by`, `created_at`, `paid_at`.

| Method and path | Who | Request | Success | Endpoint-specific errors |
|---|---|---|---|---|
| `GET /api/health` | anyone | | `200 {"status":"ok"}` | |
| `GET /api/system` | signed in | | `200 {"storage":"up"\|"down","billing":"up"\|"down","checked_at"}` | |
| `POST /api/session` | anyone | `{"email","passcode"}` | `200 {"member"}` and sets the session cookie | `401 unauthenticated` for a wrong pair |
| `DELETE /api/session` | signed in | | `204` | |
| `GET /api/me` | signed in | | `200 {"member"}` | |
| `GET /api/models` | signed in | | `200 {"models":[{"slug","name","modality","unit","unit_label","input_schema","current_rate":{"id","micro_per_unit","effective_at"},"access":{"api","playground"}}]}`; `access` holds resolved `allowed`/`blocked` for the caller's team, or null for org roles | |
| `GET /api/models/{slug}` | signed in | | `200 {"model"}` | |
| `GET /api/models/{slug}/rates` | signed in | | `200 {"rates":[{"id","micro_per_unit","effective_at","effective_at_local","status","created_by"}]}`; status `past`, `current` or `scheduled`, oldest first | |
| `POST /api/models/{slug}/rates` | finance | `{"micro_per_unit": integer 1..1000000000000, "effective_at_local":"YYYY-MM-DDTHH:MM:SS"}` | `201 {"rate"}` | |
| `DELETE /api/models/{slug}/rates/{id}` | finance | | `204` | `409 rate_already_effective` |
| `POST /api/jobs` | member | Header `Idempotency-Key`; `{"model","input":{...},"priority":"high"\|"normal"\|"low"}` (priority optional, default `normal`) | `201 {"job"}` | `400 idempotency_key_required`; `409 idempotency_key_reused`; `402 insufficient_credits` with extra `"required_micro","available_micro"`; `429 budget_hard_cap` with extra `"period_ends_at"`; `503 storage_unavailable` |
| `GET /api/jobs` | signed in | Query `team`, `status`, `limit` (1–200, default 50), `cursor` | `200 {"jobs":[...],"next_cursor":string\|null}`, newest first | |
| `GET /api/jobs/{id}` | signed in | | `200 {"job"}` | |
| `POST /api/jobs/{id}/cancel` | team members, admin | | `200 {"job"}` | `409 job_not_cancellable` with extra `"status"` |
| `GET /api/jobs.csv` | signed in | Query `team` | `200 text/csv` | |
| `GET /api/queue` | signed in | Query `team` (required for org roles) | `200 {"lanes":[{"model","queued":[job],"running":[job]}]}` | |
| `POST /api/uploads` | member | Raw image body, `Content-Type` `image/png`, `image/jpeg` or `image/webp`, header `X-File-Name` optional | `201 {"asset"}` | `503 storage_unavailable` |
| `GET /api/assets` | signed in | Query `q`, `kind`, `model`, `team` | `200 {"assets":[...]}`, newest first, at most 100 | |
| `GET /api/assets/{id}` | signed in | | `200 {"asset"}` | `410 asset_gone` with extra `"removed_at","reason"` |
| `DELETE /api/assets/{id}` | compliance, admin | | `204` | `410 asset_gone`; `503 storage_unavailable` |
| `GET /api/assets/{id}/lineage` | signed in | | `200 {"nodes":[...],"edges":[{"from","to"}]}` | `410 asset_gone` |
| `GET /api/teams` | signed in | | `200 {"teams":[{"id","name"}]}` (members get their own team only) | |
| `GET /api/teams/{id}/meter` | team members, org roles | | `200` meter object (below) | |
| `GET /api/teams/{id}/ledger` | finance, admin | | `200 {"balances":{"granted_micro","available_micro","reserved_micro","settled_micro"},"movements":[{"id","kind","created_at","job_id","topup_id","kb_invoice_id","entries":[{"account","amount_micro"}]}]}`, oldest first | |
| `GET /api/teams/{id}/ledger.csv` | finance, admin | | `200 text/csv` | |
| `POST /api/topups` | finance | `{"team_id","credits"}` | `201 {"topup"}` when paid; `202 {"topup"}` when pending | `502 billing_rejected` (the top-up is stored as failed) |
| `GET /api/topups` | finance, admin | Query `team` | `200 {"topups":[...]}`, newest first | |
| `GET /api/policy` | admin, finance | | `200 {"policy"}` (below) | |
| `PUT /api/policy` | admin | The full policy object including the `version` it was based on | `200 {"policy"}` with `version` one higher | `412 policy_version_stale` with extra `"current_version"` |
| `GET /api/policy/versions` | admin, finance | | `200 {"versions":[{"version","saved_by","saved_at"}]}`, newest first | |
| `POST /api/webhook-endpoints` | member | `{"url"}` | `201 {"endpoint":{"id","team_id","url","state","consecutive_failures","created_by","created_at","secret"}}` | `409 endpoint_limit_reached` |
| `GET /api/webhook-endpoints` | member (own team), admin | Query `team` | `200 {"endpoints":[...]}` without `secret` | |
| `POST /api/webhook-endpoints/{id}/enable` | admin | | `200 {"endpoint"}` | `409 endpoint_not_disabled` |
| `DELETE /api/webhook-endpoints/{id}` | team members, admin | | `204` | |
| `GET /api/webhook-endpoints/{id}/deliveries` | team members, admin | | `200 {"deliveries":[{"event_id","event_type","job_id","attempt","attempted_at","status_code","outcome","next_attempt_at"}]}`, newest first; `outcome` is `delivered`, `failed` or `skipped_disabled` | |

**Meter object**: `{"team_id","granted_micro","available_micro","reserved_micro","settled_micro","in_flight":[{"job_id","status","reserved_micro","estimated_units","unit"}],"recent_replays":[{"job_id","at"}],"period":{"label","starts_at","ends_at","spend_micro","soft_cap_micro","hard_cap_micro","soft_cap_offset_micro"},"cap_state":"under"|"soft_cap_passed"|"hard_cap_reached"}`. `in_flight` is in submission order. `recent_replays` lists replays from the last ten seconds.

**Policy object**: `{"version","timezone","retention_days","org_model_access":{"<slug>":{"api","playground"}},"teams":[{"id","name","concurrency","payload_visibility","soft_cap_credits","hard_cap_credits","context_defaults":{"api","playground"},"model_access":{"<slug>":{"api","playground"}}}]}`.
- Org model access values are `allowed` or `blocked`.
- Team values are `allowed`, `blocked` or `inherit`.
- `payload_visibility` is `team` or `restricted`.
- `retention_days` is 7, 30 or 90.
- `concurrency` is 1–20.
- Caps are whole credits from 0 to 10,000,000, with soft at or below hard.
- `timezone` is an IANA zone name.
- Unknown teams or models in a policy save are 422.

**CSV exports** are UTF-8 with a header row and comma separators.
- Jobs columns: `job_id,team,model,status,submitted_by,submitted_at,finished_at,unit,billed_units,rate_micro_per_unit,charged_micro,prompt`. `prompt` is the `prompt` or `text` input, or empty when the reader may not see the payload.
- Ledger columns, one row per entry: `movement_id,kind,created_at,job_id,topup_id,kb_invoice_id,account,amount_micro`.

### Business rules (DP-02, DP-03, DP-04, DP-06, DP-08, DP-09, DP-10, DP-15, DP-17, DP-18, DP-19, DP-20, DP-21, DP-23, DP-26, DP-27, DP-28, DP-31, DP-35, DP-38, DP-39, DP-41, DP-44, DP-46, DP-48, DP-49, DP-50, DP-52)

**Roles.** Every route not granted below answers `forbidden`.
- Every signed-in role reads its own member record, system status, the catalogue and rate schedules, and the team list. It also reads jobs (including the jobs CSV), queues, meters, assets and lineage: members for their own team, org roles for every team. In addition, members read and search the live output assets of every team in the org, under the Payload visibility rules.
- `member`: belongs to one team. Submits and cancels jobs, uploads, and adds, lists and removes webhook endpoints for that team.
- `admin`: edits policy; reads and removes every team's webhook endpoints and deliveries, and re-enables endpoints; cancels any job; deletes assets; reads ledgers, top-ups, policy and policy versions.
- `finance`: tops up, schedules and withdraws rates, and reads ledgers, top-ups, policy and policy versions.
- `compliance`: deletes assets.

Org roles never submit jobs.

**Idempotency.**
- In the API context, `POST /api/jobs` requires an `Idempotency-Key` of 1 to 255 visible ASCII characters. If it is missing or malformed, the request fails with `idempotency_key_required`. In the playground context the header is optional.
- Keys are scoped per team and kept for 24 hours from first use.
- Two bodies are the same when model, input and priority are equal after JSON parsing. Key order and whitespace do not matter, and an omitted priority equals `normal`.
- A replay of a stored key with the same body returns the first response's status and body unchanged, with response header `Idempotent-Replayed: true`, and adds the job to `recent_replays`. A stored replay is answered even when the same request would now be refused, for example because the model has since been blocked or the hard cap reached, and its body is the first response as stored, never rebuilt from the job's current state. Payload visibility still applies: in a `restricted` team, a teammate who replays the key gets that stored job in the restricted projection.
- A stored key with a different body fails with `idempotency_key_reused`.
- The job, its reservation movement and its idempotency record commit in one transaction. Simultaneous requests with one key therefore produce one job. Every concurrent duplicate waits for the winner and returns the winner's response as a replay.
- Only successful (201) responses are stored. A refused submission leaves the key unused.

**Job state machine.**
- States: `queued`, `leased`, `running`, `succeeded`, `failed`, `cancelled`.
- Legal edges:
  - queued → leased, when the dispatcher claims it; attempts increase by one.
  - leased → running, when the run begins.
  - leased → queued and running → queued, when the lease lapses.
  - leased → failed with `input_deleted`, when an input asset is gone at run start, and queued → failed with `model_blocked`, when the dispatcher reaches a job whose model is now blocked for the context it was submitted in.
  - running → succeeded, when all outputs are stored.
  - running → failed with `storage_unavailable`, when an output write fails.
  - leased or running → failed with `lease_expired`, at the third lapse.
  - queued, leased or running → cancelled, by the cancel endpoint.
- Succeeded, failed and cancelled are final.
- Cancelling an already cancelled job returns 200 with the job unchanged and releases nothing again. Cancelling a succeeded or failed job is `job_not_cancellable`.
- A lease lasts `LEASE_SECONDS`, which defaults to 30, and the worker renews it while the job runs.
- A run lasts `JOB_RUN_SECONDS`, which defaults to 8 (whole seconds, 1 to 600). The run then writes its outputs to storage and moves to succeeded only after every object is stored.
- `waiting_reason` is `storage_unavailable` while the job is queued during a storage outage, and null otherwise. `queue_position` is the 1-based position among the team's queued jobs in dispatch order, and null when not queued.

**Concurrency and dispatch.**
- A team's leased plus running jobs never exceed its concurrency, across all models.
- The claim of a slot is atomic. When several queued jobs compete for the last slot, exactly one is leased, and every other job stays queued with its reservation intact. No job is lost or started twice.
- Dispatch order within a team: `high` before `normal` before `low`, then earlier `submitted_at`, then lower job number. When the dispatcher reaches a queued job whose model is now blocked for the context the job was submitted in (`api` for a key, `playground` for a session), the job fails with `model_blocked` instead of being leased, its whole reservation is released, and the slot goes to the next job.
- A free slot is filled within two seconds.
- Lowering a team's concurrency never stops running jobs; it only delays new starts.
- Queue lanes, the meter and the job list reflect any change within two seconds without a reload.

**Units and rates.** Rates are integer micro-credits per unit; one credit is 1,000,000 micro-credits.

| Model | Unit (label) | Estimated units | Billed units |
|---|---|---|---|
| Quill Still | `image` (images) | `num_images` | same |
| Halftone XL | `megapixel` (megapixels) | width × height × num_images ÷ 1,000,000, exact | same |
| Reel 10 | `video_second` (video-seconds) | `duration_seconds` | same |
| Murmur Voice | `audio_second` (audio-seconds) | `max_seconds` | the smaller of `max_seconds` and the character count of `text` divided by 15, rounded up |

- Reservation = estimated units × rate. Charge = billed units × rate.
- Each amount is computed exactly and rounded once, half up, to a whole micro-credit, at the moment it is recorded. No other rounding happens anywhere.
- For example, with the seed data at start, Halftone XL at 1536 by 1024 with 4 images is 6.291456 megapixels and charges 20,971,518 micro-credits.
- A job's rate is the rate whose effective instant is at or before the job's `submitted_at` and is the latest such rate. The job keeps that rate for its reservation, settlement, CSV row and every screen, even if it finishes after a newer rate takes effect.

**Rate scheduling.**
- `effective_at_local` is read in the org time zone and must be strictly later than the current instant. Otherwise the request is a 422 on `effective_at_local`.
- A local time skipped by a daylight-saving jump is a 422 with the "does not exist" message. A local time that occurs twice resolves to its first occurrence.
- The stored instant does not move if the org time zone changes later.
- A scheduled rate can be withdrawn until its instant. After that it is `rate_already_effective`.

**Ledger.** Each team has accounts `funding`, `available`, `reserved` and `settled`. Every movement has exactly two entries, one negative and one positive, of equal size:

| Kind | Minus | Plus | Amount | When |
|---|---|---|---|---|
| `opening_grant` | funding | available | seeded grant | seed only |
| `top_up` | funding | available | credits × 1,000,000 | top-up becomes paid |
| `reserve` | available | reserved | reservation | job accepted, same transaction as the job |
| `settle` | reserved | settled | charge | job succeeded |
| `release` | reserved | available | reservation − charge on success (only when above zero), or the full reservation on failure or cancellation | job finished |

- Every account balance is the sum of its entries.
- Granted = available + reserved + settled = −funding, at every committed state.
- Movements are never edited or deleted.
- `released_micro` on a job is the sum of its release movements.

**Credits.**
- A submission whose reservation exceeds available fails with `insufficient_credits`. An amount exactly equal to available is accepted.
- Display amounts are credits with two decimals, rounded half up from micro-credits, with comma thousands separators, for example 3,180.00. Rates display with six decimals. Unit counts display as whole numbers for images, two decimals for megapixels, and one decimal for seconds.

**Budget periods and caps.**
- A team's budget period starts at 00:00 on the 1st of a month in the org time zone and ends at 00:00 on the 1st of the next month. Both instants are computed in that zone, so a period can be 743 or 745 hours long across daylight-saving changes.
- `label` is the month name and year, for example "October 2026". `ends_at` is shown as `<period end date>`, formatted as in Feedback states.
- Period spend = the charges of succeeded jobs submitted in the period plus the current reservations of in-flight jobs submitted in the period.
- A submission is refused with `budget_hard_cap` when period spend plus its reservation would exceed the hard cap. Reaching the cap exactly is allowed.
- `cap_state`:
  - `hard_cap_reached` when period spend is at or above the hard cap, or when the team's most recent submission attempt in the period was refused for the hard cap;
  - otherwise `soft_cap_passed` when period spend is at or above the soft cap;
  - otherwise `under`.
- `soft_cap_offset_micro` = settled + reserved − period spend + soft cap. It is where the soft cap falls on the ribbon, measured from its left edge. The marker is drawn only when the state is not `under` and the offset is within the granted width.
- The soft cap email is sent once per team per period, the first time spend reaches the soft cap. The hard cap email is sent once per team per period, at the first `budget_hard_cap` refusal.

**Model access.**
- For a team, model and context (`api` or `playground`):
  - use the team's model setting unless it is `inherit`;
  - otherwise use the team's default for that context unless it is `inherit`;
  - otherwise use the org's model setting.
- A `blocked` result refuses the submission with `model_blocked`.

**Policy versions.**
- Every successful policy save stores the whole policy as a new version, numbered one higher, with who saved it and when.
- A save whose `version` is not the current version is `policy_version_stale` and changes nothing. When two admins save from the same version at the same moment, exactly one succeeds.
- Policy changes apply to the next request and the next dispatch.

**Payload visibility.**
- In a team with `restricted` visibility, a job's `input` and `input_assets` are visible only to the member who submitted it, whether through their key or their session. Everyone else, including org roles, gets the restricted projection.
- For the same readers:
  - that job's output assets omit `prompt` and `derived_from`;
  - lineage omits the edges into that job's outputs;
  - search does not match its prompt words;
  - the jobs CSV leaves `prompt` empty.
- Uploads in a restricted team are visible only to the uploader. Admins and compliance reviewers see them without `url`. Everyone else gets `not_found` and does not find them in search.
- Visibility is decided at read time, so changing the setting affects past and future jobs alike.
- In `team` visibility, team members and org roles see payloads.
- Members of other teams never see a job's payload, so another team's output assets reach them without `prompt` and `derived_from`, and lineage omits the edges into those outputs.

**Media inputs.**
- A media field holds either an image URL or `asset:<asset id>` naming a live asset the caller may see. Any team in the org may reuse another team's output this way.
- A URL is fetched during the submission under the outbound rules in Server boundary and stored as an upload asset owned by the submitter. A URL that fails those rules is a 422 on that field, and no job or reservation is created.
- Every output of a job gets a "derived from" edge from each of the job's input assets.

**Retention and deletion.**
- Every asset's `expires_at` = `created_at` + `retention_days` × `RETENTION_DAY_SECONDS`, which defaults to 86,400. It is stamped at creation and never recomputed.
- From the instant `expires_at` is reached, every read treats the asset as gone with reason `expired`. The sweeper removes its object from storage within 15 seconds of that instant.
- Deletion removes the object from storage first, then marks the asset gone with reason `deleted`, in one request. If storage cannot remove the object, the request is `storage_unavailable` and nothing changes.
- A gone asset answers `asset_gone` at `GET /api/assets/{id}`, `GET /api/assets/{id}/lineage` and `DELETE /api/assets/{id}`, under the precedence in API. Its id stays in the producing job's `outputs` array. It is absent from search results and the Library, and appears in the lineage strip and in other assets' lineage only as a tombstone.
- In lineage, a gone asset stays as a node `{"id","state":"tombstone","removed_at","reason"}` with its edges. A live node is `{"id","state":"live","media_type","model","job_id","created_at","thumbnail_url","prompt"}`, where `thumbnail_url` is present for images only and `prompt` only when visible.
- `GET /api/assets/{id}/lineage` returns the asset itself plus every asset, live or tombstone, reachable from it by following "derived from" edges in either direction, with no depth limit, using only edges the caller may see. `edges` lists every visible edge between the returned nodes, with `from` the input asset and `to` the output asset. Tombstones keep their edges, so the walk continues through them.
- Nodes are ordered by asset creation time, oldest first, with ties broken by the number in the asset id. Edges are ordered by the position of `from` in `nodes`, then by the position of `to`.

**Search.** Each word of `q` must appear, case-insensitively, in the model name, model slug, asset id or the visible prompt. `kind`, `model` and `team` filter exactly.

**Webhooks.**
- Each team may have up to 5 endpoints.
- The secret is `whsec_` followed by 32 lowercase hex characters and is returned only at creation.
- Event types: `job.succeeded`, `job.failed`, `job.cancelled`. Each is sent once per final job state to every `active` or `failing` endpoint of the job's team.
- Body: `{"id":"evt_<24 hex>","type","created_at","data":{"job":<projection as seen by the endpoint's creator>}}`.
- Headers:
  - `Dispatch-Event-Id: <event id>`;
  - `Dispatch-Timestamp: <unix seconds of this attempt>`;
  - `Dispatch-Signature: v1=<lowercase hex HMAC-SHA256 keyed by the secret over "<timestamp>.<raw body>">`;
  - `Content-Type: application/json`.
- The body bytes and event id are identical on every attempt. The timestamp and signature are fresh on each attempt.
- An attempt succeeds on any 2xx answer within 5 seconds. Redirects are not followed and count as failures, as do timeouts and other statuses.
- After a failed attempt, retry n (n = 1 to 5) runs `WEBHOOK_RETRY_BASE_SECONDS` × 2^(n−1) seconds later, with the base defaulting to 2. With the default base the retries come 2, 4, 8, 16 and 32 seconds after each failure. After the fifth retry fails, the event is abandoned. Retries stop at the first success. Each endpoint receives its events one at a time, oldest first: while an event waits for a retry, the endpoint's later events wait behind it, with no delivery row until their first attempt, and follow in order once it is delivered. An event is abandoned only by its sixth failed attempt in a row, which also disables the endpoint, so the events waiting behind it are then recorded as `skipped_disabled`. Endpoints never wait for one another.
- `consecutive_failures` counts failed attempts across all events and resets to zero on any success. The state is `active` at zero, `failing` from 1 to 5, and `disabled` at 6.
- Disabling stops pending retries for that endpoint, records the events waiting behind it and later events as `skipped_disabled` without sending them, and emails the org admins.
- Re-enabling (admin only) sets the state to `active` and the counter to zero. Skipped events are not resent.

**Storage outage.**
- The server checks storage at least every 10 seconds.
- While storage is unreachable:
  - the dispatcher leases nothing, and queued jobs show `waiting_reason` `storage_unavailable`;
  - submissions whose inputs are all text, numbers or existing asset references are still accepted, reserved and queued;
  - uploads and URL inputs are refused with `storage_unavailable`.
- A job whose output write fails moves to failed with that reason and releases its reservation.
- Dispatch resumes within 30 seconds of storage returning, without a restart.

**Top-ups.**
- `credits` is a whole number from 100 to 100,000, inclusive, in multiples of 100. `amount_usd` = credits ÷ 100, in US dollars.
- A paid top-up writes its `top_up` movement with the Kill Bill invoice id and emails the receipt.
- When Kill Bill is unreachable (no connection, a timeout over 10 seconds, or a 5xx answer), the top-up is stored as `pending` with `pending_reason` `billing_unavailable`, grants nothing, and answers 202. The server retries every pending top-up every 15 seconds. When billing answers, the top-up completes as paid or failed without a restart, and never creates a second invoice. A call that times out may still have been carried out by Kill Bill, so before each retry the server reads what Kill Bill already holds (the invoice described "Dispatch credits <top-up id>" on the team's account, and that invoice's payments) and continues from there: an existing invoice is reused rather than made again, and an invoice already paid is not paid again.
- A 4xx refusal from Kill Bill stores the top-up as `failed` with `failure_reason` `billing_rejected`.

### Services (DP-20, DP-30, DP-32, DP-33, DP-40, DP-43, DP-49, DP-50, DP-28)

- **Postgres** (`DATABASE_URL`) is the system of record for the org, teams, members, catalogue and schemas, rates, the queue with leases, idempotency records, the ledger, top-ups, policy versions, webhook endpoints and deliveries, assets and lineage. The server applies its schema and seed idempotently every time it starts, on an empty or existing database.
- **MinIO** (`S3_*`) holds the media.
  - Upload objects use the key `uploads/<team id>/<asset id>.<ext>`.
  - Output objects use the key `outputs/<team id>/<job id>/<n>.<ext>`, with n counting from 1 in output order.
  - The extension is `png`, `jpg`, `webp`, `webm` or `wav`, and the object's content type matches it.
  - Placeholder outputs:
    - images are PNGs of exactly the output width and height (Quill Still is 1024 by 1024);
    - Reel 10 writes one `video/webm` object per job, at 1280 by 720, whose bytes need not be a playable stream; the job record carries the duration;
    - Murmur Voice writes one `audio/wav` file of exactly the billed seconds.
  - Media is reachable only through signed GET links that expire 300 seconds after they are issued.
  - The bucket stays private.
- **Kill Bill** (`KILLBILL_*`) records every paid top-up.
  - Each team has one Kill Bill account whose external key is the team id, with currency USD and name equal to the team name. It is created at that team's first top-up, and the server looks it up by that external key before creating it.
  - Each top-up makes one committed invoice on that account. The invoice holds one external charge of `amount_usd`, described "Dispatch credits <top-up id>".
  - The invoice is paid in full by one successful PURCHASE payment, through an external payment method on the account.
  - The top-up stores the account, invoice and payment ids.
  - Outage behaviour is described in Business rules.
- **Mail** (`SMTP_HOST`, `SMTP_PORT`, from `MAIL_FROM`, which is `Lumenfold Dispatch <dispatch@lumenfold.example>`). Messages, with placeholders formatted as in Feedback states:
  - Soft cap: to every `admin` and `finance` member, subject "Soft cap passed: <team name>, <period label>". The body gives the period spend and the soft cap in credits.
  - Hard cap: to every `admin` and `finance` member and every member of the team, subject "Hard cap reached: <team name>, <period label>". The body says new jobs are throttled until the period end date.
  - Endpoint disabled: to every `admin`, subject "Webhook endpoint disabled: <team name>". The body gives the endpoint URL and the last status code or "no answer".
  - Top-up receipt: to the finance member who requested it, subject "Top-up receipt: <credits> credits for <team name>". The body gives `amount_usd` and the Kill Bill invoice id.

  No email ever contains a prompt, script, input value, input media link or signing secret.

### Seed data (DP-52, DP-17)

Every person, company and team below is invented. The seed is applied on every start without duplicating anything.

- **Org**: "Halden Works", time zone `America/New_York`, retention 30 days, policy version 1.
- **Teams**:

| Team | id | Opening grant | Concurrency | Payload visibility | Soft cap | Hard cap | Defaults (API / playground) |
|---|---|---|---|---|---|---|---|
| Storefront | `t_storefront` | 5,000 credits | 2 | team | 3,000 credits | 4,000 credits | inherit / inherit |
| Campaigns | `t_campaigns` | 600 credits | 1 | team | 300 credits | 400 credits | inherit / inherit |

- **Members**: every member's passcode is `lumen-pass-2026`.

| Name | id | Email | Role | Team | API key |
|---|---|---|---|---|---|
| Mara Okonkwo | `m_mara` | mara@halden.example | member | Storefront | `dpk_mara_4c19e7` |
| Theo Lindqvist | `m_theo` | theo@halden.example | member | Storefront | `dpk_theo_82ad30` |
| Ines Calloway | `m_ines` | ines@halden.example | member | Campaigns | `dpk_ines_5be611` |
| Rafael Duarte | `m_rafael` | rafael@halden.example | admin | — | `dpk_rafael_0f7c42` |
| June Whitford | `m_june` | june@halden.example | finance | — | `dpk_june_d39a58` |
| Sol Abernathy | `m_sol` | sol@halden.example | compliance | — | `dpk_sol_61e2bf` |

- **Catalogue** (rail order). Every rate below took effect 2026-01-01T00:00:00 in the org zone.
  - `quill-still`, "Quill Still", image, unit `image`, rate `r_1` = 4,000,000. Schema:
    - `prompt`: string, 1–2000 characters, required, title "Prompt";
    - `style`: enum `photo`, `illustration`, `line art`, default `photo`, title "Style";
    - `num_images`: integer 1–8, default 1, title "Number of images".
  - `halftone-xl`, "Halftone XL", image, unit `megapixel`, rate `r_2` = 3,333,333. Schema:
    - `prompt`: as above;
    - `width` and `height`: integer enum 512, 768, 1024, 1536, 2048, default 1024, titles "Width" and "Height";
    - `num_images`: integer 1–4, default 1, title "Number of images";
    - `init_image`: optional image media field, title "Starting image".
  - `reel-10`, "Reel 10", video, unit `video_second`, rate `r_3` = 8,500,000. Schema:
    - `prompt`: as above;
    - `duration_seconds`: integer enum 5, 10, default 5, title "Duration (seconds)";
    - `start_image`: optional image media field, title "Start frame".
  - `murmur-voice`, "Murmur Voice", audio, unit `audio_second`, rate `r_4` = 400,000. Schema:
    - `text`: string, 1–2000 characters, required, title "Script";
    - `voice`: enum `ash`, `brook`, `cove`, default `ash`, title "Voice";
    - `max_seconds`: integer 1–120, default 30, title "Maximum length (seconds)".
- **Org model access**: every model is allowed in both contexts, except `reel-10` playground, which is blocked.
- **Team model access**: Campaigns `reel-10` playground is allowed, and Storefront `murmur-voice` API is blocked. Every other team model setting is inherit.
- **Ledger**: one `opening_grant` movement per team for its opening grant, and nothing else.
- **No jobs, assets, top-ups, rates beyond `r_1`–`r_4`, or webhook endpoints** exist at start. Job numbers start at `j_1`. Other ids use the prefixes `a_`, `tu_`, `r_`, `mv_` and `we_`.

## Technical requirements

### Deployment (DP-37)

- The runtime is Node.js 22 with npm, and the code is TypeScript.
- `/app/run.json` holds string commands for `install`, `build` and `serve`, plus `"_schema":"run-manifest-v1"`. For example:

  ```json
  {"_schema":"run-manifest-v1","install":"npm ci","build":"npm run build","serve":"npm run start"}
  ```

- The server binds `0.0.0.0` on the port in `APP_PUBLIC_PORT`, or 4173 when that variable is unset.
- `GET /api/health` answers HTTP 200 with JSON `{"status":"ok"}` whenever the process is up, whatever the state of its dependencies.
- The same build may be started several times at once with different databases, buckets and settings. Each instance uses only its own configured database and bucket. Instances may share one Kill Bill, so a top-up id is `tu_` followed by 16 random lowercase hex characters and never repeats across instances.

### Configuration and secrets (DP-60)

The server reads these variables at start:
- `DATABASE_URL`;
- `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_FORCE_PATH_STYLE`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`;
- `KILLBILL_URL`, `KILLBILL_USERNAME`, `KILLBILL_PASSWORD`, `KILLBILL_API_KEY`, `KILLBILL_API_SECRET`;
- `SMTP_HOST`, `SMTP_PORT`, `MAIL_FROM`;
- `APP_PUBLIC_PORT`;
- `JOB_RUN_SECONDS`, `LEASE_SECONDS`, `RETENTION_DAY_SECONDS`, `WEBHOOK_RETRY_BASE_SECONDS`, `OUTBOUND_ALLOWED_HOSTS`.

No credential or service URL is hard-coded, logged, or sent to the browser. Signed media links are the only storage URLs a browser ever receives.

### Server boundary (DP-13, DP-25, DP-37, DP-59)

- **Same origin.** The server sends no cross-origin sharing headers. A cookie-authenticated write (POST, PUT, DELETE) whose `Origin` header is present and differs from the app's own origin is `cross_origin`. The session cookie is HttpOnly and SameSite=Strict.
- **Body limits.**
  - JSON bodies may be at most 65,536 bytes; 65,536 is allowed and more is `payload_too_large`.
  - Upload bodies and fetched images may be at most 10,000,000 bytes; 10,000,000 is allowed and more is refused.
  - A JSON endpoint given another content type answers `unsupported_media_type`.
- **Never served**: source files, the run manifest, environment files, lockfiles, dependency folders and anything outside the built browser assets and the API. Such paths answer 404.
- **Outbound requests.** These rules apply to fetching image URLs and to registering and delivering webhooks.
  - Only `http` and `https` are allowed.
  - Every address the host resolves to is checked, and the connection uses a checked address.
  - These are refused:
    - loopback (127.0.0.0/8, ::1) and `localhost`;
    - private ranges (10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16, fc00::/7);
    - link-local and cloud metadata (169.254.0.0/16, fe80::/10);
    - 0.0.0.0/8, 100.64.0.0/10, multicast and broadcast;
    - IPv4-mapped IPv6 forms of any of these;
    - IP literals written in decimal, octal or hex.
  - Image fetches follow at most 3 redirects, re-checking every hop, and stop after 10 seconds. Webhook deliveries follow none.
  - A hostname listed exactly, case-insensitively, in the comma-separated `OUTBOUND_ALLOWED_HOSTS` (empty by default) is exempt from the address check. IP literals are never exempt, and a redirect from an exempt host to a non-exempt host is checked normally.
  - A refused address is a 422 on the field with the refusal copy, and nothing is requested from it.
- **Dependencies at boot.** If storage or Kill Bill is unreachable at start, the server still starts, serves its screens and health check, and behaves as an outage until the service returns. Postgres must be reachable for anything except the health check.

### Browser support and performance (DP-53)

- Supported browsers are current Chromium, Firefox and WebKit, at 375×812, 768×1024 and 1280×800.
- The Run screen is usable within three seconds of navigation with the seed data.
- Choosing a model rebuilds the form within a quarter of a second.
- Fonts are served from the app's own origin.

## Working rules

- IF-01: `/app/run.json` exists with string `install`, `build` and `serve` commands and `"_schema":"run-manifest-v1"`, and nothing else.
- IF-02: `/app/THIRD_PARTY_NOTICES.md` names every shipped package, meaning the production dependency tree reported by `npm ls --omit=dev --all --json`, and every bundled font, each with its licence.
- IF-03: Every shipped package and font is under MIT, ISC, BSD-2-Clause, BSD-3-Clause, Apache-2.0, 0BSD or OFL-1.1.
- IF-04: The app stores state only in Postgres and MinIO. No other database, cache server, embedded database or state file is added.
- IF-05: The provided service definitions and their dev credentials are used as given and are not edited.
- IF-06: The browser loads nothing from third-party origins at runtime, except the signed media links issued by the server.
- IF-07: The npm lockfile is committed, and `install` uses it without changing it.

## Engineering standards

- The code is idiomatic, strictly typed TypeScript, with no `any` in domain code and no suppressed type errors.
- Names in code match the domain terms in this brief: job, lease, reservation, settlement, release, movement, top-up, rate, budget period, payload visibility, tombstone.
- Each domain rule (job state transitions, unit and charge computation with its rounding, rate selection by submission time, access resolution, payload projection, and period boundaries) is decided in exactly one place and reused everywhere it applies.
- Money is integer micro-credits from input to storage. Floating-point arithmetic never touches an amount.
- There is no abstraction with a single implementation, and no dead, commented-out or unreachable code.
- There are no defensive checks for states the state machine or the database constraints already make impossible.
- Every API error goes through the one published error shape and precedence.
- Nothing beyond this brief is built: no extra endpoints, screens, roles or settings.
