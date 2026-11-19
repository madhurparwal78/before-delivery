# Rushes — repository notes

Rushes is a reference-curation workspace for in-house design teams. One sealed workspace per brand,
a masonry wall of references, frame plucks from clips, clusters with a presentation order, expiring
review links, embargoed public releases, a discovery feed and pro seats bought through Kill Bill.

## Layout

```
run.json                 install / build / serve commands
index.html               Vite entry
public/fonts/            the three bundled WOFF2 faces (OFL-1.1)
src/shared/              rules and types both sides need
src/server/              Node http server, no framework
src/client/              React app, no router library
```

- `npm run build` runs `tsc -p tsconfig.server.json` (into `dist/server`) then `vite build`
  (into `dist/client`). `npm start` runs `dist/server/index.js`, which serves the built client,
  the API and `/media`.
- The server binds `0.0.0.0:4173`, or `APP_PUBLIC_PORT`.

## Where each domain rule lives

Each rule is decided in exactly one place. Keep it that way.

| Rule | Module |
| --- | --- |
| Cluster status edges and the locked set | `src/shared/status.ts` |
| Timecode and total frames | `src/shared/timecode.ts` |
| Return path after sign in | `src/shared/returnPath.ts` |
| Embargo local time to instant | `src/server/domain/embargo.ts` |
| Lift instant (and its SQL twin) | `src/server/domain/lift.ts` |
| Cluster order, appends and moves | `src/server/domain/order.ts` |
| Seat cap | `src/server/domain/seats.ts` |
| Plan read from Kill Bill | `src/server/domain/plan.ts` |
| Media access | `src/server/domain/mediaAccess.ts` |
| Review link state | `src/server/domain/reviewLinks.ts` |
| Cluster sheet cells | `src/server/domain/sheet.ts` |
| Type sniffing and metadata removal | `src/server/domain/media.ts` |
| Digest body | `src/server/domain/digest.ts` |
| Public projection | `src/server/domain/publicProjection.ts` |
| The one error shape | `src/server/errors.ts` |
| The one error summary | `src/client/components/ErrorSummary.tsx` |

## Things worth remembering

- **Coordination is Postgres only.** `lock()` in `src/server/db.ts` takes a transaction-scoped
  advisory lock, which is how seat races, order races, status races and digest sends settle the same
  way on every instance. `pg_advisory_xact_lock` only has a two-argument form for `int4`, so the
  helper hashes one combined key.
- **The lift is read, not scheduled.** `effectiveStatus` and `publicClusterSql` both treat an
  embargoed cluster as public from `lifts_at`, so a cluster is public on the instant whether or not
  the worker has run. The worker in `src/server/workers.ts` only persists the promotion and sends
  digests.
- **Storage holds exactly one object per reference.** Write the object first, then the row; delete
  the object first, then the row. The seed follows the same order, and retries from the worker when
  storage was down at boot.
- **Images are never re-encoded.** `removeMetadata` only drops whole segments or chunks.
- **Mail is a small SMTP client** (`src/server/services/smtp.ts`), not a package, so the shipped
  licence set stays inside the brief's list. Bodies go out quoted-printable so they arrive byte for
  byte.
- **Counts and slot numbers render inline.** A block-level child inside a count makes `innerText`
  insert a newline, which breaks copy assertions; `.roll span` is `inline-block` for that reason.
- **State marks are inline SVGs** (`src/client/components/Icon.tsx`) rather than glyphs, so a state
  word is never polluted by an icon character in the text content.
- **The strip is the slider.** `region "Sprocket strip"` holds one element with `role="slider"`
  named "Playhead"; the preview and readout sit before it visually through `order: -1`, which keeps
  the Tab order playhead, Pluck, Close.
- **The workspace shell is a grid** with named areas, so the DOM order (wall, strip, tray) matches
  the required Tab order while the tray still shows as a right column from 720 wide.

## Checking the app by hand

```
npm run build && node dist/server/index.js
curl -s localhost:4173/api/health
```

Every seeded account signs in with `rushes-demo-2026`. Northvale designers are `juno`, `tomas`,
`ines`, `priya` (seated) and `ola`, `kit` (not seated); `mara` and `dev` are the Halden Group ops
leads; `lee` and `noor` are followers.
