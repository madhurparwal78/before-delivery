# Third-party notices

This file lists every shipped package (the production dependency tree from
`npm ls --omit=dev --all --json`) and every bundled font and icon set, with its
licence.

## Shipped packages

| Package | Version | Licence |
|---|---|---|
| @fontsource/archivo-narrow | 5.3.0 | MIT (package); SIL Open Font License 1.1 (bundled Archivo Narrow fonts) |
| @fontsource/ibm-plex-mono | 5.3.0 | MIT (package); SIL Open Font License 1.1 (bundled IBM Plex Mono fonts) |
| @fontsource/ibm-plex-sans | 5.3.0 | MIT (package); SIL Open Font License 1.1 (bundled IBM Plex Sans fonts) |
| pg | 8.23.1 | MIT |
| pg-cloudflare | 1.4.1 | MIT |
| pg-connection-string | 2.14.1 | MIT |
| pg-int8 | 1.0.1 | MIT |
| pg-pool | 3.14.0 | MIT |
| pg-protocol | 1.16.1 | MIT |
| pg-types | 2.2.0 | MIT |
| pgpass | 1.0.5 | MIT |
| postgres-array | 2.0.0 | MIT |
| postgres-bytea | 1.0.1 | MIT |
| postgres-date | 1.0.7 | MIT |
| postgres-interval | 1.2.0 | MIT |
| split2 | 4.2.0 | MIT |
| xtend | 4.0.2 | MIT |

## Bundled fonts

The following fonts are bundled as `.woff2` files, served from `/assets/fonts/`
and licensed under the SIL Open Font License 1.1:

- Archivo Narrow (Archivo Narrow Project Authors) — weights 400, 500, 600, 700,
  latin subset, from `@fontsource/archivo-narrow`.
- IBM Plex Sans (IBM Corp.) — weights 400, 500, 600, 700, latin subset, from
  `@fontsource/ibm-plex-sans`.
- IBM Plex Mono (IBM Corp.) — weights 400, 500, latin subset, from
  `@fontsource/ibm-plex-mono`.

## Bundled icon set

The application's interface icons are drawn as inline SVG line work generated
from data in the browser; no third-party icon set is bundled.
