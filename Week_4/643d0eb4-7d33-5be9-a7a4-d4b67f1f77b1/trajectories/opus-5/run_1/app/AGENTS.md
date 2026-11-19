# Keystone Tables — repository notes

A governed reporting workspace for Northbank Mutual: public marketing pages in front, a signed in
console behind, PostgreSQL underneath. Node 22, Express, server-rendered HTML, vanilla client
script. No build framework; `npm run build` only copies the Inter font files into `public/fonts`.

## Layout

| Path | Holds |
|---|---|
| `src/server.js` | Express wiring, body parsing, the one error handler, startup seeding |
| `src/db.js` | the `pg` pool, `query`/`one`/`all`/`tx` |
| `src/schema.js` | every PostgreSQL table, created on start |
| `src/seed.js` | the deterministic seed, guarded by `SEED_VERSION` in `seed_state` |
| `src/core.js` | refusals, roles, tiers, derived table figures, typed values, the hash chain, the write boundary |
| `src/views.js` | filter operators, the SQL a view compiles to, view validation |
| `src/auth.js` | sessions, sign up, sign in, throttling, the session cookie |
| `src/access.js` | the department boundary helpers |
| `src/api.js` | the `/api` router |
| `src/admin.js` | the `/api/admin` router |
| `src/routes.js` | the page routes |
| `src/html.js`, `src/pages_public.js`, `src/pages_console.js`, `src/dialogs.js` | the HTML |
| `public/app.css`, `public/app.js` | the stylesheet and the client behaviour |

## Rules that live in exactly one place

- **Refusals.** `core.refusal(status, reason, field, extra)` builds every refusal body. No handler
  hand-builds an error.
- **Allowances.** `core.tierInForce(department, at)` reads `department_grants` and `tiers`; the row
  allowance, the content allowance, the shared view allowance and the retention all come from that
  one row. `/plans` renders the same rows.
- **The write boundary.** `core.checkWriteBoundary` checks role, lock, row allowance, content
  allowance in that order; `PATCH` then checks `If-Match-Version` and finally the column types.
  Every row write runs inside one `db.tx`.
- **The change log.** `core.appendEntries` takes a per-stream advisory lock, allocates contiguous
  ordinals and builds the SHA-256 chain. Administration entries use the stream `admin-{department}`.

## Things worth remembering

- Timestamps are stored as ISO 8601 **text** so the hash chain digests exactly what the API answers.
- The business day is `Asia/Kolkata` (+05:30, fixed): `util.businessDay` adds 330 minutes and takes
  the UTC date, so the day turns over at `18:30:00Z`.
- Derived figures (`count`, `stored_kilobytes`, `content_bytes`, `content_kilobytes`,
  `log_high_ordinal`, `read_at`, `retained`, `in_force`, `authorising`) are computed at the read.
  The store keeps none of them.
- `[hidden] { display: none !important }` sits near the top of `public/app.css`. Without it the
  layout rules (`display: flex` on the dialog backdrop, `display: block` on the notice strip)
  silently defeat the `hidden` attribute, which breaks dialogs, notices and pointer events.
- The navigation drawer's open state is driven by JavaScript setting `hidden` on `#route-nav`, not
  by CSS, so a closed drawer leaves the accessibility tree and the tab order.
- Layout changes at exactly 640px and 800px. Keep every other media query out of the stylesheet.
- Seeding is guarded by `SEED_VERSION` in `src/seed.js`. Bump it to force a truncate-and-reseed on
  the next start; dropping the `seed_state` table does the same.

## Checking it

- `GET /api/health` answers `200` once the schema and seed are applied.
- Seeded counts: 3 departments, 4 tiers, 8 accounts, 9 role grants, 4 tier grants, 5 tables,
  4 snapshots, 3 requests, 1 (stale) session, 6512 rows, and nothing in `log_entries`, `views`,
  `subscribers`, `enquiries` or `login_attempts`.
- Every seeded account signs in with `deku-demo-pw-2026`.
