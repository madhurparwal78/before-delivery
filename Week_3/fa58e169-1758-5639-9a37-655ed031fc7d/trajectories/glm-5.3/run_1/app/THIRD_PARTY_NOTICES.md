# Third-party notices

Twinrow ships the following packages, fonts and icon set. Each is open-licensed
(MIT, BSD, ISC, Apache-2.0 or SIL OFL) and served from this app only; no
request leaves the origin.

## Runtime packages

The production dependency tree (`npm ls --omit=dev --all`):

| Package | Version | Licence |
|---|---|---|
| dotenv | 18.0.9 | BSD-2-Clause |
| nodemailer | 10.4.0 | MIT-0 |
| pg | 8.23.1 | MIT |
| pg-cloudflare | 1.4.1 | MIT |
| pg-connection-string | 2.14.1 | MIT |
| pg-int8 | 1.0.1 | ISC |
| pg-pool | 3.14.0 | MIT |
| pg-protocol | 1.16.1 | MIT |
| pg-types | 2.2.0 | MIT |
| pgpass | 1.0.5 | MIT |
| postgres-array | 2.0.0 | MIT |
| postgres-bytea | 1.0.1 | MIT |
| postgres-date | 1.0.7 | MIT |
| postgres-interval | 1.2.0 | MIT |
| react | 19.3.1 | MIT |
| react-dom | 19.3.1 | MIT |
| scheduler | 0.28.0 | MIT |
| split2 | 4.2.0 | ISC |
| ws | 8.22.2 | MIT |
| xtend | 4.0.2 | MIT |

`bufferutil` and `utf-8-validate` are optional peers of `ws` and are not
installed; nothing depends on them at runtime.

## Fonts

Manrope and Open Sans are subset woff2 files built from their Google Fonts
releases, both SIL Open Font License 1.1. They are self-hosted at
`/fonts/manrope.woff2` and `/fonts/opensans.woff2` and never fetched from a
hosted service at page load.

## Icons

The nav icons, the rail toggle and the row pin arrow are original inline SVG
paths drawn for this app, dedicated to the public domain. No icon font and no
remote icon service is used.

## Development-only tools (not shipped)

esbuild (MIT), typescript (Apache-2.0), tsx (Apache-2.0), jsdom (MIT) and the
@types/* packages (MIT) are dev dependencies and are never part of the served
application.
