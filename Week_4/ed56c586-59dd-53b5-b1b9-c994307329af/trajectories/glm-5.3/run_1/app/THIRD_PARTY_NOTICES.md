# Third-party notices

This site ships no third-party runtime packages. Its production dependency tree
is empty; the development dependencies (TypeScript, its type definitions and
esbuild) are build-time only and are not served to the browser. Confirm with:

    npm ls --omit=dev --all --json

The only third-party assets shipped are fonts, all self-hosted and same-origin:

| Font family | Files | Licence |
|---|---|---|
| Fraunces (variable) | `fraunces-var.ttf` | SIL Open Font License 1.1 |
| IBM Plex Sans (variable) | `plexsans-var.ttf` | SIL Open Font License 1.1 |
| IBM Plex Mono | `plexmono-regular.ttf`, `plexmono-medium.ttf`, `plexmono-semibold.ttf` | SIL Open Font License 1.1 |

Fraunces was designed by Undercase Type (Phaedra Charles, Flavia Zimbardi);
IBM Plex Sans and IBM Plex Mono were designed by Mike Abbink and the IBM Plex
team at IBM. All three families are released by their authors under the SIL
Open Font License 1.1, which permits bundling, serving and subsetting.

Licence text (SIL Open Font License 1.1) is reproduced below.

---

Copyright 2016 The IBM Plex Project Authors (https://github.com/IBM/plex)
Copyright 2020 The Fraunces Project Authors (https://github.com/undercasetype/Fraunces)

This Font Software is licensed under the SIL Open Font License, Version 1.1.
This license is copied below, and is also available with a FAQ at:
https://scripts.sil.org/OFL

SIL OPEN FONT LICENSE Version 1.1 - 26 February 2007

PREAMBLE
The goals of the Open Font License (OFL) are to stimulate worldwide
development of collaborative font projects, to support the font creation
efforts of academic and linguistic communities, and to provide a free and
open framework in which fonts may be shared and improved in partnership
with others.

The OFL allows the licensed fonts to be used, studied, modified and
redistributed freely as long as they are not sold by themselves. The
fonts, including any derivative works, can be bundled, embedded, and
redistributed provided they are not sold by themselves, and that any
reserved names are not used by derivative works. The fonts and
derivatives, however, cannot be released under any other type of license.
The requirement for fonts to remain under this license does not apply to
any document created using the fonts or their derivatives.

DEFINITIONS
"Font Software" refers to the set of files released by the Copyright
Holder(s) under this license and clearly marked as such. This may include
source files, build scripts and documentation.

"Reserved Font Name" refers to any names specified as such after the
copyright statement(s).

"Original Version" refers to the collection of Font Software components
as distributed by the Copyright Holder(s).

"Modified Version" refers to any derivative made by adding to, deleting,
or substituting -- in part or in whole -- any of the components of the
Original Version, provided that such changes do not constitute a
derivative of the Original Version and that the Modified Version is not
distributed under any other name than the Reserved Font Name.

"Author" refers to any designer, engineer, programmer, technical writer
or other person who contributed to the Font Software.

PERMISSION & CONDITIONS
Permission is hereby granted, free of charge, to any person obtaining a
copy of the Font Software, to use, copy, merge, publish, distribute,
sublicense, and/or sell copies of the Font Software, and to permit persons
to whom the Font Software is supplied to do the same, provided that the
Product of an OFL-licensed font is not distributed under this license alone
and that the Modified Version is not distributed under any other name than
the Reserved Font Name.

TERMINATION
This license becomes null and void if any of the above conditions are not
met.

DISCLAIMER
THE FONT SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,
EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO ANY WARRANTIES OF
MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT OF
COPYRIGHT, PATENT, TRADEMARK, OR OTHER CLAIMS. IN NO EVENT SHALL THE
COPYRIGHT HOLDER BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY,
WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF
OR IN CONNECTION WITH THE FONT SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
FONT SOFTWARE.
