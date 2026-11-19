# Everyweek

A rule-driven work hub for small crews. One TypeScript app serves the pages, the
API and an in-process live channel. It stores everything in postgres, keeps
attachments and project downloads in minio, and sends mail through mailpit.

## Layout

```
run.json                 install / build / serve commands (run-manifest-v1)
build.mjs                esbuild: server bundle, browser bundle, stylesheet
public/                  HTML shell, self-hosted Instrument Sans, fonts.css, icon
licenses/                font licence text
src/server/
  config.ts              every environment variable and limit, with defaults
  db.ts                  pg pool, schema, claim rows
  clock.ts               the one clock source (grading hook or real time)
  events.ts              live channel: event rows + postgres LISTEN/NOTIFY + SSE
  s3.ts                  minimal SigV4 client for minio
  mail.ts                minimal SMTP client for mailpit
  formula.ts             the formula language: tokenizer, parser, evaluator
  rules.ts               the rule chain, depth limit and run limit
  recurrence.ts          repeat rules and successor creation
  goals.ts               goal rollup
  workload.ts            effort spread over working days
  due.ts                 work that has become due: successors, due rules, digests
  api.ts                 auth, projects, tasks, sections, fields, dependencies
  apiExtra.ts            rules, goals, workload, forms, inbox, approvals, files
  grading.ts             /grading/seed and /grading/clock
  seed.ts                the starter seed
  index.ts               http server, static assets, error shapes, boot
src/client/
  main.ts                bootstrap and routing
  motion.ts              the page clock contract and the published easing
  views/                 list, board, timeline, task detail, shared helpers
  pages/                 welcome, account, my work, project, rules, goals,
                         workload, inbox, intake
```

## Decisions that live in exactly one place

- Formula language and its errors: `src/server/formula.ts`.
- Rule chain, depth and run limit: `src/server/rules.ts`.
- Repeat rules and successors: `src/server/recurrence.ts`.
- Goal rollup: `src/server/goals.ts`.
- Workload spread: `src/server/workload.ts`.
- List nesting: `validateParentChange` / `applyParentChange` in `src/server/api.ts`.
- Error order and shapes: `src/server/http.ts` plus the ordered checks in each handler.
- The clock: `src/server/clock.ts`. No other module reads the system time for a decision.
- Easing and the page clock: `src/client/motion.ts`.

## Gotchas learned here

- `pg` returns `date` columns as `Date` objects by default; `db.ts` registers a
  type parser for OID 1082 so dates stay ISO strings.
- A parameter that no placeholder references makes postgres answer
  `could not determine data type of parameter $1`; build each branch's SQL with
  its own numbering (see `taskops.ts`).
- `.pill { display: inline-flex }` beats the user-agent `[hidden]` rule, so the
  stylesheet carries `[hidden] { display: none !important }`.
- Playwright's `clock.install()` alone still lets time flow; `clock.pauseAt()`
  is what freezes it. The published motion samples only line up when paused.
- The grading clock's first call sets the digest baseline and sends nothing.

## Checking it by hand

```
npm install && npm run build && npm start          # port 4173
curl -s localhost:4173/api/health                  # {"status":"ok"}
S3_ENDPOINT=http://127.0.0.1:9 APP_PUBLIC_PORT=4174 npm start   # outage instance
```

Seed people (password `weekly-demo-1`): `noor@everyweek.example` (coordinator),
`ilse@everyweek.example`, `tomas@everyweek.example`. Team join code `LARDER-2026`.
