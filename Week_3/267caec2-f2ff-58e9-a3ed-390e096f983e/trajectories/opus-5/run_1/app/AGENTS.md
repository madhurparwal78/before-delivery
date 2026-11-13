# Cutline Jury Desk — repository notes

A juried web-design prize desk: studios pay entry fees and upload case studies, jurors score blind
entries, the program director screens, runs rounds and publishes results behind an embargo, and the
public watches a leaderboard and gallery.

## Layout

```
run.json              install / build / serve manifest (run-manifest-v1)
scripts/build.mjs     tsc for the server, esbuild for the client, font + icon copy
scripts/*.mjs         developer verification scripts (see "Verifying")
src/server/           Node HTTP server, no framework
  config.ts           every service URL and credential, read from the environment only
  schema.sql          applied idempotently on every boot
  db.ts               pg pool, transactions, advisory locks, id minting
  copy.ts             the single source of every error code + message in the brief
  data.ts             shared loaders, panel maths, standings
  view.ts             role projections (Entry, EntryDirector, Program, Receipt, Round)
  domain/             time + labels, fees, entry/round guards, scoring, ranking, images
  providers/          Kill Bill, MinIO (hand-rolled SigV4), Mailpit (hand-rolled SMTP)
  routes/             accounts, programs, entries, director, juror, public
  workers/            queued mail sender, jury-packet rewriter, embargo, seeded artwork
src/client/           Preact SPA (no router library)
  shuffle.tsx         The Cut Shuffle ranked table (FLIP + score roll + marker swap)
  shell.tsx           sticky band context name and countdown
  pages/              one file per screen group
```

## Decisions worth remembering

- **No framework, few dependencies.** The S3 client and the SMTP client are written here so the
  shipped licence list stays inside the allowed set (`@aws-sdk` is huge, `nodemailer` is MIT-0).
- **Images** are decoded and re-encoded with `pngjs` / `jpeg-js`; only server bytes are stored, under
  `entries/<entry id>/<asset id>.<ext>`. `sharp` is avoided because its libvips binaries are LGPL.
- **Kill Bill** accounts carry the `AUTO_PAY_OFF` control tag so the desk, not Kill Bill, creates the
  PURCHASE with external key `cutline-entry-<entry id>`.
- **Refunds use `POST /1.0/kb/invoicePayments/{paymentId}/refunds` with `isAdjusted`** so the REFUND
  transaction and the invoice write-off happen together. A plain refund leaves an account credit that
  silently settles the studio's next invoice (Kill Bill then answers `204` and no PURCHASE exists).
- **`entries.charge_attempts`** counts reversed charges. Kill Bill rejects a repeated payment external
  key, so a submit retried after a receipt-mail failure suffixes the key with the attempt number.
- **Locks.** `withLock(id)` takes a Postgres advisory lock. Submit and withdraw lock the entry; ballot
  submit and round close lock the round. That settles the races in DP-10 and DP-22.
- **Emails** other than the receipt are queued in Postgres inside the same transaction as the action
  and delivered by the worker loop, so Mailpit being down never changes a response.
- **The cut rule** is an absolutely positioned element over the table, not a table row, so the row
  count stays equal to the entry count while rows travel across it.

## Verifying

Start the services, then:

```
npm run build
node scripts/reset.mjs      # wipe Postgres + Mailpit, then restart to reseed
./scripts/dev.sh            # rebuild server, restart, print health
node scripts/smoke.mjs      # API journeys end to end
node scripts/rules.mjs      # scoring, conflicts, recusal, packets, audit
node scripts/outage.mjs     # dead Kill Bill / MinIO / Mailpit / Postgres instances
node scripts/journey.mjs    # browser journeys (needs Playwright chromium)
node scripts/ui-check.mjs   # layout, roles, responsiveness
node scripts/a11y.mjs       # contrast, keyboard, reduced motion
```

`scripts/journey.mjs` moves the open program's deadline into the past, so run `scripts/reset.mjs`
before any script that needs an open program. Each role needs its own browser context; sessions share
one cookie jar otherwise.

`ps` and `pkill` are not installed in this container — `scripts/dev.sh` finds the server through
`/proc/*/cmdline`.
