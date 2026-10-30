# Third-party notices

Plumbline ships the packages, typefaces and icon set below. Nothing else is
served to the browser and nothing is fetched from a third-party host at runtime.

## Packages

Every non-development package in `package-lock.json` that the install placed in
`node_modules`.

| Package | Version | Licence |
| --- | --- | --- |
| @fontsource/hanken-grotesk | 5.3.0 | OFL-1.1 |
| @fontsource/instrument-serif | 5.3.0 | OFL-1.1 |
| jpeg-js | 0.4.4 | BSD-3-Clause |
| lucide-react | 0.577.0 | ISC |
| pg | 8.16.3 | MIT |
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
| react | 19.3.1 | MIT |
| react-dom | 19.3.1 | MIT |
| scheduler | 0.28.0 | MIT |
| split2 | 4.2.0 | ISC |
| xtend | 4.0.2 | MIT |

## Typefaces and icons

| Asset | Kind | Version | Licence | Notes |
| --- | --- | --- | --- | --- |
| Instrument Serif | Typeface | shipped by @fontsource/instrument-serif | OFL-1.1 | Display typeface, served by the app from its own assets. |
| Hanken Grotesk | Typeface | shipped by @fontsource/hanken-grotesk | OFL-1.1 | Body typeface, served by the app from its own assets. |
| Lucide | Icon set | shipped by lucide-react | ISC | The only icon set in the interface. |

## Images

Every render, site photo, drawing sheet and case-study cover in the app is drawn
by the app itself from code in `src/server/services/procedural.ts`. No
third-party image is shipped.
