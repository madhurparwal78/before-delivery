# Rostara — working notes

Rostara is the Kestrel Works attendance correction desk. One Fastify server on one
origin serves the React Router 7 server-rendered pages and the JSON API under `/api`.

## Layout

| Path | What lives there |
| --- | --- |
| `src/shared/` | Rules both sides need: business time, work-address folding, grapheme counting, the canonical queue query, the safe `next` test and every published wording. |
| `src/server/` | The HTTP pipeline, the domain modules and the server-side render. |
| `src/app/` | The React screens, components and the browser entry. |
| `scripts/build.mjs` | Vite builds the client bundle, esbuild bundles the server to `build/server.js`. |
| `scripts/notices.mjs` | Regenerates `THIRD_PARTY_NOTICES.md` from the production dependency tree. |

## Where each rule is decided, once

| Rule | Module |
| --- | --- |
| Business dates and instants, daylight saving | `src/shared/businessTime.js` |
| Work-address folding, grapheme counting | `src/shared/text.js` |
| Canonical queue query | `src/shared/queueQuery.js` |
| Safe `next` | `src/shared/safeNext.js` |
| Every refusal and visible wording | `src/shared/copy.js` |
| The one refusal shape | `src/server/errors.js` |
| Live role, reporting lines, request and calendar scope, mint scope | `src/server/people.js` |
| Leave-kind and private-field projections | `src/server/projections.js` |
| Window, cap counts, policy precondition | `src/server/policy.js` |
| Raise, decide, withdraw, claim-against-record | `src/server/requests.js` |
| Attendance write on approval | `src/server/attendance.js` |
| Session expiry and rotation | `src/server/sessions.js` |
| Sign-in lockout | `src/server/signIn.js` |
| Shared-link liveness and the mint throttle | `src/server/shareLinks.js` |
| Trail canonical string, hashing, chain | `src/server/audit.js` |
| CSV cell neutralising and quoting | `src/server/trail.js` |

## Things worth remembering

- **The client runs Preact's React-compatible build.** React and React Router render
  every page on the server; the browser bundle aliases `react`/`react-dom` to
  `preact/compat` in `vite.config.js` so the desk's script stays under its byte budget.
  React DOM alone is about 218 kB unpacked, which would breach it on its own.
- **Navigation is a full page load.** Only the named interactive parts are live in the
  browser, and every route's HTML arrives already drawn. `window.__rostara` carries the
  route id, the shell and the page data.
- **Announcements live outside the component tree** (`src/app/announce.js`). A provider
  that re-rendered its children would reset open form state.
- **A validation change must not move the row under the pointer.** Field messages are
  always rendered (hidden when empty) and leaving a cell for a button skips the cell
  check, because the whole row is checked on send anyway.
- **Uniqueness is the database's job.** Partial unique indexes guarantee one pending
  request per person per day, one idempotency key per person and one live shared link
  per person per month. Advisory locks serialise trail appends, policy saves, mints and
  the approvals of one raiser.
- **The trail is append-only in the database.** Triggers refuse update, delete and
  truncate for the application's own account.
- **The word for health information never reaches a script.** The leave labels live in
  `src/server/projections.js` and the label travels in the page data.

## Checking the work

There is no test suite in the repository. The desk was verified with throwaway scripts
driving the running server: the exact first state, the API surface, the business rules,
the pages, concurrency, daylight saving, boot behaviour, a Playwright pass over the
three width tiers and an axe-core WCAG 2.2 AA audit.

Useful one-liners while developing:

```sh
npm run build && node build/server.js
curl -s localhost:4173/api/health
npm run notices        # after changing dependencies
```
