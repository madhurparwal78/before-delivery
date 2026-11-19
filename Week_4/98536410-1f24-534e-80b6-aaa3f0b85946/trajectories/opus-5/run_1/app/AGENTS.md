# Tramela Estate — working notes

Shared operations and click-and-collect platform for regional ferragens groups. TypeScript
on Node 22, PostgreSQL as the source of truth, S3-compatible object storage for order
documents and return labels, and an SMTP sink for confirmation mail. No other datastore.

## Running it

```
npm ci          # install
npm run build   # esbuild: server bundle, browser bundle, stylesheet, public assets
npm run start   # serves dist/server/index.js on APP_PUBLIC_PORT (4173 by default)
npm run typecheck
```

`run.json` is the published manifest and names exactly those three commands.

Every service address and credential is read from the environment at start
(`src/server/config.ts`): `DATABASE_URL`, the `S3_*` group, `SMTP_HOST`/`SMTP_PORT`,
`MAIL_FROM`, the five timing variables and `APP_PUBLIC_PORT`/`APP_PUBLIC_URL`. Nothing is
written into the source and nothing reaches the browser.

## Where each rule lives

Each domain rule is decided in exactly one place:

| Rule | File |
| --- | --- |
| Local times, offsets, missing and repeated hours | `src/server/domain/time.ts` |
| Money rounding, VAT and refunds | `src/server/domain/money.ts` |
| Display state precedence, plan in effect, slot building | `src/server/domain/hours.ts` |
| Nearest-shop ranking | `src/server/domain/ranking.ts` |
| Order, return and hold transition tables | `src/server/domain/transitions.ts` |
| History digest chain and replay | `src/server/domain/history.ts` |
| Sign-in lock | `src/server/auth.ts` |
| Stock claims and releases | `src/server/stock.ts` |
| Single hold release and the sweep | `src/server/holds.ts` |
| All-or-nothing order placement | `src/server/placement.ts` |
| Request key replay | `src/server/requestKeys.ts` |
| Search matching | the `tramela_fold` SQL function in `src/server/schema.ts` |
| Shop state colours, rings and labels | `src/client/lib/shopState.ts` |
| Motion contract (`data-state`, counting figures) | `src/client/lib/motion.ts` |

## Things that were easy to get wrong

- **`resolveLocal`** returns every UTC instant whose local clock reads a given wall time:
  none for a skipped hour, two for a repeated one (earliest, the summer offset, first).
  Every DST worked example in the brief is covered by it.
- **Lock order** is slot lock → hold row → stock rows in SKU order → `order_numbers`.
  Taking stock locks in SKU order is what keeps overlapping holds from deadlocking, so a
  refused claim always answers `stock_conflict` rather than a server error.
- **Order numbers** come from `UPDATE order_numbers ... RETURNING next_number - 1` inside
  the placement transaction, so a rollback gives the number back and the sequence has no
  gaps across app copies.
- **The order document is written while the transaction is still open.** A storage failure
  rolls everything back and leaves the hold active; a later failure deletes the document.
- **`ensureOrder` in `src/client/lib/dom.ts`** moves only the nodes that are out of place.
  Re-appending a node that is already in the right place blurs whatever has focus inside
  it, which broke row-action focus and map keyboard panning before it existed.
- **A slower poll must never repaint over a just-finished action.** The back office keeps a
  generation token in `refreshAll`; the estate and the searches use `LatestOnly`.
- **Map markers are spread apart** when their projected centres come closer than 46 pixels.
  Shops in one city project within a few pixels of each other, and without the spread their
  44-pixel targets cover each other and only the topmost one can be pressed.
- **Closed sheets, panels, dialogs and sections use `display: none` from `closing` onwards**,
  so nothing inside them can take focus or appear in the accessibility tree while the
  `data-state` attribute still passes through the published states.
- **The review scrubber keeps the window loaded with the page.** A position stands for
  window start plus p × 86400 s, so an order placed after the page loaded is announced as an
  arrival but is not counted until the estate is opened again.

## Testing

There is no checked-in test harness. The scratch suites used during development live in
`/tmp` (`suite*.mjs` for Playwright, `suite3.py` for the API) together with helper scripts
`appall` (starts the main copy plus a second copy, a broken-storage copy and short-lifetime
copies), `dbreset` and `/tmp/proxy.mjs` (a blockable S3 proxy for outage recovery).

Useful probes:

- `curl localhost:4173/api/health` and `/api/status`.
- Two copies sharing one database and bucket: ports 4173 and 4175.
- Storage down at boot: port 4174 (`S3_ENDPOINT` pointing at a closed port).
