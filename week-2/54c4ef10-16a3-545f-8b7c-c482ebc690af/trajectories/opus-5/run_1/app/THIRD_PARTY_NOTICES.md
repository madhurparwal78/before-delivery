# Third-party notices

Edgeprint ships the production dependency tree installed into `/app/.venv`
from `requirements.txt`, and one bundled font. Nothing else is served to the
browser; there are no development or test dependency groups.

## Python packages

| Package | Version | Licence |
|---|---|---|
| numpy | 2.1.3 | BSD-3-Clause |
| pillow | 11.0.0 | MIT-CMU |
| psycopg2-binary | 2.9.10 | LGPL-3.0-or-later (with the psycopg OpenSSL exception) |

`pip` and `setuptools` come with the virtual environment itself and are not
imported or shipped by the application.

- **numpy** — Copyright (c) 2005-2024, NumPy Developers. Licensed under the
  BSD 3-Clause "New" or "Revised" License.
- **pillow** — Copyright (c) 1997-2011 by Secret Labs AB, Copyright (c)
  1995-2011 by Fredrik Lundh and contributors, Copyright (c) 2010-2024 by
  Jeffrey A. Clark and contributors. Licensed under the MIT-CMU licence (the
  historical PIL "Software License").
- **psycopg2-binary** — Copyright (c) 2001-2024 Federico Di Gregorio and
  contributors. Licensed under the GNU Lesser General Public License version 3
  or later, with the exception that permits linking with the OpenSSL library.

## Font

| Font | Licence |
|---|---|
| Host Grotesk (`static/fonts/HostGrotesk-latin.woff2`, `static/fonts/HostGrotesk-latin-ext.woff2`) | SIL Open Font License 1.1 (OFL-1.1) |

Host Grotesk is Copyright (c) The Host Grotesk Project Authors
(https://github.com/dvdstelt/HostGrotesk), licensed under the SIL Open Font
License, Version 1.1. The font files are served by this application itself; no
font, script or stylesheet is loaded from another origin.
