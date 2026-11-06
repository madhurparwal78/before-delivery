# Third-party notices

Parcel Moon ships the packages, fonts and icon outlines listed here. Everything else — the
planet, the homes, the couriers, the sky scraps, the clouds and the stamp art — is drawn from
code in this repository.

## Shipped packages

These are every package in the production dependency tree, as reported by
`npm ls --omit=dev --all --json`.

| Package | Version | Licence |
| --- | --- | --- |
| pg | 8.23.1 | MIT |
| pg-cloudflare | 1.4.1 | MIT |
| pg-connection-string | 2.14.1 | MIT |
| pg-int8 | 1.0.1 | ISC |
| pg-native | (optional peer of `pg`; not installed and not shipped) | MIT |
| pg-pool | 3.14.0 | MIT |
| pg-protocol | 1.16.1 | MIT |
| pg-types | 2.2.0 | MIT |
| pgpass | 1.0.5 | MIT |
| postgres-array | 2.0.0 | MIT |
| postgres-bytea | 1.0.1 | MIT |
| postgres-date | 1.0.7 | MIT |
| postgres-interval | 1.2.0 | MIT |
| split2 | 4.2.0 | ISC |
| xtend | 4.0.2 | MIT |

Build-time only (not shipped): esbuild (MIT), typescript (Apache-2.0), @types/node (MIT),
@types/pg (MIT), @fontsource/fraunces (OFL-1.1), @fontsource/atkinson-hyperlegible (OFL-1.1).

## Fonts

Both fonts are served by the app itself from `/assets/fonts/`.

- **Fraunces** — SIL Open Font Licence 1.1 (OFL-1.1). Copyright 2020 The Fraunces Project
  Authors (https://github.com/undercasetype/Fraunces). Sets card headings, the balance numeral
  and the metres numeral.
- **Atkinson Hyperlegible** — SIL Open Font Licence 1.1 (OFL-1.1). Copyright 2020 Braille
  Institute of America, Inc. Sets all body and control text.

The font files are taken from the `@fontsource/fraunces` and `@fontsource/atkinson-hyperlegible`
packages at build time and copied into the served assets.

## Icons

- **Lucide** — ISC Licence. Copyright (c) for portions of Lucide are held by Cole Bemis
  2013-2022 as part of Feather (MIT). All other copyright (c) for Lucide are held by Lucide
  Contributors 2022. The emote bubbles draw Lucide's `hand`, `star`, `moon` and `heart` outlines
  in ink; see `src/client/game/world/textures.ts`.

## Licence texts

### MIT

Permission is hereby granted, free of charge, to any person obtaining a copy of this software
and associated documentation files (the "Software"), to deal in the Software without
restriction, including without limitation the rights to use, copy, modify, merge, publish,
distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the
Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or
substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING
BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND
NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM,
DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

### ISC

Permission to use, copy, modify, and/or distribute this software for any purpose with or
without fee is hereby granted, provided that the above copyright notice and this permission
notice appear in all copies.

THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES WITH REGARD TO THIS
SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE
AUTHOR BE LIABLE FOR ANY SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES
WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN ACTION OF CONTRACT,
NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF OR IN CONNECTION WITH THE USE OR
PERFORMANCE OF THIS SOFTWARE.

### SIL Open Font Licence 1.1

The full text is published at https://openfontlicense.org. Both fonts are used unmodified and
are served as separate font files; they are not bundled into any other work.
