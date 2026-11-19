# Gandyboard — repository notes

Browser-based 3D layout design and operating-session product for model railway
clubs. Postgres is the system of record, Valkey carries live delivery and the
tick lease, Gotenberg renders crew packet PDFs.

## Running it

```
npm ci          # install
npm run build   # vite build for the client, tsc for the server
npm run serve   # front router on APP_PUBLIC_PORT (4173) plus instances a and b
```

`run.json` holds those three commands. `serve` forks `dist/server/instance.js`
twice over IPC; the parent is the front router and restarts a child that exits.

Environment: `DATABASE_URL`, `VALKEY_URL`, `GOTENBERG_URL`, `APP_PUBLIC_PORT`,
`SESSION_IDLE_SECONDS`.

## Shape of the source

```
src/shared     protocol types, canonical units, track geometry
src/server
  domain       the rules: geometry, piece and module rules, layout content,
               session state, routing, occupancy, counters, scale speed
  services     Postgres stores, Valkey streams, outbox, tick engine,
               idempotency, auth, Gotenberg, crew packets
  routes       one file per area; every route declares auth and capability
  router.ts    path matching, the published error order, static serving
src/client
  stage        three.js club-hall scene, track geometry, SVG fallback
  components   overlays: session bar, tile rail, sheets, dialogs, walkthrough
  store.tsx    one store: snapshots, event streams, every action and its copy
```

## Things worth remembering

- **One place per rule.** Occupancy, counters, the scale-speed formula, the
  canonical hash, the error order and each state machine each live in exactly
  one function. Change them there, not at a call site.
- **Revisions and events.** Every committed change bumps one revision and writes
  exactly one `event_outbox` row whose `seq` equals that revision. Session
  streams use session `revision`; layout streams use `layout.revision`.
- **Chain linkage.** A piece records `from_piece_id` and `from_exit`. Open ends
  are matched to exits by pose only at edit time, then `relayoutModule` rebuilds
  the poses. Never infer the chain from array order.
- **Block neighbours are content data.** `applyJointAdjacency` only adds pairs
  found at piece joints; it never removes. Cross-module links come from the seed
  or the template.
- **Idempotency.** Successes and 422 refusals are stored under the key; 401,
  403, 404, 409 and 503 release it so a retry can succeed. That is what makes
  sign-in expiry and outage recovery work.
- **The browser never computes.** Occupancy, the fast clock and expiry all come
  from the server. The client only applies snapshots by `seq`.
- **Operate mode draws the pinned version.** The stage fetches
  `GET L/versions/<id>` for the session's pinned content, never the working copy.

## Seeded sign-ins

All seeded passwords are `gandyboard-demo-1`.

| Email | Role |
| --- | --- |
| `founder@fishplate.example` | founder, in every workspace |
| `manager@tarnvalley.example` | manager |
| `member@tarnvalley.example` | member |
| `operator@tarnvalley.example` | operator |
| `newmember@tarnvalley.example` | member, walkthrough not done |
| `manager@saltmarsh.example` | manager, second club |

The seed applies once, guarded by a Postgres advisory lock and a `seed_state`
row. Dropping and recreating the `public` schema reseeds on the next boot.
