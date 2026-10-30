# Tessel Context Graph

Tessel is a graph database console for software agents and the engineering teams who run them. Build and deploy it as a working web application from this brief. There is no starting codebase. When you are done, a team must be able to do all of the following:

- sign in to Tessel and provision an isolated context database;
- ingest notes whose facts carry the time they became true;
- see every write in a numbered write log until a compaction folds it into a new index generation;
- ask questions two ways: a keyword search ranked by an exact scoring rule, and a small read-only graph query language that can answer as of any past moment.

Owners run members, API keys, the plan and the usage bill. Editors write knowledge. Viewers only read and ask. Some limits hold everywhere:

- A viewer must NOT be able to write anything.
- An editor must NOT be able to manage members, keys, plans or databases.
- An API key must NEVER act as an owner.
- Nobody may read, query or even detect another organization's databases, even one that shares a name with their own.

Tessel stores every record in PostgreSQL (`postgres`) and sends every notice as real email through the local mail service Mailpit (`mailpit`). Out of scope:

- self sign-up;
- any datastore, queue, object store, payment service or identity provider besides those two;
- fact extraction from text;
- charging money.

## Problem and users

Agent teams keep their working knowledge in scattered notes. When someone asks "who owns the Atlas launch?" the honest answer depends on *when*, and most tools return whatever was written last. Tessel is recast from a captured marketing site whose promise is that the product stores decisions, facts, docs, relationships and knowledge, and how it all evolves: what changed, when, and why. This product makes that promise real and checkable. It ships no captured media and credits the company as `Tessel Labs, Inc`.

A member provisions a database and ingests sources. Each source becomes one entry in the database's write log. Facts attached to a source say that a subject relates to an object from a `valid_from` moment onward. For one subject and one predicate, a newer fact supersedes an older one from its own `valid_from`, so a question asked as of an earlier moment returns the earlier answer. Reads always see every accepted write, filed or not. Compaction changes how the data is filed, never what a question returns.

Every computation is deterministic: tokenization, keyword scores, supersession, graph query rows and their order, and the usage bill are defined below to the character and the cent. No model, remote service or random value takes part in any of them. The public landing page sells the product with:

- a hero that reads as a sentence or as a drawn graph;
- an architecture diagram;
- benchmark cells;
- plan cards;
- a working price calculator.

Tessel also runs like a managed product a team can trust with its working knowledge:

- Every refusal reads the same in the API and in the console.
- Writes can be retried safely. A stale edit is refused instead of overwriting newer work. A deleted source can be brought back exactly as it was.
- API keys can be limited to chosen databases, rotated and inspected.
- Every change an owner makes lands in an audit log that pages without repeating or skipping and outlives the people who made the changes.
- An owner can export a database as a job that finishes on its own, and import that export under a new name.
- Members can reset a forgotten password from an email link and turn on two-step sign-in.
- Each public page can also be read as markdown, the way a software agent reads it.
- The console shows the graph itself in an Explore tab with a timeline.

**User roles.** Members belong to exactly one organization and hold exactly one role. There is no self sign-up and no administrator above the organization.

| Role | What it can do |
|---|---|
| Visitor | Reads the landing page, uses the price calculator and sends the contact form. Reaches no console page and no signed-in endpoint. |
| `viewer` | Lists and opens databases. Reads sources, stats, relations and history. Runs keyword searches and graph queries. Sends feedback. Never writes. |
| `editor` | Everything a viewer can do, plus ingesting sources, deleting and restoring sources, and running compaction. |
| `owner` | Everything an editor can do, plus creating and deleting databases; adding, re-roling and removing members; creating, rotating and revoking API keys; switching the plan; and reading the usage bill and the audit log. |

An API key carries the role `editor` or `viewer`, chosen by the owner who created it, inside that owner's organization. Owner-only actions refuse every API key, whatever its role. An API key may also be limited to chosen databases of its organization. Sessions end on `Sign out`, on `Sign out everywhere`, on a password change for every other session, on a password reset for every session, and on removal of the member. Audit events, export jobs and key details are owner-only.

## Journeys

1. **Provisioning a database.**
   - Start: an owner is on `/console`.
   - They type `atlas_memory` into the inline create row and press `Create`. They read the toast `Database created`.
   - End: the new row changes from `provisioning` to `ready` without a reload.
   - If a second owner presses `Switch to Ship` on the billing page at the same moment the first presses `Create`, only one of them wins. The other reads their refusal beside the control. The organization never holds more than three databases while it is on Ship.
2. **Ingesting facts and asking about them.**
   - Start: an editor is on the Sources tab of `atlas_memory`.
   - They open the inline ingest row with `Ingest source` and add a source with two facts:
     - `Atlas Launch` `OWNED_BY` `Priya Raman` from `2026-01-05T09:00:00Z`;
     - `Atlas Launch` `OWNED_BY` `Ravi Menon` from `2026-05-01T00:00:00Z`.
   - The new row is tagged `In write log`. Pasted notes with a stray control character are refused beside the right field. Accented letters count as one character each, however they were typed.
   - On the Graph query tab, `MATCH (a {name: 'Atlas Launch'})-[:OWNED_BY]->(o) RETURN o.name` answers `Ravi Menon` with the As of field empty, and `Priya Raman` as of `2026-03-11T00:00:00Z`.
   - End: after `Compact` on the Stats tab, both answers are unchanged and the row reads `Indexed`.
3. **Editing, deleting and undoing.**
   - Start: an editor is on the Sources tab while teammates work in the same database.
   - They open `Edit` on a source row while a teammate ingests a newer version of it. Pressing `Ingest` keeps the typed text and shows the version conflict beside the title.
   - When several teammates press `Delete` on one source at the same moment, exactly one delete lands. The others read `Source not found`.
   - End: the editor presses `Undo` in the `Source deleted` toast, which then reads `Source restored`. Every graph answer reads exactly as before the delete, ties included.
4. **Searching and giving feedback.**
   - Start: a viewer is on the Search tab of `launch_brain`.
   - They search `billing migration` and mark a result `Not useful`, with a rating, a comment and optional tags.
   - End: the toast reads `Feedback sent`. A feedback body the server refuses spends nothing of the organization's feedback allowance.
5. **Exploring the past.**
   - Start: a viewer opens Explore.
   - They step the timeline back to `2026-03-10T12:00:00Z` and select `Atlas Launch`.
   - End: they read its relations as of that moment in the Inspect region.
6. **Exporting, importing and reading the bill.**
   - Start: an owner is on the Stats tab of `launch_brain`.
   - They press `Export` and watch `Export queued`, `Export running` and `Export ready` without a reload. They download the document.
   - An edited copy with a repeated source id is refused at its exact document path, and no database appears. The corrected document imports under a new name and answers the same graph questions with the same answers.
   - End: after the owner deletes the imported database, the billing page still counts the tokens it used, while storage drops. The daily chart and Stats agree with the bill.
7. **Managing keys and members.**
   - Start: an owner is in Settings.
   - They create an editor key limited to two databases, then delete both databases. The key at once sees no database at all.
   - They remove a member. On the audit page, every action that member took still reads under their email, unchanged.
   - End: the owner pulls the audit log as CSV with their session. A key named with a leading `=` reads as plain text in a spreadsheet.
8. **Visiting and signing in.**
   - Start: a visitor is on the landing page.
   - They type `3.2` GB and `2.4` million tokens and read Ship `$25.00` with `minimum applies`. They send the contact form, with scripts on or off, and read the thanks line or the error beside the field.
   - A visitor trying sign-ins on `/login` cannot tell an unknown or removed email from a wrong password.
   - A member whose session ended presses a console button, lands on `/login?next=<that page>` reading `Your session has ended. Sign in again.`, and returns there after signing in.
   - End: a `next` that points anywhere but a plain console path lands them on `/console`.

## Mandatory requirements

This is the complete list of mandatory requirements; every check traces to one of these lines and the detailed sections below.

- **DP-01 — Write log numbering** Each accepted source becomes exactly one write log entry with the next log sequence number of its database, in request order, starting at 1 and never reused or skipped, and ingesting an existing id creates its next version.
- **DP-02 — Reads see pending writes** Every read sees every accepted write at once, folded or pending, and compaction never changes a search result, graph answer, relation or history list.
- **DP-03 — Inline ingest row** An editor ingests a source with facts from the inline ingest row of the Sources table, sees it tagged In write log until Compact folds it to Indexed, and reads the same graph answers before and after.
- **DP-04 — Stale edits refused** A stale if_version refuses the whole ingest with 409 VERSION_CONFLICT naming the live version, and the console keeps what was typed beside the conflict.
- **DP-05 — Single source with ETag** A single source reads with its version as an ETag, and a matching If-None-Match answers 304.
- **DP-06 — Seeded launch database** The seed holds both launch_brain databases exactly as pinned in Seed data, and the worked graph statements answer the pinned rows as of each moment.
- **DP-07 — Supersession and relations** The active fact for a subject and predicate is the one with the greatest valid_from not after the moment, ties broken by log sequence number, and relations and history list in the pinned order with case-insensitive lookups.
- **DP-08 — Graph route** The graph route answers every edge active at a moment, filtered by predicates when asked, ordered as pinned and capped at 1000 edges.
- **DP-09 — Entity tab** The Entity tab looks up an entity's outgoing and incoming relations and its history by predicate, with superseded moments and current facts marked.
- **DP-10 — Explore tab** The Explore tab draws the graph true at its timeline position, filters by predicate, finds and inspects nodes, and moves between nodes and moments by keyboard.
- **DP-11 — Addresses carry state** Every workspace tab and its inputs live in the address, so opening, choosing and reloading an address shows the same answered tab without a full reload.
- **DP-12 — Read-only graph language** The graph language answers the pinned grammar with rows in the pinned order, refuses write keywords, bad syntax and unbound variables with their codes, and answers the seed quickly.
- **DP-13 — WHERE and count** The graph language understands WHERE conditions joined by AND, NOT, and RETURN count(*), refusing count(*) mixed with other items.
- **DP-14 — Graph query tab** The Graph query tab runs a statement by button or Ctrl+Enter, shows the served-from line, offers example statements and keeps the last results under an error.
- **DP-15 — Waiting and failing states** Every console panel marks itself busy with its button's waiting label while the server answers, shows the generic failure line beside the control on a bare error, and announces results in the live region.
- **DP-16 — Errors beside their field** A rejected ingest keeps every typed value and names the error beside the field and fact row it belongs to.
- **DP-17 — Keyword scoring** Keyword search ranks the latest version of every live source in the requested collections by the pinned scoring rule, rounded half up to 4 decimals, ties by id.
- **DP-18 — Search operators** Quoted phrases must appear in order, words with a leading minus exclude sources, and ties break by id and then collection.
- **DP-19 — Search tab and feedback** A viewer searches on the Search tab, reads ids, titles, scores and snippets, and sends Not useful feedback, and a write made by another member shows on the next search.
- **DP-20 — Typed text kept literally** Typed text, wildcards, quotes and markup included, is stored, matched, filtered and shown exactly as typed and never as markup.
- **DP-21 — Whole-request validation** An ingest is validated whole before anything is written, every limit is accepted at its boundary and refused one past it with the dotted field path, and timestamps use the pinned UTC form.
- **DP-22 — Idempotent retries** Writes honouring Idempotency-Key replay the first answer with the replay header and write nothing, and the same key with another body is refused.
- **DP-23 — Unicode entity keys** Entity keys are formed after NFC normalization and Unicode lowercasing, while storage bytes count UTF-8 bytes.
- **DP-24 — Concurrent writes hold** Racing ingests get gapless sequence numbers, racing creations respect the plan limit, racing keyed retries, compactions and restores write once, and a double press writes once.
- **DP-25 — Provisioning lifecycle** A new database reports provisioning for 2 seconds of server time and then ready, refusing ingest and compaction until then, under a validated unique name.
- **DP-26 — Plan database limits** Ship allows 3 databases and Scale 20, the next creation is refused with PLAN_LIMIT, and a downgrade past 3 databases is blocked.
- **DP-27 — Inline create row** An owner creates a database from the inline create row of the console table and watches its row turn from a yellow shimmering provisioning badge to ready without a reload.
- **DP-28 — Plan switch and notices** Switching the plan takes effect at once and emails every owner the pinned notice once, and nothing for a switch to the plan in force.
- **DP-29 — Empty collections** An editor can delete an empty collection other than default, and full, default and unknown collections are refused with their codes.
- **DP-30 — Role gating on every route** Every signed-in route answers each role, key, anonymous and versionless caller with the pinned status and code and changes no domain record on a refusal.
- **DP-31 — Empty states and access pages** Every list shows its empty state in words, owner-only panels read You do not have access to this page for others, and a foreign database reads Database not found.
- **DP-32 — Delete database dialog** Deleting a database opens a modal dialog that traps focus, enables Delete database only once the name is typed and returns focus to the row's Delete.
- **DP-33 — API keys never act as owner** API keys carry editor or viewer rights only, their secret shows once and is never stored readable, and a revoked key stops working.
- **DP-34 — Key scope, rotation and detail** A scoped key sees only its databases, a rotation retires the old secret at once, and the key detail records scope, last use and rotation.
- **DP-35 — Organization isolation** Another organization's databases, members, jobs, keys and audit events answer not found, even under a shared database name.
- **DP-36 — Version header and envelope** Every /api/v2 route checks API-Version before the credential, and every answer but a bodyless 304 or an audit CSV carries the envelope with a fresh lowercase version 4 request id; in the audit CSV every field starting with =, +, -, @, tab or carriage return gets a leading single quote before quoting, while the JSON answer is unchanged.
- **DP-37 — Sign in with bearer tokens** Seeded members sign in with their roles, bad credentials are refused alike, sign out revokes the token, and ten failed sign-ins pause one email.
- **DP-38 — Two-step sign-in** A member turns on two-step sign-in with RFC 6238 codes, after which sign in needs a fresh code or an unused recovery code.
- **DP-39 — Security headers** HTML answers carry the pinned security headers, API and console answers are not cached, and no page carries a secret beyond the pinned one-time displays.
- **DP-40 — Members and the last owner** Owners add, re-role and remove members, a new member is emailed once, and an organization always keeps at least one owner under racing demotions.
- **DP-41 — Audit events** Every successful administrative action writes exactly one audit event, and none for a refusal or a replay.
- **DP-42 — Settings security controls** Settings offers Sign out everywhere, a password change, two-step sign-in set up and turned off, and links to keys and billing for owners only.
- **DP-43 — Feedback** Feedback must name a successful query of the same organization and stops at 100 records in a rolling minute with Retry-After.
- **DP-44 — Contact message limit** One email address may store at most 3 contact messages in a rolling 60 minutes.
- **DP-45 — List limits and filters** Audit pages, search result limits and graph predicate filters accept their range and refuse every value outside it.
- **DP-46 — Usage bill** The usage bill follows the pricing arithmetic in whole cents with the plan minimum as a floor, and the console list, Stats, billing page and daily series agree with it.
- **DP-47 — Price calculator** The landing calculator computes Ship and Scale estimates by the same arithmetic and refuses malformed values beside the field.
- **DP-48 — Key query rate limits** API key queries are limited per key by the current plan with rate limit headers, while sessions are not.
- **DP-49 — Sign in and sign out** Signed-out console routes land on sign in carrying the page as next, the session survives a reload, and sign out returns home.
- **DP-50 — Console surfaces** The console is a sidebar-nav workspace with table-first lists, and every action answers with a toast carrying its outcome.
- **DP-51 — Ending sessions** Sign out everywhere ends every session of the member, and a password change ends every other session.
- **DP-52 — Password reset by email** A member resets a forgotten password from a single-use emailed link, and the request reveals nothing about unknown emails.
- **DP-53 — Landing page content** The landing page and the contact page carry every pinned section, copy and figure of the captured site, recast.
- **DP-54 — Hero views** The hero switches between the Text view and a Graph view of 21 nodes and 20 lines by arrow keys, and its heading holds on two lines.
- **DP-55 — Header, menu and star chip** The header links to the sections, marks the section in view, opens the Resources menu by pointer and keys, and shows the star count from the saved code host answer.
- **DP-56 — Night notebook look** Pages are near-black with a hairline grid, one monospaced face in the closed type scale, one signal orange, frosted glass and capsule buttons.
- **DP-57 — Responsive layouts** Phone, tablet and desktop layouts place the header, plans, architecture panels, benchmark cells and console rows as pinned.
- **DP-58 — View this page as** Both public pages offer the View this page as switch that opens a markdown reader with the size and token estimate.
- **DP-59 — Accessibility contract** Every page meets WCAG 2.2 AA, offers a skip link first and a keyboard-only focus ring, and never scrolls sideways.
- **DP-60 — Motion moments** Every listed motion moment runs as a browser-reported animation on its own trigger, and decorative loops move only position.
- **DP-61 — Reduced motion** Under reduced motion every loop stops and every transition happens in the same frame as its trigger.
- **DP-62 — Contact form** The contact form stores valid messages only, thanks robots caught by the website trap without storing them, and keeps typed text on a refusal.
- **DP-63 — Not-found answers** Unknown pages answer a custom 404 page with a link home, unknown API routes answer 404 ROUTE_NOT_FOUND in the envelope, and bodies over 2 MB are refused.
- **DP-64 — Markdown twins** The landing and contact pages each answer a markdown twin with the pinned front matter, headings and navigation tail.
- **DP-65 — Health and deployment** The app answers the health route in the envelope, keeps serving for the whole run, and sends data only to its own address.
- **DP-66 — PostgreSQL holds every record** Every pinned table and column lives in PostgreSQL, every secret but the two-step sign-in secret is stored only as a digest, and the store rules hold after any mix of writes.
- **DP-67 — Code host mock** GET /api/code-host/repo answers the saved full_name and stargazers_count and never calls the public code host.
- **DP-68 — Declared facts only** There is no self sign-up and no fact extraction: only declared facts enter the graph.
- **DP-69 — Performance at scale** A keyword search and the source list answer within 1 second with 2000 sources, and the audit log pages within 500 milliseconds with 1000 events.
- **DP-70 — Mail through Mailpit** Every notice travels over SMTP to Mailpit at SMTP_HOST and SMTP_PORT.
- **DP-71 — Role changes apply at once** Role changes and removals take effect on the very next request of every issued token and on the next console page.
- **DP-72 — Key notices** Rotating or revoking a key emails every owner the pinned notice once.
- **DP-73 — Recovery codes** Each recovery code signs in once and is never stored readable.
- **DP-74 — Audit page** The audit page lists events newest first 20 at a time with Load more and keeps its action and actor filters in the address.
- **DP-75 — Deleting a database** Deleting a database removes everything it holds at once and frees its name, as qualified in Business rules, and racing creations of one name make one database.
- **DP-76 — Source scope** A source is addressed by database, collection and id together.
- **DP-77 — Restore a deleted source** A deleted source comes back exactly as it was in one restore entry, from the API or the Undo of its toast.
- **DP-78 — Replace and delete end state** A source replaced by a new version and then deleted leaves search, history, counters and the write log in the exact pinned state.
- **DP-79 — Export jobs** An owner exports a ready database as a job that moves by server time to succeeded, snapshots the database at its lsn and emails the requester once.
- **DP-80 — Import** An owner imports an export document as a new database whose answers equal the original's under the pinned equivalence rules, every source at version 1.
- **DP-81 — Live region and toast stack** The live region announces the pinned result lines, and toasts stack newest on top, at most three, each leaving after 6 seconds.
- **DP-82 — Pinned refusal messages** Every refusal carries the exact code, status, message and field of the refusal catalogue in the exact envelope.
- **DP-83 — Exact shapes** Every successful enveloped answer carries exactly the named keys in data, meta and error.
- **DP-84 — Audit log paging and CSV** The audit log pages newest first by a stable cursor that never repeats or skips, and answers the same rows as CSV.
- **DP-85 — Racing deletes and guarded ingests** Of simultaneous deletes of one source exactly one succeeds and the rest answer 404 SOURCE_NOT_FOUND, and of simultaneous ingests carrying the same live if_version exactly one is accepted and the rest answer 409 VERSION_CONFLICT, with one write log entry each time.
- **DP-86 — Unstorable characters and NFC lengths** Every length limit counts code points after NFC normalization while the value is stored as typed, and any string holding NUL, a C0 control other than tab, line feed or carriage return, or a lone surrogate is refused on its dotted path with nothing stored.
- **DP-87 — Plan switch racing creation** Plan switches and database creations racing in one organization are decided one at a time, so an organization never holds more than 3 databases while on Ship and each real plan change writes one audit event and one email per owner.
- **DP-88 — Unpublished methods refused** A published /api path called with a method it does not publish answers 405 METHOD_NOT_ALLOWED in the envelope with an Allow header listing its methods, before the version, credential and role checks.
- **DP-89 — Emptied key scope sees nothing** Deleting a database removes it from every key scope at once, and a key whose scope is emptied lists no database and gets 404 for every database, never all of them.
- **DP-90 — Derived surfaces stay in the organization** Idempotency keys, audit filters, usage figures and feedback lookups belong to one organization, so equal key values or names in another organization never replay, reveal or move anything.
- **DP-91 — Unknown and removed emails look alike** Sign-in answers for an unknown email, a removed member's email and a wrong password are identical in status, body shape and headers, including the pause after ten failures.
- **DP-92 — Bounded feedback bodies** Feedback metadata and ground truth are bounded in entries, key pattern, value length and id count at every depth, and a refused feedback body spends none of the organization's feedback quota.
- **DP-93 — Bill keeps incurred usage** Deleting a database or source keeps the tokens already ingested in the bill and the daily series while storage drops, and the bill, the daily series and every Stats figure stay consistent after each write.
- **DP-94 — Plain console return paths** After sign in, with or without scripts, the next value is honoured only when it is a plain /console path under the pinned rule, and every other value lands on /console.
- **DP-95 — Unparseable bodies and scriptless contact** A body that is not valid JSON answers 400 MALFORMED_JSON in the envelope, no answer is ever a server error or carries internals, and the contact form stores and thanks or refuses beside its field with scripts off.
- **DP-96 — Deleted database leaves no copy** A deleted database leaves no title, text, fact, query, export or idempotency record of it in PostgreSQL, keeping only its token rows and audit events, as qualified in Business rules.
- **DP-97 — Audit attribution outlives the actor** Audit events keep their actor email, detail, id and time unchanged after the actor is re-roled, removed or re-added, and no route edits or deletes them.
- **DP-98 — Restore keeps original sequence numbers** Restored facts keep the log sequence numbers they were ingested with, so ties and history read exactly as before the delete, and only the restore entry takes a new number.
- **DP-99 — Import checks identities inside the document** An import refuses a repeated source id within a collection, a repeated collection name, an unknown key and a bad version at their exact document path before any database is created.

## Frontend

### Screens and layout (DP-11, DP-31, DP-49, DP-50, DP-57)

The information architecture is this route map.

| Route | Purpose | Auth |
|---|---|---|
| `/` | landing page | public |
| `/contact` | contact sales form | public |
| `/login` | sign in | public |
| `/console` | database table with the inline create row | any member |
| `/console/db/{name}` | database workspace with the tabs Sources, Graph query, Search, Entity, Stats, Explore | any member |
| `/console/settings` | members | any member; changes `owner` only |
| `/console/settings/keys` | API keys | `owner` |
| `/console/settings/billing` | plan and usage | `owner` |
| `/console/settings/audit` | audit log | `owner` |
| `/forgot` | ask for a password reset link | public |
| `/reset?token=` | set a new password from a reset link | public |
| `/?md`, `/contact?md` | markdown twin of the page | public |
| `/?view=ai`, `/contact?view=ai` | the page with its markdown reader open | public |

**Entry and redirects.**

- Signed out, every `/console` route lands on `/login?next=<path>`. After sign in, the member lands on the page chosen by the return-path rule in Business rules (Sessions).
- An editor or viewer who opens `/console/settings/keys`, `/console/settings/billing` or `/console/settings/audit` sees a page reading `You do not have access to this page` and nothing of that panel.
- A database name that does not exist in the member's own organization shows `Database not found`, whether or not another organization uses that name.
- Every console page carries a `Sign out` button. Signing out returns to `/` at once. The session survives a reload.
- An address matching nothing answers a real not-found status on the site's own surface.

**Addresses carry state.** The workspace address names its tab with `?tab=`, one of `sources`, `graph`, `search`, `entity`, `stats` and `explore`. Each tab also keeps these parameters:

| Tab | Parameters |
|---|---|
| Sources | `collection`, `sort`, `filter` |
| Graph query | `statement`, `as_of` |
| Search | `words` |
| Entity | `entity`, `as_of` |
| Explore | `as_of`, `predicates`, `node` |

Opening such an address shows that tab already answered. Choosing a tab, running a statement, searching, looking up, sorting, filtering or moving the timeline rewrites the address without reloading, and a reload shows the same thing again. The audit page keeps `action` and `actor` in its address the same way.

**Surfaces.** The console is a `sidebar-nav` workspace: a fixed left rail with `Databases`, `Settings`, the organization name, the signed-in email and a role badge.

- Every console list is table-first. `/console` is a table of databases whose names link to `/console/db/{name}`, and each workspace tab leads with its table.
- Creating is an inline row. The create database row sits at the top of the `/console` table, and the ingest row opens at the top of the Sources table.
- Feedback is a toast. Every action shows a toast carrying the outcome: `Database created`, `Source ingested`, `Source deleted`, `Source restored` and `Feedback sent` on success, and the server's error message on a refusal. The row or form keeps what was typed.
- Density is generous on public pages and compact in the console. Public pages keep the announcement bar, the frosted sticky header and long dark sections.

**Three layouts with names.** `phone` is 375 by 812, `tablet` is 768 by 1024 and `desktop` is 1280 by 800. No layout scrolls the page sideways.

| Layout | Arrangement |
|---|---|
| `phone` | Everything stacks into one column. The header collapses to the wordmark, the compact star chip and a menu button that opens a full-width sheet. The Graph view becomes a vertical chain of the same 21 nodes. Benchmark cells pair up. Plan cards stack in one column. Console tabs scroll sideways inside their own strip. Console tables become stacked cards, each database card showing the name above its status. |
| `tablet` | Feature and plan grids use two columns. The architecture panels stack. |
| `desktop` | The architecture panels sit side by side. The four plans share one row. |

### Public screens and controls (DP-14, DP-19, DP-27, DP-32, DP-42, DP-46, DP-47, DP-53, DP-54, DP-55, DP-58, DP-62, DP-74)

**Global chrome.**

- **Announcement bar.** Public pages open with an announcement bar reading `Announcement` and `Tessel is open source`, with a link `View on code host`. It scrolls away.
- **Header.** Under it a sticky frosted header carries, in order:
  - the wordmark `Tessel`;
  - the links `Architecture`, `Benchmarks` and `Pricing` to the matching sections, whose element ids are `architecture`, `benchmarks` and `pricing`;
  - a `Resources` button whose menu lists `FAQs` (`Common questions`), `Blog` (`Engineering and product notes`), `Alternatives` (`How Tessel compares`) and `Join Community` (`Connect with us on chat`);
  - a `Docs` link;
  - the star chip;
  - `Log in`, and an orange `Sign up` capsule. Both lead to `/login`.
- **Star chip.** It reads `Star` and the count from `GET /api/code-host/repo`.
  - From tablet width up to desktop it shows the full count with a thousands comma: `13,062`.
  - On the `phone` layout it shows the compact form: the count divided by 1000, rounded half up to one decimal, with a trailing `.0` dropped and `k` appended, so `13.1k`. Counts under 1000 show as they are.
  - The chip keeps the count in the browser under `tessel-stars`, with the time it was read, and reuses it for one hour. While the count is unknown it shows `Star` alone.
- **Footer.** It carries:
  - `Our mission is to make AI stateful`;
  - four link columns of plain text, in order:
    - `Home`: `Why Tessel? Manifesto`, `Architecture`, `Contact`;
    - `Use cases`: `Company brain`, `Code`, `Memory`, `Finance`, `Beyond vector databases`;
    - `Compare`: `Tessel vs FalkorDB`, `Tessel vs Neo4j`, `Tessel vs Memgraph`, `Tessel vs Dgraph`, `Tessel vs Amazon Neptune`, `Tessel vs ApertureDB`;
    - `Legal`: `Trust center`, `Privacy policy`, `Terms of Service`;
  - the stats row: `13k` stars, `1M` retrievals per month, `4x` improvement in agent recall and `2k` devs;
  - the words `SOC 2`, `GDPR` and `HIPAA` in small capsules;
  - the line `(c) 2026 Tessel Labs, Inc`.
- **Console pages** replace the header with the console rail.
- **Skip link.** A skip link reading `Skip to main content` is the first focusable element on every page.
- **Section in view.** While a landing section is in view:
  - a faint, barely rounded raised pill sits behind the header link that leads to it;
  - that link is marked as the current location (`aria-current="true"`);
  - the FAQ marks `Resources`;
  - exactly one link is marked at a time, and none above the first section.
- **Header rule.** Once the page has scrolled past the hero, a hairline signal orange rule shows along the header's bottom edge. It goes away again at the top.

**View this page as.** Both public pages carry a small switch fixed at the bottom centre of the window: a radio group labelled `View this page as`, with `Human` (checked) and `AI`, moved by the arrow keys.

- Choosing `AI` adds `?view=ai` to the address and opens a full-window reader of the page's markdown twin. The reader shows:
  - a top bar reading `GET <path>` and `Accept: text/markdown`;
  - the size line `<s> KB . ~<t> tokens`;
  - a `Copy` button and a `Raw` link to `<path>?md`;
  - the markdown, with a line number beside every line and heading marks in signal orange.
- The placeholders in the size line:
  - `<s>` is the byte length of the twin divided by 1024, with one decimal, rounded half up.
  - `<t>` is the twin's character count divided by 4, rounded down. Under 1000 it is a whole number. From 1000 up it is thousands rounded down to one decimal followed by `k`, so 2517 reads `2.5k`.
  - The separator between the size and the tokens is a space, a middle dot and a space on screen, written here as `.`.
- Escape or choosing `Human` closes the reader and drops `?view=ai`. Opening an address with `?view=ai` opens the reader at once.
- The console carries no switch.

**Hero.**

- The heading reads `Give agents ability to retrieve the most accurate context`.
- Under it, a radio group with `Text` and `Graph` (`Text` checked first) swaps the view panel. It is operable with the arrow keys and Space.
- **Text view.** It reads `Tessel stores decisions, facts, docs, relationships, knowledge, and how it all evolves, including what changed, when, and why, so your agents can understand and act on the right context, always. At any scale or complexity`, and then `The fast and scalable graph database, built on object storage for 10-100x lower costs, with assisted graph creation to save you time building and organizing your graph. Built for intelligent agents that deserve fast, accurate retrieval`.
- **Graph view nodes.** It shows exactly `21` labelled nodes joined by `20` thin lines. The nodes are `Tessel`, `stores`, `decisions`, `facts`, `docs`, `relationships`, `knowledge`, `how it all evolves`, `including`, `what changed`, `when`, `why`, `so`, `agents`, `can understand and act on`, `the right context`, `built on`, `object storage`, `for`, `10-100x lower costs` and `with assisted graph creation`.
- **Graph view lines.** They join, in this edge order:

  | From | To |
  |---|---|
  | `Tessel` | `stores`, `built on`, `with assisted graph creation` |
  | `stores` | each of `decisions`, `facts`, `docs`, `relationships`, `knowledge`, `how it all evolves` |
  | `how it all evolves` | `including` |
  | `including` | `what changed`, `when`, `why` |
  | `why` | `so` |
  | `so` | `agents` |
  | `agents` | `can understand and act on` |
  | `can understand and act on` | `the right context` |
  | `built on` | `object storage` |
  | `object storage` | `for` |
  | `for` | `10-100x lower costs` |

- The `Tessel` node is filled orange. The Graph view is drawn as inline vector graphics and carries a hidden copy of the sentence, so a screen reader hears it once whichever view shows.
- Under the panel sit `Sign up` and `Talk to us`. The second leads to `/contact`.

**Landing page.** After the hero, in order:

1. **Logo strip.** `Trusted by teams building world-class agents`, with ten customer names as grey text (`toptal`, `composio`, `smallest.ai`, `hsv.digital`, `gio`, `confida`, `clinsight`, `klubi`, `Pocket`, `Distyl`) fading out at both ends.
2. **Feature grid.** `The GraphDB purpose-built for agents`, with four cards:
   - `High recall accuracy` (`94%`, `Search accuracy`);
   - `For cost efficiency and scale` (a three-tier stack `Hot cache`, `Warm storage`, `Default storage`, drawn as three stacked bordered bars);
   - `Recall everything`;
   - `Built for low latency` (`< 200ms`, `So you can build real-time applications`), over seven thin lanes hidden from assistive technology.
3. **Architecture.** The section `Architecture`, with the line `Built on object storage, with separate compute for writes, indexing, and reads. A graph core designed for speed, affordability, and scale`. Every connector in the drawing is a dotted line, and the drawing carries a written equivalent. It shows two panels:
   - The orchestration panel holds `User`; `Request understanding` (`routing`, `entity extraction`, `query rewrite`, `safety flags`); `Retrieval orchestrator` (`Cypher reads / writes`); and the plugins `Vectorstore` (`semantic + bm25 + rerank`), `Connectors` (`100+ sources: workspace, email, CRM`) and `DB filters` (`SQL / NoSQL`).
   - The core panel holds `NAMESPACE` (`multi-tenant isolation, auto-scalable`); `Writer node` (`Cypher writes -> WAL + value log`); `Indexer node` (`reads WAL entries -> builds index`); `Reader node` (`Cypher queries -> index + pending WAL = strongly consistent`); `Unified storage`, with `namespace/data/wal`, `namespace/data/value`, `namespace/index` and `namespace/manifest.json`; and the tiers `Hot` in-memory cache, `Warm` NVMe SSD and `Cold` object storage.
4. **Use case tabs.** `What do you use graphs for?`, with `Company brain`, `Multiplayer agent apps`, `Ontologies`, `Agent memory` and `Knowledge graphs`. Each has a description, a heading and three points. `Company brain` reads `Give your agents the context to move work forward` and `Agents are as smart as the context they have`. The selection follows the arrow keys, Home and End.
5. **Benchmark grid.** `SOTA for agent applications`, with five cells:

   | Figure | Caption | Label |
   |---|---|---|
   | `90.79%` | `Overall accuracy` | `LONGMEMEVAL-S` |
   | `90.73` | `Score out of 100` | `CODEWIKI-BENCH` |
   | `88.7` | `Overall score` | `ENTERPRISE RAG BENCH` |
   | `82%` | `Overall, 10 dimensions` | `BEAM 1M` |
   | `91.4%` | `Recall@10` | `FINANCEBENCH` |

   At rest a cell shows only its number, unit, caption, label and arrow. Behind a hovered or focused cell four layers light: an orange wall fading upward from the bottom of the cell, a bright orange top edge, a soft blurred cone and a round blurred bloom.
6. **Chart.** `Accuracy vs context length`, with ticks `8K`, `32K`, `64K`, `96K` and `115K` conversation tokens. The series `Tessel`, `VectorDB` and `Full context` end at `90.79%`, `71%` and `38%`. A table equivalent accompanies the chart.
7. **Comparison tabs.** `Similarity isn't relevance`, with `Vector databases` and `SQL databases`. Each tab pairs `Similar is not relevant` with `Relevant, stateful context`, `Missed relationships` with `A full structured view`, `Forgotten sessions` with `Personalized recall`, and `Four stitched systems` with `One unified layer`. Each pair is joined by a signal orange right arrow drawn inline.
8. **Pricing.** Described below.
9. **FAQ.** Element id `faq`, with five questions: `What makes Tessel different?`, `Who is Tessel for?`, `Why can't I just use Postgres for this? Or pgGraph?`, `When should I use Tessel instead of a vector database?` and `Does Tessel work with GraphRAG?`. Each question is a button that opens and closes its answer, and several can be open at once.
10. **Testimonials.** Eight short testimonials, each with a handle and initials in a raised circle.

**Pricing and calculator.** Four plan cards:

| Plan | Price line | Contents |
|---|---|---|
| `Open Source` | `Self host` | Run Tessel yourself, S3-compatible storage, existing Neo4j drivers and openCypher, import graphs, community support. |
| `Ship` | `$25/mo min usage` | Fully managed, `Storage: $0.50/GB-month`, ontology engine `$5 per 1M tokens ingested`, `100+` app connectors, advanced logs and monitoring. |
| `Scale` | `$300/mo min usage` | Everything in Ship, dedicated infrastructure, `Storage: $0.25/GB-month`, `$5 per 1M tokens ingested`, uptime SLA, private chat channel, SOC 2 and GDPR. |
| `Enterprise` | `Custom` | Your cloud or a dedicated cloud, forward-deployed engineer, `99%` uptime SLA, HIPAA BAA, `Talk to us`. |

The calculator has two fields, `Storage (GB)` and `Tokens ingested per month (millions)`.

- Each field takes a number from `0` to `100000`, both ends allowed, with at most one decimal.
- On every input the calculator shows the Ship and Scale monthly estimates by the pricing arithmetic in Business rules, with `minimum applies` beside a plan charged its minimum. `Open Source` shows `$0.00` and `Enterprise` shows `Custom`.
- A value written with an exponent, a leading plus sign, a comma or a trailing dot (`1e3`, `+5`, `1,5`, `12.`) is invalid. An invalid value shows `Enter a number from 0 to 100000 with at most one decimal` beside its field and leaves the last estimates in place.
- For example: `100000` GB and `100000` million tokens read Ship `$550,000.00` and Scale `$525,000.00`; `0.1` GB and `0` tokens read Ship `$25.00` with `minimum applies`.

**Console.**

- **Sign in.** `/login` has the fields `Email` and `Password` and a `Sign in` button. A failure shows the `BAD_CREDENTIALS` message and never says which field was wrong.
- **Database table.** The `/console` list shows each database's name, status (`provisioning` in yellow, or `ready`), collections, sources, pending log entries, index generation and created time, sorted by name, or `No databases yet`.
- **Create row.** Owners see the inline create row at the top of the table. It has one field `Name`, a `Create` button and the helper `Lowercase letters, digits and underscores; 3 to 32 characters; starts with a letter`. A refusal shows the server message beside the field and in the toast. After creating, the table shows the new row as `provisioning` and changes it to `ready` by itself.
- **Owner-only row controls.** Owners also see `Delete` on each row, and the button `Import database` above the table. `Import database` opens the fields `Export document` and `New name` with the button `Import`. The new row appears as `provisioning` and turns `ready` by itself. Editors and viewers see neither the create row, a database `Delete`, nor `Import database`.
- **Delete dialog.** Deleting a database opens a modal dialog titled `Delete database <name>`, with the field `Type the database name to confirm` and the buttons `Delete database` and `Cancel`. `Delete database` stays disabled until the field holds the name.

The workspace tabs:

- **Sources.**
  - A collection picker (default `default`) and a table of ID, Title, Version, Tokens, Facts, Status (`In write log` or `Indexed`) and Ingested, sorted by id.
  - The headers `ID`, `Title`, `Version`, `Tokens` and `Ingested` are sort buttons that toggle ascending and descending and expose the order (`aria-sort`).
  - A `Filter sources` box keeps rows whose id or title contains the typed text, ignoring case. Sort and filter live in the address (`sort=token_count` or `sort=-token_count`, `filter=`).
  - Editors and owners see `Edit` and `Delete` on each row, and an `Ingest source` button that opens the inline ingest row.
  - `Edit` opens the ingest row filled with that source's id, title and text, and sends the version it showed as `if_version`.
- **Inline ingest row.** It has:
  - `Collection` (default `default`), `Source id` (optional), `Title` and `Text`;
  - a facts editor of rows `Subject`, `Predicate`, `Object`, `Valid from` and `Reason`, with `Add fact` and `Remove`;
  - an `Ingest` button that sends it.
- **Graph query.**
  - A `Statement` editor with an `As of` field (empty means now) and a `Run` button, also triggered by Ctrl+Enter or Cmd+Enter.
  - Three example statements as buttons.
  - A results table headed by the returned columns.
  - The line `Served from index generation {g} at LSN {l} plus {w} pending write log entries`, with `{g}`, `{l}` and `{w}` filled from `served_from`.
  - Errors show with their code under the editor without clearing the last results.
- **Search.**
  - A `Words` box, a `Collections` choice, a `Result limit` and a `Search` button.
  - Results show id, title, score with four decimals, and the snippet.
  - Each result has `Not useful`, which opens a feedback form of `Rating` and `Comment` sent with `Send feedback`.
- **Entity.**
  - An `Entity name` field, an `As of` field and a `Look up` button.
  - Then outgoing and incoming relations, and a history grouped by predicate showing object, valid from, superseded at or `current`, reason and source.
  - Every entity name is a link to that entity.
- **Stats.**
  - The counters `Sources`, `Facts`, `Entities`, `Last LSN`, `Indexed LSN`, `WAL pending`, `Index generation`, `Tokens ingested` and `Storage bytes`.
  - `Compact` for editors and owners, which reports `Folded {n} entries into generation {g}` or `Nothing to fold`.
  - `Export` for owners.
- **Explore.**
  - **Graph.** The graph true at the timeline position, drawn from the graph route. Every entity is a button named by its display name and drawn as a chip; every active fact is a thin line labelled with its predicate.
  - **Timeline.** A slider labelled `As of moment` steps through the distinct `valid_from` moments of the database's live facts, in ascending order, and then `now`. Its spoken value is the moment it stands on, or `now`. It starts on `now`. An address whose `as_of` falls between two moments draws the graph as of that time, with the slider on the latest moment not after it.
  - **Predicate filter.** A group labelled `Predicate` holds one checkbox per predicate present, all checked. Unchecking one hides its edges and any node left without one.
  - **Find entity.** A `Find entity` box marks in signal orange every node whose display name contains the typed text, ignoring case. A line reads `N matching entities`, or `1 matching entity`.
  - **Inspect.** Selecting a node fills it signal orange, marks it pressed (`aria-pressed="true"`) and opens a region titled `Inspect <name>`. The region lists the node's relations under `Outgoing` and `Incoming`, each line `<predicate> <other>`, in the order of the relations route.
  - **Summary.** A line reads `N entities, M relations`. A table with the columns `Subject`, `Predicate`, `Object`, `Valid from` and `Source` lists the same edges.
  - **Empty moment.** A moment with no facts shows `No facts at this moment`.

Viewers see no `Ingest source`, no source `Edit` or `Delete`, and no `Compact`. Every console page draws its controls from the member's role at the moment it loads, so a member demoted a moment ago sees the controls of the new role on the next page. The rail marks the current page (`aria-current="page"` on `Databases` or `Settings`).

**Settings.**

- **Members.** `/console/settings` shows the email and role of each member.
  - Owners add a member with the fields `Email`, `Role` and `Initial password` and the button `Add member`.
  - Owners change a role with the `Role` choice on its row, and remove a member with `Remove`.
  - Editors and viewers see the members list and their own role only.
  - The settings rail links to the keys, billing and audit panels for owners only.
- **Every member** also sees:
  - `Sign out everywhere`;
  - `Change password`, with `Current password`, `New password`, `Confirm new password` and the button `Change password`;
  - `Two-step sign-in`, reading `Off` or `On`, with the button `Set up two-step sign-in` while it is off. Setting up shows:
    - the setup key, in groups of four characters separated by spaces;
    - the key address as text;
    - the field `Code from your app` and the button `Turn on`.

    A valid code shows the ten recovery codes once, beside `Save these recovery codes now. Each works once.`. Turning two-step sign-in off asks for a code and `Turn off`.
- **API keys.** `/console/settings/keys` shows owners a table of name, role, prefix and created time.
  - Creating a key uses the fields `Key name` and `Key role`, a scope choice of `All databases` or chosen databases, and the button `Create key`.
  - A new key's secret shows once, beside `Copy this key now. It will not be shown again.`.
  - Each row offers `Rotate`, which shows the new secret once beside the same note, and `Revoke`.
- **Billing.** `/console/settings/billing` shows owners:
  - the current plan, with the buttons `Switch to Ship` and `Switch to Scale`;
  - this month's bill in dollars: tokens ingested, storage bytes, ontology charge, storage charge, usage, minimum and billed;
  - the chart `Tokens ingested by day`, with one bar per day of the current UTC month from the first to today. Today is marked. Bar heights are proportional to the day's tokens, with the largest bar at full height;
  - a table of `Day` and `Tokens` with the same numbers;
  - the line `N tokens this month`.
- **Audit.** `/console/settings/audit` shows owners a table of `Time`, `Actor`, `Action`, `Target` and `Detail`, newest first, 20 rows at a time, with `Load more`. It is filtered by an `Action` choice and an `Actor` field, both kept in the address. A filter with no events reads `No audit events match these filters`.

**Password pages.**

- `/login` carries the link `Forgot password?` to `/forgot`.
- `/forgot` has a form with `Email` and `Send reset link`. It always answers `If that email belongs to a member, a reset link is on its way.` in place of the form.
- `/reset?token=` shows `New password`, `Confirm new password` and `Set password`. Success leads to `/login` reading `Your password was reset. Sign in with the new one.`. A link that is no longer valid shows the `RESET_TOKEN_INVALID` message and a link `Request a new link` to `/forgot`, with no form.
- For a member with two-step sign-in on, a right email and password lead to a second step on the same page: the field `Authentication code` and `Verify`, with the link `Use a recovery code`, which relabels the field `Recovery code`.

**Contact.** `/contact` carries:

- the heading `Contact sales`;
- the line `A complete graph of context for your agents. We make your knowledge agent-ready so your AI keeps working in production.`;
- a panel titled `Agent benchmarks` holding three metric links: `88.7%` `EnterpriseRAG`, `90.79%` `LongMemEval` and `91.4%` `FinanceBench`. Each reads `Read results` and leads to the benchmark section;
- an `Open source` card linking `tessel-labs/tessel` with the arrow icon;
- a panel `Included with Enterprise` listing `99% SLA`, `Dedicated cloud or BYOC`, `HIPAA BAA` and `Private Slack, dedicated FDE`, each behind a small signal orange plus;
- a `Book a call` link to the form;
- the form, with the fields `Work email` and `Message` and the button `Send message`. A hidden field named `website` traps robots.

### Interactions (DP-11, DP-24, DP-32, DP-55, DP-58, DP-59)

- **Resources menu.** It opens on click, Enter or Space. It closes on Escape, on a click outside or on a second click. Escape returns focus to the button.
- **Arrow-key groups.**
  - The hero switch, the use case tabs, the workspace tabs and the `View this page as` switch follow the arrow keys.
  - The use case tabs also follow Home and End.
  - The Explore slider moves by the arrow keys, Home and End. Every move redraws the graph and rewrites `as_of` in the address.
  - A focused Explore node passes focus to the previous or next node in key order with the arrow keys.
- **Explore node selection.** Selecting an Explore node works by click or Enter.
- **Delete dialog.**
  - Opening it moves focus into the dialog, and `Tab` and `Shift+Tab` stay inside it.
  - Escape or `Cancel` closes it and returns focus to the row's `Delete`.
  - Typing the exact name enables `Delete database`.
- **Run shortcut.** `Run` is also triggered by Ctrl+Enter or Cmd+Enter.
- **Ingest conflicts.** On a version conflict, the ingest row keeps what was typed and shows the server message beside `Title`.
- **Deleting a source.** `Delete` on a source row removes the row and shows the `Source deleted` toast with `Undo`. `Undo` restores the source, puts the row back and turns the toast to `Source restored`.
- **Exporting.** `Export` shows `Export queued`, then `Export running`, then `Export ready` with a `Download` link, all without a reload.
- **Answering in place.** Console actions answer in place without leaving the page. Pressing `Create` or `Ingest` twice quickly writes once and shows one success toast.
- **Contact form.** It works with scripts on (answering in place) and with scripts off (posting as a plain document, per Business rules).
- **Sign-in form.** It works with scripts on and with scripts off in the same way.
- **Hover feedback.**
  - Inline links turn from translucent white to signal orange while a dotted signal orange underline appears.
  - The star chip lightens, and the `Sign up` capsule brightens.
  - A contact metric link turns signal orange on its top and side borders while its bottom border stays dark.
  - `Book a call` brightens to a lighter orange.
  - `Send message` rests as grey text on a raised dark fill. On hover it turns to near-black text on the lighter orange.

### Visual design (DP-56, DP-57)

The north star is a night-time engineering notebook, exact and calm, where every number can be read twice and trusted. The palette, type and shape language below are requirements, not preferences. Everything not pinned here is yours, provided it holds these rules.

**Palette roles.**

| Role | Colour | Used for |
|---|---|---|
| void | near-black neutral, the darkest | page background behind the hairline grid |
| panel | near-black neutral, a step lighter | header base, cards, the console rail |
| raised | near-black neutral, two steps lighter | inputs, table headers, the query editor |
| hairline | very dark neutral grey | the vertical grid lines and every thin divider |
| line strong | dark neutral grey | card borders and table row separators |
| ink | white | headings and primary text |
| ink 60 | white at sixty percent | body text and secondary links |
| muted | mid neutral grey | captions, timestamps, helper text |
| faint | dark mid neutral grey | disabled and placeholder text |
| signal orange | light, vivid orange | primary buttons, the active tab marker, the focus ring, hovered links, error text |
| signal hover | a lighter, vivid orange | primary button hover |
| amber | light, vivid yellow | `In write log` badges, `provisioning` badges and warnings |

- Success, such as a `ready` badge or a success toast, reads in plain white with no new hue.
- Every status reads in words, never by colour alone.
- Primary capsules carry void-coloured text.

**Shape and glass.**

- The page background is the void colour ruled with fine, even vertical hairlines across the whole page.
- Primary and secondary buttons are fully rounded capsules. Inputs and menus are barely rounded. Cards are a little more rounded, and table wrappers more again.
- The header is frosted glass: a strong blur with a lift in saturation over whatever scrolls under it.
- Menus are a lighter frost, with a faint inner hairline ring and a soft drop shadow. Chips and badges carry the same faint inner ring.
- The focus ring is a thin, solid signal orange outline set slightly apart from the control.
- The logo strip fades to transparent at both ends.

**Type.**

- Every text on every page is set in one even-width monospaced face, `Geist Mono`, an open-licence font, falling back to the system monospace faces when it is not bundled.
- Body text is regular weight. Buttons and table headers are medium. Numeric emphasis is bold.
- The scale is closed. Every text is set at one of twelve sizes from 12 to 25 pixels (12, 13, 14, 15, 15.5, 16, 17, 18, 20, 23, 24, 25). The exceptions are the hero heading and the landing section headings, which are about two to three times the body size.
- The hero heading holds on at most two lines on a wide screen.

**Iconography.** Every icon is drawn inline:

- a block-letter brand mark in orange;
- a small down chevron for menus;
- a diagonal arrow for links that leave the page;
- the code host mark beside the star count;
- a cross that closes;
- a four-pointed spark for highlights.

Icons that only decorate are hidden from assistive technology. An icon that is the only content of a control takes the control's name.

**Zero-asset substitution.** No captured photograph, logo image, avatar, badge image or font file ships. The architecture drawing and the chart are drawn fresh from the values in this brief.

**Contrast and touch targets.** Body text and every button label reach at least 4.5 to 1 contrast. Every control is at least 44 pixels in each direction on the `phone` layout.

### Motion and effects (DP-60, DP-61)

Motion is short and mechanical. Every moment below is an animation the browser itself reports, either a style-sheet transition or animation or a Web Animations one, and never a script timer moving a style by hand. Each one starts as soon as its trigger happens and runs once, unless it is a loop. Transitions finish in under half a second unless the table says otherwise. No unnamed decorative loop exists, and decorative loops move only position.

| Name | When | What a person sees |
|---|---|---|
| word rise | page load | hero words and section headings rise into place from just below their line one after another, quick to start and slow to settle, the fade trailing the rise |
| section reveal | a fifth of a landing section first becomes visible | it slides up a little and fades in, once |
| link colour | hover or focus on an inline link | it warms evenly to orange over about a fifth of a second |
| view swap | the hero view switch or a use case tab changes | a brief fade, quick to leave |
| edge draw | switching the hero to Graph | the 20 edges draw one after another in the hero edge order, so the drawing grows outward from `Tessel` within about one second |
| menu drop | the Resources menu opens | the menu fades in and settles down a hair from just above |
| chevron turn | the Resources menu opens or closes | the small chevron turns half a circle |
| menu wipe | the phone menu sheet opens | the sheet is revealed from its top edge downward |
| logo scroll | always | the customer names glide sideways forever at a slow, readable pace, the track moving by half its width each cycle, and stop under the pointer or focus |
| flow dash | always | each architecture connector's dash crawls along its path in a steady loop |
| latency lanes | while the `Built for low latency` card is in view | each of the seven bars races across its lane forever at its own slightly different quick pace, bars alternating white and amber |
| cell glow | hover or focus on a benchmark cell | the orange wall rises in, the top edge stretches across from nothing |
| view slide | the `View this page as` choice changes | the indicator glides to the chosen option with a long, soft settle |
| header rule | scrolling past the hero, and back | the orange rule fades in, and fades out at the top |
| faq open | an FAQ question is pressed | the answer fades and slides into place while the plus turns into a cross |
| calculator tick | an estimate changes | the changed dollar figure flashes signal orange and returns |
| toast rise | a console toast enters | the toast rises a little into place while it fades in, fast to start and long to settle |
| row remove | a source row is deleted or a toast closes | it fades and lifts away before it goes |
| panel swap | a console tab panel appears | it fades in with a brief lift |
| tab slide | a workspace tab is chosen | the active marker slides to the chosen tab |
| dialog open | the delete dialog or the phone menu opens | the panel grows from just under full size with a snappy settle |
| row flash | a row is created, restored or changed | the row briefly lights and returns |
| provision shimmer | a `provisioning` badge is showing | a band of translucent white sweeps across the badge forever, stopping when the row reads `ready` |
| counter pulse | a Stats counter changes | the card lifts to the raised colour once and settles |
| results stagger | Run, Search, Look up, Load more or a timeline step answers | rows arrive one after another from the top, the rest at once past the twentieth |
| node select | an Explore node is selected or matched | its fill warms to signal orange over a slow beat while its outline sharpens quickly |
| inspector slide | an Explore node is selected | the Inspect region slides in from the right edge |
| press scale | pointer down, or Space held, on any button or capsule | the control shrinks a little and springs back on release |
| sign-in shake | a sign in is refused | the form shakes from side to side twice and settles |

Under the reduced motion preference, every transition and every loop is removed, not only slowed:

- logo scroll, flow dash, latency lanes and provision shimmer stand still;
- words and sections render in place;
- edges are all present at once;
- opening a menu, swapping a view, moving an indicator, pressing a button or receiving rows happens in the same frame as its trigger;
- no content is lost.

### Feedback states (DP-15, DP-16, DP-31, DP-50, DP-81, DP-95)

**Empty states.** Every list has an empty state in words: `No databases yet`, `No sources in this collection`, `No sources match these words` and `No facts mention this entity`.

**Field errors.** A rejected form keeps what was typed and names the error beside the field, including the fact row it belongs to, using the server message.

**Money.** Money reads as dollars with a thousands comma and two decimals. For example, `123450` cents is `$1,234.50`. Every count of 1000 or more shown in the console carries thousands commas.

**Waiting.** Every console panel that asks the server for something marks itself busy (`aria-busy="true"`) until the answer is drawn. Meanwhile the button that sent it shows its waiting label:

| Button | Waiting label |
|---|---|
| `Run` | `Running...` |
| `Search` | `Searching...` |
| `Look up` | `Looking up...` |
| `Ingest` | `Ingesting...` |
| `Compact` | `Compacting...` |
| `Create` | `Creating...` |

**Failing.** A request that fails without an envelope, for example when the server cannot be reached, shows `Something went wrong. Try again.` beside the control in signal orange. It keeps what was typed and the last results.

**Toasts.** Toasts are status messages (`role="status"`). They stack newest on top, at most three at once. Each has a `Close` button and leaves by itself after 6 seconds.

**Live region.** The console announces results through a polite live region (`role="status"`, named `Console announcements`) with exactly these lines:

- `Query answered: N rows`
- `Search found N sources`
- `Source ingested`
- `Folded N entries into generation G`, or `Nothing to fold`
- `Export ready`
- `Database created`

**Sign-in states.**

- A refused sign-in shows the server message above the form.
- After too many failures it shows the `SIGN_IN_THROTTLED` message with its number.
- A wrong two-step code shows `That code is not valid` and never says whether the password was right.
- A session that ended while a console page was open sends the next action to `/login?next=<that page>`, with `Your session has ended. Sign in again.` above the form.

**Settings states.**

- A password mismatch on `/console/settings` or `/reset` reads `The passwords do not match` beside the confirmation.
- A changed password shows the toast `Password changed`.
- A wrong setup code shows `That code is not valid`.

**Contact states.** The same copy shows with and without scripts.

- Success replaces the form with `Thanks. We will reply within one business day.`.
- A refused email shows `Enter a valid email address` beside `Work email`.
- A refused message shows `Write between 10 and 4000 characters` beside `Message`.
- A message over the hourly limit shows the `RATE_LIMITED` message above the form.
- On a refusal the form keeps the typed text.

## Backend

### API (DP-30, DP-36, DP-37, DP-63, DP-82, DP-83, DP-88, DP-95)

`POST /api/auth/login` returns the app's own bearer token for `Authorization: Bearer <token>`. API keys are sent the same way. Every `/api` route reads its credential only from the `Authorization` header.

**Conventions: the envelope.** Every `/api` response is `{"success": bool, "data": object or null, "error": {"code", "message", "field"} or null, "meta": {"request_id", "latency_ms"}}`.

- A success has `error` null.
- A refusal has `success` false, `data` null, a code, the catalogue message and `field`. `field` is the dotted path of the first offending field in request order (such as `sources.0.facts.2.valid_from`), or null.
- `meta.request_id` is a fresh lowercase version 4 UUID on every answer, errors included. `meta.latency_ms` is a whole number of milliseconds.
- There are exactly two exceptions to the envelope, both successes. A `304` answer to a matching `If-None-Match` has no body. The audit route's `200` CSV answer is the CSV text itself. Neither carries a request id in the body or in a header, and neither can be named in feedback.
- A successful call returns exactly the named shape. `data`, and every object named inside it, carries the listed keys and no others. `meta` carries only `request_id` and `latency_ms`, and `error` only `code`, `message` and `field`.

**Conventions: request bodies.**

- Request bodies are UTF-8 JSON objects.
- A body over 2,097,152 bytes as sent is `413` `PAYLOAD_TOO_LARGE`. A body of exactly 2,097,152 bytes is allowed.
- On a route that takes a body, a body that is not valid JSON is `400` `MALFORMED_JSON` with `field` null. That includes an empty body, invalid UTF-8 and truncated JSON.
- Valid JSON that is not an object (an array, string, number, boolean or null) is `400` `VALIDATION_ERROR` with `field` null.
- A body key the endpoint does not define, at any depth, is `400` `UNKNOWN_FIELD` with `field` set to its path.
- A value of the wrong type is `400` `VALIDATION_ERROR` on its field. Any other invalid value is also `400` `VALIDATION_ERROR`.

**Conventions: which refusal wins.** This is the one error-precedence rule for the whole API. A request with several faults gets exactly one answer, the first that applies in this order:

1. An address under `/api` that matches no published path: `404` `ROUTE_NOT_FOUND`.
2. A published path called with a method it does not publish: `405` `METHOD_NOT_ALLOWED`. See below.
3. Under `/api/v2` only, the `API-Version` header:
   - missing: `400` `API_VERSION_REQUIRED`;
   - any value other than `2`: `400` `UNSUPPORTED_API_VERSION`.
4. The credential: none is `401` `UNAUTHENTICATED`. A bearer value that is not a live session token or a live API key is `401` `INVALID_API_KEY`. That includes ended sessions and revoked or rotated-away secrets.
5. The role: a role too low, or any API key on an owner-only or session-only route, is `403` `FORBIDDEN_ROLE`. This holds even when the request names a foreign, unknown or out-of-scope resource.
6. For `POST /api/v2/query` sent with an API key: the per-key query limit, `429` `RATE_LIMITED`.
7. Body size: `413` `PAYLOAD_TOO_LARGE`.
8. Body parsing: `MALFORMED_JSON`, then the non-object `VALIDATION_ERROR`.
9. The `Idempotency-Key` header and its stored answer, in this order: a malformed key; then the replay of a stored answer; then `422` `IDEMPOTENCY_KEY_REUSED`; then `409` `IDEMPOTENCY_IN_PROGRESS`. An idempotent replay returns its stored response before any later check.
10. Field checks: `UNKNOWN_FIELD` and `VALIDATION_ERROR`, query parameters first and then the body, each in request order.
11. On `POST /api/auth/login` only: the sign-in pause, then the password, then the two-step code.
12. Lookups: `404` for an unknown, other-organization or out-of-scope database, source, collection, member, key, job or request id. A key's database scope is applied inside this lookup.
13. State conflicts: `409`, for example `DATABASE_NOT_READY`, `VERSION_CONFLICT`, `SOURCE_IS_LIVE`, `DATABASE_ALREADY_EXISTS` or `LAST_OWNER`.
14. Allowances, checked last: `403` `PLAN_LIMIT`, then `429` for feedback and contact messages.

Endpoint rows and rules below name only their own extra refusals. The graph language's own refusal codes (`READ_ONLY_QUERY`, `CYPHER_SYNTAX`, `CYPHER_SEMANTIC`) are field checks of the `cypher` value at step 10, ordered among themselves as stated in Business rules.

**Conventions: refusals change nothing.** A refusal leaves every domain record exactly as it found it. No database, collection, source, fact, log entry, counter, usage, member, session, key, plan, job, feedback, contact message, audit event, idempotency record or email is created, changed or removed. The only things a refusal may record are the accounting this brief names:

- a failed sign-in counts toward that email's pause;
- a query that reaches step 6 or later with an API key counts toward that key's limit (a `429` does not);
- a request the key authenticated sets its `last_used_at`.

No answer is ever status 500. No answer carries `detail`, `Traceback`, a database driver or library name, SQL text or a file path.

**Conventions: methods.** A path under `/api` that matches a row of the route tables below, but not the method sent, is refused this way:

- **Status and body.** `405` `METHOD_NOT_ALLOWED` with the message `This address does not accept <METHOD>`, where `<METHOD>` is the method as sent in capitals. The answer is in the envelope with a fresh request id, except that an answer to `HEAD` has no body.
- **Allow header.** It lists that path's published methods, in alphabetical order, joined by a comma and a space. For example, `/api/v2/databases` answers `DELETE, GET, POST`, `/api/v2/audit` answers `GET` and `/api/v2/members/{email}` answers `DELETE, PATCH`.
- **Scope.** `HEAD` and `OPTIONS` are never published, so every path answers them this way.
- **Effects.** The answer comes before the version, credential and role checks, and it writes nothing.

**Conventions: the refusal catalogue.** Every refusal carries exactly this message for its code, in the API and wherever the console shows it. `VALIDATION_ERROR` messages are free text; its `field` is pinned.

| Code | Status | Message |
|---|---|---|
| `API_VERSION_REQUIRED` | 400 | `Send the header API-Version: 2` |
| `UNSUPPORTED_API_VERSION` | 400 | `Only API-Version 2 is supported` |
| `MALFORMED_JSON` | 400 | `The request body is not valid JSON` |
| `UNKNOWN_FIELD` | 400 | `Unknown field <path>` |
| `INVALID_CURSOR` | 400 | `This cursor is not valid` |
| `READ_ONLY_QUERY` | 400 | `Graph queries are read-only` |
| `CYPHER_SYNTAX` | 400 | `The statement does not follow the query grammar` |
| `CYPHER_SEMANTIC` | 400 | `The statement returns a variable it never bound` |
| `RESET_TOKEN_INVALID` | 400 | `This reset link is no longer valid` |
| `UNAUTHENTICATED` | 401 | `Sign in or send an API key` |
| `INVALID_API_KEY` | 401 | `This credential is not valid` |
| `BAD_CREDENTIALS` | 401 | `Email or password is incorrect` |
| `TOTP_REQUIRED` | 401 | `Enter the code from your authenticator app` |
| `BAD_TOTP` | 401 | `That code is not valid` |
| `FORBIDDEN_ROLE` | 403 | `Your role cannot do this` |
| `PLAN_LIMIT` | 403 | `Your plan allows 3 databases` on `ship`, `Your plan allows 20 databases` on `scale` |
| `DATABASE_NOT_FOUND` | 404 | `Database not found` |
| `SOURCE_NOT_FOUND` | 404 | `Source not found` |
| `COLLECTION_NOT_FOUND` | 404 | `Collection not found` |
| `REQUEST_NOT_FOUND` | 404 | `No answered request has this id` |
| `MEMBER_NOT_FOUND` | 404 | `Member not found` |
| `KEY_NOT_FOUND` | 404 | `API key not found` |
| `JOB_NOT_FOUND` | 404 | `Job not found` |
| `ROUTE_NOT_FOUND` | 404 | `No route matches this address` |
| `METHOD_NOT_ALLOWED` | 405 | `This address does not accept <METHOD>` |
| `DATABASE_NOT_READY` | 409 | `This database is still provisioning` |
| `DATABASE_ALREADY_EXISTS` | 409 | `A database with this name already exists` |
| `MEMBER_EXISTS` | 409 | `A member with this email already exists` |
| `LAST_OWNER` | 409 | `An organization needs at least one owner` |
| `PLAN_DOWNGRADE_BLOCKED` | 409 | `Ship allows 3 databases. Delete databases before switching.` |
| `VERSION_CONFLICT` | 409 | `Source <id> is at version <n>` |
| `SOURCE_IS_LIVE` | 409 | `Source <id> is not deleted` |
| `KEY_REVOKED` | 409 | `This API key is revoked` |
| `JOB_NOT_FINISHED` | 409 | `This export is not finished` |
| `IDEMPOTENCY_IN_PROGRESS` | 409 | `A request with this idempotency key is still running` |
| `COLLECTION_NOT_EMPTY` | 409 | `Delete the sources in this collection first` |
| `COLLECTION_IS_DEFAULT` | 409 | `The default collection cannot be deleted` |
| `TOTP_ALREADY_ON` | 409 | `Two-step sign-in is already on` |
| `TOTP_NOT_ON` | 409 | `Two-step sign-in is off` |
| `PAYLOAD_TOO_LARGE` | 413 | `The request body is over 2 MB` |
| `IDEMPOTENCY_KEY_REUSED` | 422 | `This idempotency key was used with a different request` |
| `RATE_LIMITED` | 429 | `Too many requests. Try again in <n> seconds.` |
| `SIGN_IN_THROTTLED` | 429 | `Too many sign-in attempts. Try again in <n> seconds.` |

In `RATE_LIMITED` and `SIGN_IN_THROTTLED`, `<n>` equals the `Retry-After` header in whole seconds. An `errored` source status carries the `error_message` `No source with this id in this scope`.

**Conventions: headers.**

- Every HTML answer carries `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin` and `X-Frame-Options: DENY`.
- Every answer under `/api/v2` and `/api/auth`, and every console page, carries `Cache-Control: no-store`.

**Routes.** `Returns` names the `data` of a success, which is `200` unless another status is shown. Every `/api/v2` route needs `API-Version: 2`. `viewer`, `editor` and `owner` in the `Who` column mean that role or higher.

| Endpoint | Who | Request body / query | Returns |
|---|---|---|---|
| `GET /api/health` | anyone | none | `{status: "ok"}` |
| `POST /api/auth/login` | anyone | `{email, password, totp?, recovery_code?}` | `{token, member: {email, role, organization: {name, plan}}}` |
| `POST /api/auth/logout` | member session | none | `{}` |
| `POST /api/auth/logout-all` | member session | none | `{revoked_sessions}` |
| `POST /api/auth/password` | member session | `{current_password, new_password}` | `{changed: true, revoked_sessions}` |
| `POST /api/auth/forgot` | anyone | `{email}` | `{sent: true}` |
| `POST /api/auth/reset` | anyone | `{token, password}` | `{reset: true}` |
| `POST /api/auth/totp/setup` | member session | none | `{secret, otpauth_uri}` |
| `POST /api/auth/totp/enable` | member session | `{code}` | `{enabled: true, recovery_codes}` |
| `POST /api/auth/totp/disable` | member session | `{code}` | `{enabled: false}` |
| `GET /api/me` | member session | none | `{email, role, organization: {name, plan}}` |
| `POST /api/contact` | anyone | `{email, message, website}` | `201` `{received: true}` |
| `GET /api/code-host/repo` | anyone | none | `{full_name, stargazers_count}` |
| `POST /api/v2/databases` | `owner`, not a key | `{name}` | `201` `{name, status: "provisioning", created_at}` |
| `GET /api/v2/databases` | `viewer` | none | `{databases: [{name, status, last_lsn, indexed_lsn, index_generation, created_at}]}` by name |
| `DELETE /api/v2/databases` | `owner`, not a key | `database` | `{deleted: true}` |
| `GET /api/v2/databases/status` | `viewer` | `database` | `{database, status, infra: {ready_for_ingestion, graph_status}}` |
| `GET /api/v2/databases/collections` | `viewer` | `database` | `{collections: [names ascending]}` |
| `DELETE /api/v2/databases/collections` | `editor` | `database`, `name` | `{deleted: true}` |
| `GET /api/v2/databases/stats` | `viewer` | `database` | `{sources, facts, entities, last_lsn, indexed_lsn, wal_pending, index_generation, tokens_ingested, storage_bytes}` |
| `POST /api/v2/databases/compact` | `editor` | `{database}` | `{generation, folded_entries, indexed_lsn}` |
| `POST /api/v2/databases/export` | `owner`, not a key | `{database}` | `202` `{job_id, status, database, lsn}` |
| `POST /api/v2/databases/import` | `owner`, not a key | `{name, document}` | `201` `{name, status, created_at, sources, facts}` |
| `POST /api/v2/context/ingest` | `editor` | `{database, collection?, sources: [{id?, title, text, if_version?, facts: [{subject, predicate, object, valid_from, reason}], relations?: {ids}}]}` | `201` `{results: [{id, version, lsn, indexing_status}]}` |
| `GET /api/v2/context/status` | `viewer` | `database`, `collection`, `ids` comma separated | `{statuses: [...]}` in request order; each entry is exactly `{id, indexing_status, version}` for an existing source, or exactly `{id, indexing_status: "errored", version: null, error_code: "FILE_NOT_FOUND", error_message}` for an id with no source in that scope |
| `POST /api/v2/context/list` | `viewer` | `{database, collection}` | `{sources: [{id, title, version, token_count, facts, indexing_status, ingested_at}]}` by id, `facts` being a count |
| `GET /api/v2/context/source` | `viewer` | `database`, `collection`, `id` | one source with `facts`, plus an `ETag` |
| `DELETE /api/v2/context` | `editor` | `database`, `collection`, `id` | `{deleted: true, lsn}` |
| `POST /api/v2/context/restore` | `editor` | `{database, collection, id}` | `{id, version, lsn, indexing_status}` |
| `GET /api/v2/context/relations` | `viewer` | `database`, `entity`, `as_of` | `{entity, as_of, outgoing, incoming}` |
| `GET /api/v2/context/history` | `viewer` | `database`, `entity`, `predicate` | `{entity, predicate, facts: [{object, valid_from, superseded_at, reason, source_id, lsn}]}` |
| `GET /api/v2/context/graph` | `viewer` | `database`, `as_of`, `predicates` | `{as_of, nodes, edges}` |
| `POST /api/v2/query` | `viewer` | `{database, query_by: "text", query, collections, max_results}` or `{database, query_by: "cypher", cypher, as_of}` | `{results: [...]}` or the graph answer |
| `POST /api/v2/feedback` | `viewer` | `{request_id, feedback, rating, source, ground_truth, metadata}` | `201` `{request_id, received: true}` |
| `GET /api/v2/members` | `viewer` | none | `{members: [{email, role}]}` by email |
| `POST /api/v2/members` | `owner`, not a key | `{email, role, password}` | `201` `{email, role}` |
| `PATCH /api/v2/members/{email}` | `owner`, not a key | `{role}` | `{email, role}` |
| `DELETE /api/v2/members/{email}` | `owner`, not a key | none | `{removed: true}` |
| `GET /api/v2/keys` | `owner`, not a key | none | `{keys: [{id, name, role, prefix, created_at, revoked_at}]}` |
| `POST /api/v2/keys` | `owner`, not a key | `{name, role, databases?}` | `201` `{id, name, role, prefix, secret}` |
| `GET /api/v2/keys/{id}` | `owner`, not a key | none | `{id, name, role, prefix, databases, created_at, last_used_at, rotated_at, revoked_at}` |
| `DELETE /api/v2/keys/{id}` | `owner`, not a key | none | `{revoked: true}` |
| `POST /api/v2/keys/{id}/rotate` | `owner`, not a key | none | `{id, prefix, secret}` |
| `PUT /api/v2/org/plan` | `owner`, not a key | `{plan}` | `{plan}` |
| `GET /api/v2/usage` | `owner`, not a key | none | `{month, plan, month_tokens, storage_bytes, ontology_cents, storage_cents, usage_cents, minimum_cents, billed_cents, minimum_applied}` |
| `GET /api/v2/usage/daily` | `owner`, not a key | none | `{month, days: [{day, tokens}]}` |
| `GET /api/v2/audit` | `owner`, not a key | `limit`, `cursor`, `action`, `actor`, `format` | `{events, next_cursor}`, or CSV |
| `GET /api/v2/jobs/{id}` | `owner`, not a key | none | the job |
| `GET /api/v2/jobs/{id}/download` | `owner`, not a key | none | the export document |

"Member session" routes refuse every API key with `403` `FORBIDDEN_ROLE`. `POST /api/auth/logout` ends the calling session; an API key sent there keeps working. In an ingest source, `relations` is optional and carries `ids`, a list of other source ids in the same collection. The server accepts it and no read depends on it.

### Data model (DP-21, DP-23, DP-33, DP-66, DP-93)

Every table below lives in PostgreSQL.

- **`organizations`**: `id`, `name`, `plan` (`ship` or `scale`), `created_at`.
- **`members`**: `id`, `organization_id`, `email` (unique across all organizations, lowercased), `role` (`owner`, `editor` or `viewer`), `password_hash`, `created_at`.
  - An initial password has at least 12 characters.
  - An email already used anywhere is `409` `MEMBER_EXISTS`.
- **`sessions`**: `id`, `member_id`, `created_at`, `revoked_at`, one row per sign in. A session token is at least 32 characters and is stored only as a digest.
- **`api_keys`**: `id`, `organization_id`, `name` (1 to 60 characters), `role` (`editor` or `viewer`), `prefix`, `created_at`, `last_used_at`, `rotated_at`, `revoked_at`, and its scope.
  - The secret is `tsl_` followed by 40 lowercase hex digits. It is shown once and stored only as a digest.
  - `prefix` is the secret's first 12 characters.
  - Asking for role `owner` is `400` `VALIDATION_ERROR` on `role`.
- **`databases`**: `id`, `organization_id`, `name`, `created_at`, `last_lsn`, `indexed_lsn`, `index_generation`.
  - `name` matches `^[a-z][a-z0-9_]{2,31}$` and is unique per organization. A duplicate is `409` `DATABASE_ALREADY_EXISTS`.
  - The last three counters are all `0` for a new database.
- **`collections`**: `database_id`, `name`, matching the database name pattern.
  - `default` always exists. Any other collection is created by the first ingest that names it. An ingest that names no `collection` writes to `default`.
  - A search that names one collection never returns data written in another.
- **`sources`**: `database_id`, `collection`, `id`, `title`, `text`, `version` (starting at 1), `token_count`, `ingested_at`, `lsn`, deleted flag.
  - `id` matches `^[A-Za-z0-9_-]{1,64}$`. When omitted it is assigned as `src_` followed by 12 lowercase hex digits.
  - `title` is 1 to 200 characters and `text` is 1 to 20000 characters.
  - `lsn` is the sequence number of the source's latest ingest or restore entry.
- **`source_versions`**: `organization_id`, `database_id`, `collection`, `source_id`, `version`, `lsn`, `token_count`, `ingested_at`. There is one row for every `ingest` log entry, and it is kept for the bill.
- **`facts`**: `database_id`, `source_id`, `lsn` (of the ingest that added it), `position` within that ingest, `subject`, `object`, `predicate`, `valid_from`, `reason`.
  - `subject` and `object` are 1 to 80 characters after trimming.
  - `predicate` matches `^[A-Z][A-Z0-9_]{1,31}$`.
  - `reason` is 0 to 280 characters.
  - A source carries 0 to 50 facts. A request carries 1 to 50 sources.
- **`wal_entries`**: `database_id`, `lsn` (unique per database), `kind` (`ingest`, `delete` or `restore`), `source_id`, `created_at`.
- **`query_records`**: `request_id`, `organization_id`, `database_id`, `created_at`. There is one row per successful search or graph query.
- **`feedback`**: `request_id`, `rating` (`positive`, `negative` or `neutral`, optional), `feedback`, `source` (`user` by default, or `agent`), `ground_truth`, `metadata`, `created_at`.
  - `feedback` is up to 8000 characters. It is required unless `ground_truth` `{answer, source_ids}` is sent.
- **`contact_messages`**: `email`, `message` (10 to 4000 characters), `created_at`.
- **`audit_events`**: `id`, `organization_id`, `at`, `actor` (the acting member's email, stored as text), `action`, `target`, `detail`.
- **`export_jobs`**: `id`, `organization_id`, `database_id`, `lsn`, `requested_by`, `requested_at`.
- **Idempotency records**: organization, route, key, request digest, recorded status and `data`, created time.
- **Reset tokens and recovery codes**: stored only as digests.

**Entities in the graph** are not a table. An entity is any distinct subject or object of a live fact. It is keyed by its NFC-normalized, Unicode-lowercased and trimmed form, and displayed with the casing of its earliest appearance by log sequence number. Every lookup by name ignores case and surrounding spaces.

### Business rules (DP-01 to DP-48, DP-51, DP-52, DP-64, DP-71 to DP-99)

**Core features.**

1. **Provisioning.**
   - A new database reports `provisioning` until 2 whole seconds of server time have passed since the instant it was created. This is measured precisely, not from the whole-second `created_at`. It then reports `ready`.
   - The status route's `ready_for_ingestion` reads `false` until then and `true` after. Its `graph_status` reads the same value as `status`.
   - Ingest and compaction before `ready` are `409` `DATABASE_NOT_READY`. Reads answer normally, with nothing in them.
2. **Plan limits.** `ship` allows 3 databases per organization and `scale` allows 20. One more is `403` `PLAN_LIMIT`. Switching to `ship` while owning more than 3 databases is `409` `PLAN_DOWNGRADE_BLOCKED`.
3. **Whole-request validation.** An ingest request is validated whole before anything is written. One invalid source refuses the request: nothing is stored, no log entry is written and no counter moves.
4. **Write log.**
   - Each accepted source becomes exactly one write log entry, with the next log sequence number of that database, in request order. Numbering starts at 1 and numbers are never reused or skipped.
   - Ingesting an existing source id in the same collection creates its next version. It replaces the title and text and appends the new facts; facts of earlier versions stay.
   - An id whose source was deleted is ingested again at the version after the highest it ever had.
5. **Indexing status.** A source whose `lsn` is above the database's `indexed_lsn` reports `graph_creation`; at or below it, it reports `completed`. `GET /api/v2/context/status` answers `200` with one entry per requested id, in request order:
   - an id with a source in that database and collection (live or deleted) gets exactly `{id, indexing_status, version}`, with `version` its latest version;
   - an id with no source in that database and collection gets exactly `{id, indexing_status: "errored", version: null, error_code: "FILE_NOT_FOUND", error_message}`, with the `error_message` printed under the refusal catalogue.

   Only `errored` entries carry `error_code` and `error_message`.
6. **Compaction.** It folds every pending entry. When at least one entry is pending, it sets `indexed_lsn` to `last_lsn` and raises `index_generation` by exactly 1. With nothing pending, it changes nothing and reports `0` folded.
7. **Reads see every write.** Every read sees every accepted write immediately, folded or pending. Compaction never changes a search result, a graph query result, a relation or a history list.
8. **Supersession.**
   - For one subject and predicate, the fact active at a moment `T` is the one with the greatest `valid_from` not after `T`.
   - Ties at equal `valid_from` are broken by the greater fact `lsn`, then by the later `position`.
   - Deleting a source removes its facts from every answer at once.
9. **Source addressing.** A source is addressed by database, collection and id together. The same id in another collection is a different source, so a status asked in the wrong collection reports `errored`, and a delete there is `404` `SOURCE_NOT_FOUND`.
10. **Deleting a source.** It removes the source and its facts from every read and appends a `delete` entry.
11. **Feedback lookup.** Feedback must name the `meta.request_id` of a successful search or graph query previously answered to the same organization, on a database that still exists. Otherwise it is `404` `REQUEST_NOT_FOUND`.
12. **Last owner.** An organization always has at least one `owner`. Removing or demoting the last one is `409` `LAST_OWNER`.
13. **Role changes apply at once.** Role changes, member removals and key revocations take effect on the very next request. A token issued before a demotion acts with the new role. Every session token of a removed member answers `401` `INVALID_API_KEY`.
14. **Mail.** Members, owners and exporters receive the email notices of Services through Mailpit, and nothing else is sent.

**Conventions: time and money.**

- Money is stored and returned as integer cents in `usd`.
- Every timestamp in a request or a response is UTC in the form `YYYY-MM-DDTHH:MM:SSZ`, with no fractional seconds. Any other form is refused.
- The usage `month` is the current UTC month in the form `YYYY-MM`.

**Conventions: text.**

- **Counting.** Text is Unicode. Every length limit in this brief counts the code points of the value after NFC normalization. The value itself is stored, returned and shown exactly as typed. For example:
  - a `title` of 200 letters `é`, each written as `e` followed by U+0301 (400 code points as sent), is accepted;
  - 201 of them is `400` `VALIDATION_ERROR` on `sources.0.title`.
- **Storage bytes.** `storage_bytes` counts UTF-8 bytes as typed, so each decomposed `é` adds 3.
- **Snippets.** A snippet is the first 160 code points of the text as typed.
- **Unstorable characters.** Every string value anywhere in a request body, at any depth, is refused with `400` `VALIDATION_ERROR` on its dotted path if it holds any of these:
  - U+0000;
  - any other C0 control character from U+0001 to U+001F except tab (U+0009), line feed (U+000A) and carriage return (U+000D);
  - a lone surrogate escape, meaning a `\ud800` to `\udfff` escape that does not form a high-low pair.

  This check runs among the field checks in request order, under the whole-request rule, so nothing is stored. Tab, line feed and carriage return are accepted.
- **Entity keys.** Entity keys and search tokens are formed after NFC normalization and Unicode lowercasing. So `Café` written with U+00E9, the same word in capitals, and the same word written with `e` followed by U+0301 are one entity, while `Cafe` is another. A display name stays exactly as first typed.
- **Literal text.** Every typed value is stored, matched and shown as exactly those characters and never as markup. That includes `'; DROP TABLE sources; --`, `%`, `_`, `<script>alert(1)</script>` and `{"$ne": null}`. The Sources filter, the Find entity box and the audit `actor` filter treat `%` and `_` as themselves.
- **Body size.** Every per-field limit is accepted at its boundary only while the whole body stays within 2,097,152 bytes. So an ingest of 50 sources of 20000 ASCII characters each is accepted, while 50 texts that encode to more than 2,097,152 bytes in all are `413`.

**Conventions: retries.**

- **Routes.** `POST /api/v2/databases`, `POST /api/v2/context/ingest`, `POST /api/v2/databases/export` and `POST /api/v2/databases/import` honour the header `Idempotency-Key`.
- **Key format.** A key is 1 to 64 letters, digits, `_` or `-`. Any other value is `400` `VALIDATION_ERROR` with `field` `Idempotency-Key`.
- **Scope.** A key belongs to one organization and one route, and is kept for 24 hours. The same key value used by another organization, or on another route, is a different key. For example, Northwind and Acme each sending `POST /api/v2/databases` with `Idempotency-Key: shared-1` and the same body each get `201` and their own database, with no replay header.
- **Replay.** The first successful answer for a key is recorded. A later request with the same key and the same JSON body (equal once parsed) gets the same status and the same `data`, with the header `Idempotent-Replayed: true` and a fresh `meta.request_id`. Nothing is written: no log entry, no version, no counter, no usage, no audit event, no email. The first answer carries no `Idempotent-Replayed` header.
- **Conflict.** The same key with a different body is `422` `IDEMPOTENCY_KEY_REUSED` and writes nothing.
- **Refusals.** A refused first attempt is not recorded.
- **Races.** Requests racing with one key and one body write exactly once. Every other racer answers the replay or `409` `IDEMPOTENCY_IN_PROGRESS`.
- **Deleted databases.** Deleting a database removes every idempotency record whose request or answer named it. A later request with such a key starts fresh.

**Conventions: limits.**

- **Key queries.** Each API key may send `POST /api/v2/query` 20 times in any rolling 60 seconds while its organization is on `ship`, and 200 times on `scale`.
  - The plan is read at every request, so a switch applies at once.
  - The next query is `429` `RATE_LIMITED` with `Retry-After` from 1 to 60.
  - Every query answer to a key, refusals included, carries `RateLimit-Limit` and `RateLimit-Remaining` (counting this request, never below 0). A `429` is not counted.
  - Session tokens are never limited and carry neither header.
- **Feedback.** Each organization may store 100 feedback records in any rolling 60 seconds. Only stored records count: a refused feedback body (any `400` or `404`) spends nothing. The next record past the limit is `429` `RATE_LIMITED` with `Retry-After`.
- **Contact messages.** One email address may have 3 contact messages stored in any rolling 60 minutes. The next valid one is `429` `RATE_LIMITED` and not stored. A message refused with `400`, or caught by the `website` trap, counts for nothing.
- **List limits.**
  - Audit `limit` is 1 to 100, default 20. Anything else is `400` `VALIDATION_ERROR` on `limit`.
  - Search `max_results` is 1 to 20, default 5. Anything else is refused on `max_results`.
  - Graph `predicates` must each match the predicate pattern, else the request is refused on `predicates`.

**Tokens and stats.**

- `tokens(s)` takes the NFC form of `s`, lowercases it, splits it on every character outside `a` to `z` and `0` to `9`, and drops empty pieces.
- The stopwords are `a an and are as at be by for from in is it of on or that the this to was with`.
- A source's `token_count` is the number of `tokens(title + " " + text)`, stopwords included. Its terms are those tokens with the stopwords removed.
- A database's `storage_bytes` is the sum, over live sources, of the UTF-8 byte length of `title` plus that of `text`, plus 64 for each live fact.
- In the stats of a database:
  - `sources`, `facts` and `entities` count what is live now;
  - `tokens_ingested` is the sum of `token_count` over that database's `source_versions` rows, which include replaced and deleted sources;
  - `wal_pending` is `last_lsn` minus `indexed_lsn`.

**Keyword scoring.** The score runs over the latest version of every live source in the requested collections. A request that names no `collections` searches `["default"]` only. With `N` sources, `|D|` the number of terms of a source, `avgdl` the mean `|D|`, `n(t)` the number of sources containing term `t`, and `f(t,D)` the count of `t` in `D`:

- `idf(t) = ln(1 + (N - n(t) + 0.5) / (n(t) + 0.5))`
- the score is the sum, over distinct query terms, of `idf(t) * f(t,D) * 2.2 / (f(t,D) + 1.2 * (0.25 + 0.75 * |D| / avgdl))`

Results are ordered highest score first. Each score is reported rounded half up to 4 decimals. Only scores above zero are returned, at most `max_results`. A query with no terms after stopword removal is `400` `VALIDATION_ERROR` on `query`. Each result carries `id`, `collection`, `title`, `score` and `snippet`.

**Search operators.**

- **Phrases.** A run of words in double quotes is a phrase. A source whose terms do not hold the phrase's terms next to each other, in that order, is dropped. The phrase's terms still score as plain terms.
- **Exclusions.** A word with a leading `-` outside quotes excludes every source whose terms hold it, and adds nothing to the score.
- **Ties.** Ties at equal score break by id ascending, then by collection ascending.
- **Example.** On the seed, `"billing migration" -ledger` answers exactly `kickoff-notes` and `launch-retro`.

**Relations and history.**

- **Relations.** The relations of an entity at `T` are the facts active at `T` with that entity as subject (`outgoing`) or object (`incoming`). Each is `{predicate, other, valid_from, reason, source_id}`, ordered by predicate, then by the other entity's key. `as_of` defaults to now.
- **History.** The history for a subject and predicate lists every live fact in `valid_from` order, ties by fact `lsn` and then `position`. Each entry carries its own `lsn` and `superseded_at`, which is the `valid_from` of the next fact in that order, or null.

**The graph query language.** One statement, keywords in any letter case:

```text
statement := MATCH pattern [WHERE cond (AND cond)*] RETURN items [ORDER BY item [ASC|DESC]] [LIMIT int]
pattern   := node (rel node){0,3}
node      := "(" var [ "{" "name" ":" string "}" ] ")"
rel       := "-[:" PREDICATE [ "*" min ".." max ] "]->"  |  "<-[:" PREDICATE [ "*" min ".." max ] "]-"
items     := [DISTINCT] ritem ("," ritem)*
ritem     := item  |  "count(*)"
item      := var "." "name"  |  var
cond      := var "." "name" ("=" | "STARTS WITH" | "ENDS WITH" | "CONTAINS") string  |  NOT cond
var       := a lowercase letter, then lowercase letters, digits or underscores
string    := single quoted; \' writes a quote inside it
int       := one or more decimal digits
min, max  := whole numbers with 1 <= min <= max <= 5
```

**Matching.**

- Nodes are entities, and every fact active at `as_of` is one edge from subject to object.
- A node written with a name matches the entity of that key. No such entity means no rows.
- A fixed relationship matches one edge of that predicate in the written direction. A ranged one matches a path of `min` to `max` such edges with no entity repeated in the path.
- A condition compares the entity key with the lowercased string, and a row is kept only when every condition holds.
- Each distinct binding of all variables is one row, with distinct paths counted separately. A variable written twice must be the same entity.

**Results.**

- `RETURN v` and `RETURN v.name` both give the display name. `DISTINCT` removes duplicate rows.
- Without `ORDER BY`, rows are sorted by their values compared column by column as text, ascending. With it, rows are sorted by that item and then by the remaining columns ascending.
- `LIMIT n` returns at most the first `n` rows, and at most 1000 rows ever return.
- `RETURN count(*)`, standing alone, answers one row with one whole number, the number of rows the statement would otherwise return, under the column `count(*)`.

**Refusals.** A statement is checked in exactly this order, and the first check that fails answers:

1. **Read-only.** Any statement containing `CREATE`, `MERGE`, `DELETE`, `DETACH`, `SET`, `REMOVE`, `CALL` or `LOAD` as a keyword outside a string literal is `400` `READ_ONLY_QUERY`.
2. **Syntax.** Anything that does not parse by the grammar above is `400` `CYPHER_SYNTAX`. A `LIMIT` whose number is outside 1 to 1000 (for example `LIMIT 0` or `LIMIT 1001`) is also `400` `CYPHER_SYNTAX`.
3. **Meaning.** A statement that parses is then `400` `CYPHER_SEMANTIC` when either of these holds:
   - `count(*)` appears together with any other return item, appears more than once, or follows `DISTINCT`;
   - a variable used in `WHERE`, `RETURN` or `ORDER BY` is never bound in the pattern.

**Answer shape.** The answer is `{columns, rows, as_of, served_from}`:

- `columns` repeats each item as written;
- `rows` is a list of lists;
- `served_from` is `{index_generation, indexed_lsn, wal_entries_applied}`, the last being `last_lsn` minus `indexed_lsn`.

For example, with the seed data as of `2026-03-20T00:00:00Z`:

- `MATCH (a)-[:OWNED_BY]->(o) WHERE o.name STARTS WITH 'm' RETURN a.name` answers `[["Billing Migration"], ["Ledger Service"]]`;
- `MATCH (a)-[:OWNED_BY]->(o) RETURN count(*)` answers `[[3]]`.

**The graph route.** `GET /api/v2/context/graph` answers `{as_of, nodes, edges}`. Its `as_of` defaults to now, and its `predicates` are optional.

- `edges` are the facts active at `as_of`, of the listed predicates only when given. Each is `{subject, predicate, object, valid_from, source_id}` with display names, ordered by subject key and then predicate. At most 1000 edges return.
- `nodes` are the display names of every entity at either end of a returned edge, ordered by key.

For example, with the seed data as of `2026-03-20T00:00:00Z`:

- the nodes are `Atlas Launch`, `Billing Migration`, `Dana Okafor`, `Ledger Service` and `Marco Silva`;
- the five edges are Atlas Launch `BLOCKED_BY` Billing Migration, Atlas Launch `OWNED_BY` Dana Okafor, Billing Migration `DEPENDS_ON` Ledger Service, Billing Migration `OWNED_BY` Marco Silva, and Ledger Service `OWNED_BY` Marco Silva.

**Pricing arithmetic.**

- **Inputs.**
  - `month_tokens` is the sum of `token_count` over every `source_versions` row of the organization ingested in the current UTC month. That includes replaced and deleted sources, and rows kept from deleted databases.
  - `storage_bytes` is summed over the organization's existing databases.
  - `rate` is 50 cents per GB-month on `ship` and 25 on `scale`.
  - `minimum` is 2500 cents on `ship` and 30000 on `scale`.
- **The bill.**
  - `ontology_cents = ceil(month_tokens * 500 / 1000000)`
  - `storage_cents = ceil(storage_bytes * rate / 1000000000)`
  - `usage_cents = ontology_cents + storage_cents`
  - `billed_cents = max(usage_cents, minimum)`
  - `minimum_cents` is the plan's `minimum`, and `minimum_applied` is true when `usage_cents < minimum`.
- **The landing calculator.**
  - It takes `g`, the GB input times ten, rounded, and `m`, the millions input times ten, rounded.
  - `storage_cents = ceil(g * rate / 10)` and `ontology_cents = ceil(m * 500 / 10)`.
  - So `3.2` GB with `2.4` million tokens bills Ship usage `1360`, billed `2500` with the minimum, and Scale billed `30000`.
  - `1000` GB with `100` million tokens bills Ship `100000` and Scale `75000`, neither at the minimum.

**Daily usage.** `GET /api/v2/usage/daily` answers one entry per UTC day of the current month, from the first to today inclusive, in order. `day` is written `YYYY-MM-DD`, and `tokens` is the sum of `token_count` of the organization's `source_versions` rows ingested that day, `0` for a day without one. The days sum to the bill's `month_tokens`. The billing page and its chart read these figures each time the page loads.

**Usage that was already incurred stays billed.** Tokens are billed when they are ingested, and nothing later takes them back. Storage follows what exists now.

| Action | `month_tokens`, daily series, `tokens_ingested` | `storage_bytes` |
|---|---|---|
| ingest | rise by the new versions' tokens | rises |
| delete a source | unchanged | drops by that source and its facts |
| restore | unchanged | rises back |
| idempotent replay | unchanged | unchanged |
| refused request | unchanged | unchanged |
| import | rise by the imported versions' tokens | rises |
| delete a database | organization figures unchanged | drops by everything that database held |

After any sequence of these:

- the bill follows the pricing arithmetic;
- the daily `days` sum to `month_tokens`;
- every remaining database's Stats `tokens_ingested` equals the sum of its own `source_versions`.

**Store rules and concurrency.** These hold at every moment, under concurrent requests too:

- each database's `last_lsn` equals its number of write log entries and their highest lsn;
- lsns run from 1 to `last_lsn` with no gap;
- `indexed_lsn` is at most `last_lsn`;
- the stats `sources`, `facts` and `entities` equal what the tables hold live;
- `audit_events` holds one row per successful audited action.

The winners under concurrent requests:

- **Deletes.** Of simultaneous `DELETE /api/v2/context` calls on one live source, exactly one answers `200` `{deleted: true, lsn}`. Every other one answers `404` `SOURCE_NOT_FOUND`, and exactly one `delete` entry is written.
- **Guarded ingests.** Of simultaneous ingests of one id that each carry `if_version` equal to the live version `<n>`, exactly one answers `201` with version `<n>+1`. Every other one answers `409` `VERSION_CONFLICT` with the message `Source <id> is at version <n+1>`, and exactly one version and one entry are written.
- **Compactions.** Two compactions racing on one database with pending entries raise the generation by exactly one between them. One answers the folded count, and the other answers `0` with the new generation.
- **Restores.** Two restores racing on one deleted source write one `restore` entry. One answers `200`, and the other answers `409` `SOURCE_IS_LIVE`.
- **Names.** Racing creations of one name make one database. The others answer `409` `DATABASE_ALREADY_EXISTS`.
- **Last owner.** Racing demotions or removals never leave an organization without an owner.
- **Plan switches against creations.** Database creations and plan switches in one organization are decided one at a time, each against the plan and database count left by the one before. So an organization is never on `ship` with more than 3 databases. Each creation answers `201`, or `403` `PLAN_LIMIT` with the message of the plan in force when it was decided. Each switch answers `200`, or `409` `PLAN_DOWNGRADE_BLOCKED`.
- **Notices for plan changes.** A switch to the plan already in force answers `200` with no audit event and no email. Every switch that really changes the plan writes one `plan.change` event and one email to each owner.

**Version checks and restore.**

- **`if_version`.** An ingest source may carry `if_version`, a whole number of at least 0, and then needs an `id` (else `400` `VALIDATION_ERROR` on `sources.<i>.if_version`).
  - `0` means no live source has that id in that collection. Any other number must equal the live version.
  - A mismatch refuses the whole request with `409` `VERSION_CONFLICT`, with `field` `sources.<i>.if_version` and the message naming the live version (`0` when none).
- **Restore.** `POST /api/v2/context/restore` brings a deleted source back exactly as it stood before the delete: its version, title, text and every fact.
  - Every restored fact keeps the `lsn` and `position` it was ingested with.
  - Only the one new `restore` entry takes the next lsn. It becomes the source's `lsn` and the answer's `lsn`, so the source reads `graph_creation` until the next compaction.
  - Ties and history therefore read exactly as before the delete. For example, take source `a` (lsn 1) and source `b` (lsn 2), each stating `X` `OWNED_BY` something from the same moment, so `b` is active. After deleting and restoring `a`, `b` is still active and the history `lsn` of `a`'s fact reads `1`.
  - A source re-ingested to version 3 and then deleted restores at version 3, with the facts of versions 1 to 3.
  - A restore adds no version, no tokens and no usage.
  - A live source, including one re-ingested after its delete, is `409` `SOURCE_IS_LIVE`. An id never ingested in that database and collection is `404` `SOURCE_NOT_FOUND`.
- **Single source.** `GET /api/v2/context/source` answers `{id, collection, version, title, text, token_count, lsn, indexing_status, ingested_at, facts}`.
  - `facts` lists `{subject, predicate, object, valid_from, reason}` for every version, in ingest order.
  - The header `ETag` equals the version in double quotes. A request whose `If-None-Match` equals it answers `304` with no body.
  - A deleted or unknown source is `404` `SOURCE_NOT_FOUND`.
- **Collections.** `DELETE /api/v2/databases/collections` removes an empty collection.
  - A collection with live sources is `409` `COLLECTION_NOT_EMPTY`. `default` is `409` `COLLECTION_IS_DEFAULT`. An unknown name is `404` `COLLECTION_NOT_FOUND`.
  - Removing a collection erases the title, text and facts of its deleted sources, which can then no longer be restored (`404` `SOURCE_NOT_FOUND`).
  - Its `source_versions` rows and write log entries stay.

**Deleting a database.** `DELETE /api/v2/databases` removes the database at once and frees its name.

- Reads of that name answer `404` `DATABASE_NOT_FOUND`. A database created again under that name starts new, as `provisioning`, with every counter at `0` and only the collection `default`.
- **What is removed.** PostgreSQL then holds no row for that database in `sources`, `facts`, `collections`, `wal_entries`, `query_records`, `export_jobs`, `feedback` (rows naming its queries) or the idempotency records. Its titles, texts, fact subjects, objects and reasons appear in no text column of any table.
- **What stays.** Only two things remain:
  - its `source_versions` rows, each reduced to `organization_id`, `token_count` and `ingested_at`, with every other column cleared, so the bill keeps them;
  - its audit events.
- **After the delete.**
  - Feedback naming a `request_id` answered on it is `404` `REQUEST_NOT_FOUND`.
  - Its export jobs are `404` `JOB_NOT_FOUND`.
  - An `Idempotency-Key` whose recorded answer named it no longer replays: the same key and body create the database anew (`201`, no replay header).
  - The database leaves every API key scope at once (see below).

**API key scope and rotation.**

- **Scope at creation.** `POST /api/v2/keys` accepts `databases`. Absent or null means every database of the organization, later ones included. Otherwise it is 1 to 20 distinct names of existing databases of the organization. An unknown or repeated name is `400` `VALIDATION_ERROR` on `databases.<i>`.
- **Scoped access.** A scoped key lists only its databases, and every route naming another database answers `404` `DATABASE_NOT_FOUND`.
- **Deletion narrows the scope.** Deleting a database removes it from every key scope at once. A database created again under the same name is a new database outside the old scope. For example, a key scoped to `[a, b]` behaves like this:
  - after `a` is deleted, its detail reads `databases: ["b"]`;
  - after `b` is deleted, it reads `databases: []`, never null, and that emptied scope means no database at all. The key's `GET /api/v2/databases` answers `{databases: []}`, and every database of the organization answers `404` `DATABASE_NOT_FOUND`, `launch_brain` included;
  - recreating `a` does not bring it back into scope;
  - the key still authenticates and its `last_used_at` still moves.
- **Key detail.** `GET /api/v2/keys/{id}` reads `databases` as null for every database, or the live scoped names in ascending order. `last_used_at` is the time of the latest request the key authenticated, or null before the first.
- **Rotation.** After `POST /api/v2/keys/{id}/rotate`, the old secret answers `401` `INVALID_API_KEY` from that moment, and the new one acts with the same name, role and scope.
- **Refusals.** Rotating or revoking a revoked key is `409` `KEY_REVOKED`. A revoked key answers `401` `INVALID_API_KEY` from its next use. An unknown or foreign id is `404` `KEY_NOT_FOUND`.

**Organization isolation.**

- Another organization's database, source, member, key, job, request id or audit event answers exactly like one that does not exist, even under a shared database name.
- The audit `actor` filter naming another organization's member answers `{events: [], next_cursor: null}`, and its CSV is the header line only.
- One organization's writes change nothing in another's usage, daily series or audit log.

**The audit log.**

- **What is written.** Exactly one event is written per successful action of this table, in the same transaction as the change. None is written for a refusal, an idempotent replay, a switch to the plan already in force, or a role change to the role already held.

  | Action | Target | Detail |
  |---|---|---|
  | `database.create` | database name | empty |
  | `database.delete` | database name | empty |
  | `database.import` | the new database name | the number of sources imported |
  | `member.add` | member email | the role |
  | `member.role` | member email | `<old> -> <new>` |
  | `member.remove` | member email | empty |
  | `member.password` | the member's own email | empty |
  | `member.password_reset` | the member's email | empty |
  | `member.totp_on` | the member's own email | empty |
  | `member.totp_off` | the member's own email | empty |
  | `session.logout_all` | the member's own email | the number of sessions ended |
  | `key.create` | key name | the role |
  | `key.rotate` | key name | empty |
  | `key.revoke` | key name | empty |
  | `plan.change` | organization name | `<old> -> <new>` |
  | `export.request` | database name | empty |

- **Attribution.**
  - `actor` is the email of the member who acted, written as text when the event is written. `member.password_reset` is attributed to the member whose password was reset, although no session made it.
  - `member.role` detail names the roles held at that moment.
  - Events are never updated or deleted. Removing a member keeps every event they caused, under their email. The `actor` filter and the CSV still find those events, and a member re-added under the same email shares that actor.
  - Event `id`s and `at`s never change between reads. No route edits audit events: every method but `GET` on `/api/v2/audit` answers `405`.
- **Paging.** `GET /api/v2/audit` answers `{events: [{id, at, actor, action, target, detail}], next_cursor}`, newest first: later `at` first and, among equal times, the later written first.
  - `action` must be one of the table (else `400` `VALIDATION_ERROR` on `action`).
  - `actor` matches an email ignoring case.
  - `next_cursor` is null when nothing older matches. Passing it back as `cursor` answers the next older page, so an event written after the first page never appears on a later page, and no event repeats or is skipped.
  - A cursor not issued for this organization and these filters is `400` `INVALID_CURSOR`.
- **CSV.** With `format=csv`, or an `Accept` header naming `text/csv`, the same route answers `200` `text/csv; charset=utf-8`. It holds every matching event (same filters, no cursor, at most 1000, newest first) as lines ending in a line feed:
  - first the header line `id,at,actor,action,target,detail`, then one line per event;
  - every field whose first character is `=`, `+`, `-`, `@`, tab or carriage return first gets a leading `'`;
  - then a field holding a comma, a double quote, a line feed or a carriage return is wrapped in double quotes, with each inner double quote doubled; every other field is bare.

  For example, a key named `=HYPERLINK("http://x","y")` is written `"'=HYPERLINK(""http://x"",""y"")"`, and a key named `-k` is written `'-k`. The JSON answer always carries the values unchanged.

**Export.**

- **Request.** `POST /api/v2/databases/export` (a ready database) answers `202` `{job_id, status: "queued", database, lsn}`, with `lsn` the database's `last_lsn` at that moment.
- **The job.** `GET /api/v2/jobs/{job_id}` answers `{job_id, kind: "export", database, status, lsn, requested_at, finished_at, result}`.
  - Its status is `queued` until 1 whole second of server time has passed since the instant of the request, measured precisely. It is `running` until 2 whole seconds have passed, then `succeeded`.
  - `finished_at` is null until then, and afterwards `requested_at` plus 2 seconds.
  - `result` is null until then, and afterwards `{collections, sources, facts, sha256}`.
- **Download.** `GET /api/v2/jobs/{job_id}/download` before success is `409` `JOB_NOT_FINISHED`. After success it answers `{database, lsn, collections: [{name, sources: [{id, version, title, text, facts: [{subject, predicate, object, valid_from, reason}]}]}]}`:
  - every collection by name, with an empty one carrying no sources;
  - every source live at that `lsn`, by id, with the version live then and its facts in ingest order;
  - writes made after the request never appear.
- **Digest.** `sha256` is the hexadecimal digest of that `data` object written as JSON with keys sorted, `,` and `:` as the only separators, no spaces or line breaks, and non-ASCII characters as themselves in UTF-8. The download carries it in double quotes as its `ETag`, and a matching `If-None-Match` answers `304`.
- **Refusals.** A job of another organization, an unknown job, or a job whose database was deleted is `404` `JOB_NOT_FOUND`.

**Import.**

- **What it accepts.** `POST /api/v2/databases/import` with `{name, document}` takes an export document. Inside `document`:
  - the top level accepts exactly `database`, `lsn` (both ignored) and `collections`;
  - a collection accepts exactly `name` and `sources`;
  - a source accepts exactly `id`, `version`, `title`, `text` and `facts`;
  - a fact accepts exactly the five fact keys.
- **What it refuses.** The whole document is checked in document order before anything is created, and the first fault answers:
  - an unknown key at any depth is `400` `UNKNOWN_FIELD` with its path;
  - a document must hold 1 to 20 collections and at most 50 sources in all;
  - a repeated collection name is `400` `VALIDATION_ERROR` on `document.collections.<i>.name` of the later one;
  - a second source with the same id in one collection is refused on `document.collections.<c>.sources.<s>.id` of the later one. The same id in two collections is fine;
  - a source `version` must be a whole number of at least 1, even though its value is ignored, else it is refused on `.version`;
  - every other value follows the ingest rules, with paths such as `document.collections.0.sources.2.title`.

  A refused import creates no database and no audit event, and records no idempotency key.
- **What it creates.** A valid import creates the database `name` exactly as `POST /api/v2/databases` would: the same name rule, plan limit, duplicate refusal and 2 seconds of `provisioning`.
  - A document without `default` still yields `default`.
  - It writes each collection and ingests its sources in document order, with lsns 1 to the number of sources, each at version 1, its facts in order, as if ingested now.
  - `tokens_ingested`, the bill and the daily series rise by their tokens. `indexed_lsn` and `index_generation` stay 0.
  - It answers `201` `{name, status: "provisioning", created_at, sources, facts}`.
- **Equivalence.** Exporting the import answers the same `collections` as the original export, except that every `version` reads `1`. Equivalence covers these answer fields, at the same `as_of`:
  - keyword search `results`;
  - graph query `columns` and `rows`;
  - relations `outgoing` and `incoming`;
  - history `facts` without their `lsn`;
  - the graph route `nodes` and `edges`.

  On those fields the import answers exactly as the original, provided no two facts of one subject and predicate in different sources share a `valid_from`, and every entity keeps one casing across sources. Where that does not hold, the import's own log order breaks the tie and picks the display casing.

**Sessions.**

- **Ending sessions.**
  - `POST /api/auth/logout-all` ends every live session of the member and answers their number, the caller's included.
  - `POST /api/auth/password` with a wrong current password is `401` `BAD_CREDENTIALS`. A new password under 12 characters, or equal to the current one, is `400` `VALIDATION_ERROR` on `new_password`. Success ends every other session, keeps the calling one, and cancels every unused reset token.
- **Signing in through the page.** With scripts on or off, signing in through the page keeps the session token in a cookie named `tessel_session` (HttpOnly, SameSite Lax, path `/`). Console pages read that cookie.
  - With scripts off, the sign-in form posts as a plain document to `/login`, carrying `next`.
  - Success answers `303` to the return path. A refusal re-renders `/login` with the error.
- **The return path.** After sign in, `next` (decoded once) is honoured only when both of these hold:
  - it equals `/console`, or starts with `/console/` or `/console?`;
  - it holds no backslash, no `//`, no `/./` or `/../` segment and no control character (U+0000 to U+001F, U+007F).

  Anything else lands on `/console`. That includes `/consoleevil`, `//evil.example/console`, `/\evil.example`, `/console/../login`, `/%09/evil.example`, `https://evil.example/console` and `%2F%2Fevil.example`. For example, `/console/db/launch_brain?tab=graph` is honoured. The server applies this rule for the plain-document post, and the page script applies the same rule.

**Sign-in answers and the pause.**

- **The pause.** Ten failed sign-ins for one email, in any casing, inside a rolling 15 minutes pause sign-in for that email. This holds whether or not the email belongs to a member.
  - The next attempt, with a right password or a wrong one, is `429` `SIGN_IN_THROTTLED`, with `Retry-After` from 1 to 900.
  - A successful sign-in or a password reset clears the count. No other email is affected.
- **Identical answers.** An email that belongs to no member, the email of a removed member with its old password, and a member's email with a wrong password all answer `401` `BAD_CREDENTIALS` with `field` null. Their status, body keys and header names are identical, `request_id` and `latency_ms` aside.
- **Two-step answers.** `TOTP_REQUIRED` and `BAD_TOTP` are only ever answered after a right password.
  - For a member with two-step sign-in on, a right password with neither `totp` nor `recovery_code` is `401` `TOTP_REQUIRED` and issues no token.
  - A right password with an invalid or reused code, or an unknown or spent recovery code, is `401` `BAD_TOTP` and counts as a failed sign-in.
  - A valid code, or an unused recovery code, answers `{token, member}` and spends the recovery code.
  - For a member with two-step sign-in off, both keys are ignored.

**Password reset.**

- **Requesting a link.** `POST /api/auth/forgot` answers `200` `{sent: true}` for every well-formed email, member or not. A malformed email is `400` `VALIDATION_ERROR` on `email`. For a member's email it:
  - creates a reset token of 64 lowercase hexadecimal digits;
  - cancels every earlier unused token of that member;
  - sends the reset email.

  At most 3 reset emails reach one member in any rolling 60 minutes. A further request still answers `{sent: true}` and sends nothing.
- **Using a link.** `POST /api/auth/reset` sets the password, ends every session of the member, clears the sign-in pause, keeps two-step sign-in as it was, and sends the confirmation email.
  - A token that is unknown, used or cancelled, or that belongs to a removed member, is `400` `RESET_TOKEN_INVALID`.
  - A password under 12 characters is `400` `VALIDATION_ERROR` on `password` and leaves the token usable.
  - Reset links and sessions end only by the events this brief names, never by time.

**Two-step sign-in.**

- **Codes.** Codes follow RFC 6238: HMAC-SHA1 over the count of 30-second steps since `1970-01-01T00:00:00Z`, 6 digits. A code is accepted for the current step and for the one before and after it. Once a step's code has been accepted for a member, no code of that step or an earlier one is accepted again for that member.
- **Setup.** `POST /api/auth/totp/setup` answers a new secret of 32 base32 characters without padding, and the key address with the scheme `otpauth`, the type `totp`, the label `Tessel:<email>` and the query `secret=<secret>&issuer=Tessel`. While two-step sign-in is on, it is `409` `TOTP_ALREADY_ON`.
- **Turning it on.** `POST /api/auth/totp/enable` turns it on for a valid code, else `401` `BAD_TOTP`. It answers ten recovery codes matching `^[0-9a-f]{4}-[0-9a-f]{4}$`, shown only here.
- **Turning it off.** `POST /api/auth/totp/disable` accepts a current code or an unused recovery code, else `401` `BAD_TOTP`. When two-step sign-in is off, it is `409` `TOTP_NOT_ON`.

**Feedback bodies.**

- **Required fields.** `request_id` is required. `feedback` is up to 8000 code points and is required unless `ground_truth` is sent. `rating` is `positive`, `negative` or `neutral` when present. `source` is `user` or `agent`.
- **`metadata`.** It is an optional object of at most 20 entries.
  - A 21st entry is `400` `VALIDATION_ERROR` on `metadata`.
  - Each key matches `^[A-Za-z0-9_-]{1,64}$`. Each value is a string of 0 to 500 code points.
  - A bad key, or a value that is not a string (an object or list included), is refused on `metadata.<key>`.
- **`ground_truth`.** It is an object of exactly `answer` and `source_ids`.
  - `answer` is 1 to 8000 code points, else it is refused on `ground_truth.answer`.
  - `source_ids` holds 1 to 20 distinct ids, each matching the source id pattern. Any other count is refused on `ground_truth.source_ids`. A bad or repeated id is refused on `ground_truth.source_ids.<i>`.
- **Quota.** Refused feedback never counts toward the organization's feedback limit.

**Contact form.**

- `POST /api/contact` stores a message whose `email` is a well-formed address and whose `message` is 10 to 4000 code points. Otherwise it is `400` `VALIDATION_ERROR` on that field.
- A submission that fills `website` gets the same `201` answer and is not stored.
- With scripts off, the `/contact` form posts as a plain document (fields `email`, `message`, `website`) to `/contact` itself, under the same rules:
  - a stored message, or a trapped one, answers `200` with the thanks line in place of the form;
  - a refusal answers `400` (or `429` for the hourly limit) and re-renders the form, with the typed text and the error from Feedback states beside its field.

**Markdown twins.**

- **When they answer.** `GET /` and `GET /contact` answer `200` with the header `Content-Type: text/markdown; charset=utf-8` and a `Vary` header naming `Accept` in either of these cases:
  - the query holds `md`, with any value or none;
  - an `Accept` header names `text/markdown`.
- **Front matter.** The document opens with `---`, then `title: "<the page's HTML title>"`, then `description: <the page's meta description>`, then `---` and an empty line.
- **Body.** It writes every heading of the page with one `#` per level, paragraphs as plain lines, and links as `[text](href)`.
  - The landing page holds `# Give agents ability to retrieve the most accurate context` and `## SOTA for agent applications`.
  - The contact page holds `# Contact sales`.
- **Navigation tail.** The document ends with a line `---`, an empty line, `## Navigation` and these five lines:
  - `- [Architecture](/#architecture)`
  - `- [Benchmarks](/#benchmarks)`
  - `- [Pricing](/#pricing)`
  - `- [FAQs Common questions](/#faq)`
  - `- [Contact](/contact)`

### Services (DP-28, DP-40, DP-67, DP-70, DP-72, DP-79)

**Mail.**

- Mail travels over SMTP to Mailpit at `SMTP_HOST` and `SMTP_PORT`, one message per recipient, with no cc and no bcc.
- The From line of every message is `Tessel <notices@tessel.example>`. The environment provides it as `MAIL_FROM`, and the app reads it from there and never writes it into the source.
- The subjects are exactly these:

  | Event | Recipients | Subject |
  |---|---|---|
  | a member is added | the new member | `You have been added to <organization> on Tessel` |
  | the plan really changes | every owner of the organization at that moment | `Plan changed to Ship` or `Plan changed to Scale` |
  | a key is rotated | every owner | `API key rotated: <key name>` |
  | a key is revoked | every owner | `API key revoked: <key name>` |
  | an export succeeds | the owner who asked for it | `Export ready: <database>` |
  | a reset is asked for a member's email | that member | `Reset your Tessel password` |
  | a password is reset | that member | `Your Tessel password was reset` |

- What each body says:
  - the added-member body names the role and `/login`;
  - the plan body names the organization and the new minimum, `$25.00` or `$300.00`;
  - the export body names the job id and its download path;
  - the first line of the reset body is `<APP_PUBLIC_URL>/reset?token=<token>`.
- Nothing is sent for a refusal, an idempotent replay, a switch to the plan already in force, a key creation, or a reset asked for an email that belongs to no member.
- The export email arrives within 10 seconds of the request, whether or not anyone reads the job.

**The code host mock.** Tessel never calls a public code host. `/app/fixtures/code-host-repo.json` is a saved response holding `full_name` `tessel-labs/tessel` and `stargazers_count` `13062`. `GET /api/code-host/repo` answers those two fields from that file.

**Integrations.** Mailpit is the only mail service. The build keeps no object store, queue, payment service or outside identity provider, and takes no payment.

### Seed data (DP-06, DP-35, DP-37)

Every seeded person, organization and company here is invented. **Every seeded account uses the password `deku-demo-pw-2026`.** It is benchmark fixture data, not a secret. It must work at login exactly, and it is written into `/app/USER_README.md` beside each account.

| Organization | Plan | Members |
|---|---|---|
| `Northwind Labs` | `ship` | `northwind.owner@example.com` (`owner`), `northwind.editor@example.com` (`editor`), `northwind.viewer@example.com` (`viewer`) |
| `Acme Ops` | `scale` | `acme.owner@example.com` (`owner`) |

Seeding is idempotent: restarting the app never duplicates rows or moves a counter. Seeded sources count as ingested when the seed first runs. Seeded members have two-step sign-in off.

**Northwind's `launch_brain`.** `Northwind Labs` owns the database `launch_brain`, `ready` from the start, with the collection `default`. It holds four sources, ingested in this order as log entries 1 to 4 and already compacted (`indexed_lsn` 4, `index_generation` 1):

| lsn | id | title | text |
|---|---|---|---|
| 1 | `kickoff-notes` | Atlas launch kickoff | Priya Raman owns the Atlas launch. The launch is blocked by the billing migration, which Marco Silva owns. |
| 2 | `reorg-memo` | Platform reorg memo | Priya Raman moved to the platform team. Dana Okafor now owns the Atlas launch. |
| 3 | `billing-standup` | Billing standup notes | The billing migration depends on the ledger service. Marco Silva owns the ledger service too. |
| 4 | `launch-retro` | Atlas launch retro | The billing migration shipped. The Atlas launch is now blocked by the security review, owned by Lena Brandt. |

Its facts:

| Subject | Predicate | Object | valid_from | reason | source |
|---|---|---|---|---|---|
| Atlas Launch | `OWNED_BY` | Priya Raman | `2026-01-05T09:00:00Z` | Kickoff assignment | `kickoff-notes` |
| Billing Migration | `OWNED_BY` | Marco Silva | `2026-01-05T09:00:00Z` | Kickoff assignment | `kickoff-notes` |
| Atlas Launch | `BLOCKED_BY` | Billing Migration | `2026-02-01T00:00:00Z` | Invoices must move first | `kickoff-notes` |
| Atlas Launch | `OWNED_BY` | Dana Okafor | `2026-03-10T12:00:00Z` | Priya moved to the platform team | `reorg-memo` |
| Billing Migration | `DEPENDS_ON` | Ledger Service | `2026-03-14T10:00:00Z` | Standup finding | `billing-standup` |
| Ledger Service | `OWNED_BY` | Marco Silva | `2026-03-14T10:00:00Z` | Standup finding | `billing-standup` |
| Atlas Launch | `BLOCKED_BY` | Security Review | `2026-04-02T15:30:00Z` | Billing migration shipped | `launch-retro` |
| Security Review | `OWNED_BY` | Lena Brandt | `2026-04-02T15:30:00Z` | Retro assignment | `launch-retro` |

**Acme's `launch_brain`.** `Acme Ops` owns its own database, also named `launch_brain`, `ready`, with the collection `default`. It holds one source, `acme-plan`, titled `Acme rollout plan`, with the text `The rollout is owned by Jordan Lee.`. Its one fact is `Acme Rollout` `OWNED_BY` `Jordan Lee` from `2026-02-01T00:00:00Z`, with the reason `Plan of record`.

**Worked answers.** On that seed:

| Statement | As of | Answer |
|---|---|---|
| `MATCH (a {name: 'Atlas Launch'})-[:OWNED_BY]->(o) RETURN o.name` | `2026-02-15T00:00:00Z` | `[["Priya Raman"]]` |
| the same statement | `2026-03-11T00:00:00Z` | `[["Dana Okafor"]]` |
| `MATCH (a {name: 'atlas launch'})-[:BLOCKED_BY]->(b)-[:OWNED_BY]->(o) RETURN b.name, o.name` | `2026-03-20T00:00:00Z` | `[["Billing Migration", "Marco Silva"]]` |
| the same statement | `2026-04-03T00:00:00Z` | `[["Security Review", "Lena Brandt"]]` |
| `MATCH (m {name: 'Marco Silva'})<-[:OWNED_BY]-(w) RETURN w` | `2026-03-20T00:00:00Z` | `[["Billing Migration"], ["Ledger Service"]]` |

## Technical requirements

### Deployment (DP-65, IF-01, IF-02)

**The application.**

- The app is a Python 3.12 server that renders every page as HTML on the server.
- Plain scripts written for each page upgrade that HTML in place: the hero view switch, the Resources menu, the tabs, the FAQ, the price calculator, the console tabs, the query editor, the inline rows and the toasts.
- Every page and form works as a plain document first.
- What ships is a production build, served without a development server or reload mode.

**Installing and starting.**

- The app is installed and run as an unprivileged user. Dependencies go into a `.venv` folder inside the app root, and the manifest calls their tools by path (`.venv/bin/<tool>`) or as `python -m <tool>`.
- Ship `/app/run.json` with string `install`, `build` and `serve` commands and `"_schema": "run-manifest-v1"`. They run in that order from the root folder of a fresh copy of `/app`, so they use only paths relative to the app root, never `/app/...`. For example:

  ```json
  {"_schema": "run-manifest-v1",
   "install": "python3.12 -m venv --clear .venv && .venv/bin/pip install --no-cache-dir -r requirements.txt",
   "build": ".venv/bin/python -m compileall -q .",
   "serve": ".venv/bin/python -m tessel_server"}
  ```

- `/app/run.json` is the only start path. Ship no `/app/Dockerfile`.
- The app must also start after a restart in a separate, fresh container that receives a copy of `/app`. That container runs Python 3.12 on Debian as an unprivileged user, with `DATABASE_URL`, `APP_PUBLIC_URL`, `APP_PUBLIC_PORT`, `SMTP_HOST`, `SMTP_PORT` and `MAIL_FROM` set. Packages installed only into the environment image are not there.
- The app starts with no manual steps. It applies its schema and seed idempotently every time `serve` starts.

**Network.**

- The server binds `0.0.0.0` on port 4173 inside the container, never `127.0.0.1` or `localhost`. The outside port is `APP_PUBLIC_PORT`, and the public address is `APP_PUBLIC_URL`. Read both from the environment and never hard-code either.
- The HTTP API is served on that same origin under `/api`.
- `GET /api/health` returns HTTP `200` with the envelope whose `data` is `{"status": "ok"}`, once PostgreSQL can be reached.
- The server keeps running after this session ends and is not a child of the shell.

**Files and directories.**

- Login credentials are written to `/app/USER_README.md`.
- The reserved `.browser_screenshots/` and `.downloads/` directories exist at the app root, empty.
- There are no persistent volumes, no fixed container names and no custom networks.

### Configuration and secrets (DP-39, DP-66, DP-70)

**Environment variables.**

| Variable | Meaning |
|---|---|
| `DATABASE_URL` | PostgreSQL, already running |
| `SMTP_HOST`, `SMTP_PORT` | Mailpit's SMTP sink |
| `MAIL_FROM` | the From line of every message, as printed in Services |
| `APP_PUBLIC_URL`, `APP_PUBLIC_PORT` | the app's own address and outside port |

Each is read at start and never written into the source or sent to the browser. Do not download, install, compile or start a copy of PostgreSQL or Mailpit.

**Secrets in pages.** No page or script carries a key secret, a password, another member's session token or another organization's data. The only exceptions are one-time displays to the member who just caused them, in the answer to that one request and on that member's own page:

- a new or rotated key's secret;
- the two-step setup key and its key address;
- the ten recovery codes.

None of them is shown again by any later answer or page.

**Secrets in storage.** Reset tokens, recovery codes, session tokens and key secrets are stored only as digests, and a member's password only as `password_hash`. The two-step sign-in secret is the one secret kept as itself, because every later code is checked against it:

- it is kept in the member's row, pending until `Turn on` succeeds;
- it is cleared when two-step sign-in is turned off;
- it is never returned after the setup answer.

### Server boundary (DP-30, DP-63, DP-66, DP-95)

**What the backend owns.**

- every table and every write to it, and the idempotent seed;
- sign in, the bearer token, the session cookie and API keys;
- role gating, key scope and organization isolation on every signed-in endpoint, reads included;
- provisioning, the write log, versions and compaction;
- tokenization, scores, supersession, relations, history and the graph language;
- the bill, the plan rules, every rate limit and the contact form.

**What the front end owns.** Presentation and interaction only. The landing calculator computes on the page by the same arithmetic the server uses. Hiding a control is presentation; the server refuses the call regardless of what the page drew.

**No mocks.** Every record a page shows lives in PostgreSQL. Each of these is a contract violation, however good the interface looks:

- an in-memory dictionary standing in for a table;
- a JSON file holding members, sources, facts or the log;
- a stubbed client that answers its own calls.

The one saved file the app reads is `/app/fixtures/code-host-repo.json`. Every email really travels over SMTP to Mailpit.

**What the server never serves.** Source files, the run manifest, environment values, credentials, stack traces, debug pages or test endpoints. An address outside the published pages and the route tables answers the custom not-found page, or under `/api` the `ROUTE_NOT_FOUND` envelope.

**Same origin.** The app calls only its own origin from the browser.

**Unreachable at boot.** If PostgreSQL cannot be reached at boot, the server keeps retrying. Until it connects, `/api/health` answers no `200`, and it answers `200` within a few seconds of the database becoming reachable.

### Browser support and performance (DP-57, DP-59, DP-69)

**Browsers.** Current Chromium at the `phone`, `tablet` and `desktop` layouts, with and without the reduced motion preference.

**Accessibility.**

- WCAG 2.2 AA, with labelled controls and errors announced beside their field.
- A visible focus ring on every control for keyboard focus, and not after a pointer click.
- Every page sets a descriptive title.
- Every image or icon that carries meaning has a written alternative.

**Performance.**

- The landing page shows the hero heading and the Text view without waiting for any data request.
- A graph query over the seed data answers within 200 milliseconds.
- With 2000 live sources in one database, a keyword search and the source list each answer within 1 second.
- The audit log pages within 500 milliseconds when it holds 1000 events.

## Working rules

These rules cover the gaps and substitutions against the captured site:

- The dashboard behind its Log in and Sign up is reconstructed. There is no self sign-up, and owners create members.
- Its semantic, vector and reranked retrieval becomes the exact keyword score.
- Facts are declared at ingest rather than extracted from text.
- These are not built: connectors, webhooks, a separate memory store, query modes, the external booking page, the community chat server, benchmark pages, a chat widget, analytics, a newsletter, a blog, a manifesto, competitor pages, the privacy policy and the terms of service.
- The bill is shown and never charged.
- The product is English only.

- IF-01: `/app/run.json` holds `"_schema": "run-manifest-v1"` and string `install`, `build` and `serve` commands whose `serve` starts no development server or reload mode, `/app` ships no `Dockerfile`, and no compose file in `/app` sets volumes, container names or networks.
- IF-02: `/app/USER_README.md` lists every seeded account with the password `deku-demo-pw-2026`, and the reserved `.browser_screenshots/` and `.downloads/` directories exist at the app root, empty.
- IF-03: `/app/fixtures/code-host-repo.json` holds the saved code host response that `GET /api/code-host/repo` answers.
- IF-04: `/app/THIRD_PARTY_NOTICES.md` names every shipped package with its version and licence, where shipped packages means the production dependency tree that `install` puts into `.venv` from the pinned requirements, excluding any development-only group.
- IF-05: Every shipped package carries an MIT, BSD, Apache-2.0, ISC, PSF or MPL-2.0 licence.
- IF-06: The app uses no datastore besides the PostgreSQL at `DATABASE_URL` (no SQLite file, no embedded key-value store) and sends mail only through `SMTP_HOST` and `SMTP_PORT`.

## Engineering standards

- The code is idiomatic Python and plain browser script, and its names use this brief's domain terms: database, collection, source, version, fact, write log entry, lsn, compaction, generation, member, API key, audit event.
- Each domain rule is decided in exactly one place in the source, and every caller uses that place. That covers the error precedence, supersession, the length count, the return-path rule, the CSV neutralisation, the pricing arithmetic and the plan limit.
- Every refusal is produced through one envelope with the catalogue message. There is no second error shape and no framework-default error body.
- Concurrency winners are decided inside PostgreSQL, by row locks, constraints or serializable transactions, never by process memory. Writes that belong together share one transaction: a log entry with its source, version and facts, or an action with its audit event.
- Computations are deterministic, and configuration comes only from the environment variables this brief names.
- There is no abstraction with a single implementation, no dead, commented-out or unreachable code, and no defensive check for a state the rules make impossible.
- There is no feature, route, screen or setting beyond this brief.
