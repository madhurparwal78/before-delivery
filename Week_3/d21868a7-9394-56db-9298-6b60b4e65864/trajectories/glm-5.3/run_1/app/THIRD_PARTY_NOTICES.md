# Third-party notices

Ditchbook ships the following software. Each entry names the licence under
which it is redistributed.

## Node.js packages (production dependency tree)

The production dependency tree reported by `npm ls --omit=dev --all --json`:

| Package | Version | Licence |
|---|---|---|
| pg | 8.23.1 | MIT |
| pg-cloudflare | 1.4.1 | MIT |
| pg-connection-string | 2.14.1 | MIT |
| pg-pool | 3.14.0 | MIT |
| pg-protocol | 1.16.1 | MIT |
| pg-types | 2.2.0 | MIT |
| pgpass | 1.0.5 | MIT |
| pg-int8 | 1.0.1 | ISC |
| postgres-array | 2.0.0 | MIT |
| postgres-bytea | 1.0.1 | MIT |
| postgres-date | 1.0.7 | MIT |
| postgres-interval | 1.2.0 | MIT |
| split2 | 4.2.0 | ISC |
| xtend | 4.0.2 | MIT |

## Bundled fonts

| Font | File | Licence |
|---|---|---|
| Archivo (variable) | `public/fonts/Archivo-400.woff2` | SIL Open Font License 1.1 |
| IBM Plex Sans (variable) | `public/fonts/IBM-Plex-Sans-400.woff2` | SIL Open Font License 1.1 |

The full text of each font licence is served with the application at
`/licenses/OFL-Archivo.txt` and `/licenses/OFL-IBMPlexSans.txt`.

## Notes

- The application server, the browser bundle and all domain code in this
  repository are original work and carry no third-party notice.
- Fonts are self-hosted; no request leaves the application's own origin.
