# Third party notices

Everything shipped with Downtime carries a permissive or open licence. The list
below is the production dependency tree, that is every package the `install`
command in `/app/run.json` puts into `/app/.venv`, together with the fonts and
media files served from `/app`.

## Python packages

| Package | Version | Licence |
|---|---|---|
| asn1crypto | 1.5.1 | MIT |
| click | 8.5.1 | BSD-3-Clause |
| h11 | 0.16.0 | MIT |
| pg8000 | 1.31.2 | BSD-3-Clause |
| pip | 26.3 | MIT |
| python-dateutil | 4.0.0 | BSD-3-Clause |
| scramp | 1.5.0 | MIT-0 |
| tzdata | 2026.6 | Apache-2.0 |
| uvicorn | 0.32.1 | BSD-3-Clause |

`pg8000` (with `scramp` and `asn1crypto`) is the pure Python PostgreSQL driver.
`uvicorn` (with `click` and `h11`) is the production ASGI server. `python-dateutil`
and `tzdata` arrive with `pg8000`. No other package is installed, and nothing is
bundled from a non-standard registry.

## Fonts

Each font file under `/app/server/static/fonts/` is the latin subset published by
Google Fonts and is licensed under the SIL Open Font License 1.1.

| File | Family | Licence |
|---|---|---|
| source-sans-pro-400.woff2 | Source Sans Pro | SIL OFL 1.1 |
| source-sans-pro-700.woff2 | Source Sans Pro | SIL OFL 1.1 |
| fira-sans-400.woff2 | Fira Sans | SIL OFL 1.1 |
| fira-sans-600.woff2 | Fira Sans | SIL OFL 1.1 |
| nanum-pen-script-400.woff2 | Nanum Pen Script | SIL OFL 1.1 |
| bungee-400.woff2 | Bungee | SIL OFL 1.1 |
| chakra-petch-600.woff2 | Chakra Petch | SIL OFL 1.1 |

## Media

| File | Work | Licence |
|---|---|---|
| assets/moths-drawn-to-park-lights-246f8064.webm | Moths drawn to park lights | CC0 1.0 |
| assets/john-bartmann-breathing-down-my-neck-master-90c3b95a.ogg | John Bartmann, Breathing Down My Neck | CC0 1.0 |

Both media files are shipped byte for byte as provided and are served unmodified.

## Test-only tools

These are never installed into `/app/.venv` and are not shipped: Playwright and
axe-core, used from outside the application when running the checks in `/app/tests`.
