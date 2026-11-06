# Rungmark Rollout Ladder — repository notes

## What this is

One Go process that serves the reader pages, the rollout console and the JSON
API on port 4173 (`APP_PUBLIC_PORT` overrides it). PostgreSQL, named by
`DATABASE_URL`, is the only datastore.

## Layout

| File | Holds |
|---|---|
| `main.go` | app struct, routing, health, readiness loop |
| `db.go` | schema, seed-once, pool, unavailability test |
| `domain.go` | records, snapshot, gates, rung states, rates, evidence packs |
| `writes.go` | write pipeline, promotion, rollback, adverse event, settings, breach cascade |
| `validate.go` | strict body decoding, field limits, normalisation |
| `idempotency.go` | advisory locks and stored responses |
| `journey.go` | WF-01 to WF-04 traces |
| `exports.go` | `ladder-state.csv`, `evidence-pack.json`, `adverse-rates.txt` |
| `api.go`, `pages.go` | read routes and server-rendered pages |
| `web/templates`, `web/static` | embedded HTML, CSS and the console script |

## Rules that live in exactly one place

- Promotion gate DP-01 to DP-04: `snapshot.checkGates`. The standard promotion,
  the force-enable control (which passes `requireAttestation = false`) and the
  evidence pack's `recordBelowComplete` all reach it there.
- Rung state word: `snapshot.rungState`. Adverse rate: `snapshot.rateBP` and
  `snapshot.eventCount`. Breach cascade: `reassessFlag`. Rollback:
  `handleRollback`. Gaps and satisfied lists: `snapshot.evidencePackFor`.
  Attestation normalisation: `trimReference`. Event code normalisation:
  `normaliseEventCode`. Promotion code assignment: `nextPromotionCode`. CSV
  field writing: `csvField`.
- Nothing derived is stored as a column; every figure is computed at read time
  from one `snapshot`.

## Details worth remembering

- An interval of an active promotion includes the current minute, so an event
  recorded now counts at once; a demotion instant stays exclusive.
- Advisory locks are always taken in namespace order: idempotency key, flag,
  attestation reference, event code, journey. The promotion counter row lock is
  taken last, so codes stay gapless without deadlocks.
- A cohort PATCH locks every flag in ascending code order before reassessing.
- Journey steps are written in their own transaction, so a `409` refusal can
  record a step while changing no record. A `422` and a replay record nothing.
- Seed order for the console is `FLG-ADAPTIVE`, `FLG-TELEM`, `FLG-ALERT`
  (`seedFlagOrder`); the API lists sort by code.
- The three deliverables are written into the working directory on demand only;
  the shipped tree contains none of them.

## Checking the work

Build with `go build -o server .`, then `DATABASE_URL=... ./server`.
`GET /api/health` answers `200 {"status":"ok"}` once the seed is in place. On a
freshly seeded store the three renders must match the byte-exact files in the
brief.
