# Third-party notices

Mela draws every picture itself: event covers, avatars, icons, the grain texture and the sparkle mark are
made by the app from colours and lettering (licence: original). It ships no font files and no media from
anywhere else.

## Shipped to the browser

- **Alpine.js** 3.14.9 — MIT License — Copyright © 2019-2021 Caleb Porzio and contributors.
  Source: npm package `alpinejs@3.14.9` (https://www.npmjs.com/package/alpinejs), file `dist/cdn.min.js`,
  served from this app as `mela/static/alpine.min.js`; licence text in `mela/static/alpine-LICENSE.txt`.

## Python packages (the production dependency tree of `requirements.txt`)

Each is installed from the Python Package Index (https://pypi.org/project/<name>/) at the pinned version.

- **flask** 3.1.3 — BSD-3-Clause — Copyright 2010 Pallets. Source: https://pypi.org/project/Flask/
- **werkzeug** 3.1.9 — BSD-3-Clause — Copyright 2007 Pallets. Source: https://pypi.org/project/Werkzeug/
- **jinja2** 3.1.6 — BSD-3-Clause — Copyright 2007 Pallets. Source: https://pypi.org/project/Jinja2/
- **markupsafe** 3.0.4 — BSD-3-Clause — Copyright 2010 Pallets. Source: https://pypi.org/project/MarkupSafe/
- **itsdangerous** 2.2.0 — BSD-3-Clause — Copyright 2011 Pallets. Source: https://pypi.org/project/itsdangerous/
- **click** 8.5.0 — BSD-3-Clause — Copyright 2014 Pallets. Source: https://pypi.org/project/click/
- **blinker** 1.9.0 — MIT License — Copyright 2010 Jason Kirtland. Source: https://pypi.org/project/blinker/
- **gunicorn** 23.0.0 — MIT License — Copyright (c) 2009-2024 Benoît Chesneau, Copyright (c) 2009-2015 Paul J. Davis. Source: https://pypi.org/project/gunicorn/
- **packaging** 26.3 — Apache-2.0 OR BSD-2-Clause (used here under BSD-2-Clause) — Copyright (c) Donald Stufft and individual contributors. Source: https://pypi.org/project/packaging/
- **psycopg** 3.3.6 — LGPL-3.0 (GNU Lesser General Public License v3.0 only) — Copyright (C) 2020 The Psycopg Team. Source: https://pypi.org/project/psycopg/
- **psycopg-binary** 3.3.6 — LGPL-3.0 (GNU Lesser General Public License v3.0 only) — Copyright (C) 2020 The Psycopg Team. Source: https://pypi.org/project/psycopg-binary/
- **typing-extensions** 4.16.0 — PSF-2.0 (Python Software Foundation License) — Copyright (c) 2001-2025 Python Software Foundation. Source: https://pypi.org/project/typing-extensions/
- **tzdata** 2026.5 — Apache-2.0 — Copyright (c) 2020 Python Software Foundation (IANA time zone data is in the public domain). Source: https://pypi.org/project/tzdata/

psycopg and psycopg-binary are used unmodified as separately installed libraries, as the LGPL-3.0 allows.
