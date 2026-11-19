# Ashlar — repository notes

Ashlar is a browser playground for small HTML, CSS and JavaScript pens: a live sandboxed preview, a
console, byte-exact versions, forks with lineage, collections, search and embeds. One TypeScript
app, one Node server, one browser client. The only backing services are Postgres, MinIO and Mailpit.

## Running it

```
npm ci          # install
npm run build   # esbuild bundles the server, the client and the preview runtime into dist/
node dist/server.js
```

`/app/run.json` holds those three commands. The server binds `0.0.0.0:${APP_PUBLIC_PORT:-4173}`.
Everything else — database URL, the six `S3_*` values, SMTP, `APP_PUBLIC_URL`, every timer and limit
— is read from the environment in `src/server/config.ts` and nowhere else.

## Shape of the source

```
src/shared/      api types, every copy string (copy.ts), console formatting, the four starter pens
src/server/      http layer, routes, domain rules, storage, mail, preview document
src/server/domain/  canonical.ts, diff.ts, versions.ts, pens.ts, search.ts, validate.ts, loop-guard.ts
src/preview/     the runtime injected into each preview document
src/client/      router, pages, components, app.css
scripts/build.ts the build
```

Each domain rule lives in exactly one place:

| Rule | File |
| --- | --- |
| Canonical bytes and `sha256` | `server/domain/canonical.ts` |
| Version numbering, `base_version`, snapshot confirmation | `server/domain/versions.ts` |
| Visibility and the not-found answer | `server/domain/pens.ts` (`visibleTo`, `requireVisiblePen`) |
| Added, removed and changed-character counts | `server/domain/diff.ts` |
| Like and fork counts | the sub-selects in `PEN_SELECT` |
| Error body and precedence | `server/errors.ts` |
| Console entry text | `shared/console-format.ts` |
| Copy strings | `shared/copy.ts` |

## Things worth remembering

- **Sticky needs `overflow-x: clip`.** `overflow-x: hidden` on `html`/`body` silently kills every
  `position: sticky` stage. The split stage, the medium-band stage and the landing inset all depend
  on it.
- **App pages carry only `frame-ancestors`.** A stricter `script-src 'self'` breaks Playwright's
  `waitForFunction`, which needs `eval`. Preview documents keep the full published policy.
- **Hidden means `display: none !important`.** `.dialog { display: flex }` beats the UA `[hidden]`
  rule, so closed dialogs stayed focusable until the global rule was added to `app.css`.
- **The loop guard inserts no newlines**, so line numbers in the JS pane survive the transform. The
  JS pane sits in its own inline script and the runtime subtracts `__ashlarJsLineOffset`.
- **Version files live in both places.** MinIO holds the byte-exact snapshot that every save writes
  and reads back before the row is inserted; Postgres keeps the same bytes so pages, diffs and
  previews still work while storage is down. Export deliberately reads from storage, so it answers
  503 during an outage as the brief requires.
- **`appendVersion` holds the pen row locked across the storage round trip.** That is what makes
  simultaneous saves resolve to exactly one winner with the right bytes under its key.
- The editor re-parents live nodes (stage, panes, console) when the width band changes, so pane text
  and state survive; moving an `<iframe>` reloads it, which is harmless because the message gate
  compares `frame.contentWindow`.

## Checking it

There is no test framework in the repo. Checks were run with throwaway scripts against a live
server: a Python API suite and Playwright scripts for the journeys, the three width bands, the
console and loop guard, reduced motion, and storage and mail outages (a stoppable TCP proxy in front
of MinIO and Mailpit simulates the outage and the recovery).
