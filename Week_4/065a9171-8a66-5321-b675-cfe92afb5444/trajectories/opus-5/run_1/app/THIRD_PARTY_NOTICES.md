# Third-party notices

Tallow Cover ships the Python packages below and two typefaces. No npm packages
are shipped: the browser app is hand-written ES modules and CSS, served by the
app itself.

## Python packages

These are the runtime dependency tree installed by `run.json`'s `install`
(`pip install -r requirements.txt`), including transitive dependencies.

| Package | Version | Licence |
|---|---|---|
| asyncpg | 0.32.0 | Apache-2.0 |
| blinker | 1.9.0 | MIT |
| click | 8.5.0 | BSD-3-Clause |
| Flask | 3.1.0 | BSD-3-Clause |
| gunicorn | 23.0.0 | MIT |
| itsdangerous | 2.2.0 | BSD-3-Clause |
| Jinja2 | 3.1.6 | BSD-3-Clause |
| MarkupSafe | 3.0.4 | BSD-3-Clause |
| packaging | 26.3 | Apache-2.0 |
| tzdata | 2026.6 | Apache-2.0 |
| Werkzeug | 3.1.9 | BSD-3-Clause |

`packaging` is offered under Apache-2.0 or BSD-2-Clause; it is used here under
Apache-2.0. `tzdata` packages the IANA time zone database under Apache-2.0.

## Typefaces

Both are served from `tallow_cover/static/fonts/` as WOFF2 subsets and are
referenced only by the app's own stylesheet.

| Typeface | Copyright | Licence |
|---|---|---|
| Fraunces | Copyright 2020 The Fraunces Project Authors (github.com/undercasetype/Fraunces) | OFL-1.1 |
| IBM Plex Sans | Copyright 2019 IBM Corp. All rights reserved. | OFL-1.1 |

The SIL Open Font License, Version 1.1 is available at
<https://scripts.sil.org/OFL>.
