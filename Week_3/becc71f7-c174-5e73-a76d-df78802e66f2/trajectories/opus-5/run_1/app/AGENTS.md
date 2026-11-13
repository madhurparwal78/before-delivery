# Ourlet Consignment Desk

The back office and public shop window for Atelier Ourlet, a consignment boutique in
Brussels. Postgres holds the shop's record, MinIO the intake photos and the monthly bank
transfer files, Mailpit every mail the shop sends. Business time is Europe/Brussels and
money is integer cents.

## Running it

```sh
npm ci            # install
npm run build     # bundles the server and the browser app into dist/
npm run start     # serves on 0.0.0.0:$APP_PUBLIC_PORT (4173 when unset)
npm run typecheck # tsc over the server and the browser app separately
```

`run.json` holds the same three commands for the harness.

## Checks

| Script | What it covers |
| --- | --- |
| `node scripts/run-ts.mjs scripts/domain-check.ts` | every worked example the brief publishes for the domain rules |
| `sh scripts/check.sh` | the whole API end to end against a fresh copy |
| `sh scripts/ui.sh` | browser journeys, layouts, motion and the axe WCAG 2.2 AA pass |
| `sh scripts/variants.sh` | the MinIO-down, Mailpit-down, short-timer, short-session and spare copies |
| `sh scripts/startup-check.sh` | three copies starting at the same moment on one database |
| `node scripts/run-ts.mjs scripts/storage-check.ts` | the signed MinIO client against a running MinIO |
| `node scripts/repo-check.mjs` | the working rules: manifest, licences, fonts, credentials, boundary |
| `node scripts/notices.mjs` | rewrites `THIRD_PARTY_NOTICES.md` from the production tree |

`scripts/repo-check.mjs` needs a copy already serving on `CHECK_URL` to test the server
boundary.

The browser checks need Playwright, which is not a dependency of the app:

```sh
npm install --no-save playwright@1.49.1 @axe-core/playwright@4.10.1 axe-core@4.10.2
npx playwright install chromium
```

`scripts/check.sh` and `scripts/ui.sh` both empty this copy's schema first, so run them
against a scratch `DATABASE_URL`, never one holding anything you want to keep.

## Where each domain rule lives

Each rule is decided in exactly one place. Change it there and nowhere else.

| Rule | File |
| --- | --- |
| Brussels day boundary, wall clock and every display format | `src/shared/brussels.ts` |
| Half-up division and money formatting | `src/shared/money.ts` |
| Markdown price, station instants and station states | `src/server/domain/ladder.ts` |
| Share, commission, VAT and the refund window | `src/server/domain/sale.ts` |
| Tag codes and their Luhn check digit | `src/server/domain/tagCode.ts` |
| IBAN MOD-97 | `src/server/domain/iban.ts` |
| The SEPA name rule | `src/server/domain/sepaName.ts` |
| Appointment slots | `src/server/domain/slots.ts` |
| The sales book file and its cell rule | `src/server/domain/salesBook.ts` |
| The pain.001.001.03 bank file | `src/server/domain/pain001.ts` |
| Spreadsheet parsing, matching and refusal reasons | `src/server/domain/importSheet.ts` |
| A piece's status from its dates, holds and sales | `src/server/data/pieces.ts` |
| The one error-precedence ladder | `src/server/http/server.ts` (`handleApi`) |
| The one error shape | `src/server/http/errors.ts` |
| Every published copy string | `src/shared/copy.ts` |

## Things worth knowing

- **No `sharp`.** Its prebuilt libvips packages are LGPL-3.0, and only permissive licences
  may ship. Photos go through the Apache-2.0 `@jsquash` wasm codecs in
  `src/server/services/images.ts`, with the wasm compiled from `node_modules` by hand
  because the emscripten glue would otherwise `fetch()` it.
- **No `nodemailer`.** It is MIT-0, which is not on the permitted licence list.
  `src/server/services/smtp.ts` speaks plain SMTP to Mailpit instead.
- **No S3 SDK.** `src/server/services/storage.ts` signs its own SigV4 requests, which
  keeps the shipped tree to twenty packages.
- **Instants.** Postgres timestamps are read as text (`src/server/db.ts` sets the type
  parsers) so no host time zone can creep in. Every API instant goes out through
  `isoSeconds`, which cuts to the whole second and appends `Z`.
- **The seed's `S`.** The Brussels date of the first start is written into `shop_state`
  and never moves, so every `S−n` date stays put across restarts.
- **Overlays.** `src/client/lib/overlay.ts` holds a three-phase state machine
  (`closed`/`open`/`leaving`). Reopening while leaving moves the phase back to `open`, and
  the leave animation is cancelled by its own effect cleanup, so no stale timer can hide a
  reopened dialog. Under reduced motion `close()` goes straight to `closed`.
- **One Problems summary at a time.** A screen and its dialog share one `problems` state,
  and the screen-level summary is hidden while any dialog is mounted, so
  `region "Problems"` is never ambiguous.
- **A session that ends mid-form.** `App.tsx` deliberately does *not* drop the session on
  a 401: the screen and its open dialog must stay as typed. `src/client/lib/resume.ts`
  writes the address and the typed values down, and the target screen claims them after
  the next sign-in.
- **Width-dependent layout** comes from `src/client/lib/viewport.ts`, not from rendering
  both layouts and hiding one, so no accessible name is ever duplicated.
