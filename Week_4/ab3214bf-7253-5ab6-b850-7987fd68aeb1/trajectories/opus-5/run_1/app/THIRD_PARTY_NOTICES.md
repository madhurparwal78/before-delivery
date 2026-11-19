# Third-party notices

Hourproof Settlement Desk ships the production dependency tree of
`requirements.txt` and the two typefaces below. Every item is under MIT,
Apache-2.0, BSD, ISC, PSF or the SIL Open Font License.

## Python packages

| Package | Version | Licence |
|---|---|---|
| Flask | 3.1.3 | BSD-3-Clause |
| Werkzeug | 3.1.9 | BSD-3-Clause |
| Jinja2 | 3.1.6 | BSD-3-Clause |
| MarkupSafe | 3.0.4 | BSD-3-Clause |
| itsdangerous | 2.2.0 | BSD-3-Clause |
| click | 8.5.1 | BSD-3-Clause |
| blinker | 1.9.0 | MIT |
| gunicorn | 27.0.0 | MIT |
| pg8000 | 1.31.6 | BSD-3-Clause |
| scramp | 1.5.0 | MIT |
| asn1crypto | 1.5.1 | MIT |
| python-dateutil | 4.0.0 | Apache-2.0 and BSD-3-Clause (dual) |
| tzdata | 2026.6 | Apache-2.0 |
| urllib3 | 2.8.0 | MIT |
| cryptography | 50.0.2 | Apache-2.0 or BSD-3-Clause (dual) |
| cffi | 2.1.1 | MIT |
| pycparser | 3.12 | BSD-3-Clause |

`pip` (MIT) and `setuptools` (MIT) are present only as the `venv` bootstrap and
are not imported by the app.

## Typefaces

| Typeface | Files | Licence |
|---|---|---|
| Unbounded | `hourproof/static/fonts/unbounded-900-latin.woff2`, `unbounded-900-latinext.woff2` | SIL Open Font License 1.1 |
| Onest | `hourproof/static/fonts/onest-latin.woff2`, `onest-latinext.woff2` | SIL Open Font License 1.1 |

Both typefaces are served from the app itself; the browser requests no other
origin.

## Services

PostgreSQL, WireMock, Gotenberg and MinIO run as separate provided services and
are not shipped inside this application.
