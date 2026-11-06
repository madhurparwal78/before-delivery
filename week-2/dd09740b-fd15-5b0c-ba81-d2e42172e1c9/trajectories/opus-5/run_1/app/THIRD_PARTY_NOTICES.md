# Third-party notices

The Northpier inquiry desk ships the production dependency tree below: everything
`pip install -r requirements.txt` installs into a clean environment, as `pip freeze`
lists it. Test and development tools are not shipped and are not listed.

Direct requirements are `Flask`, `gunicorn`, `pg8000` and `tzdata`; the rest are
their transitive dependencies.

| Package | Version | Licence |
|---|---|---|
| asn1crypto | 1.5.1 | MIT |
| blinker | 1.9.0 | MIT |
| click | 8.5.0 | BSD-3-Clause |
| Flask | 3.1.3 | BSD-3-Clause |
| gunicorn | 23.0.0 | MIT |
| itsdangerous | 2.2.0 | BSD-3-Clause |
| Jinja2 | 3.1.6 | BSD-3-Clause |
| MarkupSafe | 3.0.4 | BSD-3-Clause |
| packaging | 26.3 | Apache-2.0 |
| pg8000 | 1.31.5 | BSD-3-Clause |
| python-dateutil | 3.0.0 | Apache-2.0 |
| scramp | 1.5.0 | MIT |
| six | 1.17.0 | MIT |
| tzdata | 2025.2 | Apache-2.0 |
| Werkzeug | 3.1.9 | BSD-3-Clause |

## Notes on the entries above

- **packaging** is offered under a dual licence, `Apache-2.0 OR BSD-2-Clause`. It is
  taken here under Apache-2.0.
- **python-dateutil** is offered under a dual licence, Apache-2.0 or BSD-3-Clause. It
  is taken here under Apache-2.0.
- **scramp** is distributed under MIT No Attribution (`MIT-0`), the MIT licence
  without its attribution clause.

## Not shipped

No web fonts, icon sets, stylesheets, scripts or images are bundled or loaded from
another origin. The typeface is Inter where the system provides it, falling back to the
system sans-serif. Every cover and the landing glow reel are drawn in the page as SVG
from the case's theme colour and cover seed.

PostgreSQL and Mailpit are provided services, not shipped packages.
