# Third-party notices

## Shipped packages (production dependency tree)

| Package | Version | Licence |
|---|---|---|
| pg | 8.23.1 | MIT |
| pg-cloudflare | 1.4.1 | MIT |
| pg-connection-string | 2.14.1 | MIT |
| pg-pool | 3.14.0 | MIT |
| pg-protocol | 1.16.1 | MIT |
| pg-types | 2.2.0 | MIT |
| pg-int8 | 1.0.1 | MIT |
| postgres-array | 2.0.0 | MIT |
| postgres-bytea | 1.0.1 | MIT |
| postgres-date | 1.0.7 | MIT |
| postgres-interval | 1.2.0 | MIT |
| xtend | 4.0.2 | MIT |
| pgpass | 1.0.5 | MIT |
| split2 | 4.2.0 | MIT |

Every package in the production dependency tree (`npm ls --omit=dev --all --json`)
is MIT licensed.

## Bundled fonts

| Font | Files | Licence |
|---|---|---|
| Barlow Condensed | `public/fonts/BarlowCondensed-{Regular,Medium,SemiBold,Bold}.ttf` | SIL Open Font License 1.1 |
| IBM Plex Sans | `public/fonts/IBMPlexSans-Regular.ttf` | SIL Open Font License 1.1 |
| IBM Plex Mono | `public/fonts/IBMPlexMono-{Regular,Medium}.ttf` | SIL Open Font License 1.1 |

The full SIL Open Font License 1.1 text for each family ships alongside the font
files (`public/fonts/OFL-barlow.txt`, `public/fonts/OFL-plex.txt`).

Fonts are served only from this app's own origin (`/fonts/...`).
