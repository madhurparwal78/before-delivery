# Third-party notices

Everything the Northfall reference programme ships, with its licence. The
production dependency tree is what `python3 -m venv .venv && .venv/bin/pip
install -r requirements.txt` installs. No npm package ships: the browser code is
plain JavaScript written for this product and served from this origin.

## Python packages

| Package | Version | Licence |
|---|---|---|
| blinker | 1.9.0 | MIT |
| click | 8.5.0 | BSD-3-Clause |
| Flask | 3.1.3 | BSD-3-Clause |
| gunicorn | 23.0.0 | MIT |
| itsdangerous | 2.2.0 | BSD-3-Clause |
| Jinja2 | 3.1.6 | BSD-3-Clause |
| MarkupSafe | 3.0.4 | BSD-3-Clause |
| packaging | 26.3 | Apache-2.0 OR BSD-2-Clause |
| pip | 26.3 | MIT |
| psycopg | 3.2.10 | LGPL-3.0 |
| psycopg-binary | 3.2.10 | LGPL-3.0 |
| psycopg-pool | 3.3.3 | LGPL-3.0 |
| setuptools | 66.1.1 | MIT |
| typing_extensions | 4.16.0 | PSF-2.0 |
| tzdata | 2025.2 | Apache-2.0 |
| Werkzeug | 3.1.9 | BSD-3-Clause |

`pip` and `setuptools` are installed by `python3 -m venv` itself and are listed
here for completeness.

## Fonts

Both typefaces are served from this origin as WOFF2 from
`northfall/static/fonts/`, and both are under the SIL Open Font License 1.1.

| Font | Files | Licence | Source |
|---|---|---|---|
| Source Serif 4 (display serif) | `source-serif-4-variable-latin.woff2`, `source-serif-4-variable-latin-ext.woff2` | SIL Open Font License 1.1 | Adobe, via Google Fonts |
| Inter (grotesque sans) | `inter-variable-latin.woff2`, `inter-variable-latin-ext.woff2` | SIL Open Font License 1.1 | Rasmus Andersson, via Google Fonts |

The SIL Open Font License 1.1 permits use, study, modification and
redistribution of these fonts, including embedding them in a served product,
provided they are not sold on their own and the licence travels with them. The
full text is published at <https://openfontlicense.org>.

## Images

Every image the app serves is drawn for this product. See `IMAGE_MANIFEST.md`.
