# TRUTH — Aldermoor Labs Open Record

This is the intended product behaviour, not a relaxation of the brief. `brief:` marks binding requirements copied from instruction.md; `decided:` marks implementation or presentation choices where the brief is silent, each tied to the brief's intent. `DESIGN.md` is the exact visual contract. `PLAN.md` maps all seventy DP requirements (DP-01 to DP-70) and the seven IF rules to their implementation.

## Journeys and provider-recorded end states

### 1. Reading and searching the record
Source: brief: Journey 1, DP-01–03, DP-43, DP-65–67, Public screens and controls, Public ordering and visibility, Newsroom filters, Search.

Start: an anonymous visitor with cookies refused opens `/`. The heading is "The open record of Aldermoor Labs". The `list "Theses"` holds the five fixed headings from Seed data, each headed "Thesis <n>. <heading>". Decided: original body paragraphs explain evidence, named release decisions, simultaneous publication, thorough withdrawal and candidate transparency; they contain no word beginning "evalu" (brief: Words in seeded text you write).

As the visitor scrolls, the accent progress line beside the theses fills: empty when the first thesis's top reaches the viewport middle, full when the last thesis's bottom does; the list reports `data-thesis-progress` with two decimals and the thesis crossing the middle carries `data-current="true"` (brief: Motion and effects).

The "Latest from the record" complementary rail has one link per item for the five newest published model routes and news posts, each with its kind and publication time; at one instant models precede news, then titles order. Seed order: We are hiring research engineers; Interpretability notes, autumn; Kestrel 2; Introducing Kestrel 2; How we sign off a release (brief: Seed data).

The visitor opens `/news`, follows the Safety subject link, then the evaluations tag link. Each facet is a plain link whose address changes that parameter and drops the page; Back and Forward step through earlier addresses. A second cookie-free browser opening the copied address shows the same posts and the same facet counts the API returns. Subject counts apply the current tag; tag counts apply the current subject; every subject is listed, including zero counts; tags are those carried by at least one published post, alphabetical. Ten posts per page; `pages` is at least 1; unknown subject or tag yields no posts and the empty state "No posts match these filters." with "Clear filters".

The visitor opens `/search`, enters "evaluation" and submits. The page asks the API for three results; matched words are highlighted with `<mark>`; the page adds "…" at a passage end that was cut mid-text (decided: an excerpt reads as an excerpt; the API highlight is unchanged). Seed data gives five matches: the kestrel-2 route, the three published evaluations-tagged news posts and the research-engineer-evaluations role. "More results" loads the address carrying the API's opaque `next_cursor`; a second browser opening that address shows the same two remaining results. Back returns to the first page; the News kind link narrows to the three posts with no "More results".

Ranking (brief: Search): PostgreSQL English stemming over a search index maintained in the same transaction as publication, withdrawal and requisition open/close; title weight A, summary B, body or description C; order rank desc, published_at desc, slug (decided: kind breaks remaining ties so the keyset is total). Quoted text is a phrase and a leading minus excludes. The cursor encodes the query, kind and the last row's sort key, so following cursors yields each match once; it is refused with "This cursor does not belong to this search." for another query or kind.

Record as of (brief: Record as of): `/news`, `/models`, `/models/<slug>` and `/news/<slug>` and their APIs accept `as_of=YYYY-MM-DDTHH:mm:ssZ` not later than now; the record is every item published at or before T per the publication history and not withdrawn now. Pages show the "Record as of" region "You are reading the record as it stood at <D Month YYYY, HH:mm> London." with "Read the current record"; facet links keep `as_of`.

Provider end state: reads only; no cookie, account, analytics event or other-origin request.

### 2. Checking a claim
Source: brief: Journey 2, DP-04–09, DP-69–70, Chart grouping, Claims, Motion and effects, Feedback states.

Start: `/models` lists published routes newest first in three columns at desktop. Opening Kestrel 2 runs a cross-document view transition: the clicked title moves and grows into the page heading over 400 ms while the page fades in; Back reverses it; reduced motion swaps at once (decided: CSS view transitions with a per-item `view-transition-name`, the brief's "browsers that cannot do this get a plain page change").

The route shows its seeded name and summary, "1 min read", "Published <local> your time (<London> London)" (London only before scripts), sections, chart, "Recorded evaluation rows", samples and the linked announcement. The pinned section rail jumps to "How we evaluated it"; it is pinned only beside the prose and marks with `aria-current="location"` the last section whose top has passed a reading line 30% down the viewport, or the first section while none has, evaluated on load, scroll and resize (decided: the reader always knows their place in the long-form argument). On first view the chart's bars grow from the baseline in 500 ms each, 60 ms apart, scores present throughout; `data-entered` becomes true when the last settles.

Claim 2 cites LongDoc-QA, 2026-09-14: Kestrel 2 84.9 versus Halvard 3 80.6, recorded difference +4.3. Activation by click, tap, Enter, Space or mouse hover: the address gains `claim=c2` by history replacement and the marker fills; an accent leader draws (580 ms) from the marker along the gutter beside the prose, across the clear band above the chart to a spine between the bar tracks and the scores, then by a short leg to each cited bar's settled end, redrawn on resize (decided: the line visibly connects claim to evidence without crossing a bar); uncited rows fade to 0.28 (250 ms) with `data-cited="false"`; the mono difference counts from 0 to +4.3 in a label that holds no flow space, set on the boundary between the two cited rows in the score column, so nothing below moves (brief: Motion and effects); then the polite, visually hidden "Claim tether" region (decided: hidden so the announcement never shifts the chart below it, brief: Motion and effects) says "Claim 2: LongDoc-QA, Kestrel 2 84.9 versus Halvard 3 80.6, evaluated 14 September 2026." Escape or a second pinned activation runs the steps in reverse, announces "Claim 2 released.", and keeps focus on the marker. A copied address with a valid claim restores the end state without animation; an unknown id is ignored. Below 720 px an aria-hidden bracket labelled "Claim 2" replaces the line. Reduced motion uses every end state at once.

Provider end state: samples are private MinIO objects under `samples/kestrel-2/` reached only through `/media/samples/...`. Two procedural WAV clips play one at a time; twelve procedural PNG frames step with Previous/Next and arrow keys, wrapping, never automatically. With storage unreachable the route answers 200, `samples` is `[]` with `samples_available:false`, and the gallery shows "Samples are unavailable right now. The recorded benchmarks above are unaffected."

### 3. Review and responsible release
Source: brief: Journey 3, DP-10–16, DP-51–52, DP-64, Content lifecycle, Release record, Claim validation, Accepted body keys, Versions.

Start: an editor signs in and creates a model route or news post. The server assigns id, author, `draft` and version 1. Create, edit and transition bodies accept only their listed keys; any server-owned or unknown key (`id`, `kind` on PATCH, `status`, `version`, `author`, `comments`, `release_at`, `release_at_local` outside schedule, `published_at`, `read_time_minutes` or anything else) refuses the whole request with `422 read_only_fields`, one entry per offending key, and changes nothing: no version change, no audit entry (brief: Accepted body keys, DP-51). Read time is never accepted from a client; the server computes it at publication.

The author submits; a colleague comments; a non-author approver returns with a reason; the author revises and resubmits; a different approver approves. Only drafts and returned items are editable. Comments are open in draft, in_review, returned and approved.

Versions (brief: Versions, DP-64): content PATCH, submit, approve, return, schedule, release and withdraw require `If-Match: "<version>"`, answering 428 without it and 412 when stale; every versioned change is a conditional database write and raises the version by exactly one. Release-record endpoints and comments take no If-Match (brief: API, Versions); their races are settled by locking the route row, so of two simultaneous sign-offs exactly one answers 201. Decided: comments and release-record actions do not change the content version, because they are not versioned changes of the item.

For model routes, each submission queues one sign-off email to every distinct active approver except the author. Safety and legal sign-off come from two different approvers, neither the author, while the route is in review or approved. Any edit empties the record to `open` with one `release_record.void` entry `{"reason":"route_edited"}`. Validation runs once both sign-offs exist and checks markers, cited rows, the stated difference by numeric value, and every number in the claim text after removing the model, comparator and benchmark names and skipping letter-adjacent tokens and dates; a failing run keeps `signed`, a passing run moves to `claims_validated`, and every run writes `claims.validate`. A non-author approver clears it.

Sign-off lapse (brief: DP-52): revoking a signer's approver grant voids their sign-offs on uncleared records in the same transaction (actor: the revoking administrator); an expiry voids within 60 seconds (actor `system:grants`). Each void writes `release_record.void` `{"reason":"signoff_lapsed","kind","signer"}`, nulls `claims_validated_at` and `last_validation`, and the record falls back to `safety_signed`, `legal_signed` or `open`. Between expiry and void, validate-claims and clear answer `409 signoff_lapsed`. Cleared records are never voided.

Error precedence for every endpoint (brief: Error precedence): 413/415, 401, 429, idempotency replay or conflict, 404, 403, 428, 422, 412, 409. Authors are refused with `403 author_cannot_approve` for approve, return, sign-off, clear, schedule and release, including a linked announcement they wrote. Provider end state: PostgreSQL content, revisions, comments, release record, immutable benchmark rows, hash-chained audit and mail jobs; Mailpit receives one sign-off email per approver.

### 4. Embargoed launch
Source: brief: Journey 4, DP-17–20, Embargo time, Linked announcement, Release, Concurrency.

Start: an approved model route with a cleared record and an approved linked post. The approver opens "Schedule release", types a London wall-clock time and sees the same instant in their browser zone. The server accepts minute or second precision, refuses malformed, past and spring-gap times with the brief's messages, takes the earlier BST occurrence in the autumn repeat, and stores the instant and the London value; the response carries `"zone":"Europe/London"`. Both items are scheduled for one instant in one transaction; the success copy is "Release scheduled for <D Month YYYY, HH:mm> London."

Until then, guessed route and post pages and APIs are byte-identical to a never-existing slug, and neither appears in the catalogue, Models menu, home rail, newsroom, search, feed or sitemap. Within five seconds after the instant, one database-locked scheduler transaction on any instance publishes both, sets `published_at` to the instant, computes read time at 225 words a minute, records publication history and search entries, raises versions, and audits `content.release` with actor `system:scheduler` and the scheduling approver, kept in the embargo schedule, in its detail. "Release now" uses the same path with the present instant. A withdrawal sent with the pre-release version answers 412; if the withdrawal wins, the release never happens.

### 5. Withdrawal
Source: brief: Journey 5, DP-21–22, DP-53, Withdrawal and derived values.

An approver confirms "Withdraw this item?". In that transaction the item leaves every list, count, facet, search result, feed and sitemap, publication history records the withdrawal instant, and every derived value equals a fresh recount (total, pages, facets, tag list, home rail backfilling to five, feed `<updated>`, or `2026-01-01T00:00:00Z` with no entries). Its address answers 410 ("This post has been withdrawn." / "This model route has been withdrawn."); a route's `linked_news` becomes null; withdrawing a route withdraws its linked post. An item withdrawn while scheduled stays 404. The record as of an earlier moment still omits it.

### 6. Applying and tracking
Source: brief: Journey 6, DP-27–35, DP-55, DP-57, Candidate endpoints, Candidate name and email, Tracking links, Re-sending links, Services.

A visitor filters careers by discipline, office and region through GET addresses (scripts apply each change at once and push the address), opens the role, reads its region's benefits in force, and applies with a name such as "Zoë D'Arcy, Jr", an email, consent and a PDF. Errors appear under their fields with the API messages and focus moves to the first; while pending, "Submit application" is disabled and the region reads "Sending your application…". A PDF is exactly a 1–5,000,000-byte body starting `%PDF-`, whatever its name or type. Names with control characters or U+2028/U+2029, and emails with CR, LF, comma, semicolon, space, quote, angle bracket or control characters, are refused before anything is stored.

One transaction plus compensating object deletion creates the application, the private object `resumes/<requisition id>/<32 hex>.pdf` and the receipt mail job together; storage failure answers the exact 503 and leaves none. A second submission for the same role and trimmed, lowercased email answers 200 with the original body; of racing identical submissions exactly one answers 201. The receipt has exactly one recipient: the stored name (RFC 2047 encoded when not ASCII, quoted when it carries specials) and the stored email. The page confirms "Application received. Your receipt and tracking link are on their way to <email>."

Decided: tracking tokens are 256 random bits, stored by SHA-256 digest; the live link for later emails is encrypted at rest with a key derived from the environment. The tracking API carries exactly role {title, office}, stage, stage_label, submitted_at and stage_changed_at, with `Cache-Control: no-store` and `Referrer-Policy: no-referrer`. The candidate withdraws after confirming "Withdraw application?" (initial focus "Keep my application"); the decision records actor `candidate` and "Withdrawn by candidate".

Re-send answers the same 202 body for any email without waiting on mail. At most three re-sends per email are queued in any rolling `RESEND_WINDOW_SECONDS`, counting unknown emails; over the limit nothing is queued and no token rotates. Each re-send or recruiter reissue mints a new token and kills the old one at once. When a requisition closes it stores `closed_at` plus that instance's `APPLICATION_RETENTION_SECONDS`; after that stored deadline links answer 404 and, within 60 seconds, the retention sweep replaces the name and email with "Erased applicant" and an empty value, queues a `resume_erase` job, and audits `application.erase` as `system:retention`.

### 7. Running a requisition
Source: brief: Journey 7, DP-23–26, DP-36–38, DP-54, DP-56, Requisition lifecycle, Careers text limits, Application lifecycle, Stage-move races.

A recruiter creates a draft (the caller is always assigned; every listed recruiter must hold the recruiter role), opens it with If-Match, and records a benefits entry (real calendar date; summary at most 500 code points). Titles allow 120 and descriptions 8,000 code points after trimming; exactly the limit is accepted and stored text round-trips. Roles order by `opened_at` newest first, then title; the entry in force per region is the latest effective-from on or before today in London.

Assigned recruiters download the résumé, add an interview note and move submitted → screening → interview → final_review → offer, each with a rationale at the current version; the candidate email reveals only "Your application is now at: <stage label>." and the tracking link. Unassigned callers get the console 404 for applications, requisitions and résumés. Concurrent moves at one version leave one decision, one email, one audit entry and 412 for the rest; a candidate withdrawal racing a move to offer leaves exactly one effect. Closing with a reason declines each active application with "Requisition closed: <reason>", one audit entry and one stage notice each, and raises each version; a later move with the old version answers 412. Closed roles answer 410 and refuse applications with 409 `requisition_closed`.

### 8. Governing access and the platform
Source: brief: Journey 8, DP-39–42, DP-58–63, DP-68, Staff sessions, Sign-in lockout, Rate limits, Idempotency keys, Running more than one instance, Background jobs, Audit chain.

Staff sign in with email and password into a database-held session lasting `SESSION_TTL_SECONDS`; the cookie is HttpOnly, SameSite Strict, and the only cookie the platform sets. Decided: passwords use salted scrypt; unknown emails run the same scrypt work. The seeded staff password (brief: Seed data) is held in source only as one salted scrypt digest, never as plaintext (brief: Configuration and secrets, "Never hard-code a credential"). Five consecutive failures for one trimmed, lowercased email lock it for `SIGNIN_LOCKOUT_SECONDS`; each failure after a lock ends locks again for double the previous lock, up to eight times; during a lock every attempt answers `429 signin_locked` with `Retry-After`, neither extending nor counting; success resets. Known and unknown emails answer identically.

Every console request reads grants as they stand. Ada grants a colleague the approver role until an instant; the colleague approves; Ada revokes with the grant's If-Match version, and the colleague's next approval in the same session answers 403. A grant whose expiry is within seven days gets exactly one notice of its own, addressed to its grantee, within 60 seconds of becoming due. The last active administrator cannot be revoked.

Rate limits live in PostgreSQL in fixed 60-second windows per bucket key: public 600 per client, candidate 60 per client, sign-in 20 per client, console writes 120 per staff account; every counted response carries RateLimit-Limit/Remaining/Reset and a 429 adds Retry-After. The client is the peer address, or the leftmost X-Forwarded-For when `TRUST_FORWARDED_FOR` is true. Every console write except sign-in and sign-out and every application submission honour an `Idempotency-Key`: the first 200–499 response (not 401 or 429) is stored for `IDEMPOTENCY_TTL_SECONDS` and replayed with `Idempotency-Replayed: true`; a different request under the key answers 409 `idempotency_key_reused`, a concurrent one 409 `idempotency_in_progress`.

The audit lists entries highest `seq` first with Seq, When, Actor, Action, Target and Detail. Each entry's `hash` is SHA-256 of `prev_hash`, a line feed and canonical JSON of {seq, at, actor, action, target_type, target_id, detail}; entries join the chain at commit under one database lock, so `seq` follows commit order without gaps. "Verify chain" answers "Audit chain verified: <n> entries." A PostgreSQL trigger refuses UPDATE, DELETE and TRUNCATE on `audit_entries`; the API answers 405 `audit_immutable`. Entries never hold candidate names, emails or résumé keys, so erasure leaves the chain valid.

Mail, résumé erasure and sample uploads are database jobs. Each instance probes storage and mail at start and every 5 seconds, and claims due jobs only for services its own probe reports up, under a 60-second lease. Decided: every sweep waits a random half to whole period between runs, so no instance keeps a fixed lead and due jobs spread across all capable instances (brief: Running more than one instance). Unreachable attempts record `mail_unreachable`/`storage_unreachable` and are due again after `OUTBOX_RETRY_SECONDS`; refusals record `mail_refused`/`storage_refused` and back off `OUTBOX_RETRY_SECONDS × 2^(n−1)` capped at `OUTBOX_RETRY_MAX_SECONDS`; `JOB_MAX_ATTEMPTS` refusals make a job dead. `/console/jobs` lists Pending, Dead and Done; "Retry job <id>" returns a dead job to pending with attempts and refusals 0 and audits `job.retry`. Every mail attempt for a job carries `Message-ID: <outbox-<job id>@aldermoor.example>`. `/api/ready` reports each dependency and the degraded features; every console screen shows the "Service status" banner from it on load and every 15 seconds.

## Palette, type, space and responsive layout

| Role | Exact value | Provenance |
|---|---|---|
| Paper | #F5F2E9 | decided: warm off-white required by brief: Visual design |
| Graphite | #292B29 | decided: near-black ink required by brief: Visual design |
| Secondary | #626660 | decided: cool grey, AA on paper |
| Oxide | #923F2D | decided: the one accent — active claim marker, cited bars, thesis progress line, hover underlines, focus rings, search highlight underline |
| Hairline | #D8D0BF | decided: pale sand rules; also the search highlight wash |
| Boundary | #797B72 | decided: AA control borders |
| Display | Newsreader 400/500, Georgia serif fallback | brief: Visual design |
| Body | Instrument Sans 400/500/600, Arial sans fallback | brief: Visual design |
| Numbers | JetBrains Mono 400 and 600 (digits follow the surrounding weight), tabular | brief: Visual design |
| Body measure | 68ch; 18px, 1.65 line height; 17px below 720px | brief: 68 characters; decided: reading sizes |
| Heading scale | each level 1.25 × the level below | brief: a quarter larger; decided: base sizes |
| Space | 4, 8, 12, 16, 24, 32, 48, 64, 80, 96 px | decided: airy document rhythm |
| Shape | zero radius; 1px rules; 2px focus ring with 3px ground-colour offset | brief: hairlines and focus; decided: square documentary controls |

At 1280×800 (brief: Screens and layout; decided: exact margins): a twelve-column sheet with 64px margins and 24px gaps; long-form prose in columns 4–10 with the pinned section rail in 1–3; chart and gallery full width between hairlines; home theses in 4–10 with large numerals, the progress line in column 3 and the latest rail in 11–12, no cards; catalogue three columns; search results in 4–10 with kind filters in the left rail; console list four columns, detail eight.

At 768×1024: 32px margins; "Sections" disclosure atop the article; full-width prose; two catalogue columns; latest rail below the theses; progress line at the essay's left edge; search kinds above results; console panes stacked. At 375×812: 20px margins; single column; "Menu" button; the chart scrolls within its frame; evaluation and console table rows become labelled stacked blocks; claim bracket. Breakpoints 720px and 1024px (decided). Decided: controls are at least 48×48px, above the brief's 44px floor; nothing scrolls horizontally.

## Motion table

| Element / trigger | Duration | Properties and easing | Reduced substitute | Provenance |
|---|---|---|---|---|
| Long-form section or thesis enters viewport, once | 650ms | opacity 0→1, translateY 12px→0, cubic-bezier(.2,.65,.3,1); `data-reveal` done on finish | visible at once, done immediately | brief: 500–800ms; decided values |
| Thesis progress line, on scroll | follows scroll | scaleY of the accent-to-rule fill; numeral colour 250ms | jumps; colour at once | brief: scroll-linked; decided 250ms |
| Chart bars, first view | 500ms each, 60ms stagger | scaleX from the baseline, cubic-bezier(.2,.65,.3,1); `data-entered` true at the end | full length at once, true immediately | brief: 0.4–0.6s, 40–80ms; decided values |
| Gallery thumbnails, first view | 300ms each, 40ms stagger | opacity | at once | brief: Chart entry |
| Link/button hover and press | 100ms | underline thickness, button darkening; press translateY 1px | colour only | brief: Hover and press |
| Menu and dialog enter/exit | 200ms | opacity, translateY 6px, ease-out | instant | brief: Disclosure and dialog |
| List-to-detail | 400ms | view-transition of the title into the heading; page crossfade | plain page swap | brief: 0.3–0.5s |
| Tether line, count, sweep | 580ms | stroke-dashoffset; numeric count; ease-out | final state | brief: 0.5–0.65s |
| Uncited rows | 250ms | opacity to 0.28 | instant | brief: 0.2–0.3s |
| Tether undo | 580 / 250 / 580ms | the steps reversed; marker and address last | instant | brief: reverse order, same timing |
| Below 720px tether | instant bracket | labelled "Claim <n>" beside cited rows | instant | brief: Narrow screens |

All motion is CSS, view transitions or `element.animate()`; no loops, bounce, autoplay or third-party script. Motion never shifts content below it and never blocks input: activating a control completes its entry motion at once. No-script pages are fully visible; the core reading, filtering, search and application flows work without scripts.

## Asynchronous and refusal states

Source for every fixed string and status: brief: Feedback states and API. Application, resend, withdrawal, search, sign-in and every console action write to their named polite region with the brief's pending copy; "Submit application" is disabled while pending. Errors show the API message verbatim (including 429 messages) or "We couldn't reach Aldermoor. Check your connection and try again."; 422 on the application shows "Please fix the highlighted fields." with each field message under its field and focus on the first. A 412 adds `button "Reload"`. Every console write sends the current version and a fresh Idempotency-Key; an automatic retry after a dropped connection reuses the key. Decided: a console success reloads the same screen with the success notice in its address, so the confirmation survives the render.

Public status pages are the owned 404 ("Nothing is published here", never echoing the address), 410 and invalid-link pages. Empty states use the brief's copy for the newsroom, careers, search, benefits and jobs. Decided: a small original ledger drawing accompanies empty lists, hidden from assistive technology. Destructive actions use native dialogs with focus kept inside, Escape and cancel, and focus returned to the opener. No alert, confirm, prompt or Notification exists.

## Media and licences

Source: brief: IF-02/03/07, DP-07, DP-49, DP-50, Services. Self-hosted Latin WOFF2 files from Fontsource 5.3.0 (Newsreader 400/500, Instrument Sans 400/500/600, JetBrains Mono 400/600) are OFL-1.1, listed in `app/assets.json` with hashes and reproduced with full licence text in `app/THIRD_PARTY_NOTICES.md`. Control-only Lucide icon paths are ISC with a notice. The runtime production package tree is empty; the build bundles the MIT `pg` and `busboy` packages, and the notices list every bundled and build dependency with its licence.

Decided: `src/media.ts` generates mono 22,050Hz three-second WAV studies and twelve 640×360 PNG frames, shown no wider than 640px, in which procedural noise resolves into a waveform structure, from a faint trace under 85% noise in frame 1 to fully resolved in frame 12. There are no seeded applications, so no PDF fixture ships; nothing is copied media. PostgreSQL and MinIO are the only datastores; no application state is written to local files; the environment's service configuration and credentials are untouched. All source is strict TypeScript without `any`.

## Remaining seed decisions

Decided: where Seed data gives dates without times, requisition opening and closing instants are 08:00 UTC on those dates; the seeded closed requisition's retention deadline is its close plus `APPLICATION_RETENTION_SECONDS`. Seed grants begin 2026-01-01T00:00:00Z. Seeded release-record sign-offs are recorded at 10:00 and 11:00 UTC, validation at 12:30 and clearing at 13:00 on 2026-09-25 (2026-03-10 for Kestrel 1, so its decision precedes publication). Seed writes one publication-history event per published item at its published time, an embargo schedule for each seeded scheduled item (decided: scheduled by Eleni Marsh, who cleared Wren 1's record), the search index entries for published items and open roles, and no audit entries (brief: Audit chain). Seed read times use the same server computation as later publications. Every saved content version also appends its snapshot to `content_revisions` (brief: Services, content and revisions); there is no revision screen or API.
