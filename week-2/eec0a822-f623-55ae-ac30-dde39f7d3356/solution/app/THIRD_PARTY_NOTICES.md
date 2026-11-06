# Third-party notices

Tidewright ships the packages below (the production tree that `npm ls --omit=dev --all` reports), is built with the
build-only packages listed after them, and bundles three font families. Every licence is MIT, ISC, BSD-3-Clause, Apache-2.0 or OFL-1.1.

## Shipped packages

| Package | Version | Licence | Copyright |
|---|---|---|---|
| jpeg-js | 0.4.4 | BSD-3-Clause | Copyright (c) 2014, Eugene Ware |
| pg | 8.23.1 | MIT | Copyright (c) 2010 - 2021 Brian Carlson |
| pg-cloudflare | 1.4.1 | MIT | Copyright (c) 2010 - 2021 Brian Carlson |
| pg-connection-string | 2.14.1 | MIT | Copyright (c) 2014 Iced Development |
| pg-int8 | 1.0.1 | ISC | Copyright © 2017, Charmander <~@charmander.me> |
| pg-pool | 3.14.0 | MIT | Copyright (c) 2017 Brian M. Carlson |
| pg-protocol | 1.16.1 | MIT | Copyright (c) 2010 - 2021 Brian Carlson |
| pg-types | 2.2.0 | MIT | Copyright (c) 2013 Brian M. Carlson |
| pgpass | 1.0.5 | MIT | Copyright (c) 2013-2016 Hannes Hörl |
| pngjs | 7.0.0 | MIT | pngjs original work Copyright (c) 2015 Luke Page & Original Contributors |
| postgres-array | 2.0.0 | MIT | Copyright (c) Ben Drucker <bvdrucker@gmail.com> (bendrucker.me) |
| postgres-bytea | 1.0.1 | MIT | Copyright (c) Ben Drucker <bvdrucker@gmail.com> (bendrucker.me) |
| postgres-date | 1.0.7 | MIT | Copyright (c) Ben Drucker <bvdrucker@gmail.com> (bendrucker.me) |
| postgres-interval | 1.2.0 | MIT | Copyright (c) Ben Drucker <bvdrucker@gmail.com> (bendrucker.me) |
| preact | 10.29.8 | MIT | Copyright (c) 2015-present Jason Miller |
| split2 | 4.2.0 | ISC | Copyright (c) 2014-2018, Matteo Collina <hello@matteocollina.com> |
| xtend | 4.0.2 | MIT | Copyright (c) 2012-2014 Raynos. |

## Build-only packages

These run during `npm run build` and are not part of the served app.

| Package | Version | Licence | Copyright |
|---|---|---|---|
| @types/node | 22.20.5 | MIT | Copyright (c) Microsoft Corporation. |
| @types/pg | 8.23.1 | MIT | Copyright (c) Microsoft Corporation. |
| @types/pngjs | 6.0.5 | MIT | Copyright (c) Microsoft Corporation. |
| esbuild | 0.28.2 | MIT | Copyright (c) 2020 Evan Wallace |
| typescript | 5.9.3 | Apache-2.0 | Copyright (c) Microsoft Corporation. |
| undici-types | 6.21.0 | MIT | Copyright (c) Matteo Collina and Undici contributors |
| @esbuild/* (the one platform binary npm installs) | 0.28.2 | MIT | Copyright (c) 2020 Evan Wallace |

## Fonts

Self-hosted from the Fontsource builds (`public/fonts/`), each under the SIL Open Font License, Version 1.1 (OFL-1.1).
The full licence text of each family ships next to its files.

- **Newsreader** (500, 600; latin) — OFL-1.1 — Copyright 2020 The Newsreader Project Authors (https://github.com/productiontype/Newsreader). Licence: `public/fonts/Newsreader-OFL.txt`.
- **Inter** (400, 600; latin) — OFL-1.1 — Copyright 2016 The Inter Project Authors (https://github.com/rsms/inter). Licence: `public/fonts/Inter-OFL.txt`.
- **IBM Plex Mono** (400, 500; latin) — OFL-1.1 — Copyright 2017 IBM Corp. Licence: `public/fonts/IBMPlexMono-OFL.txt`.

## Media

Every illustration (hull drawings, sun badge, charge ribbon, energy chart, brand mark) is drawn in code for this app (`original`); no image files ship.
