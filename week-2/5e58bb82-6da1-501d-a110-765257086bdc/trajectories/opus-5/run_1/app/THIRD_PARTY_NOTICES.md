# Third-party notices

Swathdeck ships the packages and fonts listed below. Everything else in the
repository is first-party code.

## Shipped packages

The complete production dependency tree, as reported by
`npm ls --omit=dev --all --json`. Every entry is under MIT or ISC.

| Package | Version | Licence | Source |
|---|---|---|---|
| pg | 8.13.1 | MIT | https://github.com/brianc/node-postgres |
| pg-cloudflare | 1.4.1 | MIT | https://github.com/brianc/node-postgres |
| pg-connection-string | 2.14.1 | MIT | https://github.com/brianc/node-postgres |
| pg-int8 | 1.0.1 | ISC | https://github.com/charmander/pg-int8 |
| pg-pool | 3.14.0 | MIT | https://github.com/brianc/node-postgres |
| pg-protocol | 1.16.1 | MIT | https://github.com/brianc/node-postgres |
| pg-types | 2.2.0 | MIT | https://github.com/brianc/node-pg-types |
| pgpass | 1.0.6 | MIT | https://github.com/hoegaarden/pgpass |
| postgres-array | 2.0.0 | MIT | https://github.com/bendrucker/postgres-array |
| postgres-bytea | 1.0.1 | MIT | https://github.com/bendrucker/postgres-bytea |
| postgres-date | 1.0.7 | MIT | https://github.com/bendrucker/postgres-date |
| postgres-interval | 1.2.0 | MIT | https://github.com/bendrucker/postgres-interval |
| xtend | 4.0.2 | MIT | https://github.com/Raynos/xtend |

`pg-native` is an unmet optional dependency of `pg`; it is not installed and not
shipped.

## Bundled fonts

Served from `/fonts` by the app itself, so no page loads a font from another
host. All three faces are under the SIL Open Font License 1.1.

| Font | Files | Licence | Source |
|---|---|---|---|
| Newsreader | `newsreader-latin-400-normal.woff2`, `newsreader-latin-600-normal.woff2`, `newsreader-latin-700-normal.woff2` | SIL Open Font License 1.1 | https://github.com/productiontype/Newsreader |
| IBM Plex Sans | `ibm-plex-sans-latin-400-normal.woff2`, `ibm-plex-sans-latin-600-normal.woff2`, `ibm-plex-sans-latin-700-normal.woff2` | SIL Open Font License 1.1 | https://github.com/IBM/plex |
| IBM Plex Mono | `ibm-plex-mono-latin-400-normal.woff2`, `ibm-plex-mono-latin-600-normal.woff2`, `ibm-plex-mono-latin-700-normal.woff2` | SIL Open Font License 1.1 | https://github.com/IBM/plex |

The font files are taken at build time from the `@fontsource/newsreader`,
`@fontsource/ibm-plex-sans` and `@fontsource/ibm-plex-mono` packages, which are
development dependencies and are themselves published under the SIL Open Font
License 1.1 for the font binaries they carry.

## Licence texts

### MIT License

```
Permission is hereby granted, free of charge, to any person obtaining a copy of
this software and associated documentation files (the "Software"), to deal in
the Software without restriction, including without limitation the rights to
use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of
the Software, and to permit persons to whom the Software is furnished to do so,
subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS
FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR
COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER
IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN
CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
```

### ISC License

```
Permission to use, copy, modify, and/or distribute this software for any purpose
with or without fee is hereby granted, provided that the above copyright notice
and this permission notice appear in all copies.

THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES WITH
REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF MERCHANTABILITY AND
FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR ANY SPECIAL, DIRECT,
INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES WHATSOEVER RESULTING FROM LOSS
OF USE, DATA OR PROFITS, WHETHER IN AN ACTION OF CONTRACT, NEGLIGENCE OR OTHER
TORTIOUS ACTION, ARISING OUT OF OR IN CONNECTION WITH THE USE OR PERFORMANCE OF
THIS SOFTWARE.
```

### SIL Open Font License 1.1

```
PREAMBLE

The goals of the Open Font License (OFL) are to stimulate worldwide development
of collaborative font projects, to support the font creation efforts of academic
and linguistic communities, and to provide a free and open framework in which
fonts may be shared and improved in partnership with others.

The OFL allows the licensed fonts to be used, studied, modified and
redistributed freely as long as they are not sold by themselves. The fonts,
including any derivative works, can be bundled, embedded, redistributed and/or
sold with any software provided that any reserved names are not used by
derivative works. The fonts and derivatives, however, cannot be released under
any other type of license. The requirement for fonts to remain under this
license does not apply to any document created using the fonts or their
derivatives.

DEFINITIONS

"Font Software" refers to the set of files released by the Copyright Holder(s)
under this license and clearly marked as such. This may include source files,
build scripts and documentation.

"Reserved Font Name" refers to any names specified as such after the copyright
statement(s).

"Original Version" refers to the collection of Font Software components as
distributed by the Copyright Holder(s).

"Modified Version" refers to any derivative made by adding to, deleting, or
substituting -- in part or in whole -- any of the components of the Original
Version, by changing formats or by porting the Font Software to a new
environment.

"Author" refers to any designer, engineer, programmer, technical writer or other
person who contributed to the Font Software.

PERMISSION & CONDITIONS

Permission is hereby granted, free of charge, to any person obtaining a copy of
the Font Software, to use, study, copy, merge, embed, modify, redistribute, and
sell modified and unmodified copies of the Font Software, subject to the
following conditions:

1) Neither the Font Software nor any of its individual components, in Original
or Modified Versions, may be sold by itself.

2) Original or Modified Versions of the Font Software may be bundled,
redistributed and/or sold with any software, provided that each copy contains
the above copyright notice and this license. These can be included either as
stand-alone text files, human-readable headers or in the appropriate
machine-readable metadata fields within text or binary files as long as those
fields can be easily viewed by the user.

3) No Modified Version of the Font Software may use the Reserved Font Name(s)
unless explicit written permission is granted by the corresponding Copyright
Holder. This restriction only applies to the primary font name as presented to
the users.

4) The name(s) of the Copyright Holder(s) or the Author(s) of the Font Software
shall not be used to promote, endorse or advertise any Modified Version, except
to acknowledge the contribution(s) of the Copyright Holder(s) and the Author(s)
or with their explicit written permission.

5) The Font Software, modified or unmodified, in part or in whole, must be
distributed entirely under this license, and must not be distributed under any
other license. The requirement for fonts to remain under this license does not
apply to any document created using the Font Software.

TERMINATION

This license becomes null and void if any of the above conditions are not met.

DISCLAIMER

THE FONT SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO ANY WARRANTIES OF MERCHANTABILITY, FITNESS
FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT OF COPYRIGHT, PATENT, TRADEMARK, OR
OTHER RIGHT. IN NO EVENT SHALL THE COPYRIGHT HOLDER BE LIABLE FOR ANY CLAIM,
DAMAGES OR OTHER LIABILITY, INCLUDING ANY GENERAL, SPECIAL, INDIRECT, INCIDENTAL,
OR CONSEQUENTIAL DAMAGES, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE,
ARISING FROM, OUT OF THE USE OR INABILITY TO USE THE FONT SOFTWARE OR FROM OTHER
DEALINGS IN THE FONT SOFTWARE.
```
