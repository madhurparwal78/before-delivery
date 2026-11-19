# Pinbyte Switchyard — repository notes

Visual automation builder for multi-member workspaces: a step canvas, numbered published
versions, live run watching, cancels and replays. One TypeScript server on Node 22 runs the
HTTP API, the app shell and the automation engine. Postgres holds all state, MinIO holds
exports and imports, Mailpit receives real SMTP.

## Layout

```
run.json                 install / build / serve manifest (run-manifest-v1)
scripts/build-client.mjs esbuild bundle + font copy + client typecheck
scripts/notices.mjs      regenerates THIRD_PARTY_NOTICES.md
src/shared/types.ts      domain types shared by server and browser
src/server/              API, engine, services (compiled to dist/ by tsc)
src/client/              browser app (bundled to public/assets/app.js|css)
public/assets/           built assets and bundled woff2 fonts (build output)
```

## Where each domain rule lives (one place each)

| Rule | File |
|---|---|
| Run and step status transitions, retry rule, step limit | `src/server/engine/rules.ts` |
| Run execution (depth-first walk, waits, retries, loops, replays) | `src/server/engine/machine.ts` |
| Step effects (tables, email, webhook calls) | `src/server/engine/effects.ts` |
| Template syntax and typing | `src/server/engine/template.ts` |
| Condition comparison | `src/server/engine/conditions.ts` |
| Workspace clock and zone maths | `src/server/time.ts` |
| Schedule parsing and firing instants | `src/server/schedule.ts` + `src/server/scheduler.ts` |
| Version binding | `src/server/triggers.ts` (`liveVersion`) |
| Publish and edge refusals | `src/server/automations.ts` |
| Edit hold | `src/server/routes/automations.ts` (`updateStep`) |
| Idempotency window | `src/server/routes/public.ts` (`hook`) |
| Role checks, origin check, body limits | `src/server/http.ts` |
| Error shape and every refusal message | `src/server/errors.ts` |

## Things worth remembering

- The engine is a persisted stack machine: `runs.cursor` holds the frame stack, so waits,
  retries and restarts resume exactly where they left off (`Machine.load` then `drive`).
- Timers and schedule claims carry `owner_port`; an instance only fires what it owns, which
  is what the grading clock route waits for (`fireDue`, serialised by one promise chain).
- All run, step and timer timestamps are workspace-clock instants (real time plus the
  workspace offset), so the browser only ever formats what the server sent.
- The browser keeps no timers for state: it listens on `/api/workspaces/<ws>/events` and
  refetches after a push or a reconnect.
- Editor canvas interaction tracks its own `focusState` and queues mutations in one promise
  chain; repaints restore focus, which keeps fast keyboard sequences deterministic.
- Live regions must never be `display:none` when empty, or `getByRole` cannot see them.
- Inline-block runs break `innerText`; the version numeral uses inline digits so it reads
  `v2` in one line.
- `status "Notices"` is a substring of `status "Draft notices"`, so locators need `exact`.
- Only `pg` ships at runtime (MIT); SMTP and S3 SigV4 are implemented in
  `src/server/smtp.ts` and `src/server/storage.ts` to keep the licence list clean.

## Checks used while building

Ad-hoc suites were run against a live server with Playwright and `fetch` (not committed):
grading setup, error shapes, draft and publish refusals, webhooks and idempotency,
schedules across both daylight-saving days, waits, retries, step limit, replays,
export/import byte equality, outage instances on ports 4174 and 4175, restart survival,
and browser journeys for keyboard building, co-editing, drain and the phone layout.
