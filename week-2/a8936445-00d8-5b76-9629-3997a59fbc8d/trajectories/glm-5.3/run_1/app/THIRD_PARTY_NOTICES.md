# Third-party notices

Stationkeeper ships the following third-party packages and bundled fonts.
The production dependency tree (as reported by `npm ls --omit=dev --all`), one root dependency `pg` and its transitive packages:

| Package | Version | Licence |
|---|---|---|
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
| xtend | 4.0.2 | MIT |

Bundled fonts (served by the app itself; no third-party font or script is loaded):

| Font | Version | Licence |
|---|---|---|
| Bricolage Grotesque | variable (Google Fonts, 2024 release) | OFL-1.1 |
| Public Sans | variable (Google Fonts, 2024 release) | OFL-1.1 |
| IBM Plex Mono | 400 and 600 weights (Google Fonts, 2024 release) | OFL-1.1 |

All other functionality — the HTTP server, the S3/MinIO client (AWS Signature V4 over
node:crypto), the SMTP client (node:net), PDF generation, and the browser app — is
hand-written application source with no third-party code.
