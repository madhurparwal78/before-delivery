# Gigfreight Dispatch Desk - repository notes

Express 5 + Nunjucks + htmx on Node.js, PostgreSQL only. Server-rendered pages, htmx
fragments, no client framework, no second datastore.

## Layout

- `server.js` - reads the asset stamp, starts the database bootstrap, listens on `0.0.0.0`.
- `src/config.js` - the only place the environment is read.
- `src/db.js` - pool, `withTransaction`, unavailability translation, idempotent
  schema + seed bootstrap with retry.
- `src/schema.sql` - tables plus the `truck_state` view (the one place a truck's status
  and open request are derived from `trucks.status` and `assignments`).
- `src/seed.js` - the seeded members, trucks, requests, stops, assignments and activity.
- `src/domain/*` - one module per concern: `errors` (every error body and copy string),
  `labels` (status, type, depot, role wording and the summary lines), `validation`
  (every field rule and its reason), `roles` (the one role gate), `auth` (hashing,
  sessions, sign-in throttle), `requests` (ownership filter, list/cursor, draft replay,
  id sequence), `fleet` (assignment, release, decision, maintenance, summaries),
  `members` (role changes, last-admin rule).
- `src/http/*` - `middleware` (sessions, body limits, origin, error shape), `api`
  (the JSON API in error-precedence order), `pages` (pages and fragments), `views`
  (Nunjucks globals and filters), `app` (assembly).
- `templates/` - `base` → `layout` / `shell_public` / `bare`; `fragments/` are the htmx
  swap targets; `errors/` has one template per refusal kind and extends `shellTemplate`.
- `public/assets/` - `app.css` (design system and motion), `app.js` (draft, motion
  switch, menu, notices), `htmx.min.js` (copied by the build).

## Rules that live in exactly one place

- Truck availability and every count derived from it: the `truck_state` view.
- Request validation and field reasons: `src/domain/validation.js` + `FIELD_REASONS`.
- Request id sequence: `nextRequestId` under an advisory transaction lock.
- Ownership filter: `ownershipClause` in `src/domain/requests.js`.
- Role check: `requireRole` in `src/domain/roles.js`.
- Sign-in throttle: `throttleState` in `src/domain/auth.js`, counted in PostgreSQL.
- Status and type labels: `src/domain/labels.js`, exposed to templates as globals.

## Writes and races

Every multi-row write runs in one transaction that locks the rows it depends on, always
request first and then trucks in id order:

- assignment and release lock the request and the truck;
- a decision locks the request (and, for a decline, its trucks);
- maintenance locks the truck;
- a role change locks the target member and every admin, ordered by id.

## Testing

PostgreSQL must be reachable and the server running on `127.0.0.1:4173`.

- `sh tests/restart.sh` - rebuild and restart the server (templates are cached, so
  restart after editing them).
- `npm test` - resets the database to the seed, then runs the API and page suites.
- `node tests/load.mjs` - fills the desk with 5,000 requests and checks the budgets.
- `node tests/offline.mjs` - starts a second server with an unreachable database and
  checks the 503 answers.
- Browser checks (axe, journeys, viewports, motion) were run with Playwright installed
  outside the app tree in `/tmp/qa`, so no browser dependency ships with the app.

## Gotchas

- Nunjucks caches templates: restart the server after editing `templates/`.
- Static assets are served from `public/assets` at `/assets`.
- htmx does not swap error responses by default; `app.js` opts 4xx responses that carry a
  body into the swap so refusals redraw the panel from stored rows.
- The display headline is condensed with `scaleX`, so it looks the same on a system
  without a narrow sans; animations never drop text below 4.5:1 contrast.
