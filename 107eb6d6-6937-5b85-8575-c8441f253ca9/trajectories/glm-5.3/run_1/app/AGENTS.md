# Gigfreight dispatch desk

Express + Nunjucks + htmx app backed only by PostgreSQL (`DATABASE_URL`).

## Layout

- `server.js` — app wiring: body limits, cookie reader, same-origin write guard, error boundary.
- `server/api.js` — JSON API under `/api` (bearer token auth), health flag wiring.
- `server/pages.js` — server-rendered pages and fragments router (session-cookie auth, role and ownership checks).
- `server/fragments.js` — htmx fragment endpoints (panel, timeline, rows, maintenance, roles).
- `server/template.js` — Nunjucks environment; every label/filter comes from `lib/domain.js`.
- `lib/domain.js` — the single source of every label, field-reason copy, conflict copy and validation rule.
- `lib/validation.js` — request/decision/truck/role validators; all 422 field reasons come from here.
- `lib/operations.js` — every multi-row write (submission, assignment, release, decision, maintenance, role change) inside one advisory-lock write transaction.
- `lib/repository.js` — reads and every derived count (ownership clause lives here only).
- `lib/auth.js` — scrypt passwords, sessions, the sign-in throttle (rule 15).
- `lib/schema.js` — idempotent schema + seed, applied on every serve behind an advisory lock.
- `views/*.njk`, `public/css/app.css`, `public/js/app.js` — stage-dark UI, htmx wiring, the browser draft.

## Conventions that keep the contract

- The page never decides status, counts or truck state; fragments redraw from stored rows after every write, refused or not.
- `trucks.status` stays in step with assignment rows; the board, fleet summary, count lines and `request_id` all derive from the same rows.
- Roles are read from the stored member on every request, page and fragment.
- The browser draft lives in localStorage; `POST /requests/new/validate` checks each step server-side and `POST /requests/new/submit` stores it with the `draft_id` for dedupe.

## Tests

`npm test` runs `tests/api.test.js` (116 checks) and `tests/pages.test.js` (65 checks). Both suites assume a freshly seeded database: drop the tables, restart the server, then run one suite per fresh seed.
