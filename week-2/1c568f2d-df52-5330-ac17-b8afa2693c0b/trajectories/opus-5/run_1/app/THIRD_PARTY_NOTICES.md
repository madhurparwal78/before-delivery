# Third party notices

Clearhouse ships only the Python packages below. This is the complete
production dependency tree installed by the `install` command in
`/app/run.json` (`pip install -r requirements.txt`), including transitive
dependencies. No test or development tool is shipped, and the browser gets no
third party script, style, font or picture: the stylesheet, the script and
every drawn picture belong to this deployment.

| Package | Version | Licence |
|---|---|---|
| `Flask` | 3.1.3 | BSD-3-Clause |
| `Jinja2` | 3.1.6 | BSD-3-Clause |
| `MarkupSafe` | 3.0.4 | BSD-3-Clause |
| `Werkzeug` | 3.1.9 | BSD-3-Clause |
| `asn1crypto` | 1.5.1 | MIT |
| `blinker` | 1.9.0 | MIT |
| `click` | 8.5.0 | BSD-3-Clause |
| `gunicorn` | 26.2.0 | MIT |
| `itsdangerous` | 2.2.0 | BSD-3-Clause |
| `pg8000` | 1.31.6 | BSD-3-Clause |
| `python-dateutil` | 3.0.0 | Apache-2.0 OR BSD-3-Clause |
| `scramp` | 1.5.0 | MIT-0 (MIT No Attribution) |
| `six` | 1.17.0 | MIT |
| `tzdata` | 2026.6 | Apache-2.0 |

Direct dependencies and why they are here:

- `Flask` serves the pages and the JSON API on the app's own origin, with
  `Jinja2`, `MarkupSafe`, `Werkzeug`, `itsdangerous`, `blinker` and `click`
  arriving with it.
- `gunicorn` is the production server named in the run manifest.
- `pg8000` is the PostgreSQL client. It is pure Python and brings
  `python-dateutil`, `scramp` and `asn1crypto` (SCRAM authentication),
  with `six` and `tzdata` arriving with `python-dateutil`.

`pg8000` is the only datastore client shipped, and it speaks only to
PostgreSQL. The app writes no database file of its own.

The Python standard library covers everything else: the identity exchange
(`urllib`), session tokens (`secrets`), cursor signing (`hmac`, `hashlib`) and
the CSV writing.
