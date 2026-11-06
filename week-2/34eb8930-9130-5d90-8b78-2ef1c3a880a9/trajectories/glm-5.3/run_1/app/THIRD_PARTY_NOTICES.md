# Third-party notices

Quillmere Drafts ships the following packages, fonts and icons. The production
dependency tree is the one reported by `npm ls --omit=dev --all`.

## Packages (npm)

| Package | Version | Licence |
|---|---|---|
| pg | 8.23.1 | MIT |
| pg-cloudflare | 1.4.1 | MIT |
| pg-connection-string | 2.14.1 | MIT |
| pg-pool | 3.14.0 | MIT |
| pg-protocol | 1.16.1 | MIT |
| pg-types | 2.2.0 | MIT |
| pg-int8 | 1.0.1 | ISC |
| pgpass | 1.0.5 | MIT |
| postgres-array | 2.0.0 | MIT |
| postgres-bytea | 1.0.1 | MIT |
| postgres-date | 1.0.7 | MIT |
| postgres-interval | 1.2.0 | MIT |
| split2 | 4.2.0 | ISC |
| xtend | 4.0.2 | MIT |
| ws | 8.22.1 | MIT |

The optional native companions `pg-native`, `bufferutil` and `utf-8-validate`
are not installed and are not shipped.

## Fonts

| Font | Files | Licence |
|---|---|---|
| Newsreader | `public/fonts/Newsreader-*.woff2` | SIL Open Font License 1.1 (OFL-1.1) |
| Source Serif 4 | `public/fonts/SourceSerif4-*.woff2` | SIL Open Font License 1.1 (OFL-1.1) |

Both families are self-hosted subsets downloaded from Google Fonts and served
from the app's own origin; nothing is loaded from another origin at runtime.

## Icons

The editor's interface icons are simple line glyphs drawn in CSS and text
within this repository; no third-party icon set is shipped.
