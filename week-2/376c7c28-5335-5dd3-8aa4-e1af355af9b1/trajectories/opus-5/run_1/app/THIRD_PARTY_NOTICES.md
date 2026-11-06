# Third party notices

Kiln Desk ships the production dependency tree below (`npm ls --omit=dev --all --json`) and the
bundled fonts below. Development-only tools (TypeScript, esbuild, type definitions) are not
shipped and are therefore not listed.

## Shipped packages

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

### MIT License

```
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
```

### ISC License

```
Permission to use, copy, modify, and/or distribute this software for any purpose with or
without fee is hereby granted, provided that the above copyright notice and this permission
notice appear in all copies.

THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES WITH REGARD TO THIS
SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE
AUTHOR BE LIABLE FOR ANY SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES
WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN ACTION OF CONTRACT,
NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF OR IN CONNECTION WITH THE USE OR
PERFORMANCE OF THIS SOFTWARE.
```

## Bundled fonts

All font files live in `public/fonts/` and are served from the app's own origin.

| Font | Files | Licence |
|---|---|---|
| Barlow Condensed (weights 500, 600, 700) | `barlow-condensed-500-latin.woff2`, `barlow-condensed-500-latin-ext.woff2`, `barlow-condensed-600-latin.woff2`, `barlow-condensed-600-latin-ext.woff2`, `barlow-condensed-700-latin.woff2`, `barlow-condensed-700-latin-ext.woff2` | OFL-1.1 |
| IBM Plex Sans (variable) | `ibm-plex-sans-var-latin.woff2`, `ibm-plex-sans-var-latin-ext.woff2` | OFL-1.1 |
| IBM Plex Mono (weights 400, 600) | `ibm-plex-mono-400-latin.woff2`, `ibm-plex-mono-400-latin-ext.woff2`, `ibm-plex-mono-600-latin.woff2`, `ibm-plex-mono-600-latin-ext.woff2` | OFL-1.1 |

Barlow Condensed is Copyright (c) Jeremy Tribby. IBM Plex Sans and IBM Plex Mono are
Copyright (c) 2017 IBM Corp. Both families are licensed under the SIL Open Font License,
Version 1.1.

### SIL Open Font License, Version 1.1

```
PREAMBLE
The goals of the Open Font License (OFL) are to stimulate worldwide development of
collaborative font projects, to support the font creation efforts of academic and linguistic
communities, and to provide a free and open framework in which fonts may be shared and improved
in partnership with others.

The OFL allows the licensed fonts to be used, studied, modified and redistributed freely as long
as they are not sold by themselves. The fonts, including any derivative works, can be bundled,
embedded, redistributed and/or sold with any software provided that any reserved names are not
used by derivative works. The fonts and derivatives, however, cannot be released under any other
type of license. The requirement for fonts to remain under this license does not apply to any
document created using the fonts or their derivatives.

DEFINITIONS
"Font Software" refers to the set of files released by the Copyright Holder(s) under this license
and clearly marked as such. This may include source files, build scripts and documentation.

"Reserved Font Name" refers to any names specified as such after the copyright statement(s).

"Original Version" refers to the collection of Font Software components as distributed by the
Copyright Holder(s).

"Modified Version" refers to any derivative made by adding to, deleting, or substituting -- in
part or in whole -- any of the components of the Original Version, by changing formats or by
porting the Font Software to a new environment.

"Author" refers to any designer, engineer, programmer, technical writer or other person who
contributed to the Font Software.

PERMISSION & CONDITIONS
Permission is hereby granted, free of charge, to any person obtaining a copy of the Font Software,
to use, study, copy, merge, embed, modify, redistribute, and sell modified and unmodified copies
of the Font Software, subject to the following conditions:

1) Neither the Font Software nor any of its individual components, in Original or Modified
Versions, may be sold by itself.

2) Original or Modified Versions of the Font Software may be bundled, redistributed and/or sold
with any software, provided that each copy contains the above copyright notice and this license.
These can be included either as stand-alone text files, human-readable headers or in the
appropriate machine-readable metadata fields within text or binary files as long as those fields
can be easily viewed by the user.

3) No Modified Version of the Font Software may use the Reserved Font Name(s) unless explicit
written permission is granted by the corresponding Copyright Holder. This restriction only
applies to the primary font name as presented to the users.

4) The name(s) of the Copyright Holder(s) or the Author(s) of the Font Software shall not be used
to promote, endorse or advertise any Modified Version, except to acknowledge the contribution(s)
of the Copyright Holder(s) and the Author(s) or with their explicit written permission.

5) The Font Software, modified or unmodified, in part or in whole, must be distributed entirely
under this license, and must not be distributed under any other license. The requirement for
fonts to remain under this license does not apply to any document created using the Font Software.

TERMINATION
This license becomes null and void if any of the above conditions are not met.

DISCLAIMER
THE FONT SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED,
INCLUDING BUT NOT LIMITED TO ANY WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE
AND NONINFRINGEMENT OF COPYRIGHT, PATENT, TRADEMARK, OR OTHER RIGHT. IN NO EVENT SHALL THE
COPYRIGHT HOLDER BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, INCLUDING ANY GENERAL,
SPECIAL, INDIRECT, INCIDENTAL, OR CONSEQUENTIAL DAMAGES, WHETHER IN AN ACTION OF CONTRACT, TORT
OR OTHERWISE, ARISING FROM, OUT OF THE USE OR INABILITY TO USE THE FONT SOFTWARE OR FROM OTHER
DEALINGS IN THE FONT SOFTWARE.
```
