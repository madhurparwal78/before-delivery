# Hourline Launch Hub — repository notes

A TypeScript web app for running seasonal fashion drops across six markets. One origin, one
Node process, Postgres plus MinIO for state, Kill Bill for invoices and Mailpit for email.

## Commands

| Task | Command |
|---|---|
| Install | `npm ci` |
| Build (server bundle, client bundle, stylesheet, fonts, icon sprite) | `npm run build` |
| Serve on `0.0.0.0:${APP_PUBLIC_PORT:-4173}` | `npm run start` |
| Type-check in strict mode | `npm run typecheck` |

`run.json` names these three commands for the harness.

## Layout

```
src/domain/     pure rules shared by the server and the browser (no I/O)
src/server/     http/ router + error ladder, api/ handlers, repo/ queries,
                views/ server-rendered screens, services/ providers, db/ schema + seed
src/client/     progressive enhancement: screens/, dial, calendar, dialogs, drafts, motion
src/styles/     the single stylesheet
scripts/build.mjs  esbuild for both bundles, plus font copying and the icon sprite
```

`src/domain` is imported by both bundles, so each rule lives in exactly one place: zone
conversion and the Copenhagen calendar (`time.ts`), go-live resolution (`golive.ts`), Night
(`night.ts`), the largest-remainder split (`split.ts`), line pricing and VAT (`pricing.ts`,
`money.ts`), the story allowlist (`story.ts`), preview link state (`previewstate.ts`), Danish
ordering (`danish.ts`), drop state and pieces left (`dropstate.ts`) and all published copy
(`copy.ts`).

## Things worth remembering

* **Instants are numbers.** Postgres columns are `bigint` milliseconds; the driver never parses
  dates. Wall-clock arithmetic goes through `wallToPseudo`/`resolveWall` in `src/domain/time.ts`,
  which handles spring-forward gaps (shift forward) and repeated autumn times (first occurrence).
* **Danish ordering needs the C collation.** `danishSortKey` maps letters onto ASCII so byte
  order is Danish order; every query that orders or compares `sort_key` must say
  `collate "C"`, otherwise the database's own collation reorders punctuation.
* **The error ladder is one function.** `src/server/index.ts` applies steps 1–3 (path, method,
  origin, rate limit); handlers apply steps 4–13 in order, which is why they look up records
  before checking roles and read the JSON body (`ctx.json()`) only after that.
* **Ids are readable and deterministic** (`drop:harbour-wool-edit`, `stk:oster-room`), so the
  seed is idempotent through `on conflict`.
* **The sweep** (`src/server/sweep.ts`) runs every 1.5 s behind `pg_try_advisory_lock`, so
  several app copies share one database safely. Hold offers are unique per
  `(drop_id, waitlist_member_id)` and restock runs unique per `(series_id, occurrence_ms)`.
* **Mail goes through the outbox** with a `dedupe_key`, so queueing is idempotent and delivery
  is exactly once (`for update skip locked`).
* **No LGPL.** `sharp` was removed because its libvips prebuilds are LGPL-3.0. Images are
  handled by `jpeg-js` (BSD-3-Clause) and `pngjs` (MIT), WebP by the container reader in
  `services/webp.ts`, and S3, SMTP and multipart by the small clients in `services/s3.ts`,
  `services/smtp.ts` and `http/multipart.ts`. Keep the dependency tree inside the IF-03
  allowlist and regenerate `THIRD_PARTY_NOTICES.md` after any dependency change.
* **Layouts switch at exactly 768 and 1024 px** and nowhere else. Grid children need
  `min-width: 0` or a wide table blows the column out; the turning dial pin rings are kept off
  the page by `overflow-x: clip` on `.planner__dial`.
* **Watch out for focus-driven scrolling.** The sticky-bar clearance in `src/client/main.ts`
  only runs when the bar is actually visible; running it on a hidden bar scrolled the page
  between mousedown and mouseup, which made the browser dispatch `click` on a common ancestor
  and silently dropped every button press.
