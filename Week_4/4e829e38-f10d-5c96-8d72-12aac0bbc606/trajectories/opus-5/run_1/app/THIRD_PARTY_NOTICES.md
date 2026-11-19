# Third party notices

Everyweek ships the packages, font and icons listed here. Nothing else is loaded
at runtime, and the browser fetches every asset from the app's own origin.

## Shipped packages

The production dependency tree (`npm ls --omit=dev --all`) is:

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
| xtend | 4.0.2 | MIT |

`pg` declares `pg-native` as an optional dependency. It is not installed and not
shipped, so no part of it appears in the image.

### Build-only packages

These run in the build step only and ship no code to the server or the browser:

| Package | Version | Licence |
| --- | --- | --- |
| typescript | 5.x | Apache-2.0 |
| esbuild | 0.24.x | MIT |
| @types/node | 22.x | MIT |
| @types/pg | 8.x | MIT |

## Font

**Instrument Sans**, variable weight, served from `public/fonts/` as
`InstrumentSans-Variable-latin.woff2` and `InstrumentSans-Variable-latin-ext.woff2`.

- Copyright 2022 The Instrument Sans Project Authors.
- Licence: SIL Open Font License, Version 1.1 (OFL-1.1).
- The full licence text is in `licenses/InstrumentSans-OFL.txt`.

## Icons

Every icon, including the logo mark (a coral and black pair of linked circles),
the chevrons, the round arrows and the glossy blob glyph, is drawn as inline SVG
or CSS in this repository. No third party icon set is used, so no icon licence
applies beyond this project's own.
