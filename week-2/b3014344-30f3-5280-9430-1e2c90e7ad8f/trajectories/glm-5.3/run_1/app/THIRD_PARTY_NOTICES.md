# Third-party notices

Pampero Ledger ships the following third-party packages and fonts, with their
licences. The package list below is the production dependency tree
(`npm ls --omit=dev --all`).

## Packages

| Package | Version | Licence |
|---|---|---|
| pg | 8.13.1 | MIT |
| pg-cloudflare | 1.4.1 | MIT |
| pg-connection-string | 2.14.1 | MIT |
| pg-pool | 3.14.0 | MIT |
| pg-protocol | 1.16.1 | MIT |
| pg-types | 2.2.0 | MIT |
| pg-int8 | 1.0.1 | ISC |
| pgpass | 1.0.6 | MIT |
| postgres-array | 2.0.0 | MIT |
| postgres-bytea | 1.0.1 | MIT |
| postgres-date | 1.0.7 | MIT |
| postgres-interval | 1.2.0 | MIT |
| xtend | 4.0.2 | MIT |
| three | 0.180.0 | MIT |

## Fonts

The web fonts are bundled from the Fontsource packages and served from the
app's own origin.

| Font | Family | Package | Licence |
|---|---|---|---|
| Bricolage Grotesque | display headings | @fontsource/bricolage-grotesque 5.2.5 | OFL-1.1 |
| IBM Plex Sans | body text | @fontsource/ibm-plex-sans 5.2.5 | OFL-1.1 |
| IBM Plex Mono | amounts, dates, clock | @fontsource/ibm-plex-mono 5.2.5 | OFL-1.1 |

## Icons

The interface ships no icon assets; it uses text labels only. No icon set is
bundled.

## Notes

Every shipped package and font is under MIT, ISC or OFL-1.1. No package or
font under GPL, LGPL, AGPL or SSPL is shipped.
