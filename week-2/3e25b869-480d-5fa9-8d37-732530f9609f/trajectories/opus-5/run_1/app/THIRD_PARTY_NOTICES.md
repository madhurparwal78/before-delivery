# Third-party notices

Pain de Lune Loafline ships the packages and font files listed below. Everything here is covered by
MIT, ISC or the SIL Open Font License 1.1.

## Shipped packages

These are the production dependencies of the server bundle (`npm ls --omit=dev --all`). `pg` is the
only direct dependency; the rest are its own dependencies.

| Package | Version | Licence | Source |
| --- | --- | --- | --- |
| pg | 8.16.3 | MIT | https://github.com/brianc/node-postgres |
| pg-cloudflare | 1.4.1 | MIT | https://github.com/brianc/node-postgres |
| pg-connection-string | 2.14.1 | MIT | https://github.com/brianc/node-postgres/tree/master/packages/pg-connection-string |
| pg-int8 | 1.0.1 | ISC | https://github.com/charmander/pg-int8 |
| pg-pool | 3.14.0 | MIT | https://github.com/brianc/node-postgres/tree/master/packages/pg-pool |
| pg-protocol | 1.16.1 | MIT | https://github.com/brianc/node-postgres |
| pg-types | 2.2.0 | MIT | https://github.com/brianc/node-pg-types |
| pgpass | 1.0.5 | MIT | https://github.com/hoegaarden/pgpass |
| postgres-array | 2.0.0 | MIT | https://github.com/bendrucker/postgres-array |
| postgres-bytea | 1.0.1 | MIT | https://github.com/bendrucker/postgres-bytea |
| postgres-date | 1.0.7 | MIT | https://github.com/bendrucker/postgres-date |
| postgres-interval | 1.2.0 | MIT | https://github.com/bendrucker/postgres-interval |
| split2 | 4.2.0 | ISC | https://github.com/mcollina/split2 |
| xtend | 4.0.2 | MIT | https://github.com/Raynos/xtend |

`pg-native` is an optional peer of `pg`; it is not installed and not shipped.

Build-time only (not shipped in the running app): `typescript`, `esbuild`, `@types/node`,
`@types/pg`, `@fontsource/fraunces` and `@fontsource/instrument-sans`, all MIT except the font
packages, which carry the font licences below.

## Bundled fonts

| Font | Licence | Source | Shipped as |
| --- | --- | --- | --- |
| Fraunces | SIL Open Font License 1.1 | https://github.com/undercasetype/Fraunces | `dist/public/fonts/fraunces-*.woff2` |
| Instrument Sans | SIL Open Font License 1.1 | https://github.com/Instrument/instrument-sans | `dist/public/fonts/instrument-sans-*.woff2` |

The full licence text of each family is copied beside the font files as
`dist/public/fonts/fraunces-LICENSE.txt` and `dist/public/fonts/instrument-sans-LICENSE.txt`.

## Licence texts

### MIT

```
Permission is hereby granted, free of charge, to any person obtaining a copy of this software and
associated documentation files (the "Software"), to deal in the Software without restriction,
including without limitation the rights to use, copy, modify, merge, publish, distribute,
sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial
portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT
NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND
NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES
OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN
CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
```

### ISC

```
Permission to use, copy, modify, and/or distribute this software for any purpose with or without fee
is hereby granted, provided that the above copyright notice and this permission notice appear in all
copies.

THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES WITH REGARD TO THIS
SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE
AUTHOR BE LIABLE FOR ANY SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES
WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN ACTION OF CONTRACT, NEGLIGENCE
OR OTHER TORTIOUS ACTION, ARISING OUT OF OR IN CONNECTION WITH THE USE OR PERFORMANCE OF THIS
SOFTWARE.
```

### SIL Open Font License 1.1

The complete OFL 1.1 text ships with each family at `dist/public/fonts/*-LICENSE.txt` and is also
published at https://openfontlicense.org. Both families are used unmodified, are not sold on their
own, and keep their reserved font names.
