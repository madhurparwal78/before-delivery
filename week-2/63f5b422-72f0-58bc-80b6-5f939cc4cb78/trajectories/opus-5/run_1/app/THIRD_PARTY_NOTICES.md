# Third-party notices

Plinth ships the packages below (the full production dependency tree, as listed by
`npm ls --omit=dev --all --json`) and three bundled font families. Every licence is
one of MIT, ISC, BSD-2-Clause, BSD-3-Clause, Apache-2.0, 0BSD, BlueOak-1.0.0,
CC0-1.0 or OFL-1.1.

## Packages

| Package | Version | Licence |
| --- | --- | --- |
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
| split2 | 4.2.0 | ISC |
| ws | 8.22.1 | MIT |
| xtend | 4.0.2 | MIT |

## Fonts

| Font | File | Licence |
| --- | --- | --- |
| Space Grotesk | `public/fonts/space-grotesk-latin.woff2` | OFL-1.1 (SIL Open Font License 1.1) |
| IBM Plex Sans | `public/fonts/ibm-plex-sans-latin.woff2` | OFL-1.1 (SIL Open Font License 1.1) |
| IBM Plex Mono | `public/fonts/ibm-plex-mono-400-latin.woff2`, `public/fonts/ibm-plex-mono-500-latin.woff2` | OFL-1.1 (SIL Open Font License 1.1) |

The font files are latin subsets served by the app itself; nothing is loaded from
another origin at runtime.
