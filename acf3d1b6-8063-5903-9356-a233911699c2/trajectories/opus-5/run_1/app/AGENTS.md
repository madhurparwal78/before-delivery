# Kinora Video Studio — working notes

## Shape of the repository

```
server/     NestJS API and the SSR page controller (TypeScript, CommonJS build)
client/     Preact app built by Vite: pages/ (public), studio/ (signed in), components/
shared/     code both sides use: catalog.ts (plans, models, examples, templates, cost),
            forms.ts (field checks), art.ts (the drawn SVG), routes.ts (the route table)
dist/       build output: dist/client (browser), dist/ssr (SSR bundle), dist/server (API)
```

Build: `npm run build` runs the client build, the SSR build (`dist/ssr/entry-server.cjs`,
CommonJS so Nest can `require` it) and `tsc` for the server. Serve: `node dist/server/server/main.js`.

## Rules that live in exactly one place

- a generation's cost: `generationCost()` in `shared/catalog.ts`
- plan credits, parallel limit and project limit: `PLAN_CARDS` in `shared/catalog.ts`
- balance check, charge, refund, seat grant: `server/studio/generations.service.ts` and
  `server/studio/team.service.ts`, always inside `db.transaction` with `lockWorkspace`
- enquiry and account field checks: `shared/forms.ts`
- the route table used by the SSR 404 and the client router: `shared/routes.ts`

## Things that bit us

- Money safety rests on `select ... from workspaces where id = $1 for update` taken at the top of
  every transaction that reads or writes the balance; the idempotency lookup must happen *after*
  that lock or a simultaneous repeat slips through.
- A CTE cannot see its own `UPDATE` (`with renamed as (update ...) select ... from projects`
  returns the old row); use `UPDATE ... RETURNING` with scalar subqueries instead.
- Preact runs `useEffect` after paint, so focusing the first control of a dialog there leaves a
  window where a fast script presses Escape before focus has moved. `useLayoutEffect` plus a
  `onKeyDown` handler on the dialog element (not on `document`) closes that window.
- axe reports colour-contrast failures when it samples an element mid fade-in. The settled pages
  are clean; the open animations are deliberately short.
- The environment has no `ps`, `pkill` or `nc`; find processes by scanning `/proc/*/cmdline`.

## Checking it

- `node /tmp/apitest.mjs` style script: the API contract, money rules and concurrency.
- Playwright (installed under `/tmp/browsercheck`, not a project dependency) drives the four
  journeys, the phone widths and an axe audit.
- Reset to pristine seed data with
  `truncate credit_entries, generations, projects, invitations, users, workspaces, enquiries restart identity cascade`
  and restart the server.
