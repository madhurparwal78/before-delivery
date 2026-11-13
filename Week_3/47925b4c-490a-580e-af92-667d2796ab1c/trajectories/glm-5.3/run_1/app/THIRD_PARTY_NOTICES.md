# Third-party notices

This file lists every shipped package in the production dependency tree
(`npm ls --omit=dev --all --json`), each font and the icon set, with its licence
(IF-02, IF-03).

## Packages

| Package | Version | Licence |
|---|---|---|
| gevelwerk | 1.0.0 | (this app) |
| pg | 8.23.1 | MIT |
| pg-cloudflare | 1.4.1 | MIT |
| pg-connection-string | 2.14.1 | MIT |
| pg-int8 | 1.0.1 | ISC |
| pg-pool | 3.14.0 | MIT |
| pg-protocol | 1.16.1 | MIT |
| pg-types | 2.2.0 | MIT |
| pgpass | 1.0.5 | MIT |
| split2 | 4.2.0 | ISC |
| postgres-array | 2.0.0 | MIT |
| postgres-bytea | 1.0.1 | MIT |
| postgres-date | 1.0.7 | MIT |
| postgres-interval | 1.2.0 | MIT |
| jpeg-js | 0.4.4 | BSD-3-Clause |
| pngjs | 7.0.0 | MIT |

## Fonts

| Font | Foundry | Licence |
|---|---|---|
| Imbue (variable) | Google Fonts / Cindy Evans | SIL Open Font License 1.1 |
| Albert Sans (variable) | Google Fonts / Jonas Severin Fuss | SIL Open Font License 1.1 |

## Notes

- All shipped packages carry MIT, ISC or BSD-3-Clause licences; the fonts carry the SIL
  Open Font License 1.1.
- The SVG paths used for icons are embedded in the served assets; the browser loads
  nothing from another origin (IF-05).
