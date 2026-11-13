# Third-party notices

The Cutline Jury Desk bundles the following software, fonts and icon artwork.
Licences were read from the production dependency tree reported by
`npm ls --omit=dev --all --json`, from the font files themselves, and from the
Lucide icon set used to draw the interface glyphs.

## Fonts

| Font | Files | Licence |
| --- | --- | --- |
| Archivo (variable, weight 100–900, width 62–125) | `dist/client/assets/fonts/Archivo-var.ttf` | SIL Open Font License 1.1 |
| IBM Plex Sans (variable, weight 100–700) | `dist/client/assets/fonts/IBMPlexSans-var.ttf` | SIL Open Font License 1.1 |
| IBM Plex Mono (Regular and Medium) | `dist/client/assets/fonts/IBMPlexMono-Regular.ttf`, `dist/client/assets/fonts/IBMPlexMono-Medium.ttf` | SIL Open Font License 1.1 |

## Icons

| Icon set | Use | Licence |
| --- | --- | --- |
| Lucide (paths drawn into inline SVG) | status glyphs (triangle, star, circle, cross) and the reduced-motion arrows | ISC |

## Shipped packages

| Package | Version | Licence |
| --- | --- | --- |
| @aws-sdk/checksums | 3.1002.1 | Apache-2.0 |
| @aws-sdk/client-s3 | 3.1161.0 | Apache-2.0 |
| @aws-sdk/core | 3.979.1 | Apache-2.0 |
| @aws-sdk/credential-provider-env | 3.972.80 | Apache-2.0 |
| @aws-sdk/credential-provider-http | 3.972.82 | Apache-2.0 |
| @aws-sdk/credential-provider-ini | 3.973.25 | Apache-2.0 |
| @aws-sdk/credential-provider-login | 3.972.87 | Apache-2.0 |
| @aws-sdk/credential-provider-node | 3.972.92 | Apache-2.0 |
| @aws-sdk/credential-provider-process | 3.972.80 | Apache-2.0 |
| @aws-sdk/credential-provider-sso | 3.973.24 | Apache-2.0 |
| @aws-sdk/credential-provider-web-identity | 3.972.86 | Apache-2.0 |
| @aws-sdk/middleware-sdk-s3 | 3.972.85 | Apache-2.0 |
| @aws-sdk/nested-clients | 3.997.54 | Apache-2.0 |
| @aws-sdk/signature-v4-multi-region | 3.996.51 | Apache-2.0 |
| @aws-sdk/types | 3.975.0 | Apache-2.0 |
| @smithy/core | 3.38.1 | Apache-2.0 |
| @smithy/credential-provider-imds | 4.5.2 | Apache-2.0 |
| @smithy/fetch-http-handler | 5.8.0 | Apache-2.0 |
| @smithy/node-http-handler | 4.14.1 | Apache-2.0 |
| @smithy/types | 4.19.0 | Apache-2.0 |
| jpeg-js | 0.4.4 | BSD-3-Clause |
| nodemailer | 6.10.1 | MIT-0 |
| pg | 8.23.1 | MIT |
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
| split2 | 4.2.0 | ISC |
| tslib | 2.9.1 | 0BSD |
| xtend | 4.0.2 | MIT |

`pg-native` is listed by `pg` as an optional dependency; it is not installed and
no part of it ships with the app.
