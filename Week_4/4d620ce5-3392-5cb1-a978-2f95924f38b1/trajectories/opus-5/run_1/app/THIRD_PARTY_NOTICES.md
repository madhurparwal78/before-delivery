# Third-party notices

Tailboard ships the Python packages below (the production dependency tree installed
into `/app/.venv` from `requirements.txt`) and the bundled font files below. There is
no front-end package tree: the browser code is first-party ES modules with no bundler
and no npm dependencies, so `npm ls --omit=dev --all --json` lists nothing. The icons
and gauges are first-party vector drawings in `static/glyphs.js`; no third-party icon
set is shipped.

## Python packages

| Package | Version | Licence |
|---|---|---|
| boto3 | 1.40.49 | Apache-2.0 |
| botocore | 1.40.76 | Apache-2.0 |
| s3transfer | 0.14.0 | Apache-2.0 |
| jmespath | 1.1.0 | MIT |
| urllib3 | 2.8.0 | MIT |
| python-dateutil | 2.9.0.post0 | Apache-2.0 OR BSD-3-Clause (dual licensed) |
| six | 1.17.0 | MIT |
| pg8000 | 1.31.5 | BSD-3-Clause |
| scramp | 1.5.0 | MIT-0 (MIT No Attribution: the MIT licence with its attribution clause removed) |
| asn1crypto | 1.5.1 | MIT |

`boto3`, `botocore`, `s3transfer`, `jmespath` and `urllib3` carry the MinIO (S3) calls.
`pg8000` with `scramp` and `asn1crypto` carries the Postgres connection. `python-dateutil`
and `six` arrive as dependencies of `botocore` and `scramp`.

## Fonts

| Font | Files | Licence |
|---|---|---|
| IBM Plex Sans | `static/fonts/IBMPlexSans-Regular.woff2`, `static/fonts/IBMPlexSans-SemiBold.woff2` | OFL-1.1 |
| IBM Plex Sans Condensed | `static/fonts/IBMPlexSansCondensed-SemiBold.woff2`, `static/fonts/IBMPlexSansCondensed-Bold.woff2` | OFL-1.1 |
| IBM Plex Mono | `static/fonts/IBMPlexMono-Regular.woff2` | OFL-1.1 |

The SIL Open Font Licence 1.1 text that ships with IBM Plex is kept at
`static/fonts/IBM-Plex-OFL-1.1.txt`. Every font is served from this app's own origin.
