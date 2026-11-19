# Tailboard — repository notes

Tailboard is the continuing-airworthiness compliance board for Fenwick Regional Airways:
one tracked thread per airworthiness directive and tail number, with revisions,
signatures, deferrals, legacy import, regulator packs and an append-only audit trail.

## Shape of the tree

```
run.json                 install / build / serve, "_schema":"run-manifest-v1"
requirements.txt         pg8000 (Postgres) and boto3 (MinIO) only
tailboard/
  serve.py               applies the schema and seed, then serves
  build.py               compiles sources, reaches no service
  api.py                 the one route table, precedence and idempotency
  web.py                 threaded HTTP server, static files, SSE responses
  db.py                  pg8000 pool and the `transaction()` helper
  schema.sql / seed.py   schema and the seeded fleet, people and four directives
  clock.py               the server clock (TAILBOARD_CLOCK_START) and base time zone
  errors.py              the single error shape
  storage.py mail.py pdf.py   MinIO, Mailpit and the plain-text pack PDF
  background.py          held notices, queued packs, pack re-render after an erasure
  domain/                one module per rule family (see below)
static/                  first-party ES modules, CSS and the IBM Plex woff2 files
```

## Where each rule lives (one place each)

| Rule | Module |
|---|---|
| Due instant, due-soon window, governing limit, rails, labels, count buckets | `domain/limits.py` |
| Stage transitions and every work action | `domain/work.py` |
| Effectivity, normalised directive numbers | `domain/directives.py` |
| Supersession, credit and pinning, withdrawal, snapshots | `domain/supersession.py` |
| Thread, cell and board shapes | `domain/threads.py` |
| Scope, succession, erasure | `domain/people.py` |
| Import normalisation and matching | `domain/imports.py` |
| CSV columns and the neutralisation rule | `domain/exportcsv.py` |
| Pack render, store, email, retry | `domain/packs.py` |
| Notice queue, rewrite and withdrawal | `domain/notices.py` |
| Field validation (every 422) | `domain/validate.py` |
| Audit entries | `domain/audit.py` |

## Things worth remembering

- The seeded board reads Open 20, Due soon 6, Overdue 5, Deferred 1, Complied 4. Any
  change to limits or counts should be checked against those figures first.
- A certified thread holds no work card: the countersignature clears the holder. A
  reopen hands the card back to the inspector who signed the voided inspection.
- A thread holds exactly one history entry per revision. Every entry but the last is
  frozen with its limits, wording and outcome; the last entry is live and follows the
  thread's limits in force, which is why a kept thread shows R1's rule under R2.
- `GET /api/board?as_of=R1` reads the snapshot stored at the moment R1 was superseded.
- Precedence is enforced in `api.dispatch`: 413/415/405/404 from the request line, then
  401, then the Origin check, then the idempotency key, then a replay, then 404 for the
  resource, then role and state checks inside the handler.
- The client never computes compliance state; it renders what `/api/board` and
  `/api/threads/{id}` report. The matrix is updated in place so an open dialog, its
  typed values, the focused element, its caret and the matrix scroll all survive a
  refetch.
- The browser plays a given splice at most once, keyed by directive and new tag.

## Running it here

```
sh -c "$(python3 -c "import json;print(json.load(open('run.json'))['install'])")"
.venv/bin/python -m tailboard.build
.venv/bin/python -m tailboard.serve     # needs the service environment variables
```

The services are `postgres:5432`, `minio:9000` and `mailpit:1025` (web UI on 8025).
A start against an empty database creates the schema, the seed and the bucket; a start
against seeded data changes nothing.
