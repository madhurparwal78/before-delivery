# Third party notices

Nachtwit Gevelwerk ships the packages, fonts and icons below. The package list is
the production dependency tree reported by `npm ls --omit=dev --all --json`.
Build-only tooling (TypeScript, esbuild, type definitions) is not shipped and is
not listed here.

## Shipped packages

| Package | Version | Licence |
| --- | --- | --- |
| @fontsource/albert-sans | 5.3.0 | OFL-1.1 |
| @fontsource/imbue | 5.3.0 | OFL-1.1 |
| jpeg-js | 0.4.4 | BSD-3-Clause |
| lucide-static | 1.68.0 | ISC |
| pg | 8.23.1 | MIT |
| pg-cloudflare | 1.4.1 | MIT |
| pg-connection-string | 2.14.1 | MIT |
| pg-int8 | 1.0.1 | ISC |
| pg-pool | 3.14.0 | MIT |
| pg-protocol | 1.16.1 | MIT |
| pg-types | 2.2.0 | MIT |
| pgpass | 1.0.5 | MIT |
| pngjs | 7.0.0 | MIT |
| postgres-array | 2.0.0 | MIT |
| postgres-bytea | 1.0.1 | MIT |
| postgres-date | 1.0.7 | MIT |
| postgres-interval | 1.2.0 | MIT |
| split2 | 4.2.0 | ISC |
| xtend | 4.0.2 | MIT |

`pg-native` appears in `pg`'s manifest as an optional dependency. It is not
installed and not shipped.

## Fonts

| Font | Source | Licence |
| --- | --- | --- |
| Imbue (display) | `@fontsource/imbue` 5.3.0, weights 400 and 600, latin subset | SIL Open Font License 1.1 |
| Albert Sans (text) | `@fontsource/albert-sans` 5.3.0, weights 400, 500 and 700, latin subset | SIL Open Font License 1.1 |

Both families are bundled as woff2 files under `/fonts/` and served by the app.
The browser loads no font from another origin.

## Icons

| Icon set | Source | Licence |
| --- | --- | --- |
| Lucide | `lucide-static` 1.68.0 | ISC |

Lucide glyphs are inlined at build time into `/icons.svg` and served by the app.

## Licence texts

- **MIT** — Permission is hereby granted, free of charge, to any person obtaining
  a copy of this software and associated documentation files (the "Software"), to
  deal in the Software without restriction, including without limitation the
  rights to use, copy, modify, merge, publish, distribute, sublicense, and/or
  sell copies of the Software, and to permit persons to whom the Software is
  furnished to do so, subject to the inclusion of the above copyright notice and
  this permission notice in all copies or substantial portions of the Software.
  THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND.
- **ISC** — Permission to use, copy, modify, and/or distribute this software for
  any purpose with or without fee is hereby granted, provided that the above
  copyright notice and this permission notice appear in all copies. THE SOFTWARE
  IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES WITH REGARD TO THIS
  SOFTWARE.
- **BSD-3-Clause** — Redistribution and use in source and binary forms, with or
  without modification, are permitted provided that the above copyright notice,
  this list of conditions and the following disclaimer are retained, and that
  neither the name of the copyright holder nor the names of its contributors may
  be used to endorse or promote products derived from this software without
  specific prior written permission. THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT
  HOLDERS "AS IS" AND ANY WARRANTIES ARE DISCLAIMED.
- **SIL Open Font License 1.1** — The fonts and derivatives may be used, studied,
  modified and redistributed freely as long as they are not sold by themselves,
  the font names are reserved, and the licence accompanies any distribution. The
  full text travels with each font package in `node_modules`.
