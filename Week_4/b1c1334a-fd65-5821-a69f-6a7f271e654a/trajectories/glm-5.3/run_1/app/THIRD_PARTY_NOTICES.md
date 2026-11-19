# Third-party notices

Tallyframe ships the following third-party packages and assets.

## Packages (the production dependency tree)

| Package | Version | License |
|---|---|---|
| decimal.js | 10.6.0 | MIT |
| lucide-static | 1.68.0 | ISC |
| pg | 8.23.1 | MIT |
| pg-cloudflare | 1.4.1 | MIT |
| pg-connection-string | 2.14.1 | MIT |
| pg-pool | 3.14.0 | MIT |
| pg-protocol | 1.16.1 | MIT |
| pg-types | 2.2.0 | MIT |
| pg-int8 | 1.0.1 | ISC |
| postgres-array | 2.0.0 | MIT |
| postgres-bytea | 1.0.1 | MIT |
| postgres-date | 1.0.7 | MIT |
| postgres-interval | 1.2.0 | MIT |
| xtend | 4.0.2 | MIT |
| pgpass | 1.0.5 | MIT |
| split2 | 4.2.0 | ISC |

(The production tree is produced by `npm ls --omit=dev --all --json`. The
optional `pg-native` entry has no installed artefact and ships nothing.)

## Icons

- Lucide (lucide-static 1.68.0), ISC license. The bundled client embeds the
  Lucide `alert-circle` icon for refused fields.

## Fonts

- Instrument Serif, SIL Open Font License 1.1 (OFL-1.1).
- IBM Plex Sans, SIL Open Font License 1.1 (OFL-1.1).
- IBM Plex Mono, SIL Open Font License 1.1 (OFL-1.1).

All three are bundled and served from the app's own origin.
