# Third-party notices

This product ships the following third-party packages and fonts.

## Python packages (production dependency tree)

Installed by `pip install -r requirements.txt` into `/app/.venv`:

| Package | Version | Licence |
|---|---|---|
| blinker | 1.9.0 | MIT |
| click | 8.5.1 | BSD-3-Clause |
| Flask | 3.1.3 | BSD-3-Clause |
| gunicorn | 23.0.0 | MIT |
| itsdangerous | 2.2.0 | BSD-3-Clause |
| Jinja2 | 3.1.6 | BSD-3-Clause |
| MarkupSafe | 3.1.6 | BSD-3-Clause |
| packaging | 26.3 | Apache-2.0 / BSD-2-Clause |
| psycopg | 3.2.13 | LGPL-3.0 |
| psycopg-binary | 3.2.13 | LGPL-3.0 |
| psycopg-pool | 3.3.3 | LGPL-3.0 |
| typing_extensions | 4.16.0 | PSF-2.0 |
| Werkzeug | 3.1.9 | BSD-3-Clause |

All of the above licences are among MIT, BSD-2-Clause, BSD-3-Clause, Apache-2.0,
ISC, PSF-2.0, MPL-2.0 and LGPL-3.0.

No npm packages ship with the product. (pytest, pluggy, iniconfig, Pygments and
Playwright are development tools only; they are not installed by the product's
`install` command and do not ship.)

## Fonts

Both shipped typefaces are licensed under the SIL Open Font License 1.1.

| Font | File | Licence |
|---|---|---|
| Source Serif 4 | `static/fonts/SourceSerif4.ttf` (licence: `static/fonts/OFL.txt`) | SIL Open Font License 1.1 |
| Archivo | `static/fonts/Archivo.ttf` (licence: `static/fonts/OFL-Archivo.txt`) | SIL Open Font License 1.1 |

Source: https://github.com/google/fonts (ofl/sourceserif4, ofl/archivo).

Every other element of the product — including all images, icons, markup, styles
and scripts — is original work created for this product. No icon font is used;
all icons are drawn inline as SVG geometry in the page.
