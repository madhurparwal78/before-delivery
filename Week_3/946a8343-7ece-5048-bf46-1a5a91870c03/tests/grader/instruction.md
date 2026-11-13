# Coldbrook Signal Works Spurline

Spurline is a self-contained code forge in the browser, for any software team from one founder with a few contractors upward. It holds the code, the review and merging, a simulated delivery pipeline, deployments and work planning, and it publishes every rule and file format. Groups and subgroups pass roles down to their projects. Projects hold a content-addressed repository that you edit in the built-in editor or through the commit API. Merge requests carry threaded line review, suggestions, code owners, versions and stacked requests. A merge train tests each request as one combined commit on top of the requests ahead of it, and Spurline shows that exact commit. A published pipeline file runs on a simulated runner. Deployments go through approvals and can be rolled back. Issues, epics, milestones and boards are linked to code through closing keywords. Every screen updates live, on a desktop and on a phone. Spurline uses two backend services: Postgres is the system of record, and MinIO stores large files, artifacts, caches, sealed logs, reports and project exports. Out of scope: AI or agent features, model-written code suggestions, real security scanners, container and package registries, Kubernetes, self-hosted runners, static site hosting, mirroring, geo replication, LDAP, SSO and any outside sign-in, outside integrations, snippets, incident and on-call tools, compute-minute billing, paid plans, email of any kind, password reset and sound. Spurline has no git binary and no git network protocol. It never runs a shell, a container or user code. Spurline uses no datastore, queue, cache, mail or search service besides Postgres and MinIO.

## Problem and users

A small team needs the same controls a large company has: protected branches, push rules, code-owner approvals, a merge train that tests each change on top of the ones ahead of it, and protected deployments with approval and rollback. These controls are usually sold per seat at the top plan, which is hard to justify for contractors who may leave in three months. Teams that go without them see the same failures. Two merge requests each pass their pipeline alone and then break the main branch together. Someone pushes straight to a release branch. A Friday deployment goes out with nobody approving it. Spurline gives the team one forge, with every rule written down, so each person can predict exactly what the server will decide.

- **Founder-owner** (daily): sets up groups, subgroups, protected branches, push rules, approval rules and protected environments once. After that, they approve production deploys and keep the default branch green without reading every line.
- **Contract developer** (daily): commits from the built-in editor and opens merge requests, often stacked. They fix review threads and conflicts, then put the request on the merge train and see it merged.
- **Code-owner reviewer** (daily): reviews diffs line by line, leaves threaded comments and suggestions, compares versions, and approves the paths they own, often from a phone.
- **Client stakeholder** (weekly): has the Reporter role. They read the board, milestones and epics, and they see an issue they raised close when a merge request with a closing keyword merges.

## Journeys

1. **Founder sets up the guard rails.** Start: the founder-owner is signed in and owns the group `coldbrook`. They create a subgroup and a project, protect the default branch, add push rules and a `Backend` approval rule, and commit an owners file. They turn on merge trains and `pipelines_must_succeed`, then protect the `production` environment with one required approval. End: the settings rule cards on the light band show each rule. A contract developer's direct commit to the default branch is refused with the protected-branch text.
2. **Contract developer ships a stacked change.** Start: the developer has the Developer role, inherited from the parent group. They edit two files in the web editor and commit them to a new branch in one commit, then open request A. They open request B with A's branch as its target. Review threads come in, and the developer fixes them with a new push. That push outdates a thread and resets approvals. The developer resolves a three-way conflict in the browser and adds A to the merge train. End: A merges, and B is retargeted to the default branch with the published system note.
3. **Code-owner reviewer reviews by keyboard.** Start: the reviewer opens request A's changes. Using only the keyboard, they move line by line, comment on a three-line range, start a review, add a suggestion, resolve a thread and submit the review with a summary. End: the author's open page shows the new threads in place without a reload, the merge check reads `2 unresolved threads must be resolved.`, and the reviewer's focus is back on the diff line they left.
4. **Founder watches the train.** Start: three requests sit on the train for the default branch, and each block shows the combined commit it is tested as. The middle car's pipeline fails. End: the middle block leaves, and the car behind rises one step. Its kicker resolves to a new commit id, and the polite announcement reads `!<iid> is now position 2, testing <short>`. The first car merges its exact stored commit.
5. **Founder approves a production deploy and rolls back.** Start: a deploy job waits with `Waiting for approval: 0 of 1`. The contract developer who triggered it is refused when they try to approve. The founder approves, the deploy runs, and a later deploy fails. End: `Roll back to deployment 1` makes deployment 3 from deployment 1's stored artifact, and the delivery metrics show the change failure rate.
6. **Client stakeholder follows their issue.** Start: the stakeholder is a Reporter and opens the project board filtered by `priority::high`. The filtered URL reopens the same view. They watch a card move to `workflow::review` live. End: when a request whose description says `Closes #<iid>` merges into the default branch, their issue moves to `Closed` and shows the system note `Closed by !<iid>.`.
7. **Reviewer on a phone.** Start: the reviewer opens a merge request on a 390 by 844 touch phone. They swipe between files and long-press a line to open the comment sheet. Then they open the bottom sheet's `Checks` tab, approve, and drag a board card to another list. End: the desktop author sees the approval and the card move live.
8. **Export through a storage outage.** Start: file storage is down. The developer's project export reaches 80 and then fails with the published outage text. Storage comes back. End: `Retry export` runs to 100 and shows a download link to the stored `.spurpack`, without a server restart.

## Mandatory requirements

This is the complete list of mandatory requirements; every check traces to one of these lines and the detailed sections below.

- **DP-01 — Run manifest and health check** `/app/run.json` installs, builds and serves the app on port 4173 (or `APP_PUBLIC_PORT`), and `GET /api/health` answers 200 with the status JSON defined in Deployment.
- **DP-02 — Grading routes** With `SPUR_GRADING=1`, the seed, session, clock, commit, runner, storage and sink routes behave exactly as published in API, and every one of them answers 404 when the variable is unset.
- **DP-03 — Accounts and sessions** People sign up and sign in with a local username and password and hold the `spur_session` cookie, which every page and API route needs except sign-in, sign-up and health.
- **DP-04 — One error shape and order** Every API error uses one JSON body shape with a published code and message, and when several errors apply, the published precedence decides which one is returned.
- **DP-05 — Live updates and settle signal** Every project change is pushed over the project's live socket with a per-project sequence number that the causing write also returns, a reconnecting page receives what it missed, and live pages expose the applied sequence and the pending write count on `<main>`.
- **DP-06 — Server boundary and limits** The server serves only same-origin built assets and API responses, enforces the published body, file and rate limits, never exposes credentials or source, and starts and recovers when a service is down, as qualified in Server boundary.
- **DP-07 — Names, focus and announcements** Every control in the public table carries its published role and name, dialogs and sheets keep Tab inside and return focus to their opener, F6 cycles regions, and results are announced in the single polite `status "Announcements"` region with the published sentences.
- **DP-08 — Motion and reduced motion** The six published animations play with their published ids and durations on the published elements, nothing loops, and under reduced motion none of them run while the final state, announcements and focus stay the same.
- **DP-09 — Project home and seed components** The project home and the shell show the instance status strip, group switcher header, project hero dot field, open merge request bar, latest tag and pipeline tiles, project health stat cards, release notes carousel, recent activity row and instance footer as described in Visual design.
- **DP-10 — Working screen language** Code, diffs, logs, pipelines and the train sit on the dark ground in the mono face; settings, issues and boards sit as white bordered square cards on the light band; and empty and error states use the empty state start band and the status strip pattern, as described in Visual design.
- **DP-11 — Source integrity** The source reads every service credential and published setting from the environment, keeps all state in Postgres and MinIO, computes every published value on the server from stored records, and bundles its fonts.
- **DP-12 — Diffs and views** Diffs follow the published line diff, hunk and context rules, switch between inline and side-by-side views, expand context 20 lines at a time, and keep the view, file and line in the URL.
- **DP-13 — Threads and batch review** Line and range comments start threads, a started review keeps comments visible only to their author until one submit publishes them as one event, threads resolve and reopen, and open threads move to a new issue with the published texts.
- **DP-14 — Keyboard review in the diff** A reviewer walks a diff, comments on a range, resolves threads and submits a review using only the keyboard while the author's page updates live, and after each step focus lands where the keyboard table publishes.
- **DP-15 — Versions and compare** Every push to a source branch makes a numbered version, and any two versions, or the target and a version, can be compared, with the choice kept in the URL.
- **DP-16 — One push, every consequence** A single push to a source branch, from any route, makes a version, remaps or outdates threads, resets approvals when set, recalculates code owners, cancels interruptible pipelines, removes the request from its train and cancels auto-merge, all in one write.
- **DP-17 — Suggestions** Suggestions apply alone or as a batch in one commit with the published messages, pass through push rules and count as a push, and are refused with the published 409 texts in the published order.
- **DP-18 — Code owners and approval rules** The owners file on the target branch and the project's approval rules decide each required rule and its count by the published section, glob and last-match rules, recalculated whenever the request's changed files change.
- **DP-19 — Giving and resetting approvals** Eligible people approve, authors and ineligible people are refused with the published 403 texts unless the setting allows authors, one approval counts toward every rule its giver is eligible for, and approvals reset on push when the setting is on.
- **DP-20 — Merge checks and auto-merge** The merge checks widget lists the ten published checks in order with their exact texts and states, a blocked merge returns the first failed check, and auto-merge merges on the server when all checks pass or cancels with the published reason.
- **DP-21 — Merge methods and conflicts** Merge commit, squash, fast-forward and rebase produce the published commits and hashes, and conflicts are resolved in the browser with the exact markers into one merge commit on the source branch.
- **DP-22 — Stacked requests and closing keywords** A merge that deletes its source branch retargets the requests stacked on it, up to the published limit and with the published notes, and closing keywords close issues only when a request merges into the default branch.
- **DP-23 — Pipeline config and lint** The pipeline file is read by the published YAML subset and the include, extends, default, variables, rules, workflow rules and matrix rules, and lint returns the published messages at their 1-based lines, or the valid summary and the expanded jobs.
- **DP-24 — Pipeline graph** The pipeline graph places each job at the published layer, row and coordinates, draws one published curve per need, and moves focus along needs with the arrow keys.
- **DP-25 — Scheduler and job states** Each runner round follows the published four steps, job eligibility rules, `when` values, parallel and resource group limits, and the published status rollup for stages and pipelines.
- **DP-26 — Retries, timeouts and cancellation** Automatic and manual retries create new attempts with new ids, timeouts fail jobs on the server clock, and a newer push cancels older interruptible pipelines with the published reasons.
- **DP-27 — Job logs, artifacts and caches** Job logs follow the published line format and sections, stream live and are sealed into file storage; artifacts and caches follow the published download, expiry and restore rules; and a link appears only after file storage confirms the object.
- **DP-28 — Merge train rules** Each train car is tested as a stored speculative commit built on the car ahead, the first car merges that exact commit when its pipeline succeeds, and failures, removals, pushes, merge-now and target pushes rebuild the cars behind with new stored commits.
- **DP-29 — Train Ref Resolve** The train shows one stepped block per car with a resolving 7-character kicker and the published label, plays the published join, leave and rise animations and announcements live, becomes a plain list on phones, and changes at once under reduced motion.
- **DP-30 — Protected deployments** Deploy jobs to protected environments wait for the published number of approvals from allowed roles, refuse the deployer and lower roles, let approvals lapse on the server clock, and run one job per resource group at a time.
- **DP-31 — Rollback, outdated deploys and auto-stop** A rollback makes a new deployment only when its artifact is still stored, a deploy from an older pipeline fails as outdated, and review environments stop at their server-clock auto-stop unless they are kept.
- **DP-32 — Delivery metrics** The delivery metrics region computes deployment frequency, lead time, change failure rate and recovery time over production deployments, with days cut at midnight in the chosen time zone, by the published formulas and formats.
- **DP-33 — Boards and card moves** Board moves change the matching field, place the card at the server's position, refuse a stale move of the same card with the published 409 text, keep filters in the URL, and work by mouse, keyboard and touch with live updates for everyone.
- **DP-34 — Issues, quick actions and scoped labels** Quick actions run on submit with the published results, durations and weights follow the published formats, and a scoped label replaces its sibling in one write with one note, from every route.
- **DP-35 — Epics, milestones and burndown** Epics nest one level and take their dates from their issues' milestones, promotion copies the published fields, and the burndown plots one point per day by the published formula in the milestone's zone.
- **DP-36 — Breakpoints and the bottom sheet** The merge request view has three panes from 1280 px, two panes from 768 px to 1279 px, and one column below 768 px, where checks, threads and files move into the `dialog "Panel"` bottom sheet, with no horizontal page overflow at any published viewport.
- **DP-37 — Touch gestures** On a touch phone, a horizontal swipe changes file, a long press opens the line comment sheet, Approve works from the bottom sheet, and a held card drags to a board list, each with the published thresholds and announcements.
- **DP-38 — Groups, roles and visibility** Effective roles resolve as the highest of direct and inherited memberships plus custom permissions, the server refuses every action in the role table below its minimum, and unreadable resources answer 404 while readable but forbidden actions answer 403.
- **DP-39 — Live role changes and audit** A role change or removal applies to the person's open pages live, with the published announcement and focus rule, and every listed change writes a permanent audit event with before and after values.
- **DP-40 — Confidential issues** Confidential issues are invisible to people without access in pages, search, counts, notes, mentions and closing lines, while a closing keyword still closes them.
- **DP-41 — Repository objects and commits** Blobs, trees and commits use the published hash formulas, the commit API and the web editor each make one all-or-nothing commit with stale-base refusal, and history and blame follow the published walks.
- **DP-42 — Protection and push rules** Protected branches and tags and the five push rules give the published verdicts, in the published order, for every commit from the editor, suggestions, merges, rebases, the train and the API.
- **DP-43 — Wiki** Wiki pages keep numbered versions, render only the published Markdown subset, refuse a stale edit with the published 409 text, compare versions, and restore an old version as a new version.
- **DP-44 — Reports and security findings** Test, coverage, quality and security reports compare the head pipeline with the base pipeline by the published rules, and an unreviewed high or critical finding adds the Security review rule and merge check until it is dismissed.
- **DP-45 — Webhooks** Webhook deliveries carry the published payload and signed headers, reach only allow-listed targets, retry on the server-clock schedule, and are listed and can be redelivered.
- **DP-46 — Project export and import** Exports and imports use the published `.spurpack` format with exact line errors and a byte-exact round trip, show live progress, show a file link only after storage confirms the file, and recover through Retry export after a storage outage without a restart.

## Frontend

### Screens and layout (DP-09, DP-10, DP-12, DP-36)

Breakpoints: a **phone** is narrower than 768 px, a **tablet** is 768 px to 1279 px, and a **desk** is 1280 px and wider. The published viewports are 375x812 and 390x844 (phones), 768x1024 (tablet) and 1280x800 (desk). No page scrolls sideways at any published viewport. Wide content (diffs, logs, the train, the graph) scrolls inside its own panel.

Page routes. Each one opens directly from its address, and reloading shows the same screen:

| Route | Screen |
|---|---|
| `/sign-in`, `/sign-up` | Sign-in and sign-up forms |
| `/` | Your projects (dashboard) |
| `/groups/<group path>` | Group page: subgroups, projects, members, epics |
| `/groups/<group path>/-/epics/<iid>` | Epic |
| `/groups/<group path>/-/boards/<board id>` | Group board |
| `/projects/<id>` | Project home (the hero) |
| `/projects/<id>/-/files?ref=&path=` | File tree and file view |
| `/projects/<id>/-/blame?ref=&path=` | Blame |
| `/projects/<id>/-/commits?ref=&path=` | History |
| `/projects/<id>/-/commit/<full id>` | One commit |
| `/projects/<id>/-/compare?from=&to=` | Compare refs |
| `/projects/<id>/-/edit?ref=&path=` | Web editor |
| `/projects/<id>/-/ci/editor?ref=` | Pipeline config editor |
| `/projects/<id>/-/merge_requests` and `/-/merge_requests/new` | Request list and new request form |
| `/projects/<id>/-/merge_requests/<iid>` | Request overview |
| `/projects/<id>/-/merge_requests/<iid>/changes?file=&line=&view=&from=&to=` | Request changes (the diff) |
| `/projects/<id>/-/merge_requests/<iid>/conflicts` | Conflict resolution |
| `/projects/<id>/-/train?target=<branch>` | Train page for one target branch |
| `/projects/<id>/-/pipelines`, `/-/pipelines/<pipeline id>` | Pipeline list and one pipeline with its graph |
| `/projects/<id>/-/jobs/<job id>` | Job page with live log |
| `/projects/<id>/-/environments`, `/-/environments/<environment id>` | Environments and one environment |
| `/projects/<id>/-/metrics?zone=&days=` | Delivery metrics |
| `/projects/<id>/-/issues`, `/-/issues/<iid>` | Issue list and one issue |
| `/projects/<id>/-/milestones/<milestone id>` | Milestone with burndown |
| `/projects/<id>/-/boards/<board id>?label=&assignee=&milestone=&search=` | Project board |
| `/projects/<id>/-/wiki/<slug>`, `/-/wiki/<slug>/history` | Wiki page and its history |
| `/projects/<id>/-/settings` | Settings rule cards |
| `/projects/<id>/-/audit` | Audit events |
| `/projects/<id>/-/export`, `/projects/<id>/-/import` | Export, and import progress |
| `/search?scope=&q=` | Search |

**Shell.** Every signed-in page starts with the instance status strip. Below it is the sticky group switcher header, then `<main>`, then the instance footer. The live pages are the merge request pages, the board, the pipeline and job pages, the editor, the train page and the wiki. On these pages `<main>` carries `data-seq` and `data-pending`, as set out in API.

**Project home.** On the dark ground, the project hero dot field fills the top of the page, with column rules running its full height. The project name is the level 1 heading and spans about three of the four column widths. The single-line description sits in column 1, with the open merge request bar under it. The latest tag and pipeline tiles drop into columns 2 and 3 at staggered heights. Below follow the project health stat cards, the release notes carousel, the recent activity row, and the instance footer. On a phone, everything stacks in one column with even side margins: the bar goes full width, the tiles stack, and the stat cards become a row that scrolls sideways inside itself, with the next card peeking in.

**Merge request view** (overview and changes). The header carries a bracketed mono ref kicker `[ <source> -> <target> ]`, the `!<iid>` id, the title as heading level 1, and a navigation `navigation "Merge request"` with links `Overview`, `Commits`, `Pipelines`, `Changes`.
- Desk: three panes. Left is `navigation "Files"` with the changed-file list. The centre holds the overview activity or the diff. Right is `complementary "Merge request panel"`, holding `region "Merge checks"`, `region "Approvals"`, `region "Threads"`, `region "Viewing now"`, `list "Merge train"` when trains are on, and the report regions from API.
- Tablet: two panes, the centre and the right panel. The file list moves into a drawer opened by `button "Show files"`.
- Phone: one column of header and centre. `button "Open panel"` opens `dialog "Panel"`, a bottom sheet with `tablist` tabs `Checks`, `Threads` and `Files`. `Checks` holds the merge checks, approvals, `button "Approve"` and the merge buttons; `Threads` holds the thread list; `Files` holds the file list.

**Train page.** This page and the request panel show `list "Merge train"` as a staircase. Each car is a block one column wide, sitting exactly 24 px lower than the car before it in the same row. A desk row holds 3 cars and a tablet row holds 2, and each new row starts back at the top step. On a phone the train is a single vertical list with no steps.

**Pipeline page.** Pipeline stage cards appear in rows of 3 on a desk, 2 on a tablet and 1 on a phone. Below them is the `group "Pipeline graph"` in a panel that scrolls sideways inside itself, and then the job rows.

**Job page.** The job header strip, `log "Job log"`, artifact links, and the failure text in the status strip pattern.

**Board.** Lists sit side by side on the light band. On a desk all lists show at once when there are 4 or fewer. On a tablet the lists scroll sideways inside the board region. On a phone each list is full width and the lists scroll sideways one at a time.

**Settings.** One column of settings rule cards on the light band: `region "Protected branches"`, `region "Protected tags"`, `region "Push rules"`, `region "Approval rules"`, `region "Merge settings"`, `region "Protected environments"`, `region "Project variables"`, `region "Members"`, `region "Webhooks"` (with `region "Deliveries"` for the selected webhook).

**Editor.** The `tree "Files"` file tree sits on the left and the tabs and editors on the right, with the commit form below them. On a phone the tree moves into a drawer opened by `button "Show files"`.

### Public screens and controls (DP-07, DP-12, DP-13, DP-20, DP-24, DP-29, DP-33, DP-36, DP-37, DP-41)

Only the controls and regions listed here are public. Everything else is free. Names are exact, and `<…>` marks a value.

| Where | Role and accessible name | Visible copy or content |
|---|---|---|
| Every page | `status "Announcements"` (polite, one per page) | Sentences from Feedback states |
| Every page | `region "Notifications"` | Toasts that repeat each announcement |
| Every page | `region "Instance status"` | The instance status strip copy from Services |
| Header | `link "Spurline home"`, `button "Switch group"`, `dialog "Groups"`, `searchbox "Search"`, `button "Account"`, `button "Menu"` (phone) | Wordmark `Spurline` |
| Footer | `contentinfo` | Link columns `Work`, `Delivery`, `Planning`, `Account`; legal line `Coldbrook Signal Works · Spurline` |
| Sign-in | `textbox "Username"`, `textbox "Password"`, `button "Sign in"`; sign-up: the same fields and `button "Create account"` | |
| Dashboard | `heading "Your projects"`, `list "Projects"` | |
| New request form (`/-/merge_requests/new`) | `combobox "Source branch"`, `combobox "Target branch"`, `textbox "Title"`, `textbox "Description"`, `textbox "Assignees"` and `textbox "Reviewers"` (usernames separated by spaces), `checkbox "Delete source branch when merged"`, `button "Create merge request"` | Field errors use the title texts from Business rules |
| Project home | `link "Open a merge request"` | `Open a merge request →` |
| Project home | `link "Latest tag <name>"`, `link "Latest pipeline on <default branch>: <status>"` | Mono kickers: version in gold, short commit id |
| Project home | `region "Project health"` with `group "Open merge requests"`, `group "Pipelines passed"`, `group "Open issues"` | Values from Business rules |
| Project home | `region "Release notes"`, `button "Previous release"`, `button "Next release"` | Counter `<i> / <n>` |
| Project home | `list "Recent activity"` | Latest 3 events |
| Files | `tree "Files"` with `treeitem` per entry | |
| Blame | `table "Blame"` | |
| Request header | `button "Mark as ready"`, `button "Close merge request"`, `button "Reopen merge request"`, `button "Rebase"` | |
| Request overview | `combobox "Activity filter"` | `All activity`, `Comments only`, `History only` |
| Request overview | `textbox "Comment"`, `button "Comment"` | |
| Request overview | `region "Closing issues"` | Text from Business rules |
| Changes | `grid "Diff"`, one `row` per line | Row label from Interactions |
| Changes | `button "Inline view"`, `button "Side-by-side view"` (with `aria-pressed`) | |
| Changes | `button "Expand context above"`, `button "Expand context below"` | |
| Changes | `combobox "Compare from"`, `combobox "Compare to"` | `Target branch`, `Version <n>` |
| Changes | `textbox "Comment on line <n>"` or `textbox "Comment on lines <a>-<b>"`, `button "Add comment"`, `button "Start review"`, `button "Add to review"`, `button "Cancel"` | |
| Changes | `button "Finish review"`; `dialog "Submit review"` with `textbox "Summary"`, `button "Submit review"`, `button "Discard review"` | `Pending comments: <n>` |
| Threads | `article` per thread, labelled `Thread on <path> line <n>, <unresolved\|resolved>` or `Thread on <path> lines <a>-<b>, <unresolved\|resolved>`; a request-level thread is labelled `Thread on merge request, <unresolved\|resolved>` | `Outdated` label when outdated |
| Threads | `button "Resolve thread"`, `button "Reopen thread"`, `textbox "Reply"`, `button "Reply"`, `button "Move to issue"` | |
| Suggestions | `button "Apply suggestion"`, `button "Add to batch"`, `button "Remove from batch"`, `button "Apply batch"` | |
| Panel | `region "Merge checks"`, one `listitem` per check labelled `Merge check <name>, <state>` | Failure texts from Business rules |
| Panel | `region "Approvals"`, `button "Approve"`, `button "Revoke approval"` | `<rule>: <n> of <m>` |
| Panel | `region "Owners problems"` | `Line <n>: <reason>` |
| Panel | `button "Merge"`, `button "Set to auto-merge"`, `button "Cancel auto-merge"`, `button "Add to merge train"`, `button "Remove from train"`, `button "Merge now"` | |
| Panel | `region "Viewing now"` | Usernames |
| Panel | `region "Test summary"`, `region "Coverage"`, `region "Code quality"`, `region "Security"` | Texts from Business rules |
| Security | `button "Confirm finding"`, `button "Dismiss finding"`, `button "Resolve finding"`, `button "Reopen finding"`, `textbox "Dismissal reason"` | |
| After merge | `heading "Merged into <target>"` | |
| Conflicts | `button "Use ours"`, `button "Use theirs"` (one pair per hunk), `button "Edit inline"`, `textbox "Conflict editor"`, `button "Commit resolution"` | |
| Train | `list "Merge train"`, `listitem` per car labelled `Position <n>, !<iid>, testing <short>, pipeline <status>`, with `data-position`, `data-iid`, `data-sha` | Kicker `[ <short> ]` |
| Pipeline | `list "Stages"`, `listitem` labelled `Stage <index> <name>, <status>` | Mono index `01`, `02`, … |
| Pipeline | `group "Pipeline graph"`, one `button` per job labelled `Job <name>, stage <stage>, <status>, needs <names joined with " and "\|nothing>` | |
| Pipeline | `list "Jobs"`, row labelled `Job <name>, stage <stage>, <status>, <duration>` | |
| Pipeline | `button "Retry pipeline"`, `button "Cancel pipeline"`, `button "Play <job>"`, `button "Retry job"`, `button "Cancel job"` | |
| Job | `log "Job log"`, one row per line; `button "Toggle section <name>"` | |
| Job | `link "Download <path>"`, `button "Keep artifacts"` | |
| CI editor | `textbox "Pipeline config"`, `button "Check config"`, `region "Lint results"` (each error a `button` named by its text), `list "Expanded jobs"` | |
| Editor | `tablist "Open files"`, `textbox "Edit <path>"`, `button "New file"`, `dialog "New file"`, `textbox "File path"`, `button "Rename <path>"`, `button "Delete <path>"`, `combobox "Target branch"`, `textbox "New branch name"`, `textbox "Commit message"`, `button "Commit"`, `button "Refresh and reapply"` | |
| Editor | `dialog "Unsaved changes"`, `button "Keep editing"`, `button "Discard"` | |
| Environments | `list "Environments"`, row labelled `Environment <name>, <state>, deployment <n>` | `Auto-stops at <time>` |
| Environment | `button "Approve deployment"`, `button "Reject deployment"`, `button "Stop environment"`, `button "Keep environment"`, `button "Roll back to deployment <n>"` | `Waiting for approval: <n> of <m>` |
| Metrics | `region "Delivery metrics"`, `combobox "Time zone"`, `combobox "Range"` (`7 days`, `30 days`, `90 days`) | Texts from Business rules |
| Issues | `textbox "Title"`, `textbox "Description"`, `checkbox "Confidential"`, `button "Create issue"`, `textbox "Comment"`, `button "Comment"`, `button "Close issue"`, `button "Reopen issue"` | |
| Board | `region "Board <name>"`, `list "<list title>"` per list with a count line, `listitem` card labelled from Interactions, with `data-lifted` | `<n> issues` |
| Board | `combobox "Filter by label"`, `combobox "Filter by assignee"`, `combobox "Filter by milestone"`, `searchbox "Filter cards"` | |
| Milestone | `img "Burndown"` with one point per day (`data-day`, `data-remaining`, `data-future`), `table "Burndown data"` | |
| Epic | A level 1 heading with the epic title, `region "Epic dates"`, `link "Parent epic &<iid>"` (only when nested), `list "Child epics"`, `list "Epic issues"`, `list "Epic activity"` (its notes) | Mono kicker `&<iid>`. The dates region reads `Start <YYYY-MM-DD>` and `Due <YYYY-MM-DD>`, or `Start not set` and `Due not set` |
| Wiki | `textbox "Page title"`, `textbox "Page content"`, `button "Save page"`, `button "Restore this version"`, `combobox "Compare from"`, `combobox "Compare to"` | |
| Export | `button "Export project"`, `progressbar "Project export"`, `button "Retry export"`, `link "Download export"` | |
| Import | `button "Choose spurpack file"`, `dialog "Import preview"`, `button "Import"`, `progressbar "Project import"` | |
| Search | `combobox "Scope"`, `list "Results"`. The query box is the header's `searchbox "Search"`, filled with `q`, and the page has no second search box | `<n> results` |
| Settings | Each settings rule card is a `region` named by its title | |
| Forms | An `alert` error summary with heading `Fix these problems:` whose items are links to the fields | Field texts from Business rules |

### Interactions (DP-07, DP-12, DP-13, DP-14, DP-24, DP-33, DP-37, DP-41)

**Keyboard and focus.** Letter shortcuts never fire while focus is inside a text field. A shortcut works whichever control in its region has focus. Every dialog and sheet keeps Tab and Shift+Tab inside it, wrapping from the last control to the first and back. Escape closes it, and closing returns focus to the control that opened it. F6 and Shift+F6 move focus to the next or previous landmark region of the page (header, files, main, panel, footer), so focus is never trapped.

| Region | Keys | What happens and where focus lands |
|---|---|---|
| `grid "Diff"` | j / k | Next or previous line row (roving focus on rows) |
| | n / p | First line row of the next or previous file |
| | ] / [ | Next or previous unresolved thread `article` |
| | c | Opens the comment box under the current row; focus is in it |
| | Shift+ArrowDown / Shift+ArrowUp | Extends the selected range down or up on the same side; the comment box names the range |
| | Ctrl+Enter in the comment box | Posts the comment, or adds it to the review when a review is in progress; focus returns to the line row |
| | Escape in the comment box | Cancels; focus returns to the line row |
| | e on a focused thread | Resolves it; focus moves to the next unresolved thread, or to the thread's line row if none is left |
| Board | Arrow keys | ArrowUp and ArrowDown move between cards in a list; ArrowLeft and ArrowRight move to the same position in the neighbouring list |
| | Space | Lifts the focused card (`data-lifted="true"`) |
| | Arrow keys while lifted | Move the lifted card: Up and Down change position, Left and Right change list |
| | Space while lifted | Drops it, sending the move; focus stays on the card |
| | Escape while lifted | Cancels; the card returns and keeps focus |
| `group "Pipeline graph"` | ArrowRight / ArrowLeft | First job that needs this one (lowest row) / this job's first need in written order; focus stays when there is none |
| | ArrowUp / ArrowDown | Previous or next row in the same layer |
| | Enter | Opens the job page with focus on `log "Job log"` |
| `tree "Files"` | ArrowDown, ArrowUp, Home, End | Move between visible items |
| | ArrowRight | Opens a closed folder, or moves into an open one |
| | ArrowLeft | Closes an open folder, or moves to the parent |
| | Enter | Opens the file |
| | A letter | Next visible item whose name starts with it |
| `region "Release notes"` | ArrowLeft / ArrowRight | Previous or next release; wraps |
| `region "Lint results"` | Enter on an error | Caret goes to the start of that line; focus goes to `textbox "Pipeline config"` |

**Diff rows.** Each row is labelled `Line <n> <added|removed|unchanged>, <path>, <k> unresolved threads`, for example `Line 42 added, src/app.ts, 2 unresolved threads`. When k is 1 the part reads `1 unresolved thread`, and when k is 0 the part is left out. The line number is the new-side number for added and unchanged lines, and the old-side number for removed lines. In the side-by-side view, each side's cells are rows of the same grid, in the order left side, then right side, line by line.

**Where you land after each action.** The address bar shows the route below, and reloading it shows the same screen:

| Action | Route after | Focus after |
|---|---|---|
| Sign in | `/` (or the page that sent you to sign in) | `heading "Your projects"` |
| Create a merge request | `/projects/<id>/-/merge_requests/<iid>` | The level 1 title heading |
| Submit review | Unchanged | The diff row that was current when `Finish review` was pressed |
| Resolve a thread with the button | Unchanged | The thread's line row (or the next unresolved thread when e was used) |
| Merge | `/projects/<id>/-/merge_requests/<iid>` | `heading "Merged into <target>"` |
| Add to merge train | Unchanged | This request's car in `list "Merge train"` |
| Commit from the editor | `/projects/<id>/-/commit/<full id>` | The level 1 heading `Commit <short>` |
| Commit a conflict resolution | `/projects/<id>/-/merge_requests/<iid>` | `region "Merge checks"` |
| Create an issue | `/projects/<id>/-/issues/<iid>` | The level 1 title heading |
| Approve | Unchanged | `button "Revoke approval"` |
| Start an export | `/projects/<id>/-/export` | `progressbar "Project export"` |
| Confirm an import | `/projects/<new id>/-/import` | `progressbar "Project import"` |

**Shareable views.** The changes view keeps `file` (path), `line` (number), `view` (`inline` or `split`), `from` (`target` or a version number) and `to` (a version number) in the URL. Moving between lines and files replaces the address without adding history. Opening such an address shows that file with that line row focused and scrolled into view. On a board, each filter change (`label`, `assignee`, `milestone`, `search`) adds a history entry, so Back and Forward restore the earlier filters.

**Pointer.** Clicking a diff line number starts a comment on that line. Shift-clicking a second number on the same side makes it a range. Dragging a board card with the mouse sends the same move as the keyboard. Hovering a file or job header strip lightens it.

**Touch** (phones, `has_touch`):
- A horizontal swipe on the diff moves to the next file (finger moving left) or the previous file (finger moving right). It counts only when the finger moves more than 80 px sideways and less than 40 px up or down.
- A long press on a diff line opens `dialog "Comment on line <n>"`. The press counts after 500 ms on page timers, with less than 8 px of movement. The dialog holds `textbox "Comment"`, `button "Add comment"`, `button "Start review"` and `button "Cancel"`.
- A board card follows the finger after a 200 ms hold on page timers. Releasing drops it on the list under the finger and sends the same move as a mouse drag.
- Every touch target is at least 44 px square.

**Editor.** Edits stay in their tab until committed. Several files go into one commit. Unsaved edits are kept in the browser's local storage, keyed by project, branch and path, and restored when you come back. Following an in-app link with unsaved edits opens `dialog "Unsaved changes"`. A 409 stale base shows `button "Refresh and reapply"`, which three-way merges each open edit onto the new head. Files that conflict are marked `data-conflict="true"` on their tab, the tab's name ends with ` (conflict)`, and the editor text contains the conflict markers. The editor refuses to commit text that contains markers, using the conflict-marker text from Business rules.

**Live pages.** A page applies each live message to the page inside the socket's message handler, without waiting for a timer or an animation frame. Optimistic writes (board moves, thread resolve) show at once. A refusal puts back the server's state.

### Visual design (DP-09, DP-10)

The design keeps a seed's interface conventions and recasts them for a forge. The mood has three parts:
- **Nocturnal:** a deep blue-green near-black ground stays behind all code.
- **Exacting:** every edge is square and every control is flat.
- **Warm-edged:** a teal-to-gold-to-rust gradient appears only on things moving towards production.

**Type.**
- Inter Tight, bold and tightly tracked with lines set close, carries display headings in sentence case.
- Inter, in light, regular and semibold, carries body text.
- JetBrains Mono, in light, regular and medium, is used only for literal code: source, diffs, commit ids, branch and job names, ref kickers, log lines, and pipeline and request ids.
- All three are bundled with the app. Each heading step is about a third larger than the one below it. The project name is six times the body size on a desk and three times on a phone.

**Colour roles.**
- **Ground:** the near-black blue-green behind dark sections and code.
- **Surface:** one step lighter, used for file and job header strips and cards.
- **Raised surface:** a further step lighter, used for hover and raised panels.
- **White ink** for text on dark.
- **Soft off-white** for very large type.
- **Muted grey-teal** for secondary text.
- **Darker tertiary grey**, used only for large or non-essential text.
- **Light band:** a pale sage-grey band behind settings, issues and boards.
- **Cards:** white, with a pale grey-green 1 px border.
- **Accents:** teal, gold and rust. Teal marks success and live progress, gold marks versions and waiting states, rust marks failure. Accents are never a fill behind small text.
- Text and controls meet WCAG 2.2 AA contrast.

**Density and composition.** Comfortable density. The content is 1110 px wide on three equal columns, with faint vertical column rules running the full height of the project hero. Content snaps to the columns. The hero tiles and the train cars step down one column at a time, like a staircase. Dark sections hold code, diffs, pipelines and the train. Pale bands with white bordered cards hold settings, issues and boards.

**Seed components, recast.** All are square-cornered except the round carousel arrows.
- **Instance status strip** (`region "Instance status"`): a full-width slim strip above the header, about as tall as a large button, on the ground with a faint dot texture. It holds one centred bold white sentence and scrolls away with the page. During a storage outage, its right quarter warms into the rust end of the gradient.
- **Group switcher header** (`banner`): sticky, a little taller than the strip. The wordmark sits at left. `Switch group` opens `dialog "Groups"` with a chevron that turns over, and search and account sit at right. On the project home it is see-through over the hero and turns to the light band with dark ink once the hero scrolls away, in about a third of a second. On every other page it is solid ground. On a phone it shows the wordmark centred and `Menu` at right.
- **Project hero dot field:** a dense, static grid of small dots, brightest at the top right and fading into the ground, under the 1 px column rules.
- **Open merge request bar** (`link "Open a merge request"`): exactly one column wide and tall like a large tile. It is filled with a muted, darkened teal-gold-rust gradient behind a faint 1 px light border, with the label left and the arrow right. On hover the gradient brightens slightly and the arrow nudges right. Pressing it sinks it by 1 px. Focus shows a 2 px white outline set 2 px out.
- **Latest tag and pipeline tiles:** two flat tiles with a faint white wash, in columns 2 and 3. The column 3 tile sits higher than the column 2 tile, reading as a descending stair. The tag tile has a gold mono version kicker and the pipeline tile has a short commit id kicker. The tag tile reads `No tags yet` when there are none. The wash brightens on hover.
- **Settings rule cards:** white cards with a 1 px border on the light band. Each has a mono bracket kicker, a bold title, a large muted explanation and its controls.
- **Resolving ref kicker:** the bracketed mono kicker on each train car, described under Train Ref Resolve.
- **Pipeline stage cards:** 1 px faintly outlined transparent cards on dark, with a mono two-digit index, the stage name in bold and its status.
- **Project health stat cards:** each has a mono bracket label in a header strip, a light mono numeral the size of a section heading, and a caption. They are staggered like the hero tiles.
- **Release notes carousel:** a dark band showing one tag's message per slide as a large headline led by a gradient `//`. It has a mono `<i> / <n>` counter and two round outlined arrow buttons, and it wraps. It is hidden when the project has no tags.
- **Recent activity row:** three full-bleed ruled columns, each with a mono kicker led by a small gradient square, a semibold title and a muted line. Hover adds a faint wash.
- **Empty state start band:** every empty list shows a `// <EYEBROW>` mono eyebrow, a headline at section-heading size and a dark 48 px square button. Contents per list are in Feedback states.
- **Instance footer** (`contentinfo`): dense, dark, with four link columns (two on phones), a 1 px rule and the legal line.

**Working screens.** Repository browsing, blame, diffs, logs and the graph sit on the ground in JetBrains Mono. Their file and job headers are bordered surface strips that lighten on hover. Lists are flat rows with 1 px dividers and a faint wash on hover. Forms use square 48 px inputs with a 2 px white focus outline set 2 px out. Board columns are white bordered cards. Scoped labels are square chips with a 1 px border, showing the key and the value in two halves. Errors and outages use the status strip pattern across the full width of the affected panel, with fixed copy. No paper or cream grounds, no glass, no rounded pills.

**Signature, Train Ref Resolve.** The seed's pixel staircase becomes the train itself. Each car is a column block one step lower than the car ahead, so the stair draws the order in which changes stack on the target. The dithered teal-to-rust gradient fills only cars and deploys that are moving towards production. Each car shows its request id, its bracketed kicker and its pipeline status.

### Motion and effects (DP-08, DP-29)

Every motion settles. Nothing loops, pulses or animates while idle, and no decorative motion exists beyond what is listed here.

**Named animations.** These run through the browser's Web Animations interface, so `element.getAnimations()` on the element lists them with these ids:

| id | Element | What it shows | Duration |
|---|---|---|---|
| `train-step` | A train car that joins or moves | It slides into its new place from one step (24 px) away: from above when joining, from below when rising | 300 ms |
| `train-leave` | A train car that is removed or merged | It fades out completely | 160 ms |
| `card-settle` | A dropped board card | It shrinks from 104% to its normal size | 200 ms |
| `job-status` | A graph job or job row whose status changed | It brightens from 40% visible to fully visible | 240 ms |
| `check-flip` | A merge check `listitem` whose state changed | It brightens from 40% visible to fully visible | 180 ms |
| `sheet-rise` | `dialog "Panel"` when it opens | It rises from below the screen edge into place | 220 ms |

Each starts quickly and settles softly. When several train cars move together, each starts 80 ms after the one in front, in front-to-back order.

**Small feedback.** Hover fills and header strips lighten in about a fifth of a second. Arrows nudge 4 px on hover in the same time. The header changes colour in about a third of a second. A carousel slide fades in about a sixth of a second while shifting sideways, settling within a third of a second.

**Train Ref Resolve, step by step.**
1. A car's block appears (page load or join) and plays `train-step`.
2. 100 ms after it starts, the 7 characters inside `[ … ]` cycle through random hex glyphs (`0` to `9`, `a` to `f`), changing every 40 ms on page timers.
3. The characters lock in from left to right, one every 50 ms. The first locks at 150 ms and the seventh at 450 ms, showing the short form of the speculative commit id that the server stored for that car. The brackets and the width never move.
4. `data-sha` holds the full stored id from the first frame, and the kicker's accessible label is always `Testing <short>`.
5. When a car is removed, its block plays `train-leave`. Every car behind it plays `train-step` rising one position, 80 ms apart, front to back. Each car whose stored id changed runs steps 2 and 3 again to its new id. A car whose id did not change never runs them again.

On a phone the same animations play in the plain list, without steps.

**Reduced motion.** When the browser reports a preference for reduced motion:
- `getAnimations()` is empty on every element in the table above, and hover changes are instant.
- Kickers show their final id at once.
- Removed cars and closed sheets disappear at once.
- Labels, data attributes, announcements and focus are exactly the same as with motion. Data attributes always hold final values at once, in both modes.

### Feedback states (DP-05, DP-07, DP-13, DP-20, DP-27, DP-29, DP-33, DP-46)

Every string shown in backticks in this brief renders character for character: straight apostrophes, ASCII hyphens, the same case and digits, and the same final full stop or none. Announcements built from these strings carry the same characters.

**Times on screen.** Every `<time>` in screen copy (`Starts at <time>`, `Auto-stops at <time>`, `next try <time>` and any other) is a time the server returned. It is shown in the viewer's profile time zone as `YYYY-MM-DD HH:mm:ss <zone>`, on a 24-hour clock with the IANA zone name. For example, the server time `2026-01-01T00:00:00Z` reads `2026-01-01 09:00:00 Asia/Tokyo` for a viewer in Tokyo.

**Pending.** While a write is in flight, its button is disabled with `aria-busy="true"` and keeps its label, and `<main data-pending>` counts it.

**Success.** The screen changes in place, and the sentence from the table below goes to `status "Announcements"` (polite). The same sentence shows as a toast in `region "Notifications"`, which disappears after `SPUR_TOAST_MS` milliseconds on page timers.

**Field errors.** Each field error shows under its field, linked to it as its description. An `alert` error summary above the form links to each field. The texts come from Business rules.

**Other errors.** The API message shows in the status strip pattern at the top of the affected panel and is announced.

**Outage.** File storage outages show the Services copy in the strip pattern of the affected panel.

**Live updates.** The checks widget, approvals, threads, pipeline graph, job rows, log, train, board counts and cards, versions and export progress change in place from live messages for every viewer, without a reload, within one second of the server change. The announcements below go to every page showing the thing they name, unless a recipient is given.

| Event | Announcement |
|---|---|
| A pipeline fails | `Pipeline <id> failed: job <name>` (the first failed job in config order that may not fail) |
| A pipeline fails on its config | `Pipeline <id> failed: config has errors` |
| A pipeline succeeds | `Pipeline <id> succeeded` |
| A pipeline is canceled | `Pipeline <id> was canceled` |
| A job starts, succeeds or fails (job and pipeline pages) | `Job <name> started`, `Job <name> succeeded`, `Job <name> failed` |
| A car's position or id changes | `!<iid> is now position <n>, testing <short>`, one per changed car, front to back |
| A car is removed (to its request's author only) | `Removed from merge train` |
| A car merges | `!<iid> merged into <target>` |
| A merge | `Merged into <target>.` |
| A review is submitted | `Review submitted: <n> comments` (singular `Review submitted: 1 comment`) |
| A thread is resolved | `Thread resolved. <n> unresolved threads left.`, `Thread resolved. 1 unresolved thread left.`, `Thread resolved. No unresolved threads left.` |
| A thread is reopened | `Thread reopened.` |
| An approval | `Approved. Needs <n> more approvals: <rule names>.` (singular `approval`), or `Approved. All approval rules are satisfied.` |
| A deployment approval | `Deployment approval recorded: <n> of <m>.` |
| A commit from the editor | `Committed <short> to <branch>.` |
| Editor restore | `Restored unsaved changes in <n> files.` (singular `1 file`) |
| A file swipe | `File <i> of <n>: <path>` |
| Board keyboard | `Lifted Issue #<iid>.`, `Over <list>, position <n>.`, `Dropped in <list>, position <n>.`, `Move canceled.` |
| Lint | The valid summary, or `Lint found <n> problems.` (singular `1 problem`) |
| Export finishes | `Export ready.` |
| Import finishes | `Import finished: <c> commits, <i> issues, <r> requests.` |
| A system note or quick action result | Its text from Business rules |
| An API refusal | Its message |

**Empty state start bands:**

| List | Eyebrow | Headline | Button |
|---|---|---|---|
| Merge requests | `// MERGE REQUESTS` | `No merge requests yet` | `Open a merge request` |
| Issues | `// ISSUES` | `No issues yet` | `New issue` |
| Pipelines | `// PIPELINES` | `No pipelines yet` | `Edit pipeline config` |
| Environments | `// ENVIRONMENTS` | `No environments yet` | `Edit pipeline config` |
| Wiki | `// WIKI` | `No wiki pages yet` | `Create the first page` |
| Train | `// MERGE TRAIN` | `The train is empty` | `Open merge requests` |
| Empty repository | `// FILES` | `This project is empty` | `Add a file` |

## Backend

### API (DP-02, DP-03, DP-04, DP-05)

JSON in and out, as `application/json; charset=utf-8`, except the import upload (`text/plain`) and file and log downloads. Ids are integers unless stated otherwise. Commit, tree and blob ids are 64 lower-case hex characters, and a short id is the first 7 of them. Times are UTC ISO 8601 strings with milliseconds. Every write that changes project state returns `seq`, the number of the last live message it caused (or the project's current number if it caused none).

**Error shape.** Every error body is `{"error":"<code>","message":"<text>"}`, with an optional `"details"` object.

**Error precedence.** When several errors apply, the server returns the first in this order: 413, then 400 (body is not valid JSON), then 401, then 429, then 404, then 403, then 409, then 422, then 503. An idempotent replay returns its stored response before any of these except 413, 400 and 401. On `POST /api/session`, the sign-in limit from Server boundary is checked before the password. Once a username is over that limit, further attempts get the 429 even with the right password, and `bad_credentials` (401) is returned only to attempts within the limit.

**General codes:**
- 400 `bad_request`: `The request body isn't valid JSON.`
- 401 `unauthenticated`: `Sign in to continue.`
- 404 `not_found`: `Not found.` A private or confidential resource is also 404 to anyone without read access, never 403.
- 403 `forbidden`: `You don't have permission to do that.`
- 405 `method_not_allowed`: `This method isn't allowed here.`
- 422 `validation`: the message is the first field error, with `"details":{"fields":{"<field>":"<text>"}}`.

Every other code belongs to the rule that defines it.

**Idempotency.** `POST .../commits`, `POST .../merge`, `POST .../approve` and `POST .../deployments/<id>/approvals` accept an `Idempotency-Key` header, scoped to the signed-in user and kept for 24 hours. A replay with the same key and the same body returns the stored status and body, with the header `Idempotent-Replay: true`. The same key with a different body is 409 `idempotency_conflict`: `This idempotency key was used with a different request.`

**Live channel.**
- `GET /api/live?project=<id>&since=<seq>` upgrades to a WebSocket. It needs the session and read access, and answers 404 otherwise.
- Messages are `{"seq":<n>,"type":"<type>","data":{…}}`, with `seq` counting up by one per project. Every state change in a project sends exactly one message.
- Types: `merge_request`, `thread`, `review`, `approvals`, `checks`, `version`, `pipeline`, `job`, `job_log`, `train`, `board`, `issue`, `epic`, `milestone`, `wiki`, `environment`, `deployment`, `role`, `presence`, `export`, `import`, `instance`.
- With `since`, the server first sends every message after it, if they are among the last 1000. Otherwise it sends `{"type":"resync"}` and the page reloads its data.
- The server keeps sockets alive with protocol-level pings. It never closes a socket because the client sends nothing.

**Log stream.** `GET /api/jobs/<id>/log/stream` is `text/event-stream`:
- a comment line every `SPUR_SSE_HEARTBEAT_MS`;
- an event `line` per log line, with data being the line text;
- then a final event `end` with data `{"status":"<job status>"}`, after which the stream closes.

A finished job's stream sends all lines and then `end` at once.

**Grading routes.** These exist only when `SPUR_GRADING=1`, need no session, and answer 404 otherwise.

`POST /api/grading/seed` creates everything in one transaction. On error it is 422 `validation` and nothing is written. Every section is optional, every `key` is a name you choose for the response map, and references use those keys or paths. Seeding bypasses protection, push rules, approvals and rate limits. It creates no pipelines except those listed and no live messages before the response.

```json
{
  "users": [{"username": "ana", "password": "pass-1234", "time_zone": "UTC"}],
  "groups": [{"key": "g1", "path": "acme/apps", "visibility": "private",
              "members": [{"username": "ana", "role": "owner"}, {"username": "ben", "custom_role": "rc"}]}],
  "custom_roles": [{"key": "rc", "group": "acme", "name": "release-captain", "base": "developer", "permissions": ["approve"]}],
  "group_labels": [{"group": "acme", "name": "priority::high", "description": ""}],
  "epics": [{"key": "e1", "group": "acme", "title": "Exports", "parent": null, "author": "ana", "issues": ["p1/i1"]}],
  "projects": [{
    "key": "p1", "group": "acme/apps", "slug": "shop", "visibility": "private", "default_branch": "main",
    "members": [{"username": "cy", "role": "developer"}],
    "settings": {"merge_method": "merge_commit", "merge_trains": false, "pipelines_must_succeed": false,
                 "reset_approvals_on_push": true, "author_can_approve": false, "auto_resolve_outdated": false},
    "protected_branches": [{"name": "main", "allowed_to_push": "maintainer", "allowed_to_merge": "developer"}],
    "protected_tags": [{"name": "v*", "allowed_to_create": "maintainer"}],
    "push_rules": {"branch_name": null, "commit_message": null, "forbidden_files": [], "required_files": [], "secrets": false},
    "approval_rules": [{"name": "Backend", "required": 1, "users": ["ben"], "groups": []}],
    "protected_environments": [{"name": "production", "roles": "maintainer", "approvals": 1}],
    "variables": {"DEPLOY_TARGET": "blue"},
    "commits": [{"key": "c1", "branch": "main", "start_ref": null, "as": "ana", "timestamp": 1767225600,
                 "message": "First commit", "actions": [{"action": "create", "path": "README.md", "content": "hello\n"}]}],
    "tags": [{"name": "v0.1.0", "commit": "c1", "message": "First tagged build.", "as": "ana"}],
    "labels": [{"name": "workflow::doing", "description": ""}],
    "milestones": [{"key": "m1", "title": "Sprint 1", "start": "2026-01-05", "due": "2026-01-16", "time_zone": "UTC"}],
    "issues": [{"key": "i1", "title": "Export fails", "author": "ana", "description": "", "labels": ["priority::high"],
                "assignees": [], "milestone": "m1", "weight": 3, "confidential": false, "state": "opened"}],
    "merge_requests": [{"key": "mr1", "title": "Add export", "source": "feat/export", "target": "main", "author": "cy",
                        "description": "Closes #1", "assignees": [], "reviewers": ["ben"], "delete_source_branch": true,
                        "state": "opened", "approvals": ["ben"],
                        "threads": [{"key": "t1", "author": "ben", "body": "Rename this.", "path": "src/app.ts",
                                     "old_line": null, "new_line": 2, "end_line": null, "resolved": false}]}],
    "pipelines": [{"key": "pl1", "ref": "main", "commit": "c1", "jobs": {"build": "success"}}],
    "train": [{"target": "main", "requests": ["mr1"]}],
    "boards": [{"key": "b1", "name": "Development", "kind": "label", "lists": ["workflow::doing", "workflow::review"]}],
    "wiki": [{"slug": "home", "title": "Home", "content": "# Home", "author": "ana"}],
    "webhooks": [{"key": "w1", "url": "http://127.0.0.1:4173/api/grading/sink/w1", "secret": "s3cret-value", "events": ["push"]}]
  }]
}
```

Seed field rules:
- `role` is one of `guest`, `reporter`, `developer`, `maintainer`, `owner`. A member has either `role` or `custom_role`.
- A group's parent is its path minus the last segment, and the parent must come earlier in the list.
- Commits apply in order. A new `branch` needs `start_ref`, and the first commit of an empty repository creates the default branch.
- Seeded merge requests get iids in list order and version 1 at their current source head. `state` is `opened`, `closed` or `merged`; seeding `merged` moves no refs.
- A seeded pipeline is built from the config at that commit. Each listed job gets the given final status, with a log of a single line, `Job finished: <status>`. The other jobs start as they would at creation.
- `train` builds cars in list order as if each request had been added (merge trains are switched on for that project).
- `group_labels`, `epics` and `custom_roles` name groups by path. `epics.issues` name issues as `<project key>/<issue key>`.

`POST /api/grading/seed` responds with 201:

```json
{"users": {"ana": {"id": 1}},
 "groups": {"g1": {"id": 2, "path": "acme/apps"}},
 "custom_roles": {"rc": {"id": 1}},
 "epics": {"e1": {"id": 1, "iid": 1}},
 "projects": {"p1": {"id": 3, "path": "acme/apps/shop",
   "commits": {"c1": "<64 hex>"},
   "merge_requests": {"mr1": {"id": 9, "iid": 1}},
   "threads": {"t1": {"id": 5}},
   "issues": {"i1": {"id": 4, "iid": 1}},
   "milestones": {"m1": {"id": 2}},
   "labels": {"workflow::doing": {"id": 5}},
   "pipelines": {"pl1": {"id": 7, "jobs": {"build": 11}}},
   "train": {"mr1": {"position": 1, "sha": "<64 hex>", "pipeline_id": 8}},
   "boards": {"b1": {"id": 1, "lists": {"workflow::doing": 3, "Open": 1, "Closed": 2}}},
   "environments": {"production": {"id": 1}},
   "wiki": {"home": {"version": 1}},
   "webhooks": {"w1": {"id": 1}},
   "seq": 12}}}
```

The other grading routes:

| Route | Request | Response |
|---|---|---|
| `POST /api/grading/session` | `{"username":"ana"}` | 200 `{"user":{"id","username"}}`, setting `spur_session` for the calling browser context |
| `POST /api/grading/clock` | `{"set_ms":<epoch ms>}` or `{"advance_ms":<ms>}` | 200 `{"now_ms":<n>,"now":"<ISO>"}`. Every server deadline that has now passed applies at once and is broadcast live |
| `POST /api/grading/commit` | `{"project":<id>,"branch","start_ref"?,"base_commit","as":"<username>","timestamp":<unix seconds>,"message","actions":[…]}` | The same result and errors as the commit API acting as `as`, with author and committer time `timestamp`: 201 `{"commit":"<id>","seq":<n>,"pipeline":{…}}` |
| `POST /api/grading/runner/step` | `{"project":<id>,"count":<n>}` | 200 `{"rounds":<n>,"jobs":[{"id","name","status"}],"seq":<n>}` after n scheduler rounds |
| `POST /api/grading/runner/settle` | `{"project":<id>}` | Runs rounds until a round changes nothing (at most 500), then the same body as step |
| `POST /api/grading/storage` | `{"down":true}` or `{"down":false}` | 200 `{"storage":"down"}` or `{"storage":"up"}`. While down, every file storage call behaves as unreachable, without a restart |
| `POST /api/grading/sink/<name>?status=<code>` | Any body | Records the request (lower-case headers and raw body) and answers with `status` (default 200), or with the stored status |
| `PUT /api/grading/sink/<name>` | `{"status":<code>}` | 200, and later requests to this sink answer with that status |
| `GET /api/grading/sink/<name>` | — | 200 `{"requests":[{"headers":{…},"body":"<raw>","received_at_ms":<server clock>}]}` |

When `SPUR_GRADING=1`, the server clock starts at `2026-01-01T00:00:00Z` and moves only through the clock route. Scheduler rounds run only through the runner routes.

**Accounts.**

| Method and path | Request | Success | Errors |
|---|---|---|---|
| `POST /api/users` | `{"username","password"}` | 201 `{"user":{"id","username","time_zone":"UTC"}}`, signed in | 409 `username_taken`; 422 |
| `POST /api/session` | `{"username","password"}` | 200 `{"user":{…}}`, sets the cookie | 401 `bad_credentials` |
| `DELETE /api/session` | — | 204, cookie cleared | |
| `GET /api/me` | — | 200 `{"user":{…}}` | |
| `PATCH /api/me` | `{"time_zone":"Europe/Berlin"}` | 200 `{"user":{…}}` | 422 |

**Groups and projects.**

| Method and path | Request | Success |
|---|---|---|
| `POST /api/groups` | `{"name","parent":<group id or null>,"visibility"}` | 201 `{"id","path"}` |
| `GET /api/groups/<id>` | — | 200 group, subgroups, projects, members with `effective_role` |
| `PATCH /api/groups/<id>` | `{"visibility"}` | 200 |
| `POST /api/groups/<id>/members` | `{"username","role"}` or `{"username","custom_role":<id>}` | 201 |
| `PATCH /api/groups/<id>/members/<username>`, `DELETE …` | `{"role"}` or `{"custom_role"}` | 200 / 204 |
| `POST /api/groups/<id>/custom_roles` | `{"name","base","permissions":[…]}` | 201 `{"id"}` |
| `POST /api/groups/<id>/labels`, `POST /api/projects/<id>/labels` | `{"name","description"}` | 201 `{"id"}` |
| `POST /api/projects` | `{"group":<id>,"slug","visibility","default_branch"}` | 201 `{"id","path"}` |
| `GET /api/projects/<id>` | — | 200 project, `default_branch`, settings, `my_role`, `my_permissions` |
| `PATCH /api/projects/<id>/settings` | Any of `merge_method`, `merge_trains`, `pipelines_must_succeed`, `reset_approvals_on_push`, `author_can_approve`, `auto_resolve_outdated`, `default_branch`, `visibility` | 200 settings |
| `POST/PATCH/DELETE /api/projects/<id>/members[/<username>]` | As for groups | 201 / 200 / 204 |
| `PUT /api/projects/<id>/protected_branches/<pattern>`, `DELETE …` | `{"allowed_to_push","allowed_to_merge"}` | 200 / 204 |
| `PUT /api/projects/<id>/protected_tags/<pattern>`, `DELETE …` | `{"allowed_to_create"}` | 200 / 204 |
| `PUT /api/projects/<id>/push_rules` | `{"branch_name","commit_message","forbidden_files","required_files","secrets"}` | 200 |
| `POST /api/projects/<id>/approval_rules`, `PATCH`/`DELETE …/<rule id>` | `{"name","required","users","groups"}` | 201 / 200 / 204 |
| `PUT /api/projects/<id>/variables/<key>`, `DELETE …` | `{"value"}` | 200 / 204 |
| `PUT /api/projects/<id>/protected_environments/<name>`, `DELETE …` | `{"roles":"<minimum role>","approvals":<n>}` | 200 / 204 |

Patterns in paths are URL-encoded.

**Repository.**

| Method and path | Request | Success |
|---|---|---|
| `GET /api/projects/<id>/refs` | — | 200 `{"branches":[{"name","commit","protected"}],"tags":[{"name","commit","message"}]}` |
| `POST /api/projects/<id>/branches`, `DELETE …/branches/<name>` | `{"name","ref"}` | 201 / 204 |
| `POST /api/projects/<id>/tags` | `{"name","ref","message"}` | 201 |
| `GET /api/projects/<id>/tree?ref=&path=` | — | 200 `{"id","entries":[{"name","mode","id","type":"blob\|tree"}]}` |
| `GET /api/projects/<id>/files?ref=&path=` | — | 200 `{"path","blob","size","content"}` |
| `GET /api/projects/<id>/commits?ref=&path=` | — | 200 `{"commits":[{"id","parents","author","authored_at","committer","committed_at","message"}]}` |
| `GET /api/projects/<id>/commits/<id>` | — | 200 commit with `tree` and `diffs` |
| `GET /api/projects/<id>/blame?ref=&path=` | — | 200 `{"lines":[{"line","commit","author","text"}]}` |
| `GET /api/projects/<id>/compare?from=&to=` | — | 200 `{"merge_base","commits":[…],"diffs":[{"path","old_path","status":"added\|modified\|deleted\|moved","hunks":[{"header","lines":[{"type":"context\|add\|del","old","new","text"}]}]}]}` |
| `POST /api/projects/<id>/commits` | `{"branch","start_ref"?,"base_commit","message","actions":[{"action":"create\|update\|delete\|move","path","content","previous_path"}]}` | 201 `{"commit","seq","pipeline":{"id"}\|{"created":false,"reason"}}` |

**Merge requests.** All paths are under `/api/projects/<id>/merge_requests`.

| Method and path | Request | Success |
|---|---|---|
| `POST` | `{"title","source","target","description","assignees","reviewers","delete_source_branch"}` | 201 `{"iid","seq"}` |
| `GET /<iid>` | — | 200 `{"iid","title","state","draft","author","source","target","description","source_head","target_head","merge_base","versions":[{"number","base","head","start"}],"checks":[{"name","state","text"}],"approvals":{"rules":[{"name","kind":"rule\|owners\|security","required","given","optional"}],"approved_by":[…]},"owners_problems":[…],"head_pipeline":{"id","status"}\|null,"train":{"position","sha","pipeline_id"}\|null,"auto_merge":false,"closes":[<iid>…],"viewing":[…]}` |
| `PATCH /<iid>` | Any of `title`, `description`, `target`, `assignees`, `reviewers`, `state_event` (`close`, `reopen`, `ready`) | 200 |
| `GET /<iid>/diff?from=&to=` | — | 200 compare body |
| `GET /<iid>/threads` | — | 200 `{"threads":[<thread>…]}`, oldest first |
| `GET /<iid>/notes?filter=all\|comments\|history` | — | 200 `{"notes":[<note>…]}`, oldest first. It lists every thread note and system note of the request. `filter` defaults to `all`; `comments` keeps notes with `system` false, and `history` keeps only system notes |
| `POST /<iid>/threads` | `{"body","position":{"path","old_line","new_line","end_line","version"}\|null,"pending":false}` | 201 `{"id","seq"}` |
| `POST /<iid>/threads/<tid>/notes` | `{"body"}` | 201 |
| `PATCH /<iid>/threads/<tid>` | `{"resolved":true\|false}` | 200 |
| `POST /<iid>/threads/move_to_issue` | — | 201 `{"issue_iid","moved"}` |
| `POST /<iid>/review` / `DELETE /<iid>/review` | `{"summary"}` | 200 `{"published":<n>,"seq"}` / 204 |
| `POST /<iid>/suggestions/apply` | `{"ids":[<suggestion id>…]}` | 201 `{"commit","seq"}` |
| `POST /<iid>/approve` / `DELETE /<iid>/approve` | `{"sha"}` | 200 approvals |
| `POST /<iid>/merge` | `{"sha"}` | 200 `{"state":"merged","merge_commit","seq"}` |
| `POST /<iid>/auto_merge` / `DELETE /<iid>/auto_merge` | `{"sha"}` | 200 |
| `POST /<iid>/rebase` | — | 200 `{"source_head","seq"}` |
| `GET /<iid>/conflicts` / `POST /<iid>/conflicts` | `{"files":[{"path","hunks":["ours\|theirs",…]}\|{"path","content"}]}` | 200 / 201 `{"commit","seq"}` |
| `POST /<iid>/train` / `DELETE /<iid>/train` / `POST /<iid>/train/merge_now` | — | 201 / 200 / 200, train body |
| `GET /<iid>/reports` | — | 200 `{"tests","coverage","quality","security"}` |

| Method and path | Request | Success |
|---|---|---|
| `GET /api/projects/<id>/train?target=<branch>` | — | 200 `{"target","cars":[{"iid","position","sha","pipeline_id","pipeline_status"}]}` |
| `GET /api/projects/<id>/train/<iid>/tree` | — | 200 `{"sha","tree","files":{"<path>":"<content>"}}` |
| `PATCH /api/projects/<id>/findings/<finding id>` | `{"state","reason"}` | 200 `<finding>` |

**Object shapes** used in these tables:
- `<note>`: `{"id","author":"<username>","body","system":<boolean>,"pending":<boolean>,"thread_id":<id>|null,"created_at"}`.
  - A system note's `body` is its published text exactly.
  - A system note's `author` is the person whose action wrote it. It is `spurline-train` for train actions and `system` for server deadlines and the scheduler.
  - A system note's `thread_id` is `null`.
  - A pending note appears only to its author.
- `<position>`: `{"path","old_line":<n>|null,"new_line":<n>|null,"end_line":<n>|null,"version":<version number>}`.
  - Exactly one of `old_line` and `new_line` is set.
  - `end_line`, when set, is on the same side and greater than the start line.
  - A thread on the request itself has position `null`.
- `<thread>`: `{"id","position":<position>|null,"current_line":<n>|null,"resolved":<boolean>,"outdated":<boolean>,"notes":[<note>…],"suggestions":[<suggestion>…]}`.
  - `position` is where the thread was made.
  - `current_line` is its start line mapped to the latest version. It is `null` when the thread is outdated or is on the request itself.
- `<suggestion>`: `{"id","note_id","path","start_line","end_line","lines":[<text>…],"state":"open|applied|outdated"}`.
  - The line numbers are new-side numbers in the latest version.
  - `suggestions/apply` takes these `id` values.
- Reports (`GET /<iid>/reports`): `{"base_pipeline_id":<id>|null,"head_pipeline_id":<id>|null,"tests":{"text","new_failures":[<name>…],"failed","passed","skipped"},"coverage":{"text","head":<n>|null,"base":<n>|null},"quality":{"text","new":[<fingerprint>…],"resolved":[<fingerprint>…]},"security":{"text","findings":[<finding>…]}}`.
  - Each `text` is exactly what its region shows, as defined in Business rules.
  - Counts and lists are `0` and empty when there is no report.
- `<finding>`: `{"id":<finding id>,"report_id":"<id from the security report>","severity","title","path","line","state":"detected|confirmed|dismissed|resolved","reason":<text>|null}`. The findings route takes this `id`.

**Pipelines and jobs.**

| Method and path | Request | Success |
|---|---|---|
| `POST /api/projects/<id>/pipelines` | `{"ref","variables":{}}` | 201 `{"id","seq"}` |
| `GET /api/projects/<id>/pipelines?ref=` | — | 200 list |
| `GET /api/pipelines/<id>` | — | 200 `{"id","ref","sha","source","status","errors":[…],"stages":[{"name","status"}],"jobs":[{"id","name","stage","status","attempt","retried","failure_reason","layer","row","x","y","needs","started_at","finished_at","start_at"}]}` |
| `POST /api/pipelines/<id>/retry`, `POST …/cancel` | — | 200 |
| `POST /api/projects/<id>/ci/lint` | `{"content","ref","variables":{},"changed_files":[]}` | 200 `{"valid","errors":[…],"summary","jobs":[{"name","stage","variables":{}}]}` |
| `GET /api/jobs/<id>` | — | 200 job with `log_sealed`, `artifacts":[{"path","size","expires_at","expired"}]`, `environment`, `waiting` |
| `GET /api/jobs/<id>/log` | — | 200 `{"lines":["<n> <stream> <text>",…]}` |
| `POST /api/jobs/<id>/play` | `{"variables":{}}` | 200 |
| `POST /api/jobs/<id>/retry`, `POST …/cancel` | — | 201 `{"id"}` (new attempt) / 200 |
| `GET /api/jobs/<id>/artifacts/<path>` | — | 200 file bytes |
| `POST /api/jobs/<id>/artifacts/keep` | — | 200 |

**Environments.**

| Method and path | Request | Success |
|---|---|---|
| `GET /api/projects/<id>/environments`, `GET …/environments/<env id>` | — | 200 `{"id","name","tier","state","auto_stop_at","deployments":[{"id","number","status","sha","pipeline_id","approvals":[{"user","status","expires_at","expired"}],"required"}]}` |
| `POST /api/projects/<id>/deployments/<deployment id>/approvals` | `{"status":"approved\|rejected"}` | 200 deployment |
| `POST /api/environments/<id>/stop`, `POST …/keep` | — | 200 |
| `POST /api/environments/<id>/rollback` | `{"deployment":<number>}` | 201 `{"number","seq"}` |
| `GET /api/projects/<id>/metrics?zone=&days=` | — | 200 `{"deployment_frequency","lead_time_hours","change_failure_rate","recovery_time_hours"}` (numbers or `null`) |

**Planning.**

| Method and path | Request | Success |
|---|---|---|
| `POST /api/projects/<id>/issues` | `{"title","description","labels","assignees","milestone","weight","confidential","due_date"}` | 201 `{"iid","seq"}` |
| `GET`/`PATCH /api/projects/<id>/issues/<iid>` | Same fields plus `state_event`, `estimate`, `add_labels`, `remove_labels` | 200 |
| `POST /api/projects/<id>/issues/<iid>/notes` | `{"body"}` | 201 `{"note","results":[…],"seq"}`. `results` lists the quick-action result texts in order |
| `GET /api/projects/<id>/issues/<iid>/notes` | — | 200 `{"notes":[<note>…]}`, oldest first: every comment and system note of the issue |
| `POST /api/projects/<id>/issues/<iid>/links` | `{"target":"#<iid>","kind":"relates\|blocks\|blocked by"}` | 201 |
| `POST /api/projects/<id>/milestones` | `{"title","start","due","time_zone"}` | 201 |
| `GET /api/projects/<id>/milestones/<id>/burndown` | — | 200 `{"points":[{"day","remaining","future"}]}` |
| `POST /api/groups/<id>/epics`, `PATCH …/epics/<iid>` | `{"title","description","parent"}` | 201 / 200 |
| `GET /api/groups/<id>/epics/<iid>` | — | 200 `{"iid","title","description","author","state":"opened\|closed","confidential","parent":<epic iid>\|null,"children":[{"iid","title"}…],"issues":[{"project":"<path>","iid","title","milestone":<title>\|null}…],"labels":[…],"start_date":"YYYY-MM-DD"\|null,"due_date":"YYYY-MM-DD"\|null,"notes":[<note>…]}`. Issues and children are filtered by the viewer's access, and the dates come from all of the epic's issues |
| `POST /api/groups/<id>/epics/<iid>/issues` | `{"issue":<issue id>}` | 201 |
| `POST /api/projects/<id>/boards`, `POST /api/groups/<id>/boards` | `{"name","kind":"label\|assignee\|milestone","lists":[…]}` | 201 `{"id","lists"}` |
| `GET /api/boards/<id>?label=&assignee=&milestone=&search=` | — | 200 `{"lists":[{"id","title","count","cards":[{"issue","iid","title","weight","labels","version","position"}]}]}` |
| `POST /api/boards/<id>/moves` | `{"issue":<issue id>,"to_list":<list id>,"after_id":<issue id>\|null,"version":<n>}` | 200 `{"card","lists":[{"id","issue_ids":[…]}],"notes":[<text>…],"seq"}` |

**Wiki, webhooks, audit, search, export.**

| Method and path | Request | Success |
|---|---|---|
| `GET`/`PUT /api/projects/<id>/wiki/<slug>` | `{"title","content","base_version"}` (`base_version` is `0` for a new page) | 200 `{"slug","version","title","content","html"}` |
| `GET /api/projects/<id>/wiki/<slug>/versions`, `POST …/restore` | `{"version"}` | 200 / 201 |
| `POST /api/projects/<id>/webhooks` | `{"url","secret","events":[…]}` | 201 `{"id"}` |
| `GET /api/projects/<id>/webhooks/<id>/deliveries` | — | 200 `{"deliveries":[{"id","event","attempts":[{"number","status_code","at"}],"state":"pending\|delivered\|failed","next_at"}]}` |
| `POST /api/deliveries/<id>/redeliver` | — | 201 `{"id"}` |
| `GET /api/projects/<id>/audit`, `GET /api/groups/<id>/audit` | — | 200 `{"events":[{"id","actor","action","target","before","after","at"}]}` |
| `GET /api/search?scope=code\|issues\|requests\|wiki&q=` | — | 200 `{"count","results":[…]}` |
| `POST /api/projects/<id>/exports` | — | 202 `{"id","seq"}` |
| `GET /api/exports/<id>` / `GET /api/exports/<id>/file` | — | 200 `{"status":"running\|finished\|failed","progress","error","download"\|null}` / file bytes |
| `POST /api/groups/<id>/imports?slug=<slug>` | Raw `.spurpack` text | 200 `{"id","preview":{"commits","issues","requests"}}` |
| `POST /api/imports/<id>/confirm` / `GET /api/imports/<id>` | — | 202 `{"project","seq"}` / 200 status |

Any method other than GET on an audit path answers 405.

### Business rules (DP-04, DP-11 to DP-46)

Every published value on a screen comes from the server. The device clock may be wrong by hours, so the browser never decides from its own clock whether an approval has expired, a job may start, an artifact has expired, an environment has stopped or a train car has timed out. It shows the status and times the server returns. Server deadlines run on the server clock, which in grading mode moves only through the clock route.

When writes race, the one the database commits first wins. Every later write made on the same stale base, card version or page version gets its published 409. Exactly one of N simultaneous commits on one base succeeds.

#### Roles and access (DP-38, DP-39)

**Groups.** Group paths are segments of 2 to 40 characters from `a-z 0-9 -`, joined by `/`, and nest up to 4 levels. Deeper is 422 with `Groups can only nest 4 levels.` Visibility is `private`, `internal` (any signed-in user) or `public` (any signed-in user; there is no anonymous access). A child can't be more visible than its parent: 422 `visibility`, `Visibility can't exceed the parent group's: <value>.`

**Roles.** Role levels are guest 10, reporter 20, developer 30, maintainer 40 and owner 50. A person's effective role in a project is the highest of their direct project membership and their direct or inherited group memberships. A custom role has a base role plus permissions from this list:
- `push_protected`: push to any protected branch;
- `approve`: approve merge requests as if a developer;
- `manage_environments`: edit environment protection and stop or keep environments;
- `dismiss_finding`;
- `admin_board`: create and edit boards and lists;
- `read_audit`.

A non-member of an internal or public project reads it as a reporter but may only create issues and comment on them. This implied read access never counts as reporter for confidential issues: a non-member sees only the confidential issues they authored or are assigned to. Removing a member from a group removes their inherited access to everything below it at once.

**Minimum role per action.** The server refuses every action below its minimum with 403, even when called directly:

| Action | Minimum |
|---|---|
| Read issues, boards, milestones, epics and wiki; comment on issues | guest |
| Read code, merge requests, pipelines, jobs, environments and metrics; comment on merge requests; create issues; move board cards; edit issue labels, assignees, milestones and weights | reporter |
| Commit to unprotected branches; create, edit and rebase merge requests; apply suggestions; run, retry, cancel and play jobs; edit the wiki; approve merge requests (when eligible) | developer, or `approve` for approving |
| Merge into a protected branch | its `allowed_to_merge` |
| Push to a protected branch | its `allowed_to_push`, or `push_protected` |
| Create a protected tag | its `allowed_to_create` |
| Settings, protection, push rules, approval rules, variables, webhooks, labels, `Merge now`, add to train for others, dismiss findings, board lists, environment protection, stop and keep | maintainer, or the matching custom permission |
| Approve a protected deployment | the environment's `roles` minimum |
| Group members and custom roles, visibility, export and import, read audit | owner, or `read_audit` for reading audit |

**Live role changes.** A role change reaches each open page of that person in the affected projects live. Controls they may no longer use leave the page. If focus was on one of them, focus moves to `<main>`. The page announces `Your role in <path> is now <role>.` When the person loses read access, the page replaces its content with `You no longer have access to <path>.` and announces it.

**Audit.** Each change in the table below writes exactly one audit event. Each event holds:
- `actor`: the username, or `system` when a server deadline or the scheduler caused it;
- `action`, `target`, `before` and `after`, as in the table;
- `at`: the server time.

Audit events are permanent, and seeding writes none. Viewing them needs owner or `read_audit`. Events list newest first. A project's audit lists events whose target is in that project. A group's audit lists that group's memberships, custom roles and visibility.

| Change | `action` | `target` | `before` and `after` |
|---|---|---|---|
| A member added, changed or removed in a group or project | `member.add`, `member.update`, `member.remove` | `<group or project path>:<username>` | `{"role":"<role>"}` or `{"custom_role":"<name>"}`; `before` is `null` for an add and `after` is `null` for a removal |
| A custom role created | `custom_role.create` | `<group path>:<role name>` | `null`, then `{"base":"<role>","permissions":[…]}` |
| Group visibility | `group.visibility` | `<group path>` | `{"visibility":"<value>"}` |
| Project settings, including visibility and default branch | `project.settings` | `<project path>` | Only the changed keys, with old and new values, for example `{"merge_trains":false}` then `{"merge_trains":true}` |
| A protected branch set or removed | `protected_branch.set`, `protected_branch.remove` | `<project path>:<pattern>` | `{"allowed_to_push","allowed_to_merge"}`, or `null` |
| A protected tag set or removed | `protected_tag.set`, `protected_tag.remove` | `<project path>:<pattern>` | `{"allowed_to_create"}`, or `null` |
| Push rules | `push_rules.update` | `<project path>` | The whole push rules object as in API |
| An approval rule | `approval_rule.create`, `approval_rule.update`, `approval_rule.delete` | `<project path>:<rule name>` | `{"name","required","users","groups"}`, or `null` |
| A merge request approval given or revoked | `approval.add`, `approval.remove` | `<project path>!<iid>` | `null` and `{"user":"<username>"}`, in that order for an add and reversed for a removal |
| A deployment's status | `deployment.status` | `<project path>:<environment>#<number>` | `{"status":"<old>"}` then `{"status":"<new>"}`; `before` is `null` at creation |
| A deployment approval or rejection | `deployment.approval` | `<project path>:<environment>#<number>` | `null`, then `{"user":"<username>","status":"approved\|rejected"}` |
| Environment protection | `protected_environment.set`, `protected_environment.remove` | `<project path>:<environment>` | `{"roles","approvals"}`, or `null` |
| A project variable | `variable.set`, `variable.remove` | `<project path>:<key>` | `{"value":"<value>"}`, or `null` |
| A finding's state | `finding.state` | `<project path>!<iid>:<report id>` | `{"state":"<old>"}`, then `{"state":"<new>","reason":<text or null>}` |

#### Repository model (DP-41)

- Text is UTF-8. A file that isn't UTF-8 is 422 `File <path> is not UTF-8 text.`
- Blob id: `sha256("blob <byte length>\n" + bytes)`, in lower-case hex.
- Tree id: `sha256("tree\n" + entries)`. Each entry is `<mode> <name> <id>\n`, with mode `100644` for a file and `040000` for a tree, sorted by name as UTF-8 bytes. A tree with no entries hashes `tree\n`.
- Commit id: `sha256` of the UTF-8 text `commit\ntree <tree>\n`, then one `parent <id>\n` per parent in order, then `author <username> <unix seconds>\ncommitter <username> <unix seconds>\n\n<message>`. The message has trailing whitespace removed before hashing and storing.
- Worked example: file `README.md` containing `hello\n` is blob `de5777551c59cba3dac8b9831f889bab03ece9824236e20616ac48bbefdc5594`. The root tree of only that file is `d0604e08d4be0b90d067bc3f6f5d0d3fc5000d1822a8a487d4db71b94690e941`. A first commit by `asha` at 1767225600, for both author and committer, with message `First commit` is `2fb8c1cda9fb9f60c6a31ab386849d1e1f88d512c877f639f59e90e8c808ba65`.
- Commits made by people use the server clock in whole seconds.
- **Merge base:** walk breadth-first from `to`, visiting each commit's parents in order (first parent first). The first visited commit that is also reachable from `from` is the merge base.
- **History:** walk first parents from the ref's head. With `path`, list only commits where that path's blob differs from the first parent's, newest first.
- **Blame:** walk first-parent history from the head. A line belongs to the oldest commit on that chain after which the diff rule leaves it unchanged all the way to the head.

**The commit API.**
- One request is one commit: every action applies or none do.
- `base_commit` must equal the branch head, or the head of `start_ref` for a new branch. Otherwise it is 409 `stale_base`: `Your base commit <short> is behind <branch> at <short>. Refresh and try again.`
- In an empty repository, the first commit sends `base_commit` as `null` with no `start_ref`, and it creates the named branch. `null` is accepted only while that branch (or `start_ref`) doesn't exist. A `null` base against an existing branch, or a commit id against a missing one, gets the same 409, with `none` in place of the missing short id.
- Path errors are 422 `validation`: `File <path> already exists.`, `File <path> does not exist.`
- A file larger than `SPUR_FILE_MAX_BYTES` bytes is 413 `payload_too_large`: `File <path> is too large (<max> bytes at most).` A file of exactly the limit is allowed.
- The commit message must not be blank: `Commit message can't be blank.`
- A commit is a push to its branch. It creates a pipeline (pipeline rules), a version and its consequences (versions rules), and a `push` webhook.

The web editor uses the same API with the same results.

#### Diff and merge (DP-12, DP-21)

**Diff.** Split text on `\n`. A final empty piece after a trailing newline is not a line, and whether a file ends with a newline makes no difference to the diff. The diff is a minimal line diff by longest common subsequence. Within a changed block, deletions print before additions. Hunks keep 3 context lines, and two hunks join when their context would touch or overlap. Hunk headers are `@@ -a,b +c,d @@`, where a and c are the first line numbers and b and d are the line counts; with a count of 0, the number is the line before. Tests use only cases where every minimal diff gives the same result. Expanding context adds 20 more lines above or below, up to the file's ends.

**Three-way merge.** Each side's changes are taken against the base as line ranges:
- Changes that neither overlap nor touch both apply.
- The same change on both sides applies once.
- Overlapping or touching changes conflict, and are written exactly as `<<<<<<< <target branch>`, the target's lines, `=======`, the source's lines, `>>>>>>> <source branch>`, each on its own line.
- A file added on both sides with different content, or deleted on one side and changed on the other, conflicts as a whole file.

**Merge methods** (project setting `merge_method`, default `merge_commit`). The person who merges is author and committer at the server clock unless stated otherwise:
- `merge_commit`: parents are the target head, then the source head. The tree is the three-way merge. The message is `Merge branch '<source>' into '<target>'\n\n<title>\n\nSee merge request !<iid>`.
- `squash`: one parent, the target head, and the tree of the merge. The message is `<title> (!<iid>)`.
- `fast_forward`: moves the target to the source head without a new commit. It is allowed only when the target head is an ancestor of the source head.
- `rebase`: like `merge_commit`, allowed only when the target head is an ancestor of the source head.

**Rebase.** `button "Rebase"` shows whenever the target head is not an ancestor of the source head. It replays each source commit after the merge base, in order, onto the target head. Each replayed commit keeps its original author and author time, with the rebasing person as committer at the server clock. Each replayed commit passes protection and push rules. A conflict stops the rebase with nothing changed: 409 `rebase_conflict`, `Rebase stopped at <short>: <path> conflicts.` (the first conflicting path by path order). A rebase is a push.

**Conflict resolution page.**
- Each conflicting file offers `Use ours` (target) or `Use theirs` (source) per hunk, or `Edit inline` with the full marked text in `textbox "Conflict editor"`.
- A resolution that still contains a line starting with `<<<<<<< `, `=======` or `>>>>>>> ` is 422 `conflict_markers`: `Remove all conflict markers before committing.`
- Committing makes one merge commit on the source branch, with parents source head then target head, and message `Resolve conflicts with <target>`. This is a push.

**Merging.**
- `sha` must equal the source head, otherwise 409 `stale_head`: `The source branch changed. Review the new commits and try again.`
- A merged request can't be merged, closed or reopened: 409 `wrong_state`, `This merge request is already merged.`
- `Mark as ready` on a request that isn't a draft: 409 `wrong_state`, `This merge request isn't a draft.`
- A merge updates the target ref, creates a target push pipeline, writes the note `Merged by @<username> into <target>.`, and deletes the source branch when the request's `delete_source_branch` is on.
- The project home's `Pipelines passed` is the percent, with no decimals, of the last 20 finished pipelines on the default branch that succeeded, or `—` when there are none. `Open merge requests` and `Open issues` count only what the viewer may read.

#### Protection and push rules (DP-42)

Protected branches and tags are matched by name or by a pattern where `*` matches any characters. The default branch is protected at project creation with push `maintainer` and merge `developer`. Protected branches can't be deleted.

- A refused direct commit: 403 `protected_branch`, `You can't push to protected branch <name>.`
- A refused merge: 403 `protected_branch`, `You can't merge into protected branch <name>.`
- A delete: 403 `protected_branch`, `You can't delete protected branch <name>.`
- A protected tag: 403 `protected_tag`, `You can't create protected tag <name>.`

**Push rules** apply to every commit from the editor, the commit API, the grading commit route, suggestions, merges, conflict resolutions, rebases and train cars. They run in this order, and the first failure is returned as 422 `push_rule`:
1. Branch name pattern (new branches only): `Branch name <name> doesn't match <pattern>.`
2. Commit message pattern: `Commit message doesn't match <pattern>.`
3. Forbidden file globs, on files added or changed: `File <path> is forbidden by push rule <glob>.`
4. Required files, in the resulting tree: `Required file <path> is missing.`
5. Secrets on added lines (against the first parent), by path and then by line: `Secret found: <pattern name> in <path> at line <n>.`

Patterns are regular expressions in the ECMAScript dialect. The secret list:
- `cloud-key`: `AK[A-Z0-9]{18}`
- `private-key`: `-----BEGIN [A-Z ]*PRIVATE KEY-----`
- `spur-token`: `sptk_[A-Za-z0-9]{20}`
- `password-line`: `password\s*=\s*"[^"]{8,}"`, ignoring case

The verdict for the same commit is the same from every route. A protection or push-rule verdict is written once, in the same transaction as the ref update or refusal.

#### Merge requests, threads and review (DP-13, DP-15, DP-16, DP-17, DP-22)

**Titles and state.**
- A title has 1 to 255 characters: `Title can't be blank.`, `Title is too long (255 characters at most).`
- A title starting `Draft: ` makes the request a draft. `Mark as ready` removes the prefix and writes `Marked as ready.`; adding it back writes `Marked as draft.`
- iids count per project and show as `!<iid>` for requests and `#<iid>` for issues.
- A new request's description is filled from `.spurline/request-template.md` on the target branch, when that file exists.
- States: `draft` and `open` move both ways. `open` goes to `on train` and then `merged`, or `removed` back to `open`. `open` and `closed` move both ways. `merged` is final.

**System notes.** Every change writes one system note:
- `Added <n> commits.` (singular `Added 1 commit.`)
- `Changed target from <old> to <new>.`
- `Closed.`, `Reopened.`
- `Approved by @<username>.`, `Revoked approval by @<username>.`
- `Added to merge train at position <n>.`, `Removed from merge train: <reason>.`
- `Rebased onto <target> at <short>.`
- The texts given elsewhere in these rules.

`Activity filter` shows all notes (`All activity`), only threads and comments (`Comments only`), or only system notes (`History only`).

**Threads.**
- A comment on a line (`old_line` or `new_line`) or a range (adding `end_line` on the same side) starts a thread. So does a comment on the request itself. Every thread can be resolved.
- With `pending: true`, comments belong to a review that only their author sees, counted in `Pending comments: <n>`.
- Submitting a review publishes all of them as one event with the optional summary and one live message. Discarding deletes them.
- `Move to issue` creates a new issue holding each open thread quoted with its path and line, resolves those threads, and writes `Moved <n> threads to #<iid>.` (singular `Moved 1 thread to #<iid>.`).
- Mentions are `@username`.
- The `Viewing now` region lists the people with the request open. A person is removed `SPUR_PRESENCE_TIMEOUT_MS` after their socket closes, on the server clock.

**Suggestions.**
- A fenced block opened by ` ```suggestion:-a+b ` replaces the commented line, or range, plus a lines above and b lines below, with the block's lines. A bare ` ```suggestion ` means `-0+0`.
- `Apply suggestion` makes one commit `Apply suggestion to <path>`.
- A batch makes one commit `Apply <n> suggestions to <m> files`, and applying resolves each suggestion's thread.
- Refusals, checked in this order, are each 409 for the first suggestion that fails:
  - `suggestion_outdated`: `This suggestion is outdated: the lines changed.`
  - `suggestion_overlap`: `These suggestions overlap: <path> lines <a>-<b>.`
  - `suggestion_applied`: `This suggestion was already applied.`
  - `thread_resolved`: `This thread is resolved.`
- The commit passes protection and push rules and is a push.

**Versions.** Creating a request makes version 1. Every push to the source branch makes the next version, storing its base (the merge base with the target), its head, and its start commit (the target head at that moment). Compare from `Target branch` (the chosen version's base) or any version, to any version.

**Line mapping.** On a new version, take the diff between the thread's version and the new one on that file. New-side lines use the heads and old-side lines use the bases. A line in an unchanged block maps to its new number, and the shown number updates live. A line inside a changed block, or in a deleted file, makes the thread outdated (`data-outdated="true"`, label `Outdated`). A range is outdated if any of its lines is. With `auto_resolve_outdated` on, outdated threads also resolve, with the note `Resolved because the line changed.`

**One push, every consequence.** A push to a request's source branch from the editor, the commit API, the grading commit route, a suggestion, a conflict resolution or a rebase does all of the following in one transaction:
- makes the new version;
- remaps or outdates threads;
- removes all approvals when `reset_approvals_on_push` is on, with the note and announcement `Approvals reset: new commits were pushed.`;
- recalculates code-owner rules from the new changed files;
- creates the new pipeline and cancels older interruptible pipelines on that branch;
- removes the request's train car and rebuilds the cars behind it;
- cancels auto-merge.

**Stacked requests and closing.**
- A request may target another open request's source branch. It then waits for that request (check 3).
- When a request merges and its source branch is deleted, open requests targeting the deleted branch are retargeted to the merged request's target, oldest iid first, up to `SPUR_RETARGET_LIMIT`. Each gets `Retargeted from <old> to <new> because !<iid> merged.`, and the rest keep the check-2 text.
- Closing keywords `Closes #N`, `Fixes #N` and `Resolves #N` (any case) in the description, or in a commit message of the request, close those issues only when the request merges into the default branch. Each closed issue gets the note `Closed by !<iid>.`
- `region "Closing issues"` reads `Merging closes <n> issues: #<a>, #<b>.` (singular `1 issue`), or `Merging closes no issues.`

#### Code owners and approvals (DP-18, DP-19)

**Approval rules.** A rule has a name, a required count, and eligible users and groups. A group's members with developer role or higher are eligible. Rules apply when the target branch is protected.

**Owners file.** `.spurline/OWNERS` is read from the target branch.
- Sections are `[Name]`, `[Name][<count>]` (default count 1), or `^[Name]` (optional: shown, but needs nothing). Lines before the first section belong to section `Owners`.
- Owner lines are `<glob> @user @group/path`.
- Globs: `*` matches within a segment, `**` across segments, a leading `/` anchors at the root, and a trailing `/` means anything under that folder. Otherwise a pattern matches at any depth.
- Within a section, the last matching line wins for each changed file.
- A section requires its count from the union of owners of the changed files that match it, and shows `<section>: <n> of <m>`. A section with no matching changed file doesn't apply.
- Malformed lines are ignored for matching and listed in `region "Owners problems"` as `Line <n>: <reason>`, where the reason is one of `bad section header`, `bad count`, `no owners`, `unknown user @<name>`, `unknown group @<path>`.
- Owner rules recalculate whenever the changed files change, including after a rebase.

**Approving.**
- Approving needs developer role or `approve`, eligibility for at least one rule (or any developer when no rule applies), and `sha` equal to the source head (else the `stale_head` 409).
- The author is refused unless `author_can_approve` is on: 403 `author_cannot_approve`, `Authors can't approve their own merge request.`
- A person eligible for no rule: 403 `not_eligible`, `You aren't eligible to approve this merge request.`
- An author never counts toward a rule. Every approval counts toward every rule its giver is eligible for.
- Rule order is: project rules in creation order, then owners sections in file order, then `Security review`.

#### Merge checks and auto-merge (DP-20)

Each check is `passed`, `failed` or `inactive` (it doesn't apply). The widget lists them in this order, and a blocked merge or train add returns the first failed one as 409 `merge_blocked` with its text:

1. `state`: `This merge request is closed.`
2. `target`: `Target branch <old> no longer exists.`
3. `stack`: `Waiting for !<iid> to merge.` (its target branch is another open request's source branch)
4. `draft`: `This merge request is a draft.`
5. `conflicts`: `Source branch has conflicts with <target>.`
6. `rebase`: `Source branch must be rebased onto <target>.` (applies only with `fast_forward` or `rebase`)
7. `threads`: `<n> unresolved threads must be resolved.` (singular `1 unresolved thread must be resolved.`)
8. `approvals`: `Needs <n> more approvals: <rule names, comma separated, in rule order>.` (singular `approval`), where n is the sum of missing approvals
9. `pipeline` (applies only with `pipelines_must_succeed`): `Pipeline must succeed. Latest pipeline <id> is <status>.`, or `Pipeline must succeed. No pipeline has run on <short>.`
10. `security`: `<n> security findings need review.` (singular `1 security finding needs review.`)

**Auto-merge.** `Set to auto-merge` makes the server merge as soon as every check passes. It cancels with the note and announcement `Auto-merge canceled: <reason>.`, where the reason is `new commits were pushed`, `the target branch changed`, `the merge request became a draft` or `canceled by <username>`.

#### Merge train (DP-28, DP-29)

**Joining.** With `merge_trains` on, `Add to merge train` needs every check except `pipeline` to pass, and adds a car at the end. More than `SPUR_TRAIN_MAX` cars is 409 `train_full`: `This train is full (<n> cars).`

**Speculative commits.**
- Each car has a speculative commit. Its parents are the previous car's speculative commit (or the target head for the first car), then the car's source head.
- Its tree is their three-way merge, its message is `Train merge !<iid>`, and its author and committer are `spurline-train` at the server clock when the car is built.
- Its pipeline runs on that commit, with source `train` and `CI_TRAIN=true`.
- The speculative commit is computed once per car, position and base, stored, and used by the kicker, the pipeline and the final merge.
- A car whose merge conflicts, or whose commit fails a push rule, is removed.

**Rules.**
- When the first car's pipeline succeeds, the target head becomes that car's stored speculative commit (no new commit), the request is merged, and the next car becomes first with no rebuild. A car further back that succeeds waits until it is first, then merges at once.
- A car merges only if its pipeline passed on the base that is current at merge time.
- A failed pipeline removes that car and rebuilds every car behind it on a new base. Cars ahead are untouched.
- `Remove from train` removes a car and rebuilds the cars behind it.
- `Merge now` (maintainer) merges that request by the project's merge method at once, removes its car, and rebuilds every remaining car on the new head.
- A push to a car's source branch removes that car and rebuilds the cars behind it.
- A direct push to the target (anything but a train merge) rebuilds every car on the new head.
- A rebuild cancels each affected car's old pipeline, starts a new one, and stores the new speculative id.
- A car whose pipeline hasn't finished `SPUR_JOB_TIMEOUT_MS` after it was created, on the server clock, is failed with its running jobs failed as `job_timeout`, and is removed.
- Removal reasons in the note: `pipeline <id> failed`, `pipeline <id> timed out`, `the merge conflicted with the cars ahead`, `push rule: <message>`, `new commits were pushed`, `removed by <username>`, `merged out of order`.

#### Pipeline config (DP-23)

**File and syntax.** The file is `spurline.pipeline.yml` at the root of the ref. It uses a YAML subset:
- block maps, block lists, flow lists of scalars (`[a, b]`), comments starting `#`;
- plain, single-quoted and double-quoted scalars, integers, `true`, `false`, `null`;
- no anchors, no flow maps, no multi-line scalars.

**Top-level keys** are `stages` (default `build`, `test`, `deploy`), `default`, `variables`, `include`, `workflow`, and jobs (every other key). A job name starting with `.` is a hidden template.

**Job keys:** `stage` (default `test`), `extends`, `script`, `needs`, `dependencies`, `rules`, `when`, `start_in`, `allow_failure`, `retry`, `timeout`, `interruptible`, `resource_group`, `variables`, `matrix`, `artifacts`, `cache`, `environment`.

**Durations** are an integer followed by `ms`, `s`, `m` or `h` (for example `90s`), or `never` where expiry allows it.

**Keyword reference:**
- `include: [path, …]` loads files from the same ref at the top level, later files over earlier ones, then the main file over them all.
- `extends` takes a name or a list. Merging is deep: maps merge key by key, recursively, later over earlier, and a list or scalar replaces whole. Templates apply left to right, then the job's own keys, up to 5 levels. `default` then fills only the keys a job still lacks.
- Variables, lowest to highest: predefined `CI_*`, top-level `variables`, job `variables`, the matching rule's `variables`, project variables, then variables given at a manual run or play. `$NAME` and `${NAME}` expand in up to 3 passes, an unknown name becomes empty, and `$$` is a literal `$`. Expansion applies to `script`, `environment.name`, `cache.key` and `artifacts.paths`.
- Predefined variables: `CI_PIPELINE_ID`, `CI_PIPELINE_SOURCE` (`push`, `train`, `web`), `CI_COMMIT_SHA`, `CI_COMMIT_SHORT_SHA`, `CI_COMMIT_REF_NAME`, `CI_COMMIT_BRANCH`, `CI_COMMIT_MESSAGE`, `CI_DEFAULT_BRANCH`, `CI_PROJECT_ID`, `CI_PROJECT_PATH`, `CI_JOB_ID`, `CI_JOB_NAME`, `CI_JOB_STAGE`, `CI_MERGE_REQUEST_IID`, `CI_MERGE_REQUEST_SOURCE_BRANCH_NAME`, `CI_MERGE_REQUEST_TARGET_BRANCH_NAME`, `CI_TRAIN` (`true` or empty), `CI_ENVIRONMENT_NAME`. For a branch that is the source of open requests, the merge request variables describe the lowest-iid one. For a train pipeline, `CI_COMMIT_REF_NAME` and `CI_COMMIT_BRANCH` are the target branch.
- `rules` is a list where the first match wins:
  - `if` supports `==`, `!=`, `=~ /re/` (flag `i` allowed), `&&` (binding tighter than `||`), `||`, parentheses, and a bare `$VAR` (true when not empty);
  - `changes` takes globs (owners-file glob syntax) against the changed files: for train pipelines, against the merge base with the target; for push pipelines, against the branch's head before the push (always true for a branch's first push); always true for web pipelines;
  - `exists` takes globs on the tree;
  - a rule may set `when` (adding `never`), `allow_failure`, `variables` and `start_in`.
  No match removes the job; a job without `rules` is included.
- `workflow.rules` decides the same way whether a pipeline is created: `Pipeline not created: workflow rules excluded it.` A pipeline whose rules leave no jobs: `Pipeline not created: no jobs matched.` A ref without the file creates no pipeline.
- `matrix` is a map of lists. It expands to one job per combination, named `<job> [<v1>, <v2>]`, with keys in written order and the last key changing fastest. Each value becomes a variable. `needs` on a matrix job needs every expansion.
- `needs` may point only to the same or an earlier stage, and `needs: []` starts with no wait. `dependencies` limits which artifacts are downloaded.

**Lint.** `ci/lint` and the editor's `Check config` return messages sorted by line and then text, at most 20, with 1-based lines. The line is the job's key or the offending key. `which rules removed` is judged with the request's `variables` and `changed_files`.
- **Line numbers** always refer to the main file. A problem inside an included file is reported at the line of the main file's `include` list item that loaded it, directly or through other includes.
- **Needs cycles** are reported once, at the key line of the first job in file order that is in the cycle. The path starts at that job. From each job it follows that job's first need, in written order, that lies on the cycle, until it returns to the start. Extends cycles are reported the same way, following `extends` in written order.
- **Include cycles:** includes load depth-first, in list order. When a file includes a file that is already on its loading chain, the cycle is reported once, as the file paths from that repeated file round to itself. For example: `Line 2: include cycle: ci/a.yml -> ci/b.yml -> ci/a.yml.` A main file that includes itself reads `spurline.pipeline.yml -> spurline.pipeline.yml`.
- **Unreadable lines:** `can't read this line` marks the first line that matches any of these:
  - it is not blank, a comment, `key:`, `key: value`, `- value` or `- key: value`;
  - it is indented with a tab;
  - its indentation matches no open level;
  - it has an unclosed quote;
  - it uses an anchor (`&`), an alias (`*`), a flow map (`{`) or a multi-line scalar (`|` or `>`).

  Reading stops there, and that message is the only one returned.
- `Line <n>: unknown keyword "<k>".`
- `Line <n>: job "<j>" uses stage "<s>", which isn't in stages.`
- `Line <n>: job "<j>" needs "<k>", which doesn't exist.`
- `Line <n>: job "<j>" needs "<k>", which rules removed.`
- `Line <n>: job "<j>" needs "<k>", in a later stage.`
- `Line <n>: needs cycle: a -> b -> c -> a.`
- `Line <n>: extends cycle: a -> b -> a.`
- `Line <n>: job "<j>" extends unknown "<k>".`
- `Line <n>: include "<path>" not found.`
- `Line <n>: include cycle: a -> b -> a.`
- `Line <n>: retry max can't exceed <SPUR_RETRY_MAX>.`
- `Line <n>: job "<j>" has no script.`
- `Line <n>: can't read duration "<v>".`
- `Line <n>: can't read this line.`

A valid file returns `Valid. <n> jobs in <s> stages.`, counting jobs after rules and matrix expansion, and `Expanded jobs` lists each final name, its stage and its non-`CI_` variables as `KEY=value` sorted by key. A pipeline created from an invalid file has status `failed`, no jobs, and the lint messages in `errors`.

#### Pipeline graph (DP-24)

- **Layer:** a job without `needs` has its stage index (from 0). A job with `needs` has the higher of its stage index and 1 plus the highest layer among its needs.
- **Row:** within a layer, jobs are ordered by stage index, then config order, numbered from 0.
- **Position:** `x = 40 + layer * 240`, `y = 40 + row * 96`. Each node is a 200 by 64 box at (x, y), and carries `data-job`, `data-status`, `data-x`, `data-y`, `data-layer` and `data-row`.
- **Edges:** one `<path>` per need, with `data-from` (the need) and `data-to`, and the curve `M <x1+200> <y1+32> C <x1+220> <y1+32> <x2-20> <y2+32> <x2> <y2+32>`.
- Only the latest attempt of each job is drawn.

#### Pipeline run (DP-25, DP-26, DP-27)

**When pipelines run.** Every push to a branch creates one pipeline on the new head (source `push`). A train car creates one (`train`), and `POST .../pipelines` creates one (`web`). On creation, step 4 below applies once.

**Commands** in `script`, one per list item, are the only ones that exist:
- `print <text>`
- `write <path> <text>` (writes the rest of the line plus a newline into the job's workspace)
- `wait <ms>`
- `exit <code>`
- `emit <tests|coverage|quality|security> <path>`

Anything else fails the job with `Unknown command: <text>`. Variables expand before a command runs.

The workspace holds the commit's files, downloaded artifacts, restored cache files, and files written by `write`.

**A scheduler round** (`runner/step` runs one; in production a timer runs one every second per project). A round runs these four steps in order:
1. Scheduled jobs whose `start_at` has passed become pending. Running jobs past their timeout fail.
2. Pending jobs start in order of pipeline id, stage index and config order, while the project has fewer running jobs than `SPUR_PARALLEL_LIMIT`. A resource group holds at most one running job, and the others wait in creation order. A job that starts becomes `running` and gets `started_at` from the server clock. It does its start work at once: cache restore lines, artifact downloads (an expired dependency fails it here), and `section_start script`.
3. Each running job takes exactly one turn. This includes a job that started in step 2 of this same round.
   - A job that is not waiting runs its next command. `print`, `write`, `emit` and `exit` complete in that turn. `wait <ms>` logs its line, records the server time as its wait start, and ends the turn.
   - A waiting job checks the server clock. Before its wait start plus `<ms>`, it stays waiting. At or after that time, the wait completes, and that is its whole turn. The next command runs in the next round.
   - `exit 0` finishes the script. `exit n` (not 0) fails the job with reason `script_failure`. When the command that just completed was the last one in `script`, the script has finished in this same turn.
   - A job whose script finished does its finishing work in the same turn, before step 4:
     - `section_end script`;
     - artifact upload;
     - report storing;
     - cache save;
     - the `Job finished: <status>` line;
     - sealing the log into file storage.
   - Its final status (`success`, `failed` or `warning`) is set in this turn. An artifact upload that file storage refuses makes it `failed` with reason `system_failure`. A log seal that file storage refuses is retried on later rounds and doesn't change the status.
4. Job, stage and pipeline statuses update. Jobs that have become eligible move from `created` to `pending` (or to `manual`, `scheduled` or `skipped`). An automatic retry of a job that failed in this round is created as a new `pending` attempt. Jobs made pending in step 4 start no earlier than step 2 of the next round.

**Changes outside rounds.**
- Creating a pipeline applies step 4 once, so first-stage jobs are `pending` as soon as the pipeline exists.
- These actions make the job `pending` at once, and it starts in step 2 of the next round:
  - playing a manual job;
  - retrying a job by hand;
  - approving a deployment to its required count.

**Worked example.** A push creates a pipeline with `build` (stage `build`, script `print a`) and `test` (stage `test`, script `wait 1000` then `print b`). The server clock is at T:
- **At creation:** `build` is `pending`, `test` is `created`, and the pipeline is `running`.
- **Round 1:**
  - `build` starts in step 2.
  - In step 3 it runs `print a`, which is its last command. It finishes, uploads its artifacts, seals its log and is `success`.
  - In step 4, `test` becomes `pending`.
- **Round 2:** `test` starts and runs `wait 1000`. It is `running`.
- **Round 3, with the clock still at T:** `test` is still waiting.
- **The clock advances by 1000 ms.** In round 4 the wait completes, and `test` is still `running`.
- **Round 5:** `test` runs `print b`, its last command, and is `success`. The pipeline is `success`.

**Eligibility.** All of the job's `needs` are finished, when it has `needs`. Otherwise every job in earlier stages is finished.

**`when`:**
- `on_success` (the default) needs every one of them successful, or failed but allowed to fail.
- `on_failure` needs at least one failed.
- `always` runs regardless.
- `manual` waits for `Play <job>`. It blocks later stages when `allow_failure: false`, and doesn't block by default. An unplayed non-blocking manual job counts as finished for stage order, but not for `needs`.
- `delayed` becomes `scheduled` with `start_at` equal to the server time at eligibility plus `start_in`. The page shows `Starts at <time>` from the server.

A job whose condition can no longer hold becomes `skipped`.

**Statuses** are `created`, `pending`, `running`, `success`, `failed`, `canceled`, `skipped`, `manual` and `scheduled`, plus `warning` for a failed job with `allow_failure: true`. A job row's duration reads `not started`, `in progress`, `<s>s`, or `<m>m <s>s`, from server times.

**Rollup** for a stage or pipeline, taking the first rule that matches and ignoring retried attempts:
1. All `created` gives `created`.
2. Any `running`, `pending` or `created` gives `running`.
3. A blocking `manual` with nothing running gives `blocked`.
4. Any `failed` gives `failed`.
5. Any `canceled` gives `canceled`.
6. Any `warning` gives `warning`.
7. All `skipped` gives `skipped`.
8. Any `scheduled` gives `scheduled`.
9. Otherwise `success`.

**Retries.**
- `retry` is n, or `{max: n, when: [script_failure, job_timeout, system_failure]}` (default all three).
- Each automatic retry is a new pending attempt with a new job id and the same name. The old attempt stays `failed` with `retried: true` (`data-retried="true"`). A retry never re-runs an existing attempt.
- `Retry job` retries any finished job by hand, without limit, as a new attempt.
- `Retry pipeline` retries the latest failed and canceled jobs, and returns jobs skipped because of them to `created`.

**Timeouts.** `timeout` (default `SPUR_JOB_TIMEOUT_MS`) runs on the server clock from the job's start. An overrun fails the job with reason `job_timeout` and the log line `Job exceeded its time limit.`

**Interruptible pipelines.** When a push creates a pipeline on a branch, each older push pipeline on that branch in which no job with `interruptible` false (the default) has started has all its unfinished jobs canceled, with reason `Canceled by newer pipeline <id>.`

**Job log.**
- Lines are `<n> <stream> <text>`, with n from 1 and stream `out` (for `print`) or `sys`.
- When the job starts:
  - with a pulling cache: `section_start cache`, one restore line, then `section_end cache`;
  - then `Downloaded artifacts of <job>` for each dependency, in order.
- Then come `section_start script` and one line per command:
  - `print` logs `out <text>`;
  - `write` logs `Wrote <path>`;
  - `wait` logs `Waiting <ms> ms`;
  - `exit` logs `Exit code <n>`;
  - `emit` logs `Stored <kind> report from <path>`;
  - an unknown command logs `Unknown command: <text>`.
- `section_end script` follows. Then, when artifacts apply, `section_start artifacts`, `Uploaded <n> artifact files` or the upload failure line, and `section_end artifacts`. Then the cache save line, `Cache saved: <key>`.
- The last line is always `Job finished: <status>`.
- A canceled job's reason is also its last line before `Job finished`.

**Artifacts.**
- `artifacts: {paths, expire_in, when: on_success|on_failure|always}`, where `paths` are globs over files written by this job.
- A job downloads artifacts from the jobs it `needs`, or from jobs in earlier stages if it has none, limited by `dependencies`.
- Artifacts expire `SPUR_ARTIFACT_TTL_MS` after the job finishes unless `expire_in` says otherwise. At expiry, on the server clock, the object is deleted and the link goes. `Keep artifacts` clears the expiry.
- An expired dependency fails the job before its script runs, with reason `system_failure` and the log line `Artifacts of <job> have expired.`

**Caches.**
- `cache: {key, fallback_keys, paths, policy: pull|push|pull-push}`, with policy `pull-push` by default.
- Restore tries the key, then the fallback keys, and logs exactly one of `Cache hit: <key>`, `Cache hit from fallback: <key>`, or `Cache miss: <key>` (the last one tried).
- A cache older than `SPUR_CACHE_TTL_MS` logs `Cache stale: <key>`, counts as absent, and the restore continues to the next key.
- A push writes under `key` only, after a successful script.

**Reports.** `emit` reads a workspace file in these formats:
- tests: `{"cases":[{"name","status":"passed|failed|skipped","ms"}]}`
- coverage: `{"percent":<n>}`
- quality: `[{"fingerprint","severity","path","line","message"}]`
- security: `[{"id","severity":"low|medium|high|critical","title","path","line"}]`

A file that doesn't fit fails the job with `Report <path> is not valid <kind> JSON.` A pipeline's coverage comes from the last job in config order that emitted one.

#### Reports on a request (DP-44)

Reports compare the request's head pipeline with the latest successful target pipeline at the merge base commit (the base).
- `Test summary`: `<new> new failures, <f> failed, <p> passed, <s> skipped`. A new failure is failed now and not failed in the base (including absent), and each is listed by name. It reads `No test report.` when the head pipeline has no tests report.
- `Coverage`: `Coverage <head, two decimals>% (<signed difference, two decimals>)`, for example `Coverage 81.25% (-1.50)`, always with a sign (`+0.00`). Without a base it reads `Coverage 81.25% (no base)`, and with no head coverage `Coverage unknown`.
- `Code quality`: `<a> new, <r> resolved`, by fingerprint. It reads `No code quality report.` when the head pipeline has no quality report.
- Security findings: one finding per report `id` on the request. `region "Security"` reads `<n> security findings need review.` (singular `1 security finding needs review.`), counting findings of any severity in `detected` or `confirmed`. It reads `No security findings need review.` when there are none. Check 10 counts only `high` and `critical` findings. States move:
  - `detected` to `confirmed`, `dismissed` or `resolved`;
  - `confirmed` to `dismissed` or `resolved`;
  - `dismissed` to `detected`.
  Any other move is 409 `illegal_transition`: `A finding can't go from <from> to <to>.`
- Dismissing needs a reason of at least 10 characters (422: `Give a reason of at least 10 characters.`) and maintainer role or `dismiss_finding`.
- A finding absent from a later head report becomes `resolved` on the server.
- While any `high` or `critical` finding is `detected` or `confirmed`, the required rule `Security review` (1 approval from maintainers or `approve` holders) and check 10 apply. Dismissing the last one removes both, live.

#### Environments and deployments (DP-30, DP-31, DP-32)

**Environments.** `environment: {name, action: start|stop, auto_stop_in, on_stop, tier}` on a job. `tier` is `production`, `staging`, `testing`, `development` or `other`; it defaults to `production` for the name `production` and `other` otherwise. A name like `review/$CI_MERGE_REQUEST_IID` makes a review environment. Environment states are `available`, `stopping` and `stopped`.

**Deployments.**
- A start job creates a deployment, numbered per environment from 1, when the job becomes eligible.
- Statuses are `created`, `awaiting_approval`, `approved`, `running`, `success`, `failed`, `canceled` and `rolled_back`.
- On a protected environment, the job becomes `manual`, the deployment is `awaiting_approval`, and the page shows `Waiting for approval: <n> of <m>`. When n reaches m the deployment is `approved` and the job becomes pending at once.
- An approval counts for `SPUR_DEPLOY_APPROVAL_MS` from when it was granted, on the server clock. After that it no longer counts, and its row shows `This approval expired.`
- Approval refusals are checked in this order, and the first that applies is returned. A deployer below the environment's minimum role therefore sees `self_approval`:
  - 403 `self_approval`: `You can't approve your own deployment.` (the person whose push or play started the job)
  - 403 `forbidden`: `You aren't allowed to approve deployments to <environment>.`
  - 409 `not_awaiting`: `This deployment isn't waiting for approval.`
  - 409 `already_approved`: `You already approved this deployment.`
- Rejecting cancels the deployment and the job, with reason `Deployment rejected by <username>.`
- **Outdated:** when a deploy job starts, if its pipeline is older than the pipeline of the environment's current (latest successful) deployment, it fails with reason `outdated_deployment` and the text `This deployment is outdated: deployment <n> is newer.`

**Stopping.** `Stop environment` plays the `on_stop` job, setting the environment to `stopping` and then `stopped` when that job succeeds, or `stopped` at once without one. Review environments auto-stop `SPUR_AUTO_STOP_MS` after their latest deployment finishes, unless `auto_stop_in` says otherwise. Other environments auto-stop only when `auto_stop_in` is set. The page shows `Auto-stops at <time>` from the server, and `Keep environment` clears it.

**Rollback.** `Roll back to deployment <n>` makes a new numbered deployment, `success` at once, from deployment n's commit and its recorded artifact objects (its job's own artifacts and those it downloaded), and marks the previous current deployment `rolled_back`. It is refused when an object is missing or expired: 409 `artifact_gone`, `Can't roll back: its artifact has expired.` A deployment with no artifacts: 409 `artifact_gone`, `Can't roll back: deployment <n> has no artifact.`

**Delivery metrics.** These count successful deployments to `production`-tier environments within the last `days` (7, 30 or 90) local days ending today, with days cut at midnight in the chosen IANA zone (default: the viewer's zone).
- Deployment frequency = count ÷ days, 2 decimals: `Deployment frequency <x> per day`.
- Lead time = median of (deployment finish minus the earliest commit author time of each merged request first deployed by it), in hours, 2 decimals, taking the lower middle for an even count: `Lead time <x> hours`, or `Lead time No data`.
- Change failure rate = deployments that were later `rolled_back`, or whose next production deployment failed before another success, ÷ deployments, percent with 1 decimal: `Change failure rate <x>%`.
- Recovery time = median of (next success minus failure) for failed deployments, in hours, 2 decimals: `Recovery time <x> hours`, or `Recovery time No failures`.

An unknown zone is 422 `Unknown time zone <value>.`

#### Issues, labels and planning (DP-34, DP-35, DP-40)

**Issue fields.** Titles follow the request title rules. Weights are 0 to 100: `Weight must be 0 to 100.` Links are `relates`, `blocks` and `blocked by`. Due dates are dates in the viewer's zone.

**Durations** (time tracking): `1mo = 4w`, `1w = 5d`, `1d = 8h`, `1h = 60m`, written like `2d 3h` and normalized largest unit first. A bad one is `Invalid duration: <text>.`

**Quick actions.** These run on their own lines in a comment when it is submitted, are removed from the stored text, and each result goes in a system note and the announcement, in order:

| Action | Result |
|---|---|
| `/assign @u` | `Assigned @u.` |
| `/unassign @u` | `Unassigned @u.` |
| `/label ~a ~b` | `Added ~a ~b.` |
| `/unlabel ~a` | `Removed ~a.` |
| `/milestone %m` | `Set milestone %m.` |
| `/weight n` | `Set weight to n.` |
| `/estimate d` | `Set estimate to d.` (normalized) |
| `/spend d` | `Added d of time spent.` |
| `/due YYYY-MM-DD` | `Set due date to YYYY-MM-DD.` |
| `/close` | `Closed.` |
| `/reopen` | `Reopened.` |
| `/confidential` | `Made confidential.` |
| `/relate #n` | `Linked #n.` |
| `/promote` | `Promoted to epic &n.` |
| `/title text` | `Changed title to text.` |

- Names with spaces are quoted, as in `~"needs review"`.
- An unknown action stays as text.
- A failed one gives `Could not apply /<action>: <reason>.`, where the reason is one of `user @<u> doesn't exist`, `label ~<a> doesn't exist`, `milestone %<m> doesn't exist`, `weight must be 0 to 100`, `invalid duration <text>`, `epics need a group`.
- On merge requests, only `/assign`, `/unassign`, `/label`, `/unlabel`, `/milestone`, `/close`, `/reopen` and `/title` apply.

**Scoped labels.** A label `key::value` is exclusive within its key, where the key is everything before the last `::`. Adding one removes any other with the same key, in one write with one note `Replaced ~<key>::<old> with ~<key>::<new>.`, whether by quick action, the sidebar, the API or a board move.

**Label change notes.** These rules apply to every route:
- A scoped label that replaces a sibling writes its `Replaced …` note, and is not listed in any other note.
- The other labels added in the same change write one `Added ~a ~b.` note.
- Labels removed without a replacement write one `Removed ~a.` note, with several names separated by spaces.
- The notes come in the order Replaced, Added, Removed, and each is left out when it would be empty. A quick action announces the same sentences.

For example, `/label ~priority::high` on an issue carrying `priority::low` writes exactly one note, `Replaced ~priority::low with ~priority::high.`, and announces that sentence. Group labels are inherited by subgroups and projects. A project label with the same name wins on display and is the same key.

**Confidential issues.** Only the author, the assignees, and members whose effective role (direct or inherited) is reporter or above can see them. The implied read access of internal and public projects doesn't count. For anyone else:
- the URL is 404;
- they are absent from search, lists, boards, board counts and milestone counts;
- their notes and webhooks don't appear;
- a mention shows `#<n>` as plain text with no title;
- the closing line and count show only issues the viewer may read.

A closing keyword still closes them.

**Epics.** Epics belong to a group and number `&<iid>` per group. An epic holds issues and child epics one level deep only: 422 `epic_depth`, `Epics can only nest one level.` An epic's dates are the earliest milestone start and the latest milestone due date among its issues.

`/promote` creates an epic in the project's group.
- **Copied:** the title, description, author and confidentiality, and group labels only.
- **Not copied:** assignees, weight and milestone.
- **The epic's notes,** in this order:
  - the issue's comments, each with its original author, body and time;
  - one system note `Copied from #<iid>.`;
  - when any labels were dropped, one system note `Dropped labels: ~<a>, ~<b>.`, listing the dropped labels by name, separated by a comma and a space.
- **The issue** closes, linked to the epic. Its quick-action note and announcement is `Promoted to epic &<n>.`

**Milestones** have a start and due date in a chosen zone. The burndown has one point per day from start to due. `remaining` for day d is the sum, using weights at the end of d from the event log, of the issues now in the milestone that were open at the end of d. An issue with no weight counts 0. An issue removed from the milestone leaves every day. Days after the current server day show `data-future="true"` and today's value.

#### Boards (DP-33)

**Lists.** A board's lists all share one kind (label, assignee or milestone), with `Open` first and `Closed` last. An open issue shows in every list it matches, or in `Open` when it matches none. Closed issues show only in `Closed`.

**Moves.** Moving a card into a list:
- removes the field of the list it left and adds the target's field (scoped rules apply);
- into `Open`, only removes;
- into `Closed`, closes the issue;
- out of `Closed`, reopens it.

**Order and conflicts.** Each card has a server `position`. A move gives `after_id`, the server places the card between that card and the next, and it returns the full order.
- Each move carries the card's `version`, which counts that card's moves. A stale version is 409 `stale_card`: `<user> moved this card first. It is now in <list>.` The card shows the server's list.
- A move whose `after_id` card has left the list applies at the end of the list, and the mover sees `Card moved: <title> went to the end of <list>.`
- A dropped card plays `card-settle`.

**Labels and counts.** A card is labelled `Issue #<iid>, <title>, weight <w>, <n> labels, in <list>`, with `no weight` when it has none. On group boards it starts `Issue <project slug>#<iid>`. Counts read `<n> issues` (singular `1 issue`), filtered by access and by the URL's filters.

#### Wiki (DP-43)

**Slugs and versions.** Slugs use `a-z 0-9 - /`. Each save makes the next version. An edit whose `base_version` is behind is 409 `stale_wiki`: `<user> edited this page. Your base version <a> is behind <b>.` History compares versions with the diff rule. `Restore this version` saves its content as a new version.

**Rendering.** Only this Markdown subset renders: headings, paragraphs, bold, italic, inline code, code blocks, lists, tables, links to `http`, `https`, `/` and `#`, and images from project files. HTML is escaped, and any other link prints as text.

#### Webhooks (DP-45)

**Events and payloads:**
- `push`: `{"event":"push","project":{"id","path"},"ref","before","after","commits":[{"id","message","author"}],"user"}`
- `merge_request`: `{"event":"merge_request","action":"open|update|merge|close|reopen|approve","project","merge_request":{"iid","title","state","source","target"},"user"}`
- `pipeline` (on reaching a finished status): `{"event":"pipeline","project","pipeline":{"id","ref","sha","status","source"}}`
- `deployment` (on each status change): `{"event":"deployment","project","deployment":{"environment","number","status","sha"}}`
- `issue`: `{"event":"issue","action":"open|update|close|reopen","project","issue":{"iid","title","state"}}` (never for confidential issues)

**Headers.** A delivery is a POST with these headers:
- `Content-Type: application/json`
- `X-Spurline-Event: <event>`
- `X-Spurline-Delivery: <uuid>`
- `X-Spurline-Timestamp: <unix seconds, server clock>`
- `X-Spurline-Signature: sha256=<lower-case hex of HMAC-SHA256(secret, "<timestamp>.<raw body>")>`

**Targets.** A target must match an entry of `SPUR_WEBHOOK_ALLOW` exactly by host and port (default ports 80 and 443). This is checked on create and on every attempt, and redirects are not followed: 422 `target_not_allowed`, `This target isn't on the allow-list.`

**Attempts.** The first attempt goes when the event happens. Any non-2xx answer, connection error, or no answer within 10 seconds schedules the next attempt after the next gap in `SPUR_WEBHOOK_RETRY_MS`, on the server clock. After the last gap the delivery is `failed`.

**Delivery rows** read `Delivery <short id>, attempt <n>, <status code|no response>, next try <time|none>`. `Redeliver` sends a new delivery with a new id, timestamp and signature, and the same body.

#### Search, export and import (DP-40, DP-46)

**Search.** Access rules apply before results and counts, and an unreadable project adds nothing. Code search covers the default branch, matches an exact substring ignoring case, and sorts by path and then line.

**The `.spurpack` format.** The file is UTF-8 lines, each ending in `\n`. The first line is `spurpack 1`. Every other line is one record of fields separated by single tab characters.

**Encoding fields.**
- Inside a field, tab, newline and backslash are written `\t`, `\n` and `\\`.
- `-` alone means empty or none. A field whose whole value is a literal `-` is written `\-`.
- Lists are items joined by `,`, and a comma inside an item is written `\,`.
- Booleans are `true` or `false`.
- Integers are plain decimal digits.
- Dates are `YYYY-MM-DD`.

**Records.** The count includes the record name:

| Record | Fields after the record name, in order | Count |
|---|---|---|
| `user` | `username` | 2 |
| `file` | `path`, `content` | 3 |
| `commit` | `id`, `parents`, `author`, `committer`, `message` | 6 |
| `ref` | `kind`, `name`, `commit` | 4 |
| `label` | `name`, `description` | 3 |
| `milestone` | `title`, `start`, `due`, `zone`, `state` | 6 |
| `issue` | `iid`, `title`, `state`, `author`, `labels`, `milestone`, `weight`, `confidential`, `description` | 10 |
| `request` | `iid`, `title`, `state`, `author`, `source`, `target`, `description` | 8 |
| `thread` | `request`, `path`, `line`, `resolved`, `author`, `body` | 7 |
| `wikipage` | `slug`, `version`, `author`, `title`, `content` | 6 |
| `config` | `key`, `value` | 3 |

**Files are a full snapshot.** Each `commit` record is preceded by one `file` record for every file in that commit's tree, and for nothing else. A commit with an empty tree has none. An export holds every commit reachable from a branch or tag. Each thread holds only its first note, and pipelines, jobs, environments and deployments are not exported.

**Which users and labels an export writes.**
- **Users:** exactly one `user` record for each distinct username that appears in an exported record. That means the username part of every commit `author` and `committer` (including `spurline-train`), and the `author` of every exported issue, request, thread and wiki page. No other users are written: members who appear in none of these fields, assignees and reviewers are left out.
- **Labels:** one `label` record for every label defined on the project itself, whether or not an issue uses it. Also one for every inherited group label (from the project's group or any ancestor group) that at least one exported issue carries. Inherited group labels that no exported issue carries are left out. When a project label and an inherited group label share a name, one record is written, with the project label's description. A group label's record uses the group label's description.
- **Milestones:** only the project's own milestones.

**How import stores them.**
- A `user` record creates nothing. It must name an existing user on this instance (otherwise `doesn't exist here`), and every user field refers to that existing user.
- Every `label` record becomes a project label of the new project, with its name and description, even when a group label of the same name exists in the target group. Issues keep their labels by name.

Because imported labels are all project labels, exporting an imported project writes the same label records again, so the round trip stays byte-exact.

**Valid values.** Any value that breaks its rule is `bad value for <field>`.
- **User fields:**
  - `username`: 3 to 24 characters of `a-z 0-9 _`, or `spurline-train`.
  - Every user field elsewhere (`author`, and the username part of `committer`) must name a `user` record earlier in the file.
- **Repository fields:**
  - `path`: not empty, no leading `/`, and no empty, `.` or `..` segment. On a `thread` it may be `-`, meaning the request itself.
  - `content`, `description` and `body`: any text. `body` must not be empty.
  - `id` and `commit`: 64 lower-case hex characters.
  - `parents`: `-`, or a list of such ids.
  - `author` and `committer` on a commit: `<username> <unix seconds>`, with non-negative seconds.
  - `message`: not empty after trailing whitespace is removed.
  - `kind`: `branch` or `tag`.
  - `name`: not empty. On a `label` it must not contain a tab or newline.
- **Planning fields:**
  - `title`: 1 to 255 characters.
  - `start` and `due`: real dates, with `start` no later than `due`.
  - `zone`: an IANA name.
  - `state`: milestone `active` or `closed`; issue `opened` or `closed`; request `opened`, `closed` or `merged`.
  - `iid`: a positive integer.
  - `labels`: `-`, or a list naming `label` records earlier in the file.
  - `milestone`: `-`, or the title of an earlier `milestone` record.
  - `weight`: `-`, or 0 to 100.
  - `confidential` and `resolved`: booleans.
  - `source` and `target`: not empty.
- **Thread and wiki fields:**
  - `request`: the iid of an earlier `request` record.
  - `line`: a positive integer, or `-`. It is `-` exactly when `path` is `-`.
  - `slug`: not empty, using `a-z 0-9 - /`.
  - `version`: 1 for a slug's first record and one more than that slug's previous record after that.
- **Config:**
  - `key`: one of `author_can_approve`, `auto_resolve_outdated`, `default_branch`, `merge_method`, `merge_trains`, `pipelines_must_succeed`, `reset_approvals_on_push`, `visibility`.
  - `value`, by key:
    - `merge_method`: one of the four merge methods;
    - `visibility`: `private`, `internal` or `public`;
    - `default_branch`: a branch named by a `ref` record;
    - the other keys: booleans.
  - Export writes all eight keys. Import accepts any of them, and a missing key takes the project default.

**Canonical order:**
1. The header line.
2. Users by username.
3. Commits in topological order (parents first, ties broken by committer time and then id), each preceded by its files sorted by path.
4. Refs (branches before tags, then by name), labels by name, milestones by title, issues by iid, requests by iid, then threads by request iid and creation order. Names and titles sort as UTF-8 bytes.
5. Wiki pages by slug and version.
6. Config by key.

Export writes canonical files. Importing a canonical file and exporting it again gives the same bytes. An import keeps the file's order of threads as their creation order.

**Sample canonical pack.** Here `<TAB>` stands for one tab character, and `hello\n` in the `file` line is the six characters `hello`, backslash, `n`:

```
spurpack 1
user<TAB>asha
file<TAB>README.md<TAB>hello\n
commit<TAB>2fb8c1cda9fb9f60c6a31ab386849d1e1f88d512c877f639f59e90e8c808ba65<TAB>-<TAB>asha 1767225600<TAB>asha 1767225600<TAB>First commit
ref<TAB>branch<TAB>main<TAB>2fb8c1cda9fb9f60c6a31ab386849d1e1f88d512c877f639f59e90e8c808ba65
label<TAB>priority::high<TAB>-
milestone<TAB>Sprint 1<TAB>2026-01-05<TAB>2026-01-16<TAB>UTC<TAB>active
issue<TAB>1<TAB>Export fails<TAB>opened<TAB>asha<TAB>priority::high<TAB>Sprint 1<TAB>3<TAB>false<TAB>-
wikipage<TAB>home<TAB>1<TAB>asha<TAB>Home<TAB># Home
config<TAB>author_can_approve<TAB>false
config<TAB>auto_resolve_outdated<TAB>false
config<TAB>default_branch<TAB>main
config<TAB>merge_method<TAB>merge_commit
config<TAB>merge_trains<TAB>false
config<TAB>pipelines_must_succeed<TAB>false
config<TAB>reset_approvals_on_push<TAB>true
config<TAB>visibility<TAB>private
```

Its import preview reads `Adds 1 commits, 1 issues, 0 requests.`

**Import errors.** Errors are listed top to bottom, the first error per line, at most 20, as 422 `invalid_pack` with `details.errors`:
- `Line 1: not a spurpack file.`
- `Line <n>: unknown record "<x>".`
- `Line <n>: <record> needs <k> fields, got <j>.`
- `Line <n>: commit <short> has unknown parent <short>.`
- `Line <n>: commit id doesn't match its contents.`
- `Line <n>: user "<name>" doesn't exist here.`
- `Line <n>: ref <name> points to unknown commit <short>.`
- `Line <n>: bad value for <field>.`
- `Line <n>: duplicate <record> <key>.`
- `Line <n>: file belongs to no commit.`

**Line order.** A wrong first line gives only `Line 1: not a spurpack file.` For every other line, the first error in this order is reported:
1. Unknown record.
2. Field count.
3. `bad value for <field>`, checking fields in record order.
4. Duplicate.
5. For a `user` record: `doesn't exist here`, when the username isn't on this instance.
6. For a `commit` record: unknown parent (the first unknown one in written order), then a commit id that doesn't match its files, parents, author, committer and message.
7. For a `ref` record: unknown commit.

**Duplicate keys** are:
- the username;
- a file path within one commit's run of files;
- the commit id;
- `<kind> <name>` for refs;
- the label name;
- the milestone title;
- the issue iid;
- the request iid;
- `<slug> <version>` for wiki pages;
- the config key.

**File runs.** A run of `file` records that isn't followed by a `commit` record gets `file belongs to no commit`, reported at the run's first line.

`dialog "Import preview"` shows `Adds <c> commits, <i> issues, <r> requests.` and `button "Import"`. A file larger than `SPUR_EXPORT_MAX_BYTES` is 413 with `File is too large (<max> bytes at most).`

**Progress.** Exports and imports run in the background in 5 steps of `SPUR_EXPORT_STEP_MS` each on the server clock. Their progress bars read 0, 20, 40, 60, 80 and 100, live. An export reaches 100 only after file storage confirms the stored file, and only then does `Download export` appear. A failed export stays at its last value with the outage copy and `Retry export`, which starts a new export.

#### Kept only when stored (DP-27, DP-31, DP-46)

An artifact, cache, report, sealed log, large file or export counts as kept only after file storage confirms the upload. Until then no link, download, size, cache hit or rollback target refers to it, and the database never records its object key. A rollback target is refused when file storage no longer confirms its artifact.

### Services (DP-06, DP-11, DP-27, DP-46)

**Postgres** is the system of record. It holds:
- users, sessions, groups, memberships, custom roles;
- repository objects up to the inline limit, refs, commits;
- merge requests, versions, threads, suggestions, approvals, train cars with their stored speculative commits;
- pipelines, jobs, live job logs until sealed, environments, deployments, approvals;
- issues, epics, milestones, labels, boards, wiki pages;
- webhooks and deliveries, findings, audit events, export and import records, and the live message log.

The app applies its schema idempotently every time it starts.

**MinIO** (bucket `S3_BUCKET`) holds these objects:

| Object | Key |
|---|---|
| File contents larger than `SPUR_INLINE_MAX_BYTES` bytes | `blobs/<blob id>` |
| Artifacts | `artifacts/<job id>/<path>` |
| Caches (a JSON map of path to content) | `caches/<project id>/<key>` |
| Sealed job logs (the log lines, each ending `\n`) | `logs/<job id>.log` |
| Reports (the emitted file) | `reports/<job id>/<kind>.json` |
| Project exports | `exports/<project id>/<export id>.spurpack` |

Downloads pass through the app. The browser never receives a storage URL.

**When file storage is unavailable** (unreachable, or set down by the grading storage route):
- The instance status strip and affected panels read `File storage is unavailable. Uploads, artifacts and exports are paused.`
- A commit with a file over the inline limit is 503 `storage_unavailable`: `File storage is unavailable. Nothing was committed. Try again in a moment.`
- An artifact upload fails with the job log line and job page text `Artifact upload failed: file storage is unavailable.` The job fails with reason `system_failure` and is retried by its `retry` rule.
- A cache restore or save logs `Cache skipped: file storage is unavailable.` and never fails the job.
- Log sealing waits. The log stays readable from Postgres and seals on a later round once storage returns.
- An export fails with `Export failed: file storage is unavailable.` and shows `Retry export`.
- An artifact download or rollback check is 503 `storage_unavailable` with the outage sentence above.

### Seed data (DP-09)

On start, an empty database gets this demo instance. Every person, group, project and issue in it is invented. Passwords are `spurline-demo-1`.

- **Users:**
  - `asha`, time zone `Europe/Lisbon`
  - `tomas`, `America/Bogota`
  - `rin`, `Asia/Tokyo`
  - `odile`, `UTC`
  - The system user `spurline-train` can't sign in.
- **Group `coldbrook`** (private): asha owner, tomas developer, rin developer, odile reporter. Custom role `release-captain`: base developer with `approve` and `manage_environments`. Group labels: `priority::high`, `priority::low`, `workflow::doing`, `workflow::review`, `type::bug`.
- **Subgroup `coldbrook/apps`** (private): rin is a direct maintainer.
- **Project `coldbrook/apps/tidepool`** (private, default branch `main`):
  - Settings: `merge_method` `merge_commit`, `merge_trains` on, `pipelines_must_succeed` on, `reset_approvals_on_push` on, `author_can_approve` off, `auto_resolve_outdated` off.
  - `main` is protected with push maintainer and merge developer. Tags `v*` need maintainer.
  - Push rules: secret detection on, everything else empty.
  - Approval rule `Backend`: required 1, users rin and asha.
  - Environment `production` is protected: roles maintainer, 1 approval.
- **Commits:**
  1. The worked-example commit (`README.md` `hello\n`, `asha`, 1767225600, `First commit`).
  2. `Add pipeline and owners` by asha at 1767229200, adding:
     - `src/app.ts` containing `export const name = "tidepool";\n`;
     - `.spurline/OWNERS` containing `[Backend]\n/src/ @rin\n[Docs]\n*.md @asha\n`;
     - `spurline.pipeline.yml` containing the text below.
  3. On branch `feat/export` from `main`: `Add export button` by tomas at 1767232800, changing `src/app.ts` to `export const name = "tidepool";\nexport const canExport = true;\n`.

```yaml
stages: [build, test, deploy]
build:
  stage: build
  script:
    - print Building tidepool
    - write dist/app.txt tidepool build
  artifacts:
    paths: [dist/app.txt]
test-unit:
  stage: test
  script:
    - print Running unit tests
deploy-production:
  stage: deploy
  script:
    - print Deploying tidepool
  environment:
    name: production
  rules:
    - if: $CI_COMMIT_BRANCH == "main"
```

- **Tag** `v0.1.0` on commit 2, message `First tagged build.`
- **Pipeline 1** on `main` at commit 2, all three jobs `success`. It made deployment 1 of `production` (seeded before the protection applies), and its `build` artifact is stored.
- **Merge request !1** `Add export button`, `feat/export` into `main`, by tomas, reviewer rin, description `Closes #1`, `delete_source_branch` on.
- **Issues:**
  - #1 `Export fails on large projects` by odile, labels `priority::high` and `workflow::doing`, weight 3, milestone `Sprint 1`.
  - #2 `Tidy the README` by asha, label `workflow::review`, weight 1.
- **Milestone** `Sprint 1`, from 2026-01-05 to 2026-01-16, zone `UTC`.
- **Board** `Development`, of kind label, with lists `workflow::doing` and `workflow::review`.
- **Wiki page** `home`, version 1 by asha, title `Home`, content `# Tidepool\n\nShared notes.`

## Technical requirements

### Deployment (DP-01)

Backend: TypeScript on Node 22 with npm. Frontend: TypeScript built with Node 22 in the same `build` step and served by the Node server.

`/app/run.json` holds string commands and the schema tag, for example:

```json
{"_schema":"run-manifest-v1","install":"npm ci","build":"npm run build","serve":"node dist/server.js"}
```

The server binds `0.0.0.0` on port 4173, or on `APP_PUBLIC_PORT` when it is set. `GET /api/health` answers HTTP 200 with:
- `{"status":"ok"}` when Postgres and file storage are reachable;
- `{"status":"unavailable"}` when file storage is unreachable or set down;
- `{"status":"starting"}` until Postgres is reachable.

### Configuration and secrets (DP-11)

The app reads these at start and never hard-codes them or sends them to the browser:
- Postgres: `DATABASE_URL`.
- MinIO: `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_FORCE_PATH_STYLE`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`.

Published settings, read at start:

| Setting | Env var | Default |
|---|---|---|
| Grading routes on | `SPUR_GRADING` | unset (off) |
| Inline blob limit, bytes | `SPUR_INLINE_MAX_BYTES` | 65536 |
| Commit file size, bytes | `SPUR_FILE_MAX_BYTES` | 5000000 |
| Running jobs per project | `SPUR_PARALLEL_LIMIT` | 4 |
| Retry ceiling | `SPUR_RETRY_MAX` | 2 |
| Default job timeout, ms | `SPUR_JOB_TIMEOUT_MS` | 3600000 |
| Artifact expiry, ms | `SPUR_ARTIFACT_TTL_MS` | 604800000 |
| Cache stale age, ms | `SPUR_CACHE_TTL_MS` | 1209600000 |
| Review environment auto-stop, ms | `SPUR_AUTO_STOP_MS` | 86400000 |
| Deploy approval lifetime, ms | `SPUR_DEPLOY_APPROVAL_MS` | 86400000 |
| Stacked requests retargeted per merge | `SPUR_RETARGET_LIMIT` | 4 |
| Cars per train | `SPUR_TRAIN_MAX` | 20 |
| Presence removal after a socket closes, ms | `SPUR_PRESENCE_TIMEOUT_MS` | 15000 |
| Export or import step, ms | `SPUR_EXPORT_STEP_MS` | 400 |
| Export or import file size, bytes | `SPUR_EXPORT_MAX_BYTES` | 50000000 |
| Webhook retry gaps, ms, comma-separated | `SPUR_WEBHOOK_RETRY_MS` | 60000,300000,900000 |
| Webhook target allow-list, `host:port`, comma-separated | `SPUR_WEBHOOK_ALLOW` | empty |
| SSE heartbeat, ms | `SPUR_SSE_HEARTBEAT_MS` | 15000 |
| Writes per user per minute | `SPUR_WRITE_RATE` | 600 |
| Sign-ins per username per minute | `SPUR_LOGIN_RATE` | 10 |
| Toast lifetime on page timers, ms | `SPUR_TOAST_MS` | 5000 |

The page receives the toast lifetime from the server's page config.

### Server boundary (DP-03, DP-06)

**Accounts and cookie.** Usernames are 3 to 24 characters of `a-z 0-9 _`, stored in lower case: `Username must be 3 to 24 characters: a-z, 0-9 and _.` Passwords are at least 8 characters: `Password must be at least 8 characters.` The two refusals are `That username is taken.` and `Username or password is wrong.` The session cookie is `spur_session`, `HttpOnly; SameSite=Lax`, without `Secure`. Unauthenticated page requests redirect to `/sign-in`.

**Origin and limits.**
- Same-origin only. No cross-origin API access is granted.
- Request bodies are limited to 1,000,000 bytes, except the commit APIs (10,000,000 bytes) and imports (`SPUR_EXPORT_MAX_BYTES`). A body of exactly the limit is allowed. Over it: 413 `payload_too_large`, `Request body is too large (<max> bytes at most).`
- Writes over `SPUR_WRITE_RATE` per user per minute, or sign-in attempts (successful or not) over `SPUR_LOGIN_RATE` per username per minute (both on the server clock), get 429 `rate_limited`: `Too many requests. Try again in <s> seconds.`

**What the server never serves.** Only built assets, the bundled fonts and API responses. Never source files, the run manifest, environment values, credentials or storage URLs. The page loads no external origin, and the app uses no service worker.

**Unavailable services.** The server starts listening even when a dependency is down at boot. With Postgres down, it retries every second and health reports `starting`. With file storage down at boot or later, everything else works, the published outage behaviour applies, and as soon as storage answers again, uploads, exports and log sealing work on the next try without a restart.

### Browser support and performance (DP-05, DP-36)

Current Chromium, Firefox and WebKit at the published viewports. A merge request page with 20 changed files is usable within three seconds. A live message shows on every open page within one second. Page timers (`setTimeout`, `setInterval`, `Date`, `requestAnimationFrame`) drive every client timer: toasts, long press, touch hold, the scramble and reconnect. Animations run on the document timeline. Grading pages open with a paused page clock, and the server clock is separate from it.

## Working rules

- IF-01: `/app/run.json` exists with string `install`, `build` and `serve` and `"_schema":"run-manifest-v1"`, and `serve` starts the server without a further build.
- IF-02: `THIRD_PARTY_NOTICES.md` at the repository root lists every shipped package (the production dependency tree from `npm ls --omit=dev --all --json`) and each bundled font, with its licence.
- IF-03: Every shipped package and font uses MIT, ISC, BSD-2-Clause, BSD-3-Clause, Apache-2.0, 0BSD or OFL-1.1.
- IF-04: The app uses no datastore, queue, cache, mail or search service besides the provided Postgres and MinIO, and writes no state to local files.
- IF-05: `package-lock.json` is committed and `install` uses it.
- IF-06: The provided compose and service configuration files are left unchanged.
- IF-07: No source file, asset or UI copy names another code hosting product.

## Engineering standards

- The code is idiomatic, strictly typed TypeScript: no `any` in domain code and no type assertions that hide a wrong shape.
- Names match this brief's domain terms: merge request, thread, version, approval rule, owners section, train car, speculative commit, job attempt, deployment, scoped label, spurpack.
- Each domain rule (the merge check order, a state transition, the rollup, the layer rule, a hash formula, scoped label exclusivity, the push rule order) is decided in exactly one place in the source, and every route calls it.
- No abstraction has only one implementation, and there are no defensive checks for states the domain rules make impossible.
- There is no dead, commented-out or unreachable code, and no feature beyond this brief.
- Every API error is produced through one error shape and one precedence rule.
- Database writes that the brief says happen together (a push and its consequences, a scoped label swap, a train rebuild) happen in one transaction.
