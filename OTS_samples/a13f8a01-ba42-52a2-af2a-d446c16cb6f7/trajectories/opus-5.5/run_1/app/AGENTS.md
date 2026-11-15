# Ashlar – working notes

- Layout: `src/server` (Node http server, no framework), `src/client` (Preact SPA), `src/preview/runtime.ts` (inlined into every `/preview/<render>` document), `src/shared` (types, shelf, starter pens). Shelf files live in `shelf/`, fonts and CSS in `static/`.
- Build: `npm run build` = `tsc --noEmit` + three esbuild bundles into `dist/` (`server.js`, `preview-runtime.js`, `public/app.js`). Serve with `node dist/server.js` from `/app`.
- Services: Postgres (schema applied on every start in `db.ts`), MinIO via a hand-written SigV4 client (`storage.ts`), Mailpit via a minimal SMTP client (`mail.ts`). Version files are kept both as snapshot objects and as bytea in the `versions` row (pages keep working during a storage outage); saves write + read back the object under the pen row lock.
- Domain rules live in one place each: canonical hash `versions.ts`, conflict check `requireBaseVersion`, visibility `access.ts`, counts `likesCountSql`/`forksCountSql`, diff `diff.ts`, console line `consoleEntryText` in `client/preview.tsx`.
- Testing used Playwright from `/tmp/pw` (not part of the repo) with `ASHLAR_GRADING=1` seed/session routes. Outages were simulated by pointing `S3_ENDPOINT`/`SMTP_*` at a stoppable TCP proxy.
- Gotchas: set textarea values in `useLayoutEffect` (tests can fill before `useEffect` runs); dialogs take focus in a layout effect; textareas normalise CR, so unchanged panes are sent back from the loaded raw text.
