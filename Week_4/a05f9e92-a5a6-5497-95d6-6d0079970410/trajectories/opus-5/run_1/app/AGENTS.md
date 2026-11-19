# Switchyard — repository notes

Service desk for a one-person IT provider running one organisation's internal
IT. Node 22 + TypeScript on the server, TypeScript in the browser, Postgres and
MinIO only. One process serves the interface, the JSON API and the live channel
on port 4173 (or `APP_PUBLIC_PORT`).

## Running it

```
npm ci          # install
npm run build   # compiles the server with tsc, bundles the browser with esbuild, copies the fonts
npm start       # or: node dist/server.js
```

`/app/run.json` is the manifest the harness reads. The schema is applied
idempotently on every serve and the seed is inserted only when the database is
empty.

Useful during development:

```
npx tsc -p tsconfig.json --noEmit      # type-check the server
npx tsc -p tsconfig.web.json           # type-check the browser code
```

To reset to seed state: `POST /api/grading/reset` with header
`X-Grading-Key: switchyard-grading-local`.

There is no `ps` or `pkill` in this container. To stop the server:

```
for p in /proc/[0-9]*; do grep -qa "dist/server.js" $p/cmdline 2>/dev/null && kill ${p#/proc/}; done
```

## Where each domain rule is decided

Each rule lives in exactly one place; every surface calls that one decision.

| Rule | Module |
|---|---|
| Expression grammar, interpretation, column errors | `src/expr/{lexer,parser,ast,interpret}.ts` |
| Filter text subset, canonical form, builder round-trip | `src/expr/filter.ts` |
| Zone arithmetic, daylight-saving gap and overlap | `src/domain/zone.ts` |
| Business schedules, open windows, elapsed business time | `src/domain/schedule.ts` |
| Transition tables and their messages | `src/domain/transitions.ts` |
| Field catalogue, labels, table order | `src/domain/fields.ts` |
| Priority matrix and the business-critical bump | `src/domain/priority.ts` |
| SLA maths, thresholds, countdown copy | `src/domain/sla.ts` |
| CI classes, relationships, map layout, effective status, impact, relay panels | `src/domain/cmdb.ts` |
| Change risk score and band | `src/domain/risk.ts` |
| Quorum rules and tally copy | `src/domain/quorum.ts` |
| Rotations, overrides, escalation timers | `src/domain/oncall.ts` |
| Access baseline and rule order | `src/domain/access.ts` |
| Assignment rules and round robin | `src/domain/assignment.ts` |
| Knowledge tokens and ranking | `src/domain/knowledge.ts` |
| Inbox events, texts, digest | `src/domain/inbox.ts` |
| Roles, precedence, role-to-screen table | `src/domain/roles.ts` (mirrored for the browser in `web/lib/shell.ts`) |

Services compose those decisions: `src/services/recordops.ts` is the save
pipeline (versions, policies, rules, SLA, assignment, activity, audit),
`hooks.ts` adds the per-table transition checks, `changes.ts` the approval
machinery, `workflow.ts` the flow runner, `background.ts` every timer.

## Things worth knowing before changing code

- **The server clock is the only clock.** Read it through `src/clock.ts`
  (`nowMs()`), never `Date.now()` directly. `Engine.at` is a snapshot used for
  the service map and maintenance windows; SLA maths and state history read
  `nowMs()` so a save sees its own moment.
- **Rate-limit windows are the one exception** and use real time
  (`realNowMs()`), as published.
- **Records are filtered and paged in the server, not in SQL.** `src/services/lists.ts`
  loads the table's visible records and evaluates filter text through the
  interpreter. That keeps reference paths (`caller.department.name`), `me()`,
  access rules and denied fields correct in one place. Volumes here are small;
  if they ever grow, push the filter down rather than duplicating the semantics.
- **System moves.** `Caller.system` is true only for the server itself
  (`systemCaller`), which is what lets the published `system` transitions run.
  Never set it for a person.
- **Form policies on a move** are resolved against the state being moved *to*
  (`PatchOptions.targetState`); otherwise a field the move makes mandatory would
  be discarded as hidden before the check.
- **Live updates must not clobber unsaved edits.** The record form's
  `applyRemote` updates only controls the person has not touched, and keeps the
  version a touched field was last seen at, so saving it produces the published
  conflict. Presence heartbeats refresh only the "Also viewing" list — never the
  whole form, or the heartbeat loops.
- **Screen listeners are dropped on navigation** (`dropScreenListeners`). A
  screen left behind must not keep announcing.
- **Unknown paths are the not-found state for everyone**; only the known screens
  in the role table redirect a visitor who is not signed in.
- **Storage is implemented in-house** (`src/services/storage.ts`, SigV4 with
  `node:crypto`) rather than pulling the AWS SDK, which keeps the shipped tree to
  `pg` and `ws`. `POST /api/grading/storage` repoints it, which is how the
  outage path is exercised.
- **No user text is ever executed.** Conditions are parsed to a tree and
  interpreted. There is no `eval`, `new Function`, `vm`, or dynamic `import` of
  data anywhere.

## Verifying

The published examples in the brief are the best tests, and all of them are
checked against this build:

- Daylight saving: 29 March and 25 October 2026 in Europe/Berlin, the 23/25-hour
  days, 08:00 on 27 and 30 March, the 167/169-hour on-call handovers.
- Impact: `Main storage array` down affects exactly those 15 items in that
  order, 77 people, 4 business-critical services, 8 relay panels ending
  `and 8 more`.
- Expression errors: all six published column examples.
- Filter text: both seeded queue renderings and the drill-down form.
- Numbering: `BRK-000004`, `ROOT-000002`, `ALT-000002`, `ASK-000001`,
  `ITM-000001`, `JOB-000001`, `ART-000006`, `SET-000001` after the seed.

For the browser, `playwright-core` plus a chromium download works in this
container (`npx playwright-core install --with-deps chromium`, launch with
`--no-sandbox`). It is deliberately **not** a dependency of the project; install
it ad hoc and do not commit it.
