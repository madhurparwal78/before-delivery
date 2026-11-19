# Third-party notices

This file names every shipped package in the production dependency tree
(`npm ls --omit=dev --all`), the two typefaces and the coastline data used by
Tramela Estate, each with its licence.

## Shipped packages (production dependency tree)

All packages below are shipped as part of the application. Every one is
licensed under MIT, ISC or BSD-3-Clause.

- accepts — MIT
- array-flatten — MIT
- body-parser — MIT
- bytes — MIT
- call-bind-apply-helpers — MIT
- call-bound — MIT
- content-disposition — MIT
- content-type — MIT
- cookie — MIT
- cookie-signature — MIT
- debug — MIT
- depd — MIT
- destroy — MIT
- dunder-proto — MIT
- ee-first — MIT
- encodeurl — MIT
- es-define-property — MIT
- es-errors — MIT
- es-object-atoms — MIT
- escape-html — MIT
- etag — MIT
- express — MIT
- finalhandler — MIT
- forwarded — MIT
- fresh — MIT
- function-bind — MIT
- get-intrinsic — MIT
- get-proto — MIT
- gopd — MIT
- has-symbols — MIT
- hasown — MIT
- http-errors — MIT
- iconv-lite — MIT
- inherits — ISC
- ipaddr.js — MIT
- math-intrinsics — MIT
- media-typer — MIT
- merge-descriptors — MIT
- methods — MIT
- mime — MIT
- mime-db — MIT
- mime-types — MIT
- ms — MIT
- negotiate — MIT
- object-inspect — MIT
- on-finished — MIT
- parseurl — MIT
- path-to-regexp — MIT
- pg — MIT
- pg-cloudflare — MIT
- pg-connection-string — MIT
- pg-int8 — ISC
- pg-pool — MIT
- pg-protocol — MIT
- pg-types — MIT
- pgpass — MIT
- postgres-array — MIT
- postgres-bytea — MIT
- postgres-date — MIT
- postgres-interval — MIT
- proxy-addr — MIT
- qs — BSD-3-Clause
- range-parser — MIT
- raw-body — MIT
- safe-buffer — MIT
- safer-buffer — MIT
- send — MIT
- serve-static — MIT
- setprototypeof — ISC
- side-channel — MIT
- side-channel-list — MIT
- side-channel-map — MIT
- side-channel-weakmap — MIT
- split2 — ISC
- statuses — MIT
- toidentifier — MIT
- type-is — MIT
- unpipe — MIT
- utils-merge — MIT
- vary — MIT
- xtend — MIT

Note: `pg` lists `pg-native` as a lazy optional require that is only loaded when
the `PGNATIVE` connection type is requested. It is not present in the shipped
`node_modules` tree and is never loaded by this application, which always
connects over TCP.

## Typefaces

- Big Shoulders (vendor-fonts/bs.ttf, served as
  dist/public/fonts/bigshoulders.woff2) — SIL Open Font License 1.1 (OFL-1.1).
  Source: Google Fonts (github.com/google/fonts), ofl/bigshoulders.
- Public Sans (vendor-fonts/ps.ttf, served as
  dist/public/fonts/publicsans.woff2) — SIL Open Font License 1.1 (OFL-1.1).
  Source: Google Fonts (github.com/google/fonts), ofl/publicsans.

The OFL licence texts are kept alongside the font sources in vendor-fonts/
(bigshoulders-OFL.txt, publicsans-OFL.txt).

## Coastline data

The simplified coastline geometry of mainland Portugal and the Azores islands
bundled as dist/public/coastline.json is drawn by hand from public-domain
geographic knowledge for this project and is released as CC0-1.0 (public
domain).
