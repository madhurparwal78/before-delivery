# Third-party notices

Edgeprint ships these packages into `/app/.venv` from the production
requirements (`requirements.txt`), plus the bundled Host Grotesk font.
Each is listed with its licence; all are on the published allow-list.

## Bundled font

- **Host Grotesk** (variable weight), from the Host Grotesk project
  (https://github.com/Element-Type/HostGrotesk), as published by Google Fonts.
  Licence: SIL Open Font License 1.1 (OFL-1.1). The full licence text is
  shipped alongside the font at `edgeprint/static/fonts/OFL.txt`.

## Installed packages

| Package | Version | Licence |
|---|---|---|
| anyio | 4.16.0 | MIT |
| click | 8.5.0 | BSD-3-Clause |
| h11 | 0.16.0 | MIT |
| idna | 3.20 | BSD-3-Clause |
| numpy | 2.0.1 | BSD-3-Clause |
| Pillow | 10.4.0 | HPND (Historical Permission Notice and Disclaimer) |
| psycopg[binary] / psycopg-binary | 3.2.1 | LGPL-3.0-or-later |
| starlette | 0.37.2 | BSD-3-Clause |
| typing_extensions | 4.16.0 | PSF-2.0 |
| urllib3 | 2.2.3 | MIT |
| uvicorn | 0.30.6 | BSD-3-Clause |

## Notes

- `setuptools` (66.1.1, MIT) and `pip` (26.3, MIT) are present in the venv as
  packaging tooling; they are not imported by the application at runtime.
- NumPy's distribution bundles OpenBLAS (BSD-3-Clause) and the LAPACK sources
  (BSD-3-Clause-Attribution) as dynamically linked libraries.
- psycopg is used under the LGPL-3.0-or-later licence terms; it is imported
  as an unmodified library, at runtime, through its published PyPI wheels.
