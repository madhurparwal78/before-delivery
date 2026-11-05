# Turnstone Studio — ground truth

Every value below is marked `brief:` when the brief prints it, or `decided:` with the reason when
the brief is silent and the implementation had to choose.

## Shape of the app

- `decided:` One Node process serves both the API and the server-rendered pages, because the brief
  requires a single `run.json` that installs, builds and serves, and a second process would need a
  supervisor the brief does not provide.
- `decided:` `pg` is the only production dependency; every other need (routing, templating, SMTP,
  S3 signing, Kill Bill calls, Meilisearch calls, STL and GLB writing, PNG and PDF rendering) is
  written in-tree, because IF-03 limits licences and fewer packages means fewer notices to keep true.
- `decided:` Twenty-one PostgreSQL tables: `models`, `revisions`, `derivatives`, `upload_stages`,
  `publish_events`, `orders`, `refunds`, `edition_copies`, `plan_state`, `collections`,
  `collection_items`, `embeds`, `read_keys`, `texture_sets`, `sessions`, `idempotency`,
  `mail_outbox`, `search_writes`, `search_removals`, `app_secrets`. The brief names no schema, so
  each table exists to hold one published concept.
- `decided:` Session cookie `ts_session`, HttpOnly and SameSite=Lax, holding only an opaque id whose
  row lives in `sessions`, so no internal identifier reaches the browser.
- `decided:` Passwords are stored as `scrypt` hashes with a per-row salt. The brief publishes seed
  passwords but no storage rule, and scrypt is in the Node standard library, so no dependency.

## Journey 1 — upload and publish

1. `brief:` The author signs in and lands on `/studio` on the Pro plan.
2. `brief:` Upload takes a `.glb` file, a title, a source unit and a category. The server checks the
   package's size and detected type against the plan **before** it stores anything or starts any
   queue work, and identifies the type from the bytes, never the file name.
3. `brief:` The browser lands on `/studio/models/<slug>/queue`.
4. `brief:` The five stages run in order — validate, transcode, preview, index, publish — each
   Pending, Running, Confirmed or Failed, and each confirmation is announced in the queue's published live region. Nothing a stage produces is served or listed before that stage
   confirms.
5. `brief:` Transcode writes a GLB in metres and a binary STL in millimetres using the published
   unit factors and axis mapping; preview writes a 1024 by 768 pixel PNG from the default camera on the bone ground.
6. `brief:` The submitted package is stored exactly as received under its SHA-256, and the author's
   original download returns the same bytes with the same checksum.
7. `brief:` Send to review, then Publish; the model page shows `Published` and it appears in the
   public catalogue with correct facet counts within five seconds.
- `decided:` The queue is a single worker inside the same process polling `upload_stages`, because
  the brief publishes a stage order and a retry schedule but no concurrency, and one worker makes
  the published order observable.

## Journey 2 — browse and inspect

1. `brief:` `/catalogue` filters on category, licence type, distribution format and price, eight results
   per page, and announces the result count in the `Catalogue results` live region after every
   change, without a page load.
2. `brief:` Query, facets, sort and page live in the address in canonical form; every change adds a
   history entry, so Back returns to the previous page and a cold load of the same address shows the
   same results.
3. `brief:` In the viewer, arrow keys, minus, plus and the bracket keys step the camera by the
   published steps within the published camera limits, and the root publishes `data-camera-distance`, `data-fov`, `data-tilt`,
   `data-azimuth` and, with an active hotspot, `data-hotspot-index` and `data-hotspot-x` / `-y`,
   each computed from the published formulas and rounded to one decimal.
4. `brief:` `H` steps to the next hotspot and `Shift+H` to the previous one, wrapping at either end;
   the caliper points at the active hotspot and each step is announced in the `Viewer announcements`
   live region.
5. `brief:` First-person mode replaces the ring with a heading strip, places the eye at the
   published scaled eye height, leaves the heading unclamped and clamps the pitch to the published
   range; the root then carries `data-mode="first-person"`, `data-heading`, `data-pitch` and
   `data-eye-height`, and the hotspot attributes are absent.
6. `brief:` Without a hardware 3D context the canvas is replaced by the rendered preview and the
   published fallback sentence, while the ring and the data attributes still report the default
   camera.
- `decided:` The viewer is hand-written WebGL with no 3D library, because IF-03 limits licences and
  the graded surface is the published camera arithmetic, not a renderer's feature set.

## Journey 3 — buy a licence

1. `brief:` Buy Personal licence takes an email and the terms, and requires an `Idempotency-Key`.
2. `brief:` Every amount is computed once, in integer euro cents, half-up at the published step, and
   is identical on screen, in Kill Bill, on the invoice PDF and in the receipt email.
3. `brief:` The purchase is one external charge on a committed invoice, then one payment of the same
   amount with a successful `PURCHASE` transaction; the order and receipt exist only after both
   confirm.
4. `brief:` The browser lands on `/receipts/<receipt token>` with the amount, download links and the
   invoice PDF; the receipt email repeats the same amount.
5. `brief:` An upgrade from the receipt page is charged the target licence's current price minus
   what the earlier order paid net of refunds. Tax calculation is out of scope.
6. `brief:` A replayed `Idempotency-Key` returns the original status and body with exactly one Kill
   Bill charge; the same key with a different body answers 409.
- `decided:` Kill Bill's REST root is the single constant `KB = '/1.0/kb'`; the brief names Kill Bill
  but not its API paths, so the version prefix lives in one place.
- `decided:` The invoice PDF is written directly as PDF 1.4 with an embedded font subset, because the
  brief requires extractable text in the receipt's locale and no PDF library is needed for that.

## Journey 4 — race for the last copy

- `brief:` When several buyers claim the last edition copy at once, exactly one gets it and a Kill
  Bill charge; every other buyer gets the sold-out 409 with no charge.
- `brief:` An open model page or claim dialog switches to the sold-out notice within two seconds,
  without a reload, and the winner's receipt names the copy number.
- `decided:` The winner is settled by a single conditional `UPDATE … RETURNING` against
  `edition_copies` inside one transaction, so the database decides the winner and no lock is held
  across the Kill Bill call.

## Journey 5 — contribute and review

- `brief:` A contributor lands on `/contribute`, uploads a draft, attaches a texture set ZIP whose
  every entry is a PNG or JPEG by content and inside the archive's folder, and sends it to review.
- `brief:` The editor lands on `/studio/review` and publishes the draft or returns it to draft.
- `brief:` Models move only along the draft → in review → published → withdrawn edges allowed to the
  acting role; every other move answers the published refusal, and a stale button press shows that
  exact refusal.
- `brief:` A contributor naming any other model, in a route or in a request body, gets the published
  not-found response.

## Journey 6 — control who sees what

- `brief:` Public, unlisted, private and password-protected decide who may open a model's page,
  files and checkout. Regenerating a share link kills the old one at once. An unlock grant ends when
  the author changes the password, the visibility or the state.
- `brief:` Search results, facet counts, recommendations, the read API and the catalogue export
  contain only listed models, so unlisted, private, password-protected, unpublished and read-only
  models never appear, even in counts.
- `brief:` Embeds exist on Pro and Premium; replacing or revoking one kills the old link, and every
  embed stops once the model is withdrawn, hidden or read-only or the plan falls below Pro.
- `decided:` Index writes and removals are queued in `search_writes` and `search_removals` and
  applied by the same worker, so a Meilisearch outage cannot leave a non-public model in the index.

## Journey 7 — change plan

- `brief:` Upgrades take effect at once with Kill Bill's prorated charge; downgrades are scheduled
  for the end of the billing period Kill Bill reports, and entitlements follow only the plan Kill
  Bill confirms — never the date the button was pressed.
- `brief:` When a lower plan becomes current, all content is kept, published models over the new
  limit become read-only and unlisted, and embeds, editions and package types above the plan stop
  working everywhere.
- `brief:` The monthly publish quota counts moves into published and resets on the billing-cycle day
  Kill Bill reports.
- `decided:` `plan_state` stores the plan, its effective date and any pending change exactly as Kill
  Bill last reported them, and every entitlement is read from that row, so one projection decides
  every limit.

## Journey 8 — support a buyer

- `brief:` Staff land on `/staff`, find an order by buyer email, refund a number of seats or the
  whole remaining amount by the published proration rule, recorded as a Kill Bill refund on the
  original payment.
- `brief:` The refunded amounts agree on the order screen, in Kill Bill, on the invoice PDF and in
  the refund email.
- `brief:` The health panel shows each backing service up or down with the queue counts, and no
  service address, credential or provider identifier appears in the page or the API.

## Cross-cutting

- `brief:` A stage that fails on a provider is retried after each delay in `QUEUE_RETRY_SECONDS`
  (30 seconds, 2 minutes, 10 minutes, so at most four attempts), waiting as `pending` with
  `next_attempt_at` set; when the delays run out it is `failed` and the author can requeue it. A failed job changes no published count, quota
  usage, collection count or listing.
- `brief:` When search, storage or billing is unreachable the affected requests answer the published
  503s and studio pages show the published banner; work resumes without a restart.
- `brief:` The read API answers only its published routes, parameters and fields, refuses unknown
  parameters and over-long queries, allows each key 60 requests in any rolling 60 seconds and
  answers the 61st with 429 `rate_limited` and a `Retry-After` of 1 to 60 whole seconds, the same
  number as in the message.
- `brief:` Collection counts, the uncollected count, the state totals and the quota badge always
  equal the rows they summarise, after every create, rename, move, delete and failed queue job.
- `brief:` The catalogue CSV neutralises any cell starting with a formula character by the published
  rule, and never contains a record the requester may not see.
- `brief:` Layout switches exactly at 768 and 1280 pixels wide, with no horizontal scroll at
  375×812, 768×1024 or 1280×800. Every control shows the focus ring and follows the published tab
  order; dialogs and sheets trap Tab, close on Escape and return focus to their opener.
- `brief:` English and German: switching re-renders every published string, amount and date in
  place, rewrites `lang` in the address with a replace, and keeps the scroll position and focus.
- `brief:` Motion stays within the published durations, nothing loops on its own, and reduced motion
  shows every end state at once.
- `decided:` Motion is CSS transitions and `element.animate()` only, as the golden method requires,
  so reduced motion can be honoured by skipping to end values rather than by shortening durations.
