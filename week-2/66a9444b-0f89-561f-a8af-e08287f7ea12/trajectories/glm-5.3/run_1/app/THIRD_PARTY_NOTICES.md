# Third-party notices

## Shipped packages

Production dependency tree as reported by `npm ls --omit=dev --all --json`.

| Package | Version | Licence |
|---|---|---|
| @jsquash/webp | 1.5.0 | Apache-2.0 |
| jpeg-js | 0.4.4 | BSD-3-Clause |
| pg | 8.13.1 | MIT |
| pg-cloudflare | 1.4.1 | MIT |
| pg-connection-string | 2.14.1 | MIT |
| pg-int8 | 1.0.1 | ISC |
| pg-pool | 3.14.0 | MIT |
| pg-protocol | 1.16.1 | MIT |
| pg-types | 2.2.0 | MIT |
| pgpass | 1.0.5 | MIT |
| pngjs | 7.0.0 | MIT |
| postgres-array | 2.0.0 | MIT |
| postgres-bytea | 1.0.1 | MIT |
| postgres-date | 1.0.7 | MIT |
| postgres-interval | 1.2.0 | MIT |
| qrcode-generator | 1.4.4 | MIT |
| split2 | 4.2.0 | ISC |
| wasm-feature-detect | 1.9.0 | Apache-2.0 |
| xtend | 4.0.2 | MIT |

`pg-native` is an unmet optional dependency of `pg` and is not installed.

## Bundled fonts

| Asset | Source | Licence |
|---|---|---|
| Anybody variable font (`src/client/fonts/Anybody-VariableFont_wdth,wght.ttf`) | Google Fonts, Anybody Project Authors (Etcetera Type Co) | SIL Open Font License 1.1 |
| Instrument Sans variable font (`src/client/fonts/InstrumentSans-VariableFont_wdth,wght.ttf`) | Google Fonts, Instrument Sans Project Authors | SIL Open Font License 1.1 |

## Other assets

The WebP decoder bundled inside `@jsquash/webp` is compiled from libwebp, which the
package distributes under the same Apache-2.0 package licence with upstream
BSD-3-Clause components. All remaining assets (styles, drawings, copy) are original
to this app.
