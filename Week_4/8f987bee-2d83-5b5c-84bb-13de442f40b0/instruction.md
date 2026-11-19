# Wayline Data Pipeline Console

Build and deploy a working web application from this brief. There is no starting codebase. Wayline is a data pipeline console for a company's data platform team: the people who keep data flowing from the systems the business uses into the warehouse where it is analysed. The console has a connector catalog, sources and destinations, and connections that say which streams to copy, how to copy them and on what schedule. It also has a job history with live logs, a Builder for an HTTP source the catalog lacks, members with roles, and a tamper-evident audit log. A public marketing site sits beside it. Build the server with FastAPI, serve a React single-page application built with Vite, and store everything in the provided PostgreSQL database. Wayline takes no payment and sends no email. It uses no datastore, mail transport, model provider or third-party service beyond that database. Real third-party connectors, change data capture and jobs started automatically by a schedule are out of scope.

When you are done, a stranger must be able to do all of this without hitting an error page:

- open the app in a browser and sign in;
- create a connection from the sample commerce source to the warehouse, with chosen streams, sync modes and a schedule;
- press "Sync now" and watch the job finish;
- see the records in the warehouse tables, the incremental cursor advanced, and the job listed in the history with its log.

A job that reads Succeeded on screen while the warehouse tables are unchanged is incorrect. A sync is one all-or-nothing server operation: the tables, the cursors and the job status change together, or none of them change. This holds when the run is cancelled, when it fails, and when a server restart cuts it off. Someone watching while a sync commits sees every figure from before the commit or every figure from after it, never a mix, on the API and on the screen. A job runs to the end on the settings and source data it started with, even if someone edits the connection while it runs. When the answer to a request is lost on the way back, pressing the button again finishes the same request instead of doing the work twice. What the team changes stays changed across restarts, the server answers only the addresses and methods this brief publishes, and the public pages stay up when the database does not.

## Problem and users

A data platform team stops trusting its warehouse when a sync half-lands. There are four usual causes:

- a job says it succeeded but the tables are unchanged;
- a cancelled run leaves partial rows;
- two runs of one connection race each other;
- a replayed request copies everything twice.

Some quieter causes do the same damage:

- two people edit one connection and one silently overwrites the other;
- a run picks up half of an edit made while it was running;
- a dashboard shows new counts for one table and old counts for another;
- a connection page shows Succeeded beside last run's row counts;
- a reset leaves old rows reachable through a saved page link;
- a restart quietly puts the demo pipeline back the way it was, undoing the team's edits;
- a job id or table name passed around in a chat opens another team's run;
- a session that ends halfway through a long setup throws away everything typed.

Wayline makes every sync one all-or-nothing step whose counts match the stored rows, and shows the run live. Each run stays on the settings and source data it started with. Edits to a connection are versioned, so a stale edit is refused instead of overwriting newer work, and the screen always shows what is actually stored. Every change is attributed in an audit log that cannot be quietly rewritten.

| Role | Goal and limits |
|---|---|
| Visitor | Reads the marketing pages and the public connector catalog, then signs in at `/login`. **Cannot** read any workspace record without signing in. |
| Admin | Keeps the workspace staffed and governed: invites members, changes roles, changes the plan and reads the audit log. Can also do everything an editor does. |
| Editor | Keeps the pipelines running: creates and changes sources, destinations, connections and Builder projects, and runs, cancels and resets syncs. Reads everything in the workspace. **Cannot** manage members, change the plan or read the audit log. |
| Viewer | Checks the data: reads every source, destination, connection, job, log and warehouse record. **Cannot** create, change, check, run, cancel or reset anything. That includes Builder reads and sample events. |

Every signed-in user, viewers included, may change their own preferences. Sign-up is closed: people join only through an admin's invitation. There is no administrator back door. No request can raise its sender's role, move them to another workspace or set a server-kept value by carrying extra fields.

## Journeys

1. **Visitor browses.**
   - **Start:** a visitor with no session lands on `/`, under the headline "Keep every system in step with your AI.".
   - **Header and story:** they open the header menus and the story tabs with the keyboard alone. Tab never lands inside a closed menu or a dismissed consent card.
   - **Catalog:** they open `/connectors`, type quickly in the search box, tick filters and copy the address to a colleague. The cards, count and address always match the last thing typed. The colleague opens the address and sees the same filters and count. Back restores the previous filters. A search for a lone "%" finds nothing, because search matches the typed text literally.
   - **Pricing:** they open `/pricing`, change the Team credit package, and read the "Compare the plans" table, where every cell says Included or Not included in words. On a phone they switch plans in the comparison.
   - **Film:** they return home and watch the film "Hear your data move".
   - **Shared link while signed out:** a colleague's link to a connection opens `/login` with the link kept as the return address. A wrong password shows the wrong-password message, whether or not the email has an account.
   - **Database down:** when the database cannot be reached, the marketing pages and `/login` still load, and signing in shows the database outage message with the typed email kept.
   - **End:** with the right password they land on that connection's page. A return address that points anywhere outside the console lands them on the connections dashboard `/app` instead.
2. **Editor sets up a connection.**
   - **Start:** an editor on `/app/sources` adds a source. They then press "New connection" and walk the four-step wizard:
     - **Source:** pick "Shop Orders".
     - **Destination:** pick "Lumen Warehouse".
     - **Streams:** select streams and a sync mode for each.
     - **Schedule:** choose manual, an interval, or a cron expression with a time zone. Then set the schema change policy, a connection name and a namespace prefix.
   - "Back" keeps every value already entered.
   - A name already in use, or a schedule more frequent than the plan allows, is refused with field errors, and nothing is saved.
   - If the answer to "Create connection" is lost, the wizard says it couldn't confirm the action and keeps the values. Pressing "Create connection" again opens the one connection that was made.
   - If their session ended while they filled the wizard, "Create connection" sends them to sign in; after signing in they are back on the Schedule step with every value restored, and one press creates the connection.
   - **End:** "Create connection" saves the connection and opens its page. The page shows:
     - the flow diagram from the source through the hub to the warehouse;
     - the Streams table;
     - the next run in the connection's own time zone with its UTC offset, the same text the dashboard shows;
     - an empty job history.
3. **Editor runs a sync.**
   - **Start:** the editor is on a connection page and presses "Sync now".
   - **While it runs:**
     - "Starting sync…" is announced, then "Sync running". The job row reads Running, light pulses travel along the flow diagram, and the live log streams in line by line, each line once even if the connection drops and reconnects.
     - A colleague who changes the streams or sync modes during the run, or adds sample records to the source, does not change what this run writes.
     - A colleague watching the destination's table counts and the dashboard's health cards sees the old figures until the job reads Succeeded, then every new figure at once.
     - If the answer to "Sync now" is lost, pressing it again shows the same job, never a second one.
     - Fifty colleagues watching the live log at once do not slow the console down.
     - Someone from another workspace holding the job's id or a table name gets "not found" from every route and cannot cancel the run.
   - **When the job finishes:**
     - the job row reads Succeeded, "Sync succeeded" is announced, and every stream's Rows and Cursor in the Streams table change in the same moment;
     - with sync sounds on, a short rising chime plays.
   - **Warehouse table:** they open it and page forward and back. Reloading or sharing the address shows the same rows.
   - **Refusals and other actions:**
     - "Sync now" during a running job is refused.
     - "Cancel" ends the job as Cancelled with nothing written.
     - "Reset" asks for confirmation. The dialog stays open, with focus where the editor left it, through every history refresh and every job that ends meanwhile. "Reset tables" then empties the tables. Each table stays listed with 0 records, the cursors clear, a page link saved before the reset reports that it is no longer valid, and the job history still lists every job that ran. A reset pressed while a job runs is refused and the dialog closes.
     - When a colleague renamed the connection after the page opened, turning it off is refused; the page then shows the stored name, status and schedule, and turning it off again works.
   - **Server restart:** if the server restarts mid-run, the job reads Failed with the reason "interrupted" when the server comes back, and "Sync now" works again.
   - **End:** the job history lists every job once, newest first, with "Load older jobs" for the rest.
4. **Editor builds a connector.**
   - **Start:** the editor opens `/app/builder`.
   - They edit the starting manifest in the UI or YAML tab, enter the sandbox API key and press "Test". The `invoices` stream is read across three pages.
   - YAML that cannot be read keeps them on the YAML tab, with the reason beneath the field and "Test" and "Publish" disabled.
   - An address that would leave the sandbox is refused beneath its field.
   - They publish the project, create a source from the published connector, and sync it to the warehouse.
   - **End:** a new table holds the seven invoices.
5. **Admin manages the workspace.**
   - **Start:** an admin on `/app/members` invites a teammate as an editor, and the teammate accepts the invitation and starts working.
   - **Extra fields:** a request from the teammate that tries to set their own role or workspace alongside a preference, the acceptance or a connection edit is refused, naming the field, and nothing changes.
   - **Pages a role may not open:** the teammate who opens `/app/members` or `/app/audit` lands on `/app` with the permission message, and Back does not return to the refused page.
   - **Demotion:** the admin demotes the teammate to viewer. The teammate's very next write is refused, in the tab they already have open.
   - **Expired invitation:** an invitation left too long is refused as expired, and the admin invites that person again.
   - **Last admin:** when the admin tries to demote themselves while they are the only admin, the role select returns to admin and says why.
   - **Restart:** after the server restarts, the changed plan, the changed role, a renamed seeded connection and appended sample orders are all still as the team left them.
   - **End:** the admin changes the plan on `/app/settings` and opens `/app/audit`. The audit log lists every change in order, each naming who made it.
6. **Viewer reads.**
   - **Start:** a viewer signs in on a phone.
   - They open the navigation drawer, open a connection and walk its "Job history" table with "Load older jobs" while a colleague starts a sync. Every job appears exactly once, and the new one appears at the top.
   - They page through a warehouse table whose columns scroll sideways inside their frame with the record id pinned, and read the logs. No write control is shown. A connection or table address from another workspace shows its not-found view.
   - **End:** anyone signs out from the account menu and returns to the home page.

## Mandatory requirements

This is the complete list of mandatory requirements; every check traces to one of these lines and the detailed sections below.

- **DP-01 — Health route** The app serves its pages and its JSON interface on one origin and answers `GET /api/health` with 200 and `{"status":"ok"}` once ready.
- **DP-02 — Stored collections** Records live in PostgreSQL in collections with exactly the names listed in Services, and the constraints listed there hold in the stored data.
- **DP-03 — Seed data** The app seeds the workspaces, users, pipeline and catalog listed in Seed data once and never duplicates them on restart.
- **DP-04 — Sessions and lockout** Sign-in returns a bearer token, sign-out invalidates it, and wrong passwords answer 401 and then lock the email, identically for known and unknown emails, as qualified in Business rules.
- **DP-05 — Closed sign-up** Nobody can create an account except by accepting an admin's invitation.
- **DP-06 — Viewer is read-only** A viewer reads every workspace record and receives 403 for every create, change, check, run, cancel, reset, Builder read and sample event.
- **DP-07 — Editor limits** An editor receives 403 from member, plan and audit routes.
- **DP-08 — Session required** Every console request without a valid session answers 401.
- **DP-09 — Workspace isolation** A user from another workspace gets 404 for this workspace's records, Builder projects and custom connectors, and no list, count or figure includes them.
- **DP-10 — Sign-in pages** `/login` signs a person in and opens the address the server returns, shows and announces the wrong-password and locked messages, and "Sign out" returns to the home page.
- **DP-11 — Request identity** Every `/api` response carries an `X-Request-Id`, every error body repeats it as `request_id`, every request writes one structured stdout log line with it, and a job records the id of the request that started it.
- **DP-12 — Invitations** An admin invites a person with a role, and the invitation is accepted once, before it expires, with a password of at least twelve characters.
- **DP-13 — Roles** An admin changes a member's role, and the workspace always keeps at least one admin.
- **DP-14 — Members and settings pages** The "Invite member" form shows the invite link once and announces its errors, the members list changes roles, and only an admin sees the "Plan" select.
- **DP-15 — Audit chain** Every audited change enters a gapless hash-chained audit log naming its actor, and no audit event can be changed or deleted.
- **DP-16 — Catalog interface** The public catalog lists the built-in definitions and filters them by type, category, availability and name.
- **DP-17 — Catalog page** `/connectors` narrows its cards by search and filters with a politely announced "Showing N" count, keeps the filters in its address, and restores them on reload and on Back.
- **DP-18 — Sources** Only runnable definitions become sources, source settings are validated, a source check reports rejected credentials and the sample source exposes its three streams.
- **DP-19 — Secret API key** A source API key is never stored as readable text and never appears in any response, header, check message, job record, log line, live event, audit event or stdout log, refused submissions included.
- **DP-20 — Sources page** The "New source" form shows a refused value's error beneath its field and creates the source.
- **DP-21 — Plan limits** The plan sets the minimum schedule interval, an admin changes the plan, and an interval or cron schedule more frequent than the plan allows is refused.
- **DP-22 — Connection creation** A valid connection is stored active at version 1 with a name unique in the workspace and warehouse tables no other connection to that destination targets.
- **DP-23 — Connection validation** An invalid stream, sync mode, cursor, prefix, cron expression or time zone is refused with field errors and nothing stored.
- **DP-24 — Next run** `next_run_at` follows the manual, interval and cron rules, cron matching wall-clock minutes in the connection's time zone across DST changes.
- **DP-25 — Connection wizard** The four-step wizard keeps values on "Back", shows the schedule fields for the chosen schedule, including "Time zone" for Cron only, and creates the connection.
- **DP-26 — Connections dashboard** `/app` shows the health cards, the monitor line and the connection list with a "New connection" button.
- **DP-27 — Full refresh sync** A succeeded full refresh job lands exactly the source rows from the start date on, overwriting or appending as its mode says.
- **DP-28 — Incremental sync** Incremental append adds only rows newer than the cursor, incremental dedup keeps the newest row per `id`, and the cursor advances to the largest committed `updated_at`.
- **DP-29 — Reconciled figures** Job counts, table row counts and the workspace figures are computed from stored rows and agree with each other.
- **DP-30 — Schema change policy** When a stream gains a field the next sync propagates it, ignores it or pauses the connection as its policy says, and reactivating a paused connection from its current version accepts the fields as they stand.
- **DP-31 — Job record** A finished job carries its attempts, per-stream counts, log, timings and the connection and connector versions it ran on, and the history lists jobs newest first.
- **DP-32 — Reset** Reset empties a connection's existing tables and clears its cursors, as qualified in Business rules.
- **DP-33 — One job at a time** A connection runs at most one job, so a second sync, a reset during a run and a sync of an inactive connection are refused with 409.
- **DP-34 — Simultaneous requests** Of simultaneous sync requests for one connection exactly one creates a job, and of simultaneous creations with one connection name exactly one creates a connection.
- **DP-35 — Idempotency** A replayed `Idempotency-Key` returns the first connection or job before the key expires, simultaneous replays create exactly one and answer with its id or as in flight, and reusing a live key with another body is refused.
- **DP-36 — Cancel and failure** A cancelled or failed job changes no table and no cursor, and rejected credentials fail after three attempts.
- **DP-37 — Live job events** The job event stream sends each log line and the final status to a holder of a valid session token.
- **DP-38 — Sync on the connection page** "Sync now", "Cancel", "Reset" and the "Connection active" switch work from the connection page, with each job result shown in the history and announced.
- **DP-39 — Flow diagram motion** The flow diagram moves while a job runs and is still when idle or under reduced motion.
- **DP-40 — Sync sounds** With "Sync sounds" on, a finished job plays a chime whose notes are Web Audio oscillators started in the page, and with it off no audio node starts.
- **DP-41 — Job history paging** Job history pages newest first with an opaque cursor bound to its listing, returns each earlier job exactly once while new jobs start, and refuses a page size outside 1 to 100 or a foreign or altered cursor.
- **DP-42 — Warehouse records** Warehouse records page forward and back in written order with `total_count` and a cursor bound to their table and its current generation, and the table page shows 50 rows at a time.
- **DP-43 — Sandbox API** The sandbox invoices API requires its key and pages the seven invoices.
- **DP-44 — Builder test read** A Builder test read follows every page and detects field types, a refused key is reported as a source error, and the manifest is validated.
- **DP-45 — Sandbox-only reads** A Builder base address or stream path that, once decoded and resolved, leaves `/mock-api/` is refused before anything is read.
- **DP-46 — Published connectors** Publishing creates a versioned custom source definition whose sources sync their streams with the version current when each job is created.
- **DP-47 — Builder page** The Builder's "UI" and "YAML" tabs stay in step and its "Test" button lists the records read.
- **DP-48 — Preferences** Each user's sync sounds and theme persist across sessions, and the dark theme darkens the console.
- **DP-49 — Command palette** Control+K or Command+K opens the command palette, which opens a matching connection and returns focus on Escape.
- **DP-50 — Console accessibility** Console pages meet WCAG 2.2 AA in both themes and show a visible focus indicator on every control reached by Tab.
- **DP-51 — Console touch targets** At 375 CSS pixels wide every console control and navigation link is at least 44 by 44 CSS pixels.
- **DP-52 — Console reduced motion** Under reduced motion no console loop runs and no content is lost.
- **DP-53 — Home page** The home page shows its headline, actions and architecture story, with its decorative drawing surface hidden from assistive technology.
- **DP-54 — Home motion** The hero backdrop shimmers, the architecture lines draw with the scroll, sections fade up and metrics count up, and under reduced motion every loop, scroll effect and count-up stops with content kept in place.
- **DP-55 — Film** The film with its captions and chapters is served, plays muted on its own only without reduced motion, and seeks by chapter.
- **DP-56 — Consent and privacy** No analytics identifier is stored, and a dismissed consent card stays hidden.
- **DP-57 — Marketing routes** Each marketing route loads with its headline without waiting for scripts, and an unknown address answers 404 with a link home.
- **DP-58 — Marketing chrome** The header, menus and footer are the same on every marketing route, the menus work by keyboard and pointer, and the filled primary action darkens on hover.
- **DP-59 — Pricing page** The pricing page shows four plan cards and the plan comparison, one plan at a time behind a "Plan" switch below 768 CSS pixels, and the credit package changes the Team price.
- **DP-60 — Responsive public layout** Public pages reflow from 320 CSS pixels with no sideways scrolling, stack on phones, fold the header into a menu and show three catalog columns from 992 CSS pixels.
- **DP-61 — Public accessibility** Public pages meet WCAG 2.2 AA, show visible focus on every control reached by Tab and meet the touch target size.
- **DP-62 — Visual system** The public site and console follow the colour, type, shape and status language described in Visual design.
- **DP-63 — Component architecture** Shared pieces are built once as reusable components that look and behave the same wherever they appear.
- **DP-64 — Interrupted jobs recover** A job left pending or running when the server stops is failed as interrupted on the next start, before health answers 200, and the connection can sync again.
- **DP-65 — Role changes take effect at once** A role change applies to every existing session of the member on its very next request.
- **DP-66 — Safe return after sign-in** A signed-out console address sends the person to `/login` with a `next` address, and sign-in returns them there only when it resolves inside `/app`, otherwise to `/app`.
- **DP-67 — Connection versions** A connection carries a version raised by one on each change listed in Business rules, and a PATCH needs a current `If-Match`, answering 428 without one and 412 `version_mismatch` when stale, so exactly one of simultaneous PATCHes from one version succeeds.
- **DP-68 — Jobs keep their starting versions** A job runs on the connection settings and connector manifest of the versions it recorded at creation and on the source records as they stood when it began running, and changes made after those moments apply from the next job.
- **DP-69 — Records page address** The warehouse table page keeps its page in the address, so reload, a shared link, Back and Forward show the same rows, and a stale or foreign page link shows the no-longer-valid alert.
- **DP-70 — Marketing keyboard model** The story tabs, the phone "Plan" switch, the header menus and the narrow "Menu" overlay work fully by keyboard as described in Interactions.
- **DP-71 — Invitation expiry** An invitation accepted at or after the end of its configured lifetime is refused with 410 `invite_expired`, stores nothing, and no longer blocks a new invitation to that email.
- **DP-72 — Honest role select** A refused role change returns the "Role for <member name>" select to the role the server holds and announces why.
- **DP-73 — Unknown fields refused** Every JSON body accepts only the fields its API entry lists, at every depth, and any other key answers 400 `validation` naming its dotted path with nothing stored.
- **DP-74 — Console retries reuse their key** The console sends an `Idempotency-Key` with "Create connection" and "Sync now", resends the same key after a lost or 5xx answer, sends a fresh key after an answered request or a wizard change, and shows a replay as success.
- **DP-75 — All-or-nothing visibility** Every reader sees a sync's tables, records, cursors, job and workspace figures either all before its commit or all after it, and a job's rows only once it reads Succeeded.
- **DP-76 — Reset leaves no trace** A reset empties the connection's existing tables and invalidates their page links, creates no table, keeps the status, version, known schema and job history, and equals one serial order when it meets a sync.
- **DP-77 — Named history and records tables** The Job history and warehouse records tables carry the published names, columns and row headers, and "Load older jobs" merges pages by job id so every job shows exactly once while new jobs arrive.
- **DP-78 — Seed identity** The seed creates each seeded row once under a fixed seed identity, and a restart never re-creates, renames, re-plans, re-roles or re-versions a seeded row someone has changed, as qualified in Seed data.
- **DP-79 — Published surface only** No generated documentation, schema, trailing-slash redirect or unpublished method answers, and a defined `/api` path called with another method answers 405 `method_not_allowed` with an `Allow` header naming its published methods.
- **DP-80 — Literal, bounded input** Catalog search matches its text literally within 100 characters, and a request string carrying a NUL, a value of the wrong JSON type or a body that is not a JSON object is refused with 400 `validation` naming its field, never 422 or a 5xx.
- **DP-81 — Key lifetime** An `Idempotency-Key` answers as a replay only before its `expires_at`, and at or after it the same key is a new request that runs every check and, on success, is recorded again.
- **DP-82 — Honest connection switch** A refused "Connection active" toggle leaves the page showing the stored connection's status, name, schedule and next run, announces why, and the next toggle carries the stored version.
- **DP-83 — Object checks on every route** Every job, log, event, cancel, tables and records route answers 404 `not_found` for an object of another workspace, a malformed id or a table name that is not a listed table of that destination, and never touches that object.
- **DP-84 — Readable plan comparison** The plan comparison is a table named "Compare the plans" whose every cell states its value in words, with glyphs hidden from assistive technology and AA contrast, at every width.
- **DP-85 — Database outage copy** When the database cannot be reached every page route, the media and the not-found page still answer from the server, and an action answered 503 `service_unavailable` shows the published database outage copy in `alert` with the form values kept.
- **DP-86 — Published landing routes** A signed-in person opening `/login` lands on `/app`, a console page the current role may not open is replaced by `/app` with the permission alert, the palette offers only allowed pages, and an unknown, foreign or malformed connection or table address shows its published not-found view.
- **DP-87 — Wizard draft survives sign-in** When "Create connection" answers 401 the wizard draft is kept in that tab for the same user and restored once, on its saved step with every value, after that user signs in again, and it is discarded for anyone else.
- **DP-88 — Live Streams table** The connection page's "Streams" table shows each selected stream's sync mode, row count and cursor, and at a job's end its Rows and Cursor cells change in the same render as the job row and the "Sync status" copy.
- **DP-89 — Dialog and paging survive refreshes** The job history refresh, job events and job ends never close, re-mount or move focus out of an open "Reset connection" dialog, and never drop the focus on "Load older jobs" or the older rows already loaded.
- **DP-90 — Console breakpoints** The console shows the "Navigation" drawer below 992 CSS pixels and the "Console" rail from 992, places the job history beside the live log from 1280, and scrolls records sideways inside a focusable frame with a pinned row header.
- **DP-91 — Closed panels are unavailable** A closed header menu, the closed "Menu" overlay, the closed "Navigation" drawer and a dismissed consent card are out of the accessibility tree and the Tab order, and widening past 992 CSS pixels with an overlay open closes it and leaves nothing inert.
- **DP-92 — Latest catalog input wins** The catalog's cards, "Showing N" count and address always match the latest controls, discarding any earlier answer that arrives late.
- **DP-93 — Announced sync progress** "Sync status" announces "Starting sync…", "Sync running" and the final copy once each in that order, and the live log shows every line exactly once across reconnects by the published event ids.
- **DP-94 — Next run in its zone** The dashboard and the connection page show each next run in the published format, in the connection's own time zone with its UTC offset.
- **DP-95 — Unreadable YAML holds the tab** While "Manifest YAML" cannot be read the YAML tab stays selected, the published copy describes the field, and "Test" and "Publish" are disabled.
- **DP-96 — Event streams release the database** An open job event stream holds no database connection of its own while it waits, stops its work within 5 seconds of its client leaving, and fifty open streams never slow other requests past one second.

## Frontend

### Screens and layout (DP-10, DP-14, DP-17, DP-20, DP-25, DP-26, DP-38, DP-42, DP-47, DP-53, DP-57, DP-59, DP-60, DP-69, DP-77, DP-84, DP-86, DP-88, DP-90)

| Route | Surface |
|---|---|
| `/` | the home page: floating marketing header, hero, architecture diagram, metrics, story tabs, film and footer |
| `/connectors` | the public connector catalog with search, filters and catalog cards |
| `/pricing` | the pricing page with four plan cards and the plan comparison |
| `/connector-builder`, `/data-replication`, `/hybrid`, `/mcp`, `/context-layer`, `/why-open-source`, `/compare`, `/data-engineering-resources` | marketing routes |
| `/signin` | the sign-in chooser page with two product cards |
| `/login` | the sign-in form |
| `/accept-invite` | the invitation acceptance form |
| `/app` | the connections dashboard with health cards and the connection list |
| `/app/connections/new` | the connection wizard |
| `/app/connections/<connection id>` | the connection page with the flow diagram, Streams table, job history and live log |
| `/app/sources` | the source list with a "New source" form |
| `/app/destinations` | the destination list with its tables |
| `/app/destinations/<destination id>/tables/<table>` | one warehouse table, one page of records at a time, with the page held in the address |
| `/app/builder` | the Builder with UI and YAML tabs and the results panel |
| `/app/members`, `/app/audit`, `/app/settings` | the members list, the audit log and preferences |

These routes are the complete list of pages. `<connection id>`, `<destination id>` and `<table>` each stand for any single non-empty path segment: the server answers those addresses with the console page whatever the segment holds, and the console itself decides whether to show the record or its not-found view. Every other address, `/docs`, `/redoc` and `/docs/oauth2-redirect` included, is an unknown address.

**Home.**
- **Hero.**
  - A static "14.8K STARS" badge sits above the centred hero.
  - The h1 reads "Keep every system in step with your AI.". The words "with your AI." sit on the gradient line.
  - The subcopy reads "Link 300+ business systems to your analytics and model layers. Copy data, query it by meaning, and let agents act across the whole company. Run it in your warehouse, private cloud, or your own servers.".
  - Two actions follow: a filled "Try it free" link to `/login` and an outline "Talk to sales" link.
  - Behind the hero, a dot-grid drawing surface shimmers slowly. It is hidden from assistive technology.
- **Wordmarks.** A row of placeholder customer wordmarks drifts sideways.
- **Architecture diagram.** Connector tiles on the left send glowing pulses along curved lines into the central hub. The hub fans out to cards labelled "AI agents" and "Warehouses".
- **Metrics.** Four figures: "300+" connectors, "9,000+" teams, "4B" records moved daily and "15%" of the Global 2000.
- **Story sections.**
  - "Old pipeline problems follow you into the agent era.", with the cards Connector upkeep, Split versions of the truth, and Control versus ease.
  - "One layer between your systems and everything built on them.", with a tab set named "One layer". Its three tabs, 01 Copy, 02 Query and 03 Act, each switch the diagram and its caption in the tab panel below.
  - "Private by design, not by promise.", with a two-panel hybrid diagram whose bridge reads "Metadata only".

**Film.** The home page has a section headed "Hear your data move".
- A video player plays `/media/data-in-sound.webm` with native controls.
- The player carries two tracks:
  - an English captions track from `/media/data-in-sound.en.vtt`, with language code `en` and label "English";
  - a chapters track from `/media/data-in-sound.chapters.vtt`.
- An "Unmute film" toggle button reports its pressed state.
- A list named "Chapters" holds the buttons "Arrival", "Volume" and "Caught up".
- A "Show transcript" button reveals the caption lines as page text.

**Connectors.**
- **Heading.** The h1 reads "Reach the data in every system you run.". The line "For people and agents alike." sits on the gradient line.
- **Checklist.**
  - "Open code: read, fork, or extend any connector"
  - "Incremental syncs that absorb schema changes for you"
  - "Run it hosted, on your own servers, or in your own cloud"
  - "Usage-based pricing you can forecast"
  - "800K pipelines a day across 9,000+ teams"
- **Filter column.**
  - A search field labelled "Search connectors", which accepts at most 100 characters.
  - Under Connector Type, the checkboxes "Sources", "Destinations" and "Agent Capabilities".
  - Under Availability, the checkboxes "Cloud", "OSS" and "Hybrid".
  - Under Use case, the radio buttons "All" plus one for each catalog category in Seed data.
  - A "Clear all" button.
- **Count.** Above the grid, a line reads "Showing <count>", where `<count>` is the number of cards shown.
- **Cards.** Each card is a link named by the connector name, showing a monogram tile, the name, the category and the availability tags.
- **Content.** The page lists only the built-in definitions, whether or not the visitor is signed in. It reads its cards from the catalog API with the parameters the controls set, so it filters exactly as that API does, search included.

**Pricing.**
- **Heading.** The h1 reads "Plans that grow with your pipelines". The lede reads "Try it free for 21 days with 250 credits, roughly 60 GB of syncs. No card needed.".
- **Plan cards.** Each of the four cards is headed by its plan name:

  | Card | Content |
  |---|---|
  | Starter | "From", "$15", "/month" |
  | Team | marked "Best value past 25 GB" and emphasised as the recommended plan; "$140", "/month" |
  | Scale | "Custom" |
  | Private Cloud | "Custom" |

- **Credit package.** The Team card has a select labelled "Credit package" with these options:
  - "30 credits · $140/mo"
  - "80 credits · $340/mo"
  - "200 credits · $780/mo"
  - "400 credits · $1,420/mo"
  - "800 credits · $2,560/mo"
  - "1,600 credits · $4,200/mo"

  Choosing an option sets the Team price figure to that option's dollar amount on its own, such as "$340", with "/month" beside it.
- **"Compare the plans".** The comparison is a data table named "Compare the plans", headed by the visible heading "Compare the plans".
  - The header row's first cell is empty and is not a header. Its other cells are column headers holding the plan names Starter, Team, Scale and Private Cloud, in that order.
  - Each body row starts with a row header holding the row name. The rows and their cells, in plan order:

    | Row | Starter | Team | Scale | Private Cloud |
    |---|---|---|---|---|
    | Fastest Sync Interval | 1 hr | 15 min | 5 min | 5 min |
    | Cron Schedules | Included | Included | Included | Included |
    | Builder | Included | Included | Included | Included |
    | Single Sign-On | Not included | Not included | Included | Included |
    | Audit Log | Included | Included | Included | Included |

  - Each Included cell shows a tick glyph and each Not included cell a cross glyph, each hidden from assistive technology, beside the visible word. The cell's text is exactly the word: "Included" or "Not included". The interval cells hold their text with no glyph.
  - **From 768 CSS pixels up,** the table shows all four plan columns side by side, and there is no "Plan" tab set.
  - **Below 768 CSS pixels,** a tab set named "Plan", with the tabs Starter, Team, Scale and Private Cloud, sits above the comparison, and Starter is selected first. The selected tab's panel holds the same named table, with the same row headers, the empty first header cell and only the selected plan's column header and cells. The other panels are hidden, from assistive technology too.

**Marketing routes.** Each route loads directly with its h1.

| Route | h1 and content |
|---|---|
| `/connector-builder` | "Build and deploy custom connectors", with "in minutes, not days" |
| `/data-replication` | "The open standard for data movement" |
| `/hybrid` | "Run the data plane yourself. Skip the upkeep." |
| `/mcp` | "The Wayline MCP Server" |
| `/context-layer` | "One context layer for every agent, across every business system" |
| `/why-open-source` | "Own your context.", with the open-source guarantees and community figures |
| `/compare` | "Compare the data movement tools", with a grid of placeholder comparison cards |
| `/data-engineering-resources` | "All Data Engineering Resources", with a grid of placeholder article cards |
| `/signin` | "Sign in to your Wayline account" on a near-black page, with two cards whose buttons lead to `/login` |

**Marketing header and footer.**
- **Header.** A floating white header card is inset from the page edges with a pale ring. It holds:
  - the logo at left;
  - in the centre, the Product, Solutions and Resources menu triggers, then the Connectors, Docs and Pricing links;
  - at right, "Sign in", an outline "Talk to sales" and a filled "Try it free".
- **Docs link.** "Docs" leads to `/data-engineering-resources`, never to a generated API page.
- **Menu panels.** Each trigger opens a panel holding its links.
- **Narrow screens.** Below 992 CSS pixels the header shows a "Menu" button. It opens a frosted full-height overlay named "Menu", which holds a "Close menu" button followed by every header link and action.
- **Footer.**
  - It opens with a band reading "Build with Wayline" and "Ship agents and pipelines in minutes, not days.".
  - Link columns follow under Product, Resources, Developers and Legal.
  - It ends with "(c) 2026 Wayline. All rights reserved.".
- **Consent card.** A region named "Cookie consent" sits at the bottom left, offering "Manage preferences" and "Dismiss".
- The header, footer and consent card are identical on every marketing route.

**Sign in and invitation.**
- `/login` has:
  - a text field labelled "Email";
  - a password field labelled "Password", an input of type password so typed characters are masked;
  - a "Sign in" button.

  Success opens the address the server returns, as the Interactions describe.
- `/accept-invite?token=<invite token>` has a password field labelled "Password" (an input of type password) and an "Accept invitation" button. Acceptance signs the person in and opens `/app`.

**Console shell.**
- **Navigation.** Every `/app` page has the console navigation links: Connections, Sources, Destinations, Builder, Members, Audit log and Settings. Members and Audit log appear only for admins.
  - **From 992 CSS pixels wide,** the links sit in a fixed left rail, a navigation landmark named "Console", always visible. There is no "Open navigation" button.
  - **Below 992 CSS pixels wide,** there is no rail. The top bar shows an "Open navigation" button, which opens a drawer dialog named "Navigation" sliding in from the left. The drawer holds a "Close navigation" button followed by the navigation links.
- **Top bar.** It holds the workspace name, a "Sync sounds" switch, a "Dark theme" switch and an avatar button labelled "Account menu". That menu offers "Sign out".
- **Write controls.** These are absent for viewers:
  - "New connection" and the wizard;
  - "New source" and "Create source";
  - "Sync now", "Cancel" and "Reset";
  - the "Connection active" switch;
  - "Test" and "Publish".
- **Role refresh.** The console reads the signed-in user's role again on every page change, so the controls and pages offered follow a role change within one navigation, as the landing rules in Interactions describe.

**Connections dashboard.**
- **Heading.** `/app` has the h1 "Connections".
- **Health cards.** Three cards show Records synced, Latency and Freshness, each as a large figure taken from the workspace figures. A `null` figure shows as "—".
- **Monitor line.** It sits above the cards:
  - It reads "All syncs healthy" when no connection's latest job failed.
  - Otherwise it reads "<n> connections need attention", where `<n>` is the number of connections whose latest job failed.
  - A connection with no jobs counts as healthy.
- **Connection list.** Each row is a link named by the connection name and shows:
  - its source and destination;
  - its status;
  - its last job status, as a dot plus a word;
  - its next run, written as the next-run text from Business rules.
- **"New connection".** This button opens `/app/connections/new`.
- **Refresh.** The figures and the list load when the page opens and reload every 30 seconds while it stays open.

**Connection wizard.**
- **Steps.** `/app/connections/new` shows the four steps Source, Destination, Streams and Schedule in an ordered list. The current step is highlighted and is marked as current for assistive technology with `aria-current="step"`.
- **Source step.** A select labelled "Source".
- **Destination step.** A select labelled "Destination".
- **Streams step.** For each stream:
  - a checkbox labelled "Sync <stream>";
  - a select labelled "Sync mode for <stream>", offering Full refresh overwrite, Full refresh append, Incremental append and Incremental dedup.
- **Schedule step.**
  - A select labelled "Schedule", offering Manual, Every N minutes and Cron.
  - A number field labelled "Interval minutes", shown only for Every N minutes.
  - A field labelled "Cron expression" and a select labelled "Time zone", shown only for Cron. "Time zone" lists "UTC" first, then every IANA zone name in alphabetical order, and defaults to UTC.
  - A field labelled "Connection name".
  - A field labelled "Namespace prefix".
  - A select labelled "Schema change policy", offering Propagate, Ignore and Pause.

**Connection page.** `/app/connections/<connection id>` has:
- **Heading.** The connection name as its h1.
- **Flow diagram.** One image named "Data flow from <source name> to <destination name>".
- **Summary.**
  - the status;
  - a "Connection active" switch for editors and admins, checked when the status is `active`;
  - the next run, written as the next-run text from Business rules;
  - the schedule.
- **Streams table.** A table named "Streams", one row per stream selected in the connection's stored settings, in catalog order. Its columns:
  - **Stream:** the row header, holding the stream name.
  - **Sync mode:** the wizard's option label for the stream's mode, such as "Full refresh overwrite".
  - **Rows:** the `row_count` of that stream's warehouse table, or "—" while the destination does not list that table.
  - **Cursor:** the stream's `cursor_value` exactly as the state API gives it, or "—" when it is `null`.
- **Job history.** A table named "Job history", newest job first, ten jobs to a page. Its columns:
  - **Job:** the row header, as written in Public screens.
  - **Status:** a dot plus the status word.
  - **Started:** the job's `started_at` in the viewer's local time, empty while the job is pending.
  - **Records:** the job's `records_committed`.
  - **Reason:** a failed job's `failure_reason`, empty otherwise.

  Below the table sit the "Load older jobs" button and the "Showing <n> jobs" line.
- **Buttons.**
  - "Sync now".
  - "Cancel", shown only while a job is pending or running.
  - "Reset".
- **Live log.**

The job row, the Streams table and the live log update from the live job events. The history refreshes as Interactions describe.

**Connection not found.** When the connection address names an id that is unknown, belongs to another workspace or is not a well-formed id, the page shows the h1 "Connection not found" and a link "Back to connections" to `/app`, inside the console shell, and nothing else from any connection.

**Sources and warehouse pages.**
- **Sources page.** `/app/sources` lists sources.
  - **"New source" form.** It has these controls:
    - a text field labelled "Name";
    - a select labelled "Connector", listing the runnable and custom source definitions;
    - a password field labelled "API key", an input of type password so the key is masked as it is typed;
    - a plain text field labelled "Start date", not a native date picker. It takes a date typed as `YYYY-MM-DD` and shows that pattern as its hint;
    - a "Create source" button.
  - **Source rows.** Each row has a "Check" button.
- **Destinations page.** `/app/destinations` lists destinations with their tables and row counts.
- **Table page.** Each table opens `/app/destinations/<destination id>/tables/<table>`.
  - The page shows the records in a table named "<table> records", 50 rows to a page, with the columns in the order Public screens gives.
  - The table sits inside a frame: a region named "Scroll <table> records", which takes focus in the Tab order. When the columns are wider than the frame, the table scrolls sideways inside the frame, the row header column stays pinned at the frame's left edge, and the page itself never scrolls sideways.
  - Above the table, a line reads "<total> records", where `<total>` is the table's `total_count`.
  - Below it are "Previous page" and "Next page" buttons.
- **Table not found.** When the destination is unknown, foreign or malformed, or `<table>` is not one of the tables that destination lists, the page shows the h1 "Table not found" and a link "Back to destinations" to `/app/destinations`, inside the console shell, and no rows.

**Builder.**
- **Starting manifest.** `/app/builder` opens a new project from this manifest:
  - `base_url` `/mock-api/v1`;
  - an `api_key` auth whose header is `X-Api-Key`;
  - one stream `invoices`, with path `/invoices`, primary key `["id"]` (a list of field names), record selector `data` and page size 3.
- **Tabs.** There are two tabs, "UI" and "YAML".
  - The UI tab has fields labelled "Base URL", "Stream name", "Path" and "Page size".
  - The YAML tab has a text area labelled "Manifest YAML". It shows the same manifest as YAML, with lines such as `name: invoices` and `page_size: 3`.
- **Below the tabs.** A password field labelled "API key" (an input of type password) and a "Test" button.
- **Results panel.** It shows:
  - the count, as "<n> records";
  - each record id, such as "INV-1042";
  - the detected fields, with their types.
- **Publish.** A "Publish" button publishes the project.

**Members, audit and settings.**
- **Members.** `/app/members` lists members. Each row has a select labelled "Role for <member name>".
- **"Invite member" form.** Its fields are labelled "Email", "Name" and "Role". After an invitation it shows the invite link, `/accept-invite?token=<invite token>`, once.
- **Audit log.** `/app/audit` lists events oldest first. Each row shows `seq`, the action, the target, the actor email and the time.
- **Settings.** `/app/settings` holds the preferences. For an admin it also holds a "Plan" select.

**Viewports.** Every page fits its viewport width with no sideways scrolling at 375x812, 768x1024 and 1280x800, and at every width from 320 CSS pixels up. "Below N" means N minus one CSS pixel and narrower; "from N" means N and wider.

| Width | Layout |
|---|---|
| Below 480 CSS pixels | Everything stacks in one column. The hero buttons are full width. |
| Below 768 CSS pixels | The comparison table shows one plan at a time behind the "Plan" tab set. The catalog shows one column. |
| From 768 CSS pixels | The catalog shows two columns. |
| Below 992 CSS pixels | The header links fold behind "Menu". The console navigation is the "Navigation" drawer opened from the top bar. |
| From 992 CSS pixels | The catalog shows three columns. The console navigation is the fixed "Console" rail. |
| Below 1280 CSS pixels | On the connection page, the live log sits below the job history. |
| From 1280 CSS pixels | The content column widens toward its cap and is centred. On the connection page, the job history and the live log sit side by side in one row, the log to the right. |

**375 wide.**
- The hero is one column.
- The catalog filters sit in a collapsible panel above one column of cards.
- The pricing cards stack.
- The console navigation is the drawer, and the records table scrolls inside its frame.
- The wizard shows one step's fields at full width.

**768 wide.**
- The catalog filters sit above two columns of cards.
- The pricing cards form a two-by-two grid.
- The console navigation is still the drawer.

**1280 wide.**
- The catalog has a left filter column beside three columns of cards.
- The four pricing cards sit in one row.
- The console rail is fixed at the left.
- On the connection page, the flow diagram and the Streams table sit above the job history and the live log, which sit side by side.

Console rows stay compact from tablet width up. At phone width, row controls grow to the touch size.

**Unknown address.** An address that does not exist answers HTTP status `404` with a not-found page carrying a link home. It never answers with a blank page, a `200` fallback, a redirect or a server error.

### Public screens and controls (DP-10, DP-14, DP-17, DP-25, DP-38, DP-47, DP-49, DP-55, DP-56, DP-58, DP-59, DP-69, DP-70, DP-72, DP-77, DP-82, DP-84, DP-86, DP-88, DP-90)

Only these roles and names are public; everything else is free. A password input has no ARIA role of its own, so each one below is written as `password field labelled "<label>"`. This means an input of type password whose accessible name, given by its visible label, is exactly that text. Checks find these fields by label, never by a `textbox` role. Every `textbox` below is a plain text input or text area.

| Where | Role and accessible name | Visible copy or behaviour |
|---|---|---|
| Marketing header | `button "Product"`, `button "Solutions"`, `button "Resources"` | menu triggers reporting their expanded state; each panel holds `link` items |
| Marketing header | `link "Connectors"`, `link "Docs"`, `link "Pricing"`, `link "Sign in"`, `link "Talk to sales"`, `link "Try it free"` | header links and actions |
| Marketing header, below 992 CSS pixels | `button "Menu"`; `dialog "Menu"` holding `button "Close menu"` | the frosted overlay |
| Every marketing route | `region "Cookie consent"` holding `button "Manage preferences"` and `button "Dismiss"` | the consent card |
| Home | `heading` level 1 | "Keep every system in step with your AI." |
| Home story | `tablist "One layer"` with `tab "01 Copy"`, `tab "02 Query"`, `tab "03 Act"`, each controlling a `tabpanel` named by its tab | the story tabs |
| Home film | `button "Unmute film"` (pressed state); `list "Chapters"` with `button "Arrival"`, `button "Volume"`, `button "Caught up"`; `button "Show transcript"` | film controls |
| Connectors | `textbox "Search connectors"`; `checkbox "Sources"`, `checkbox "Destinations"`, `checkbox "Agent Capabilities"`, `checkbox "Cloud"`, `checkbox "OSS"`, `checkbox "Hybrid"`; `radio "All"` and one `radio` per category, named by the category; `button "Clear all"` | filters |
| Connectors | `status "Catalog results"` (polite) | "Showing <count>" |
| Connectors | `link "<connector name>"` per card | catalog card |
| Pricing | `heading "Starter"`, `heading "Team"`, `heading "Scale"`, `heading "Private Cloud"`, `combobox "Credit package"` | plan cards |
| Pricing | `table "Compare the plans"` with `columnheader` per plan name and a `rowheader` per row name | the plan comparison |
| Pricing, below 768 CSS pixels | `tablist "Plan"` with `tab "Starter"`, `tab "Team"`, `tab "Scale"`, `tab "Private Cloud"`, each controlling a `tabpanel` named by its tab | the comparison plan switch |
| Not-found page | a link whose name contains "home" | link home |
| Sign-in form | `textbox "Email"`, password field labelled "Password", `button "Sign in"`, `status "Sign-in status"` | sign-in |
| Accept invite | password field labelled "Password", `button "Accept invitation"`, `status "Invitation status"` | acceptance |
| Console navigation, from 992 CSS pixels | `navigation "Console"` holding the navigation links | the rail |
| Console navigation, below 992 CSS pixels | `button "Open navigation"`; `dialog "Navigation"` holding `button "Close navigation"` and the navigation links | the drawer |
| Console top bar | `switch "Sync sounds"`, `switch "Dark theme"`, `button "Account menu"`, `menuitem "Sign out"` | preferences and sign-out |
| Console | `dialog "Command palette"` holding `textbox "Search commands"` and one `option` per match | command palette |
| Console | `alert` | the permission and outage copies from Feedback states |
| Dashboard | `heading "Connections"` level 1, `link "<connection name>"` per row, `button "New connection"` | dashboard |
| Wizard | the ordered list of steps with `aria-current="step"`; `combobox "Source"`, `combobox "Destination"`, `checkbox "Sync <stream>"`, `combobox "Sync mode for <stream>"`, `combobox "Schedule"`, `spinbutton "Interval minutes"`, `textbox "Cron expression"`, `combobox "Time zone"`, `textbox "Connection name"`, `textbox "Namespace prefix"`, `combobox "Schema change policy"`; `button "Next"`, `button "Back"`, `button "Create connection"`; `status "Connection form status"` | wizard |
| Connection page | `heading` level 1 with the connection name; `img "Data flow from <source name> to <destination name>"`; `switch "Connection active"`; `button "Sync now"`, `button "Cancel"`, `button "Reset"`; `alertdialog "Reset connection"` with `button "Reset tables"` and `button "Keep tables"`; `log "Live log"`; `status "Sync status"`; `status "Connection status"` | connection page |
| Connection page | `table "Streams"` with `columnheader` "Stream", "Sync mode", "Rows" and "Cursor" in that order; in each `row`, a first cell that is a `rowheader` holding the stream name | streams |
| Connection page | `table "Job history"` with `columnheader` "Job", "Status", "Started", "Records" and "Reason" in that order; in each `row`, a first cell that is a `rowheader` named "Job <first 8 characters of the job id>"; `button "Load older jobs"`; `status "Job history status"` | job history |
| Connection not found | `heading "Connection not found"` level 1, `link "Back to connections"` | not-found view |
| Sources page | `textbox "Name"`, `combobox "Connector"`, password field labelled "API key", `textbox "Start date"` (a plain text input taking `YYYY-MM-DD`), `button "Create source"`, `button "Check"` per source, `status "Source form status"` | the "New source" form |
| Warehouse table | `region "Scroll <table> records"` holding `table "<table> records"`, where `<table>` is the warehouse table name such as `shop_orders`; one `columnheader` per column, in order: the stream's fields in the order the source catalog lists them, then `_wayline_job_id`, then `_wayline_extracted_at`; in each `row`, a first cell that is a `rowheader` holding the record's `id`; `button "Previous page"`, `button "Next page"`; `status "Records status"`; `alert` holding `link "First page"` | records |
| Table not found | `heading "Table not found"` level 1, `link "Back to destinations"` | not-found view |
| Builder | `tab "UI"`, `tab "YAML"`; `textbox "Base URL"`, `textbox "Stream name"`, `textbox "Path"`, `spinbutton "Page size"`, `textbox "Manifest YAML"`, password field labelled "API key"; `button "Test"`, `button "Publish"`; `status "Builder status"` | Builder |
| Members | `textbox "Email"`, `textbox "Name"`, `combobox "Role"`, `button "Invite member"`, `combobox "Role for <member name>"` per member, `status "Members status"` | invitations and roles |
| Settings | `combobox "Plan"` (admins only), `status "Settings status"` | plan |

- **Status cells.** Wherever a job status is shown as a dot plus a word, in the job history and on the dashboard, the dot is hidden from assistive technology and the word is the cell's text.
- **Disabled controls.** "Previous page", "Next page", "Test" and "Publish" while the YAML cannot be read, the "Connection active" switch while its request is pending, and any button disabled while its request is pending carry the native disabled attribute.

### Interactions (DP-10, DP-17, DP-25, DP-38, DP-47, DP-48, DP-49, DP-55, DP-56, DP-58, DP-59, DP-66, DP-69, DP-70, DP-72, DP-74, DP-76, DP-77, DP-82, DP-86, DP-87, DP-88, DP-89, DP-90, DP-91, DP-92, DP-93, DP-95)

**Header menus, by pointer and keyboard.**
- **Opening.**
  - A click on a trigger opens its panel, and a second click closes it.
  - Enter, Space or Down Arrow on a trigger opens its panel and moves focus to the panel's first link.
- **Moving.** Down Arrow and Up Arrow move focus between the panel's links. They wrap from the last link to the first and from the first to the last.
- **Closing.**
  - Escape closes the panel and returns focus to its trigger.
  - Moving focus out of the panel with Tab or Shift+Tab closes it.
  - A click outside the panel closes it.
- **One at a time.** Opening one menu closes any other, so at most one panel is open.
- **Tab order.** Through the header, Tab moves from the logo to the menu triggers, then the links, then the actions. A closed panel's links are never in it.

**Narrow "Menu" overlay.**
- "Menu" opens `dialog "Menu"` and moves focus to "Close menu".
- While it is open:
  - Tab and Shift+Tab cycle through the dialog's controls only;
  - the page behind cannot be reached by keyboard, pointer or assistive technology.
- Escape or "Close menu" closes the overlay and returns focus to "Menu".

**Console "Navigation" drawer.**
- "Open navigation" opens `dialog "Navigation"` and moves focus to "Close navigation".
- While it is open, Tab and Shift+Tab cycle through the drawer's controls only, and the page behind cannot be reached by keyboard, pointer or assistive technology.
- Escape or "Close navigation" closes the drawer and returns focus to "Open navigation". Choosing a link closes the drawer and opens that page.

**Closed means unavailable.** A closed header menu panel, the closed "Menu" overlay, the closed "Navigation" drawer and a dismissed consent card are absent from the accessibility tree and hold nothing reachable by Tab, at every width. Moving a panel out of view or making it transparent does not count as closing it. When the window widens to 992 CSS pixels or more while "Menu" or "Navigation" is open, that overlay closes, and nothing on the page is left inert or hidden from assistive technology.

**Tab sets: "One layer" on home and "Plan" on phone pricing.**
- Only the selected tab is in the Tab order; the others are skipped.
- Right Arrow and Left Arrow move focus to the next or previous tab and select it at once, so its panel shows. They wrap at both ends.
- Home selects the first tab, and End selects the last.
- A click selects a tab.
- On the "One layer" tabs, the caption in the panel changes with the selected tab.
- On the "Plan" tabs, the comparison table shows the selected plan's column.

**Consent card.** "Dismiss" hides the card, and it stays hidden on later visits.

**Signing in and the return address.**
- **Signed-out console.** A signed-out person who opens any `/app` address goes straight to `/login?next=<address>`. The same happens when any console request answers 401: the console first forgets its token, then opens the login address. `<address>` is the console page's path and query, percent-encoded as one query value. The login address replaces the current history entry, so Back does not return to the refused page.
- **The `next` value.** `/login` reads `next` from its own address once, as the browser's parameter parsing gives it, and sends it unchanged with the sign-in request.
- **Pending and refusals.** "Sign in" shows the sign-in pending, wrong-password, locked and outage states from Feedback states. The person stays on `/login` until sign-in succeeds.
- **Success.** On success, the page opens exactly the `redirect_to` address the server returns, following the return-address rule in Business rules.
- **Signed in already.** A signed-in person who opens `/login`, with or without `next`, is sent to `/app`, replacing the history entry.
- **Other links.** "Try it free" opens `/login`.
- **Sign out.** "Sign out" in the "Account menu" ends the session and opens `/`, whatever `next` the address held.

**Pages a role may not open.** `/app/members` and `/app/audit` are for admins only, and `/app/connections/new` is for editors and admins.
- When a signed-in person reaches one of these pages their current role may not open, the console replaces the address with `/app`, so Back does not return to the refused page, and shows the permission copy from Feedback states in `alert`. This happens on a direct load or reload, on a command palette choice, on every page change (the role is read again at each one, so the first page change after a demotion already follows the new role), and when a role reload after a 403 finds the page showing is no longer allowed.
- The command palette lists only the pages the current role may open.

**Film.**
- **Autoplay.** Without a reduced-motion preference, the film starts playing muted and loops. Under reduced motion it never starts on its own.
- **Sound.** "Unmute film" turns the sound on and off.
- **Chapters.** The chapter buttons move the film to the start of their chapter: 0, 12 and 24 seconds.
- **Transcript.** "Show transcript" reveals the four caption lines.

**Catalog.**
- **Narrowing.** On `/connectors`, typing in "Search connectors" or changing a filter reads the catalog API with the new parameters and narrows the cards and the "Showing <count>" line to its answer. Typing may wait for a pause of at most 300 milliseconds before reading.
- **Latest input wins.** The cards, the count and the address always show the answer for the controls as they are now. An answer for an earlier search or filter that arrives after a later one is discarded, so the final keystroke is never lost. When Back or Forward is used while a read is still on its way, the page shows the entry that was reached.
- **Clearing.** "Clear all" restores the full list.
- **Address.** The address follows the catalog address rule in API. Share it, reload it, or go Back or Forward, and the controls and count come back.

**Pricing.** Choosing a "Credit package" option changes the Team price figure.

**Wizard.**
- "Next" and "Back" move between steps. "Back" keeps every value already entered.
- Changing "Schedule" shows only the fields for that schedule.
- "Create connection" saves the connection and opens its page. It carries an `Idempotency-Key` that follows the console retry rule in Business rules.
- If the server refuses the connection, the wizard returns to the step holding the first failing field and moves focus to that field.
- **Draft across a lost session.**
  - When "Create connection" answers 401, the wizard saves its draft in that browser tab's session storage before the console opens `/login`: every field value and the step that was showing, bound to the signed-in user's id.
  - The next wizard load in that tab after the same user signs in restores the draft once: the wizard opens on the saved step with every value, and announces the draft-restored copy from Feedback states in `status "Connection form status"`. The draft is then discarded, so a later visit starts blank.
  - The draft is discarded without being restored when a different user signs in that tab, on "Sign out", on a successful create, and when the wizard is opened any other way. In each of these cases the wizard starts blank on the Source step.
  - The 401 was an answered request, so the next "Create connection" press uses a fresh `Idempotency-Key`, and one press creates exactly one connection.

**Connection page.**
- **"Sync now"** starts a job. It carries an `Idempotency-Key` that follows the console retry rule in Business rules. After the press, `status "Sync status"` announces the sync progress copies from Feedback states in order, each exactly once.
- **Live log.** The page opens the job's live event stream. `log "Live log"` shows each line exactly once, in order, the same lines `GET /api/jobs/{job_id}/logs` lists, even when the stream drops and reconnects: a reconnect sends the last event id it received, as the Live job events in API describe. The page stops listening when the `status` event arrives.
- **"Cancel"** cancels the pending or running job.
- **"Reset"** opens the "Reset connection" alert dialog with focus on "Keep tables":
  - Tab and Shift+Tab cycle between "Reset tables" and "Keep tables" only.
  - "Reset tables" resets the connection. On success the dialog closes and focus returns to "Reset".
  - When "Reset tables" is refused with `sync_already_running`, the dialog closes, focus returns to "Reset", the refusal copy is announced in `status "Sync status"`, and the table figures shown stay as they were.
  - "Keep tables" or Escape closes the dialog without resetting and returns focus to "Reset".
  - The dialog belongs to the person who opened it. The 5-second history refresh, live job events, a job ending and a colleague's job starting never close it, re-create it or move focus: it stays the same open dialog with focus on the control last chosen until the person closes it or answers it. A colleague's job that starts while it is open leaves it open; "Reset tables" then meets `sync_already_running` as above.
- **"Connection active".**
  1. Toggling the switch sends a PATCH carrying, in `If-Match`, the version the page last read. While it is pending the switch is disabled and shows the state it had before the toggle.
  2. On success, the switch shows the status the server returned, and the page keeps the returned version.
  3. On `version_mismatch`, the page reads the connection again. It then shows the stored status on the switch, the stored name as the h1, and the stored schedule and next run, and announces the version-mismatch copy from Feedback states. The next toggle carries the version that read returned.
  4. On any other refusal, the page reads the connection again in the same way and announces that refusal's copy.

  At no moment after a refusal does the switch, the heading or the schedule show the state that was requested.
- **Streams table.** It reads its rows, counts and cursors when the page opens, after an accepted PATCH, after an accepted reset, and at a job's end as the job-end render in Feedback states describes. It updates in place, with no reload and no loss of focus.
- **Job history.**
  - The table reads the first page of ten jobs when the page opens, again every 5 seconds while the page stays open, and again when a job ends.
  - "Load older jobs" reads the next page using the `next_cursor` of the oldest page loaded and adds its rows below. The button is present only while that oldest page's `has_more` is true.
  - Rows merge by job id. A job not shown yet takes its place in newest-first order, so a new job appears at the top. A job already shown updates in place. Older rows already loaded stay.
  - No job ever shows twice.
  - A refresh never moves focus. Focus on "Load older jobs", or on anything else, stays where it was, and the rows loaded with "Load older jobs" stay.

**Warehouse table page.**
- **The address holds the page.**
  - The first page's address has no `cursor` parameter when it is reached from the destinations list or from "First page".
  - "Next page" opens `?cursor=<next_cursor>` and adds a history entry.
  - "Previous page" opens `?cursor=<prev_cursor>` and adds a history entry.
- **Reload and history.** Reload, a shared link, Back and Forward each show the rows, the "<total> records" line and the button states of that address.
- **Button states.**
  - "Previous page" is disabled when `prev_cursor` is `null`.
  - "Next page" is disabled when `has_more` is false.
- **After a reset.** The first page reads "0 records" and shows no rows, and both page buttons are disabled.
- **A refused cursor.** When the address carries a cursor the server refuses with `invalid_cursor`, the page shows no rows and shows the bad-link alert from Feedback states. Its "First page" link opens the table address without `cursor`.
- **Sideways scrolling.** With focus on the "Scroll <table> records" frame, Right Arrow and Left Arrow scroll the table sideways inside it. The row header column stays at the frame's left edge.

**Console switches.** Each preference switch reports its checked state and saves to the user's preferences, so it survives a reload.

**Command palette.**
- Control+K, or Command+K on a Mac, opens the "Command palette" dialog from anywhere in the console, with focus in "Search commands".
- Typing lists the matching connections and the pages the current role may open as options. Up Arrow and Down Arrow move the highlight, and Enter opens the highlighted option.
- Escape closes the palette and returns focus to where it was.

**Builder.**
- A change in either tab shows in the other when you switch tabs.
- **Unreadable YAML.** The manifest text can be read when it is valid YAML whose top level is a mapping and whose `streams`, if present, is a list. While "Manifest YAML" cannot be read:
  - choosing the "UI" tab is refused, and the "YAML" tab stays selected;
  - the unreadable-YAML copy from Feedback states shows beneath "Manifest YAML" as that field's description;
  - "Test" and "Publish" are disabled.

  As soon as the text can be read again, the copy goes away and the tab switch and both buttons work again.
- "Test" reads every page of the stream named in "Stream name", with the "API key" entered.
- "Publish" publishes the project.

**Members.**
- **Saving.** Changing a "Role for <member name>" select saves the new role at once.
- **Displayed value.** The select always ends on the role the server holds:
  - on success, it shows the role in the answer;
  - on any refusal or outage, it returns to the role the member held before the change.
- **Quick changes.** Two quick changes are sent in order, and the select ends on the answer to the last one.

**Every form.**
- Inputs show the violet focus ring.
- Labels sit above their fields and errors sit beneath them. Each error is linked to its field as the field's description.
- Dialogs close on Escape and return focus to the control that opened them.
- Every icon-only control carries a text label.

### Visual design (DP-50, DP-51, DP-61, DP-62, DP-84)

**Character.** Wayline looks like a bright, exact engineering tool:
- **Pages.** White pages with a faint dotted texture behind the headlines. Body text is grey and headings are black.
- **Action colour.** One violet colour marks everything you can press, darkening to deep navy on hover.
- **Highlights.** Hero second lines and big figures glow from violet into pink.
- **Type.** Buttons, navigation, tags and eyebrows use small capitals in a typewriter face. Headings and body text use a plain geometric sans.
- **Cards.** Cards sit in thin grey rings with rounded corners.
- **Sign-in chooser.** It is near-black.
- **Console.** The console is light, with an optional dark theme in deep night blues. It is dense with information: rows are compact, and the digits of figures line up in columns.

**Colour.**
- **Text and surfaces.**
  - Body text is a mid neutral grey on a near-white page. Headings are a near-black neutral, and muted secondary text is a lighter grey.
  - Hairlines and card rings are pale neutrals. A subtle off-white sits behind panels, and an off-white fills the console page.
- **Violet.**
  - The single action colour is a vivid violet. It marks primary buttons, links on hover, focus rings, tags and the active navigation item.
  - A lighter lavender marks the borders of product mock-ups.
  - A pale cool violet tint marks the active row.
- **Gradients and glows.**
  - Hero second lines and stat figures run a gradient from that violet to a warm pink.
  - The hub tile runs from a light soft indigo at the top to a deep indigo at the bottom.
  - Glows are a light vivid indigo.
- **Sign-in chooser.** A near-black page with near-black cards outlined in deep grey.
- **Dark theme.** Panels are a deep cool night blue on a darker blue page.
- **Status.** Each status pairs a coloured dot with a word: green Succeeded, amber Running, red Failed, grey Cancelled and grey Pending. Terminal windows show three dots in the same green, amber and red.
- **Plan comparison.** Ticks are drawn in the violet and crosses in a mid grey dark enough to hold the glyph contrast below. Meaning never rests on the glyph or its colour: the word beside it says it.

**Type.**
- **Families.**
  - Headings and body text use Inter, falling back to the system sans.
  - Uppercase button labels, navigation labels, tag chips and eyebrows use Fragment Mono.
  - Code, logs and YAML use JetBrains Mono.
- **Licensing and hosting.** All three are SIL Open Font License fonts. Ship their font files in the app source and serve them from the app's own origin, never from a font CDN.
- **Sizes.**
  - Body copy is set at a comfortable reading size with generous line spacing. Interface labels are a step smaller.
  - Hero headlines are several times the body size, with tight letter spacing, over two lines.
  - Section headings are about twice the body size.

**Shape and depth.**
- **Corners.** Controls and tabs are slightly rounded. Search fields and large cards are rounded more generously, and chips are fully round.
- **Rings and shadows.**
  - Cards sit in a thin pale grey ring.
  - Raised product mock-ups cast a soft violet-tinted shadow.
  - The consent card floats on a soft shadow.
- **Overlay.** The mobile menu overlay is frosted: it blurs the page behind it. The console drawer sits over a dimmed page.

**Iconography.**
- **Glyphs.** Icons are inline line glyphs drawn in the current text colour:
  - a downward chevron on menu triggers;
  - a magnifying glass for search;
  - a diagonal up-right arrow for links that open elsewhere;
  - a plus for add actions;
  - a tick for confirmations and Included cells;
  - a cross for Not included cells, on "Close menu" and on "Close navigation";
  - three stacked lines on "Open navigation";
  - two stacked rounded squares for copy;
  - three coloured dots on terminal windows;
  - a stack of discs for a database.
- **Logo.** An original Wayline mark: a looped ribbon in violet beside a black wordmark.

**Composition.** Public pages alternate wide centred bands with two-column story sections. The console uses a fixed rail (or a drawer on narrow screens), a top bar and a single content column of tables and panels.

**Accessibility.**
- **Contrast.** Public pages and both console themes meet WCAG 2.2 AA contrast. In the "Compare the plans" table, at every width, each word in a cell meets 4.5:1 against its background and each tick or cross glyph meets 3:1 against its background.
- **Focus.** Every control reached by Tab shows a visible focus indicator, the records frame included.
- **Keyboard.** The whole console, the command palette and the drawer included, works by keyboard.
- **Touch targets.** At a viewport 375 CSS pixels wide, on `/`, `/pricing`, `/connectors`, `/signin`, `/login` and every `/app` page, each of these is at least 44 by 44 CSS pixels:
  - every visible button, tab and form control (a checkbox or radio is measured by its label's box);
  - every visible link in the header, the footer, an open menu, the "Menu" overlay or the console navigation.

  Links in body text are exempt.
- **Decorative graphics.** The flow diagram's beams, the dot grid, the particles and the comparison glyphs are hidden from assistive technology.
- **Film.** The film has captions and a transcript.
- **Sound.** No sound plays unless the user switched sounds on.

### Motion and effects (DP-39, DP-52, DP-54, DP-55)

Motion is about data travelling: pulses run along lines between boxes, dashed links creep forward, the hub breathes, and sections rise into view. Transitions start quickly and ease to a stop. Blurred fades run more slowly and gently.

**Entering.**
- Sections fade in and rise a short distance as they scroll into view, in under half a second.
- Dialogs and the command palette fade and scale up slightly in about a fifth of a second.
- The menu overlay slides down in about a quarter of a second.
- The console drawer slides in from the left in about a quarter of a second.
- A newly selected tab panel crossfades in in about a fifth of a second.

**Exiting.** Dialogs, menus, the overlay, the drawer and the palette fade out in about a tenth of a second, faster than they arrive. When the exit ends, the panel is closed as Interactions define it.

**Hover and press.**
- On hover, the filled primary action darkens from violet to deep navy in about a sixth of a second.
- Buttons sink slightly while pressed.
- On hover, catalog cards lift a little and their ring turns violet.

**State change.**
- A job status dot changes colour in about a fifth of a second.
- When a run finishes, one soft ring spreads outward from the diagram's end node over about one second.

**Progress.** While a job runs, on the connection page:
- light pulses travel along the flow diagram's lines from source to hub to warehouse, each crossing a line in about three seconds;
- dashed links march steadily forward;
- the hub slowly swells and settles, about every two seconds.

When no job is running, the diagram is still.

**Home loops.**
- The hero dot grid shimmers slowly.
- The wordmark row drifts sideways and fades out at both edges.
- On the architecture diagram, pulses run along the lines and the hub breathes.

**Other marketing loops.**
- On `/mcp`, the chat typing dots lift in turn and the orbit rings turn slowly.
- On `/connector-builder`, the YAML caret blinks. While the "AI ASSISTANT" drafting state is thinking, a light sweeps across the YAML.

**Count-up.** The first time the four home metrics enter view, each counts up from zero through visible intermediate values over about one and a half seconds.

**Signature interaction: the architecture lines draw with the scroll.**
1. When the top of the architecture diagram enters at the bottom of the viewport, its curved lines are undrawn and the tiles are faint.
2. As the diagram scrolls up toward the centre of the viewport, each line draws from its connector tile toward the hub in step with the scroll. Halfway through that scroll, about half of each line is drawn and the tiles have reached full strength.
3. When the centre of the diagram reaches the centre of the viewport:
   - every incoming line is fully drawn;
   - the outgoing lines to "AI agents" and "Warehouses" draw;
   - the pulses begin.
4. Scrolling back reverses this step by step, in exact proportion to the scroll: the pulses stop, the outgoing lines undraw, then the incoming lines undraw.

**No other loops.** There is no looping or decorative motion beyond the motions named in this section.

**Reduced motion.** A reduced-motion preference stops every loop, scroll effect and count-up, and the film's autoplay, everywhere, with all content kept in place:

| Motion | Under reduced motion |
|---|---|
| Section rise | Content appears in place at once. |
| Dialogs, menus, overlay, drawer, palette and tab panels | Appear and disappear at once. |
| Hover lift and press sink | Become colour changes only. |
| Hero dot grid | Stays still. |
| Wordmark row | Becomes a still row. |
| Metrics | Show their final value at once. |
| Architecture lines | Are fully drawn from the moment the diagram appears, with no pulses. |
| Flow diagram | Stays still. A running job shows through its Running status and the live log. |
| Finished-run ring | Does not appear. |
| MCP and Builder loops | Stay still. |
| Film | Never starts on its own. |

### Feedback states (DP-10, DP-14, DP-17, DP-20, DP-25, DP-38, DP-40, DP-47, DP-69, DP-71, DP-72, DP-74, DP-77, DP-82, DP-85, DP-86, DP-87, DP-88, DP-93, DP-95)

Each async action shows the states below in its named live region. Every region announces politely, except `alert`, which announces at once. Every copy string is shown character for character as printed here, with straight apostrophes.

**Database outage copy.** When a request answers `503` with `error` `service_unavailable`, the action's page shows "Wayline can't reach its database right now. It keeps retrying on its own." in `alert`. The form keeps its values, the address does not change, and the pressed button is enabled again.

**Outage copy.** When a request gets no answer, or answers with any other 5xx, the action's page shows "Wayline couldn't confirm this action. Check the list before trying again." in `alert`. The form keeps its values and the pressed button is enabled again.

**Permission copy.** When a request answers 403, or a page the role may not open is refused, the page shows "You don't have permission to do that." in `alert`. After a 403 it then reloads the user's role, so any control the role no longer allows disappears.

**Pending controls.** The control that started a pending request is disabled until the request is answered or found to have no answer.

| Action | Pending | Success | Refusals |
|---|---|---|---|
| Sign in | the button reads "Signing in…" | opens `redirect_to` | 401: "Email or password is incorrect."; 429: "Too many sign-in attempts. Try again in <minutes> min.", where `<minutes>` is the `Retry-After` seconds divided by 60, rounded up |
| Accept invitation | "Accepting…" | opens `/app` | the field error beneath "Password"; used token: "This invitation has already been used."; unknown token: "This invitation link is not valid."; expired token: "This invitation has expired. Ask an admin for a new one." |
| Catalog filter | none | "Showing <count>" in `status "Catalog results"` | none |
| Create source | "Creating source…" | "Source created" | each field's message beneath its field |
| Check source | "Checking…" | "Check succeeded" | "Check failed: <message>", where `<message>` is the check `message` |
| Create connection | "Creating connection…" | opens the connection page and announces "Connection created", for a first answer and a replay alike | each field's message beneath its field; `name_taken`: "A connection with this name already exists."; `table_conflict`: "Another connection already writes <table> in this destination."; `frequency_exceeds_plan`: "Your plan allows syncs at most every <min> minutes.", where `<min>` is the workspace's `min_interval_minutes`; 401: the draft is kept as Interactions describe |
| Wizard draft restored | none | "Signed in again. Your connection draft is restored." | none |
| Turn connection on or off | "Saving…" | "Connection turned on" or "Connection turned off" | `version_mismatch`: "This connection changed since you opened it. Showing the latest version."; 403: the permission copy; outage: the outage copy |
| Sync now | "Starting sync…" from the press until the job reads `running`, then "Sync running"; the row reads Pending or Running and the live log streams; a replay answer shows that job's row and log the same way | "Sync succeeded" when the job ends `succeeded` | "Sync failed" when it ends `failed`; "Sync cancelled" when it ends `cancelled`; `sync_already_running`: "A sync is already running for this connection."; `connection_inactive`: "This connection is paused. Turn it on to sync." |
| Cancel | "Cancelling…" | "Sync cancelled" | `job_not_active`: "This job has already finished." |
| Reset | "Resetting…" | "Connection reset" | `sync_already_running`: the Sync now copy |
| Load older jobs | none | "Showing <n> jobs", where `<n>` is the number of job rows shown; the line updates whenever that number changes | the outage copy |
| Load records page | "Loading records…" | "Page loaded" | `invalid_cursor`: "This page link is no longer valid." in `alert`, with the link "First page" |
| Builder YAML | none | none | while the YAML cannot be read: "This YAML can't be read. Fix it before switching tabs." beneath "Manifest YAML" as its description |
| Builder test | "Reading pages…" | "Test read finished: <n> records" | `source_http_error`: "The sandbox refused the request (HTTP <http_status>)."; field messages beneath their fields |
| Publish | "Publishing…" | "Published version <version>" | `stream_not_tested`: "Test every stream before publishing." |
| Invite member | "Creating invite…" | "Invite created", with the link | `already_member`: "This person is already a member." beneath "Email"; `already_invited`: "This person already has an open invitation." beneath "Email" |
| Change role | "Saving…" | "Role updated" | `last_admin`: "The workspace needs at least one admin."; 403: the permission copy; outage: the outage copy. In every refusal the select returns to the role the server holds. |
| Change plan | "Saving…" | "Plan updated" | none |
| Preferences | none | "Preferences saved" | none |

**Sync progress sequence.** After one press of "Sync now", `status "Sync status"` takes exactly three texts, in this order, each once: "Starting sync…", "Sync running", and the final copy for the job's end status. No event, refresh or reconnect sets any of them a second time.

**Job end on the connection page.** When the page learns that a job has ended, from its final `status` event or from a history refresh, whichever comes first, it first reads that job, the destination's tables and the connection's state. It then applies all of these in one render: the job row's Status and Records, the final copy in `status "Sync status"`, and every stream's Rows and Cursor in the Streams table. Until that render, the job row keeps its earlier status and the Streams table its earlier figures, so the page never shows Succeeded beside the old row counts, or the new row counts beside Running.

| Live region | Actions it announces |
|---|---|
| `status "Sync status"` | Sync now, Cancel and Reset |
| `status "Connection status"` | turning the connection on or off |
| `status "Job history status"` | the job history count |
| `status "Records status"` | records pages |
| `status "Builder status"` | Builder test and Publish |
| `status "Source form status"` | sources |
| `status "Connection form status"` | the wizard, the restored draft included |
| `status "Members status"` | members and roles |
| `status "Settings status"` | the plan and preferences |
| `status "Sign-in status"` | sign-in |
| `status "Invitation status"` | acceptance |

Each job row's Status cell reads Pending, Running, Succeeded, Failed or Cancelled.

**Sound.** When "Sync sounds" is on, a finished job plays a short two-note chime made with the Web Audio API: an audio context starts one oscillator per note, with no audio file and no audio element. The chime rises for success and falls for failure or cancellation. With sounds off, no oscillator or other audio source node starts.

## Backend

### API (DP-01, DP-04, DP-05, DP-08, DP-11, DP-12, DP-13, DP-15, DP-16, DP-17, DP-18, DP-21, DP-22, DP-23, DP-24, DP-31, DP-37, DP-41, DP-42, DP-43, DP-44, DP-46, DP-66, DP-67, DP-71, DP-73, DP-79, DP-80, DP-83, DP-93, DP-96)

**General.**
- **Same origin.** The application serves a JSON interface under `/api`, on the same origin as its pages.
- **Public endpoints.** These need no session:
  - public pages;
  - `GET /api/health`;
  - `POST /api/auth/login`;
  - `POST /api/auth/accept-invite`;
  - the public catalog;
  - the sandbox API;
  - the media files.
- **Sessions.** Every other `/api` endpoint this brief defines needs a session, carried as `Authorization: Bearer <token>`. `<token>` is the `token` returned by sign-in or by acceptance.
- **Format.** Request and response bodies are `application/json` in UTF-8. Every timestamp is ISO 8601 in UTC, ending in `Z`.
- **Request fields.** Each endpoint entry below lists every field its JSON body may carry, at every depth. The unknown-field rule in Business rules covers everything else.

**The published surface.** The endpoints in this section, with their methods, are the whole API.
- **Undefined paths.** An `/api` path this brief does not define is not an endpoint. It answers `404` `not_found`, with or without a session, never `401` and never a redirect. That includes:
  - generated documentation and schema paths: `/api/docs` and `/api/openapi.json`;
  - a defined path with a trailing slash, such as `/api/connections/`;
  - a path with doubled slashes, such as `/api//connections`.
- **Outside `/api`.** `/docs`, `/redoc`, `/openapi.json` and `/docs/oauth2-redirect` are unknown addresses, answered as Screens and layout says. No API documentation or schema is served anywhere.
- **Methods.** A defined `/api` path called with a method this brief does not give it, `HEAD`, `OPTIONS` and `TRACE` included, answers `405` `{"error":"method_not_allowed","request_id":"<id>"}`.
  - The answer carries an `Allow` header listing exactly the methods this brief gives that path, separated by commas, in any order.
  - For example, `/api/connections/{connection_id}` allows `GET, PATCH`; `/api/connections` allows `GET, POST`; `/api/me` and `/api/audit` allow `GET`; `/api/audit/{seq}` allows `GET`.

**Error shape.**
- **Refusals.** A refused request answers `{"error":"<code>","request_id":"<id>"}`.
- **Validation refusals.** These answer `400` with `{"error":"validation","fields":{"<field key>":"<message>"},"request_id":"<id>"}`, naming every failing field.
  - Field keys are dotted paths into the request, such as `email`, `config.api_key`, `schedule.time_zone`, `streams.0.path` and `streams.0.known_fields`.
  - A query parameter uses its own name, a header uses the header name, and a body that is not a JSON object uses `body`.
  - Each message is a short English sentence that never repeats the submitted value.
- **No side effects.** A refused request stores nothing.

The general codes are:

| Code | Status |
|---|---|
| `unauthenticated` | 401 |
| `forbidden` | 403 |
| `not_found` | 404 |
| `method_not_allowed` | 405 |
| `validation` | 400 |
| `invalid_cursor` | 400 |
| `precondition_required` | 428 |
| `version_mismatch` | 412 |
| `payload_too_large` | 413 |
| `unsupported_media_type` | 415 |
| `service_unavailable` | 503 |

**Error precedence, for every endpoint.** When a request breaks several rules, the first rule in this list decides the answer:
1. the size and type refusals from Server boundary;
2. routing, before any session check: `not_found` for an `/api` path this brief does not define, then `method_not_allowed` for a defined path called with a method this brief does not give it;
3. `service_unavailable`, while the database cannot be reached;
4. `unauthenticated`;
5. `not_found`, for an unknown resource, a resource of another workspace, or a path id that is not well formed;
6. `forbidden`;
7. preconditions: `precondition_required`, then `version_mismatch`;
8. `Idempotency-Key` handling: a live replay answers with its stored outcome before any later check, then an in-flight request is refused, then a reused key is refused;
9. `validation`, unknown fields, unreadable bodies and wrong types included, then `invalid_cursor`;
10. the endpoint's own conflicts, in the order its entry lists them.

The only exception is invitation acceptance, whose entry states its own order for the steps after `unauthenticated`.

**Health.** `GET /api/health` answers `200` `{"status":"ok"}` once ready.

**Sessions.**
- **`POST /api/auth/login`** takes `{ email, password, next }`. `next` is optional.
  - Success answers `200` `{ token, user, redirect_to }`. `redirect_to` follows the return-address rule in Business rules.
  - A missing `email` or `password`, or a `next` that is not a string of at most 2,000 characters, answers `400` `validation`.
  - Its own conflicts, in order:
    1. the locked answer from Business rules;
    2. `401` `{"error":"invalid_credentials","request_id":"<id>"}`, for a wrong password or an unknown email.
  - `next` never changes or appears in a 401 or 429 answer.
- **`POST /api/auth/logout`** answers `204` and invalidates that token.
- **Sign-up.** There is no sign-up endpoint. `POST /api/auth/signup` is an undefined path and creates no user.
- **`GET /api/me`** answers `200` `{ user }`. `user` carries:
  - `id`, `email` and `name`;
  - `role`, the member's current role;
  - `workspace_id`;
  - `preferences`, holding `sync_sounds` (a boolean) and `theme` (`light` or `dark`).
- **`PATCH /api/me/preferences`** takes `{ sync_sounds, theme }`, either of which may be omitted. It answers `200` `{ preferences }`. A theme other than `light` or `dark` answers `400`.

**Members.** All member routes are admin-only.
- **`GET /api/members`** answers `{ members }`. Only accepted members are listed. Each member has:
  - `id`, the user id that `GET /api/me` reports;
  - `email` and `name`;
  - `role`: `admin`, `editor` or `viewer`.
- **`POST /api/members`** takes `{ email, name, role }` and answers `201` `{ invite, invite_token }`. `role` is `admin`, `editor` or `viewer`; any other value answers `400` naming `role`. `invite` carries `id`, `email`, `name`, `role` and `expires_at`. The invite's `id` is distinct from its token and never grants acceptance. Its own conflicts, in order:
  1. `409` `already_member`, for a member of this workspace;
  2. `409` `already_invited`, for an email holding an open invitation to this workspace.
- **`PATCH /api/members/{user_id}`** takes `{ role }` and answers `200` `{ member }`. Demoting the last admin answers `409` `last_admin`.

**Invitations.** `POST /api/auth/accept-invite` takes `{ invite_token, password }`.
- **Success** answers `200` `{ token, user }`, signed in with the invited role.
- **Order of checks.** This endpoint uses its own order, in place of steps 5 to 10 of the general precedence:
  1. A missing `invite_token`, any field other than `invite_token` and `password`, or a body that fails the general input rules, answers `400` `validation` naming each such key.
  2. An unknown token answers `404` `not_found`.
  3. A used token answers `409` `invite_used`.
  4. An expired token answers `410` `{"error":"invite_expired","request_id":"<id>"}`.
  5. A token for an email that already has an account in another workspace answers `409` `invite_unusable`.
  6. A password shorter than twelve characters answers `400` `validation` naming `password`.

**Workspace and plans.**
- **`GET /api/workspace`** answers `{ workspace }` with `id`, `name`, `plan` and `min_interval_minutes`.
- **`PATCH /api/workspace`** is admin only. It takes `{ plan }` and answers `200` with the workspace. A plan other than the four in Business rules answers `400`.
- **`GET /api/stats`** answers `{ records_synced, latency_seconds, freshness_seconds }`, as defined in Business rules.

**Catalog.**
- **`GET /api/connector-definitions`** answers `{ definitions }`. Each definition has:
  - `id`, `name` and `slug`;
  - `type`: `source` or `destination`;
  - `category`;
  - `availability`: a list drawn from `cloud`, `oss` and `hybrid`;
  - `runnable`, `custom` and `version`.
- **Filters.**
  - `type`: `source`, `destination` or `agent`. No definition has type `agent`, so `agent` matches nothing.
  - `category`: a category name exactly as listed in Seed data.
  - `availability`.
  - `q`: search text, matched as Business rules describe under Catalog search.

  Different filters combine, so a definition must match all of them. Several values for one filter, given as repeated parameters or comma-separated, match any one of them.
- **Who sees what.** Without a session, the list holds only built-in definitions. With a session, it also holds that workspace's published custom definitions.
- **`GET /api/connector-definitions/{definition_id}`** answers one definition. A custom definition of another workspace answers `404`.

**Catalog address rule.** The `/connectors` page keeps its state in its own query string, using the same parameters and values as the API.
- **Parameters.**
  - `q` holds the search text.
  - `type` holds the checked Connector Type boxes: Sources `source`, Destinations `destination`, Agent Capabilities `agent`.
  - `availability` holds the checked Availability boxes: `cloud`, `oss` and `hybrid`.
  - `category` holds the chosen use case.

  Several values are joined with commas. An empty filter and the "All" use case are left out of the query string.
- **Loading.** Loading `/connectors` with these parameters sets the controls and the "Showing <count>" count to match. For example, with the seed data at start, `/connectors?q=sql&availability=oss` shows "sql" in the search box, OSS checked, and "Showing 2" (PostgreSQL and MySQL), and `/connectors?q=%25` shows "%" in the search box and "Showing 0".
- **History.**
  - Each change to a checkbox or radio, and each "Clear all", adds a history entry.
  - Typing replaces the current entry.
  - Back and Forward restore the controls and count of the entry they reach.

**Sources.**
- **`POST /api/sources`** takes `{ name, definition_id, config }` and answers `201` `{ source }`. The source carries `id`, `name`, `definition_id`, `created_at` and `config`.
- **Request `config`.**
  - For the sample commerce source it is `{ api_key, start_date }`. `api_key` is at least eight characters, and `start_date` is a `YYYY-MM-DD` date.
  - For a custom definition it is `{ api_key }`, at least one character long.
  - A missing or bad value answers `400` `validation`, naming `config.api_key` or `config.start_date`.
- **Other fields.**
  - `name` is 1 to 80 characters.
  - An unknown definition or a destination definition answers `400` naming `definition_id`.
  - A source definition that is not runnable answers `422` `connector_not_installed`.
- **Response `config`.** It carries every setting except `api_key`, plus `api_key_set: true`. A request may not send `api_key_set`.
- **Reading.** `GET /api/sources` answers `{ sources }`, and `GET /api/sources/{source_id}` answers `{ source }`.
- **`POST /api/sources/{source_id}/check`** takes no body or `{}` and answers `200` `{ status }`, where `status` is `succeeded` or `failed`.
  - A failed check also carries a `message`.
  - A rejected key gives the message "The source rejected the API key.".
- **`GET /api/sources/{source_id}/catalog`** answers `{ streams }`. Each stream has:
  - `name`;
  - `fields`: the field names it currently has, in a stable order (for the sample source: `id` first, then the fields in the order Seed data lists them, then `updated_at`, then added fields in the order they were added);
  - `primary_key`;
  - `cursor_field`: `updated_at` for the sample source, `null` for custom streams;
  - `supported_sync_modes`.
- **`POST /api/sources/{source_id}/sample-events`** works on the sample commerce source only. Any other source answers `422` `sample_events_unsupported`. It answers `200` `{ stream, appended, updated, fields }` and takes exactly one of three bodies:
  - `{ stream, append }` adds `append` new records, 1 to 500, with the next ids and `updated_at` set to now.
  - `{ stream, update_ids }`, on `orders` or `invoices`, sets those records' `status` to `refunded` and their `updated_at` to now.
  - `{ stream, add_field }` adds a field of that name to every record of the stream, with the value `<field>-<record id>`. The stream's schema grows by that field. The name is a lowercase letter followed by up to thirty lowercase letters, digits or underscores.

**Destinations and warehouse tables.**
- **`POST /api/destinations`** takes `{ name, definition_id }` and answers `201` `{ destination }`. A destination definition that is not runnable answers `422` `connector_not_installed`.
- **`GET /api/destinations`** answers `{ destinations }`.
- **`GET /api/destinations/{destination_id}/tables`** answers `{ tables }`. Each table has `name` and `row_count`, and is listed once a sync has created it.
- **`GET /api/destinations/{destination_id}/tables/{table}/records`** takes `limit` (1 to 100, default 50) and `cursor`. It answers `{ records, next_cursor, prev_cursor, has_more, total_count }`:
  - Records come in written order. A sync writes each stream's rows in ascending `id`.
  - Each record carries the source fields plus `_wayline_job_id` and `_wayline_extracted_at`.
  - `next_cursor` and `prev_cursor` follow the paging rules in Business rules.
  - `{table}` is checked as Object checks in Business rules says.

**Connections.**
- **`POST /api/connections`** takes `{ name, source_id, destination_id, namespace_prefix, streams, schedule, schema_change_policy }`.
  - It answers `201` `{ connection }`, with `status` `active` and `version` 1.
  - The connection echoes every field, plus `id`, `workspace_id`, `status`, `version`, `created_at` and `next_run_at`. Each echoed stream also carries `known_fields`, its known schema.
- **Fields.**
  - **`name`** is 1 to 80 characters.
  - **`streams`.** Each entry is `{ name, selected, sync_mode, cursor_field, primary_key }`:
    - `sync_mode` is `full_refresh_overwrite`, `full_refresh_append`, `incremental_append` or `incremental_dedup`.
    - The incremental modes require `cursor_field` `updated_at`.
    - `incremental_dedup` also requires `primary_key` `["id"]`.
    - Streams of custom sources allow only the two full refresh modes.
  - **`schedule`** takes the keys `type`, `interval_minutes`, `cron_expression` and `time_zone`, in one of three forms:
    - `{ "type": "manual" }`;
    - `{ "type": "interval", "interval_minutes": <whole number from 1 to 1440> }`;
    - `{ "type": "cron", "cron_expression": "<expression>", "time_zone": "<IANA name>" }`.

    `time_zone` defaults to `UTC` and is echoed back for cron. A key of `schedule` that the chosen type does not use is ignored and not echoed.
  - **`schema_change_policy`** is `propagate`, `ignore` or `pause`.
- **Validation.** Each of these answers `400` `validation` naming the field:
  - a missing or unknown stream, or no selected stream;
  - an invalid sync mode, or an incremental stream without its cursor;
  - a bad prefix;
  - an interval outside 1 to 1440;
  - a malformed cron expression, naming `schedule.cron_expression`;
  - an unknown time zone, naming `schedule.time_zone`;
  - an unknown or other-workspace `source_id` or `destination_id`.
- **Its own conflicts, in order:**
  1. `409` `name_taken`;
  2. `409` `table_conflict`;
  3. `422` `frequency_exceeds_plan`.
- **Reading.** `GET /api/connections` answers `{ connections }`. `GET /api/connections/{connection_id}` answers `{ connection }` with the header `ETag: "<version>"`.
- **`PATCH /api/connections/{connection_id}`** requires the header `If-Match: "<version>"`. It takes any of `name`, `streams`, `schedule`, `schema_change_policy` and `status`. `status` is `active` or `inactive`; any other value answers `400` naming `status`.
  - It answers `200` `{ connection }` with the header `ETag: "<version>"`, carrying the new version.
  - Without `If-Match` it answers `428` `{"error":"precondition_required","request_id":"<id>"}`.
  - With any value other than the current version in quotes it answers `412` `{"error":"version_mismatch","current_version":<version>,"request_id":"<id>"}`.
  - It follows the creation rules and conflicts. Any other field, `source_id`, `destination_id`, `namespace_prefix` and `version` included, answers `400` naming that field.
- **`GET /api/connections/{connection_id}/state`** answers `{ streams }`. Each stream has `name`, `cursor_field` and `cursor_value`. `cursor_value` is the stream cursor from Sync modes in Business rules, or `null`.
- **`POST /api/connections/{connection_id}/reset`** takes no body or `{}` and answers `200` `{ connection }`. It answers `409` `sync_already_running` while a job is pending or running.

**Jobs.**
- **`POST /api/connections/{connection_id}/sync`** takes no body or `{}`. It answers `201` `{ job }`, with the job `pending` or `running`. Its own conflicts, in order:
  1. `409` `connection_inactive`;
  2. `409` `sync_already_running`.
- **A job carries:**
  - `id` and `connection_id`;
  - `connection_version` and `definition_version`;
  - `status`: `pending`, `running`, `succeeded`, `failed` or `cancelled`;
  - `attempts`, each with `number`, `status` and `failure_reason`;
  - `records_committed`;
  - `per_stream`, one entry per stream the job syncs, each with `stream` and `records_committed`;
  - `failure_reason`;
  - `trigger_request_id`;
  - `created_at`, `started_at` and `ended_at`.
- **`POST /api/jobs/{job_id}/cancel`** takes no body or `{}` and answers `200` with the job `cancelled`. When the job has finished it answers `409` `job_not_active`.
- **`GET /api/jobs/{job_id}`** reads one job.
- **`GET /api/jobs/{job_id}/logs`** answers `{ lines }`. Each line has `at`, `level` (`info` or `error`) and `message`. The lines run in this order:
  1. `Sync started`.
  2. During the run, one `stream <name>: <n> records read` line per stream the job syncs.
  3. One `attempt <number> failed: <failure_reason>` line per failed attempt.
  4. On success, one `stream <name>: <n> records committed` line per stream the job syncs, then `Sync succeeded`.
  5. A failed job ends with `Sync failed: <failure_reason>`. A cancelled job ends with `Sync cancelled`.
- **`GET /api/jobs`** lists the workspace's jobs. It takes `connection_id`, `limit` (1 to 100, default 20) and `cursor`. It answers `{ jobs, next_cursor, has_more }`:
  - Jobs come newest first by `created_at`, with ties broken by `id` descending.
  - Passing `next_cursor` back as `cursor` returns the following page.
  - On the last page, `next_cursor` is `null` and `has_more` is `false`.
  - A `connection_id` that is unknown, malformed or of another workspace answers `404`.

**Live job events.** `GET /api/jobs/{job_id}/events?token=<session token>` also accepts the bearer header.
- It answers `200` with content type `text/event-stream`, and stays open while the job is pending or running.
- Each log line arrives as an event named `log`, whose data is that line's JSON and whose event `id` is the line's position in the job's log, counting from 1.
- The end arrives as one event named `status`, carrying no event id, whose data is `{ "status": "<final status>" }`. The stream then closes.
- Connecting to a job already under way first sends every line written so far.
- For a finished job, every line and the status are sent at once.
- **Resuming.** A request carrying the header `Last-Event-ID: <n>`, where `<n>` is a line position, sends only the lines after line `<n>`, then the status once the job is final. For example, for a finished job with five lines, `Last-Event-ID: 2` sends lines 3, 4 and 5 with ids 3, 4 and 5, then the status. A value that is not a whole number is ignored, and every line is sent.
- A missing or wrong token answers `401`. Every refusal is a JSON body, never an event stream.
- **Holding no database while waiting.** An open event stream holds no database connection of its own while it waits for the next line or the end. When its client disconnects, all work for that stream stops within 5 seconds. With 50 event streams open on one running job, `GET /api/health` and `GET /api/jobs/{job_id}` each still answer within one second. Within 10 seconds of those streams closing, the app's database sessions are back to no more than before they opened, and none of them is left active or idle in a transaction.

**Idempotency.** `POST /api/connections` and `POST /api/connections/{connection_id}/sync` accept an `Idempotency-Key` header, as set out in Business rules.

**Sandbox API.** `GET /mock-api/v1/invoices?page=<n>&page_size=<k>`:
- **Key.** The request needs the header `X-Api-Key: sandbox-key-2026`. Without it, the endpoint answers `401`.
- **Parameters.** `page` defaults to 1 and `page_size` to 3. `page_size` is 1 to 100; outside that range the endpoint answers `400`.
- **Answer.** It answers `{ data, next_page }`, where `next_page` is the next page number, or `null` on the last page. A page past the end answers `{ "data": [], "next_page": null }`.
- **Data.** The sandbox holds seven invoices in this order, each `{ id, customer, total_cents, status }`:

  | id | customer | total_cents | status |
  |---|---|---|---|
  | `INV-1042` | AceTech Corp | 125000 | `paid` |
  | `INV-1043` | Globex | 98000 | `open` |
  | `INV-1044` | Initech | 45050 | `paid` |
  | `INV-1045` | Umbrella Retail | 230000 | `open` |
  | `INV-1046` | Soylent Foods | 15000 | `paid` |
  | `INV-1047` | Hooli Labs | 87500 | `void` |
  | `INV-1048` | Vandelay Imports | 64000 | `open` |

- **Other paths.** Any other path under `/mock-api/` answers `404`.

**Connector Builder.**
- **Reading.** `GET /api/builder/projects` answers `{ projects }`, and `GET /api/builder/projects/{project_id}` answers `{ project }`. A project carries `id`, `name`, `manifest`, `tested_streams` and `definition_id`.
- **`POST /api/builder/projects`** takes `{ name, manifest }` and answers `201` `{ project }`.
- **Manifest shape.** `{ base_url, auth: { type: "api_key", header }, streams: [ { name, path, primary_key, record_selector, paginator: { page_size } } ] }`. `primary_key` is a list of field names, such as `["id"]`.
- **Manifest rules.**
  - `base_url` and each `path` follow the Builder address rule in Business rules.
  - A stream name is lowercase letters, digits and underscores, starts with a letter, and is unique in the manifest.
  - A `path` begins with `/`.
  - `paginator.page_size` is 1 to 100.
  - There is at least one stream.

  A broken rule answers `400` `validation`, naming keys such as `base_url`, `streams.0.name`, `streams.0.path` and `streams.0.paginator.page_size`.
- **`PUT /api/builder/projects/{project_id}`** takes `{ name, manifest }`, replaces both and answers `200` `{ project }`. A stream that changed loses its tested state.
- **`POST /api/builder/projects/{project_id}/test`** takes `{ stream, api_key }`.
  - It reads `<resolved address>?page=<n>&page_size=<page_size>` starting at page 1, following `next_page` until it is `null`. The only header it sets is the manifest's auth header, carrying `api_key`.
  - It answers `200` `{ records, pages_read, detected_schema }` and marks the stream tested. `detected_schema` maps each field name to `string`, `integer`, `number` or `boolean`. With a page size of 3, `invoices` reads seven records over three pages.
  - When the sandbox answers with a status other than 200, the test answers `422` `{ "error": "source_http_error", "http_status": <status>, "request_id": "<id>" }`.
  - A `stream` not in the manifest answers `400` naming `stream`.
- **`POST /api/builder/projects/{project_id}/publish`** takes no body or `{}` and answers `201` `{ definition }`.
  - The definition is a source definition with `custom` true, `runnable` true and `version` 1.
  - Publishing again keeps the same `id` and raises `version` by one.
  - Any stream not tested since its last change answers `422` `stream_not_tested`.
  - A source of a custom definition reports each stream's fields as detected by that stream's last test.

**Audit log.**
- `GET /api/audit` is admin only. It answers `{ events }`, oldest first. Each event carries `seq`, `action`, `target_id`, `actor_email`, `at`, `prev_hash` and `hash`.
- `GET /api/audit/{seq}` is admin only. It answers `{ event }` for that `seq` of the caller's workspace; an unknown or malformed `seq` answers `404`.
- No method other than `GET` is published for either path, so every write method answers the `405` from The published surface.

**Media.**
- **Film.** `GET /media/data-in-sound.webm` serves the shipped film byte for byte, with content type `video/webm`. It answers a `Range` request with `206` and a `Content-Range` header.
- **Text tracks.** `GET /media/data-in-sound.en.vtt` and `GET /media/data-in-sound.chapters.vtt` serve WebVTT with content type `text/vtt`.
- **Captions.** Four cues, in order:

  | From | To | Text |
  |---|---|---|
  | 0 s | 8 s | "Every record that moves makes a sound." |
  | 8 s | 17 s | "Rising pitch means more rows are arriving." |
  | 17 s | 26 s | "Quiet means the pipeline is caught up." |
  | 26 s | 34 s | "Wayline turns your syncs into signal." |

- **Chapters.** Three cues:

  | From | To | Chapter |
  |---|---|---|
  | 0 s | 12 s | "Arrival" |
  | 12 s | 24 s | "Volume" |
  | 24 s | 34 s | "Caught up" |

### Business rules (DP-04, DP-06, DP-07, DP-09, DP-11, DP-13, DP-15, DP-19, DP-21, DP-22, DP-24, DP-27, DP-28, DP-29, DP-30, DP-31, DP-32, DP-33, DP-34, DP-35, DP-36, DP-41, DP-42, DP-45, DP-46, DP-64, DP-65, DP-66, DP-67, DP-68, DP-71, DP-73, DP-74, DP-75, DP-76, DP-80, DP-81, DP-83, DP-94)

**Authorization.**
- **Decided per request.** The server decides each request's permissions from the member's role at the moment the request arrives. A role change therefore applies to every existing session of that member on its very next request, with no new sign-in. For example:
  - An editor demoted to viewer gets `forbidden` on their next sync with the token they already hold, and `GET /api/me` with that token reports `viewer`.
  - A viewer promoted to admin can read `GET /api/audit` with their old token.
  - A demoted admin's old token gets `forbidden` from `PATCH /api/workspace`.
- **Viewers.** A viewer gets `forbidden` for any create, change, check, run, cancel or reset of a source, destination, connection, job, Builder project, member or plan. That includes source checks, Builder tests and publishes, and sample events.
- **Editors.** An editor gets `forbidden` from the member, plan and audit routes.
- **Preferences.** Every signed-in user may change their own preferences.

**Input rules for every request.**
- **Readable bodies.** A body that is not valid JSON, or whose top level is not a JSON object, answers `400` `validation` naming `body`.
- **Types.** A value of the wrong JSON type answers `400` `validation` naming its dotted key. For example, `"name": 5` names `name`, `"config": "x"` names `config`, and `"streams": {}` names `streams`.
- **NUL.** A string value anywhere in a JSON body that contains the character U+0000 answers `400` `validation` naming its dotted key, such as `name` or `config.api_key`.
- **Never 422 or 5xx.** These refusals, and every other validation refusal, answer `400`, never `422` and never a 5xx. The `422` codes this brief names elsewhere are the only `422` answers.

**Unknown fields.**
- **Only listed fields.** Every endpoint that takes a JSON body accepts only the fields its entry in API lists, at every depth: at the top level and inside `config`, each `streams` entry, `schedule`, `auth`, each manifest stream and `paginator`.
- **The refusal.** Any other key answers `400` `validation`. Its `fields` names the key by its dotted path, with the message "This field is not accepted here.". The submitted value never appears in the answer.
- **Server-kept values.** Values the server reports but a client never sends are refused the same way. These include `id`, `workspace_id`, `version`, `created_at`, `next_run_at`, `role` in preferences or acceptance, `email` and `name` in a member change, `api_key_set` in a source's `config`, and `known_fields` in a connection's streams.
- **Where it sits.** This is a validation refusal at the validation step of the error precedence, so an editor sending extra keys to a member route still gets `forbidden` first. On invitation acceptance it is checked at step 1 of that endpoint's order.
- **Nothing stored.** A refused request stores nothing, including valid fields sent beside the refused key, and writes no audit event.
- **For example:**
  - `PATCH /api/me/preferences` with `{ "theme": "dark", "role": "admin" }` answers `400` naming `role`, and the theme stays as it was.
  - Acceptance with a `role` field answers `400` naming `role`, and the invitation stays unused.
  - A PATCH to a connection with a current `If-Match` and a `version` field answers `400` naming `version`, and the version stays as it was.
  - `PATCH /api/members/{user_id}` with `workspace_id` answers `400` naming `workspace_id`.
  - `POST /api/sources` with `config.api_key_set` answers `400` naming `config.api_key_set`.
  - A connection creation whose first stream carries `known_fields` answers `400` naming `streams.0.known_fields`.

**Catalog search.**
- `q` is first trimmed of surrounding whitespace. An empty `q` after trimming is the same as no `q`.
- It then matches as a literal, case-insensitive substring of the definition's name. `%`, `_` and `\` match only themselves; with the seed catalog, `q=%`, `q=_` and `q=\` each give no definitions, and `q=SQL` gives two.
- A trimmed `q` may hold at most 100 characters; 100 is allowed and 101 answers `400` `validation` naming `q`.
- A `q` containing a control character (code points 0 to 31 and 127) after trimming answers `400` `validation` naming `q`.

**Workspace isolation.**
- **Records of other workspaces.** Every record belongs to one workspace. A caller from another workspace gets `not_found` for any of its records, Builder projects and custom definitions. The answer is never `forbidden` and never an empty page.
- **Lists and figures.** These include only the caller's own workspace:
  - job lists;
  - connection and source lists;
  - table lists and row counts;
  - `GET /api/stats`;
  - the catalog's custom definitions;
  - the audit log.

**Object checks.** Every route whose path names an object checks that object before doing anything else with it. For `GET /api/jobs/{job_id}`, its `/logs`, its `/events` (by header or `?token=`), `POST /api/jobs/{job_id}/cancel`, `GET /api/destinations/{destination_id}/tables` and its `/{table}/records`:
- A request without a valid session answers `unauthenticated` first.
- Then each of these answers `404` `not_found`, as a JSON body carrying `request_id`:
  - an object of another workspace;
  - an id that is not a well-formed id of that kind, such as `abc` or `1'--`;
  - a `{table}` that is not, exactly and case-sensitively, one of the tables `GET /api/destinations/{destination_id}/tables` lists for that destination. That covers another destination's tables, names in other schemas such as `pg_catalog.pg_class`, quoted names, upper-case variants such as `SHOP_ORDERS`, and encoded or dot segments.
- A refused cancel leaves the job running and writes no audit event. No refused request on these routes reads, changes or streams the object.

**Sign-in and lockout.**
- **Email matching.** Emails match case-insensitively, ignoring surrounding whitespace. This applies to sign-in, the lockout count, `already_member` and `already_invited`.
- **Unknown emails.** For an unknown email, sign-in answers exactly as for a wrong password: the same status, the same body apart from `request_id`, and the same headers. The attempt counts toward the lockout in the same way.
- **Lockout period.** The lockout period is `WAYLINE_LOCKOUT_SECONDS` seconds, read at start. It defaults to 900, fifteen minutes.
- **Locking.** An email is locked after five failed sign-ins within one lockout period, with no successful sign-in between them. The lock lasts one lockout period, counted from the fifth failure.
- **While locked.**
  - Every sign-in for that email answers `429` `{"error":"too_many_attempts","request_id":"<id>"}`, even with the right password.
  - The answer carries a `Retry-After` header: the whole number of seconds until the lock ends, rounded up. The value is 1 at least and the lockout period at most, which is 900 by default.
  - Attempts while locked neither check the password nor extend the lock.
- **Reset.** A successful sign-in before the lock resets the count.
- **Persistence.** Lock state lives in the database, so a restart does not clear it.

**Return address after sign-in.** `redirect_to` is decided in one place:
1. Split the raw `next` at its first `?` or `#`. The part from that character on is the suffix, kept exactly as sent.
2. Percent-decode the path part once.
3. Refuse the decoded path if it contains any of these:
   - a backslash;
   - `//` anywhere;
   - a scheme: a leading letter, then letters, digits, `+`, `-` or `.`, then a colon;
   - `@`;
   - a control character (code points 0 to 31 and 127).
4. Resolve its `.` and `..` segments by the standard URI rules.
5. Accept it only when the resolved path is exactly `/app` or begins with `/app/`. `redirect_to` is then the resolved path followed by the suffix.

In every other case, `redirect_to` is `/app`: a refusal, a path outside `/app`, and an absent or empty `next`.

For example, each of these gives `/app`:
- `https://evil.example`
- `//evil.example/app`
- `/\evil.example`
- `/%2F%2Fevil.example`
- `/app/../api/members`
- `/app/%2e%2e/login`
- `javascript:alert(1)`
- `/application`
- `/app@evil.example`

Accepted values:
- `/app/connections/<id>?x=1` gives `/app/connections/<id>?x=1`.
- `/app/./sources` gives `/app/sources`.

**Sessions.** A session token stays valid until sign-out. After sign-out, the token gets `unauthenticated`.

**Invitations and roles.**
- **One workspace each.** A person belongs to exactly one workspace.
- **Lifetime.** An invitation lives for `WAYLINE_INVITE_TTL_SECONDS` seconds, read at start. The default is 604800, seven days.
  - Its `expires_at` is its creation time plus that many seconds.
  - It can be accepted while the server's clock is earlier than `expires_at`. At `expires_at` and after, it is expired.
- **Acceptance.** An invitation is accepted once.
  - An expired invitation stays expired, and acceptance stores no user and no membership.
  - Only invitations that are unused and not expired count as open for `already_invited`. Inviting the same email again after expiry answers `201` with a new invite `id` and a new token, while the old token keeps answering `invite_expired`.
- **Accounts in another workspace.** Inviting an email that has an account in another workspace answers exactly as for a new email.
- **Last admin.** The workspace always keeps at least one admin. This holds even when two admins change each other's roles at the same moment: at most one of those changes succeeds, and the other gets `last_admin`.

**Plans.**
- **Minimum intervals.** The plan is `starter`, `team`, `scale` or `private`, matching the Starter, Team, Scale and Private Cloud cards. Their minimum schedule intervals are `60`, `15`, `5` and `5` minutes.
- **Refused schedules.** These are refused with `frequency_exceeds_plan`:
  - an interval below the plan minimum;
  - a cron expression whose minute field matches two minutes closer together than the plan minimum.

  The cron gap is counted across the hour as well, from the last matched minute to the first matched minute of the next hour. For example:
  - on `team`, `*/10` and `0,50` are refused and `*/15` is accepted;
  - on `starter`, any minute field matching more than one minute is refused.
- **Changing the plan.** It only records the new plan. Existing schedules stay as they are and are checked again only when they change. There is no payment, checkout or credit purchase.

**Namespaces and tables.**
- **Prefix.** The namespace prefix is a lowercase letter followed by up to thirty lowercase letters, digits or underscores.
- **Table names.** Each warehouse table is named as the namespace prefix followed by the stream name, such as `shop_orders`.
- **Conflicts.** It is a `table_conflict` when a selected stream's table name is already the target of another connection to the same destination, whether or not that connection has run. Tables in different destinations never conflict.

**Connection names.** Names are trimmed and compared case-insensitively within the workspace.

**Connection versions.**
- **Numbering.** `version` starts at 1 when a connection is created. It rises by exactly one on each of these:
  - an accepted PATCH, reactivation included;
  - a schema pause;
  - a propagate commit that adopts at least one new field into a known schema.
- **No change.** A reset, a job start, any other job end, a server restart and any refused request leave `version` unchanged.
- **The header check.** A PATCH is applied only when its `If-Match` names the stored version. The check and the write happen as one step in the stored data. Of several PATCHes sent at the same moment with the same `If-Match`:
  - exactly one answers `200`, and the version rises by one;
  - the others answer `version_mismatch` and change nothing.
- **Reactivation from an older version.** A reactivation sent with a version from before a schema pause answers `version_mismatch`, because the pause raised the version.

**Cron expressions.**
- **Fields.** An expression has five fields separated by spaces:
  - minute, 0 to 59;
  - hour, 0 to 23;
  - day of month, 1 to 31;
  - month, 1 to 12;
  - day of week, 0 to 7, where 0 and 7 both mean Sunday.
- **Items.** Each field is a comma-separated list of items. An item is one of these:
  - `*`;
  - a number;
  - a range `a-b`, with `a` no greater than `b`;
  - a step `/n`, with `n` at least 1, on `*` or on a range.
- **Malformed.** Anything else is malformed. That includes names, `?`, `L`, `W`, `#`, out-of-range values, and an expression that matches no minute in the next five years.
- **Day matching.** A day field that begins with `*`, such as `*` or `*/2`, is unrestricted.
  - When both day of month and day of week are restricted, a day matches when either field matches.
  - Otherwise a day matches only when both match.

**Next run.**
- **When it is `null`.** `next_run_at` is `null` for a manual schedule and for an inactive connection.
- **Interval schedules.** `next_run_at` is `interval_minutes` after the anchor. The anchor is the later of `created_at` and the most recent job's `started_at`.
- **Cron schedules.** `next_run_at` is the first wall-clock minute in the connection's `time_zone`, strictly after the anchor, that matches the expression. It is returned in UTC.
  - Local minutes skipped by a daylight-saving jump do not exist, so they never match.
  - A local minute that occurs twice when the clocks fall back matches only on its first occurrence.
- **Recomputing.** `next_run_at` is recomputed whenever the schedule, the status or the anchor changes.
- **No scheduler.** In this release a schedule only sets `next_run_at`. Jobs start only from a sync request.
- **Next-run text.** Wherever the console shows a next run, on the dashboard and on the connection page, it writes `next_run_at` as `<Ddd> <D> <Mmm> <YYYY>, <HH:mm> <zone> (UTC<±HH:MM>)`, in English on a 24-hour clock:
  - `<zone>` is the connection's cron `time_zone`, or `UTC` for an interval schedule. The date and time are the wall-clock date and time of `next_run_at` in that zone, never in the browser's zone.
  - `<Ddd>` is the three-letter weekday, `<D>` the day of the month with no leading zero, `<Mmm>` the three-letter month, `<YYYY>` the year, and `<HH:mm>` the hour and minute with leading zeros.
  - `<±HH:MM>` is that zone's offset from UTC at that instant, with its sign, such as `-04:00`; UTC is written `+00:00`.
  - For example, a cron `30 1 * * *` in `America/New_York` whose next run is the first 01:30 of the autumn clock change reads "Sun 1 Nov 2026, 01:30 America/New_York (UTC-04:00)".
  - A `null` next run reads "—".
  - The text updates whenever the page reads the connection again.

**Sync modes.**
- **The commit.** A sync copies every stream the job syncs. On success it commits the rows and advances the cursors in one transaction, together with the job's `succeeded` status and its counts.
- **Full refresh.** Full refresh overwrite replaces the table. Full refresh append adds every row again. A full refresh stream's cursor stays `null`.
- **Incremental.**
  - Incremental append adds only rows whose `updated_at` is later than the cursor.
  - Incremental dedup does the same, then keeps one row per `id`: the one with the newest `updated_at`.
  - After a commit, each incremental stream's cursor is the largest `updated_at` committed for it so far. It is `null` before its first commit.
- **Start date.** A source reads only records whose `updated_at` is at or after its `start_date` at midnight UTC.
- **Rejected keys.**
  - The sample commerce source rejects an API key that begins with `revoked-`. A check then reports `failed`, and reading fails with `auth_failed`.
  - A custom source's key is rejected when the sandbox answers `401`.

**What a job runs on.**
- **What a job records.** When a job is created, it records:
  - `connection_version`: the connection's `version` at that moment;
  - `definition_version`: the source definition's `version` at that moment. This is 1 for built-in definitions.
- **Settings.** The job runs entirely on the connection's stream selection, sync modes, known schemas and schema change policy as they stood at `connection_version`. A custom source reads with the manifest published as `definition_version`. The job's `per_stream` and log lines list the streams of that selection.
- **Source snapshot.** The job reads each stream's records as they stood at the moment it moved from `pending` to `running`. A sample event accepted before that moment, including one accepted while the job is still pending, is included. One accepted after it, whether `append`, `update_ids` or `add_field`, applies from the next job. The job's `records read` log lines, its counts and the fields it compares with the known schema all come from that snapshot.
- **Changes during a run.** A PATCH or a re-publish while a job is pending or running is stored and visible at once, but applies only from the next job. A sample event is also stored and visible at once; whether the job includes it follows the source snapshot moment above. For example:
  - A stream deselected mid-run is still committed by the running job.
  - A mode switched from overwrite to append mid-run still overwrites in the running job.
  - A policy changed to `pause` mid-run does not pause a run that started under `propagate`.
  - A re-publish to version 2 mid-run leaves the running job on version 1, and the next job records 2.
  - With the seed data, 30 orders appended while the job is `running` leave it at 120 orders and the next job at 150. A field added while the job is `running` appears only from the next job.

**Job lifecycle.** A job has exactly one attempt record per try. The job's status and `failure_reason` mirror its last attempt. The legal transitions are:

| From | To | When |
|---|---|---|
| `pending` | `running` | within 2 seconds of creation |
| `pending` | `cancelled` | a cancel request |
| `pending` | `failed` | restart recovery |
| `running` | `succeeded` | the commit |
| `running` | `failed` | `auth_failed`, `schema_change_detected`, `interrupted`, or `commit_failed` when the commit itself fails |
| `running` | `cancelled` | a cancel request |

- **Timing.** A job stays `running` for at least 8 seconds and finishes within 30 seconds of creation.
- **Final states.** `succeeded`, `failed` and `cancelled` are final. Cancelling a finished job is refused with `job_not_active`.
- **Cancel against commit.** When a cancel and the commit race, whichever is recorded first wins. If the commit wins, the cancel is refused with `job_not_active`. A job never reads `cancelled` with rows written.
- **No partial writes.** A cancelled or failed job changes no table and no cursor.
- **Rejected credentials.** When the source rejects its credentials, the job makes three attempts, each failing with `failure_reason` `auth_failed`. The job then ends `failed` with `auth_failed`.

**What readers see during a commit.**
- **One consistent view.** Every read is answered from one consistent view of the stored data. A sync's commit changes all of these at the same instant, for every stream of the job:
  - each table's `row_count`;
  - the records pages and their `total_count`;
  - the cursors in `GET /api/connections/{connection_id}/state`;
  - the job's `status`, `records_committed` and `per_stream`;
  - `GET /api/stats`;
  - the dashboard figures.
- **No mixed answers.** One `GET /api/destinations/{destination_id}/tables` answer shows every table of one job either all from before its commit or all from after it.
- **Rows imply success.** A row carrying a job's `_wayline_job_id` is visible only once that job reads `succeeded`. The job's cursor advance and its share of `records_synced` become visible at the same moment.
- **Counts before success.** Until a job succeeds, its `records_committed` and every `per_stream` count read 0. A failed or cancelled job keeps 0.
- **Overwrite keeps its table.** A full refresh overwrite table never reads as missing or as 0 rows while its commit is under way, unless it held 0 rows before.

**Restart recovery.** When the server starts, before `GET /api/health` answers 200, it ends every job that is still `pending` or `running`:
- **Status.** The job becomes `failed` with `failure_reason` `interrupted`. Its last attempt becomes `failed` with `interrupted`, and `ended_at` is set to the start time.
- **Log.** The job's log gains a final line, `Sync failed: interrupted`. Its event stream sends that line and then the `failed` status.
- **Data.** No table and no cursor changes.
- **Audit.** The audit log gains one `sync.failed` event, whose actor is the user who started the sync.
- **Once only.** Recovery touches each job once, so a further restart changes nothing and adds no event.
- **Afterwards.** A sync request right after the restart starts a new job.

**One job at a time.**
- A connection has at most one job `pending` or `running`. While it does, a sync is refused with `sync_already_running`, and so is a reset.
- A sync of an inactive connection is refused with `connection_inactive`.

**Simultaneous requests.** These rules apply to requests that carry no `Idempotency-Key`, or that carry different keys:
- Of several sync requests for one connection sent at the same moment, exactly one creates a job and answers `201`. The others get `sync_already_running`, and exactly one job exists.
- Of several connection creations with one name sent at the same moment, exactly one answers `201`. The others get `name_taken`.
- Of several creations targeting one table of one destination, exactly one answers `201`. The others get `table_conflict`.

**Idempotency keys.**
- **Format.** An `Idempotency-Key` is 1 to 255 visible ASCII characters. Anything else is a `validation` refusal naming `Idempotency-Key`.
- **Scope.** A key is scoped to the workspace. It belongs to the request that recorded it: that request's method, path and JSON body. Bodies are compared as parsed JSON, so spacing and key order do not matter.
- **Recording.** A key is recorded only when its request succeeds, so a refused request leaves the key unused. It is stored in PostgreSQL, so a restart keeps it.
- **Lifetime.** The lifetime is `WAYLINE_IDEMPOTENCY_TTL_SECONDS` seconds, read at start; the default is 86400, one day. A recorded key's `expires_at` is the moment it was recorded plus that lifetime. The key is live while the server clock is earlier than `expires_at`.
- **Replay, while live.** A later request with a live key and the same method, path and body is a replay.
  - It answers `200` or `201` with the current state of the first connection or job, carrying the same `id`.
  - It creates nothing and runs no state check. So a replay after the job finished, or while another job runs, still answers with the first job.
- **Simultaneous replays.** While the first request is still being processed, a replay either waits and answers as a replay, or answers `409` `idempotency_key_in_flight`.
  - A request carrying a key never answers `sync_already_running`, `name_taken` or a 5xx because of another request with the same key.
  - Exactly one resource exists, however many replays arrive at once.
- **Reuse, while live.** A live key with a different method, path or body answers `422` `idempotency_key_reused` and changes nothing.
- **At `expires_at` and after.** The key counts as unused. A request carrying it, with the same body or a different one, is a new request that runs every check: a sync while another job is active answers `sync_already_running`, and a creation whose name is taken answers `name_taken`. On success it creates a new connection or job with a new `id` and records the key again with a new `expires_at`; later replays answer with that new resource. It never answers `idempotency_key_reused`. A request already in flight is never cut off by expiry.

**Console retries.** The console is itself a careful client of the key rules above, for "Create connection" and "Sync now":
- **One key per intent.** A press that starts a new intent makes a fresh random UUID and sends it as `Idempotency-Key`.
- **Same key while the outcome is unknown.** After no answer, a 5xx answer (`503` included) or an `idempotency_key_in_flight` answer, the next press of the same button resends the same key with the same body. The matching outage copy shows and the form keeps its values.
- **Fresh key after an answer.** Any other answered 2xx or 4xx, a `401` included, ends the intent, so the next press makes a fresh key. In the wizard, any change to a field, and a restored draft, also make the next submit use a fresh key.
- **One request per press.** While a request is pending the pressed button is disabled, so a double click sends exactly one request.
- **A replay is success.** An answer carrying the first connection or job is shown exactly as a first success, with the copy from Feedback states. "Sync now" never shows the `sync_already_running` copy for its own replayed job.

**Schema changes.**
- **Known schema.** Each selected stream has a known schema: its fields when the connection was created.
- **New fields.** A stream gains a field when its records carry a field outside its known schema. The next sync then follows the policy the job runs on:
  - **`propagate`** writes the field into the rows, and rows written earlier show it as `null`. On commit, the field joins the known schema.
  - **`ignore`** leaves the field out of the rows on that sync and on every later one. The known schema is unchanged.
  - **`pause`** fails the job with `schema_change_detected` without writing, and makes the connection `inactive`.
- **Reactivation.** Setting a connection paused this way back to `active` adopts each stream's fields as they stand as its known schema. The next sync then succeeds with those fields in the rows. A field added after that pauses the connection again.

**Reset.** An accepted reset does all of this in one step:
- **Existing tables.** Every table of the connection that a sync created stays listed with `row_count` 0. Its records answer `{ "records": [], "next_cursor": null, "prev_cursor": null, "has_more": false, "total_count": 0 }`, and the stored warehouse table holds zero rows.
- **No new tables.** A reset creates no table. Resetting a connection that has never synced lists no table for it.
- **Page links.** A reset starts a new generation of each table, so every records cursor issued before it, next or previous, answers `invalid_cursor`.
- **Cursors.** Every stream cursor becomes `null`.
- **What stays.** The connection's `status`, `version` and known schemas, the job history and `records_synced` are unchanged, because they describe the connection and the jobs that ran. A reset is allowed on an `inactive` connection, which stays `inactive`.
- **The next sync.** An incremental sync after a reset reads every record from the source's `start_date` and commits each record once, so its `records_committed` equals the full count.
- **Reset meeting a sync.** A reset and a sync of one connection are taken one after the other. When they arrive together, the outcome equals one of the two serial orders:
  - the reset answers `200`, and the job then starts from null cursors and empty tables; or
  - the job is created first, and the reset answers `sync_already_running`.

  A reset that answered `200` never leaves rows from a job that started before it.

**Counts reconcile with rows.**
- **Jobs.** A succeeded job's `records_committed` equals the sum of its `per_stream` counts. It also equals the number of rows the job wrote, each carrying the job's id. For an incremental dedup job, the count is the rows it read and wrote.
- **Tables.** A table's `row_count` and `total_count` equal the number of rows its pages return.
- **Workspace figures.**
  - `records_synced` is the sum of `records_committed` over the workspace's succeeded jobs. A failed or cancelled job adds nothing.
  - `latency_seconds` is the mean of `ended_at` minus `started_at` over the last ten succeeded jobs.
  - `freshness_seconds` is the time since the most recent succeeded job ended.
  - `latency_seconds` and `freshness_seconds` are both `null` before any job has succeeded.
- **Computed on read.** All of these are computed from the stored rows when they are read.

**Paging.**
- **Position, not offset.** Job history and warehouse records page by position. Each `next_cursor` points just past the last item returned. Walking every page with any `limit` therefore returns each item exactly once, in the same order as one large page, even while new jobs start or new rows are written. Newer jobs appear only on a fresh first page.
- **Records also page backward.**
  - A page's `prev_cursor` points just before its first record. Passing it as `cursor` returns up to `limit` records written immediately before that record, still in written order.
  - `prev_cursor` is `null` when no record comes before the page's first record.
  - Walking back from the last page reaches the first record exactly once. Each backward page equals the forward page that held the same records.
- **Table generations.**
  - A full refresh overwrite commit on a table, and a reset, each start a new generation of that table.
  - A records cursor issued in an earlier generation answers `invalid_cursor`, never rows from the new generation.
  - Appends, incremental syncs and dedup keep the generation.
- **Cursor scope.** A cursor is opaque, and is valid only on the listing that issued it:
  - for jobs: the same workspace, and the same `connection_id` filter or none;
  - for records: the same workspace, destination and table, in the same generation.

  Changing `limit` between pages is allowed. A `limit` outside 1 to 100, or not a whole number, answers `400` `validation` naming `limit`.
- **Bad cursors.** A cursor from another listing or another workspace, or one that is edited, truncated or cannot be decoded, answers `400` `invalid_cursor`. It never causes a 5xx.

**Secrets.** A source's API key, and the key typed into a Builder test, is never stored as readable text. It never appears in any of these:
- any response body or header;
- a validation refusal, including one that refuses the key itself;
- a check `message`;
- a job's `failure_reason`, attempts or log lines;
- a live event;
- an audit event;
- the stdout structured logs.

A refused submission that carried a key leaves no trace of it.

**Builder addresses.** The Builder checks the address it will fetch only after normalizing it:
1. `base_url`, and each stream's `path`, is percent-decoded once.
2. The decoded text is refused if it contains any of these:
   - a backslash;
   - `//` anywhere;
   - a scheme: a leading name followed by a colon, such as `http:`;
   - `@`;
   - `?`;
   - `#`.
3. The `.` and `..` segments are resolved by the standard URI rules.
4. The resolved `base_url` must begin with `/mock-api/`.
5. The fetched address is the resolved `base_url`, with any trailing `/` removed, followed by the decoded `path`, with dot segments resolved again. That address must also begin with `/mock-api/`.

Which field a refusal names:
- A failure of `base_url` at steps 2 to 4 is a `validation` refusal naming `base_url`.
- A failure at step 5, or a `path` refused at step 2, names `streams.<index>.path`, for example `streams.0.path`.

The check runs on create, `PUT` and test, before any read. A refused `PUT` leaves the stored manifest unchanged. The Builder fetches exactly the resolved address and never decodes it again. The read carries only the manifest's auth header, never the caller's session.

For example:
- `/mock-api/../api/members`, `/mock-api/%2e%2e/api/members` and `/mock-api//evil.example/v1` are refused as `base_url`.
- A `path` of `/../../api/members` is refused as `streams.0.path`.
- `/mock-api/v1/./` with the path `/invoices` is accepted, and reads `/mock-api/v1/invoices`.

**Request identity and structured logs.**
- **The request id.** Every `/api` response carries `X-Request-Id`. A request that sends its own `X-Request-Id` of 8 to 64 letters, digits or hyphens gets that value back. Otherwise the server makes one. That value is the request's `request_id`, and every error body repeats it.
- **Jobs.** A job records the `request_id` of the sync request that started it as `trigger_request_id`. A replayed sync keeps the first request's id.
- **Request log lines.** The server writes one JSON line to stdout per request, carrying `request_id`, `method`, `path` (without the query string), `status` and `duration_ms`.
- **Job log lines.** Each job log line is also written to stdout as JSON, with the job's `trigger_request_id` as its `request_id`.
- **Never in stdout.** Request bodies, `Authorization` values, session tokens and keys.

**Audit.**
- **What is recorded.** Each change below writes exactly one audit event, whose `target_id` is the id named in the Target column:

  | Action | Written when | Target |
  |---|---|---|
  | `source.created` | a source is created | the source's `id` |
  | `destination.created` | a destination is created | the destination's `id` |
  | `connection.created` | a connection is created | the connection's `id` |
  | `connection.updated` | a PATCH to a connection is accepted, reactivation included | the connection's `id` |
  | `connection.reset` | a connection is reset | the connection's `id` |
  | `sync.started` | a job is created | the job's `id` |
  | `sync.succeeded`, `sync.failed`, `sync.cancelled` | a job ends in that state | the job's `id` |
  | `member.invited` | an invitation is created | the invite's `id` |
  | `member.role_changed` | a member's role changes | the member's user `id` |
  | `connector.published` | a Builder project is published | the published definition's `id` |
  | `workspace.plan_changed` | the plan changes | the workspace's `id` |

- **What is not recorded.** Preference changes, Builder saves and tests, invitation acceptances, source checks, sample events, idempotent replays, seeding and refused requests write no audit event. A schema pause writes only its `sync.failed`, and a propagate adoption writes only its `sync.succeeded`.
- **Actor.**
  - The actor is the signed-in user who made the change.
  - A sync outcome names the user who started the sync, even when the server caused it, as in restart recovery or a schema pause.
- **Numbering.** `seq` runs 1, 2, 3 and onward within the workspace, with no gaps and no repeats, under simultaneous changes too.
- **Hash chain.**
  - `hash` is the lowercase hex SHA-256 of the text `prev_hash|seq|action|target_id|actor_email`: the five values joined by vertical bars, with `seq` in decimal.
  - The first event's `prev_hash` is sixty-four zeros.
  - Every later event's `prev_hash` is the previous event's `hash`.
- **Permanence.** An audit event is never edited or deleted.

### Services (DP-02, DP-29, DP-75, DP-78)

The application stores all its data in the provided PostgreSQL database, reached through `DATABASE_URL`. When `DB_URL` is also set, it carries the same value.

**Data model.** The stored records live in collections with exactly these names:

| Collection | Holds |
|---|---|
| `users` | an id, a unique email stored lowercase, a name, a protected password, preferences and a created time |
| `workspaces` | an id, a name and a plan |
| `memberships` | a user linked to one workspace, with the role `admin`, `editor` or `viewer` |
| `invites` | an id, a token, an email, a name, a role, the workspace, a created time, `expires_at`, and whether it was used |
| `connector_definitions` | an id, a name, a slug, a type, a category, an availability list, whether it is runnable and whether it is custom; for a custom definition, also the owning workspace and the manifest of each published version |
| `sources` | an id, a `workspace_id`, a `name`, a `definition_id` and its settings, with the API key protected |
| `destinations` | an id, a `workspace_id`, a `name` and a `definition_id` |
| `connections` | an id, a `workspace_id`, a `name`, a `status`, a `version`, its source and destination, its namespace prefix, its streams with their known schemas, its schedule with its time zone, its schema change policy and its stream cursors |
| `jobs` | an id, a `connection_id`, `connection_version`, `definition_version`, a `status`, its attempts, `records_committed`, its per-stream counts, a failure reason, its trigger request id, the user who started it, and its created, started and ended times |
| `audit_events` | its workspace, sequence number, action, target, actor email, time, previous hash and hash |
| `builder_projects` | its workspace, name, manifest, tested streams with their detected schemas, and published definition |

**Warehouse storage.**
- **One stored table per warehouse table.** Warehouse rows live in one stored table per warehouse table, named exactly as the warehouse names it.
- **Schemas.** Each destination keeps its tables in its own PostgreSQL schema. The schema is named `warehouse_` followed by the destination `id`, lowercased, with every character other than a letter, digit or underscore replaced by `_`. For example, the id `3F2A-9C` gives `warehouse_3f2a_9c`.
- **Collections.** The collections stay in the `public` schema.
- **Other state.** Sessions, idempotency keys with their `expires_at`, sign-in attempts, the settings each job runs on, each job's source snapshot, table generations, sample-source changes, the seed identities and the record that the seed ran are also stored in PostgreSQL, in tables of your choosing.

**Constraints held in the stored data.** These hold in the stored data itself under simultaneous requests, not only in application checks:
- a connection name is unique within its workspace;
- a connection has at most one job `pending` or `running`;
- a connection's `version` rises by one per accepted change, so two changes from one version never both succeed;
- a live idempotency key is unique within its workspace, and an expired one never blocks recording it again;
- audit `seq` is unique and gapless per workspace;
- a reset and a job start for one connection never overlap.

**Database outage.** Server boundary sets out how the server behaves when the database is unreachable, and Feedback states sets out what the pages show.

### Seed data (DP-03, DP-16, DP-18, DP-78)

The application seeds its own baseline data on first start and depends on no data loaded from outside. Every seeded person and business is invented.

**Seed identity.**
- **Recorded once.** Each seeded workspace, user, membership, source, destination, connection and catalog definition has a fixed seed identity that never depends on its name, email, plan, role or any other value a person can change. The fact that the seed ran is recorded in PostgreSQL, and a start that finds it recorded writes nothing.
- **Edits survive a restart.** Changes made after seeding stay exactly as they are when the server restarts:
  - a renamed or otherwise changed seeded connection keeps its name, streams, status and `version`, and no connection under the old name comes back, so the old name stays free to use;
  - a changed plan stays changed;
  - a changed role stays changed;
  - sample events stay applied: appended records, updated records and added fields;
  - preferences stay as set.
- **No side effects.** Seeding writes no audit event and no job, on the first start or any later one.
- **Exact first-start state.** On a fresh database, before any request changes anything:
  - `GET /api/stats` answers `{"records_synced":0,"latency_seconds":null,"freshness_seconds":null}`;
  - `GET /api/jobs` answers `{"jobs":[],"next_cursor":null,"has_more":false}`;
  - each seeded destination's tables answer `{"tables":[]}`;
  - each seeded connection's state lists its three streams, each with `cursor_value` `null`;
  - `GET /api/audit` answers `{"events":[]}`;
  - each seeded connection has `version` 1 and `next_run_at` `null`.

**Workspaces and users.** Every seeded user has the password `deku-demo-pw-2026`.

| Workspace | Plan | Member | Email | Role |
|---|---|---|---|---|
| Lumen Freight | `team` | Priya Natarajan | `admin@example.com` | admin |
| Lumen Freight | `team` | Marco Bell | `editor@example.com` | editor |
| Lumen Freight | `team` | Dana Okafor | `viewer@example.com` | viewer |
| Outpost Data | `starter` | Sasha Reyes | `outsider@example.com` | admin |

**Lumen Freight pipeline.**
- Source `Shop Orders`: the Sample Commerce API, with `start_date` `2026-01-01` and API key `lumen-shop-key-01`.
- Destination `Lumen Warehouse`: the Wayline Warehouse.
- Connection `Shop Orders to Warehouse`: version 1, manual, all three streams selected with `full_refresh_overwrite`, namespace prefix `shop_`, and policy `propagate`.

**Outpost Data pipeline.**
- Source `Outpost Events`: the Sample Commerce API, with `start_date` `2026-01-01` and API key `outpost-key-01`.
- Destination `Outpost Warehouse`: the Wayline Warehouse.
- Connection `Outpost Sync`: version 1, manual, all three streams with `full_refresh_overwrite`, namespace prefix `outpost_`, and policy `propagate`.

No jobs, invitations or audit events are seeded.

**Catalog.** The catalog holds 17 built-in definitions. A built-in definition's `id` equals its slug: the name in lowercase with spaces replaced by hyphens, such as `sample-commerce-api`. Built-in definitions have `custom` false and `version` 1.

| Name | Type | Category | Availability | Runnable |
|---|---|---|---|---|
| Sample Commerce API | source | Finance & Ops Analytics | cloud, oss, hybrid | yes |
| PostgreSQL | source | Databases | cloud, oss, hybrid | no |
| MySQL | source | Databases | cloud, oss, hybrid | no |
| MongoDB | source | Databases | cloud, oss | no |
| Ticket Desk | source | Sales & Support Analytics | cloud, hybrid | no |
| CRM Cloud | source | Sales & Support Analytics | cloud | no |
| Ad Network | source | Marketing Analytics | cloud, oss | no |
| Product Events | source | Product Analytics | cloud, oss, hybrid | no |
| File Drop CSV | source | Files | cloud, oss, hybrid | no |
| Issue Tracker | source | Engineering Analytics | cloud, oss | no |
| Docs Workspace | source | Unstructured | cloud | no |
| Team Calendar | source | Others | oss | no |
| Wayline Warehouse | destination | Warehouses and Lakes | cloud, oss, hybrid | yes |
| Cloud Warehouse | destination | Warehouses and Lakes | cloud, hybrid | no |
| Lakehouse Tables | destination | Warehouses and Lakes | cloud, oss | no |
| Object Storage | destination | Files | cloud, oss, hybrid | no |
| Vector Store | destination | Unstructured | cloud | no |

**Sample commerce data.** The sample commerce source produces the same records every time, for each source, until sample events change them. Each `updated_at` is a UTC timestamp counted from `2026-01-01T00:00:00Z`.

| Stream | Records | Fields and values | `updated_at` |
|---|---|---|---|
| `customers` | 25, ids 1 to 25 | `id`; `name` (`Customer <id>`); `email` (`customer<id>@example.com`); `country`, cycling `US`, `DE`, `JP`, `BR`, `IN` from id 1 | that instant plus `<id>` days |
| `orders` | 120, ids 1 to 120 | `id`; `customer_id`, which is one more than the remainder of (`<id>` minus 1) divided by 25; `amount_cents`, which is 1000 plus 25 times the id; `status`, cycling `paid`, `shipped`, `pending` from id 1 | that instant plus `<id>` hours |
| `invoices` | 40, ids 1 to 40 | `id`; `order_id`, which is three times the id; `total_cents`, which is 1000 plus 25 times the `order_id`; `status`: `paid` for odd ids, `open` for even ids | that instant plus three times `<id>` hours |

Every stream has primary key `["id"]`, cursor field `updated_at`, and all four sync modes. For example, a `start_date` of `2026-01-03` reads orders 48 to 120. For example, with the seed data at start, one full refresh sync of the seeded Lumen Freight connection commits 25 customers, 120 orders and 40 invoices, 185 records in all.

## Technical requirements

### Deployment (DP-01)

**Runtimes and stack.** Python 3 and Node 22 are available. Build the server with FastAPI, and build the pages as a React single-page application with Vite. The app is installed and run as an unprivileged user:
- Python dependencies go into a `.venv` inside `/app`.
- The manifest calls their tools by path (`.venv/bin/<tool>`), or as `python -m <tool>` with the venv's Python.

**Run manifest.** Include `/app/run.json`, with string `install`, `build` and `serve` commands and the schema marker. For example:

```json
{"_schema":"run-manifest-v1","install":"python3 -m venv .venv && .venv/bin/pip install -r requirements.txt && npm ci","build":"npm run build","serve":".venv/bin/uvicorn server:app --host 0.0.0.0 --port ${APP_PUBLIC_PORT:-4173}"}
```

Use commands that fit your source, and include lockfiles.

**Serve.**
- `serve` runs the production build in the foreground. It is never a dev server and never a background daemon.
- It binds `0.0.0.0` on port `4173`, never `127.0.0.1` or `localhost`, and honours `APP_PUBLIC_PORT`.
- The app is reachable at `APP_PUBLIC_URL`.
- `GET /api/health` answers as stated in API once three things are done: the schema exists, the seed is in place, and restart recovery has run.

**Grading.**
1. Grading copies `/app` without `node_modules` and `.git`.
2. It runs install, build and serve as an unprivileged user against a freshly provisioned database.
3. It resets the database between its phases.
4. It may stop and restart serve at any moment, including while a sync is running, and may run further copies of serve with their own database and settings, including a copy whose database cannot be reached.

So the app creates its schema and seeds itself idempotently every time serve starts.

**Files at the app root.**
- Write the seeded logins to `/app/USER_README.md`.
- Keep the reserved directories `.browser_screenshots/` and `.downloads/` at the app root, and keep them empty.

**The film.**
- Ship the public-domain NASA film "Data Sonification: Black Hole at the Center of the Perseus Galaxy Cluster (X-ray)" in the app source, unchanged:
  - at `assets/data-sonification-black-hole-at-the-center-of-the-perse-c38f6693.webm`;
  - 3,113,129 bytes in size;
  - with SHA-256 `796615525a18932854a8d00836ee5d745516c08bbcdba50e82c3b5033e28884d`.
- The film and the Inter, Fragment Mono and JetBrains Mono font files, subset and served by the app itself, are the only binaries taken from elsewhere.

### Configuration and secrets (DP-02, DP-81)

Read these from the environment at start:

| Variable | Use |
|---|---|
| `DATABASE_URL` | the PostgreSQL connection |
| `APP_PUBLIC_PORT` | the listening port |
| `APP_PUBLIC_URL` | the app's public address |
| `WAYLINE_LOCKOUT_SECONDS` | the lockout period from Business rules |
| `WAYLINE_INVITE_TTL_SECONDS` | the invitation lifetime from Business rules |
| `WAYLINE_IDEMPOTENCY_TTL_SECONDS` | the idempotency key lifetime from Business rules |

- Never hard-code these values, and never send the database credentials to the browser.
- The PostgreSQL database is already running. Do not download, install, compile or start a copy of it, and use no other provider.
- Use no edge functions, persistent volumes, fixed container names or custom networks.

### Server boundary (DP-01, DP-11, DP-45, DP-56, DP-64, DP-66, DP-79, DP-85)

- **Same origin.** The HTTP API is served on the page origin, under `/api`. No cross-origin access header is ever sent, on any answer, `405` answers to `OPTIONS` included.
- **Published surface.** The server answers only the pages in Screens and layout and the endpoints and methods in API; The published surface in API sets out the answers to everything else. It never redirects an `/api` request, and never serves generated API documentation or a schema.
- **Request size.** A request body larger than 1,000,000 bytes answers `413` `payload_too_large`. A body of exactly 1,000,000 bytes is allowed.
- **Content type.** A body sent with a content type other than `application/json` answers `415` `unsupported_media_type`.
- **Never served.** The server never serves the app source, `.venv`, `node_modules`, lockfiles, `run.json`, environment values or credentials. Any such path answers `404`.
- **Redirects.** The server never sends a redirect to an address taken from a request. Return addresses after sign-in reach the browser only as the `redirect_to` value from Business rules.
- **Database unreachable.** When the database is unreachable at start, the process stays up:
  - `GET /api/health` answers `503` `{"status":"starting"}`.
  - Every other `/api` request that needs the database answers `503` `{"error":"service_unavailable","request_id":"<id>"}`.
  - Every page route still answers from the server without the database: each marketing route, `/signin`, `/login` and `/accept-invite` with its h1 in the first response, and every console page shell. The media files are served. An unknown address still answers `404` with the not-found page. No page route ever answers `503` or `500` because the database is down.
  - The server tries to connect again at least every five seconds. Once connected, it creates its schema, seeds, runs restart recovery and becomes ready, with no restart.

  A database lost while the app is running gives the same answers until it returns.
- **Builder reads.** Builder reads never leave the sandbox; see Builder addresses in Business rules.
- **No analytics.** No analytics identifier or attribution data is stored. No public or console page sets an analytics cookie or storage key, before or after consent.
- **Assets.** No binary is copied from any site, except the shipped film and the three font families served from the app's own origin. Logos become an original vector mark, text wordmarks and monogram tiles. Architecture art becomes vector lines.

### Browser support and performance (DP-57, DP-60, DP-96)

- **Browsers.** Current Chromium, at 320 CSS pixels wide and wider. The judged viewports are 375x812, 768x1024 and 1280x800, and the console layout is also checked at 767, 768, 991, 992, 1279 and 1280 CSS pixels wide.
- **Marketing routes.** They render their headline and copy from the server's first response, without waiting for scripts. On a mid-range laptop with a fast connection, text is visible within about one and a half seconds.
- **Fonts.** The self-served fonts are subset to the weights in use and swap in, so text is never invisible while they load.
- **Console.**
  - Console pages are usable within three seconds of navigation.
  - Long job histories and warehouse tables load one page at a time.
  - A records page address opened directly shows its rows within three seconds.
- **Input.** Every refusal from Input rules in Business rules answers within one second.
- **Live viewers.** The limits for many open job event streams are those stated under Live job events in API.

**Identity and copy.** The copy above is placeholder hierarchy for an original product named Wayline, built by Wayline Labs. The customer wordmarks, competitor names and article authors are placeholders.

## Working rules

- IF-01: `/app/run.json` holds string `install` and `build` commands, a nonempty `serve` command, and `"_schema":"run-manifest-v1"`.
- IF-02: Python dependencies install into `/app/.venv`, and `run.json` calls Python tools only as `.venv/bin/<tool>` or as `python -m <tool>` with that venv, with no global or `sudo` installs.
- IF-03: `/app/USER_README.md` lists every seeded Lumen Freight login and the seeded password.
- IF-04: The reserved directories `.browser_screenshots/` and `.downloads/` exist at the app root and are empty.
- IF-05: `/app/THIRD_PARTY_NOTICES.md` names every shipped package with its licence, plus the film and the three font families. "Shipped packages" means the production dependency tree: `npm ls --omit=dev --all --json`, plus every package in the Python requirements installed into `.venv`.
- IF-06: Every shipped package is under MIT, BSD-2-Clause, BSD-3-Clause, Apache-2.0, ISC, 0BSD or PSF-2.0. The fonts are under OFL-1.1, and the film is in the public domain.
- IF-07: The app uses no datastore except the provided PostgreSQL: no SQLite or other database file, no Redis, and no state files outside the database.
- IF-08: The shipped film file is byte-identical to the one stated in Deployment.

## Engineering standards

- The Python code is idiomatic, typed FastAPI with request and response models. The React code uses function components with hooks.
- Names in the code match the domain terms of this brief: workspace, source, destination, connection, connection version, stream, sync mode, cursor, generation, snapshot, job, attempt, Builder project, invitation, idempotency key, seed identity, draft and audit event.
- Each domain rule is decided in exactly one place in the source and used from there. This covers:
  - the job status transitions, restart recovery included;
  - the sync commit and what readers see during it;
  - the settings and source snapshot a job runs on;
  - the reset;
  - the connection version check;
  - the accepted fields and input rules of each request body;
  - the published methods of each path;
  - the object check of each id-bearing route;
  - the plan's minimum interval;
  - the cron match and the next-run text;
  - the catalog search match;
  - the Builder address check;
  - the return-address rule and the pages each role may open;
  - invitation expiry and the idempotency key lifetime;
  - the console's idempotency key lifecycle and the wizard draft;
  - the job-end render on the connection page;
  - the seed identity;
  - the audit hash;
  - secret redaction.
- Every refused request goes through one error shape carrying `error` and `request_id`.
- There is no dead, commented-out or unreachable code, and no defensive checks for states the rules make impossible.
- There is no abstraction with a single implementation.
- The code contains no feature beyond this brief.
