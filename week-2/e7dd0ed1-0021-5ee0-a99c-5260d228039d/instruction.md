# Farshore Buckets

Farshore Buckets is an object store that works with S3 clients. It is built for small app studios: indie mobile, game and creator-tool teams of two to fifteen people whose players and customers are spread across several continents.

- Each bucket picks the regions that hold its objects.
- Every object shows which regions hold its current version and how long each copy took to arrive.
- Old versions expire on rules the studio sets. A version under retention or legal hold is kept.
- The studio's bots hear about every change through signed webhooks.
- The account is protected by two-step sign-in, a list of the user's own sessions, access keys scoped to a prefix that rotate with an overlap, encryption of every stored byte and a tamper-evident audit trail.
- The studio sees its month-to-date bill before the invoice comes.

Build three things and serve them all from one origin: a public marketing page, a multi-tenant web console, and an S3-compatible API that accepts the requests current AWS SDKs send by default.

The product uses four backing services:

- **Postgres** is the source of truth for:
  - workspaces, members and roles, and the sign-in throttle counters;
  - sessions, with their pending two-step state and step-up confirmations;
  - two-step secrets (stored sealed), each user's last accepted code step, and hashed recovery codes;
  - access keys, with their current and previous secrets stored sealed;
  - bucket placement, lifecycle rules and bucket counters;
  - the object version index, with stored checksums, noncurrent-since times, retention dates and legal holds;
  - each version's wrapped data key and its workspace key generation;
  - per-region replica state and quota reservations;
  - bulk-delete batches and share links;
  - webhook endpoints, the event outbox and the delivery queue for each endpoint;
  - the hash-chained audit trail;
  - the outbound usage queue.
- **MinIO** holds only the encrypted bytes of objects.
- **Kill Bill** holds one subscription per workspace and receives hourly usage.
- **Mailpit** receives every email the product sends.

Out of scope:

- self-service sign-up and workspace creation (workspaces are seeded);
- password reset by email;
- two-step codes by SMS or email, security keys and passkeys;
- the operator resetting another user's two-step sign-in;
- payment collection and invoices inside the app;
- changing a bucket's placement after it is created, and deleting buckets;
- range reads;
- a CDN;
- any datastore other than Postgres and MinIO;
- any third-party sign-in.

## Problem and users

A small studio keeps player uploads, replays, avatars and build artifacts in object storage. Its users are in North America, Europe and Southeast Asia, and nobody on the team is an infrastructure engineer. Today the studio has three poor options:

- **Stay in one hyperscaler region.** The studio pays for every gigabyte downloaded and every gigabyte replicated. Players far from that region wait on slow downloads.
- **Move to a cheap single-region clone.** Locality is lost.
- **Hand-wire it.** Replication rules, cache invalidation and per-key policies pile up, and nobody fully understands them.

The lead developer carries the cost:

- Evenings go to surprise egress bills and to "my upload vanished" tickets caused by lagging replicas.
- Access keys are scoped too broadly and never rotated, because tighter policy and rotation without downtime are too hard.
- One leaked password opens the whole console, and afterwards nobody can say who did what.
- Nobody can tell a support agent where an object actually lives right now.
- Old build and replay versions pile up because nobody remembers to clean them, yet the one replay under a player dispute must never be deleted.
- The build bot polls for changes because nothing tells it.
- Teams that upgrade their SDK find that their cheap S3 clone rejects the new default checksummed uploads.

Farshore is run by one founder-operator. It offers:

- one endpoint;
- regions chosen per bucket;
- replica state visible for every object;
- old versions expired on the studio's own rules, with held versions kept;
- a signed event for every change;
- two-step sign-in, with sessions the user can see and end;
- prefix-scoped keys that rotate with an overlap;
- every byte encrypted under its own key;
- an audit trail whose tampering can be detected;
- the bill shown as it builds up.

Users:

- **Studio developer** (daily):
  - creates buckets with a region placement;
  - uploads and fetches objects through the S3 API or the console;
  - sets lifecycle rules and retention;
  - cleans up objects in bulk with an undo window;
  - confirms that every chosen region holds the current version before shipping a release;
  - secures their own account with two-step sign-in, session review and password changes.
- **Workspace owner** (weekly):
  - invites teammates, changes their roles or removes them;
  - issues, scopes, rotates and revokes access keys;
  - places and releases legal holds;
  - connects signed webhooks to the studio's bots;
  - rotates the workspace encryption key;
  - reviews, verifies and exports the audit trail;
  - watches month-to-date storage and egress against the plan, and downloads usage exports for the studio's books.
- **Read-only teammate** (daily): browses buckets and objects, hands support a link to the exact object view, and mints short-lived share links for QA or support. This user can never write or delete.
- **Link recipient** (occasional): downloads one shared object through a time-limited link without an account. The recipient learns nothing about the studio beyond the file itself and gets nothing once the link expires or is revoked.
- **Platform operator** (daily): runs the service alone:
  - watches the replication backlog for each region live;
  - takes regions offline for maintenance and brings them back online;
  - runs lifecycle sweeps on demand;
  - suspends abusive workspaces;
  - confirms that usage reached billing exactly once, even after a billing outage.

## Journeys

1. **Create a placed bucket and upload.**
   - **Start:** Theo, a developer at the seeded Lanternfish Games workspace, is signed out.
   - **Actions:**
     1. Theo mistypes the password once, then signs in. The console opens on `lanternfish-avatars`, the workspace's first bucket by name.
     2. A script of Theo's tries to create a bucket and also sends `workspace` and `object_count` fields. It gets a 422 naming both fields, and no bucket is created.
     3. In the console, Theo opens `button "New bucket"`, types the same name, picks Cascade as the origin and Meridian and Monsoon as replicas, and creates the bucket.
     4. The address bar shows the new bucket's console address, and focus lands on its heading.
     5. Theo drags two files onto the object table and confirms the upload.
   - **End state:**
     - The bucket is the current link in the left rail.
     - Both objects appear in the table, with a region count in the form settled/placed.
     - Opening an object shows the Replica Wake: the Cascade pin is filled, and the other pins move from pending to settled with their settle times shown.
     - Browser Back returns to `lanternfish-avatars`.
2. **Release readiness on a shared manifest.**
   - **Start:** the seeded object `season-1/manifest.json` in `lanternfish-replays`, with all replicas settled.
   - **Actions:** Theo opens the object in the inspector and uploads a new version over it with "Only overwrite the version I opened" checked. At the same moment, a teammate's save over the same version is rejected.
   - **End state:**
     - Every non-origin pin resets to pending, then the pins settle one by one.
     - The `status "Release readiness"` line moves from waiting to ready.
     - The bucket's object count is unchanged. Its stored bytes rose by exactly the winning version's size times 3, because the replaced version is still stored as a noncurrent version.
3. **Ship a build from CI.**
   - **Start:** the owner Mara has created a read-write access key scoped to `lanternfish-replays`.
   - **Actions:**
     1. The CI job uses a current AWS SDK with its default settings, so its uploads carry CRC32 checksums and may use chunked bodies.
     2. It uploads a large build as a multipart upload, conditioned so that it never overwrites an existing build.
     3. Its connection drops after it sends CompleteMultipartUpload, and it retries.
     4. It then lists the bucket page by page with ListObjectsV2 and a `/` delimiter. Some keys contain spaces, plus signs and non-Latin characters.
   - **End state:**
     - Exactly one new version exists, usage rose once, and one webhook event was emitted.
     - Paging returned every key and folder exactly once, with the names intact.
4. **Read-only browsing and a QA share link.**
   - **Start:** Priya, a viewer at Lanternfish, is signed in.
   - **Actions:**
     1. Priya filters `lanternfish-replays` by the prefix `season-1/` and the tag filter `env=qa`.
     2. Priya opens `season-1/replays/r-0001.bin` and copies the page address into a support ticket.
     3. Priya mints a share link that expires in one hour.
   - **End state:**
     - The link URL is shown once, with its expiry.
     - A support agent opens the copied address in a fresh browser and signs in. The agent sees the same rows and the same open inspector, and browser Back returns to the earlier page.
     - Upload, overwrite and delete controls are not present for Priya, and the server refuses those actions.
5. **A link recipient downloads, then loses access.**
   - **Start:** the link from journey 4, opened with no account.
   - **Actions:**
     1. The recipient downloads the file. It arrives as an attachment carrying nothing but the file and its download headers.
     2. Priya revokes the link.
     3. The recipient tries again.
   - **End state:**
     - The next request after revocation gets the revoked page, which names no studio, bucket or key.
     - A request for a sibling key through the same link never succeeds.
6. **Owner: team, keys and the month-to-date bill.**
   - **Start:** Mara, the owner of Lanternfish, is signed in.
   - **Actions:**
     1. Mara invites a teammate as a viewer. The invite email arrives in Mailpit.
     2. Mara demotes a developer to viewer and removes a departing teammate, whose share links stop working at once.
     3. Mara creates an access key and then disables it. A key-created notice arrives without the secret.
     4. Mara opens Usage and downloads this month's CSV.
   - **End state:**
     - The usage figures and the export contain only Lanternfish buckets, even though Paper Kite has a bucket with a similar name.
     - The billing line says honestly whether Kill Bill has confirmed the totals.
     - Each team change appears in the audit trail.
7. **Operator: maintenance, abuse and billing recovery.**
   - **Start:** Rui, the seeded operator, is signed in at `/ops`.
   - **Actions:**
     1. Rui watches the pending and failed counts for each region update by themselves and takes Pampas offline. New copies to Pampas fail, and the failed count climbs without a reload.
     2. Rui brings Pampas back, and those copies retry on their own.
     3. Rui presses Run lifecycle now twice by accident. Due versions are expired once.
     4. Rui types a reason into the Suspend dialog while the figures behind it keep updating, then suspends the workspace. Its owners are emailed once.
     5. Rui opens the billing queue during a Kill Bill outage.
   - **End state:**
     - The typed reason was never lost.
     - Queued usage rows wait durably. When Kill Bill returns they drain with no duplicates and no restart, and the owner's billing line returns to in sync.
     - Throughout, no workspace member can reach any operator endpoint.
8. **Lifecycle, retention and a disputed replay.**
   - **Start:** Theo is signed in at `lanternfish-replays`, which has no lifecycle rules.
   - **Actions:**
     1. Theo saves rules that expire noncurrent versions after 1 day, keep the newest noncurrent version, and abort incomplete uploads after 1 day.
     2. Theo overwrites the manifest several times. One superseded version's copy to Pampas, in a Pampas-placed bucket, failed while Pampas was offline.
     3. Mara places a legal hold on the version of `season-1/replays/r-0001.bin` that is under a player dispute.
     4. Theo types a retain-until time for another version. The Versions list keeps refreshing beneath the Retention dialog while Theo types, and the dialog stays open with the typed value.
   - **End state:**
     - Each superseded version disappears exactly 1 lifecycle day after it became noncurrent, except the newest one and the held ones. Its bytes leave every region, its share links stop working and its backlog entries clear. Nothing comes back when Pampas returns.
     - Theo's permanent delete of the retained version is refused until its retain-until second and succeeds from that second.
     - The held replay survives every sweep.
9. **A webhook to the studio's build bot.**
   - **Start:** Mara is on the Webhooks page, which has no endpoints.
   - **Actions:**
     1. Mara adds the build bot's URL for `object.created` on `lanternfish-replays` and copies the signing secret.
     2. CI uploads three builds. The bot has a bug that makes it answer an error to every request for the first build, and accepts the others.
     3. The first delivery fails, retries on the backoff and finally dies. Sequences 2 and 3 wait behind it while it retries, and are delivered only after it has died.
     4. Mara receives one email, fixes the bot and presses Redeliver for sequence 1.
   - **End state:**
     - The bot has verified every signature.
     - Every attempt for sequence 1 reached the bot before the first attempt for sequence 2, sequence 2 was delivered before sequence 3, and the redelivery of sequence 1 arrived after sequences 2 and 3.
     - The payloads name no uploader, key ID, metadata, tag, region or workspace slug.
10. **Bulk cleanup with undo.**
    - **Start:** Theo is browsing `season-1/replays/` in `lanternfish-replays`.
    - **Actions:**
      1. Theo selects three replays and deletes them in one batch.
      2. A few seconds later, CI re-uploads one of those keys.
      3. Theo presses Undo delete before the window closes.
      4. A second undo, and an undo after the window has closed, are both refused.
    - **End state:**
      - Two keys return with their original version IDs and ETags, and their replicas re-settle in the Replica Wake.
      - The re-uploaded key is reported as having kept its newer version.
      - Object count and stored bytes return to their exact earlier figures, plus the re-upload.
11. **A Sandbox studio at its storage limit.**
    - **Start:** Ada, the owner of the seeded Tidepool Tools workspace on the Sandbox plan, has a read-write key.
    - **Actions:**
      1. A CI multipart upload sends a single 600,000-byte part, which reserves that space.
      2. Meanwhile, Ada's console upload of a 500,000-byte file is refused for quota.
      3. Ada aborts the multipart upload, and the same console upload then succeeds.
      4. Elsewhere, five concurrent uploads race for Tidepool's last bytes.
    - **End state:**
      - Exactly the uploads that fit succeed.
      - Usage shows stored and reserved bytes that never exceeded the plan.
12. **Jun signs in with two steps, then confirms before touching keys.**
    - **Start:** Jun, the owner of Paper Kite, is enrolled in two-step sign-in and is signed out. Jun opens a support colleague's deep link to `paperkite-replays` with `season-1/manifest.json` open in the inspector.
    - **Actions:**
      1. Jun is sent to sign-in and enters the right password. The page asks for the authenticator code. While Jun is at that step, the console, the workspace API and the operator API all refuse Jun's half-signed-in session.
      2. Jun enters the current code and lands on the deep link, now holding a new session token. The same code is refused if it is used again.
      3. On Access keys, Jun creates a key limited to the `builds/` prefix. The server asks Jun to confirm. Jun waits for the next code, enters it in the Confirm dialog, and the key is created without pressing Create again.
      4. Jun rotates the key, copies the new secret and watches the row show until when the previous secret still works. A second rotation during the overlap is refused.
      5. Later, the confirmation lapses on the server and the next sensitive action asks again. The device clock, which may be wrong, plays no part in this.
    - **End state:**
      - CI signed with the previous secret keeps working until the overlap's exact second and then fails.
      - The key row changes when the server says the overlap is over.
      - Every owner received a key-rotated email with no secret in it.
13. **Sol locks down their own account.**
    - **Start:** Sol, a developer at Paper Kite, is signed in on a laptop with no two-step sign-in.
    - **Actions:**
      1. On Account, Sol turns on two-step sign-in, enters the first code and saves the recovery codes. The two-step status announces the result once.
      2. On a second browser, Sol signs in with a recovery code.
      3. On the laptop, the Sessions table lists both sessions. Sol signs one out, and that is announced. Sol then presses Sign out other sessions.
      4. Sol changes the password from the laptop.
    - **End state:**
      - Every other session of Sol's, including a half-signed-in one, is refused on its very next request. The laptop stays signed in.
      - The Password status reads the published copy.
      - Sol received two-step and password-changed emails that hold no code and no password.
14. **Mara rotates the workspace key and audits the trail.**
    - **Start:** Mara, the owner of Lanternfish, is signed in. Priya earlier tried, and failed, to upload a file whose name looks like a spreadsheet formula.
    - **Actions:**
      1. A link recipient downloads the disputed replay, and Theo downloads it from the console. Both copies match the upload byte for byte.
      2. On Security, Mara rotates the workspace key, and the generation goes up by one.
      3. Both downloads are repeated and are still byte-identical, with the same ETag and checksum. No stored object in MinIO was rewritten, and MinIO holds no plaintext.
      4. Mara filters the audit trail to permission refusals by Priya, pages back, copies the address and opens it in a fresh session, then presses Back.
      5. Mara verifies the chain and downloads the audit CSV.
    - **End state:**
      - The trail shows only Lanternfish entries, in a gapless sequence. Verify reports the chain intact.
      - In the CSV, Priya's formula-looking key appears neutralised and quoted.

## Mandatory requirements

This is the complete list of mandatory requirements; every check traces to one of these lines and the detailed sections below.

- **DP-01 — Run manifest and health** The app ships a valid run manifest, serves on the stated port and answers the health path with the stated JSON, even when a dependency is down.
- **DP-02 — Real services from the environment** Every service URL and credential is read from the named environment variables at start, object bytes really live in MinIO, usage really reaches Kill Bill, mail really reaches Mailpit, and no endpoint fakes provider state.
- **DP-03 — Server boundary** The server serves only its own pages, assets and the documented endpoints from one origin, enforces the request size limits, and never exposes source files, credentials or secrets.
- **DP-04 — One error shape and order** Every JSON error uses the single error shape, every S3 error uses the S3 XML error shape, and when several errors apply the one returned follows the single precedence rule in API.
- **DP-05 — Console sign-in, throttling and roles** Seeded users sign in with email and password, failed passwords and wrong codes are throttled per email with identical responses for known and unknown accounts, and each role can do exactly what the role table in Business rules allows, both in the console and on the server.
- **DP-06 — Responsive layout** The marketing page, console and operator console fit 375x812, 768x1024 and 1280x800 viewports without horizontal overflow, using the layouts in Screens and layout.
- **DP-07 — Keyboard and focus** Every console action is reachable by keyboard in the stated Tab order, with a visible focus outline, Escape closing drawers and dialogs, and focus returning to the control that opened them.
- **DP-08 — Nocturnal visual system** The console and operator console use the near-black, warm-ink, single-amber look with tabular mono numerals, compact ruled tables and comfortable tap targets described in Visual design.
- **DP-09 — Marketing page** The public page shows a left-hung display headline over a full-width dot-grid world strip with the four region pins and a ruled pricing table set in mono numerals.
- **DP-10 — Create a bucket with a placement** A developer creates a bucket from the console by naming it and choosing an origin region plus up to three replica regions, lands on the new bucket's console address with focus on its heading, and sees it in the rail with its placement.
- **DP-11 — Bucket name rules** Bucket names that break the published naming rules are rejected with 422 and the bucket is not created.
- **DP-12 — One workspace per bucket name** When workspaces create the same bucket name at the same moment, exactly one gets 201 and every other gets 409.
- **DP-13 — Upload from the console** A developer drops or picks files on the object table, sets an optional key prefix and tags, and sees each file stored as a new version with its replicas pending.
- **DP-14 — Upload size and content checks** Uploads whose declared size differs from the bytes received, that exceed the single-upload limit, that carry an unsafe key or that are scripted SVG are refused with nothing stored, as qualified in Business rules.
- **DP-15 — Downloads never render inline** Every object download from the console origin, including share links and S3 GetObject, is delivered as an attachment with the safely encoded two-part filename and never rendered as a page.
- **DP-16 — Upload retries make one version** Replaying a console upload with the same idempotency key returns the original response without a second version, usage increment or webhook event, and reusing the key with a different body answers 409.
- **DP-17 — Metadata and tag limits** User metadata over the published byte limit and tag sets over the published count or length limits are rejected on both the console and the S3 API.
- **DP-18 — Conditional overwrite and bucket counters** An overwrite conditioned on the current ETag succeeds for exactly one of several concurrent writers while the others get 412, a condition on a key with no current version answers 404, and bucket object_count and stored_bytes (every stored version times placed regions) change exactly once per winning write, delete, restore, permanent delete or expiry.
- **DP-19 — Signed S3 API** The S3 API accepts SigV4-signed requests from Farshore access keys, honours each key's permission and bucket scope, and refuses disabled, deleted or wrongly signed keys on the very next request.
- **DP-20 — Multipart uploads** Multipart uploads enforce the published part and total limits, check completion conditions against the current version without discarding the upload, and answer a retried CompleteMultipartUpload with its original result, one version and one usage increment before any condition is checked.
- **DP-21 — Browse as a read-only teammate** A viewer browses buckets, folders and objects, opens the inspector and downloads without upload, overwrite or delete controls, and a copied console URL reopens the same bucket, filters, page and object in a fresh session.
- **DP-22 — Stable capped paging** Console listing and ListObjectsV2 cap each page at 1,000 entries with common prefixes counted, page in key order with opaque cursors that never repeat or skip a key or common prefix while uploads land, and URL-encode listed names on request as qualified in Business rules.
- **DP-23 — Bounded object filters** Prefix, delimiter and tag-filter inputs have published length and complexity limits, and every accepted filter answers within the published time budget using bounded scan work.
- **DP-24 — Workspace-scoped search** Global object search returns only objects in the caller's own workspace, even when another workspace has similarly named buckets and keys.
- **DP-25 — Replication settles on matching ETag** A replication worker copies each new version to every non-origin region in the placement and marks a replica settled only when the region's decrypted copy reproduces the index ETag and size while the version is still current.
- **DP-26 — Replica state machine** Replica state moves only along the legal edges in Business rules, region_offline failures return to pending on their own when their region comes back online, superseded replicas return to pending only when an undo restores their version, manual retry is allowed only from failed, and every illegal retry answers 409.
- **DP-27 — Replica Wake sequence** While the inspector is open, each settle reported by the server plays a wake line, a pin fill and a counting numeral, in settle-timestamp order and one element at a time.
- **DP-28 — Replica Wake without motion** With reduced motion requested, the Replica Wake shows final lines, fills and numerals in one frame while the status list and announcements stay unchanged.
- **DP-29 — Replica status list and announcements** The visually hidden replica status list and the pins always reflect the same replica-state record, and each settle, failure, retry and reset is announced through the polite live region.
- **DP-30 — Replica Wake look** The replica map reads as a flat dot-grid world strip with amber origin and settled pins, dashed hollow pending rings and an X glyph for failed regions, so state never depends on colour alone.
- **DP-31 — Release readiness check** A developer overwrites an object and watches the inspector move from waiting to ready once every placed region holds the new version, with failed regions offering Retry.
- **DP-32 — Mint and use a share link** A viewer or developer mints a time-limited link to one object version and a recipient without an account downloads it.
- **DP-33 — Share link scope, expiry and privacy** A share link serves exactly one object version until its server-enforced expiry second, cannot be widened to another key or version, refuses expiries outside the published range, and sends only the file and the allowed headers.
- **DP-34 — Share link revocation and rate limit** A link revoked by request, by deleting its object, by removing its creator or by removing its version fails on the very next request, and requests beyond the per-link rate answer 429 with Retry-After.
- **DP-35 — Invite a teammate** An owner invites a teammate by email with a role, the invite email reaches Mailpit, and the invitee joins through the accept page.
- **DP-36 — Invite expiry and rate limit** Invites expire after the configured lifetime, a reissued invite kills the old link, and invite creation beyond the per-workspace rate answers 429 with Retry-After.
- **DP-37 — Access key lifecycle** An owner creates scoped keys whose secret is shown once and never stored readable or emailed, disables and then deletes them along the legal edges, and every owner receives a key-created notice.
- **DP-38 — Month-to-date usage** An owner sees month-to-date stored bytes (the sum of their buckets' stored bytes), reserved bytes, egress and request units against the plan with an honest billing-sync line, updated on the stated schedule.
- **DP-39 — Usage posted to billing exactly once** Each sealed usage row, with storage-gb-hours computed as an exact byte-second integral, is posted to the workspace's Kill Bill subscription once, keyed by its tracking ID, however many times the sync runs or retries.
- **DP-40 — Billing outage queue** When Kill Bill is unreachable the app keeps working, queues usage rows durably, shows "billing sync delayed" and drains the queue exactly once when Kill Bill returns, without a restart.
- **DP-41 — Usage threshold alerts** Owners receive one email the first time storage or egress reaches 80% and one at 100% of the plan's included amount in each UTC billing month.
- **DP-42 — Workspace usage export** An owner downloads a CSV of the month's usage rows containing only their own workspace's buckets, in the published column order.
- **DP-43 — Operator console** The operator signs in to a separate console showing the replication backlog for each region, every workspace with its status, and the billing queue, with actions for each including a lifecycle run, and the Regions and Billing figures update in place every two seconds without disturbing an open dialog.
- **DP-44 — Region maintenance and backlog** The operator takes a region offline or online exactly once per transition, copies to an offline region fail and requeue once when it returns, and the backlog figures for each region match replica state.
- **DP-45 — Workspace suspension** Suspending a workspace blocks the console writes listed in Business rules, its downloads, every S3 request including open multipart uploads, and its share links on the next request, pauses its lifecycle sweeps and webhook deliveries, and emails its owners once, and reinstating it restores them.
- **DP-46 — Checksummed and chunked S3 uploads** PutObject and UploadPart accept aws-chunked bodies and flexible checksums as current AWS SDKs send them, store the decoded bytes with their checksum, and store nothing when a checksum, decoded length or chunk signature does not match.
- **DP-47 — Change role and remove member** An owner changes a teammate's role or removes them with effect on that member's very next request, a removed member's share links are revoked at once, and the workspace always keeps at least one owner.
- **DP-48 — Operator gate** Every /api/ops path refuses anonymous callers and non-operators with the same response before any resource lookup, and the operator gets 404 on every workspace API.
- **DP-49 — Lifecycle rules per bucket** Any member reads and developers and owners save a bucket's three lifecycle settings through the API and the Lifecycle rules dialog, and out-of-range values are refused with 422.
- **DP-50 — Noncurrent version expiry** A noncurrent version beyond the newest kept count expires noncurrent_days lifecycle days after it became noncurrent unless it is locked, and expiry removes it from every list, region, replica record, backlog figure and share link, as qualified in Business rules.
- **DP-51 — Incomplete multipart abort** An open multipart upload is aborted abort_multipart_days lifecycle days after it was initiated, losing its staged parts and quota reservation, and later calls on it answer 404 NoSuchUpload.
- **DP-52 — Retention and legal hold** Developers and owners set extend-only retention and owners set legal hold on a version, a version is locked while it is on legal hold or before its retain-until second, and the Retention dialog keeps its typed value, focus and caret while the inspector polls beneath it.
- **DP-53 — One lock rule on every permanent delete** A locked version is refused permanent deletion by the console, S3 DeleteObject, DeleteObjects and lifecycle, while overwrite, plain delete, bulk delete and undo stay allowed.
- **DP-54 — Webhook endpoints** An owner adds up to five webhook endpoints with a signing secret shown once, disables, enables and deletes them along the legal edges, and lists them without secrets.
- **DP-55 — Signed, ordered webhook delivery** Every object change emits one event per matching active endpoint, delivered one at a time in ascending sequence per endpoint, signed over the raw body, carrying only the published fields and never delayed by another endpoint.
- **DP-56 — Webhook retry, dead letter and redeliver** A failing delivery retries on the published backoff, becomes dead after six failed attempts with one email to each owner, and can be redelivered in order.
- **DP-57 — S3 multi-object delete** DeleteObjects processes up to 1,000 entries independently, reports each entry's outcome in normal and quiet mode, and changes counters, usage and events only for entries that changed state.
- **DP-58 — Console bulk delete with undo** A developer deletes selected objects in one batch and undoes it before the undo window closes, getting back exactly the deleted versions with their IDs and ETags while re-uploaded or removed keys are reported as newer_version or gone.
- **DP-59 — Sandbox storage quota** On a plan without storage overage, stored plus reserved bytes never exceed the plan's included storage under concurrent uploads, refused uploads answer 409 quota_exceeded or 403 QuotaExceeded, and reservations are released on completion, abort and lifecycle abort.
- **DP-60 — Published fields only** Every JSON request body under /api accepts only its published fields, and any other field answers 422 naming it with nothing changed.
- **DP-61 — Two-step enrolment and codes** Any signed-in user turns authenticator two-step sign-in on with ten single-use recovery codes and off with a code, and each authenticator time step is accepted at most once per user across sign-in, confirmation and turning two-step off.
- **DP-62 — Half-signed-in sessions** After a correct password an enrolled user holds a pending session that every workspace, account and operator API refuses with 401 two_step_required and every console, account and operator page redirects to /signin showing the code step, until a code is accepted, which issues a new session token and lands on the address first asked for.
- **DP-63 — Step-up confirmation** Enrolled members confirm with a fresh code before creating or rotating an access key, turning a legal hold off or rotating the workspace key, and the confirmation belongs to one session, lapses at its exact second and is checked after the role check and before suspension.
- **DP-64 — Sessions page and lifetimes** Every signed-in user sees their sessions, signs one or all others out with effect on the very next request, and every session ends at its published idle or absolute lifetime and when the same browser signs in again.
- **DP-65 — Password change ends other sessions** Changing the password ends every other session of the user, pending ones included, in the same change while the current session stays signed in, and the user is emailed without any password.
- **DP-66 — Prefix-scoped and expiring access keys** An access key with a prefix acts only on keys under that prefix on every S3 object, list, multipart and multi-object path, and a key stops working at its expires_at second.
- **DP-67 — Access key rotation with overlap** An owner rotates an active key to get a new secret while the previous secret, including its chunk signatures, keeps working until the overlap's exact second, with exactly one winner among concurrent rotations and the key row updated from the server's answer.
- **DP-68 — Encryption at rest per version** MinIO only ever holds ciphertext of object bytes under each version's own data key on every upload, multipart, replica and seed path, while every download returns the original bytes with the same ETag and checksum.
- **DP-69 — Workspace key rotation** An owner rotates the workspace key so every stored version and open upload of that workspace is re-wrapped under the new generation without rewriting any MinIO object, one rotation at a time.
- **DP-70 — Hash-chained audit trail** Each workspace's audit trail is append-only with a gapless sequence and a SHA-256 chain over the published canonical form, and verify names the first edited, rewritten or missing entry.
- **DP-71 — Audit trail page and CSV export** An owner filters and pages their own workspace's audit trail with the filters held in the address, verifies the chain, and downloads a CSV with RFC 4180 quoting and formula neutralisation.
- **DP-72 — What the audit trail records** Every sign-in, failed sign-in, password and two-step change, membership change, invite, key change, legal-hold change, encryption rotation, suspension and permission refusal appends one entry with the published actor, target and detail, and no entry ever holds a password, code, secret or token.

## Frontend

### Screens and layout (DP-06, DP-09, DP-10, DP-13, DP-21, DP-43, DP-48, DP-49, DP-54, DP-58, DP-61, DP-62, DP-64, DP-65, DP-69, DP-71)

**Marketing page (`/`).**
- **Top bar:** the Farshore wordmark, `link "Pricing"` (jumps to the pricing section) and `link "Sign in"`.
- **Hero:** an `h1` that reads exactly "Every region you pick holds the bytes you shipped." It hangs from the left edge of a 12-column grid and spans about seven columns. A two-sentence lead sits under it, then `link "Open the console"`, which goes to `/signin`.
- **World strip:** full width, below the hero. It is a flat dot-grid world map drawn as SVG or canvas from a coarse land mask. It shows the four region pins, each labelled with its region name and continent label from Seed data.
- **Features:** four short rows:
  - one endpoint;
  - per-object replica state;
  - versions that expire on your rules while held ones stay;
  - the bill before the invoice.
- **Pricing:** a ruled table, `table "Pricing"`, with one row per plan from Seed data. Its columns are plan, monthly price, included storage, included egress, storage overage, egress overage and request units.
- **Footer.**
- **Widths:**
  - At 1280x800 the headline spans seven of twelve columns.
  - At 768x1024 it spans the full grid width.
  - At 375x812 the page is a single column, and the pricing table becomes stacked cards, one per plan, each listing the same columns as label–value pairs.

**Sign-in (`/signin`).**
- **Panel:** a single centred surface panel.
- **Password step:** `textbox "Email"`, `textbox "Password"` and `button "Sign in"`.
- **Code step:** when the browser holds a pending two-step session, the same panel shows the code step instead:
  - the heading "Enter the code from your authenticator app";
  - the hint "Codes change every 30 seconds.";
  - `textbox "Authenticator code"`, `button "Verify"` and `button "Use a recovery code"`.

  `button "Use a recovery code"` swaps the panel to:
  - the heading "Enter one of your recovery codes";
  - `textbox "Recovery code"`, `button "Verify"` and `button "Use an authenticator code"`.
- **Landing after sign-in:** the user goes to the console, account or operator address they first asked for, if there was one and their role allows it. That address is kept through the code step. Otherwise workspace members go to `/console` and the operator goes to `/ops`.

**Page access and redirects.**
- These visitors to any `/console`, `/ops` or `/account` address are sent to `/signin`, keeping the requested address for after sign-in:
  - an anonymous visitor;
  - a visitor holding a pending two-step session, who sees the code step;
  - a visitor whose session has ended.
- A signed-in non-operator who opens any `/ops` address is sent to `/console`.
- The operator who opens any `/console` address is sent to `/ops`.
- `/account` is open to every fully signed-in user, the operator included.

**Console addresses.**
- **Object view.** A bucket's object view lives at `/console/<ws>/<bucket>`, where `<ws>` is the workspace slug.
- **Defaults.**
  - `/console` opens the first bucket by name in the user's first workspace by name.
  - `/console/<ws>` opens that workspace's first bucket by name.
- **Other pages.** These pages have their own addresses under `/console/<ws>/`:
  - Share links, Team, Access keys, Usage, Webhooks and Security;
  - each endpoint's Deliveries page.

  You choose those paths, but none of them may be a valid bucket name.
- **Object view query parameters.** The object view keeps its whole state in the query:
  - `prefix`: the current prefix; absent when empty.
  - `tag_filter`: the applied tag filter; absent when empty.
  - `cursor`: the cursor of the current page; absent on the first page.
  - `prev`: repeated once per earlier page, oldest first, each holding that page's cursor. The first page's entry is an empty `prev=`. For example, on the third page the address carries `cursor=<c2>&prev=&prev=<c1>`.
  - `object`: the key open in the inspector; absent when the inspector is closed.
- **Security page query parameters.** The audit trail on the Security page keeps its state the same way, in `action`, `actor`, `cursor` and `prev`. Each is absent when empty or on the first page.
- **Fresh session.** When a member loads such an address in a fresh session, the console shows the same rows and opens the same inspector or audit page.
- **Workspace or bucket out of reach.** An address may name a workspace the user does not belong to, or a bucket that does not exist in the named workspace. The view then shows the isolation copy from Feedback states and no rows. It never shows another workspace's bucket names, keys or counts, not even briefly.

**Console.** The console has three zones.

- **Left rail.** A fixed narrow column holding, from top to bottom:
  - the workspace name, as plain text: not a control and not a Tab stop;
  - `navigation "Buckets"`, with one link per bucket. Each link shows the bucket's name and its placement as region names from Seed data, origin first, separated by ", ". For example, with the seed data at start, "Cascade, Meridian, Monsoon". The link for the bucket on screen carries `aria-current="page"`;
  - `button "New bucket"` (developers and owners);
  - `navigation "Workspace"`, with links Objects, Share links, Team, Access keys, Usage, Webhooks and Security. Team, Access keys, Usage, Webhooks and Security appear for owners only;
  - `link "Account"`;
  - `button "Sign out"`.
- **Centre.** The selected bucket's object view, from top to bottom:
  - a `heading` level 2 reading the bucket name;
  - a breadcrumb of the current prefix;
  - a toolbar. Everyone gets `searchbox "Search objects"`, `textbox "Prefix"`, `textbox "Tag filter"` and `button "Apply filters"`. Developers and owners also get `button "Upload files"`, `button "Delete selected"` and `button "Lifecycle rules"`;
  - after a bulk delete: `list "Delete results"`, `button "Undo delete"` and the `status "Delete status"` line, all above the table;
  - the dense ruled table `table "Objects"`:
    - its columns are Key, Size (bytes), Last modified (UTC), Regions (settled/placed) and ETag (the first 8 hex characters);
    - Size and Last modified cells use the display formats from Feedback states;
    - folder rows (common prefixes) are listed with object rows in key order;
    - for developers and owners, each object row starts with a selection checkbox;
  - below the table: `button "Previous page"`, `button "Next page"` and the `status "Results status"` line.

  For developers and owners, the whole table area is also a drop target.
- **Right inspector.** Opening a row shows the drawer `region "Object inspector"`. From top to bottom it holds:
  - the full key, as the inspector's heading;
  - the current version ID and ETag, in mono;
  - size, content type, tags and metadata;
  - the replica map, `figure "Replica map"` (described in Motion and effects), with the visually hidden `list "Replica status"` under it;
  - `status "Release readiness"`;
  - `button "Download"` and `button "Share link"`, plus `button "Upload new version"` and `button "Delete object"` for developers and owners;
  - the version history, `list "Versions"`, newest first, with `status "Version status"` under it.
- **Pages that replace the centre.** The Share links, Team, Access keys, Usage, Webhooks, Deliveries and Security pages replace the centre zone and close the inspector.
- **Widths:**
  - **1280x800.** The rail, table and inspector sit side by side. The inspector takes about a quarter of the width, and the table narrows to make room for it.
  - **768x1024.** The rail is hidden behind `button "Workspaces and buckets"`. That button opens `dialog "Navigation"`, which holds `button "Close navigation"` followed by the same rail. The inspector overlays the right half of the table.
  - **375x812.** The rail works as at 768x1024. The table shows only the selection checkbox, Key, Size and Regions; the other values move into the inspector. The inspector covers the full screen, with `button "Close inspector"` at its top.
  - **Every width.** The inspector has `button "Close inspector"`. Nothing scrolls sideways, except the inside of the objects table at 375x812, which scrolls within its own frame.

**Share links page.** `table "Share links"` lists the current workspace's links: object key, version, creator, expiry and state. Each active row the user may revoke has `button "Revoke link"`.

**Team page (owner).**
- `table "Members"` lists name, email and role. Every row except the signed-in owner's own row also has `combobox "Role for <name>"` (options "Owner", "Developer" and "Viewer") and `button "Remove <name>"`.
- `table "Invites"` lists email, role, expiry and state.
- `button "Invite teammate"` opens `dialog "Invite teammate"`.
- `status "Team status"`.

**Access keys page (owner).**
- `table "Access keys"` has these columns:
  - key ID, description, permission and bucket scope;
  - prefix ("—" when none);
  - expires (UTC) ("never" when none);
  - state: "active", "disabled" or "expired";
  - last used (UTC) ("never" before first use);
  - previous secret: "Previous secret works until <time>", or "—";
  - created time.
- Each active, unexpired row has `button "Rotate key"`. Each active row has `button "Disable key"`. Each disabled row has `button "Delete key"`.
- `button "Create access key"` opens `dialog "Create access key"`.
- The page re-reads the key list every 15 seconds while it stays open.

**Usage page (owner).**
- `meter "Stored"` and `meter "Egress this month"`:
  - each runs from 0 to 100 and takes as its value the metric's percent from Business rules, capped at 100; its bar is filled to that value;
  - beside each bar, in mono, the visible text reads "<bytes> of <included bytes> bytes (<percent>%)";
  - both byte figures use the display format from Feedback states;
  - `<percent>` is the uncapped percent with exactly one decimal place, so it may read above 100.
- The texts "Reserved for open uploads <n> bytes" and "Request units <n>", each `<n>` in the display format from Feedback states.
- The `status "Billing sync"` line.
- `table "Usage rows"`, listing this month's rows newest first, 50 per page.
- `button "Download CSV"`.

**Webhooks page (owner).**
- `table "Webhook endpoints"` lists URL, events, bucket scope, description, state and created time.
- Active rows have `button "Disable endpoint"`. Disabled rows have `button "Enable endpoint"` and `button "Delete endpoint"`.
- Every row has `link "Deliveries for <endpoint URL>"`.
- `button "Add endpoint"` opens `dialog "Add webhook endpoint"`.
- `status "Webhook status"`.

**Deliveries page (owner).**
- `table "Deliveries"` lists sequence, event type, state, attempts, last status, last error, next attempt and delivered time, 50 per page, newest first.
- Dead rows have `button "Redeliver <sequence>"`.
- The page shares `status "Webhook status"`.

**Security page (owner).**
- **`region "Encryption"`:**
  - the line "Workspace key generation <n>, rotated <time>." or "Workspace key generation 1, never rotated.";
  - `button "Rotate workspace key"`;
  - `status "Encryption status"`.
- **`region "Audit trail"`:**
  - `combobox "Action"`, with "All actions" followed by each action name from Business rules;
  - `textbox "Actor"` and `button "Apply audit filters"`;
  - `table "Audit trail"`, with the columns Seq, Time (UTC), Actor, Action, Target and Detail;
  - `button "Newer entries"`, `button "Older entries"`, `button "Verify chain"` and `button "Download audit CSV"`;
  - `status "Audit status"`.

**Account page (`/account`).** The page is a single column of three regions, for every signed-in user, the operator included.
- **`region "Two-step sign-in"`.**
  - When two-step is off, it shows `button "Turn on two-step sign-in"`. During setup it shows `textbox "Setup key"` (read-only, holding the secret), the setup address as text, `textbox "Authenticator code"` and `button "Verify and turn on"`. Right after enabling it shows `list "Recovery codes"` once.
  - When two-step is on, it shows the line "On since <time>. <n> recovery codes left." and `button "Turn off two-step sign-in"`.
  - `status "Two-step status"` sits at the end of the region.
- **`region "Sessions"`.**
  - `table "Sessions"` has the columns Device, Signed in (UTC) and Last seen (UTC). The current row carries the marker "This session".
  - Every other row has `button "Sign out session from <signed-in time>"`.
  - The region also has `button "Sign out other sessions"` and `status "Sessions status"`.
- **`region "Password"`.** `textbox "Current password"`, `textbox "New password"`, `button "Change password"` and `status "Password status"`.

**Accept invite (`/invite/<token>`).** One panel headed "Join <workspace name>". It shows the invited email and role, `textbox "Your name"`, `textbox "Password"` and `button "Join workspace"`. When the email already has a Farshore account, the name field is left out.

**Operator console (`/ops`).** The same rail layout, with links Regions, Workspaces and Billing, followed by `link "Account"` and `button "Sign out"`.
- **Regions.**
  - `table "Region backlog"` lists each region with its state, pending count, failed count and the age of its oldest pending replica, shown as "<n> ms" or "—" when there is none.
  - Each row has `button "Take <region name> offline"` or `button "Bring <region name> online"`.
  - `button "Run lifecycle now"` sits above the table.
- **Workspaces.** `table "Workspaces"` lists name, slug, plan, members, buckets and status. Each row has `button "Suspend <workspace name>"` or `button "Reinstate <workspace name>"`.
- **Billing.** Queued rows, posted rows, last attempt, last error and `button "Sync billing now"`.
- **Live figures.** While Regions or Billing is open, its figures re-read every 2 seconds and update in place, with no reload.
- **Small widths.** At 375x812 and 768x1024 these tables stack into one card per row.

### Public screens and controls (DP-05, DP-07, DP-10, DP-13, DP-21, DP-27, DP-29, DP-31, DP-32, DP-35, DP-37, DP-38, DP-43, DP-47, DP-49, DP-52, DP-53, DP-54, DP-56, DP-58, DP-61, DP-62, DP-63, DP-64, DP-65, DP-66, DP-67, DP-69, DP-71)

Only the roles, names and hooks listed here are public. Everything else is up to you.

| Where | Role and accessible name | Visible copy or content |
|---|---|---|
| Marketing | `heading` level 1 | "Every region you pick holds the bytes you shipped." |
| Marketing | `link "Open the console"`, `link "Sign in"`, `link "Pricing"` | same as name |
| Marketing | `img "Farshore regions"` (world strip) | four labelled pins |
| Marketing | `table "Pricing"` | plan rows from Seed data |
| Sign-in | `textbox "Email"`, `textbox "Password"`, `button "Sign in"` | same as name |
| Sign-in, code step | `heading` "Enter the code from your authenticator app", `textbox "Authenticator code"`, `button "Verify"`, `button "Use a recovery code"` | hint "Codes change every 30 seconds." |
| Sign-in, recovery step | `heading` "Enter one of your recovery codes", `textbox "Recovery code"`, `button "Verify"`, `button "Use an authenticator code"` | — |
| Sign-in | `alert` | sign-in copy from Feedback states |
| Console | `link "Skip to objects"` | "Skip to objects" (first Tab stop, visible on focus) |
| Console | `navigation "Buckets"`, with one `link "<bucket name>"` per bucket; the current bucket's link has `aria-current="page"` | bucket name and placement region names, as in Screens and layout |
| Console (768x1024 and 375x812) | `button "Workspaces and buckets"` → `dialog "Navigation"` with `button "Close navigation"` | same as name |
| Console | `navigation "Workspace"` | links "Objects", "Share links", "Team", "Access keys", "Usage", "Webhooks", "Security" |
| Console and operator | `link "Account"`, `button "Sign out"` | same as name |
| Console | `heading` level 2 in the centre | the bucket name |
| Console | `button "New bucket"` → `dialog "New bucket"` | — |
| New bucket dialog | `textbox "Bucket name"` | hint "Lowercase letters, digits and hyphens." |
| New bucket dialog | `combobox "Origin region"`; `group "Replica regions"` with one `checkbox "<region name>"` per region | region names |
| New bucket dialog | `button "Create bucket"`, `button "Cancel"` | same as name |
| Console | `status "Bucket status"` | Feedback states |
| Console | `searchbox "Search objects"`, `textbox "Prefix"`, `textbox "Tag filter"`, `button "Apply filters"` | Tag filter placeholder "env=qa and not team=art" |
| Console | `table "Objects"`. Each object row contains `checkbox "Select <key>"` (developers and owners) and `button "Open <key>"`. Each folder row contains `button "Open folder <prefix>"` | — |
| Console | `checkbox "Select all on this page"` in the table header (developers and owners) | — |
| Console | `button "Previous page"`, `button "Next page"`, `status "Results status"` | Feedback states |
| Console | `button "Upload files"` → `dialog "Upload"` | — |
| Upload dialog | `list "Files to upload"`, `textbox "Key prefix"`, `textbox "Tags"`, `checkbox "Only overwrite the version I opened"` (Upload new version only), `button "Start upload"`, `button "Cancel"` | Tags hint "key=value, separated by commas" |
| Console | `status "Upload status"`, `progressbar "Upload progress"` | Feedback states |
| Console | `button "Delete selected"` (disabled while nothing is selected) → `dialog "Delete objects"`, listing the selected keys, with `button "Delete objects"` and `button "Cancel"` | — |
| Console | `list "Delete results"` with one `listitem` per key; `button "Undo delete"`; `status "Delete status"` | Feedback states |
| Console | `button "Lifecycle rules"` → `dialog "Lifecycle rules"` with `spinbutton "Expire noncurrent versions after (days)"`, `spinbutton "Keep newest noncurrent versions"`, `spinbutton "Abort incomplete uploads after (days)"`, `button "Save rules"`, `button "Cancel"` | an empty days field reads as off |
| Console | `status "Lifecycle status"` | Feedback states |
| Inspector | `region "Object inspector"`, `button "Close inspector"` | — |
| Inspector | `figure "Replica map"`. It contains one pin per placed region, with `data-region="<region id>"` and `data-state` (`origin`, `pending`, `settled` or `failed`); one wake line per non-origin region, with `data-wake="<region id>"` and `data-progress` (0.00 to 1.00); and one numeral per region, with `data-numeral="<region id>"` | pin label "<region name>", numeral "<n> ms", words "origin", "pending", "failed" |
| Inspector | `list "Replica status"` (visually hidden), with one `listitem` per placed region | "<region name>: origin, settled", "<region name>: settled in <settle ms> ms", "<region name>: pending", "<region name>: failed" |
| Inspector | `status "Replica announcements"` (polite) | Feedback states |
| Inspector | `button "Retry <region name>"` (failed regions only) | "Retry" |
| Inspector | `status "Release readiness"` | Feedback states |
| Inspector | `button "Download"`, `button "Share link"`, `button "Upload new version"`, `button "Delete object"` | same as name |
| Inspector | `list "Versions"`, with one `listitem` per stored version | "<short version> · <size> bytes · <created time>", then "current" or "noncurrent since <time>", then "held until <time>" while retention is in force, then "legal hold" while held |
| Versions list | `button "Delete version <short version>"` on unlocked noncurrent versions; `button "Retention for <short version>"` (developers and owners); `checkbox "Legal hold on <short version>"` (owners) | — |
| Retention | `dialog "Retention"` with `textbox "Retain until (UTC)"` (format `YYYY-MM-DD HH:MM:SS`), `button "Save retention"`, `button "Cancel"` | — |
| Inspector | `status "Version status"` | Feedback states |
| Share | `dialog "Share link"`, `combobox "Expires in"` (options "1 hour", "24 hours", "7 days", "Custom"), `spinbutton "Seconds"` (Custom only), `button "Create link"`, `textbox "Link URL"` (read-only), `button "Copy link"` | — |
| Share | `status "Share status"` | Feedback states |
| Share links page | `table "Share links"`; `button "Revoke link"` on each active row the user may revoke | — |
| Team page | `table "Members"`, with `combobox "Role for <name>"` (options "Owner", "Developer", "Viewer") and `button "Remove <name>"` on every row except your own | — |
| Team page | `table "Invites"`; `button "Invite teammate"` → `dialog "Invite teammate"` with `textbox "Email"`, `combobox "Role"` (options "Developer", "Viewer") and `button "Send invite"` | — |
| Team page | `status "Invite status"`, `status "Team status"` | Feedback states |
| Accept invite | `heading` "Join <workspace name>", `textbox "Your name"`, `textbox "Password"`, `button "Join workspace"`, `alert` | — |
| Access keys page | `table "Access keys"`; `button "Create access key"` → `dialog "Create access key"`. The dialog holds `textbox "Description"`; `radiogroup "Permission"` with `radio "Read only"` and `radio "Read and write"`; `group "Buckets"` with `checkbox "All buckets"` and one `checkbox "<bucket name>"` per bucket; `textbox "Object prefix"` (empty means none); `textbox "Expires at (UTC)"` (format `YYYY-MM-DD HH:MM:SS`, empty means never); and `button "Create key"` | — |
| Access keys page | after creation, in the same dialog: `textbox "Secret access key"` (read-only) and `button "Copy secret"` | — |
| Access keys page | `button "Rotate key"` → `dialog "Rotate access key"`, with the text "Rotate <key id>? The previous secret keeps working until the overlap ends." and `button "Rotate"`; after success, in the same dialog, `textbox "New secret access key"` (read-only) and `button "Copy secret"` | — |
| Access keys page | `button "Disable key"` and `button "Delete key"` per row; `status "Key status"` | Feedback states |
| Step-up | `dialog "Confirm it's you"` with `textbox "Authenticator code"`, `button "Confirm"`, `button "Cancel"` and an `alert` | text "Enter the current code from your authenticator app to continue." |
| Usage page | `meter "Stored"`; `meter "Egress this month"`; the texts "Reserved for open uploads" and "Request units" with their values; `status "Billing sync"`; `table "Usage rows"`; `button "Download CSV"` | Feedback states |
| Webhooks page | `table "Webhook endpoints"`; `button "Add endpoint"` → `dialog "Add webhook endpoint"`. The dialog holds `textbox "Endpoint URL"`; `group "Events"` with `checkbox "object.created"`, `checkbox "object.deleted"`, `checkbox "object.restored"` and `checkbox "version.removed"`; `group "Buckets"` with `checkbox "All buckets"` and one `checkbox "<bucket name>"` per bucket; `textbox "Description"`; and `button "Create endpoint"` | — |
| Webhooks page | after creation, in the same dialog: `textbox "Signing secret"` (read-only) and `button "Copy secret"` | — |
| Webhooks page | per row: `button "Disable endpoint"`, `button "Enable endpoint"`, `button "Delete endpoint"`, `link "Deliveries for <endpoint URL>"`; `status "Webhook status"` | Feedback states |
| Deliveries page | `table "Deliveries"`; `button "Redeliver <sequence>"` on dead rows | — |
| Security page | `region "Encryption"`; `button "Rotate workspace key"` → `dialog "Rotate workspace key"`, with the text "Rotate the workspace key? Object bytes stay where they are; only their data keys are re-wrapped.", `button "Rotate"` and `button "Cancel"`; `status "Encryption status"` | Feedback states |
| Security page | `region "Audit trail"`, `combobox "Action"`, `textbox "Actor"`, `button "Apply audit filters"`, `table "Audit trail"`, `button "Newer entries"`, `button "Older entries"`, `button "Verify chain"`, `button "Download audit CSV"`, `status "Audit status"` | Feedback states |
| Account | `region "Two-step sign-in"`, `button "Turn on two-step sign-in"`, `textbox "Setup key"` (read-only), `textbox "Authenticator code"`, `button "Verify and turn on"`, `list "Recovery codes"`, `button "Turn off two-step sign-in"` → `dialog "Turn off two-step sign-in"` with `textbox "Authenticator code"` and `button "Turn off"`; `status "Two-step status"` | Feedback states |
| Account | `region "Sessions"`, `table "Sessions"`, `button "Sign out session from <signed-in time>"`, `button "Sign out other sessions"`, `status "Sessions status"` | the current row reads "This session" |
| Account | `region "Password"`, `textbox "Current password"`, `textbox "New password"`, `button "Change password"`, `status "Password status"` | Feedback states |
| Console | `alert` banner while the workspace is suspended | Feedback states |
| Operator | `table "Region backlog"`, `button "Take <region name> offline"`, `button "Bring <region name> online"`, `button "Run lifecycle now"` | — |
| Operator | `table "Workspaces"`; `button "Suspend <workspace name>"` → `dialog "Suspend workspace"` with `textbox "Reason"` and `button "Suspend"`; `button "Reinstate <workspace name>"` | — |
| Operator | `button "Sync billing now"`, `status "Operator status"` | Feedback states |

A role never sees controls it may not use. In particular:
- Viewers get no upload, overwrite, delete, selection, lifecycle, retention or Retry controls.
- Developers get no legal-hold checkbox.
- Non-owners get no Team, Access keys, Usage, Webhooks or Security links.

### Interactions (DP-07, DP-10, DP-13, DP-21, DP-27, DP-31, DP-32, DP-43, DP-47, DP-49, DP-52, DP-54, DP-58, DP-61, DP-62, DP-63, DP-64, DP-65, DP-67, DP-69, DP-71)

**Server time decides.** The device clock may be wrong. Whether something is open, due, expired, lapsed or still working comes only from the server's answers. The console renders that status and never works it out from the browser clock. This covers an undo window, a step-up confirmation, a key's previous secret, a key's expiry, a share link's expiry and a pending sign-in.

**Re-reads keep what you are doing.** These views re-read on a schedule:

| View | Re-read |
|---|---|
| Usage page | every 15 seconds |
| Access keys list | every 15 seconds |
| Operator Regions and Billing | every 2 seconds |
| Inspector replicas and Versions list | at least once per second while any replica of the open version is pending or failed |

No re-read ever closes an open dialog, clears or moves typed input, or moves focus or the caret. The rows beneath update in place.

Status regions come in two kinds:
- **Action-result regions** show the outcome of something the user just did: Bucket, Upload, Delete, Lifecycle, Version, Share, Invite, Team, Key, Webhook, Encryption, Audit, Two-step, Sessions, Password and Operator status. No re-read ever replaces their last message; only the user's next action of that kind does.
- **Re-read-driven regions** show current server state and are rewritten by every re-read or load that changes it: `status "Release readiness"`, `status "Billing sync"`, `status "Results status"`, `status "Replica announcements"` and the `list "Replica status"` items. For example, Release readiness moves from waiting to ready through the inspector's re-reads, and Billing sync returns to in sync through the Usage page's re-reads.

**Opening objects.**
- Clicking or tapping a row's `button "Open <key>"`, or pressing Enter on it, does three things:
  - opens the inspector on that object's current version;
  - adds `object` to the address;
  - moves focus to the inspector's key heading.
- Escape or `button "Close inspector"` closes the inspector, removes `object` from the address and returns focus to the same row button.
- Opening and closing the inspector replace the current history entry instead of adding one.
- Opening a folder row replaces the prefix and loads the first page.

**Creating a bucket.**
- After `button "Create bucket"` succeeds, the dialog closes and the console pushes a history entry for `/console/<ws>/<new bucket>`, with no `prefix`, `cursor`, `prev` or `object`.
- On that page:
  - the table shows the empty copy;
  - the new bucket's rail link carries `aria-current="page"`;
  - focus is on the centre heading that reads the bucket name.
- Browser Back returns to the bucket that was on screen before, with its rows.
- Reloading the new address shows the same screen.

**Tab order at 1280x800.**
1. The skip link.
2. The rail: Buckets links, New bucket, Workspace links, Account, Sign out.
3. The toolbar: search, prefix, tag filter, Apply filters, Upload files, Delete selected, Lifecycle rules.
4. `checkbox "Select all on this page"`.
5. The table rows from top to bottom. Within a row, the selection checkbox comes before the Open button.
6. The paging buttons.
7. The inspector, when it is open.

The workspace name is never a Tab stop.

**Tab order at 768x1024 and 375x812.**
1. The skip link.
2. `button "Workspaces and buckets"`.
3. The toolbar.
4. The select-all checkbox.
5. The table rows.
6. The paging buttons.
7. The inspector, when it is open.

Inside `dialog "Navigation"` the order is `button "Close navigation"`, the Buckets links, New bucket, the Workspace links, Account, then Sign out. Choosing a link closes the dialog. At 375x812 the open inspector covers the screen and holds focus like a dialog until it is closed.

**Dialogs.** While a dialog is open, focus stays inside it. Escape closes the dialog and puts focus back on the button or link that opened it. Focus goes back to that same control even if it was re-rendered by a re-read while the dialog was open.

**Uploading.**
- Developers and owners can drag files onto the table area. While a drag hovers over it, the area shows a dashed amber outline and the line "Drop to upload to <bucket name>/<prefix>".
- Dropping files, or picking them through `button "Upload files"`, opens `dialog "Upload"`, which lists each file with its byte size.
- `button "Start upload"` sends the files one at a time. Each file gets its own idempotency key, and an automatic retry after a dropped connection reuses that key.
- `progressbar "Upload progress"` reports the bytes sent for the current file.
- Closing the dialog during an upload asks "Stop uploading? Files already stored stay stored." with the buttons "Stop" and "Keep uploading".
- `button "Upload new version"` opens the same dialog for exactly one file, with the key fixed to the open object's key. Checking "Only overwrite the version I opened" sends the open version's ETag as the overwrite condition.

**Filtering and paging.**
- The search box searches the whole workspace. Pressing Enter shows the results in the table, with a Bucket column added.
- Prefix and Tag filter apply to the current bucket when you press `button "Apply filters"`, or press Enter in either field. Applying them pushes a history entry and starts again from the first page.
- `button "Next page"` loads the page after the last row shown. `button "Previous page"` returns to the page before, using the `prev` stack in the address. Both push a history entry.
- Browser Back and Forward restore each earlier page's rows, filters and paging buttons from the address.
- Each paging button is disabled at its end of the list.

**Selecting and bulk delete.**
- Checking `checkbox "Select <key>"` adds that object to the selection.
- `checkbox "Select all on this page"` selects or clears every object row on the page. Folder rows are never selected.
- The selection clears whenever the page, prefix or filter changes.
- `button "Delete selected"` opens `dialog "Delete objects"`, which lists the selected keys. `button "Delete objects"` sends one bulk delete with an idempotency key, and an automatic retry reuses it.
- When the result arrives:
  - `list "Delete results"` shows each key's outcome;
  - the deleted rows leave the table;
  - `button "Undo delete"` appears.
- Undo delete stays until an undo has answered, or until the server answers that the window has closed, in which case the window-closed copy shows. The browser clock never hides it.
- Pressing Undo delete sends the undo. Its per-key outcomes replace the items in `list "Delete results"`.
- If the inspector is open on a key that this tab deletes, it closes.

**Lifecycle rules.** `button "Lifecycle rules"` opens the dialog with the saved values. An empty days field means off. `button "Save rules"` saves, and field errors appear under each field.

**Versions.**
- `button "Delete version <short version>"` asks "Delete version <short version> for good? This can't be undone." with the buttons "Delete version" and "Keep it".
- `button "Retention for <short version>"` opens `dialog "Retention"`. The Versions list beneath keeps updating with the inspector's polling. The dialog stays open with its typed value, focus and caret, and Escape returns focus to the same Retention button.
- Toggling `checkbox "Legal hold on <short version>"` sends the change at once. If the server refuses, the checkbox returns to its previous state.

**Sharing.** `button "Share link"` opens `dialog "Share link"`. Pick an expiry and press `button "Create link"`. The URL appears once in `textbox "Link URL"`, and `button "Copy link"` copies it.

**Retrying a replica.** `button "Retry <region name>"` asks the server to retry that region. The pin returns to pending only once the server confirms.

**Team changes.**
- Choosing a new option in `combobox "Role for <name>"` sends the change at once.
- `button "Remove <name>"` removes the member at once.
- If the server refuses a role change, the combobox returns to the member's current role.

**Access keys.**
- `button "Create key"` creates the key, and the dialog then shows the read-only secret once.
- `button "Rotate key"` opens `dialog "Rotate access key"`. `button "Rotate"` sends the rotation, and the dialog then shows the new secret once.
- Closing either dialog clears the secret from the page for good.
- A row shows "Previous secret works until <time>" for as long as the server's key list reports a `previous_secret_expires_at`. It changes on the first re-read after the server stops reporting it.

**Step-up confirmation.**
- Any action the server refuses with `step_up_required` opens `dialog "Confirm it's you"`, with focus in `textbox "Authenticator code"`.
- `button "Confirm"` sends the code.
  - On success the dialog closes and the original action is sent once more, automatically, with the same body.
  - A wrong code keeps the dialog open and shows the alert.
- `button "Cancel"` or Escape closes the dialog. The action's own status region then shows the cancel copy, and nothing is sent.
- The console never tracks or counts down `confirmed_until`. It asks again only when the server answers `step_up_required`.

**Webhooks.**
- `button "Create endpoint"` creates the endpoint. The dialog then shows the read-only secret once with `button "Copy secret"`. Closing the dialog clears the secret from the page for good.
- Each `button "Redeliver <sequence>"` sends a redeliver. The row's state changes once the server confirms.

**Security.**
- `button "Rotate workspace key"` asks for confirmation in its dialog.
- Changing the Action or Actor filter and pressing `button "Apply audit filters"` pushes a history entry and starts from the newest page.
- `button "Older entries"` and `button "Newer entries"` push history entries using `cursor` and `prev`, in the same way as object paging.
- Back and Forward restore filters, page and rows.
- `button "Verify chain"` shows its result in `status "Audit status"`.
- `button "Download audit CSV"` downloads the export for the current filters.

**Account.**
- `button "Turn on two-step sign-in"` starts setup and shows the setup key.
- Entering the app's code and pressing `button "Verify and turn on"` enables two-step and shows `list "Recovery codes"` once. Leaving the page clears the codes from it for good.
- `button "Sign out session from <signed-in time>"` and `button "Sign out other sessions"` act at once. The table re-reads after each answer.
- `button "Change password"` sends both passwords. On success both fields clear.

**Sign-in code step.**
- `button "Verify"` sends the code.
- A wrong code keeps the step and shows the alert. An expired pending session returns to the password step with the expired copy.
- On success the browser goes to the kept address.

**Operator.**
- While Regions or Billing is open, figures change in place from the 2-second re-reads.
- `dialog "Suspend workspace"` keeps its typed reason, focus and caret through every re-read.
- `status "Operator status"` keeps its last message until the next operator action replaces it.

**Hover, press and touch.**
- Table rows and buttons react to the pointer within about a tenth of a second.
- Rows take a slightly lighter surface tone on hover.
- Buttons brighten slightly on hover and darken slightly while pressed.
- At 375x812 and 768x1024 there is no drop target; only `button "Upload files"` is offered.
- A long press does nothing special.

### Visual design (DP-08, DP-09, DP-30)

- **Colour.** The look is nocturnal.
  - The ground is near-black with a faint cool cast.
  - Panels, rails and drawers use a slightly lighter charcoal surface.
  - Text is a warm parchment off-white. Nothing on any screen is pure white.
  - There is one accent, a warm amber. It is used only for primary actions, the focus outline, the drop-target outline, the origin pin, settled pins and wake lines.
  - A cool mid-grey serves secondary text, table rules, hollow pending rings and disabled controls.
  - Errors, failed states, held versions, dead deliveries and a broken audit chain use the ink colour with a glyph and words, never a new colour on its own.
  - All text and controls meet WCAG 2.2 AA contrast against their background.
- **Type.**
  - Headings are set in Space Grotesk, a geometric grotesque with slightly quirky letterforms. Body text is IBM Plex Sans.
  - Every number is set in JetBrains Mono with same-width digits, so columns of numbers line up. That covers byte counts, millisecond values, ETags, version IDs, key IDs, sequences, hashes, prices, timestamps and codes.
  - Each heading step is about a quarter larger than the step below it, starting from body text.
  - Font files are bundled and served from the app's own origin. Icons come from Lucide.
- **Density.**
  - The layout is compact. Tables have thin muted rules between rows, tight cell padding and right-aligned numeric columns.
  - Every button, link, input, checkbox hit area and table row is at least 44 px tall and at least 44 px wide.
- **Composition.**
  - The marketing page sits on a 12-column grid, with the headline hung from the left edge above the full-width dot-grid strip.
  - In the console, the narrow fixed rail, the dense centre table and the right inspector drawer read as three distinct planes. Surface tone separates them, not shadows.
  - The Account page is one centred column of three ruled panels.
  - The dot-grid strip is flat: evenly spaced muted dots in an equirectangular projection, with no glow, gradient or 3D effect.
  - Pins are small circles with the region name beside them.

### Motion and effects (DP-27, DP-28, DP-29, DP-30, DP-31)

**General rules.**
- All motion starts quickly and eases to a gentle stop.
- Only one element moves at a time, and nothing loops or moves while the screen is idle.
- There are no spinners, pulsing dots, shimmer placeholders or other unnamed decorative loops. Pending states are shown with static text, static dashed rings and determinate progress bars.
- In-place updates from re-reads change values without any animation.

**Specific motions.**
- **Inspector:** slides in from the right in about a third of a second and slides out in about a fifth of a second.
- **Dialogs:** fade and rise slightly into place in about a fifth of a second.
- **Upload progress:** the bar grows to match the bytes sent as data goes out.
- **Hover and press feedback:** lasts under a fifth of a second.

**Replica Wake (signature).** The Wake shows, with evidence, which regions hold the current version of an object and how long each one took to settle. It is driven only by replica records from the server, never by timers that guess.

1. **The map.** The replica map is a flat dot-grid strip in the inspector. It has one pin for each region in the bucket's placement, placed at that region's map position from Seed data.
2. **Origin.** The origin pin is filled amber and labelled "origin" from the moment the version is acknowledged or restored.
3. **Pending.** A pending non-origin pin is a dashed, hollow, muted ring with the word "pending" beside it.
4. **A wake.** When the server reports that a region has settled while the inspector is open, that region plays its wake. A wake is three steps, one after the other, about 1.1 seconds in total:
   - **Line:** a thin amber wake line draws from the origin pin to the region's pin over about a third of a second. Its `data-progress` rises from 0.00 to 1.00.
   - **Fill:** the target pin fills from hollow to solid amber over about a fifth of a second. Its `data-state` becomes `settled` as the fill begins.
   - **Count:** the mono numeral beside the pin counts from 0 up to the server-reported settle time in milliseconds, over a little more than half a second. Every value it shows, the last included, uses the display format from Feedback states. It ends exactly on that value, followed by " ms".
5. **Order.** When several regions settle, their wakes play in ascending settle-timestamp order. Ties are broken by placement order. Each wake starts only after the previous one finishes.
6. **Failure.** A failed region shows an X glyph inside its ring, the word "failed" and `button "Retry <region name>"`. A failure does not animate; it appears in one frame.
7. **Return to pending.** A failed region that returns to pending resets in one frame. The X glyph, "failed" and Retry disappear, and the dashed ring and "pending" come back. This happens whether the return came from Retry or from its region coming back online.
8. **New or restored version.** The open object may get a new current version, through the user's own upload or one detected by polling, or have a deleted version restored by an undo. Either way, every non-origin pin returns to the pending ring at once, its wake line and numeral clear, and the origin pin stays filled.
9. **Already settled.** Opening the inspector on an object whose replicas have already settled shows the finished state immediately: every line drawn, every pin filled, every numeral at its final value. Only settles that arrive while the inspector is open play.
10. **Not scroll-driven.** The Wake follows time and server state. Scrolling the page or the inspector never moves or reverses it.
11. **Pins, list and announcements stay in step.** The pins, `list "Replica status"` and `status "Replica announcements"` all follow the replica record as the pins show it.
    - A region's list item changes, and its announcement is made, in the same frame that its pin's `data-state` changes.
    - For a settle, that frame is the moment the fill begins, after the region's own wake line has drawn. A settle queued behind other wakes reaches the list and the announcement only when its own fill begins, not when the server reports it.
    - Failures, returns to pending, and new-version or restore resets are never queued. Each one changes the pin, the list item and the announcement as soon as the inspector receives the record.
    - A new or restored version cancels any wakes still queued for the old one.
12. **Timing of a settle, end to end.**
    - The inspector re-reads replica state on the schedule in Interactions, so a server-side change reaches it within two seconds.
    - If no wake is playing, a region's wake line starts as soon as the inspector receives the settle. Otherwise it starts when the wake ahead of it finishes, about 1.1 seconds after that wake's line began. A settle with k wakes ahead of it therefore starts its line about 1.1 × k seconds later.
    - The region's fill begins about a third of a second after its own wake line begins: no sooner than a quarter of a second and no later than half a second. Its `data-state`, list item and announcement change at that moment.
    - With reduced motion there is no queue delay and no line delay. Each settle's `data-state`, list item and announcement change in the same frame the inspector receives it.

**Reduced motion.** When the operating system asks for reduced motion:
- drawers and dialogs appear and disappear in place;
- the progress bar jumps to each new value;
- each Replica Wake settle shows the finished wake line (`data-progress` 1.00), the solid pin and the final numeral in a single frame, still in settle-timestamp order.

The status list and every live-region announcement keep the same copy, so the same information arrives without movement.

### Feedback states (DP-04, DP-05, DP-08, DP-10, DP-13, DP-14, DP-18, DP-21, DP-27, DP-29, DP-31, DP-32, DP-34, DP-35, DP-36, DP-37, DP-38, DP-40, DP-43, DP-45, DP-47, DP-49, DP-52, DP-53, DP-54, DP-56, DP-58, DP-59, DP-61, DP-62, DP-63, DP-64, DP-65, DP-66, DP-67, DP-69, DP-70, DP-71)

**Display formats (every screen).** These formats apply to every value shown on the marketing page, sign-in, console, account page, operator console, accept-invite page and link recipient pages. That includes table cells, list items, meters, wake numerals, the replica status list, dialogs and every copy string in this section.
- **Counts.** Byte counts, millisecond figures, request-unit counts, sequence numbers, attempt counts, generations and every other whole-number count are written with comma thousands separators and no decimal point. For example, 2048 bytes reads "2,048", and a settle of 1234 milliseconds reads "1,234 ms". Values under 1,000 have no separator, for example "0 ms" and "512".
- **Times.** Every time is UTC, written `YYYY-MM-DD HH:MM:SS UTC`. That includes the Last modified, created, expiry, last-used, signed-in, last-seen, next-attempt and delivered columns, the audit Time column, "noncurrent since <time>" and "held until <time>" in the Versions list, and every time in copy. The one exception is a value typed into `textbox "Retain until (UTC)"` or `textbox "Expires at (UTC)"`, which uses `YYYY-MM-DD HH:MM:SS` without the suffix.
- **Not affected:**
  - usage row amounts use the decimal amount format from Business rules;
  - percentages use one decimal place, as stated for the meters;
  - prices in `table "Pricing"` read exactly as in Seed data;
  - ETags, version IDs, key IDs and hashes are shown as stored;
  - API values, CSV values and `data-*` attribute values keep their own formats.

The copy in this section is exact. Placeholders:
- `<expires at>`, `<undo until>`, `<confirmed through>` and every other `<time>` follow the time format above.
- `<short version>` and `<short>` are the first 8 characters of a version ID.
- `<region names>` are joined with ", ".
- `<n region(s)>` reads "1 region" or "<n> regions".
- `<n other session(s)>` reads "1 other session", or "<n> other sessions" for any other number, 0 included.
- `<seconds>` is the server's Retry-After value.

Each async action's states, with the live region they appear in:

- **Storage outage.** Shown in the action's own region for any action whose server answer is 503 `service_unavailable` or `storage_unavailable`: "Farshore can't reach storage right now. Nothing was changed; try again in a minute."
- **Step-up cancelled.** Shown in the cancelled action's own status region: "Nothing changed. Confirmation was cancelled."
- **Sign in** (`alert`):
  - pending: the button reads "Signing in…" and is disabled;
  - wrong credentials (also shown for an unknown email): "Email or password is incorrect.";
  - throttled, on either step: "Too many sign-in attempts. Try again in <seconds> seconds.";
  - outage: the storage outage copy.
- **Sign-in code step** (`alert`):
  - pending: `button "Verify"` reads "Verifying…" and is disabled;
  - wrong code or recovery code: "That code didn't work.";
  - expired pending sign-in (the panel returns to the password step): "This sign-in has expired. Enter your email and password again.";
  - both or neither given: the server's `errors.code` message.
- **Step-up** (`alert` in `dialog "Confirm it's you"`):
  - pending: "Checking code…";
  - wrong code: the server's `errors.code` message.
- **Create bucket** (`status "Bucket status"`):
  - pending: "Creating <name>…";
  - success: "Created <name> in <region names>.";
  - name error (also shown under the name field): "This name doesn't meet the bucket naming rules.";
  - placement error: "Choose one origin and up to three other regions.";
  - name taken: "That name is taken. Bucket names are unique across all of Farshore."
- **Upload** (`status "Upload status"`):
  - pending: "Uploading <file name>: <sent> of <total> bytes";
  - success: "Stored <key> as version <short version>. Copies pending in <n region(s)>.", or for a single-region bucket "Stored <key> as version <short version>." An idempotent replay shows the same success copy;
  - size mismatch: "<file name> changed while uploading. Nothing was saved; try again.";
  - too large: "<file name> is over the single-upload limit. Use a multipart upload through the S3 API.";
  - bad key: "<file name> has a name Farshore can't store as a key.";
  - scripted SVG: "<file name> is an SVG with scripts. Farshore doesn't store scripted SVG files.";
  - tag error (also shown under `textbox "Tags"`): "These tags break the tag limits for an object.";
  - metadata error: "This file's metadata is over the size limit.";
  - overwrite lost: "<key> changed since you opened it. Reload to get version <short version> before saving.";
  - overwrite target deleted: "<key> was deleted since you opened it. Nothing was saved.";
  - over quota: "<file name> would put <workspace name> over its <quota> byte storage limit. Nothing was saved." Here `<quota>` is the plan's included storage bytes;
  - origin offline: "<bucket name> can't take uploads while its origin region <region name> is offline. Nothing was saved; try again later.";
  - forbidden: "You can't upload to this bucket.";
  - suspended: the suspension banner copy below;
  - outage: the storage outage copy.
- **Object list and filters** (`status "Results status"`):
  - pending: "Loading objects…";
  - success: "<n> objects on this page", where `<n>` counts object rows and folder rows together;
  - truncated: "Showing the matches found so far. Narrow the filter or go to the next page.";
  - field error: "Filter not accepted: <message>", where `<message>` is the server's `errors` message for the field, cursor errors included;
  - empty: "No objects match.";
  - bucket outside the workspace: "This bucket isn't in your workspace.";
  - unknown object in the address: "No object <key> in <bucket>." The inspector stays closed.
- **Bulk delete** (`status "Delete status"`):
  - pending: "Deleting <n> objects…";
  - success: "Deleted <d> objects. <m> were already gone. Undo until <undo until>." The middle sentence is left out when `<m>` is 0;
  - undo pending: "Restoring…";
  - undo success: "Restored <r> objects.", then " <k> kept their newer version." when `<k>` is not 0, then " <g> were removed for good." when `<g>` is not 0;
  - window closed: "The undo window has closed.";
  - already undone: "This delete was already undone.";
  - `list "Delete results"` items: "<key>: deleted" and "<key>: already gone"; after an undo, "<key>: restored", "<key>: kept newer version" and "<key>: removed for good".
- **Lifecycle rules** (`status "Lifecycle status"`):
  - pending: "Saving rules…";
  - success: "Lifecycle rules saved for <bucket>.";
  - field error: "Rules not saved. Fix the highlighted fields." The server's message for each field appears beneath it.
- **Versions** (`status "Version status"`):
  - pending: "Updating version <short>…";
  - retention set: "Version <short> held until <time>.";
  - legal hold changed: "Legal hold on for version <short>." or "Legal hold off for version <short>.";
  - deleted: "Version <short> deleted.";
  - refused by retention: "Version <short> is held until <time>; it can't be deleted.";
  - refused by legal hold: "Version <short> is on legal hold; it can't be deleted.";
  - shortening refused: "Retention can be extended but not shortened.";
  - retention time error: the server's `errors.retain_until` message.
- **Replica announcements** (`status "Replica announcements"`, polite):
  - settle: "<region name> settled in <settle ms> ms";
  - failure: "<region name> failed";
  - return to pending, manual or automatic: "<region name> retrying";
  - new version: "New version <short version>. Copies pending in <n region(s)>.";
  - restored version: "Restored version <short version>. Copies pending in <n region(s)>."
- **Release readiness** (`status "Release readiness"`):
  - ready: "Ready to ship: all <placed count> regions hold version <short version>.";
  - waiting: "Waiting on <pending count> of <placed count> regions.";
  - failed: "Not ready: <failed count> failed. Retry before shipping." Failed takes precedence over waiting.
- **Share link** (`status "Share status"`):
  - pending: "Creating link…";
  - success: "Link ready. It expires <expires at>.";
  - copied: "Link copied.";
  - expiry error: "Pick an expiry between one second and seven days.";
  - revoked: "Link revoked. It stops working on the next request.";
  - outage: the storage outage copy.
- **Link recipient pages.** These are HTML pages, served when the request accepts HTML. Each holds only its heading and names no key, bucket, workspace, region or creator:
  - expired: "This link has expired.";
  - revoked: "This link was revoked.";
  - unknown: "This link doesn't exist.";
  - suspended: "This link is paused.";
  - rate limited: "Too many downloads right now. Try again in <seconds> seconds."
- **Invite** (`status "Invite status"`):
  - pending: "Sending invite…";
  - success: "Invite created for <email>. It expires <expires at>.";
  - email error: "Enter a valid email address.";
  - already a member: "<email> is already in this workspace.";
  - rate limited: "Too many invites right now. Try again in <seconds> seconds."
- **Team changes** (`status "Team status"`):
  - pending: "Updating <name>…";
  - role changed: "<name> is now an owner.", "<name> is now a developer." or "<name> is now a viewer.";
  - removed: "<name> removed. Their share links were revoked.";
  - last owner: "A workspace needs at least one owner."
- **Accept invite** (`alert`):
  - expired: "This invite has expired. Ask the workspace owner for a new one.";
  - wrong password for an existing account: "That password doesn't match your Farshore account.";
  - throttled: the sign-in throttled copy;
  - success: the page goes to `/console`.
- **Access keys** (`status "Key status"`):
  - pending: "Creating key…" or "Rotating key…";
  - created: "Key <key id> created. Copy the secret now; Farshore won't show it again.";
  - rotated: "Key <key id> rotated. The previous secret works until <time>.";
  - rotation during an overlap: "This key's previous secret is still live. Rotate again after the overlap ends.";
  - disabled: "Key <key id> disabled. Requests signed with it fail from now on.";
  - deleted: "Key <key id> deleted.";
  - field error: "Key not created. Fix the highlighted fields." The server's message for each field appears beneath it;
  - illegal delete: "Disable the key before deleting it.";
  - other illegal transition: "That change isn't allowed from the current state."
- **Webhooks** (`status "Webhook status"`):
  - pending: "Saving endpoint…";
  - created: "Endpoint added. Copy the signing secret now; Farshore won't show it again.";
  - disabled: "Endpoint disabled. New events are not queued for it.";
  - enabled: "Endpoint enabled.";
  - deleted: "Endpoint deleted.";
  - field error: "Endpoint not added. Fix the highlighted fields." The server's message for each field appears beneath it;
  - limit: "This workspace already has 5 webhook endpoints.";
  - redelivered: "Delivery <sequence> queued again.";
  - illegal transition: "That change isn't allowed from the current state."
- **Encryption** (`status "Encryption status"`):
  - pending: "Rotating workspace key…";
  - success: "Workspace key rotated to generation <n>. <m> data keys re-wrapped.";
  - another rotation running: "Another rotation is running. Try again when it finishes."
- **Audit** (`status "Audit status"`):
  - pending: "Verifying chain…";
  - verified: "Chain verified: <n> entries intact.";
  - broken: "Chain broken at entry <seq>.";
  - filter error: "Filter not accepted: <message>", where `<message>` is the server's `errors` message;
  - empty: "No audit entries match."
- **Two-step** (`status "Two-step status"`):
  - setup started: "Add this key to your authenticator app, then enter the code it shows.";
  - pending: "Checking code…";
  - turned on: "Two-step sign-in is on. Save your recovery codes now; Farshore won't show them again.";
  - turned off: "Two-step sign-in is off.";
  - wrong code: the server's `errors.code` or `errors.recovery_code` message.
- **Sessions** (`status "Sessions status"`):
  - one ended: "Session signed out.";
  - others ended: "Signed out <n other session(s)>."
- **Password** (`status "Password status"`):
  - pending: "Changing password…";
  - success: "Password changed. <n other session(s)> signed out.";
  - wrong current password: "Your current password is incorrect.";
  - new password error: the server's `errors.new_password` message;
  - throttled: the sign-in throttled copy.
- **Billing sync** (`status "Billing sync"`). It is re-read on the Usage schedule in Interactions:
  - `in_sync`: "Billing in sync. Confirmed through <confirmed through>.";
  - `pending`: "Billing sync pending. Closed hours post within a minute.";
  - `delayed`: "Billing sync delayed. Metered totals here are complete; billing has confirmed usage through <confirmed through>.";
  - when nothing has been confirmed this month, `<confirmed through>` reads "nothing yet this month".
- **Usage figures.** The meters, the reserved bytes and the request units are re-read on the same schedule as the billing line.
- **Usage export.** The button reads "Preparing CSV…" until the download starts. A failure shows the storage outage copy in `status "Billing sync"`.
- **Suspension banner** (`alert`, on every console page of a suspended workspace): "This workspace is suspended. Uploads, downloads and share links are paused."
- **Operator** (`status "Operator status"`):
  - region change: "<region name> is now offline." or "<region name> is now online.";
  - workspace change: "<workspace name> suspended." or "<workspace name> reinstated.";
  - after a sync: "Billing sync: <posted> rows posted, <queued> still queued.";
  - after a lifecycle run: "Lifecycle run: <e> versions expired, <a> uploads aborted, <s> held versions skipped.";
  - illegal transition: "That change isn't allowed from the current state."

Each of the async results for two-step turned on, session signed out, other sessions signed out and password changed is announced exactly once, through its named status region.

## Backend

### API (DP-01, DP-04, DP-05, DP-10, DP-11, DP-12, DP-14, DP-15, DP-16, DP-17, DP-18, DP-19, DP-20, DP-22, DP-23, DP-24, DP-25, DP-26, DP-33, DP-34, DP-36, DP-37, DP-38, DP-39, DP-40, DP-42, DP-44, DP-45, DP-46, DP-47, DP-48, DP-49, DP-52, DP-53, DP-54, DP-56, DP-57, DP-58, DP-59, DP-60, DP-61, DP-62, DP-63, DP-64, DP-65, DP-66, DP-67, DP-69, DP-70, DP-71)

**General.**
- JSON endpoints live under `/api` and accept and return `application/json; charset=utf-8`.
- JSON request bodies are limited to 65,536 bytes. Exactly 65,536 is allowed; anything larger answers 413.
- Times are ISO 8601 UTC strings with a `Z` suffix and second precision.
- ETags are always written with surrounding double quotes, in JSON strings as well as in headers.
- Byte sizes are integers.
- **Session cookie.** Console sessions use the HttpOnly cookie `fs_session` (SameSite=Lax). Farshore sets no other cookie.
  - The cookie holds an opaque token of 256 random bits. Only a hash of the token is stored.
  - The session identifies the user only. Roles and memberships are read again on every request.
- **`X-Requested-With` header.** Every POST, PUT, PATCH and DELETE under `/api` must carry `X-Requested-With: farshore`, including the session, two-step, password and invite-accept calls. Without it the request answers 403 `forbidden`. GET and HEAD, the S3 API under `/s3`, and share links under `/l` never need it.
- **Path parameters.** `{ws}` is a workspace slug. Object keys travel in the `key` query parameter, URL-encoded. Versions travel in the `version` query parameter.
- **Published fields only.** Every JSON request body accepts only the fields printed for it here. A body printed as "—" or "no body" accepts an empty body or `{}`.
  - Any other top-level member answers 422 with `errors.<member name>` "This field can't be set." It is listed together with every other failing field, and nothing changes.
  - A missing required field answers 422 with `errors.<field>` "This field is required."

**JSON error shape.**
- Errors: `{"error":"<code>","message":"<text>"}`.
- Validation errors: `{"error":"validation_failed","message":"<text>","errors":{"<field>":"<message>"}}`.
- A 429 also carries `"retry_after_seconds":<n>` and the `Retry-After` header.

The codes are:

| Status | Codes |
|---|---|
| 401 | `unauthenticated`; `invalid_credentials`; `two_step_required` (message "Enter the code from your authenticator app to finish signing in.") |
| 403 | `forbidden`; `workspace_suspended`; `step_up_required` (message "Confirm it's you with a code from your authenticator app.") |
| 404 | `not_found` |
| 409 | `invalid_transition` (with `"from"` and `"to"`); `bucket_name_taken`; `idempotency_key_reused`; `already_member`; `last_owner`; `retention_locked`; `endpoint_limit`; `rotation_in_progress`; `object_locked` (with `"retain_until"` and `"legal_hold"`); `quota_exceeded` (with `"quota_bytes"`, `"stored_bytes"` and `"reserved_bytes"`) |
| 410 | `invite_expired`, `link_expired`, `link_revoked`, `undo_expired` |
| 412 | `precondition_failed` (with `"current_etag"`) |
| 413 | `payload_too_large` |
| 422 | `validation_failed` |
| 429 | `rate_limited` |
| 503 | `region_offline`, `storage_unavailable`, `service_unavailable` |

**S3 error shape.** XML in the form `<Error><Code>…</Code><Message>…</Message><Resource>…</Resource><RequestId>…</RequestId></Error>`, with `Content-Type: application/xml`.

**Error precedence (the whole API).** When several errors apply, the first one in this list is returned:

1. 503 `service_unavailable` when Postgres is unreachable (S3: `ServiceUnavailable`).
2. 429 `rate_limited`.
3. 403 `forbidden` for a missing `X-Requested-With` header (JSON API only).
4. Authentication:
   - JSON API: 401 `unauthenticated` (no session, or the session has ended), then `two_step_required` (a pending session), then `invalid_credentials`.
   - S3: 403 `InvalidAccessKeyId` (unknown, disabled, deleted or expired key), then `RequestTimeTooSkewed`, then `SignatureDoesNotMatch`. A chunk signature found wrong while the body is read also answers `SignatureDoesNotMatch`.
5. 501 `NotImplemented` (an unsupported S3 operation or payload mode).
6. 404 for an unknown resource, or a resource in another workspace (S3: `NoSuchBucket`, `NoSuchKey`, `NoSuchUpload`).
7. 403 forbidden for the caller's role, or for the key's permission, bucket scope or prefix (`forbidden`, `AccessDenied`).
8. 403 `step_up_required`.
9. 403 workspace suspended (`workspace_suspended`, `AccountSuspended`).
10. 409 or 410 state conflict, checked in this order:
    1. the current-version check for a permanent delete (`invalid_transition`; S3 `InvalidArgument`);
    2. `object_locked` (S3 `AccessDenied`);
    3. `retention_locked`;
    4. any other `invalid_transition`;
    5. `rotation_in_progress`;
    6. `undo_expired`;
    7. `endpoint_limit`;
    8. `bucket_name_taken`, `idempotency_key_reused`, `already_member`, `last_owner`;
    9. expired;
    10. revoked.
11. 412 precondition failed. A condition on a key with no current version answers 404 here instead, as set out in Business rules.
12. 413 too large (`payload_too_large`, `EntityTooLarge`).
13. Validation:
    - JSON API: 422 `validation_failed`, listing every failing field in `errors`.
    - S3: 400, with the first code that applies in this order: `InvalidArgument`, `BadDigest`, `IncompleteBody`, `MalformedXML`, `MetadataTooLarge`, `InvalidTag`, `InvalidPartOrder`, `InvalidPart`, `EntityTooSmall`.
14. 409 `quota_exceeded` (S3: 403 `QuotaExceeded`).
15. 503 `region_offline` when the bucket's origin region is offline (S3: `SlowDown`).
16. 503 `storage_unavailable` when MinIO is unreachable (S3: `ServiceUnavailable`).

For example, an upload with a bad key to a bucket whose origin is offline answers 422 (S3: 400 `InvalidArgument`), not 503.

There are five exceptions to this order:
- **Idempotent replays.** A console upload or bulk delete with a stored, completed idempotency key and the same request, or a CompleteMultipartUpload repeated for an upload that already completed, returns its stored response right after step 9. That is before any state, precondition or validation check.
- **Operator paths.** Every path under `/api/ops` is decided right after step 4, before any lookup. That includes unknown sub-paths, workspace slugs and region IDs.
  - An anonymous caller gets 401 `unauthenticated`. A pending session gets 401 `two_step_required`.
  - A fully signed-in non-operator gets 403 `{"error":"forbidden","message":"This area is for the Farshore operator."}`. The body is the same whether or not the named resource exists.
- **Other workspaces' buckets on S3.** An S3 request naming a bucket that exists in another workspace answers 403 `AccessDenied` instead of 404, as S3 clients expect.
- **Quota before body checks.** The quota check is made before an upload body is read. A refused upload therefore answers `quota_exceeded` even if its body would also have failed a body-based check: declared versus received size, checksums, decoded length, chunk signatures or content checks. Checks that can be decided from the request line and headers still come first, as listed above.
- **Code-step body validation.** On `POST /api/session/two-step`, the body validation (exactly one of `code` or `recovery_code`) is decided before the code is judged.

**Session and identity.**

| Method and path | Request | Success | Extra errors |
|---|---|---|---|
| `GET /api/health` | — | 200 `{"status":"ok"}` | none, ever |
| `POST /api/session` | `{"email","password"}` | Not enrolled: 200 `{"user":{"id","name","email","operator":bool},"memberships":[{"workspace":{"slug","name"},"role":"owner"\|"developer"\|"viewer"}]}` plus a new `fs_session` cookie. Enrolled: 202 `{"two_step":"required","expires_at":<time>}` plus a new `fs_session` cookie for a pending session | 401 `invalid_credentials`; 429 `rate_limited` |
| `POST /api/session/two-step` | exactly one of `{"code"}` or `{"recovery_code"}` | 200, the sign-in body, plus a new `fs_session` cookie value | 401 `unauthenticated` (pending session missing, expired or ended); 401 `invalid_credentials` (wrong code); 422 `errors.code` "Enter a code from your app or a recovery code."; 429 |
| `DELETE /api/session` | — | 204, with the cookie cleared (works for pending sessions too) | — |
| `GET /api/me` | — | 200, the sign-in body | — |
| `GET /api/regions` | — | 200 `{"regions":[{"id","name","continent","lon","lat"}]}` (public) | — |

**Account (any fully signed-in user, operator included).**

| Method and path | Request | Success | Extra errors |
|---|---|---|---|
| `GET /api/me/two-step` | — | 200 `{"enabled":bool,"enabled_at":<time>\|null,"recovery_codes_left":<integer>}` | — |
| `POST /api/me/two-step/setup` | no body | 200 `{"secret":"<32 characters A–Z and 2–7>","otpauth_uri":"otpauth://totp/Farshore:<percent-encoded email>?secret=<secret>&issuer=Farshore&algorithm=SHA1&digits=6&period=30"}`. It replaces any earlier unconfirmed setup | 409 `invalid_transition` (`from` "on", `to` "on") |
| `POST /api/me/two-step/enable` | `{"code"}` | 200 `{"recovery_codes":["xxxxx-xxxxx", … 10 codes]}`, returned only here | 409 `invalid_transition` (`from` "off", `to` "on") when no setup was started; 422 `errors.code` |
| `DELETE /api/me/two-step` | exactly one of `{"code"}` or `{"recovery_code"}` | 204 | 409 `invalid_transition` (`from` "off", `to` "off"); 422 `errors.code`, `errors.recovery_code`; 429 |
| `POST /api/me/two-step/confirm` | exactly one of `{"code"}` or `{"recovery_code"}` | 200 `{"confirmed_until":<time>}` | 409 `invalid_transition` (`from` "off", `to` "confirmed"); 422 `errors.code`, `errors.recovery_code`; 429 |
| `GET /api/me/sessions` | — | 200 `{"sessions":[{"id","device","created_at","last_seen_at","current":bool}]}`, newest `last_seen_at` first, never listing pending sessions | — |
| `DELETE /api/me/sessions/{id}` | — | 204. Ending the current session signs the caller out and clears the cookie | 404 for another user's session or an ended one |
| `POST /api/me/sessions/sign-out-others` | no body | 200 `{"ended":<integer>}` | — |
| `PUT /api/me/password` | `{"current_password","new_password"}` | 200 `{"ended_sessions":<integer>}` | 401 `invalid_credentials`; 422 `errors.new_password`; 429 |

Code-field errors on these endpoints:
- A wrong `code` answers 422 with `errors.code` "That code didn't work. Use the current code from your app."
- A wrong `recovery_code` answers 422 with `errors.recovery_code` "That recovery code didn't work or was already used."
- Both fields, or neither, answers 422 with `errors.code` "Enter a code from your app or a recovery code."

**Buckets and lifecycle rules.**

| Method and path | Request | Success | Extra errors |
|---|---|---|---|
| `GET /api/w/{ws}/buckets` | — | 200 `{"buckets":[{"name","placement":["<origin id>","<region id>"…],"created_at","object_count","stored_bytes"}]}`, ordered by name | — |
| `POST /api/w/{ws}/buckets` | `{"name","placement":["<origin id>", …]}` | 201, one bucket object | 409 `bucket_name_taken`; 422 `errors.name`, `errors.placement` |
| `GET /api/w/{ws}/buckets/{bucket}` | — | 200, one bucket object | — |
| `GET /api/w/{ws}/buckets/{bucket}/lifecycle` | — | 200 `{"noncurrent_days":<integer>\|null,"keep_newest_noncurrent":<integer>,"abort_multipart_days":<integer>\|null,"updated_at":<time>\|null}` | — |
| `PUT /api/w/{ws}/buckets/{bucket}/lifecycle` | `{"noncurrent_days","keep_newest_noncurrent","abort_multipart_days"}`, all three required | 200, the saved rules | 422 `errors.noncurrent_days`, `errors.keep_newest_noncurrent`, `errors.abort_multipart_days` |

**Objects (console API).**

| Method and path | Request | Success | Extra errors |
|---|---|---|---|
| `GET /api/w/{ws}/buckets/{bucket}/objects?prefix=&delimiter=&tag_filter=&cursor=&limit=` | — | 200 `{"items":[{"key","version_id","size","etag","content_type","last_modified","tags":{},"replicas_settled","replicas_total"}],"common_prefixes":["…"],"next_cursor":"<opaque>"\|null,"truncated":bool}` | 422 `errors.limit`, `errors.cursor`, `errors.prefix`, `errors.delimiter`, `errors.tag_filter` |
| `GET /api/w/{ws}/search?q=` | — | 200 `{"items":[{"bucket","key","size","last_modified"}],"truncated":bool}` | 422 `errors.q` |
| `PUT /api/w/{ws}/buckets/{bucket}/object?key=` | Raw bytes. Headers: `Content-Type`; `X-Upload-Size` (required, decimal bytes); `Idempotency-Key` (optional, 1–128 printable ASCII characters); `If-Match: "<etag>"` or `If-None-Match: *` (optional); `x-amz-meta-<name>` (optional); `x-amz-tagging` (optional, URL query encoding) | 201 `{"bucket","key","version_id","etag","size","content_type","last_modified","replicas":[<replica>]}`. A replay repeats the stored 201 with the header `Idempotent-Replayed: true` | 404 `not_found` (condition on a key with no current version); 409 `idempotency_key_reused`, `quota_exceeded`; 412 `precondition_failed`; 413; 422 `errors.size`, `errors.key`, `errors.content`, `errors.metadata`, `errors.tags`, `errors.idempotency_key`; 503 `region_offline` |
| `GET /api/w/{ws}/buckets/{bucket}/object?key=` | — | 200 `{"key","version_id","etag","size","content_type","last_modified","metadata":{},"tags":{}}` | — |
| `GET /api/w/{ws}/buckets/{bucket}/object/content?key=&version=` | `version` optional | 200 bytes, with the download headers from Business rules | — |
| `GET /api/w/{ws}/buckets/{bucket}/object/versions?key=` | — | 200 `{"versions":[{"version_id","etag","size","created_at","current":bool,"noncurrent_since":<time>\|null,"retain_until":<time>\|null,"legal_hold":bool}]}`, every stored version, newest created first | — |
| `DELETE /api/w/{ws}/buckets/{bucket}/object?key=` | — | 204 | 404 when the key has no current version |
| `DELETE /api/w/{ws}/buckets/{bucket}/object/version?key=&version=` | — | 204 | 409 `invalid_transition` (`from` "current", `to` "removed"); 409 `object_locked` |
| `PUT /api/w/{ws}/buckets/{bucket}/object/retention?key=&version=` | `{"retain_until":"<time>"}` | 200 `{"version_id","retain_until","legal_hold","locked":bool}` | 409 `retention_locked`; 422 `errors.retain_until` |
| `PUT /api/w/{ws}/buckets/{bucket}/object/legal-hold?key=&version=` | `{"on":bool}` | 200, the same shape as retention | 403 `step_up_required` (turning off); 422 `errors.on` |
| `GET /api/w/{ws}/buckets/{bucket}/object/replicas?key=&version=` | `version` optional, defaulting to the current version | 200 `{"version_id","etag","acknowledged_at","ready":bool,"replicas":[<replica>]}` | — |
| `POST /api/w/{ws}/buckets/{bucket}/object/replicas/{region}/retry?key=&version=` | — | 202 `<replica>` with state `pending` | 409 `invalid_transition` |
| `POST /api/w/{ws}/buckets/{bucket}/objects/delete` | `{"keys":["…"]}`; optional `Idempotency-Key` header | 200 `{"batch_id":<id>\|null,"undo_until":<time>\|null,"results":[{"key","outcome":"deleted"\|"not_found","version_id":<id>\|null}]}`, in request order. A replay repeats the stored 200 with `Idempotent-Replayed: true` | 409 `idempotency_key_reused`; 422 `errors.keys`, `errors.idempotency_key` |
| `POST /api/w/{ws}/batches/{batch_id}/undo` | — | 200 `{"batch_id","state":"undone","results":[{"key","outcome":"restored"\|"newer_version"\|"gone","version_id"}]}`, in the batch's order | 409 `invalid_transition`; 410 `undo_expired` |

- `<replica>` is `{"region","role":"origin"|"replica","state":"pending"|"settled"|"failed"|"superseded","attempts","settled_at":<time>|null,"settle_ms":<integer>|null,"error":"etag_mismatch"|"region_offline"|"copy_failed"|null}`.
- The `replicas` array follows placement order. `attempts` counts the copy attempts so far and is 0 for the origin.
- An unknown or removed version, on any endpoint that takes `version`, answers 404 `not_found`.

**Share links.**

| Method and path | Request | Success | Extra errors |
|---|---|---|---|
| `POST /api/w/{ws}/buckets/{bucket}/object/links?key=&version=` | `{"expires_in_seconds":<integer>}`; `version` optional, defaulting to the current version | 201 `{"id","url":"<origin>/l/<token>","bucket","key","version_id","expires_at","state":"active"}` | 422 `errors.expires_in_seconds` |
| `GET /api/w/{ws}/links` | — | 200 `{"links":[{"id","bucket","key","version_id","created_by","created_at","expires_at","state"}]}`, without URLs | — |
| `POST /api/w/{ws}/links/{id}/revoke` | — | 200, the link with state `revoked` | 409 `invalid_transition` |
| `GET /l/{token}` and `HEAD /l/{token}` | no authentication | 200 bytes, with only the headers allowed in Business rules | 404 `not_found`; 410 `link_expired`, `link_revoked`; 403 `workspace_suspended`; 429 `rate_limited` |

- The `url` is built from the request's own scheme, host and port.
- Any path after the token, for example `/l/<token>/other.bin`, answers 404.
- Query parameters on `/l/{token}` are ignored and never change which object or version is served.
- When the request's `Accept` header includes `text/html`, link errors render the recipient pages from Feedback states with the same status code. Otherwise they answer a JSON error whose `message` is exactly the matching recipient-page heading.

**Team and invites (owner only).**

| Method and path | Request | Success | Extra errors |
|---|---|---|---|
| `GET /api/w/{ws}/members` | — | 200 `{"members":[{"user_id","name","email","role"}]}` | — |
| `PATCH /api/w/{ws}/members/{user_id}` | `{"role":"owner"\|"developer"\|"viewer"}` | 200, one member object | 409 `last_owner`; 422 `errors.role` |
| `DELETE /api/w/{ws}/members/{user_id}` | — | 204 | 409 `last_owner` |
| `POST /api/w/{ws}/invites` | `{"email","role":"developer"\|"viewer"}` | 201 `{"id","email","role","expires_at","state":"pending"}` | 409 `already_member`; 422 `errors.email`, `errors.role`; 429 |
| `GET /api/w/{ws}/invites` | — | 200 `{"invites":[{"id","email","role","expires_at","state":"pending"\|"accepted"\|"expired"\|"replaced"}]}` | — |
| `GET /api/invites/{token}` | no authentication | 200 `{"workspace":{"slug","name"},"email","role","expires_at","existing_account":bool}` | 404; 410 `invite_expired` |
| `POST /api/invites/{token}/accept` | `{"name","password"}`, or only `password` for an existing account | 201, the session body plus the cookie. An existing account enrolled in two-step gets 202 and a pending session instead, exactly as at sign-in | 401 `invalid_credentials`; 404; 410 `invite_expired`; 422 `errors.name`, `errors.password`; 429 |

**Access keys (owner only).**

| Method and path | Request | Success | Extra errors |
|---|---|---|---|
| `GET /api/w/{ws}/keys` | — | 200 `{"keys":[<key>]}` | — |
| `POST /api/w/{ws}/keys` | `{"description","permission":"read"\|"read-write","buckets":["<name>"…]\|null,"prefix":<string>\|null,"expires_at":<time>\|null}`. `buckets` null means every bucket in the workspace. `prefix` and `expires_at` are optional and default to null | 201, `<key>` plus `"secret"`, returned only here | 403 `step_up_required`; 422 `errors.description`, `errors.permission`, `errors.buckets`, `errors.prefix`, `errors.expires_at` |
| `POST /api/w/{ws}/keys/{key_id}/rotate` | no body | 200, `<key>` plus `"secret"` (the new secret, returned only here) | 403 `step_up_required`; 409 `invalid_transition`, `rotation_in_progress` |
| `POST /api/w/{ws}/keys/{key_id}/disable` | — | 200, `<key>` with state `disabled` | 409 `invalid_transition` |
| `DELETE /api/w/{ws}/keys/{key_id}` | — | 204 | 409 `invalid_transition` |

`<key>` is `{"key_id","description","permission","buckets":[…]|null,"prefix":<string>|null,"expires_at":<time>|null,"expired":bool,"state":"active"|"disabled","created_at","last_used_at":<time>|null,"previous_secret_expires_at":<time>|null,"previous_secret_last_used_at":<time>|null}`. The server sets `previous_secret_expires_at` only while the previous secret still works; otherwise it is null.

**Webhooks (owner only).**

| Method and path | Request | Success | Extra errors |
|---|---|---|---|
| `GET /api/w/{ws}/webhooks` | — | 200 `{"endpoints":[<endpoint>]}`, never with secrets | — |
| `POST /api/w/{ws}/webhooks` | `{"url","events":["…"],"buckets":["<name>"…]\|null,"description"}` | 201, `<endpoint>` plus `"secret"`, returned only here | 409 `endpoint_limit`; 422 `errors.url`, `errors.events`, `errors.buckets`, `errors.description` |
| `POST /api/w/{ws}/webhooks/{id}/disable` | — | 200 `<endpoint>` | 409 `invalid_transition` |
| `POST /api/w/{ws}/webhooks/{id}/enable` | — | 200 `<endpoint>` | 409 `invalid_transition` |
| `DELETE /api/w/{ws}/webhooks/{id}` | — | 204 | 409 `invalid_transition` |
| `GET /api/w/{ws}/webhooks/{id}/deliveries?cursor=` | — | 200 `{"deliveries":[<delivery>],"next_cursor"}`, 50 per page, newest sequence first | 422 `errors.cursor` |
| `POST /api/w/{ws}/webhooks/{id}/deliveries/{delivery_id}/redeliver` | — | 202 `<delivery>` with state `pending` | 409 `invalid_transition` |

- `<endpoint>` is `{"id","url","events":[…],"buckets":[…]|null,"description","state":"active"|"disabled","created_at"}`.
- `<delivery>` is `{"id","event_id","event_type","sequence","state":"pending"|"delivered"|"dead","attempts","last_status":<integer>|null,"last_error":"http_status"|"timeout"|"connection_failed"|null,"next_attempt_at":<time>|null,"delivered_at":<time>|null}`.

**Encryption and audit (owner only).**

| Method and path | Request | Success | Extra errors |
|---|---|---|---|
| `GET /api/w/{ws}/encryption` | — | 200 `{"generation":<integer>,"rotated_at":<time>\|null,"wrapped":{"<generation>":<count>}}`. The counts cover stored versions plus open multipart uploads | — |
| `POST /api/w/{ws}/encryption/rotate` | no body | 200 `{"generation","rewrapped"}` | 403 `step_up_required`; 409 `rotation_in_progress` |
| `GET /api/w/{ws}/audit?action=&actor=&cursor=` | — | 200 `{"entries":[{"seq","at","actor","action","target","detail","hash"}],"next_cursor":<opaque>\|null}`, 50 per page, newest first | 422 `errors.action` "Choose an action from the list."; `errors.actor` "Actors are 1 to 320 characters."; `errors.cursor` "This page link is no longer valid." |
| `GET /api/w/{ws}/audit/export.csv?action=&actor=` | — | 200 `text/csv; charset=utf-8` with `Content-Disposition: attachment; filename="farshore-<slug>-audit.csv"` | 422 as for the list |
| `GET /api/w/{ws}/audit/verify` | — | 200 `{"ok":bool,"entries":<integer>,"first_broken_seq":<integer>\|null}` | — |

- `action` filters by exact action name, and `actor` by exact actor value. Both are optional.
- No endpoint edits or deletes audit entries. PUT, PATCH and DELETE on any audit path answer 404.

**Usage (owner only).**

| Method and path | Request | Success | Extra errors |
|---|---|---|---|
| `GET /api/w/{ws}/usage` | — | 200 `{"period":"YYYY-MM","plan":{"id","name","included_storage_bytes","included_egress_bytes"},"stored_bytes","reserved_bytes","quota_bytes":<integer>\|null,"egress_bytes","request_units","storage_gb_hours":"<decimal>","percent":{"storage":<number>,"egress":<number>},"billing":{"state":"in_sync"\|"pending"\|"delayed","unposted_rows","confirmed_through":<time>\|null}}` | — |
| `GET /api/w/{ws}/usage/rows?cursor=` | — | 200 `{"rows":[<row>],"next_cursor"}`, 50 per page, newest first | 422 `errors.cursor` |
| `GET /api/w/{ws}/usage/export.csv?period=YYYY-MM` | `period` defaults to the current UTC month | 200 `text/csv; charset=utf-8` with `Content-Disposition: attachment; filename="farshore-<slug>-<period>.csv"` | 422 `errors.period` |

`<row>` is `{"window_start","window_end","bucket","unit","amount":"<decimal>","tracking_id","billing_state":"open"|"queued"|"posted"}`.

Usage CSV format:
- The first line is exactly `window_start_utc,window_end_utc,bucket,unit,amount,tracking_id,billing_state`.
- After it comes one line per usage row of the workspace for that period, ordered by window start, then bucket, then unit.
- Fields are unquoted. Window times use the form `YYYY-MM-DDTHH:MM:SSZ`, and `amount` uses the decimal format from Business rules.
- Every line, including the last, ends with a single line feed.
- Example line: `2026-10-27T14:00:00Z,2026-10-27T15:00:00Z,lanternfish-replays,request-units,3,fs-lanternfish-lanternfish-replays-request-units-20261027T140000Z,posted`

**Operator (operator only, gated as stated in Error precedence).**

| Method and path | Request | Success | Extra errors |
|---|---|---|---|
| `GET /api/ops/regions` | — | 200 `{"regions":[{"id","name","state":"online"\|"offline","pending","failed","oldest_pending_ms":<integer>\|null}]}` | — |
| `POST /api/ops/regions/{id}/state` | `{"state":"online"\|"offline"}` | 200, one region object | 409 `invalid_transition` |
| `GET /api/ops/workspaces` | — | 200 `{"workspaces":[{"slug","name","plan","members","buckets","status":"active"\|"suspended","suspended_reason"}]}` | — |
| `POST /api/ops/workspaces/{ws}/suspend` | `{"reason"}` (1–280 characters) | 200, one workspace object | 409 `invalid_transition`; 422 `errors.reason` |
| `POST /api/ops/workspaces/{ws}/reinstate` | — | 200, one workspace object | 409 `invalid_transition` |
| `POST /api/ops/lifecycle/run` | — | 200 `{"expired_versions","aborted_uploads","skipped_locked"}` | — |
| `GET /api/ops/billing` | — | 200 `{"state":"in_sync"\|"pending"\|"delayed","queued_rows","posted_rows","last_attempt_at","last_error":<text>\|null}` | — |
| `POST /api/ops/billing/sync` | — | 200 `{"sealed","posted","queued":0,"state"}` when everything posted, or 202 with the same shape while rows remain queued | — |

Every `/api/w/...` path answers 404 `not_found` to the operator, who belongs to no workspace.

**S3 API, under `/s3`.** S3 clients use the endpoint `<origin>/s3` in path style. The supported operations are:

| Operation | Request |
|---|---|
| PutObject | `PUT /s3/{bucket}/{key}` |
| GetObject | `GET /s3/{bucket}/{key}`, with optional `versionId` |
| HeadObject | `HEAD /s3/{bucket}/{key}`, with optional `versionId` |
| DeleteObject | `DELETE /s3/{bucket}/{key}`, with optional `versionId`; answers 204 |
| DeleteObjects | `POST /s3/{bucket}?delete` |
| ListObjectsV2 | `GET /s3/{bucket}?list-type=2`, with `prefix`, `delimiter`, `max-keys`, `continuation-token`, `start-after`, `encoding-type` and `fetch-owner` (ignored) |
| CreateMultipartUpload | `POST /s3/{bucket}/{key}?uploads` |
| UploadPart | `PUT /s3/{bucket}/{key}?partNumber=&uploadId=` |
| CompleteMultipartUpload | `POST /s3/{bucket}/{key}?uploadId=` |
| AbortMultipartUpload | `DELETE /s3/{bucket}/{key}?uploadId=`; answers 204 |

Request headers each operation honours:
- PutObject: `If-Match`, `If-None-Match: *`, `Content-MD5`, `x-amz-checksum-<algorithm>`, `x-amz-meta-*` and `x-amz-tagging`.
- CompleteMultipartUpload: `If-Match` and `If-None-Match: *`.
- CreateMultipartUpload: `x-amz-checksum-algorithm` and `x-amz-checksum-type`.
- Every operation accepts `x-amz-sdk-checksum-algorithm` and otherwise ignores it.

Responses:
- **GetObject and HeadObject** carry `ETag`, `x-amz-version-id`, `Last-Modified` (HTTP date), `Content-Length`, `Content-Type`, `x-amz-meta-*` and `x-amz-tagging-count`, plus checksum headers in the cases Business rules allow. GetObject also carries the download headers.
- **ListObjectsV2** returns `ListBucketResult` with:
  - `Name`, `Prefix`, `Delimiter`, `MaxKeys`, `KeyCount` and `IsTruncated`;
  - `Contents`, each with `Key`, `LastModified`, `ETag`, `Size` and `StorageClass` STANDARD;
  - `CommonPrefixes`;
  - `ContinuationToken`, `NextContinuationToken` and `StartAfter`;
  - `EncodingType`, only when it was requested.
- **DeleteObjects** returns 200 `DeleteResult`, with `<Deleted><Key>…</Key></Deleted>` and `<Error><Key>…</Key><Code>…</Code><Message>…</Message></Error>` entries in request order. Both carry `<VersionId>` when the request entry gave one.

Everything else answers 501 `NotImplemented`. That includes ListObjects without `list-type=2` and every other bucket-level operation.

S3 error codes:

| Status | Codes |
|---|---|
| 403 | `AccessDenied`, `InvalidAccessKeyId`, `SignatureDoesNotMatch`, `RequestTimeTooSkewed`, `AccountSuspended`, `QuotaExceeded` |
| 404 | `NoSuchBucket`, `NoSuchKey`, `NoSuchUpload` |
| 412 | `PreconditionFailed` |
| 413 | `EntityTooLarge` |
| 400 | `EntityTooSmall`, `InvalidPart`, `InvalidPartOrder`, `InvalidArgument`, `MetadataTooLarge`, `InvalidTag`, `BadDigest`, `IncompleteBody`, `MalformedXML` |
| 503 | `SlowDown` (with `Retry-After`, used when the origin region is offline), `ServiceUnavailable` |
| 501 | `NotImplemented` |

### Business rules (DP-05, DP-11, DP-12, DP-14, DP-15, DP-16, DP-17, DP-18, DP-19, DP-20, DP-22, DP-23, DP-24, DP-25, DP-26, DP-33, DP-34, DP-36, DP-37, DP-39, DP-40, DP-41, DP-44, DP-45, DP-46, DP-47, DP-48, DP-49, DP-50, DP-51, DP-52, DP-53, DP-54, DP-55, DP-56, DP-57, DP-58, DP-59, DP-60, DP-61, DP-62, DP-63, DP-64, DP-65, DP-66, DP-67, DP-68, DP-69, DP-70, DP-72)

**Roles.**

| Action | viewer | developer | owner | operator |
|---|---|---|---|---|
| List buckets, objects, versions and replicas; read lifecycle rules; search; download | yes | yes | yes | no |
| Mint a share link; revoke a link they created | yes | yes | yes | no |
| Revoke anyone's link in the workspace | no | yes | yes | no |
| Create a bucket; upload; overwrite; delete; retry a replica | no | yes | yes | no |
| Edit lifecycle rules; set retention; permanently delete a version; bulk delete and undo | no | yes | yes | no |
| Legal hold | no | no | yes | no |
| Members, invites, access keys (create, rotate, disable, delete), usage, export, webhooks, encryption, audit trail | no | no | yes | no |
| Every `/api/ops` endpoint, including the lifecycle run | no | no | no | yes |
| Own account: two-step, sessions, password | yes | yes | yes | yes |

- A forbidden action answers 403 `forbidden`.
- A workspace the caller does not belong to answers 404 `not_found`. So does a resource ID (link, batch, webhook, delivery, key) from another workspace.
- The operator belongs to no workspace.

**Sign-in throttling.**
- **What counts.** Failures are counted per email address, compared case-insensitively, whether or not an account exists for that email. Each of these counts as one failure for the email it was submitted for:
  - a wrong password at sign-in;
  - a wrong password at invite accept for an existing account;
  - a wrong current password at password change;
  - a wrong code or recovery code at the sign-in code step, at step-up confirmation and when turning two-step off.
- **The limit.** When an email already has 5 failures within the last `FARSHORE_SIGNIN_WINDOW_SECONDS` seconds (default 900, which is 15 minutes), the next attempt of any of those kinds answers 429 `rate_limited`.
  - This holds even when the password or code is right.
  - The throttled attempt itself is not counted.
  - `Retry-After` is the whole number of seconds until the oldest counted failure leaves the window, and at least 1.
- **Clearing.** A completed sign-in clears that email's failures. For an enrolled user, a sign-in is complete only after the code step.
- **No enumeration.** For a wrong password and for an unknown email, every response is identical in status, body and headers, for the 401s and for the 429s.
- **Order of steps.** The code step is reachable only with a pending session, and a pending session is issued only after a correct password.

**Two-step sign-in.**
- **States.** off → setup → on → off.
  - Setup replaces any earlier unconfirmed setup.
  - Enabling needs a valid code for the setup secret.
  - Turning off needs a valid code or an unused recovery code, and deletes the secret and every recovery code.
- **Codes.** Codes follow RFC 6238: HMAC-SHA1 over the base32-decoded secret, a 30-second step counted from the Unix epoch, and 6 digits. A code for step T−1, T or T+1 is accepted, where T is the server's current step.
- **Each step once.** Each user has one last accepted step, shared by the sign-in code step, step-up confirmation, enabling and turning off. A code is accepted only when its step is later than the last accepted step, and accepting it records that step. This means:
  - a code that was accepted once is never accepted again;
  - once step S has been accepted, a code for any step before S is refused.
- **Recovery codes.**
  - There are 10 of them. Each is 10 characters from a–z and 0–9, shown as `xxxxx-xxxxx`.
  - A recovery code is accepted in any letter case, with or without the hyphen.
  - Recovery codes are stored only as SHA-256 hashes, and each one works once.
- **Secrets at rest.** The secret is stored only sealed with the server's secret key. It appears only in the setup response.

**Pending sessions and the code step.**
- **Pending session.** A correct password for an enrolled user creates a pending session. It ends `FARSHORE_TWO_STEP_PENDING_SECONDS` (default 300) after the password step; the end second is exclusive.
- **What it grants.** A pending session can use only `POST /api/session/two-step`, `DELETE /api/session` and the public routes.
  - Every other `/api`, `/api/me` and `/api/ops` path answers 401 `two_step_required`.
  - Console, account and operator pages redirect to `/signin`.
  - It never appears in the sessions list.
- **Completing sign-in.** An accepted code or recovery code ends the pending session and issues a new active session with a new token, in the same change. The pending token then answers 401 `unauthenticated`.
- **Ended pending session.** A pending session that has expired, or was ended by a password change or by sign-out of other sessions, answers 401 `unauthenticated` at the code step.

**Step-up confirmation.**
- **Sensitive actions:**
  - creating an access key;
  - rotating an access key;
  - turning a legal hold off;
  - rotating the workspace key.
- **Who must confirm.** Only a member enrolled in two-step sign-in. An unenrolled member is never asked. A sensitive action by an enrolled member without a live confirmation answers 403 `step_up_required`.
- **Confirming.** A confirmation lasts `FARSHORE_STEP_UP_SECONDS` (default 300) from its acceptance. `confirmed_until` is exclusive: at that second the confirmation has lapsed.
- **Scope.** A confirmation belongs to the session that made it. Another session of the same user is not confirmed.
- **What keeps it alive.** A password change made in the same session keeps the confirmation. Ending that session ends it.
- **Order of checks.** The step-up check runs after the role check and before suspension, as in Error precedence.

**Sessions.**
- **Records.** Each session has:
  - a public opaque `id`, distinct from its token;
  - `device`: the request's User-Agent cut to its first 80 characters, or "Unknown device";
  - `created_at`;
  - `last_seen_at`, set to the second on every authenticated request, re-reads and polls included.
- **States.**
  - pending (two-step) → active (with a new token) or ended;
  - active → ended.
- **When a session ends:**
  - sign-out;
  - sign-out of that session, or of other sessions;
  - a password change made by another session;
  - sign-in replacement;
  - its idle limit, `last_seen_at` + `FARSHORE_SESSION_IDLE_SECONDS` (default 1,800);
  - its absolute limit, `created_at` + `FARSHORE_SESSION_LIFETIME_SECONDS` (default 43,200). The absolute limit is never extended by activity.

  For the two limits, the session ends at whichever comes first, and both end seconds are exclusive.
- **Sign-in replacement.** `POST /api/session` always issues a new token. Any session named by an incoming `fs_session` cookie is ended in the same change.
- **Sign out other sessions** ends every other session of the user, pending ones included. `ended` counts them.
- **Effect.** The very next request on an ended session answers 401 `unauthenticated` with `Set-Cookie: fs_session=; Max-Age=0`.

**Password change.**
- `new_password` is 12 to 128 characters and differs from the current password. Otherwise it answers 422 with `errors.new_password` "Use 12 to 128 characters, different from your current password."
- In the same change, the password hash is replaced and every other session of the user ends, pending ones included. `ended_sessions` counts them.
- The current session and its step-up confirmation stay.
- Afterwards the old password fails and the new one works.

**Membership changes.**
- **States.** owner, developer, viewer and removed. An owner may move any member between owner, developer and viewer, or remove them. Setting a member's current role again answers 200 with nothing changed.
- **One owner at least.** Membership changes in a workspace are decided one at a time. A change that would leave the workspace with no owner answers 409 `last_owner`. That covers demoting or removing the last owner, oneself included.
- **Concurrent changes.** When two owners demote or remove each other at the same moment, exactly one change succeeds and the workspace keeps at least one owner. The other answers 409 `last_owner`, or 403 `forbidden` if its caller's own demotion was already decided when it arrived.
- **Role changes** apply from the member's very next request. For example, a developer demoted to viewer gets 403 `forbidden` on their next upload.
- **Removal.**
  - A removed member's very next request to that workspace answers 404 `not_found`, on the console API and the console pages. Their other memberships are unaffected.
  - Removing a member revokes every active share link that member created, in the same change. The next request on any of those links answers 410 `link_revoked`.
- Access keys, webhook endpoints and audit entries belong to the workspace and are not affected by member changes.

**Character counting.**
- Wherever a limit is given in characters, Farshore counts user-perceived characters (grapheme clusters). An emoji such as 🎮, or a joined emoji such as 👩‍💻, counts as one.
- Wherever a limit is given in bytes, Farshore counts UTF-8 bytes.

**Bucket names.**
- **Name.** A name has 3 to 63 characters inclusive, using only lowercase a–z, digits 0–9 and hyphen. It starts and ends with a letter or digit and does not start with `xn--`.
  - Lengths 3 and 63 are allowed; 2 and 64 are rejected.
  - A bad name answers 422 with `errors.name` "Bucket names are 3 to 63 lowercase letters, digits or hyphens, starting and ending with a letter or digit."
- **Placement.** The placement lists 1 to 4 distinct known region IDs, and the first is the origin. Anything else answers 422 with `errors.placement` "Choose 1 to 4 different regions; the first is the origin."
- **Uniqueness.** Bucket names are unique across all of Farshore, in every workspace. When several requests create the same name at once:
  - exactly one gets 201;
  - every other, from whatever workspace, gets 409 `bucket_name_taken`;
  - no partial bucket is left behind.
- Placement never changes after creation.
- New buckets start with lifecycle rules `null`, `0`, `null`.

**Object keys.**
- A key is 1 to 1,024 UTF-8 bytes inclusive.
- A key must not:
  - start with `/`;
  - contain a backslash;
  - contain a control character (U+0000–U+001F or U+007F);
  - contain a path segment that is exactly `.` or `..`.
- A bad key answers 422 with `errors.key` "This key can't be stored." on the console, and 400 `InvalidArgument` on S3.

**Metadata and tags.**
- **Metadata.** User metadata totals at most 2,048 bytes. The total is the sum of the UTF-8 byte lengths of every metadata name (without the `x-amz-meta-` prefix) and every value.
  - Exactly 2,048 is allowed.
  - 2,049 answers 422 with `errors.metadata` "User metadata is limited to 2,048 bytes in total." on the console, and 400 `MetadataTooLarge` on S3.
- **Tags.** An object carries at most 10 tags. Each tag key is 1 to 128 characters, each value is 0 to 256 characters, and keys are unique.
  - Ten tags and the boundary lengths are allowed.
  - An 11th tag, a longer key or value, an empty key or a duplicate key answers 422 with `errors.tags` "Up to 10 tags; keys 1 to 128 characters, values up to 256." on the console, and 400 `InvalidTag` on S3.
- Metadata and tags belong to a version and are set only when it is uploaded.

**Uploads.**
- **Size limit.** A single upload (console PUT or S3 PutObject) carries at most 50,000,000 bytes after decoding. Exactly 50,000,000 is allowed. Anything larger answers 413 (`payload_too_large` or `EntityTooLarge`).
- **Declared size.** The console requires `X-Upload-Size`. When the bytes received differ from it, the upload answers 422 with `errors.size` "Declared size <declared> bytes does not match <received> bytes received."
- **Refused uploads** store no bytes and no version. They record no usage, emit no event, reserve nothing, change no counter and write no data key.
- **Content type** is judged from the bytes as well as the declared header:
  - If the first non-whitespace bytes, after an optional byte-order mark, start with `<!doctype html`, `<html`, `<head`, `<body` or `<script` (ignoring case), the content is recorded as `text/html` whatever was declared.
  - Content that parses as SVG is recorded as `image/svg+xml`.
  - SVG that contains a `script` element, an attribute whose name starts with `on`, or a `javascript:` URL is refused with 422 `errors.content` "SVG files with scripts are not accepted." on the console, and 400 `InvalidArgument` on S3.
  - Otherwise the declared type is kept, defaulting to `application/octet-stream`.

**S3 payload modes and checksums.**
- **Payload hash.** `x-amz-content-sha256` is one of the following:
  - the hex SHA-256 of the body; a mismatch answers 400 `BadDigest`;
  - `UNSIGNED-PAYLOAD`;
  - one of the two chunked modes below. These are allowed only on PutObject and UploadPart; anywhere else they answer 400 `InvalidArgument`.

  `STREAMING-AWS4-HMAC-SHA256-PAYLOAD-TRAILER`, `STREAMING-AWS4-ECDSA-P256-SHA256-PAYLOAD` and `STREAMING-AWS4-ECDSA-P256-SHA256-PAYLOAD-TRAILER` answer 501 `NotImplemented`.
- **Chunked bodies** carry a `Content-Encoding` that includes `aws-chunked`, and require `x-amz-decoded-content-length`; without it they answer 400 `InvalidArgument`. The single-upload and part size limits apply to the decoded length, and an over-limit decoded length answers 413 before anything is stored.
- **Signed chunks** (`STREAMING-AWS4-HMAC-SHA256-PAYLOAD`).
  - Each chunk is `<chunk size in hex>;chunk-signature=<64 hex characters>`, then CRLF, then the chunk's bytes, then CRLF.
  - The series ends with a zero-size chunk that carries its own signature, followed by an empty line.
  - Each chunk's signature is the lowercase hex HMAC-SHA256, under the request's SigV4 signing key, of these six lines joined by line feeds:
    1. `AWS4-HMAC-SHA256-PAYLOAD`
    2. the request's `x-amz-date`
    3. the credential scope
    4. the previous signature (for the first chunk, the request's header signature)
    5. the hex SHA-256 of the empty string
    6. the hex SHA-256 of the chunk's bytes
  - The signing key is derived from whichever secret of the access key verified the header signature.
  - Any wrong chunk signature answers 403 `SignatureDoesNotMatch`.
- **Unsigned chunks with a trailer** (`STREAMING-UNSIGNED-PAYLOAD-TRAILER`).
  - Each chunk is `<chunk size in hex>`, then CRLF, then the bytes, then CRLF.
  - The series ends with `0` and CRLF, then the single trailer line `<trailer name>:<value>` and CRLF, then an empty line.
  - `x-amz-trailer` names exactly one of `x-amz-checksum-crc32`, `x-amz-checksum-crc32c`, `x-amz-checksum-sha1` or `x-amz-checksum-sha256`, and the trailer line must use that name.
  - A missing, different or extra trailer answers 400 `InvalidArgument`.
- **Bad framing.** Framing that cannot be read, or decoded data whose length differs from `x-amz-decoded-content-length`, answers 400 `IncompleteBody`.
- **Checksum algorithms.** Farshore checks:
  - CRC32, the common CRC-32 used by zip and gzip;
  - CRC32C (Castagnoli);
  - SHA1;
  - SHA256.

  A value is the base64 of the big-endian digest (4 bytes for the two CRCs). It comes from an `x-amz-checksum-<algorithm>` header or from the trailer.
- **Checksum errors.**
  - More than one checksum, or a value that is not valid base64 of the right length, answers 400 `InvalidArgument`.
  - A checksum that does not match the decoded bytes answers 400 `BadDigest`. A `Content-MD5` that does not match answers the same.
- **Nothing on failure.** When any checksum, decoded-length or chunk-signature check fails, nothing is stored: no bytes, version, part, usage, event, reservation, counter change or data key.
- **What is stored.** Farshore stores the decoded bytes, never the chunk framing, and computes ETags and checksums from them.
- **Stored checksums.**
  - A checksum supplied with a PutObject is stored with the version, and one supplied with an UploadPart is stored with the part.
  - The PutObject and UploadPart responses echo it as `x-amz-checksum-<algorithm>`.
  - GetObject and HeadObject return a version's stored checksum only when the request carries `x-amz-checksum-mode: ENABLED`, and only for a single-upload version that stored one. Multipart versions never return a full-object checksum.
  - Console uploads store no checksum. Console downloads and share links never send checksum headers.
- **Multipart checksums.**
  - CreateMultipartUpload may declare `x-amz-checksum-algorithm`. The result echoes it as `ChecksumAlgorithm` and as the same header.
  - A part checksum of a different algorithm answers 400 `InvalidArgument`.
  - The Complete part list may carry `ChecksumCRC32`, `ChecksumCRC32C`, `ChecksumSHA1` or `ChecksumSHA256` for each part. Each one must equal that part's stored checksum, otherwise the request answers 400 `InvalidPart`.

**Downloads from this origin** (console content, share links and S3 GetObject).
- **Download headers.** Every such response carries:
  - `X-Content-Type-Options: nosniff`
  - `Content-Security-Policy: sandbox`
  - `Cache-Control: private, no-store`
  - `Content-Disposition: attachment; filename="<ascii fallback>"; filename*=UTF-8''<encoded name>`
- **`<encoded name>`** is the key's last path segment, percent-encoded byte by byte over UTF-8. The characters A–Z, a–z, 0–9 and ``! # $ & + - . ^ _ ` | ~`` stay as they are. Every other byte becomes `%XX` with uppercase hex.
- **`<ascii fallback>`** is the same segment with each non-ASCII code point, `"`, `\` and control character replaced by `_`.
- **Example.** The key `qa/ゲーム "final".bin` gives `attachment; filename="___ _final_.bin"; filename*=UTF-8''%E3%82%B2%E3%83%BC%E3%83%A0%20%22final%22.bin`.
- **Risky types.** When the recorded type is `text/html`, `image/svg+xml`, `application/xhtml+xml`, `text/xml`, `application/xml` or any JavaScript type, console content and share links send `Content-Type: application/octet-stream`. S3 GetObject returns the recorded type.
- **Ranges.** Range requests are not supported. The full object is returned with 200.
- **Bytes returned.** Every download returns exactly the bytes that were uploaded.

**Versions and conditional writes.**
- **Version states.**
  - current → noncurrent, by an overwrite or a delete;
  - noncurrent → current, only by an undo;
  - noncurrent → removed, by a permanent delete or lifecycle expiry. This is refused while the version is locked.

  A current version is never removed directly. Removed is final.
- **New versions.** Every successful write creates a new current version with a fresh opaque version ID of at most 64 characters, and the previous current version becomes noncurrent. A noncurrent version stays stored and readable by version ID until it is removed.
- **`noncurrent_since`** is the second at which a version stopped being current: the acknowledgement second of the write that replaced it, or the second of the delete that ended it. It is null while the version is current.
- **ETags.**
  - A single upload's ETag is the quoted lowercase hex MD5 of its decoded bytes.
  - A multipart version's ETag is the quoted hex MD5 of the concatenated binary part MD5s, followed by `-<part count>`.
- **Conditions.**
  - `If-Match` succeeds only when it equals the current version's ETag. `If-None-Match: *` succeeds only when the key has no current version.
  - A failed condition answers 412: `precondition_failed` with `current_etag` on the console, or `PreconditionFailed` on S3.
  - `If-Match` on a key with no current version answers 404 instead: `not_found` on the console, or `NoSuchKey` on S3. This includes a key deleted after the client read it.
- **Concurrent writers.** When N writers send the same `If-Match` at the same moment, exactly one creates a version and the other N−1 get 412. No partial, orphaned or extra version is created.
- **Plain delete.** A plain delete is console `DELETE …/object`, S3 DeleteObject without `versionId`, a DeleteObjects entry without a version, or a bulk-delete key. It ends the key's current version:
  - the version becomes noncurrent;
  - the key disappears from listings and search, and current reads answer 404;
  - its replicas become superseded;
  - every active share link to any of the key's versions becomes revoked.
- **No-op delete.** S3 DeleteObject without `versionId` on a key with no current version answers 204 and changes nothing.
- **Permanent delete.**
  - **Paths:** console `DELETE …/object/version`, S3 DeleteObject with `versionId`, or a DeleteObjects entry with `VersionId`, by a developer or owner.
  - **Applies to** only an unlocked noncurrent version. On the current version it answers 409 `invalid_transition` (`from` "current", `to` "removed"), or S3 400 `InvalidArgument`.
  - **Unknown version.** S3 DeleteObject with an unknown `versionId` answers 204 and changes nothing. The console answers 404.
  - **Effects.** A permanent delete has the same effects as a lifecycle expiry, except that the event carries `"reason":"request"` and 1 request unit is recorded.

**Bucket counters.**
- A bucket's `object_count` is the number of keys with a current version.
- Its `stored_bytes` is the sum of the plaintext sizes of every stored version (current and noncurrent, not yet removed), multiplied by the placed region count.
- Both change in the same change that causes them:

| Event | `object_count` | `stored_bytes` |
|---|---|---|
| New key written | +1 | + size × placed |
| Overwrite | unchanged | + new size × placed (the old version stays stored) |
| Plain delete of a current version | −1 | unchanged |
| Permanent delete or lifecycle expiry | unchanged | − size × placed |
| Undo restore | +1 | unchanged |

Losing conditional writers, idempotent replays, refused uploads, failed Completes, no-op deletes and aborted multipart uploads change nothing.

**Console idempotency.**
- An `Idempotency-Key` is scoped to the workspace and kept for `FARSHORE_IDEMPOTENCY_TTL_SECONDS` seconds (default 86,400, which is 24 hours). Console uploads and bulk deletes share that scope.
- **Replay.** The same key with the same endpoint, bucket, object key and body SHA-256 returns the stored response with `Idempotent-Replayed: true`. It creates no version or batch, records no usage, emits no event and does not reset replicas.
- **Conflict.** The same key with a different endpoint, bucket, object key or body answers 409 `idempotency_key_reused`.
- **Format.** A key that is not 1 to 128 printable ASCII characters answers 422 with `errors.idempotency_key`.

**Multipart uploads.**
- **Parts.**
  - Part numbers run from 1 to 1,000 inclusive. Any other number answers 400 `InvalidArgument`.
  - Each part is at most 16,777,216 decoded bytes, and that size is allowed. A larger part answers 413 `EntityTooLarge`.
  - Every part except the last must be at least 5,242,880 bytes, and that size is allowed. A smaller non-last part makes Complete answer 400 `EntityTooSmall`.
  - Re-uploading a part number replaces that part.
- **Total size.** The completed object is at most 1,000,000,000 bytes, and that size is allowed. A larger total makes Complete answer 413 `EntityTooLarge` and creates no version.
- **Part list.** Complete lists the parts in ascending order with their ETags.
  - An out-of-order list answers 400 `InvalidPartOrder`.
  - An unknown part or a mismatched ETag answers 400 `InvalidPart`.
  - Staged parts not named in a successful Complete are discarded.
- **Conditions on Complete.** `If-Match` and `If-None-Match: *` are checked at completion against the key's current version at that moment. So a version written by a PutObject while the upload was open makes an `If-None-Match: *` Complete, or a stale `If-Match` Complete, answer 412 `PreconditionFailed`. A failed condition leaves the upload open with all its parts, and a later Complete with a satisfied condition, or with no condition, can still succeed.
- **Replays.** A completed upload stays known for the idempotency lifetime.
  - A Complete repeated with the same part list answers 200 with the original `CompleteMultipartUploadResult` (same ETag, same `x-amz-version-id`), before any condition is checked, even when its `If-None-Match: *` would now fail. It creates no new version, records no usage and emits no event.
  - A repeat with a different part list answers 400 `InvalidPart`.
- **Unknown uploads.** An aborted or unknown upload ID answers 404 `NoSuchUpload`, whether the upload was aborted by request or by lifecycle.

**Signed S3 access.**
- Requests are signed with AWS Signature Version 4 in the `Authorization` header, service `s3`. Any region string is accepted in the credential scope.
- A request time more than 15 minutes from server time answers 403 `RequestTimeTooSkewed`.
- An unknown, disabled, deleted or expired key answers 403 `InvalidAccessKeyId`. A wrong signature answers 403 `SignatureDoesNotMatch`.
- **Permissions.** A `read` key may GET, HEAD and list. A `read-write` key may also PUT, DELETE, run DeleteObjects and run multipart operations. Anything outside the key's permission, bucket scope or prefix answers 403 `AccessDenied`.
- Disabling or deleting a key takes effect on the very next request.
- `last_used_at` is set to the second on every request whose signature verified.

**Access keys.**
- **Format.** A key ID is `FSK` followed by 17 uppercase letters or digits, 20 characters in all. A secret is 40 random letters and digits.
- **Secrets.** A secret appears only in the response that created it (create or rotate). It is never stored readably: the database holds it only sealed with the server's secret key. It never appears in any email, log line, audit entry, later response or page.
- **Fields.**
  - `description` is 0 to 140 characters; 140 is allowed. Longer answers 422 with `errors.description` "Descriptions are limited to 140 characters."
  - `buckets` lists existing bucket names in the workspace, or is null.
  - `prefix` is null, or 1 to 1,024 UTF-8 bytes that follow the object key rules, with a trailing `/` allowed. Otherwise it answers 422 with `errors.prefix` "Prefixes are 1 to 1,024 bytes and follow the key rules."
  - `expires_at` is null, or a time after now and no later than now + 365 days. Otherwise it answers 422 with `errors.expires_at` "Pick a time after now and within 365 days."
- **Prefix scope.** A key with a prefix may name only object keys that start with that prefix:
  - PutObject, GetObject, HeadObject, DeleteObject and every multipart call on any other key answer 403 `AccessDenied`;
  - ListObjectsV2 without `prefix`, or with a `prefix` that does not start with the key's prefix, answers 403 `AccessDenied`;
  - DeleteObjects reports a per-entry `AccessDenied` for each entry outside the prefix and processes the rest.
- **Expiry.** A request at or after `expires_at` answers 403 `InvalidAccessKeyId`, and the key list shows `"expired":true`. Disable and delete stay legal on an expired key.
- **States.**
  - active → disabled → deleted, plus active → active by rotation. Expired is derived from `expires_at`.
  - Disabling a disabled key answers 409 `invalid_transition` (`from` "disabled", `to` "disabled").
  - Deleting an active key answers 409 (`from` "active", `to` "deleted").
  - Rotating a disabled or expired key answers 409 `invalid_transition` (`from` "disabled" or "expired", `to` "rotated").
  - A deleted key no longer exists (404).
- **Rotation.**
  - Rotating an active key issues a new secret. The previous secret keeps verifying requests and chunk signatures until `previous_secret_expires_at` = rotation second + `FARSHORE_KEY_ROTATION_OVERLAP_SECONDS` (default 86,400). That end is exclusive: from that second, requests signed with the previous secret answer 403 `SignatureDoesNotMatch`.
  - Rotating again while that overlap is live answers 409 `rotation_in_progress`.
  - Of several concurrent rotations, exactly one answers 200.
  - Disabling the key ends both secrets at once.
  - `previous_secret_last_used_at` moves only when a request verified with the previous secret.

**Encryption at rest.**
- **Data keys.** Every version and every multipart upload gets its own random 256-bit data key.
  - Bytes are written to MinIO only as AES-256-GCM ciphertext under that data key, with a fresh random 96-bit nonce for each encrypted segment. The segment layout is yours to choose.
  - This holds on every path: single uploads, chunked bodies, staged parts, completed multipart versions, replica copies and seeded objects.
  - Two uploads of identical bytes are stored as different ciphertext.
- **Wrapping.** Each data key is stored in Postgres only wrapped with AES-256-GCM under the workspace key of a generation g.
  - The workspace key is HKDF-SHA256 over the server's secret key, with salt `farshore-workspace-key` and info `<workspace slug>:<g>`, 32 bytes long. It is never stored.
  - MinIO object metadata carries nothing about keys or plaintext.
- **Plaintext rules.** ETags, checksums, sizes, `Content-Length`, quota and usage are all judged on plaintext.
- **Removal.** Removing a version deletes its wrapped data key in the same change.
- **Workspace key generations.** A workspace starts at generation 1 and moves g → g+1, one rotation at a time.
  - A rotation re-wraps every data key of that workspace's stored versions and open uploads under the new generation. That includes keys written while the rotation runs.
  - When the 200 answers, `wrapped` has exactly one entry: the new generation.
  - No MinIO object is rewritten, so every object's ETag and Last-Modified in MinIO are unchanged.
  - Other workspaces are untouched.
  - A rotation requested while another rotation of the same workspace runs answers 409 `rotation_in_progress`. The generation rises by exactly the number of 200 answers.

**Audit trail.**
- **Storage.** Entries live in the Postgres table `audit_entries`, which has at least these columns:
  - `workspace_slug`;
  - `seq` (bigint);
  - `at` (timestamptz, second precision);
  - `actor`, `action`, `target` and `detail` (text);
  - `prev_hash` and `hash` (lowercase hex).
- **Sequence.** `seq` is gapless per workspace and starts at 1. Entries are appended one at a time per workspace, so concurrent audited actions never share or skip a number.
- **Hash.** `hash` is the SHA-256 of the UTF-8 bytes of these seven lines joined by a line feed, in this order:
  1. `seq` in decimal
  2. `at` as `YYYY-MM-DDTHH:MM:SSZ`
  3. `actor`
  4. `action`
  5. `target`
  6. `detail`
  7. `prev_hash`

  The first entry's `prev_hash` is 64 zeros. Every later entry's `prev_hash` is the previous entry's `hash`.
- **Append-only.** Entries are only ever appended. Member removal and suspension keep them.
- **Verify** reads the stored rows in `seq` order. `entries` is the row count. `first_broken_seq` is the smallest `seq` s for which one of these holds:
  - s is missing while a higher `seq` exists;
  - the `prev_hash` of s differs from the stored `hash` of s−1 (or from 64 zeros for s = 1);
  - the stored `hash` of s differs from its recomputed hash.

  `ok` is true exactly when `first_broken_seq` is null.
- **Audited actions.** These are the only audited actions. Each appends exactly one entry, in the same change as the action:

| action | actor | target | detail |
|---|---|---|---|
| `session.signed_in` | user email | user email | `password`, `two-step` or `recovery code` |
| `session.sign_in_failed` | user email | user email | `password` or `two-step code` |
| `password.changed` | user email | user email | empty |
| `two_step.enabled` | user email | user email | empty |
| `two_step.disabled` | user email | user email | empty |
| `member.role_changed` | owner email | member email | `<old> -> <new>` |
| `member.removed` | owner email | member email | empty |
| `invite.created` | owner email | invited email | the role |
| `invite.accepted` | invitee email | invitee email | the role |
| `access_key.created` | owner email | key ID | the description |
| `access_key.rotated` | owner email | key ID | empty |
| `access_key.disabled` | owner email | key ID | empty |
| `access_key.deleted` | owner email | key ID | empty |
| `legal_hold.changed` | owner email | object key | `<version id> on` or `<version id> off` |
| `encryption.rotated` | owner email | workspace slug | `generation <n>` |
| `workspace.suspended` | `operator` | workspace slug | the reason |
| `workspace.reinstated` | `operator` | workspace slug | empty |
| `permission.denied` | member email, or `key:<key id>` | object key, else bucket name, else request path | `<METHOD> <path as received, without the query>` |

- **Which workspaces.** The sign-in, failed sign-in, password and two-step actions are written to every workspace the user belongs to at that moment. A user with no workspace, such as the operator, appends none. Workspace actions are written to their own workspace.
- **`permission.denied`** covers every console 403 `forbidden` caused by role, and every S3 `AccessDenied` caused by the key's permission, bucket scope or prefix.
- **Never audited:**
  - unknown emails and throttled (429) attempts;
  - 403 `forbidden` for a missing `X-Requested-With` header;
  - `step_up_required` and `workspace_suspended`;
  - operator-gate refusals;
  - lock refusals;
  - S3 requests for another workspace's bucket.
- **Never stored.** No entry ever contains a password, an authenticator or recovery code, a secret, a share-link token or a session token.
- **Isolation.** Audit lists, exports and verify read only the caller's own workspace.

**Audit CSV.**
- The first line is exactly `seq,at_utc,actor,action,target,detail,prev_hash,hash`.
- One line follows per matching entry, in ascending `seq`. `at_utc` uses the form `YYYY-MM-DDTHH:MM:SSZ`.
- Every line, including the last, ends with a single line feed.
- **Neutralising.** A field whose stored value starts with `=`, `+`, `-`, `@`, a tab or a carriage return gets a leading `'`.
- **Quoting (RFC 4180).** A field whose value contains `,`, `"`, a carriage return or a line feed is wrapped in double quotes, with each inner `"` doubled. The `'`, when added, goes inside the quotes.
- **Example.** A target `=HYPERLINK("https://x.test","y")` is written `"'=HYPERLINK(""https://x.test"",""y"")"`, and a detail `-2+3` is written `'-2+3`.
- Hashes are always computed over the stored values, never over the neutralised text.

**Listing and paging.**
- Keys are ordered by UTF-8 byte order. Only current versions are listed.
- **Delimiter.** With a delimiter, keys that contain the delimiter after the prefix roll up into common prefixes. Common prefixes are merged with keys in byte order, and each common prefix and each key counts as one entry toward the page size.
- **Page size.**
  - The console `limit` is 1 to 1,000 inclusive and defaults to 100. Anything outside that answers 422 with `errors.limit`.
  - ListObjectsV2 `max-keys` defaults to 1,000. A larger value is served as 1,000 and reported as `MaxKeys` 1000. A negative or non-integer value answers 400 `InvalidArgument`.
  - `KeyCount` is the number of `Contents` plus `CommonPrefixes` on the page and never exceeds `MaxKeys`.
- **Cursors.** Cursors and continuation tokens are opaque and URL-safe.
  - A token that ends on a common prefix resumes after every key under that prefix, so no common prefix appears on two pages.
  - A `start-after` key that would roll up into a common prefix also resumes after every key under that prefix.
  - A tampered or foreign cursor answers 422 with `errors.cursor` "This page link is no longer valid." on the console, and 400 `InvalidArgument` on S3.
- **Changes while paging.**
  - Every key and common prefix that exists for the whole paging run appears exactly once.
  - A key added after the cursor appears on a later page; one added before the cursor does not.
  - A key deleted before its page is read does not appear.
- **URL encoding.** With `encoding-type=url`:
  - the response carries `<EncodingType>url</EncodingType>`;
  - every `Key`, `Prefix`, `Delimiter`, `StartAfter` and `CommonPrefixes/Prefix` is encoded byte by byte over UTF-8. A–Z, a–z, 0–9, `-`, `_`, `.`, `~` and `/` stay as they are, a space becomes `+`, and every other byte becomes `%XX` with uppercase hex. For example, `r 1+2%.bin` becomes `r+1%2B2%25.bin`;
  - continuation tokens are never encoded.

  Any other `encoding-type` value answers 400 `InvalidArgument`. Without `encoding-type`, names are returned as they are, XML-escaped.

**Filters and search.**
- `prefix` is at most 1,024 UTF-8 bytes. `delimiter` is empty or exactly one character.
- `tag_filter` is an expression of at most 256 characters, and 256 is allowed. An empty or whitespace-only `tag_filter` means no tag filter.
- **Tokens.** Spaces and tabs separate tokens and are otherwise ignored. The tokens are `(`, `)`, the keywords `and`, `or` and `not`, and comparisons. Keywords are lowercase only; `AND` or `Not` is read as a comparison and fails as one.
- **Comparisons.** A comparison is a key, then `=` or `!=`, then a value, with no whitespace inside it.
  - A bare key is one or more characters other than whitespace, `(`, `)`, `=`, `!`, `"` and `*`.
  - A bare value is one or more characters other than whitespace, `(`, `)`, `"` and `*`.
  - A quoted key or value is wrapped in double quotes and may contain any character. Inside it, `\"` stands for a double quote and `\\` for a backslash. `""` is the empty value.
  - A key spelled `and`, `or` or `not` must be quoted.
- **Prefix match.** A `*` directly after a value, as in `build=1.4*` or `note="v 1"*`, matches every tag value that starts with that value. `key=*` matches any value of tag `key`. A `*` anywhere else cannot be read.
- **Matching.**
  - `key=value` is true when the version has tag `key` with exactly that value, compared case-sensitively, or, for a prefix match, a value starting with it.
  - `key!=value` is true only when the version has tag `key` and its value differs, or for a prefix match does not start with the value. A version without tag `key` never matches `key!=value`.
  - `not X` is true whenever X is false, so `not team=art` matches versions with no `team` tag.
- **Precedence.** `not` binds tightest, then `and`, then `or`. `and` and `or` group from the left, and parentheses override. For example, `a=1 or b=2 and not c=3` reads as `a=1 or (b=2 and (not c=3))`. Two comparisons side by side without a keyword cannot be read.
- **Limits.** At most 10 comparisons and at most 3 levels of nested parentheses. `((a=1))` is 2 levels; 4 levels are refused.
- **Tag filter errors.** A failing tag filter answers 422 with `errors.tag_filter`. The checks run in this order, and the first failure wins:
  1. Over 256 characters: "Tag filters are limited to 256 characters."
  2. Cannot be read: "Tag filter could not be read near character <position>." `<position>` is a 1-based character position, counted as in Character counting, with whitespace included. It is the first of these that applies, reading from the left:
     - for an unclosed quote, the position of its opening quote;
     - for a comparison that lacks its operator or value, or has whitespace inside it, the position of the comparison's first character;
     - for a misplaced `*`, its position;
     - for a keyword, `(`, `)` or comparison that cannot stand where it is, its first character;
     - when the expression ends while something is still needed, the expression's length plus one.

     For example, `env=qa and and team=art` stops at 12, `env=qa and` at 11, and `(env=qa` at 8.
  3. More than 10 comparisons: "Tag filters are limited to 10 comparisons."
  4. More than 3 levels of parentheses: "Tag filters are limited to 3 levels of parentheses."
- **Search.** `q` is 1 to 128 characters. It matches key substrings case-insensitively across every bucket in the caller's workspace, and only that workspace. It returns at most 50 results, ordered by bucket and then key.
- **Scan budget.** A listing or search request examines at most 10,000 index entries. When the budget runs out before the page fills, it returns what it found, with `"truncated": true` and a `next_cursor` that continues the scan.
- **Time budget.** Every accepted list, filter or search request answers within 2 seconds.

**Replication.**
- **Acknowledgement.** When a version is acknowledged:
  - its acknowledgement time, truncated to the whole second, becomes its `last_modified` and `acknowledged_at`;
  - its origin replica is settled with `settle_ms` 0;
  - every other placed region gets a pending replica.
- **Copying.** A replication worker copies the version's ciphertext from the origin to each pending region, in placement order.
- **Settling.** A replica becomes settled only when the worker has read back the region's copy, decrypted it, and found that:
  - its plaintext size equals the index size;
  - its recomputed ETag equals the index ETag (for multipart versions, using the recorded part sizes);
  - at that moment the replica is still pending and its version still current.

  `settled_at` is recorded when the check passes. `settle_ms` is `settled_at` minus `acknowledged_at`, in whole milliseconds.
- **Superseded copies.** A replica whose copy is in flight when a newer version or a delete supersedes it stays `superseded`, with `settled_at` and `settle_ms` null, even if its copy later passes the check. A replica that had already settled keeps its `settled_at` and `settle_ms` when superseded.
- **Failures.**
  - A size or ETag mismatch marks the replica failed with `etag_mismatch`.
  - An offline region marks it failed with `region_offline`.
  - Any other copy error marks it failed with `copy_failed`.

  Each copy attempt adds 1 to `attempts`.
- **Timing.** With every region online, every replica of a version up to 50,000,000 bytes settles within 10 seconds of acknowledgement or restore.
- **Readiness.** `ready` is true when every placed region of the current version is settled.

**Replica state machine.**
- **Legal edges:**
  - pending → settled;
  - pending → failed;
  - failed → pending, by manual retry, or automatically when its region comes back online after a `region_offline` failure;
  - pending, settled or failed → superseded, when a newer version or a delete ends the version;
  - superseded → pending, only when an undo restores that version.
- **Retry.** The retry endpoint is legal only from failed. Retrying a pending, settled or superseded replica answers 409 `invalid_transition`. A retried replica is copied again within 10 seconds, or fails again if its region is still offline.
- **Removed versions.** When a version is removed, its replica records are deleted in the same change. A removed version's replica has no state, and no copy can re-create it.

**Regions.**
- **States:** online and offline.
  - Setting a region to the state it already has answers 409 `invalid_transition`.
  - When several requests make the same transition at once, exactly one answers 200 and the rest answer 409 `invalid_transition`.
- **While a region is offline:**
  - copies to it fail at their next attempt with `region_offline`;
  - an upload whose origin region is offline answers 503: `region_offline` on the console, or `SlowDown` with `Retry-After: 30` on S3.
- **Coming back online.** Bringing a region online moves every failed replica in that region with error `region_offline`, of a version that is still current, back to pending. This happens once, in the same change.
  - `attempts` is kept and `error` becomes null.
  - These replicas settle within 10 seconds with no Retry.
  - Replicas failed with `copy_failed` or `etag_mismatch` stay failed until someone retries them.
- **Backlog figures** count the pending and failed replicas of current versions in each region, and always agree with replica state in the same change. `oldest_pending_ms` is the age of the oldest pending replica, or null.

**Lifecycle rules.**
- **Fields.** Each out-of-range field answers 422 with the message shown:
  - `noncurrent_days` is an integer from 1 to 3,650 inclusive, or null (off): "Expire noncurrent versions after 1 to 3,650 days, or leave it off."
  - `keep_newest_noncurrent` is an integer from 0 to 100 inclusive: "Keep 0 to 100 newest noncurrent versions."
  - `abort_multipart_days` is an integer from 1 to 365 inclusive, or null (off): "Abort incomplete uploads after 1 to 365 days, or leave it off."
- **A day.** One lifecycle and retention day lasts `FARSHORE_DAY_SECONDS` seconds (default 86,400).
- **Sweeps.**
  - A background sweep starts every `FARSHORE_LIFECYCLE_SWEEP_SECONDS` seconds (default 60). `POST /api/ops/lifecycle/run` runs one sweep at once.
  - A sweep judges each version and upload against the second at which it runs.
  - Concurrent runs and the background sweep never expire a version or abort an upload twice. The `expired_versions` of concurrent runs add up to the number of versions that were due.
  - Sweeps skip suspended workspaces. Their due work runs on the first sweep after reinstatement.
- **Kept versions.** Order a key's noncurrent versions by `noncurrent_since`, newest first, breaking ties by newer creation first. The first `keep_newest_noncurrent` are never expired. Locked versions count toward that number.
- **Due versions.** Any other noncurrent version is due when the sweep time is at or after `noncurrent_since` + `noncurrent_days` × day. Days count from becoming noncurrent, never from creation.
- **Locked versions.** A due version that is locked is skipped and counted in `skipped_locked`. It expires on the first sweep after its lock lapses.
- **Expiry.** In one change, an expired version:
  - leaves the versions list;
  - answers 404 to every read by version (`not_found`, `NoSuchKey`);
  - turns every active share link to it `revoked`;
  - loses its replica records and its wrapped data key, and leaves the backlog figures;
  - lowers `stored_bytes` by size × placed, leaving `object_count` unchanged;
  - emits exactly one `version.removed` event with `"reason":"lifecycle"`;
  - records no request units;
  - stops counting toward the storage integral from that second.

  Its ciphertext at `regions/<region id>/<bucket>/<version id>` is removed from every placed region by the same sweep. Bytes from a copy that lands after removal are removed within one sweep interval and never become a replica.
- **Incomplete uploads.** An open multipart upload is due when the sweep time is at or after `initiated_at` + `abort_multipart_days` × day. Aborting it:
  - removes its staged parts under `uploads/<upload id>/` and its data key;
  - releases its quota reservation;
  - makes later UploadPart, Complete or Abort calls answer 404 `NoSuchUpload`.

  Replays of completed uploads are unaffected.

**Retention and legal hold.**
- **Retention.** `retain_until` must be after now and no later than now + 3,650 × day. Otherwise the request answers 422 with `errors.retain_until` "Pick a time after now and within 3,650 days."
  - While a version's retention is in force, an earlier time answers 409 `retention_locked`, an equal time answers 200 with no change, and a later time extends it.
  - Once retention has lapsed, any valid time may be set.
- **Legal hold.** `on` must be a boolean; otherwise the request answers 422 with `errors.on` "Choose on or off."
  - Setting the value a version already has answers 200 with no change.
  - Turning a hold off is a sensitive action under step-up.
- **Locked** means `legal_hold` is true, or the current time is before `retain_until`. At the `retain_until` second itself the version is unlocked.
- **One lock rule.** A locked version is never permanently deleted:
  - the console answers 409 `object_locked`;
  - S3 DeleteObject with `versionId` answers 403 `AccessDenied` with the message "This version is under retention or legal hold.";
  - a DeleteObjects entry with `VersionId` gets the same per-entry `AccessDenied`;
  - lifecycle skips it.
- **What stays allowed.** A lock protects a version's bytes, not the key. Overwrite, plain delete, bulk delete and undo stay allowed on a key with locked versions.
- **Removed versions.** Retention and legal hold requests on a removed version answer 404.

**Bulk delete and undo.**
- **The request.** `keys` lists 1 to 1,000 distinct valid keys. Otherwise it answers 422 with `errors.keys` "Choose 1 to 1,000 different keys."
- **Processing.** Each key is processed independently, in request order, each in its own change.
  - A key with a current version is plain-deleted, with outcome `deleted` and that version's ID.
  - A key with no current version gets `not_found`, and nothing changes.
- **The batch.** When at least one key was deleted, one batch is created in state `open`, with `undo_until` = the request's acknowledgement second + `FARSHORE_UNDO_SECONDS` (default 30). When nothing was deleted, `batch_id` and `undo_until` are null.
- **Batch states.** open → undone, by an undo; open → expired, at `undo_until`.
  - An undo at or after `undo_until` answers 410 `undo_expired`.
  - An undo of an undone batch, including a concurrent second undo, answers 409 `invalid_transition` (`from` "undone", `to` "undone"). Exactly one of several concurrent undos answers 200.
- **Undo outcomes.** For each deleted key, in batch order:
  - `restored`, when the key still has no current version and the deleted version still exists;
  - `newer_version`, when the key has a current version again;
  - `gone`, when the deleted version was removed in the meantime.
- **A restore:**
  - makes that exact version current again, keeping its version ID, ETag, size, metadata, tags, data key and `last_modified`;
  - sets `noncurrent_since` to null and `acknowledged_at` to the undo second;
  - adds 1 to `object_count` and leaves `stored_bytes` unchanged;
  - settles the origin replica with `settled_at` at the undo second and `settle_ms` 0;
  - moves every non-origin replica from superseded to pending, with `settled_at`, `settle_ms` and `error` null;
  - leaves revoked share links revoked;
  - emits one `object.restored` event per restored key;
  - records no request units.

**S3 DeleteObjects.**
- **The body.** `<Delete>` holds an optional `<Quiet>true</Quiet>`, then 1 to 1,000 `<Object>` entries, each with a `<Key>` and an optional `<VersionId>`.
  - Zero entries, more than 1,000, or unreadable XML answers 400 `MalformedXML`.
  - A body over 2,097,152 bytes answers 413 `EntityTooLarge`.
  - `Content-MD5` or a checksum header is verified when present (`BadDigest`).
- **Processing.** Entries are processed independently, in request order, each in its own change. A repeated key-and-version pair is reported once, at its first position.
- **Entry outcomes:**

| Entry | Outcome |
|---|---|
| No version; key has a current version | `Deleted`; a plain delete |
| No version; key has no current version | `Deleted`; no change |
| Bad key | `Error` `InvalidArgument` |
| Key outside the access key's prefix | `Error` `AccessDenied` |
| Version given and it is current | `Error` `InvalidArgument` |
| Version given and locked | `Error` `AccessDenied` |
| Version given and unknown | `Deleted`; no change |
| Version given, otherwise | `Deleted`; a permanent delete |

- **The response** is always 200 `DeleteResult`. In quiet mode only `Error` entries are listed.
- **Effects.** Request units, events and counter changes happen once per entry that changed state, and never for the others.

**Webhook endpoints.**
- **Fields.** Each invalid field answers 422 with the message shown:
  - `url`: an absolute `http` or `https` URL of at most 2,048 bytes, with no user info and no fragment: "Enter an http or https URL without credentials."
  - `events`: 1 to 4 distinct values from `object.created`, `object.deleted`, `object.restored` and `version.removed`: "Choose one or more event types."
  - `buckets`: existing bucket names in the workspace, or null for every bucket, including ones created later: "Choose buckets from this workspace, or all buckets."
  - `description`: 0 to 140 characters: "Descriptions are limited to 140 characters."
- **Limit.** A workspace has at most 5 endpoints. Creating a 6th answers 409 `endpoint_limit`.
- **The secret** is `whsec_` followed by 43 base64url characters. It appears only in the 201 response, is stored only sealed, and never appears in any email, log line, audit entry, later response or page.
- **States.** active ⇄ disabled → deleted.
  - Disabling a disabled endpoint, or enabling an active one, answers 409 `invalid_transition`.
  - Deleting an active endpoint answers 409 `invalid_transition` (`from` "active", `to` "deleted").
  - Deleting an endpoint discards its undelivered deliveries.
- **Targets.** Loopback and private addresses are allowed. Redirects are never followed.

**Events and delivery.**
- **Events.** Each event is recorded in the same change that causes it:
  - `object.created`: a PutObject, console upload or CompleteMultipartUpload that created a version;
  - `object.deleted`: a plain delete that ended a current version;
  - `object.restored`: an undo restore;
  - `version.removed`: a permanent delete or lifecycle expiry.

  There are no events for losing writers, replays, refused uploads, no-op deletes or seeding.
- **Deliveries.** Each event creates one delivery for every active endpoint that subscribes to its type and has its bucket in scope. Each endpoint's deliveries carry a gapless `sequence` starting at 1.
- **The request.** Each attempt is a POST with these headers:
  - `Content-Type: application/json`;
  - `Farshore-Event-Id`;
  - `Farshore-Event-Type`;
  - `Farshore-Delivery-Attempt` (1 for the first attempt);
  - `Farshore-Signature: t=<unix seconds>,v1=<signature>`. The signature is the lowercase hex HMAC-SHA256 of `<t>.<raw body>`, keyed by the UTF-8 bytes of the whole secret string, `whsec_` included.
- **The body** is `{"id","type","sequence","occurred_at","bucket","key","version_id","etag","size"}`, plus `"reason":"lifecycle"|"request"` for `version.removed`.
  - `id` is the event ID, the same across endpoints and attempts.
  - The body bytes are identical on every attempt; `t` and the signature are fresh each time.
  - The body never carries metadata, tags, uploader identity, access-key ID, regions or the workspace slug.
- **Ordering.**
  - Each endpoint has at most one delivery in flight.
  - Pending deliveries are attempted in ascending sequence. A delivery waits while any lower-sequence delivery of the same endpoint is pending.
  - Endpoints never wait on each other.
  - A first attempt starts within 3 seconds of the event, unless its endpoint is busy or paused.
- **Outcome of an attempt.** An attempt succeeds on any 2xx answer within 5 seconds. Otherwise it fails with one of these `last_error` values:
  - `http_status`: any other status, 3xx included;
  - `timeout`: no answer within 5 seconds;
  - `connection_failed`: no connection.
- **Backoff.** After failed attempt k (k = 1 to 5), the next attempt starts no earlier than `FARSHORE_WEBHOOK_BACKOFF_SECONDS` × 2^(k−1) seconds after the failure, and no more than 3 seconds later than that. The default base is 10 seconds.
- **Dead letter.** After the 6th failed attempt, the delivery becomes `dead`, the endpoint moves on to its next sequence, and every owner gets one email for that delivery.
- **Delivery states.** pending → delivered or dead; dead → pending, by redeliver, with `attempts` reset to 0. Redelivering a pending or delivered delivery answers 409 `invalid_transition`.
- **Paused deliveries.**
  - A disabled endpoint gets no new deliveries. Its pending deliveries are held and resume when it is enabled.
  - A suspended workspace holds every delivery until reinstatement.

**Share links.**
- **Scope.** A link names one object version.
- **Expiry.** `expires_in_seconds` is an integer from 1 to 604,800 inclusive (7 days). Anything else answers 422 with `errors.expires_in_seconds`.
  - `expires_at` is the creation time plus that many seconds.
  - A request at or after `expires_at`, judged to the exact second, answers 410 `link_expired`.
- **Token.** The token is 43 URL-safe characters drawn from 256 random bits. Only its SHA-256 hash is stored.
- **States.** active → expired, by time. active → revoked, by any of:
  - a request;
  - a plain delete of its key;
  - removal of its creator from the workspace;
  - removal of its version.

  Revoking an expired or revoked link answers 409 `invalid_transition`.
- **Newer versions.** A link keeps serving its own version after newer versions are uploaded.
- **Rate limit.** Each link allows 30 requests (GET or HEAD) in any rolling 60 seconds. The 31st answers 429 `rate_limited`, with `Retry-After` set to the whole seconds until a request would be allowed again, and at least 1.
- **Headers sent.** Every response on `/l/{token}` carries only these headers:
  - `Content-Type`, `Content-Length`, `ETag` and `Last-Modified`;
  - the four download headers;
  - `Retry-After`, on 429 only;
  - the transport headers `Date`, `Connection` and `Keep-Alive`.

  On error responses, the download headers, `ETag` and `Last-Modified` are absent.
- **Never sent.** No response on `/l/{token}` carries `x-amz-meta-*`, `x-amz-tagging-count`, `x-amz-version-id`, any checksum header or `Set-Cookie`. No header or body text names the workspace, bucket, key prefix, creator or region. The filename in `Content-Disposition` is the only part of the key that is sent.

**Invites.**
- **Lifetime.** An invite lives for `FARSHORE_INVITE_TTL_SECONDS` seconds (default 259,200, which is 72 hours). After that its token answers 410 `invite_expired`.
- **Re-inviting.** Inviting an email that already has a pending invite in the workspace replaces it. The old invite becomes `replaced`, and its token answers 404.
- **Members.** Inviting a current member answers 409 `already_member`.
- **Rate limit.** Each workspace may create 10 invites in any rolling 60 seconds. The 11th answers 429 `rate_limited` with `Retry-After`.
- **Accepting.**
  - `name` is 1 to 80 characters and `password` is 12 to 128 characters.
  - For an existing account the password must match, otherwise the request answers 401 `invalid_credentials`.
  - Accepting marks the invite `accepted` and adds the membership with the invited role.

**Storage quota.**
- **Which plans.** On a plan whose storage overage is "none" (Sandbox in the seed), included storage is a hard cap.
- **The check.** Under a lock per workspace, an upload is admitted only when `stored_bytes` + `reserved_bytes` + incoming plaintext size × placed regions is at most the included storage bytes. Exactly equal is allowed.
  - The incoming size is `X-Upload-Size` on the console, the decoded length on chunked S3 bodies, and `Content-Length` otherwise.
  - The check runs before the body is read.
  - A refused console upload answers 409 `quota_exceeded`. A refused PutObject or UploadPart answers 403 `QuotaExceeded`.
- **Reservations.**
  - An admitted single upload reserves size × placed until it finishes. On success the reservation becomes stored bytes; on failure it is released.
  - Each UploadPart reserves its size × placed. Re-uploading a part number releases the old part's reservation first.
  - CompleteMultipartUpload turns the named parts' reservations into stored bytes, releases the rest, and never fails on quota.
  - Abort and lifecycle abort release the upload's reservations.
  - A refused request reserves nothing.
- **Usage fields.** `reserved_bytes` is the sum of open reservations. `quota_bytes` is the included storage on a capped plan, and null otherwise.

**Suspension.**
- **States.** active → suspended → active.
  - Suspending a suspended workspace, or reinstating an active one, answers 409 `invalid_transition`.
  - When several requests make the same transition at once, exactly one answers 200, the rest answer 409, and only the winner sends the suspension email.
- **Blocked from the very next request after suspension:**
  - these console API calls answer 403 `workspace_suspended`, and no others do: object upload, object delete, permanent version delete, bulk delete, undo, bucket create, share-link mint, replica retry and console content download;
  - every S3 request with the workspace's keys answers 403 `AccountSuspended`. That includes DeleteObjects, and UploadPart and CompleteMultipartUpload on uploads opened before the suspension;
  - every share link of the workspace answers 403 `workspace_suspended`.
- **Paused, and resumed on reinstatement:** lifecycle sweeps and webhook deliveries. Replication continues.
- **Everything else keeps working for members**, including:
  - listing, search, the inspector and replica reads;
  - usage views and export;
  - lifecycle rule edits, retention and legal hold;
  - webhook management;
  - member changes and invites;
  - access-key create, rotate, disable and delete;
  - share-link revocation;
  - encryption rotation;
  - the audit trail;
  - the account page;
  - sign-in, sign-out and invite accept.
- **Open uploads.** Suspension never aborts open multipart uploads. After reinstatement, the same upload ID can receive parts and complete.
- **Reinstatement** restores everything from the next request. Links that expired in the meantime stay expired.

**Usage metering.**
- **Units.**
  - `request-units`: one per state-changing object write or delete, and one per successful object read. That covers PutObject, console upload, CompleteMultipartUpload, plain deletes that ended a version, permanent deletes, each DeleteObjects entry and each bulk-delete key that changed state, GetObject, console content downloads and share-link GETs.
  - `egress-gb`: the plaintext bytes sent in object read bodies, divided by 1,000,000,000.
  - `storage-gb-hours`: defined below.
- **Never metered:** refused, replayed and losing requests, no-op deletes, failed Completes, HEAD requests, undo restores, lifecycle expiry, encryption rotation and seeding.
- **Stored bytes per second.**
  - A bucket's stored bytes during a whole second are its `stored_bytes` after every change acknowledged at or before that second.
  - A change's second is its acknowledgement time truncated to the whole second.
  - Before a bucket's first object, its stored bytes are 0. Seeded objects count from the second they were written.
- **Rows and windows.**
  - Usage accrues into rows keyed by workspace, bucket, unit and window.
  - Windows are shared by every workspace and each lies within one UTC hour.
  - A window starts at the top of the UTC hour, or at the second of an earlier manual seal in the same hour. It ends at the top of the next hour, or at the second a manual sync seals it.
  - `window_start` is always this start instant.
  - `request-units` and `egress-gb` rows are created by the bucket's first usage of that unit in the window.
- **Storage amount.** For a bucket and window, `storage-gb-hours` is the sum of the bucket's stored bytes during every whole second from `window_start` (included) to `window_end` (excluded), divided by 3,600,000,000,000.
  - For example, a bucket placed in 2 regions holding one 1,000-byte version for 3,600 seconds accrues 0.000002.
  - The row is created when its window is sealed. Sealing covers every window that has ended since the bucket's last storage row, starting with the window in which the bucket was created.
- **Tracking ID.** A row's `tracking_id` is `fs-<workspace slug>-<bucket>-<unit>-<window start as YYYYMMDDTHHMMSSZ>`.
- **Amounts.**
  - Amounts are computed exactly, with no floating-point step, then rounded half up to 9 decimal places. Rows whose rounded amount is zero are not created.
  - Amounts are written as decimal strings with no exponent, no thousands separators, no trailing zeros after the point, no trailing point, and a leading `0` below 1. For example: `3`, `1.5`, `0.000002048`.
- **Usage view.**
  - `stored_bytes` is the sum of the workspace's bucket `stored_bytes`. `egress_bytes` and `request_units` are month-to-date totals. These three and `reserved_bytes` update with the change that causes them.
  - `storage_gb_hours` is the sum of the period's `storage-gb-hours` amounts.
  - `percent.storage` is `stored_bytes` ÷ included storage bytes × 100. `percent.egress` is `egress_bytes` ÷ included egress bytes × 100. Both are rounded half up to one decimal place and may exceed 100.

**Billing sync.**
- **Schedule.** A background sync runs every `FARSHORE_BILLING_SYNC_SECONDS` seconds (default 60). It seals windows that have ended and posts every sealed, unposted row. `POST /api/ops/billing/sync` seals every open window now and posts at once.
- **Exactly once.** Each row is posted once. It is marked posted only after Kill Bill accepts it, or reports its tracking ID as already recorded. Failed posts stay queued in Postgres and are retried on every sync, with no restart.
- **Billing state.**
  - `delayed`, when the most recent attempt to reach Kill Bill failed;
  - otherwise `pending`, when sealed rows are unposted;
  - otherwise `in_sync`.
- **`confirmed_through`** is the latest `window_end` among the workspace's posted rows this period.

**Threshold alerts.**
- The thresholds are 80% and 100% of the plan's included storage, judged on the usage view's `stored_bytes`, and 80% and 100% of included egress, judged on month-to-date egress bytes.
- The first change in a UTC calendar month that makes a metric reach or pass a threshold sends exactly one email for that threshold, metric and month to every owner. Crossing both thresholds at once sends both emails.
- Alerts never depend on Kill Bill.

### Services (DP-02, DP-25, DP-35, DP-37, DP-39, DP-40, DP-41, DP-45, DP-50, DP-51, DP-56, DP-61, DP-65, DP-67, DP-68, DP-69)

**Postgres** (`DATABASE_URL`).
- It holds every record named in the opening paragraph.
- The app applies its schema and seed data idempotently every time it starts serving, so it works on an empty database.
- When Postgres is unreachable, every endpoint except `/api/health` answers 503 `service_unavailable` (S3: `ServiceUnavailable`).

**MinIO** (`S3_*`).
- **Layout.** All bytes live in the bucket named by `S3_BUCKET`, and each Farshore region is a key namespace inside it.
  - A version's copy in a region is stored at `regions/<region id>/<bucket name>/<version id>` and holds only ciphertext.
  - Multipart parts are staged as ciphertext at `uploads/<upload id>/<part number>` until the upload completes or is aborted.
- **Removal.** A removed version leaves no object under any region namespace, and an aborted upload leaves nothing under its `uploads/` prefix.
- **When MinIO is unreachable:**
  - uploads and downloads answer 503: `storage_unavailable` on the console, or `ServiceUnavailable` on S3;
  - replicas in progress stay pending until MinIO returns;
  - byte removals are retried until they succeed;
  - a workspace key rotation is unaffected, because it touches only Postgres.

**Kill Bill** (`KILLBILL_*`).
- **Catalog.** At start, and on any sync while it is missing, the app uploads its catalog to the tenant if the tenant has none. The catalog holds the plans `farshore-sandbox-monthly` and `farshore-indie-monthly`, with consumable in-arrear usage for `storage-gb-hours`, `egress-gb` and `request-units`.
- **Accounts and subscriptions.** For each workspace the app creates:
  - one USD account named after the workspace, with external key `farshore-<workspace slug>`;
  - one subscription on the workspace's plan, with external key `farshore-<workspace slug>-plan`.
- **Usage records.** Each sealed row is posted as one usage record on that subscription:
  - the unit type is the row's unit;
  - the record date is the date of its window start;
  - the amount is the row's amount;
  - the tracking ID is its `tracking_id`.
- **When Kill Bill is unreachable**, nothing else fails:
  - account creation and rows queue;
  - the billing state becomes `delayed`;
  - `POST /api/ops/billing/sync` answers 202;
  - on recovery, the queue drains within one sync interval.

**Mailpit** (SMTP at `SMTP_HOST`:`SMTP_PORT`). Every message is sent from `MAIL_FROM`, which is `Farshore <no-reply@farshore.test>`. These are the only messages:

| Trigger | To | Subject | Body must contain |
|---|---|---|---|
| Invite created | the invited email | `You're invited to <workspace name> on Farshore` | the accept URL `<origin>/invite/<token>`, the role and the expiry time |
| Access key created | every owner of the workspace | `New access key <key id> in <workspace name>` | the key ID, description, permission and creator name; never the secret |
| Access key rotated | every owner of the workspace | `Access key <key id> rotated in <workspace name>` | the key ID and the time the previous secret stops working; never either secret |
| Two-step turned on | the user | `Two-step sign-in turned on for your Farshore account` | the time it was turned on; never the secret, a code or a recovery code |
| Two-step turned off | the user | `Two-step sign-in turned off for your Farshore account` | the time it was turned off; never a code |
| Password changed | the user | `Your Farshore password was changed` | the time of the change and the number of other sessions signed out; never a password |
| Storage or egress reaches a threshold | every owner | `<workspace name> has used <80 or 100>% of included <storage or egress>` | the metric's current bytes and the included bytes |
| Workspace suspended | every owner | `<workspace name> is suspended on Farshore` | the operator's reason |
| Webhook delivery became dead | every owner | `Webhook delivery failed in <workspace name>` | the endpoint URL's host, the event type, the sequence and the attempt count; never the signing secret or any part of the payload |

Rules for every email:
- **Never contains:** the key-rotated, two-step and password emails never contain the workspace slug, any region, or any object metadata or tags. No email ever contains a password, code, recovery code, secret or session token.
- **Byte counts** are whole numbers with comma thousands separators followed by the word "bytes", for example `800,000 bytes`.
- **Roles** are the lowercase words `owner`, `developer` or `viewer`. **Permissions** are `read` or `read-write`.
- **Times** are UTC, written `YYYY-MM-DD HH:MM:SS UTC`.
- **Stored text** (workspace names, key IDs, descriptions, creator names and the operator's reason) appears exactly as stored.
- **When Mailpit is unreachable**, messages wait in Postgres and are retried every 30 seconds. The triggering action still succeeds, and its success copy stays true because it never claims delivery.

### Seed data (DP-05, DP-21, DP-24, DP-41, DP-42, DP-59, DP-61, DP-62, DP-63, DP-69, DP-70)

Every seeded person, studio and business here is invented. Every seeded user's password is `farshore-demo-26`.

Regions:

| ID | Name | Continent label | Map position (longitude, latitude) |
|---|---|---|---|
| `cascade` | Cascade | North America West | −122, 47 |
| `meridian` | Meridian | Europe Central | 9, 50 |
| `monsoon` | Monsoon | Southeast Asia | 104, 1 |
| `pampas` | Pampas | South America East | −47, −23 |

All regions start online.

Plans. These are also the rows of `table "Pricing"`. One GB is 1,000,000,000 bytes.

| Plan ID | Name | Monthly price | Included storage | Included egress | Storage overage | Egress overage | Request units |
|---|---|---|---|---|---|---|---|
| `sandbox` | Sandbox | $0.00 | 1,000,000 bytes | 2,000,000 bytes | none | none | none |
| `indie` | Indie | $19.00 | 50,000,000,000 bytes | 100,000,000,000 bytes | $0.006 per GB-month, billed by the GB-hour | $0.010 per GB | $0.40 per million |

Workspaces, members and buckets:

| Workspace (slug) | Plan | Members (role) | Buckets (placement, origin first) |
|---|---|---|---|
| Lanternfish Games (`lanternfish`) | indie | Mara Okonkwo `mara@lanternfish.test` (owner); Theo Lindqvist `theo@lanternfish.test` (developer); Priya Raman `priya@lanternfish.test` (viewer) | `lanternfish-replays` (cascade, meridian, monsoon); `lanternfish-avatars` (meridian, cascade) |
| Paper Kite Studio (`paperkite`) | indie | Jun Arai `jun@paperkite.test` (owner); Sol Benitez `sol@paperkite.test` (developer) | `paperkite-replays` (monsoon, cascade) |
| Tidepool Tools (`tidepool`) | sandbox | Ada Nwosu `ada@tidepool.test` (owner) | `tidepool-builds` (cascade) |

Operator: Rui Castellan, `operator@farshore.test`.

Two-step sign-in:
- Jun Arai is enrolled.
  - Authenticator secret: `JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP`.
  - Recovery codes: `kite1-jun01`, `kite1-jun02`, `kite1-jun03`, `kite1-jun04`, `kite1-jun05`, `kite1-jun06`, `kite1-jun07`, `kite1-jun08`, `kite1-jun09` and `kite1-jun10`, all unused.
  - No code step has been accepted yet.
- Every other seeded user, the operator included, has two-step sign-in off.

Objects. Each is written once on serve if missing, encrypted like any upload. Its replicas then settle through the normal worker.

| Bucket | Key | Content type | Bytes | Tags |
|---|---|---|---|---|
| `lanternfish-replays` | `season-1/manifest.json` | `application/json` | exactly `{"season":1,"build":"1.4.2"}` | `env=prod`, `team=netcode` |
| `lanternfish-replays` | `season-1/replays/r-0001.bin` | `application/octet-stream` | 2,048 bytes, each zero | `env=qa` |
| `lanternfish-avatars` | `avatars/README.txt` | `text/plain` | `Avatar uploads land here.` followed by one newline | none |
| `paperkite-replays` | `season-1/manifest.json` | `application/json` | exactly `{"studio":"paperkite","season":1}` | `env=prod` |
| `tidepool-builds` | `builds/tidepool-0.9.0.txt` | `text/plain` | `tidepool build 0.9.0` followed by one newline | none |

At start:
- Every workspace is at workspace key generation 1, never rotated.
- Every bucket's lifecycle rules are off.
- Seeded objects count toward bucket and usage stored bytes.
- None of the following exist:
  - access keys, share links or invites;
  - sessions;
  - usage rows or sign-in failures;
  - webhook endpoints or bulk-delete batches;
  - retention dates or legal holds;
  - noncurrent versions;
  - audit entries. Seeding is never audited.

## Technical requirements

### Deployment (DP-01)

- The runtime is Node.js 22 with npm. Application source is TypeScript.
- `/app/run.json` has string fields `install`, `build` and `serve`, plus `"_schema":"run-manifest-v1"`. For example:

  ```json
  {"_schema":"run-manifest-v1","install":"npm ci","build":"npm run build","serve":"node dist/server.js"}
  ```

- `serve` binds `0.0.0.0` on port 4173, or on `APP_PUBLIC_PORT` when it is set.
- `GET /api/health` returns HTTP 200 with JSON `{"status":"ok"}` as soon as the server is listening, whatever the state of its dependencies.
- The app applies its schema, catalog and seed data idempotently on every serve.
- The grader installs, builds and serves a copy of `/app` from another directory, as an unprivileged user who cannot write to `/app`. The grader may also run further copies with their own empty database and bucket and with short timing values. The app keeps its server-local files, such as the sealing-key file, under its own working directory and never writes to an absolute `/app` path.

### Configuration and secrets (DP-02)

The app reads all of these from the environment at start. None is hard-coded, logged or sent to the browser.

| Concern | Variables |
|---|---|
| Postgres | `DATABASE_URL` |
| MinIO | `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_FORCE_PATH_STYLE`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` |
| Kill Bill | `KILLBILL_URL`, `KILLBILL_USERNAME`, `KILLBILL_PASSWORD`, `KILLBILL_API_KEY`, `KILLBILL_API_SECRET` |
| Mail | `SMTP_HOST`, `SMTP_PORT`, `MAIL_FROM` |
| Farshore | `APP_PUBLIC_PORT`; `FARSHORE_SECRET_KEY` (seals access-key, webhook and two-step secrets, and derives workspace keys) |
| Farshore timing, with defaults | `FARSHORE_INVITE_TTL_SECONDS` (259,200); `FARSHORE_SIGNIN_WINDOW_SECONDS` (900); `FARSHORE_BILLING_SYNC_SECONDS` (60); `FARSHORE_IDEMPOTENCY_TTL_SECONDS` (86,400); `FARSHORE_DAY_SECONDS` (86,400); `FARSHORE_LIFECYCLE_SWEEP_SECONDS` (60); `FARSHORE_WEBHOOK_BACKOFF_SECONDS` (10); `FARSHORE_UNDO_SECONDS` (30); `FARSHORE_TWO_STEP_PENDING_SECONDS` (300); `FARSHORE_STEP_UP_SECONDS` (300); `FARSHORE_SESSION_IDLE_SECONDS` (1,800); `FARSHORE_SESSION_LIFETIME_SECONDS` (43,200); `FARSHORE_KEY_ROTATION_OVERLAP_SECONDS` (86,400) |

The grader may set any timing variable to a short value, for example a 4-second lifecycle day, a 1-second sweep, a 20-second step-up confirmation, an 8-second key overlap or a 6-second session idle limit. Every rule that uses a timing variable follows its configured value.

When `FARSHORE_SECRET_KEY` is unset, the app generates one at first start and keeps it in a server-local file:
- only the app process can read the file;
- it is never served;
- the key is never stored in Postgres.

The key must stay the same across restarts, because every sealed secret and wrapped data key depends on it.

### Server boundary (DP-03, DP-15, DP-33, DP-48, DP-55, DP-60, DP-62, DP-68)

- **One origin.** Everything is served from one origin: the marketing page, console, account page, operator console, JSON API, S3 API and share links. The server sends no CORS headers and loads no fonts, scripts or styles from other origins.
- **Size limits.** Request sizes are limited by the JSON body limit from API and by the upload and DeleteObjects limits from Business rules. A larger request answers 413 before anything is stored.
- **What is never served.** The server never serves source files, the run manifest, environment files, lockfiles, the database, the sealing-key file, or any path outside its built assets and documented routes. Such paths answer 404. No response carries a framework or server banner header.
- **What responses never contain:**
  - service credentials;
  - access-key or webhook secrets after creation;
  - two-step secrets after setup;
  - recovery codes after enabling;
  - share-link tokens after creation;
  - session tokens in a body;
  - password hashes;
  - data keys or workspace keys.
- **Plaintext.** No object plaintext is ever written to MinIO.
- **Outbound requests.** The server makes outbound requests only to the configured services and to webhook endpoint URLs, and never follows a redirect from a webhook endpoint.
- **What leaves the server.** Object downloads carry the download headers. Share-link responses carry only the headers allowed in Business rules. Webhook bodies carry only the published event fields.
- **Gating.** Operator paths are gated before any lookup, and pending sessions reach only the code step, both as stated in API and Business rules. JSON bodies accept only their published fields.
- **Dependencies at boot.** When a dependency is unreachable at boot:
  - the server still starts, answers health and serves pages;
  - affected endpoints answer the 503 codes from Services;
  - each dependency is retried in the background, and the app recovers without a restart when it returns.

### Browser support and performance (DP-06, DP-23)

- Current Chromium, Firefox and WebKit, at 375x812, 768x1024 and 1280x800.
- On a local connection, the object table for a seeded bucket is usable within three seconds of navigation.
- A page of up to 1,000 rows renders within one second of its response arriving.
- One region's Replica Wake completes within about one and a quarter seconds of its wake line beginning.
- Operator figures reflect a server change within four seconds.

## Working rules

- IF-01: `/app/run.json` exists with exactly the string fields `install`, `build`, `serve` and `"_schema":"run-manifest-v1"`.
- IF-02: `/app/THIRD_PARTY_NOTICES.md` lists every shipped package by name, version and licence, plus each bundled font and icon set with its licence. Shipped packages means the production dependency tree reported by `npm ls --omit=dev --all --json`.
- IF-03: Every shipped package, font and icon set is licensed under MIT, ISC, BSD-2-Clause, BSD-3-Clause, Apache-2.0, 0BSD or OFL-1.1.
- IF-04: The app stores data only in the provided Postgres and MinIO. It uses no SQLite, Redis, embedded database or data files of its own, apart from the single sealing-key file allowed in Configuration and secrets.
- IF-05: The provided service definitions, their images and their dev credentials are left unchanged.
- IF-06: Application source is TypeScript. Plain JavaScript appears only in generated build output and in tool configuration files.

## Engineering standards

- Code is idiomatic TypeScript under strict compiler settings, with no `any` in application source.
- Names in the source use this brief's domain terms: workspace, member, bucket, placement, origin, region, version, noncurrent, replica, settle, supersede, lifecycle rule, retention, legal hold, lock, batch, undo, reservation, quota, share link, access key, prefix, rotation, overlap, webhook endpoint, event, delivery, sequence, chunk, checksum, session, pending session, two-step, recovery code, step-up confirmation, data key, workspace key generation, audit entry, chain, usage row, tracking ID, seal.
- Each domain rule is decided in exactly one place in the source, and every caller uses that decision. This covers:
  - each state transition: version, replica, access key, share link, invite, membership, workspace, region, batch, webhook endpoint, delivery, session, two-step and workspace key generation;
  - each limit check;
  - session validity;
  - the authenticator code check with its last accepted step;
  - the step-up check;
  - the choice of access-key secret during an overlap;
  - the prefix scope;
  - data-key wrapping and unwrapping;
  - the audit append and its hash;
  - CSV neutralisation;
  - the lock rule;
  - the lifecycle due and keep rule;
  - the quota check;
  - the ETag and checksum computations;
  - chunked-body decoding;
  - the webhook signature and delivery ordering;
  - the bucket counters;
  - the storage integral;
  - the billing state;
  - the error precedence;
  - the display formats.
- There is no abstraction with a single implementation and no wrapper that only forwards calls.
- There is no dead, commented-out or unreachable code, and no defensive check for a state this brief makes impossible.
- Every JSON error is built through the one error shape from API, and every S3 error through the one XML shape.
- There are no features, endpoints, screens or settings beyond this brief.
