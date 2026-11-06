# TRUTH — Farshore Buckets

The brief made concrete. `brief: <section>` values are copied verbatim; `decided: <why>` fills a
silence in the brief's intent.

## Journeys

1. **Create a placed bucket and upload** (brief: Journeys 1). Theo at `/signin` mistypes → `alert`
   "Email or password is incorrect." (failure counted for theo@lanternfish.test); signs in → `/console`
   (first bucket by name). A script POSTs `{"name","placement","workspace","object_count"}` → 422 with
   `errors.workspace` and `errors.object_count` "This field can't be set.", nothing created. In the
   console: `button "New bucket"` → `dialog "New bucket"`, name, Origin Cascade, replicas Meridian +
   Monsoon → `status "Bucket status"` "Created <name> in Cascade, Meridian, Monsoon."; rail link shows
   "<name>" and "Cascade, Meridian, Monsoon". Drag two files onto `table "Objects"` → dashed amber
   outline + "Drop to upload to <bucket>/" → `dialog "Upload"` lists files and byte sizes → Start upload →
   each file PUT with its own Idempotency-Key → "Stored <key> as version <short>. Copies pending in 2
   regions."; rows show `n/3`. Provider: bytes at MinIO `regions/cascade/<bucket>/<version>`, copies to
   meridian and monsoon; Postgres versions + replicas; one request unit per upload; one
   `object.created` event per matching endpoint.
2. **Release readiness** (brief: Journeys 2). Inspector on `season-1/manifest.json` reads "Ready to ship:
   all 3 regions hold version <short>."; Upload new version with "Only overwrite the version I opened"
   sends `If-Match` = opened ETag → new version; pins reset to pending ring, then settle one wake at a
   time; readiness "Waiting on 2 of 3 regions." → "Ready to ship: all 3 regions hold version <new>.". A
   teammate's `If-Match` old ETag → 412. object_count unchanged; stored_bytes + new size × 3.
3. **CI build** (brief: Journeys 3). Read-write key scoped to the bucket; CreateMultipartUpload with
   `x-amz-checksum-algorithm: CRC32`; parts as `STREAMING-UNSIGNED-PAYLOAD-TRAILER` with CRC32 trailer;
   Complete with `If-None-Match: *`; retried Complete → same ETag and version ID (replay before
   conditions). ListObjectsV2 `delimiter=/`, `max-keys=1`, `encoding-type=url` returns every key and
   folder once. One version, one request unit, one event.
4. **Viewer browse + share link** (brief: Journeys 4). Priya applies prefix `season-1/` + tag filter
   `env=qa` (URL `?prefix=…&tag_filter=…`), opens folder and `r-0001.bin` (`object=` param via
   replaceState). Copied URL in a fresh session → `/signin?next=…` → after sign-in the exact URL, same
   rows, inspector open. Back returns to the earlier page. No upload/overwrite/delete/selection controls;
   server answers 403 `forbidden`. Share link 1 hour → "Link ready. It expires <time>."
5. **Link recipient** (brief: Journeys 5). `/l/<token>` → 200 attachment with only Content-Type,
   Content-Length, ETag, Last-Modified, the four download headers and transport headers. After revoke →
   410 "This link was revoked." page naming nothing; `/l/<token>/sibling` → 404.
6. **Owner** (brief: Journeys 6). Invite viewer → Mailpit "You're invited to Lanternfish Games on
   Farshore" with `<origin>/invite/<token>`, role and expiry. Demote → next upload 403; remove → links
   revoked in the same change. Key create → secret once in the dialog, owners get "New access key <id> in
   Lanternfish Games" without the secret. Usage shows only Lanternfish buckets; CSV
   `farshore-lanternfish-YYYY-MM.csv`; `status "Billing sync"` reflects Kill Bill confirmation.
7. **Operator** (brief: Journeys 7). `/ops` Region backlog; Take Pampas offline → copies fail
   `region_offline`; Bring online → requeued once and settle within 10 s. Run lifecycle now twice → due
   versions expire once (row locks). Suspend → owners emailed once. Kill Bill outage → rows `queued`,
   state `delayed`; next successful sync drains them, no duplicates (tracking ID), state `in_sync`.
8. **Lifecycle/retention** (brief: Journeys 8). Rules 1/1/1; superseded versions expire 1 lifecycle day
   after noncurrent_since except the newest noncurrent and locked ones; bytes leave every region,
   links revoked, replica rows deleted. Retention refuses permanent delete until the retain-until second.
9. **Webhook** (brief: Journeys 9). Endpoint with secret shown once; deliveries signed
   `t=<unix>,v1=hex(HMAC-SHA256(secret, "<t>.<body>"))`, one in flight per endpoint, ascending sequence;
   six failures (backoff base × 2^(k−1)) → dead + one email per owner; Redeliver → attempts reset.
10. **Bulk delete with undo** (brief: Journeys 10). Batch of three → "Deleted 3 objects. Undo until
    <time>."; CI re-upload of one; Undo → "Restored 2 objects. 1 kept their newer version."
11. **Sandbox quota** (brief: Journeys 11). Stored + reserved never exceeds 1,000,000 bytes; refusals
    409 `quota_exceeded` / 403 `QuotaExceeded`; reservations released on completion, abort, lifecycle abort.
12. **Jun's two-step sign-in and step-up** (brief: Journeys 12). Deep link → `/signin?next=<link>`; right
    password → 202, pending `fs_session`; the panel shows "Enter the code from your authenticator app" and
    "Codes change every 30 seconds."; `/api/w/...`, `/api/me`, `/api/ops/...` answer 401 `two_step_required`;
    `/account`, `/ops`, `/console/...` redirect to `/signin` showing the code step. Wrong code → `alert`
    "That code didn't work."; right code → new token, lands on the link with the inspector open; the same
    step is refused again (last accepted step). Creating a `builds/` key → 403 `step_up_required` →
    `dialog "Confirm it's you"` → code → the create is resent once. Rotate → new secret once; row reads
    "Previous secret works until <time>" until the server stops reporting it; second rotation 409
    `rotation_in_progress`; owners get "Access key <id> rotated in Paper Kite Studio" without secrets.
13. **Sol locks down the account** (brief: Journeys 13). `/account`: Turn on → setup key → code →
    `list "Recovery codes"` (10 × `xxxxx-xxxxx`), "Two-step sign-in is on. …" once. Sessions table marks
    "This session"; sign out one → "Session signed out."; Sign out other sessions → "Signed out <n other
    session(s)>." (pending included). Password change → "Password changed. <n other session(s)> signed out.",
    every other session (pending too) refused next request; emails hold no code or password.
14. **Workspace key rotation and audit** (brief: Journeys 14). Security → Rotate workspace key → generation
    +1, "Workspace key rotated to generation <n>. <m> data keys re-wrapped."; MinIO objects untouched (no
    rewrite), downloads byte-identical with the same ETag and checksum. Audit trail filtered by
    `permission.denied` + Priya, Older entries pushes `cursor`/`prev=`; copied URL reopens the same page;
    Verify → "Chain verified: <n> entries intact."; CSV neutralises `=HYPERLINK(...)` inside quotes.

## Decisions where the brief is silent

| Topic | Value | Source |
|---|---|---|
| Retention time earlier than retention in force | any readable earlier time answers 409 `retention_locked`, even when it is also in the past or the body has other field errors; otherwise validation (422) applies | brief: Error precedence (step 10.3 `retention_locked` before step 13 validation) |
| Member view of suspension | the console page shell carries the caller's suspended workspace slugs (`<body data-suspended>`); the session body keeps exactly its published fields | decided: the banner must show on every console page of a suspended workspace, and no published body may grow |
| Open usage rows | `window_end` reports the planned end (next top of the hour) in JSON and CSV | decided: CSV columns are all times |
| Version IDs | 32 lowercase hex characters | decided: opaque, ≤64 |
| Upload IDs, link/batch/endpoint IDs | random base64url / hex | decided |
| Runtime packages | bundled into `dist/` by esbuild; production tree empty | decided: npm lists pg's unmet optional peer without a version |
| Console sub-pages | `/console/<ws>/_links`, `_team`, `_keys`, `_usage`, `_webhooks`, `_webhooks/<id>/deliveries` | brief: none may be a valid bucket name |
| Session device | the User-Agent cut to 80 grapheme clusters, else "Unknown device" | brief: Sessions ("first 80 characters"; Character counting) |
| Pending session lifetime | ends at the first of `pending_until` (password second + `FARSHORE_TWO_STEP_PENDING_SECONDS`), the idle limit (`last_seen_at` + `FARSHORE_SESSION_IDLE_SECONDS`) and the absolute limit | brief: Sessions ("its idle limit"; "its absolute limit") and Pending sessions ("ends `FARSHORE_TWO_STEP_PENDING_SECONDS` after the password step") |
| Step-up for legal hold | asked only when turning an existing hold off | brief: Step-up ("turning a legal hold off"); setting the value it already has is a no-op |
| Encryption segments | 64 KiB plaintext segments, each `nonce(12) ‖ ciphertext ‖ tag(16)`; an empty part is one empty segment; a multipart version is its parts' ciphertexts concatenated under the upload's data key | brief: Encryption at rest ("segment layout is yours to choose") |
| Workspace key rotation | bump the generation under the workspace row lock every wrap shares, then re-wrap stale rows in batches | brief: "keys written while the rotation runs" are re-wrapped too |
| Audit cursors | the seq of the last entry shown, decimal | decided: opaque enough, tamper → 422 "This page link is no longer valid." |
| Kill Bill catalog races | several processes sharing one tenant may upload at once; a catalog Kill Bill can no longer read is deleted and uploaded once more | decided: the outage copies share the main tenant |
| Mail Date header | left to Mailpit (received time) | decided: messages sent within one second keep their order |
| SigV4 scope terminator | one constant in `sigv4.ts`, shared by inbound verification and outbound MinIO signing | decided: the brief requires SigV4 ("Signed S3 access"); the terminator is fixed by the AWS specification |
| Objects table beside the inspector | at 1280x800 with the inspector open, all five columns stay (Key, Size, Last modified, Regions, ETag); the table narrows inside its own frame (cell padding tightens to 8 px beside the inspector) with no sideways scroll; every header stays on one line from 768 up, and beside the inspector the Last modified cell breaks between date and time; at every width from 768 the Key column takes the spare width and the other columns size to their content | decided: brief: Screens and layout ("the table narrows to make room for it"; nothing scrolls sideways) |
| Share-link revocation causes | a plain delete, creator removal or version removal revokes only links still active; an already expired link stays expired | brief: Share links ("active → revoked") |
| Console action results | `status "Bucket status"` and `status "Share status"` sit in a reserved line under the breadcrumb on the object view and above the content on every other page; errors read in ink behind the circle-x glyph | decided: brief: Visual design (errors use ink with a glyph and words); a message never moves the heading |
| Pricing below 1024 | one card per plan with the same columns as label–value pairs, two side by side from 768, stacked below 768 | decided: brief: Screens and layout (cards at 375); seven columns cannot be read at 768 |
| Manual billing sync | waits for a row another process is posting, so its answer counts every row it could try | decided: brief: Billing sync ("seals every open window now and posts at once") |
| Kill Bill prices | Indie: storage-gb-hours 0.0000082, egress-gb 0.010, request-units 0.0000004 USD; Sandbox 0 | decided from the pricing table |

## Palette, type, space, layout, motion

See `DESIGN.md` (single source): ground `#0E1116`, surface `#171B22`, surface-2 `#1F242D`, rule
`#2A3039`, ink `#EDE4D3`, muted `#8E959F`, accent `#E8A33D`. Space Grotesk 500/700, IBM Plex Sans
400/500/600 at 15px, JetBrains Mono 400/500 tabular. Scale ×1.25. 44px targets. Breakpoints 1280 /
768 / 375. Motion table: hover 100 ms, press 120 ms, drawer in 330 / out 200 ms, dialog 200 ms,
wake line 330 + fill 200 + count 570 ms, all ease-out `cubic-bezier(0.16,1,0.3,1)`; reduced motion →
instant, wake final state in one frame.

## States per async action

Copied verbatim from brief: Feedback states (sign in, create bucket, upload, object list, bulk delete,
lifecycle, versions, replica announcements, release readiness, share link, link recipient pages,
invite, team, accept invite, access keys, webhooks, billing sync, suspension banner, operator).

## Media and licences

Fonts (Fontsource 5.3.0, OFL-1.1), Lucide 1.64.0 path data (ISC), land mask from Natural Earth 110 m
(public domain), all drawn as SVG. No photos or binary images.
