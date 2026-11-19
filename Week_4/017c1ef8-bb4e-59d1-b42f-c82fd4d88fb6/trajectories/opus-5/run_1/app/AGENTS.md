# Plainwork — repository notes

Plainwork is a professional network where every rule is stated and the server
enforces it. TypeScript only, three backend services, no other datastore.

## Run

```
npm ci        # install (lockfile committed)
npm run build # tsc + esbuild bundle + static copy
npm start     # serves on APP_PUBLIC_PORT, else PORT, else 4173
```

`/app/run.json` is the run manifest (`run-manifest-v1`).

## Layout

```
src/shared/     pure rules used by the server and the browser alike
                format.ts   relative time, dates in the configured zone, labels,
                            counter text, mutual line, skill rows, stage labels
                richtext.ts the one rendering allowlist (mentions, hashtags, links)
                stages.ts   the application state machine
src/domain/     server-side domain rules, one place per rule
                graph.ts    blocks, degree, mutual connections, connection path,
                            connection state, the weekly invitation window
                members.ts  profile projection, person cards, skills, endorser lines
                posts.ts    post objects, reaction summaries, comment trees
                feed.ts     feed contents, order, one entry per original, cursors
                jobs.ts     job cards, open/closed, questions, hiring stages
                applications.ts  history, answer checks, knock-outs, hiring funnel
                notifications.ts  grouping, text, unread
src/server/     http plumbing
                index.ts    route table, static files, page shell, precedence order
                http.ts     body limits, origin check, sessions, idempotency
                errors.ts   the one error shape
                clock.ts    the business clock (offset in PostgreSQL)
                live.ts     the app's own event stream and job-editor presence
                storage.ts  MinIO over hand-rolled AWS SigV4
                smtp.ts     plain-text SMTP, no dependencies
                images.ts   JPEG/PNG detection and metadata stripping
                demo.ts     the published demo data, created once
                schema.sql  applied idempotently on every serve
src/client/     browser client (vanilla TypeScript, bundled by esbuild)
                strings.ts  every published string, character for character
                dom.ts      dialogs (focus trap), menus, live regions, alerts
                components/ text, person, post, comments, composer, degree roll
                views/      one module per screen group
```

## Things worth remembering

- **Business clock.** Never use `Date.now()` for stored or shown times on the
  server: use `businessNow()`. The browser advances the server's instant by
  elapsed time only (`nowIso()` in `src/client/state.ts`), never the device date.
- **Error precedence** is applied centrally in `src/server/index.ts` (origin,
  size, content type, session) and then by each handler in the published order.
  Idempotency replays are checked before any state check.
- **Live updates** are pushed from `src/server/live.ts` when a change is stored.
  A `tick` event each second carries the clock, which drives relative times and
  time-based states. Never poll for state.
  - Job-editor presence pushes only when the member list changes; pushing on
    every editor fetch caused a feedback loop (request storm).
- **Degree Roll** timing lives in `src/client/components/degree.ts` plus the
  `roll-in`/`roll-out` keyframes in `styles.css`. The 50% keyframe exists so the
  new numeral is still a quarter of its height below its rest at 240 ms.
- **The job editor** keeps the version it read while a field is dirty, so the
  next save meets the field conflict. Question changes coalesce (150 ms) because
  a blur and a click can both fire.
- **Declaration order** in client views: `let` state must be declared before
  `return host;`, since statements after the return never run (only function
  declarations hoist).
- **Licences.** Production tree is `pg` only, so `THIRD_PARTY_NOTICES.md` stays
  short. SMTP and S3 signing are first-party for that reason.

## Tests used while building

Not committed; they live in `/tmp` and need the app running:

- `smoke.py`, `smoke2.py` — API rules end to end (Python, stdlib only).
- `uitest.py`, `uitest2.py`, `uitest3.py` — Playwright: screens, keyboard,
  live updates, Degree Roll timing, breakpoints, storage outage.

Seeded test data uses a random suffix per run, since the grading seed refuses
duplicate emails and handles.
