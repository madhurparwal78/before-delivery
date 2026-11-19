# Third party notices

Duefield ships the packages, fonts and icons below. The list of packages is the
production dependency tree reported by `npm ls --omit=dev --all --json`.

## Shipped npm packages

| Package | Version | Licence |
|---|---|---|
| pg | 8.13.1 | MIT |
| pg-cloudflare | 1.4.1 | MIT |
| pg-connection-string | 2.14.1 | MIT |
| pg-int8 | 1.0.1 | ISC |
| pg-pool | 3.14.0 | MIT |
| pg-protocol | 1.16.1 | MIT |
| pg-types | 2.2.0 | MIT |
| pgpass | 1.0.6 | MIT |
| postgres-array | 2.0.0 | MIT |
| postgres-bytea | 1.0.1 | MIT |
| postgres-date | 1.0.7 | MIT |
| postgres-interval | 1.2.0 | MIT |
| xtend | 4.0.2 | MIT |

`pg-native` appears in the `pg` package manifest as an optional dependency. It is
not installed and is not shipped.

Build-only packages (`typescript`, `esbuild`, `@types/node`, `@types/pg`) are
development dependencies. They produce the build and are not shipped.

## Bundled fonts

| Font | Files | Licence |
|---|---|---|
| Tilt Warp | `src/assets/fonts/tilt-warp-latin.woff2` | SIL Open Font License 1.1 (OFL-1.1) |
| Plus Jakarta Sans | `src/assets/fonts/plus-jakarta-sans-latin.woff2`, `src/assets/fonts/plus-jakarta-sans-latin-ext.woff2` | SIL Open Font License 1.1 (OFL-1.1) |

Tilt Warp is by Andy Clymer. Plus Jakarta Sans is by Tokotype. Both are served
from this app, so no page loads a font from another origin.

### SIL Open Font License 1.1

> Copyright (c) Andy Clymer (Tilt Warp).
> Copyright (c) Tokotype (Plus Jakarta Sans).
>
> This Font Software is licensed under the SIL Open Font License, Version 1.1.
>
> PERMISSION IS HEREBY GRANTED, free of charge, to any person obtaining a copy of
> the Font Software, to use, study, copy, merge, embed, modify, redistribute, and
> sell modified and unmodified copies of the Font Software, subject to the
> following conditions:
>
> 1) Neither the Font Software nor any of its individual components, in Original
> or Modified Versions, may be sold by itself.
>
> 2) Original or Modified Versions of the Font Software may be bundled,
> redistributed and/or sold with any software, provided that each copy contains
> the above copyright notice and this license.
>
> 3) No Modified Version of the Font Software may use the Reserved Font Name(s)
> unless explicit written permission is granted by the corresponding Copyright
> Holder.
>
> 4) The name(s) of the Copyright Holder(s) or the Author(s) of the Font Software
> shall not be used to promote, endorse or advertise any Modified Version, except
> to acknowledge the contribution(s) of the Copyright Holder(s) and the Author(s).
>
> 5) The Font Software, modified or unmodified, in part or in whole, must be
> distributed entirely under this license, and must not be distributed under any
> other license.
>
> THE FONT SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
> IMPLIED, INCLUDING BUT NOT LIMITED TO ANY WARRANTIES OF MERCHANTABILITY, FITNESS
> FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT OF COPYRIGHT, PATENT, TRADEMARK, OR
> OTHER RIGHT. IN NO EVENT SHALL THE COPYRIGHT HOLDER BE LIABLE FOR ANY CLAIM,
> DAMAGES OR OTHER LIABILITY, INCLUDING ANY GENERAL, SPECIAL, INDIRECT, INCIDENTAL,
> OR CONSEQUENTIAL DAMAGES, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE,
> ARISING FROM, OUT OF THE USE OR INABILITY TO USE THE FONT SOFTWARE OR FROM OTHER
> DEALINGS IN THE FONT SOFTWARE.

## Bundled icons

| Icons | Files | Licence |
|---|---|---|
| Lucide (`chevron-left`, `chevron-right`) | `src/shared/icons.ts` | ISC |

The two glyph paths are copied from Lucide and inlined, so no icon is loaded from
another origin.

### ISC License (Lucide)

> ISC License
>
> Copyright (c) for portions of Lucide are held by Cole Bemis 2013-2022 as part of
> Feather (MIT). All other copyright (c) for Lucide are held by Lucide Contributors
> 2022.
>
> Permission to use, copy, modify, and/or distribute this software for any purpose
> with or without fee is hereby granted, provided that the above copyright notice
> and this permission notice appear in all copies.
>
> THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES WITH
> REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF MERCHANTABILITY AND
> FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR ANY SPECIAL, DIRECT,
> INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES WHATSOEVER RESULTING FROM LOSS
> OF USE, DATA OR PROFITS, WHETHER IN AN ACTION OF CONTRACT, NEGLIGENCE OR OTHER
> TORTIOUS ACTION, ARISING OUT OF OR IN CONNECTION WITH THE USE OR PERFORMANCE OF
> THIS SOFTWARE.

## Licence summary

Every shipped package is MIT or ISC. The bundled fonts are OFL-1.1 and the
bundled icon paths are ISC.
