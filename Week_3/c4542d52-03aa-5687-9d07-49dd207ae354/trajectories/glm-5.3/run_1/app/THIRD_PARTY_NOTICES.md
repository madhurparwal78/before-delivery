# Third-party notices

This file lists every shipped package and bundled asset, each with its licence (IF-02, IF-03).

## Shipped packages

The production dependency tree as reported by `npm ls --omit=dev --all --json`:

| Package | Licence |
|---|---|
| accepts | MIT |
| body-parser | MIT |
| bytes | MIT |
| call-bind-apply-helpers | MIT |
| call-bound | MIT |
| content-disposition | MIT |
| content-type | MIT |
| cookie | MIT |
| cookie-parser | MIT |
| cookie-signature | MIT |
| debug | MIT |
| depd | MIT |
| dunder-proto | MIT |
| ee-first | MIT |
| encodeurl | MIT |
| es-define-property | MIT |
| es-errors | MIT |
| es-object-atoms | MIT |
| escape-html | MIT |
| etag | MIT |
| express | MIT |
| finalhandler | MIT |
| forwarded | MIT |
| fresh | MIT |
| function-bind | MIT |
| get-intrinsic | MIT |
| get-proto | MIT |
| gopd | MIT |
| has-symbols | MIT |
| hasown | MIT |
| http-errors | MIT |
| iconv-lite | MIT |
| inherits | ISC |
| is-promise | MIT |
| math-intrinsics | MIT |
| media-typer | MIT |
| merge-descriptors | MIT |
| mime-db | MIT |
| mime-types | MIT |
| ms | MIT |
| negotiator | MIT |
| object-inspect | MIT |
| on-finished | MIT |
| once | ISC |
| parseurl | MIT |
| path-to-regexp | MIT |
| pg | MIT |
| pg-cloudflare | MIT |
| pg-connection-string | MIT |
| pg-int8 | ISC |
| pg-pool | MIT |
| pg-protocol | MIT |
| pg-types | MIT |
| pgpass | MIT |
| postgres-array | MIT |
| postgres-bytea | MIT |
| postgres-date | MIT |
| postgres-interval | MIT |
| proxy-addr | MIT |
| qs | BSD-3-Clause |
| range-parser | MIT |
| raw-body | MIT |
| router | MIT |
| safer-buffer | MIT |
| send | MIT |
| serve-static | MIT |
| setprototypeof | ISC |
| side-channel | MIT |
| side-channel-list | MIT |
| side-channel-map | MIT |
| side-channel-weakmap | MIT |
| split2 | ISC |
| statuses | MIT |
| toidentifier | MIT |
| type-is | MIT |
| unpipe | MIT |
| vary | MIT |
| wrappy | ISC |
| ws | MIT |
| xtend | MIT |

All of the above are MIT, Apache-2.0, BSD-2-Clause, BSD-3-Clause, ISC or 0BSD licensed.

Development-only tooling (TypeScript, esbuild, @types/*, playwright) is not shipped: none of its code is bundled into the served application.

## Bundled assets

### Typefaces

- **Funnel Display** — the `funnel-display-latin-*.woff2` files in `assets/fonts/`, obtained from the `@fontsource/funnel-display` package. Funnel Display by Luke Prowse is licensed under the SIL Open Font License 1.1 (OFL-1.1).
- **Funnel Sans** — the `funnel-sans-latin-*.woff2` files in `assets/fonts/`, obtained from the `@fontsource/funnel-sans` package. Funnel Sans by Luke Prowse is licensed under the SIL Open Font License 1.1 (OFL-1.1).

### Photographs

The four greyscale photographs in `assets/photos/` — `robot-arms.png`, `workbench.png`, `hands-desk.png`, `parts-tray.png` — were generated for this project as original works and are dedicated to the public domain under CC0-1.0.

### Icon set

The line icons in `assets/icons/` (`book.svg`, `clock.svg`, `check.svg`, `seal.svg`) follow the Lucide icon set style (24×24 grid, 2px stroke, round caps and joins). They were drawn for this project as original works and are dedicated to the public domain under CC0-1.0. The Lucide icon set itself (ISC) served as the style reference only; no Lucide files are shipped.
