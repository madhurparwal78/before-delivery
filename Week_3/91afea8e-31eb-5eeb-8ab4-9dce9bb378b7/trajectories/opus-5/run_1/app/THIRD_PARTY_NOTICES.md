# Third party notices

Chauraha Bazaar ships the packages, fonts and icons listed here. Nothing is loaded from a
third-party origin at run time: every font, icon and model is bundled with the app.

## Shipped packages

The production dependency tree (`npm ls --omit=dev --all --json`):

| Package | Version | Licence |
| --- | --- | --- |
| @types/react | 19.3.0 | MIT |
| csstype | 3.2.3 | MIT |
| lucide-react | 1.67.0 | ISC |
| pg | 8.23.1 | MIT |
| pg-cloudflare | 1.4.1 | MIT |
| pg-connection-string | 2.14.1 | MIT |
| pg-int8 | 1.0.1 | ISC |
| pg-pool | 3.14.0 | MIT |
| pg-protocol | 1.16.1 | MIT |
| pg-types | 2.2.0 | MIT |
| pgpass | 1.0.5 | MIT |
| postgres-array | 2.0.0 | MIT |
| postgres-bytea | 1.0.1 | MIT |
| postgres-date | 1.0.7 | MIT |
| postgres-interval | 1.2.0 | MIT |
| react | 19.3.1 | MIT |
| react-dom | 19.3.1 | MIT |
| scheduler | 0.28.0 | MIT |
| split2 | 4.2.0 | ISC |
| xtend | 4.0.2 | MIT |

Both licences above are short and permissive, and both ask that the notice travel with the
software, so their texts are reproduced here.

### MIT

```
Permission is hereby granted, free of charge, to any person obtaining a copy of this
software and associated documentation files (the "Software"), to deal in the Software
without restriction, including without limitation the rights to use, copy, modify, merge,
publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons
to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or
substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED,
INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR
PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE
FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR
OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER
DEALINGS IN THE SOFTWARE.
```

### ISC

```
Permission to use, copy, modify, and/or distribute this software for any purpose with or
without fee is hereby granted, provided that the above copyright notice and this permission
notice appear in all copies.

THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES WITH REGARD TO
THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS. IN NO EVENT
SHALL THE AUTHOR BE LIABLE FOR ANY SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR
ANY DAMAGES WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN ACTION OF
CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF OR IN CONNECTION WITH THE USE
OR PERFORMANCE OF THIS SOFTWARE.
```

## Fonts

| Font | Use | Licence |
| --- | --- | --- |
| Darker Grotesque | Headlines, prices and totals (`public/fonts/darker-grotesque-latin.woff2`) | SIL Open Font Licence 1.1 (OFL-1.1) |
| Lexend | Body text, labels, form fields, and the text embedded in invoice and label PDFs (`public/fonts/lexend-latin.woff2`, `assets/lexend.ttf`) | SIL Open Font Licence 1.1 (OFL-1.1) |

Both families are served from the app's own origin and embedded in the generated PDFs.

```
SIL OPEN FONT LICENSE Version 1.1

PREAMBLE
The goals of the Open Font License (OFL) are to stimulate worldwide development of
collaborative font projects, to support the font creation efforts of academic and
linguistic communities, and to provide a free and open framework in which fonts may be
shared and improved in partnership with others.

PERMISSION & CONDITIONS
Permission is hereby granted, free of charge, to any person obtaining a copy of the Font
Software, to use, study, copy, merge, embed, modify, redistribute, and sell modified and
unmodified copies of the Font Software, subject to these conditions: the Font Software may
not be sold by itself; copies must retain this licence and its copyright notices; modified
versions must use a different Reserved Font Name; and the Font Software may not be
redistributed under any other licence.

THE FONT SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED.
```

## Icons

| Set | Use | Licence |
| --- | --- | --- |
| Lucide | Interface icons, shipped in the bundled `lucide-react` package, and the Lucide-derived outline paths used by the cart and wishlist morphs | ISC |

## Models and animation files

Every product model, the tiffin stack, the particle wordmark, the wave backdrop and all
product art are generated procedurally in the app's own TypeScript, so no model or
animation file ships with Chauraha Bazaar.
