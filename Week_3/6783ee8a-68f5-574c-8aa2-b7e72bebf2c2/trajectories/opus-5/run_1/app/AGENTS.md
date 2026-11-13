# Brackenpad — working notes

Hosted collaborative JavaScript notebooks (Wrenmoor Software). TypeScript on Node 22,
no framework on the server, React on the client, esbuild for bundling.

## Layout

- `src/shared/` — rules that both sides need: markdown allowlist (`markdown.ts`),
  TeX→MathML (`tex.ts`), table of contents numbering (`toc.ts`), compare tagging and
  the line diff (`compare.ts`), output caps and table helpers (`outputs.ts`), kernel
  value formatting (`valueformat.ts`), domain types.
- `src/server/` — `http.ts` (router, origin guard, body limits, static serving),
  `errors.ts` (the one error shape and precedence helpers), `db.ts` (pool + schema),
  `notebookstore.ts` (cells, locks, counter, working copy, search document),
  `runstate.ts` (run and kernel transitions), `nbformat.ts` (import validation),
  `storage.ts` (MinIO with hand-rolled SigV4), `mail.ts` (SMTP to Mailpit),
  `search.ts` (Meilisearch), `events.ts` (SSE hub), `routes/`.
- `src/client/` — `app.tsx` (router and context), `screens/`, `components/`,
  `notebook/useNotebook.ts` (notebook state) and `notebook/kernel.ts` (run manager).
- `src/kernel/worker.ts` — the browser kernel: acorn parses the cell, loop bodies get
  an interrupt/time-limit tick, the last expression becomes the result, and top-level
  declarations are copied into a scope object that lives across runs.

## Decisions worth remembering

- One place per rule: error precedence in `errors.ts`, run/kernel transitions in
  `runstate.ts`, the counter in `notebookstore.nextExecutionCount`, revisions in the
  save route, the markdown allowlist in `shared/markdown.ts`, compare tagging in
  `shared/compare.ts`, output caps in `shared/outputs.ts`.
- Cell outputs are stored in a Postgres `json` column (not `jsonb`) so imported
  outputs keep their keys and order.
- A tab's kernel reports its own status; the shown status is busy while any tab is
  busy, else the most recent report. The run manager settles the kernel status before
  posting a run result so the result is the last thing the live region announces.
- Command-mode keys are bound to the *mode*, not to DOM focus: the window keydown
  listener ignores the cell editor only while the mode is `edit`.
- Entering edit mode claims a lock asynchronously; `editIntent` makes a later Escape
  win the race.
- `/api/notebooks/import` answers 413 by pausing the request, writing the answer and
  destroying the socket on `finish`, so the browser can read the message.

## Running it

- `npm run build` typechecks three projects (server, client, kernel) then bundles.
- `npm start` serves on `APP_PUBLIC_PORT` (4173). `BRACKENPAD_GRADING=1` turns on
  `POST /api/grading/seed`.
- Services come from the environment: PostgreSQL, MinIO, Mailpit, Meilisearch.
- `npm run notices` regenerates `THIRD_PARTY_NOTICES.md` and fails on a licence
  outside the allowed set.
